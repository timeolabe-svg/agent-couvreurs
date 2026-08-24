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
 * ⚠️ CE MESSAGE-LÀ PART TOUT SEUL — décision de Timéo le 22/08 : « pour ce type de message t'as
 * pas besoin de ma validation ».
 *
 * La règle générale reste entière : ce qui part chez un prospect qui a déjà répondu passe par
 * l'humain. Mais elle existe pour une raison précise — empêcher qu'une phrase INVENTÉE par l'IA
 * arrive chez un prospect. Ici il n'y a rien d'inventé : le corps est figé mot pour mot dans ce
 * fichier, il ne dépend ni du message reçu ni d'un modèle. Faire valider un texte que personne ne
 * peut changer, c'est de la friction sans contrepartie, et pendant ce temps le prospect attend.
 *
 * ⚠️ CE QUI DÉLIMITE L'EXCEPTION, et qu'il ne faut pas élargir sans y penser :
 *   - le texte est CONSTANT (aucune génération, aucune interpolation du message reçu) ;
 *   - le destinataire a lui-même annoncé sa date de retour, donc il attend d'être recontacté ;
 *   - les garde-fous en amont restent tous actifs : blocklist, rendez-vous déjà pris, un seul
 *     brouillon par absence.
 * Dès qu'un de ces trois points tombe, on revient au brouillon à valider.
 *
 * ⚠️ ET SI L'ENVOI ÉCHOUE, le brouillon RESTE en « À valider » plutôt que d'être perdu : un message
 * qu'on croit parti et qui n'est jamais arrivé est pire qu'un message en attente.
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

  const { sendReplyEmail } = await import('@/lib/reply-agent/send-reply')

  const envoyes: string[] = []
  const enAttente: string[] = []
  const sansAncrage: string[] = []

  /**
   * D'abord, les reprises DÉJÀ préparées qui dorment dans « À valider ». Elles ont été créées quand
   * ce cron demandait encore une validation ; les laisser là serait faire attendre des prospects
   * pour une règle qui n'existe plus.
   */
  const enSouffrance = (await sql`
    SELECT rd.id, rd.body, rd.incoming_reply_id, c.email, c.company
    FROM reply_drafts rd
    JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
    JOIN contacts c ON c.id = ir.contact_id
    WHERE rd.status = 'pending'
      AND rd.body LIKE '%Vous m''aviez indiqué être fermé%'
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    LIMIT 10
  `) as Array<{ id: string; body: string; incoming_reply_id: string; email: string; company: string | null }>

  for (const d of enSouffrance) {
    const r = await sendReplyEmail(d.incoming_reply_id, d.body).catch(e => ({ ok: false, error: String(e) }))
    if (r.ok) {
      await sql`UPDATE reply_drafts SET status = 'sent', sent_at = NOW() WHERE id = ${d.id}::uuid`
      await sql`UPDATE incoming_replies SET action_taken = 'replied' WHERE id = ${d.incoming_reply_id}::uuid`
      envoyes.push(`${d.company ?? d.email} (reprise en attente depuis un ancien passage)`)
    } else {
      enAttente.push(`${d.company ?? d.email} : envoi refusé, reste à valider`)
    }
  }

  const prepares: string[] = []

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

    /**
     * On crée quand même la ligne de brouillon : c'est elle qui trace le message dans le fil de la
     * conversation ET qui empêche le passage suivant d'en empiler un second. Elle naît « pending »
     * puis passe à « sent » — jamais l'inverse, pour qu'un échec laisse une trace visible.
     */
    const [brouillon] = (await sql`
      INSERT INTO reply_drafts (incoming_reply_id, body, status, created_at)
      VALUES (${c.derniere_reponse_id}::uuid, ${corps}, 'pending', NOW())
      RETURNING id
    `) as Array<{ id: string }>

    const r = await sendReplyEmail(c.derniere_reponse_id, corps).catch(e => ({ ok: false, error: String(e) }))
    if (r.ok) {
      await sql`UPDATE reply_drafts SET status = 'sent', sent_at = NOW() WHERE id = ${brouillon.id}::uuid`
      await sql`UPDATE incoming_replies SET action_taken = 'replied' WHERE id = ${c.derniere_reponse_id}::uuid`
      envoyes.push(`${c.company ?? c.email} (retour annoncé le ${String(c.absent_jusqu_au).slice(0, 10)})`)
    } else {
      enAttente.push(`${c.company ?? c.email} : envoi refusé, reste à valider`)
    }
    prepares.push(c.email)
  }

  await pingHeartbeat('reprendre-apres-absence', true, `envoyes=${envoyes.length} en_attente=${enAttente.length}`, 1440)

  return NextResponse.json({
    ok: true,
    envoyes_automatiquement: envoyes.length,
    detail: envoyes,
    restes_a_valider: enAttente,
    sans_reponse_a_rattacher: sansAncrage,
    lecture: 'Le texte de reprise est figé dans le code, il ne peut rien contenir d\'inventé : il part donc sans validation. Un envoi refusé laisse le brouillon dans « À valider » plutôt que de le perdre.',
  })
}

export const GET = handler
