import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RECONTACTE LES PROSPECTS À LA DATE DE RETOUR QU'ILS ONT EUX-MÊMES DONNÉE.
 *
 * « Je suis fermé jusqu'au 25 août » est le lead le plus facile du fichier : la personne a lu le
 * message, a répondu, et a fixé elle-même le moment où la rappeler. Ne pas le faire, c'est perdre
 * un prospect qui avait dit oui à la conversation.
 *
 * ⚠️ Ce que ça répare : la date était utilisée UNE fois, pour décaler les relances en file. Si le
 * contact n'avait plus de relance en attente — séquence terminée, file annulée — la date ne servait
 * à rien et personne ne revenait vers lui. Six personnes étaient dans ce cas au 19/08, dont deux
 * depuis juillet.
 *
 * ⚠️ ET SURTOUT : ON NE RELANCE PAS TOUT SEUL ICI. On prépare un brouillon dans « À valider ».
 * La règle de Timéo est constante — ce qui part chez un prospect qui a déjà répondu passe par lui.
 * Le cron garantit qu'on n'oublie personne ; l'humain garde la main sur ce qui est écrit.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  /**
   * Sont dus : date de retour passée (on tolère le jour même), pas de RDV, pas blocklistés, et
   * surtout AUCUN brouillon de reprise déjà préparé — sinon le cron en empilerait un par passage.
   */
  const dus = (await sql`
    SELECT c.id, c.email, c.company, c.absent_jusqu_au,
           (SELECT ir.id FROM incoming_replies ir
             WHERE ir.contact_id = c.id ORDER BY ir.created_at DESC LIMIT 1) AS derniere_reponse_id
    FROM contacts c
    WHERE c.absent_jusqu_au IS NOT NULL
      AND c.absent_jusqu_au <= CURRENT_DATE
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      AND NOT EXISTS (
        SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status IN ('confirmed', 'signed')
      )
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rd
        JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
        WHERE ir2.contact_id = c.id
          AND rd.created_at > c.absence_vue_le
      )
    ORDER BY c.absent_jusqu_au ASC
    LIMIT 20
  `) as Array<{ id: string; email: string; company: string | null; absent_jusqu_au: string; derniere_reponse_id: string | null }>

  const prepares: string[] = []
  const sansAncrage: string[] = []

  for (const c of dus) {
    // Un brouillon doit se rattacher à une réponse reçue : c'est ce lien qui le fait apparaître
    // dans « À valider » et dans le fil de la conversation.
    if (!c.derniere_reponse_id) { sansAncrage.push(c.email); continue }

    const corps = [
      'Bonjour,',
      '',
      'Vous m\'aviez indiqué être fermé, j\'espère que la reprise se passe bien.',
      '',
      'Je reviens vers vous comme convenu. On avait évoqué la possibilité de vous apporter plus de demandes de devis, avec le premier mois offert pour que vous jugiez sur les résultats.',
      '',
      'Auriez-vous quelques minutes cette semaine ?',
    ].join('\n')

    await sql`
      INSERT INTO reply_drafts (incoming_reply_id, body, status, created_at)
      VALUES (${c.derniere_reponse_id}::uuid, ${corps}, 'pending', NOW())
    `
    prepares.push(`${c.company ?? c.email} (retour annoncé le ${String(c.absent_jusqu_au).slice(0, 10)})`)
  }

  await pingHeartbeat('reprendre-apres-absence', true, `prepares=${prepares.length}`, 1440)

  return NextResponse.json({
    ok: true,
    brouillons_prepares: prepares.length,
    detail: prepares,
    sans_reponse_a_rattacher: sansAncrage,
    lecture: 'Ces brouillons attendent une validation dans « À valider ». Rien n\'est envoyé automatiquement.',
  })
}

export const GET = handler
