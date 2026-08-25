/**
 * send-reply.ts — envoi d'une réponse au prospect via le moteur MAISON (SMTP Gmail).
 *
 * Remplace l'ancien Instantly `sendReply`. On répond depuis la boîte gabin@ qui a
 * contacté ce prospect (cohérence signature/enveloppe), en "Re: <sujet d'origine>".
 * Utilisé par : poll-imap-replies (auto-réponses programmées) + validation humaine.
 */
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'

export interface SendReplyResult {
  ok: boolean
  via?: string
  to?: string
  error?: string
}

/** Envoie la réponse `body` au prospect à l'origine de l'incoming_reply donné. */
export async function sendReplyEmail(incomingReplyId: string, body: string): Promise<SendReplyResult> {
  const { sql } = await import('@/lib/db')
  const rows = (await sql`
    SELECT ir.from_email, ir.subject, ir.contact_id,
           (SELECT eq.from_email FROM email_queue eq
              WHERE eq.contact_id = ir.contact_id AND eq.status = 'sent' AND eq.from_email IS NOT NULL
              ORDER BY eq.sent_at DESC LIMIT 1) AS owning_box
    FROM incoming_replies ir
    WHERE ir.id = ${incomingReplyId}
    LIMIT 1
  `) as Array<{ from_email: string; subject: string | null; contact_id: string | null; owning_box: string | null }>

  const r = rows[0]
  if (!r || !r.from_email) return { ok: false, error: 'incoming reply introuvable ou sans adresse' }

  /**
   * ⚠️ JAMAIS DEUX MESSAGES DE L'AGENT AU MÊME PROSPECT À QUELQUES MINUTES D'INTERVALLE.
   *
   * Le 25/08, Jaky Lesage a reçu trois messages en dix-neuf minutes, dont un rappel de rendez-vous
   * pour le lendemain alors qu'il venait d'écrire « je suis disponible MAINTENANT ». Entre-temps
   * Timéo lui avait répondu à la main depuis la boîte pour lui dire qu'il l'appelait dans quelques
   * minutes. Le prospect a reçu trois voix différentes sur le même fil, et Timéo a dû envoyer un
   * mail d'excuse en prétendant s'être trompé de destinataire.
   *
   * Un prospect ne lit pas des « chemins de code », il lit UNE conversation. Chaque chemin se
   * croyait seul et avait raison isolément — c'est justement pour ça que le garde-fou est ICI,
   * dans le seul passage par lequel toute réponse de l'agent sort. Une règle posée dans un appelant
   * ne protège que cet appelant.
   *
   * ⚠️ Ce délai n'est PAS un confort de style : c'est ce qui a coûté un rendez-vous.
   */
  const DELAI_MIN_ENTRE_MESSAGES_MIN = Number(process.env.DELAI_MIN_ENTRE_MESSAGES_MIN ?? 120)
  if (r.contact_id) {
    const recent = (await sql`
      SELECT MAX(t.quand) AS dernier FROM (
        SELECT eq.sent_at AS quand FROM email_queue eq
          WHERE eq.contact_id = ${r.contact_id} AND eq.status = 'sent'
        UNION ALL
        SELECT rd.sent_at FROM reply_drafts rd
          JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
          WHERE ir2.contact_id = ${r.contact_id} AND rd.status = 'sent'
        UNION ALL
        /**
         * ⚠️ ET SURTOUT CE QUE TIMÉO A ÉCRIT LUI-MÊME depuis Gmail. Ces messages n'existent ni dans
         * la file ni dans les brouillons : sans cette source, l'agent croit que personne n'a
         * répondu et écrit par-dessus la réponse d'un humain. Alimenté par le relevé du dossier
         * des envoyés.
         */
        SELECT mh.envoye_le FROM messages_humains mh
          WHERE LOWER(mh.destinataire) = LOWER(${r.from_email})
      ) t
    `.catch(() => [{ dernier: null }])) as Array<{ dernier: string | null }>
    const dernier = recent[0]?.dernier ? new Date(recent[0].dernier).getTime() : 0
    const minutes = dernier ? (Date.now() - dernier) / 60_000 : Infinity
    if (minutes < DELAI_MIN_ENTRE_MESSAGES_MIN) {
      return {
        ok: false,
        error: `un message est déjà parti à ce prospect il y a ${Math.round(minutes)} min (délai minimum ${DELAI_MIN_ENTRE_MESSAGES_MIN} min)`,
      }
    }
  }

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return { ok: false, error: 'aucune boîte Gmail (IMAP_ACCOUNTS)' }

  // Boîte émettrice : celle qui a contacté ce prospect ; sinon la première dispo.
  const box = boxes.find(b => b.email.toLowerCase() === (r.owning_box ?? '').toLowerCase()) ?? boxes[0]

  const baseSubject = (r.subject ?? '').replace(/^\s*(re\s*:\s*)+/i, '').trim()
  const subject = baseSubject ? `Re: ${baseSubject}` : 'Re: votre message'

  const res = await sendFromBox(box, {
    to: r.from_email,
    subject,
    text: body,
    senderName: getInboxSenderName(box.email),
  })
  return { ok: res.ok, via: box.email, to: r.from_email, error: res.error }
}
