import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes } from '@/lib/gmail-sender'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

let sql!: NeonQueryFunction<false, false>

// Lecture SEULE. ?q=terme → cherche dans les BOÎTES IMAP (from/subject) ET en base (contacts + réponses).
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const u = new URL(req.url)
  const q = (u.searchParams.get('q') || '').toLowerCase()
  if (!q) return NextResponse.json({ error: 'q= requis' }, { status: 400 })
  const hours = Math.min(parseInt(u.searchParams.get('hours') || '336'), 720)

  const out: Record<string, unknown> = {}

  // ── Base ──
  if (process.env.DATABASE_URL) {
    sql = (await import('@/lib/db')).sql
    try {
      out.contacts = (await sql`
        SELECT c.id, c.email, c.company, c.phone,
          (SELECT count(*) FROM incoming_replies ir WHERE ir.contact_id = c.id)::int AS nb_reponses
        FROM contacts c
        WHERE c.company ILIKE ${'%' + q + '%'} OR c.email ILIKE ${'%' + q + '%'} OR c.name ILIKE ${'%' + q + '%'}
        LIMIT 10`) as Array<Record<string, unknown>>
      out.replies = (await sql`
        SELECT ir.from_email, ir.classification, ir.created_at, left(ir.body, 90) AS body
        FROM incoming_replies ir
        WHERE ir.from_email ILIKE ${'%' + q + '%'} OR ir.body ILIKE ${'%' + q + '%'}
        ORDER BY ir.created_at DESC LIMIT 10`) as Array<Record<string, unknown>>
    } catch (e) { out.db_error = String((e as Error)?.message ?? e).slice(0, 120) }
  }

  // ── Boîtes IMAP (sautable : ?skipmail=1 pour une réponse rapide base-seule) ──
  if (u.searchParams.get('skipmail') === '1') return NextResponse.json(out)
  const started = Date.now()
  const boxes = getGmailBoxes()
  const found: Array<Record<string, unknown>> = []
  const { ImapFlow } = await import('imapflow')
  const since = new Date(Date.now() - hours * 3600 * 1000)
  for (const box of boxes) {
    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true,
      auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
      logger: false, socketTimeout: 9000, greetingTimeout: 5000, connectionTimeout: 5000,
    })
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const res = await client.search({ since })
        const uids = (Array.isArray(res) ? res : []).slice(-90).reverse()
        for (const uid of uids) {
          if (Date.now() - started > 40000) break // garde-fou temps global
          const env = await client.fetchOne(uid, { envelope: true }).catch(() => null)
          if (!env || !env.envelope) continue
          const from = (env.envelope.from?.[0]?.address ?? '').toLowerCase()
          const name = (env.envelope.from?.[0]?.name ?? '').toLowerCase()
          const subject = env.envelope.subject ?? ''
          if (!(from.includes(q) || name.includes(q) || subject.toLowerCase().includes(q))) continue
          found.push({ box: box.email, from, name, subject: subject.slice(0, 70), date: env.envelope.date?.toISOString?.() ?? '' })
        }
      } finally { lock.release() }
    } catch (e) {
      found.push({ box: box.email, erreur: String((e as Error)?.message ?? e).slice(0, 60) })
    } finally {
      await client.logout().catch(() => { try { client.close() } catch { /* noop */ } })
    }
  }
  out.boites = found
  return NextResponse.json(out)
}
