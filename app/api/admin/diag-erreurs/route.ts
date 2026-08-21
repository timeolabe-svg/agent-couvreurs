import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * DIAGNOSTIC DES QUATRE PANNES SIGNALÉES LE 21/08 — lecture seule, ne corrige rien.
 *
 * Timéo a signalé quatre choses le même jour :
 *   1. des conversations marquées « RDV » restent dans l'onglet « En attente »
 *   2. un prospect qui demandait à être rappelé (numéro en 06 06) n'a pas été détecté
 *   3. il ne voit qu'une boîte sur son téléphone et soupçonne qu'on rate des réponses
 *   4. une entreprise à moins de 20 avis a été démarchée
 *
 * Aucune de ces quatre-là ne se règle en relisant le code : il faut voir les données. Ce fichier
 * pose les questions, il ne répond à aucune.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const seul = req.nextUrl.searchParams.get('q')
  const out: Record<string, unknown> = {}

  // ── 1. Badge RDV mais pas de ligne de rendez-vous ────────────────────────────
  if (!seul || seul === '1') {
    out.rdv_sans_ligne = await sql`
      SELECT c.id, c.company, c.google_reviews_count, c.sector, ir.classification, ir.created_at,
             EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id) AS a_une_ligne_rdv,
             (SELECT r.status FROM rdv r WHERE r.contact_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS statut_rdv
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.classification IN ('rdv_request', 'interest', 'rdv', 'interested')
        AND ir.created_at > NOW() - INTERVAL '12 days'
      ORDER BY ir.created_at DESC
      LIMIT 20
    `
  }

  // ── 2. Le prospect qui voulait être rappelé ─────────────────────────────────
  if (!seul || seul === '2') {
    out.demandes_de_rappel = await sql`
      SELECT c.company, c.email, ir.classification, ir.created_at,
             LEFT(REGEXP_REPLACE(ir.body, '\\s+', ' ', 'g'), 260) AS extrait
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at > NOW() - INTERVAL '20 days'
        AND (ir.body ~* 'rappel|rappeler|appelez|téléphon|telephon|joignable|mon num'
             OR ir.body ~ '0[1-9]([ .-]?[0-9]{2}){4}')
      ORDER BY ir.created_at DESC
      LIMIT 25
    `
  }

  // ── 3. Les boîtes sont-elles toutes relevées, et à quel rythme ? ────────────
  if (!seul || seul === '3') {
    out.reponses_par_boite = await sql`
      SELECT m.from_email AS boite,
             COUNT(*)::int AS reponses_recues,
             MAX(ir.created_at) AS derniere
      FROM incoming_replies ir
      LEFT JOIN email_queue m ON m.id = ir.email_queue_id
      WHERE ir.created_at > NOW() - INTERVAL '14 days'
      GROUP BY m.from_email
      ORDER BY reponses_recues DESC
    `
    out.passages_du_poller = await sql`
      SELECT last_run_at, last_ok, last_detail
      FROM cron_heartbeats WHERE cron_name = 'poll-imap-replies'
    `
    /**
     * ⚠️ LA VRAIE QUESTION N'EST PAS « LES 4 BOÎTES SONT-ELLES LUES » mais « le traitement
     * va-t-il au bout ». Une boîte ouverte dont on ne traite qu'un message par passage laisse
     * grossir un retard que rien n'affiche.
     */
    out.retard_de_traitement = await sql`
      SELECT COUNT(*)::int AS reponses_sans_classification,
             MIN(created_at) AS la_plus_ancienne
      FROM incoming_replies
      WHERE classification IS NULL AND created_at > NOW() - INTERVAL '30 days'
    `
  }

  // ── 4. Le filtre des 20 avis a-t-il laissé passer quelqu'un ? ───────────────
  if (!seul || seul === '4') {
    out.contactes_sous_20_avis = await sql`
      SELECT c.company, c.google_reviews_count, c.city, MIN(m.sent_at) AS premier_mail
      FROM contacts c
      JOIN email_queue m ON m.contact_id = c.id AND m.status = 'sent'
      WHERE COALESCE(c.google_reviews_count, 0) < 20
      GROUP BY c.id, c.company, c.google_reviews_count, c.city
      ORDER BY premier_mail DESC
      LIMIT 20
    `
    out.total_sous_20_avis = await sql`
      SELECT
        COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.google_reviews_count, 0) < 20)::int AS sous_20,
        COUNT(DISTINCT c.id) FILTER (WHERE c.google_reviews_count IS NULL)::int AS avis_inconnus,
        COUNT(DISTINCT c.id)::int AS total_demarches
      FROM contacts c
      JOIN email_queue m ON m.contact_id = c.id AND m.status = 'sent'
    `
  }

  // ── 5. Qui a REPONDU recemment, et combien d avis avait-il au moment du demarchage ? ──
  if (!seul || seul === '5') {
    out.repondeurs_recents = await sql`
      SELECT c.company, c.sector, c.google_reviews_count, c.city,
             ir.classification, ir.created_at,
             (SELECT MIN(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent') AS premier_mail
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at > NOW() - INTERVAL '20 days'
      ORDER BY ir.created_at DESC
      LIMIT 30
    `
  }

  // ── 6. Les relances continuent-elles de partir vers les moins de 20 avis ? ──
  if (!seul || seul === '6') {
    out.file_sous_20_avis = await sql`
      SELECT q.status, COUNT(*)::int AS n, MIN(q.scheduled_at) AS prochaine, MAX(q.sent_at) AS dernier_envoi
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE COALESCE(c.google_reviews_count, 0) < 20
      GROUP BY q.status ORDER BY n DESC
    `
    out.envois_recents_sous_20 = await sql`
      SELECT c.company, c.google_reviews_count, q.sequence_step, q.sent_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE COALESCE(c.google_reviews_count, 0) < 20 AND q.status = 'sent'
      ORDER BY q.sent_at DESC LIMIT 12
    `
  }

  // ── 7. Les conversations visibles a l ecran, avec leur nombre d avis ──
  if (!seul || seul === '7') {
    out.conversations_visibles = await sql`
      SELECT DISTINCT c.company, c.google_reviews_count, c.sector, c.city,
             (SELECT MIN(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status='sent') AS premier_mail,
             (SELECT MAX(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status='sent') AS dernier_mail
      FROM incoming_replies ir JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.archive_le IS NULL
        AND COALESCE(c.google_reviews_count, 0) < 20
      ORDER BY dernier_mail DESC NULLS LAST
      LIMIT 20
    `
  }

  return NextResponse.json({ ok: true, ...out })
}
