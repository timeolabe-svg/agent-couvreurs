import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Lecture SEULE. ?search=BJM → contacts + état conversation. ?email= → timeline détaillée.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const u = new URL(req.url)

  const search = u.searchParams.get('search')
  if (search) {
    const rows = (await sql`
      SELECT c.id, c.email, c.company,
        (SELECT count(*) FROM incoming_replies ir WHERE ir.contact_id = c.id)::int AS nb_reponses,
        (SELECT ir.classification FROM incoming_replies ir WHERE ir.contact_id = c.id ORDER BY ir.created_at DESC LIMIT 1) AS derniere_classif,
        (SELECT MAX(ir.created_at) FROM incoming_replies ir WHERE ir.contact_id = c.id) AS derniere_reponse,
        (SELECT left(ir.body,80) FROM incoming_replies ir WHERE ir.contact_id = c.id ORDER BY ir.created_at DESC LIMIT 1) AS dernier_body,
        EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email)=LOWER(c.email)) AS blocklistee,
        (SELECT status FROM rdv WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1) AS rdv_status
      FROM contacts c
      WHERE c.company ILIKE ${'%' + search + '%'} OR c.email ILIKE ${'%' + search + '%'}
      ORDER BY derniere_reponse DESC NULLS LAST
      LIMIT 20
    `) as Array<Record<string, unknown>>
    return NextResponse.json({ search, resultats: rows.length, rows })
  }

  const email = u.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'search= ou email= requis' }, { status: 400 })
  try {
    const c = (await sql`SELECT id, email, company FROM contacts WHERE lower(email)=lower(${email}) LIMIT 1`) as Array<Record<string, unknown>>
    if (!c[0]) return NextResponse.json({ error: 'introuvable' })
    const id = c[0].id as string
    const recv = (await sql`SELECT created_at, classification, action_taken, left(body,90) AS body FROM incoming_replies WHERE contact_id=${id} ORDER BY created_at`) as Array<Record<string, unknown>>
    const drafts = (await sql`SELECT rd.status, rd.sent_at, left(rd.body,70) AS body FROM reply_drafts rd JOIN incoming_replies ir ON ir.id=rd.incoming_reply_id WHERE ir.contact_id=${id} ORDER BY rd.created_at`) as Array<Record<string, unknown>>
    const bl = (await sql`SELECT reason, created_at FROM blocklist WHERE LOWER(email)=LOWER(${email})`) as Array<Record<string, unknown>>
    const rdvs = (await sql`SELECT status, scheduled_at, left(notes,60) AS notes FROM rdv WHERE contact_id=${id}`) as Array<Record<string, unknown>>
    return NextResponse.json({ contact: c[0], blocklist: bl, rdv: rdvs, received: recv, drafts })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
