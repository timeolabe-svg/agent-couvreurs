import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : contacts ayant reçu >1 mail le même jour, DEPUIS un instant donné. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const since = request.nextUrl.searchParams.get('since') || '2026-07-28 12:05:00'

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT c.email, eq.sent_at::date AS jour, COUNT(*)::int AS n, array_agg(eq.sequence_step ORDER BY eq.sent_at) AS steps, array_agg(eq.sent_at ORDER BY eq.sent_at) AS heures
      FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status = 'sent' AND eq.sent_at > ${since}::timestamp
      GROUP BY c.email, eq.sent_at::date
      HAVING COUNT(*) > 1
    `)
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    return NextResponse.json({ ok: true, since, clusters: g(rows) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
