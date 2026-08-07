import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : derniers terrassiers créés + le contenu de leur step 0. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    const recent = await db.execute(sql`
      SELECT c.id, c.email, c.company, c.created_at, eq.sequence_step, eq.status, eq.subject, eq.body, eq.scheduled_at
      FROM contacts c
      LEFT JOIN email_queue eq ON eq.contact_id = c.id AND eq.sequence_step = 0
      WHERE c.sector = 'terrassier'
      ORDER BY c.created_at DESC
      LIMIT 5
    `)
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    return NextResponse.json({ ok: true, recent: g(recent) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
