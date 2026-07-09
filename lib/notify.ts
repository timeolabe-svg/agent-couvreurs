/**
 * notify.ts — envoi des notifications internes (au client + à Timéo) via Resend.
 *
 * Envoie UN MAIL PAR DESTINATAIRE (pas un seul envoi groupé) : si un destinataire est
 * refusé (ex: Resend en mode test n'autorise que l'owner), les AUTRES reçoivent quand même.
 * Sans ça, un seul destinataire non autorisé faisait échouer toute la notif (403).
 */
export async function notifyPerRecipient(
  recipients: string[],
  subject: string,
  html: string,
): Promise<{ sent: string[]; failed: Array<{ to: string; error: string }> }> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
  const sent: string[] = []
  const failed: Array<{ to: string; error: string }> = []
  const uniq = [...new Set(recipients.map(r => r.trim()).filter(Boolean))]
  if (!key) return { sent, failed: uniq.map(to => ({ to, error: 'RESEND_API_KEY manquante' })) }

  for (const to of uniq) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ from, to, subject, html }),
      })
      if (r.ok) sent.push(to)
      else failed.push({ to, error: `resend ${r.status}` })
    } catch (e) {
      failed.push({ to, error: String(e).slice(0, 80) })
    }
  }
  if (failed.length > 0) console.warn('[notify] envois échoués:', JSON.stringify(failed))
  return { sent, failed }
}
