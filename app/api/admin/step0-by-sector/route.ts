import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic : step-0 envoyés par secteur et par jour (7 derniers jours) — pureté du ciblage. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    const rows = g(await db.execute(sql`
      SELECT eq.sent_at::date AS jour, c.sector, COUNT(*)::int AS n
      FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status = 'sent' AND eq.sequence_step = 0 AND eq.sent_at > NOW() - INTERVAL '7 days'
      GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC
    `))
    return NextResponse.json({ ok: true, step0_par_jour_secteur: rows })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
