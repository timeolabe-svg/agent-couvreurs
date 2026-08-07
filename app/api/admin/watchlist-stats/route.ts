import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Distribution des avis dans la liste d'attente (leads < 20 avis) : combien sont proches du seuil. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

    const dist = g(await db.execute(sql`
      SELECT
        CASE
          WHEN reviews >= 15 THEN '15-19 (proche du seuil)'
          WHEN reviews >= 10 THEN '10-14'
          WHEN reviews >= 5  THEN '5-9'
          WHEN reviews >= 1  THEN '1-4'
          ELSE '0 avis'
        END AS tranche,
        COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE site IS NOT NULL)::int AS avec_site
      FROM outscraper_leads
      WHERE status = 'skipped_lowreviews'
      GROUP BY 1 ORDER BY MIN(reviews) DESC
    `))

    const total = g(await db.execute(sql`
      SELECT COUNT(*)::int AS attente,
             COUNT(*) FILTER (WHERE reviews >= 15)::int AS proches_seuil,
             COUNT(*) FILTER (WHERE site IS NOT NULL)::int AS avec_site
      FROM outscraper_leads WHERE status = 'skipped_lowreviews'
    `))

    return NextResponse.json({ ok: true, total: total[0], distribution: dist })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
