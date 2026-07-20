import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes } from '@/lib/gmail-sender'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Lecture SEULE des boîtes IMAP : liste les enveloppes récentes (from/subject/date) qui matchent
// ?q= (dans from ou subject), sur ?hours= de recul (défaut 240h). Pour retrouver une réponse non
// ingérée (ex. prospect qui répond d'une autre adresse). Ne marque RIEN comme lu, n'écrit rien.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const u = new URL(req.url)
  const q = (u.searchParams.get('q') || '').toLowerCase()
  const hours = Math.min(parseInt(u.searchParams.get('hours') || '240'), 720)
  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ error: 'aucune boîte' })

  const { ImapFlow } = await import('imapflow')
  const out: Array<{ box: string; from: string; subject: string; date: string }> = []
  const since = new Date(Date.now() - hours * 3600 * 1000)

  for (const box of boxes) {
    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
      logger: false, socketTimeout: 8000, greetingTimeout: 5000, connectionTimeout: 5000,
    })
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const found = await client.search({ since })
        const uids = (Array.isArray(found) ? found : []).slice(-120)
        for (const uid of uids) {
          const env = await client.fetchOne(uid, { envelope: true }).catch(() => null)
          if (!env || !env.envelope) continue
          const from = (env.envelope.from?.[0]?.address ?? '').toLowerCase()
          const subject = env.envelope.subject ?? ''
          if (q && !(from.includes(q) || subject.toLowerCase().includes(q))) continue
          out.push({ box: box.email, from, subject: subject.slice(0, 70), date: env.envelope.date?.toISOString?.() ?? '' })
        }
      } finally { lock.release() }
    } catch (e) {
      out.push({ box: box.email, from: 'ERREUR', subject: String((e as Error)?.message ?? e).slice(0, 60), date: '' })
    } finally {
      await client.logout().catch(() => { try { client.close() } catch { /* noop */ } })
    }
  }
  out.sort((a, b) => (b.date).localeCompare(a.date))
  return NextResponse.json({ q, hours, total: out.length, messages: out.slice(0, 60) })
}
