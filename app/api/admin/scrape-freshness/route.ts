import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 30

/** Diagnostic : dernière date de scraping réel + fraîcheur des contacts par secteur. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')

  const lastScrape = await db.execute(sql`
    SELECT value, updated_at FROM agent_config WHERE key = 'last_scrape_at'
  `)
  const placesCalls = await db.execute(sql`
    SELECT value, updated_at FROM agent_config WHERE key = 'places_calls_today'
  `)
  const combo = await db.execute(sql`
    SELECT value, updated_at FROM agent_config WHERE key = 'scrape_combo_index'
  `)
  const freshness = await db.execute(sql`
    SELECT sector, MAX(created_at) AS plus_recent, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '18 days')::int AS depuis_18j
    FROM contacts GROUP BY sector ORDER BY 2 DESC
  `)

  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
  return NextResponse.json({
    ok: true,
    last_scrape_at: g(lastScrape),
    places_calls_today: g(placesCalls),
    scrape_combo_index: g(combo),
    fraicheur_par_secteur: g(freshness),
  })
}
