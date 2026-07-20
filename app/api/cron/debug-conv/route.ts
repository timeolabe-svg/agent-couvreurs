import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Lecture SEULE : timeline réelle (sent/received/drafts) d'un contact pour diagnostiquer l'ordre. ?email=
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const email = new URL(req.url).searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email requis' }, { status: 400 })
  try {
    const c = (await sql`SELECT id, email, company FROM contacts WHERE lower(email)=lower(${email}) LIMIT 1`) as Array<Record<string, unknown>>
    if (!c[0]) return NextResponse.json({ error: 'introuvable' })
    const id = c[0].id as string
    const sent = (await sql`SELECT sequence_step, status, sent_at, subject, left(body,60) AS body FROM email_queue WHERE contact_id=${id} AND status='sent' ORDER BY sent_at`) as Array<Record<string, unknown>>
    const recv = (await sql`SELECT id, created_at, classification, left(body,70) AS body FROM incoming_replies WHERE contact_id=${id} ORDER BY created_at`) as Array<Record<string, unknown>>
    const drafts = (await sql`SELECT rd.status, rd.created_at, rd.sent_at, rd.incoming_reply_id, left(rd.body,60) AS body FROM reply_drafts rd JOIN incoming_replies ir ON ir.id=rd.incoming_reply_id WHERE ir.contact_id=${id} ORDER BY rd.created_at`) as Array<Record<string, unknown>>
    return NextResponse.json({ contact: c[0], sent, received: recv, drafts })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
