import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

/**
 * TAUX DE REBOND RÉEL.
 *
 * ⚠️ CE DIAGNOSTIC ANNONÇAIT « 0 bounce sur 4 669 mails » (constaté le 13/08/2026). C'était
 * structurellement impossible à autre chose que zéro : il comptait `email_queue.status = 'bounced'`
 * — un statut que RIEN N'ÉCRIT JAMAIS. Le traitement des rebonds passe par `poll-imap-replies`,
 * qui inscrit l'adresse en blocklist avec `reason = 'bounce'` et ne touche pas la ligne de file.
 *
 * Au même instant, la blocklist contenait 49 rebonds. Le compteur ne mesurait donc pas un système
 * sain : il mesurait une colonne morte. C'est le défaut « tout compteur affiché doit avoir un
 * writer », et il est particulièrement coûteux ici — un taux de rebond qui monte est le signal
 * avancé d'une réputation d'expédition qui se dégrade. L'ignorer, c'est découvrir le problème
 * quand les mails partent déjà en spam.
 *
 * On mesure donc à la SOURCE QUI ÉCRIT (la blocklist), et on expose en parallèle le compteur de
 * la file : si l'écart se referme un jour, c'est qu'on aura branché le second writer. Tant qu'il
 * est béant, il est visible.
 */
async function handler(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const jours = Number(request.nextUrl.searchParams.get('jours') ?? 30)

  const [envois] = (await sql`
    SELECT COUNT(*)::int AS envoyes,
           COUNT(DISTINCT contact_id)::int AS contacts_touches
    FROM email_queue
    WHERE status = 'sent' AND sent_at > NOW() - (${jours} || ' days')::interval
  `) as Array<{ envoyes: number; contacts_touches: number }>

  const [rebonds] = (await sql`
    SELECT COUNT(*)::int AS n FROM blocklist
    WHERE reason = 'bounce' AND created_at > NOW() - (${jours} || ' days')::interval
  `) as Array<{ n: number }>

  const [aVie] = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM blocklist WHERE reason = 'bounce')            AS rebonds_a_vie,
      (SELECT COUNT(*)::int FROM email_queue WHERE status = 'sent')            AS envois_a_vie,
      (SELECT COUNT(*)::int FROM email_queue WHERE status = 'bounced')         AS lignes_file_marquees_bounced
  `) as Array<{ rebonds_a_vie: number; envois_a_vie: number; lignes_file_marquees_bounced: number }>

  const taux = envois.envoyes ? (rebonds.n / envois.envoyes) * 100 : 0
  const tauxVie = aVie.envois_a_vie ? (aVie.rebonds_a_vie / aVie.envois_a_vie) * 100 : 0

  // Seuils usuels de délivrabilité : au-delà de 2 % la réputation commence à souffrir, au-delà
  // de 5 % les fournisseurs sanctionnent activement.
  const verdict = taux > 5 ? 'CRITIQUE' : taux > 2 ? 'À SURVEILLER' : 'sain'

  return NextResponse.json({
    ok: taux <= 5,
    fenetre_jours: jours,
    envoyes: envois.envoyes,
    contacts_touches: envois.contacts_touches,
    rebonds: rebonds.n,
    taux_pourcent: Number(taux.toFixed(2)),
    verdict,
    a_vie: { ...aVie, taux_pourcent: Number(tauxVie.toFixed(2)) },
    mv_active: Boolean(process.env.MILLION_VERIFIER_API_KEY),
    // ⚠️ Écart volontairement exposé : tant qu'il vaut 0 alors que `rebonds_a_vie` est élevé,
    // c'est que la ligne de file n'est jamais marquée. Le masquer reviendrait à recréer le bug.
    note_incoherence: aVie.lignes_file_marquees_bounced === 0 && aVie.rebonds_a_vie > 0
      ? `Aucune ligne d'email_queue n'est marquée 'bounced' alors que ${aVie.rebonds_a_vie} rebonds sont enregistrés en blocklist. Le taux ci-dessus vient de la blocklist, la seule source réellement alimentée.`
      : null,
    detail: (await sql`
      SELECT b.email, b.created_at, c.email_confidence_score, c.email_validated, c.source
      FROM blocklist b
      LEFT JOIN contacts c ON LOWER(c.email) = LOWER(b.email)
      WHERE b.reason = 'bounce' AND b.created_at > NOW() - (${jours} || ' days')::interval
      ORDER BY b.created_at DESC LIMIT 30
    `),
  })
}

export const GET = wrapCron('bounce-check', handler)
