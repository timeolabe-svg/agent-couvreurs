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
