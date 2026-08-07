import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : timeline complète email_queue pour un contact (email). */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = request.nextUrl.searchParams.get('email')
  const company = request.nextUrl.searchParams.get('company')
  if (!email && !company) return NextResponse.json({ error: 'missing ?email= or ?company=' }, { status: 400 })

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    const contact = email
      ? g(await db.execute(sql`SELECT id, sector, email, company, created_at, email_validated FROM contacts WHERE LOWER(email) = LOWER(${email})`))
      : g(await db.execute(sql`SELECT id, sector, email, company, created_at, email_validated FROM contacts WHERE company ILIKE ${'%' + company + '%'} OR website ILIKE ${'%' + company + '%'} LIMIT 5`))
    const ids = (contact as Array<{ id: string }>).map(c => c.id)
    const queue = ids.length > 0
      ? g(await db.execute(sql`
          SELECT eq.id, eq.contact_id, eq.sequence_step, eq.status, eq.scheduled_at, eq.sent_at, eq.created_at, eq.from_email
          FROM email_queue eq
          WHERE eq.contact_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
          ORDER BY eq.contact_id, eq.sequence_step ASC
        `))
      : []
    return NextResponse.json({ ok: true, contact, queue })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined }, { status: 500 })
  }
}
