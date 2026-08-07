import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * AUDIT RGPD — recherche les manquements réels dans les DONNÉES (pas dans le code).
 * Objectif : détecter tout prospect ayant demandé l'arrêt/la suppression et qui aurait
 * malgré tout reçu un mail ensuite, ou reçu une réponse automatique à sa demande.
 * Aucune écriture : diagnostic seul.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
  const out: Record<string, unknown> = {}
  const run = async (k: string, fn: () => Promise<unknown>) => {
    try { out[k] = await fn() } catch (e) { out[k] = { _error: String(e).slice(0, 200) } }
  }

  // Motif large : TOUTE formulation d'arrêt, d'opposition ou de plainte (bien plus large que la
  // détection d'opt-out en production — c'est justement ce qu'on cherche à mesurer).
  const MOTIF = `(désabonn|desabonn|désinscri|desinscri|unsubscribe|ne plus (me |nous )?(recevoir|contacter|écrire|solliciter|envoyer)|arrêtez|arretez|stop|supprim|effac|retir|enlev|oppos|rgpd|cnil|spam|harcel|harcèl|plainte|poursuit|avocat)`

  // 1) Demandes d'arrêt détectées dans les réponses reçues → sont-elles blocklistées ?
  await run('demandes_arret_non_blocklistees', async () => g(await db.execute(sql`
    SELECT ir.from_email, ir.classification, ir.action_taken, ir.created_at,
           LEFT(regexp_replace(ir.body, '\\s+', ' ', 'g'), 180) AS extrait
    FROM incoming_replies ir
    WHERE ir.body ~* ${MOTIF}
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(ir.from_email)
      )
    ORDER BY ir.created_at DESC LIMIT 40
  `)))

  // 2) LE PIRE CAS : un mail ENVOYÉ APRÈS une demande d'arrêt (RGPD : interdit).
  await run('mails_envoyes_apres_demande_arret', async () => g(await db.execute(sql`
    SELECT c.email, ir.created_at AS date_demande, eq.sent_at AS date_envoi_apres,
           eq.sequence_step, LEFT(regexp_replace(ir.body, '\\s+', ' ', 'g'), 140) AS extrait_demande
    FROM incoming_replies ir
    JOIN contacts c ON LOWER(c.email) = LOWER(ir.from_email)
    JOIN email_queue eq ON eq.contact_id = c.id AND eq.status = 'sent' AND eq.sent_at > ir.created_at
    WHERE ir.body ~* ${MOTIF}
    ORDER BY eq.sent_at DESC LIMIT 40
  `)))

  // 3) Réponse AUTOMATIQUE envoyée à quelqu'un qui demandait l'arrêt (aggravant).
  await run('reponses_auto_a_demande_arret', async () => g(await db.execute(sql`
    SELECT ir.from_email, ir.classification, ir.action_taken, rd.status AS statut_reponse, rd.sent_at,
           LEFT(regexp_replace(ir.body, '\\s+', ' ', 'g'), 140) AS extrait_demande,
           LEFT(regexp_replace(rd.body, '\\s+', ' ', 'g'), 140) AS extrait_reponse
    FROM incoming_replies ir
    JOIN reply_drafts rd ON rd.incoming_reply_id = ir.id
    WHERE ir.body ~* ${MOTIF} AND rd.status = 'sent'
    ORDER BY rd.sent_at DESC LIMIT 30
  `)))

  // 4) Autonomie : combien de réponses sont parties SANS validation humaine ?
  await run('reponses_envoyees_sans_validation', async () => g(await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE ir.action_taken = 'auto_reply')::int AS auto_sans_validation,
           COUNT(*) FILTER (WHERE ir.action_taken = 'draft_for_validation')::int AS avec_validation,
           COUNT(*)::int AS total_reponses_envoyees
    FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
    WHERE rd.status = 'sent'
  `)))

  // 5) Pression d'envoi : contacts ayant reçu beaucoup de mails (risque "spam" perçu).
  await run('contacts_sur_sollicites', async () => g(await db.execute(sql`
    SELECT c.email, COUNT(*)::int AS mails_envoyes,
           MIN(eq.sent_at)::date AS premier, MAX(eq.sent_at)::date AS dernier
    FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
    WHERE eq.status = 'sent'
    GROUP BY c.email HAVING COUNT(*) >= 6
    ORDER BY 2 DESC LIMIT 20
  `)))

  // 6) Mails envoyés à des adresses PERSONNELLES (gmail/orange/free…) : en B2B l'intérêt
  // légitime est plus fragile sur une adresse manifestement personnelle.
  await run('adresses_personnelles_contactees', async () => g(await db.execute(sql`
    SELECT COUNT(DISTINCT c.id)::int AS n
    FROM contacts c
    WHERE EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent')
      AND c.email ~* '@(gmail|yahoo|hotmail|outlook|live|msn|aol|orange|wanadoo|free|sfr|laposte|icloud|me)\\.'
  `)))

  // 7) Blocklist : volume et motifs (traçabilité des demandes).
  await run('blocklist_par_motif', async () => g(await db.execute(sql`
    SELECT reason, COUNT(*)::int AS n FROM blocklist GROUP BY reason ORDER BY 2 DESC
  `)))

  // 8) Rétention : ancienneté des contacts jamais engagés (RGPD : ne pas conserver sans limite).
  await run('retention_contacts_inactifs', async () => g(await db.execute(sql`
    SELECT COUNT(*)::int AS jamais_contactes_depuis_plus_1an
    FROM contacts c
    WHERE c.created_at < NOW() - INTERVAL '1 year'
      AND NOT EXISTS (SELECT 1 FROM incoming_replies ir WHERE LOWER(ir.from_email) = LOWER(c.email))
  `)))

  return NextResponse.json({ ok: true, audit: out })
}
