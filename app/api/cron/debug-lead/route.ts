import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Diagnostic ciblé d'un lead : état réel réponses/brouillons/rdv/file. ?email=...
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const email = new URL(req.url).searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email requis' }, { status: 400 })

  try {
    const c = (await sql`SELECT id, email, name, company, phone, sector, city FROM contacts WHERE lower(email)=lower(${email}) LIMIT 1`) as Array<Record<string, unknown>>
    if (!c[0]) return NextResponse.json({ error: 'contact introuvable', email })
    const id = c[0].id as string
    const ir = (await sql`SELECT id, classification, action_taken, created_at, left(body,140) AS body FROM incoming_replies WHERE contact_id=${id} ORDER BY created_at`) as Array<Record<string, unknown>>
    const rd = (await sql`SELECT rd.id, rd.status, rd.send_after, rd.sent_at, left(rd.body,140) AS body FROM reply_drafts rd JOIN incoming_replies i ON i.id=rd.incoming_reply_id WHERE i.contact_id=${id} ORDER BY rd.created_at`) as Array<Record<string, unknown>>
    const rv = (await sql`SELECT id, scheduled_at, status, left(notes,100) AS notes FROM rdv WHERE contact_id=${id} ORDER BY scheduled_at`) as Array<Record<string, unknown>>
    const eq = (await sql`SELECT sequence_step, status, sent_at FROM email_queue WHERE contact_id=${id} ORDER BY sequence_step`) as Array<Record<string, unknown>>
    return NextResponse.json({ contact: c[0], incoming_replies: ir, reply_drafts: rd, rdv: rv, email_queue: eq })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
