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

  /**
   * ⚠️ CET AUDIT MENTAIT, ET DANS LE PIRE SENS (constaté le 12/08/2026).
   *
   * Il cherchait un motif brut — `stop|rgpd|supprim|oppos|spam…` — N'IMPORTE OÙ dans le corps du
   * mail. Or NOTRE PROPRE PIED DE PAGE contient les trois mots les plus déclencheurs :
   * « Conformément au RGPD, vous pouvez demander leur suppression […] en répondant "Stop" ».
   * Et tout client mail cite le message auquel il répond.
   *
   * Résultat : les 22 « demandes d'arrêt non blocklistées » signalées étaient en réalité les
   * MEILLEURS leads — « Ok appelle moi », « oui c'est possible pour demain 14h », « Cela
   * m'intéresse, contactez-moi au 06… » — plus des réponses d'absence et des filtres antispam.
   * Zéro vraie demande d'arrêt. L'écran affichait une situation RGPD catastrophique là où il n'y
   * avait rien, et surtout : une vraie demande s'y serait noyée sans que personne ne la voie.
   *
   * C'est exactement le bug du 10/08 (notre signature analysée comme si le prospect l'avait
   * écrite), reproduit ici parce que l'audit refaisait sa propre détection au lieu d'utiliser
   * celle de la production.
   *
   * CORRECTIF : on emploie les MÊMES fonctions que le moteur — elles retirent d'abord notre pied
   * de page et les citations, et elles sont couvertes par 19 cas de test. Un contrôle qui
   * n'applique pas la règle du système qu'il surveille ne surveille rien.
   */
  const { isExplicitOptOut, isRgpdRequestOrComplaint } = await import('@/lib/rgpd')

  const toutesReponses = g(await db.execute(sql`
    SELECT id, from_email, body, classification, action_taken, created_at
    FROM incoming_replies WHERE body IS NOT NULL
    ORDER BY created_at DESC LIMIT 2000
  `)) as Array<{ id: string; from_email: string; body: string; classification: string | null; action_taken: string | null; created_at: string }>

  const vraiesDemandes = toutesReponses.filter(r =>
    isExplicitOptOut(r.body) || isRgpdRequestOrComplaint(r.body).match)
  const idsArret = vraiesDemandes.map(r => r.id)

  out._methode = `Détection par les fonctions de production (isExplicitOptOut / isRgpdRequestOrComplaint), pas par motif brut. ${vraiesDemandes.length} vraie(s) demande(s) sur ${toutesReponses.length} réponses examinées.`

  // 1) Demandes d'arrêt réelles → sont-elles blocklistées ?
  await run('demandes_arret_non_blocklistees', async () => {
    if (!idsArret.length) return []
    const bloques = new Set((g(await db.execute(sql`SELECT LOWER(email) AS e FROM blocklist WHERE email IS NOT NULL`)) as Array<{ e: string }>).map(r => r.e))
    return vraiesDemandes
      .filter(r => !bloques.has(String(r.from_email).toLowerCase()))
      .map(r => ({
        from_email: r.from_email, classification: r.classification,
        action_taken: r.action_taken, created_at: r.created_at,
        extrait: String(r.body).replace(/\s+/g, ' ').slice(0, 180),
      }))
  })

  // 2) LE PIRE CAS : un mail ENVOYÉ APRÈS une demande d'arrêt (RGPD : interdit).
  await run('mails_envoyes_apres_demande_arret', async () => g(await db.execute(sql`
    SELECT c.email, ir.created_at AS date_demande, eq.sent_at AS date_envoi_apres,
           eq.sequence_step, LEFT(regexp_replace(ir.body, '\\s+', ' ', 'g'), 140) AS extrait_demande
    FROM incoming_replies ir
    JOIN contacts c ON LOWER(c.email) = LOWER(ir.from_email)
    JOIN email_queue eq ON eq.contact_id = c.id AND eq.status = 'sent' AND eq.sent_at > ir.created_at
    -- Même correctif que ci-dessus : on ne se fie qu'aux demandes RÉELLEMENT identifiées.
    WHERE ir.id = ANY(${idsArret})
    ORDER BY eq.sent_at DESC LIMIT 40
  `)))

  // 3) Réponse AUTOMATIQUE envoyée à quelqu'un qui demandait l'arrêt (aggravant).
  await run('reponses_auto_a_demande_arret', async () => g(await db.execute(sql`
    SELECT ir.from_email, ir.classification, ir.action_taken, rd.status AS statut_reponse, rd.sent_at,
           LEFT(regexp_replace(ir.body, '\\s+', ' ', 'g'), 140) AS extrait_demande,
           LEFT(regexp_replace(rd.body, '\\s+', ' ', 'g'), 140) AS extrait_reponse
    FROM incoming_replies ir
    JOIN reply_drafts rd ON rd.incoming_reply_id = ir.id
    WHERE ir.id = ANY(${idsArret}) AND rd.status = 'sent'
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
