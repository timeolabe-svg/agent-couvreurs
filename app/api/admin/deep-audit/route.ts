import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * DEEP-AUDIT — balayage exhaustif d'intégrité du pipeline, à la demande.
 * Chaque section est isolée (une requête qui casse n'invalide pas le reste).
 * Vérifie : leads jamais entrés en pipeline, files bloquées, zéro-lead-perdu,
 * respect de la pause secteurs, clustering, opt-out, RDV, doublons, plafonds.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

  const out: Record<string, unknown> = {}
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn() } catch (e) { out[name] = { _error: String(e).slice(0, 200) } }
  }

  // 1) LEADS JAMAIS ENTRÉS EN PIPELINE — contacts qualifiés (≥20 avis, email) sans AUCUNE ligne email_queue.
  await run('leads_jamais_en_file', async () => g(await db.execute(sql`
    SELECT c.sector, COUNT(*)::int AS n
    FROM contacts c
    WHERE COALESCE(c.google_reviews_count,0) >= 20 AND c.email IS NOT NULL AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    GROUP BY c.sector ORDER BY n DESC
  `)))

  // 2) STEP-0 EN FILE BLOQUÉS > 3 JOURS — avec la raison du blocage.
  await run('step0_bloques_par_raison', async () => g(await db.execute(sql`
    SELECT c.sector,
      COUNT(*) FILTER (WHERE c.email_validated IS NOT TRUE)::int AS attend_validation_mv,
      COUNT(*) FILTER (WHERE c.email_validated IS TRUE AND COALESCE(c.google_reviews_count,0) < 20)::int AS sous_20_avis,
      COUNT(*) FILTER (WHERE c.email_validated IS TRUE AND COALESCE(c.google_reviews_count,0) >= 20)::int AS pret_mais_pas_parti
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'queued' AND eq.sequence_step = 0 AND eq.scheduled_at < NOW() - INTERVAL '3 days'
    GROUP BY c.sector ORDER BY 2 DESC
  `)))

  // 3) MV ABANDONNÉS — plafond de tentatives atteint, jamais validés, file encore active (morts-vivants).
  await run('mv_abandonnes', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM contacts c
    WHERE c.mv_attempts >= 5 AND c.email_validated IS NOT TRUE
      AND EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status IN ('queued','pending'))
  `)))

  // 4) PLACEHOLDERS DE GÉNÉRATION MORTS — 'pending' avec corps non généré depuis > 24h.
  await run('pending_generation_morts', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM email_queue
    WHERE status = 'pending' AND body = '__pending_generation__' AND created_at < NOW() - INTERVAL '24 hours'
  `)))

  // 5) 'sending' COINCÉS (le reaper devrait les prendre au prochain run d'envoi).
  await run('sending_coinces', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM email_queue WHERE status = 'sending' AND sent_at < NOW() - INTERVAL '20 minutes'
  `)))

  // 6) ZÉRO LEAD PERDU — dernier message d'une conversation chaude = le PROSPECT, sans réponse de l'agent après.
  await run('reponses_chaudes_sans_reponse', async () => g(await db.execute(sql`
    SELECT c.email, ir.classification, ir.created_at
    FROM incoming_replies ir JOIN contacts c ON c.id = ir.contact_id
    WHERE ir.classification IN ('interest','question','objection','rdv_request')
      AND ir.created_at > NOW() - INTERVAL '14 days'
      AND ir.created_at = (SELECT MAX(ir2.created_at) FROM incoming_replies ir2 WHERE ir2.contact_id = ir.contact_id)
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rd
        WHERE rd.incoming_reply_id = ir.id AND rd.status IN ('sent','pending','scheduled')
      )
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    ORDER BY ir.created_at DESC LIMIT 20
  `)))

  // 7) BROUILLONS BLOQUÉS — pending/scheduled > 48h jamais envoyés (la validation ou l'envoi auto a calé).
  await run('drafts_bloques', async () => g(await db.execute(sql`
    SELECT rd.status, COUNT(*)::int AS n, MIN(rd.created_at) AS plus_ancien
    FROM reply_drafts rd
    WHERE rd.status IN ('pending','scheduled') AND rd.created_at < NOW() - INTERVAL '48 hours'
    GROUP BY rd.status
  `)))

  // 8) VIOLATION PAUSE SECTEURS — step-0 ENVOYÉ ces 3 derniers jours à un secteur en pause.
  await run('violation_pause_secteurs', async () => {
    const { getPausedSectors } = await import('@/lib/experiments')
    const paused = await getPausedSectors()
    if (paused.length === 0) return { paused: [], violations: [] }
    const rows = g(await db.execute(sql`
      SELECT c.sector, COUNT(*)::int AS n
      FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status = 'sent' AND eq.sequence_step = 0 AND eq.sent_at > NOW() - INTERVAL '3 days'
        AND c.sector IN (${sql.join(paused.map(s => sql`${s}`), sql`, `)})
      GROUP BY c.sector
    `))
    return { paused, violations: rows }
  })

  // 9) CLUSTERING DEPUIS LE FIX (28/07 14:05 UTC) — doit rester vide.
  await run('clustering_depuis_fix', async () => g(await db.execute(sql`
    SELECT c.email, eq.sent_at::date AS jour, COUNT(*)::int AS n
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'sent' AND eq.sent_at > TIMESTAMP '2026-07-28 14:05:00'
    GROUP BY c.email, eq.sent_at::date HAVING COUNT(*) > 1
  `)))

  // 10) OPT-OUT INTÉGRITÉ — blocklistés avec des mails ENCORE en file active (doivent être annulés).
  await run('blocklistes_avec_file_active', async () => g(await db.execute(sql`
    SELECT c.email, COUNT(*)::int AS lignes_actives
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status IN ('queued','pending')
      AND EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
           OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
      )
    GROUP BY c.email LIMIT 20
  `)))

  // 11) PLAFOND À VIE DÉPASSÉ — contacts avec > 8 mails envoyés (ne devrait JAMAIS arriver).
  await run('plafond_a_vie_depasse', async () => g(await db.execute(sql`
    SELECT c.email, COUNT(*)::int AS sent
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'sent' GROUP BY c.email HAVING COUNT(*) > 8 LIMIT 10
  `)))

  // 12) DOUBLONS QUEUED (contact, step) — l'anti-doublon intra-run doit les rendre impossibles.
  await run('doublons_queued', async () => g(await db.execute(sql`
    SELECT contact_id, sequence_step, COUNT(*)::int AS n
    FROM email_queue WHERE status = 'queued'
    GROUP BY contact_id, sequence_step HAVING COUNT(*) > 1 LIMIT 10
  `)))

  // 13) RDV PROPOSÉS EXPIRÉS — créneau proposé jamais confirmé et déjà PASSÉ : il faut re-proposer,
  // sinon la conversation meurt (le prospect croit peut-être que c'est calé).
  await run('rdv_proposes_expires', async () => g(await db.execute(sql`
    SELECT c.email, r.scheduled_at, r.created_at
    FROM rdv r JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'proposed' AND r.scheduled_at < NOW()
    ORDER BY r.scheduled_at DESC LIMIT 20
  `)))

  // 14) RDV CONFIRMÉS À VENIR — sanity (le client doit les honorer).
  await run('rdv_confirmes_a_venir', async () => g(await db.execute(sql`
    SELECT c.email, r.scheduled_at FROM rdv r JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'confirmed' AND r.scheduled_at > NOW() ORDER BY r.scheduled_at ASC LIMIT 10
  `)))

  // 15) CONTACTS BOUNCED/UNSUB AVEC FILE ACTIVE — leurs mails doivent être annulés.
  await run('bounced_avec_file_active', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status IN ('queued','pending') AND c.email_validated = false AND c.mv_attempts >= 5
  `)))

  // 16) RÉPONSES NON CLASSIFIÉES RÉCENTES — le classifieur a calé (elles n'entrent dans aucun flux).
  await run('reponses_non_classifiees', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM incoming_replies
    WHERE classification IS NULL AND created_at > NOW() - INTERVAL '7 days'
  `)))

  // 17) CONVERSATIONS CHAUDES SANS AUCUNE SUITE PRÉVUE — a répondu, pas de RDV, pas de relance en
  // file, relances de conversation épuisées : plus RIEN ne se passera pour elles (onglet Échoué).
  await run('conversations_sans_suite', async () => g(await db.execute(sql`
    SELECT COUNT(DISTINCT c.id)::int AS n
    FROM contacts c
    WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id AND ir.classification IN ('interest','question','objection','rdv_request'))
      AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status IN ('confirmed','proposed'))
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status IN ('queued','pending','sending'))
      AND NOT EXISTS (SELECT 1 FROM reply_drafts rd JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id WHERE ir2.contact_id = c.id AND rd.status IN ('pending','scheduled'))
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      AND (SELECT COUNT(*) FROM email_queue eq2 WHERE eq2.contact_id = c.id AND eq2.sequence_step >= 20 AND eq2.status = 'sent') >= 2
  `)))

  // 18) HEARTBEATS — état réel de la surveillance (qui pingue, qui est muet).
  await run('heartbeats', async () => g(await db.execute(sql`
    SELECT cron_name, last_run_at, last_ok, expected_interval_minutes,
      CASE WHEN last_run_at IS NULL THEN 'JAMAIS PINGÉ (angle mort)'
           WHEN last_run_at < NOW() - (expected_interval_minutes * 3 || ' minutes')::interval THEN 'MUET'
           ELSE 'ok' END AS etat
    FROM cron_heartbeats ORDER BY cron_name
  `)))

  // ── Sections d'affinage (investigation des trouvailles du 1er passage) ──

  // 19) PENDING GÉNÉRATION MORTS — ventilés par secteur (pause = normal, terrassier = anomalie).
  await run('pending_morts_par_secteur', async () => g(await db.execute(sql`
    SELECT c.sector, COUNT(*)::int AS n, MIN(eq.created_at) AS plus_ancien
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'pending' AND eq.body = '__pending_generation__' AND eq.created_at < NOW() - INTERVAL '24 hours'
    GROUP BY c.sector ORDER BY n DESC
  `)))

  // 20) POURQUOI les step-0 "prêts" ne partent pas — détail par contact (a répondu ? blocklisté ?).
  await run('step0_prets_detail', async () => g(await db.execute(sql`
    SELECT c.email, c.sector,
      EXISTS (SELECT 1 FROM incoming_replies ir WHERE LOWER(ir.from_email) = LOWER(c.email)
        AND (ir.classification IS NULL OR ir.classification NOT IN ('oof','spam')))::bool AS a_repondu,
      EXISTS (SELECT 1 FROM blocklist b WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
        OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain)))::bool AS blockliste,
      EXISTS (SELECT 1 FROM email_queue s WHERE s.contact_id = c.id AND s.sequence_step = 0 AND s.status = 'sent')::bool AS step0_deja_sent
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'queued' AND eq.sequence_step = 0 AND eq.scheduled_at < NOW() - INTERVAL '3 days'
      AND c.email_validated IS TRUE AND COALESCE(c.google_reviews_count,0) >= 20
    LIMIT 15
  `)))

  // 21) TERRASSIERS JAMAIS EN FILE — combien sont RÉELLEMENT prêts à l'envoi (gate confiance/validation).
  await run('terrassiers_oublies_eligibles', async () => g(await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_jamais_en_file,
      COUNT(*) FILTER (WHERE c.email_validated IS TRUE OR COALESCE(c.email_confidence_score,0) >= 90)::int AS passent_le_gate,
      COUNT(*) FILTER (WHERE c.audit_done IS TRUE)::int AS audit_fait
    FROM contacts c
    WHERE c.sector = 'terrassier'
      AND COALESCE(c.google_reviews_count,0) >= 20 AND c.email IS NOT NULL AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
  `)))

  // 22) POURQUOI les pending terrassier ne sont jamais promus — ventilation par raison de blocage.
  await run('pending_terrassier_raisons', async () => g(await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE camp.status IS DISTINCT FROM 'active')::int AS campagne_inactive,
      COUNT(*) FILTER (WHERE c.audit_done IS NOT TRUE)::int AS audit_pas_fait,
      COUNT(*) FILTER (WHERE COALESCE(c.email_confidence_score,0) < 90 AND c.email_validated IS NOT TRUE)::int AS gate_email_bloque,
      COUNT(*) FILTER (WHERE COALESCE(c.google_reviews_count,0) < 20)::int AS sous_20_avis,
      COUNT(*) FILTER (WHERE COALESCE(c.mv_attempts,0) >= 5)::int AS mv_epuise,
      COUNT(*) FILTER (WHERE camp.status = 'active' AND c.audit_done IS TRUE
        AND (COALESCE(c.email_confidence_score,0) >= 90 OR c.email_validated IS TRUE)
        AND COALESCE(c.google_reviews_count,0) >= 20)::int AS aucune_raison_apparente
    FROM email_queue eq
    JOIN contacts c ON c.id = eq.contact_id
    LEFT JOIN campaigns camp ON camp.id = eq.campaign_id
    WHERE eq.status = 'pending' AND eq.sequence_step = 0 AND c.sector = 'terrassier'
  `)))

  return NextResponse.json({ ok: true, audit: out })
}
