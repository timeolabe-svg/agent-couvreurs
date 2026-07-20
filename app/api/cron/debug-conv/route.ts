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
  // ?followups=1 → pourquoi les relances de conversation ne partent pas (out/in/silence par candidat)
  if (new URL(req.url).searchParams.get('followups')) {
    const rows = (await sql`
      SELECT c.email,
        (SELECT eq.from_email FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.from_email IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS owner_box,
        GREATEST(
          COALESCE((SELECT MAX(eq.sent_at) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent'), TIMESTAMP 'epoch'),
          COALESCE((SELECT MAX(rd.sent_at) FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id WHERE ir.contact_id = c.id AND rd.status = 'sent'), TIMESTAMP 'epoch')
        ) AS last_out,
        COALESCE((SELECT MAX(ir.created_at) FROM incoming_replies ir WHERE ir.contact_id = c.id), TIMESTAMP 'epoch') AS last_in,
        (SELECT COUNT(*) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status = 'sent')::int AS convo_relances,
        EXTRACT(EPOCH FROM (NOW() - GREATEST(
          COALESCE((SELECT MAX(eq.sent_at) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent'), TIMESTAMP 'epoch'),
          COALESCE((SELECT MAX(rd.sent_at) FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id WHERE ir.contact_id = c.id AND rd.status = 'sent'), TIMESTAMP 'epoch')
        )))/86400.0 AS jours_silence
      FROM contacts c
      WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id AND ir.classification IN ('interest','question','objection','rdv_request'))
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
        AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed')
        AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status IN ('pending','queued','sending'))
      LIMIT 30
    `) as Array<Record<string, unknown>>
    return NextResponse.json({ candidats: rows.length, rows })
  }

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
