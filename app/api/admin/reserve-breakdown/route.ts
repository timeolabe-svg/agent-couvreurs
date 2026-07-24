import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 30

/** Diagnostic temporaire : répartition par secteur des leads en attente au step 0. */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')

  const rows = await db.execute(sql`
    SELECT c.sector, COUNT(*)::int AS n
    FROM email_queue q
    JOIN contacts c ON c.id = q.contact_id
    WHERE q.status = 'pending' AND q.sequence_step = 0
    GROUP BY c.sector ORDER BY 2 DESC
  `)
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])

  // Mêmes conditions que la vraie requête d'autopilot-tick (hors secteur), pour voir CE QUI
  // bloque réellement si rien n'est traité : audit, email fiable, avis, date échue.
  const eligibles = await db.execute(sql`
    SELECT c.sector,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.audit_done IS TRUE)::int AS audites,
      COUNT(*) FILTER (WHERE c.email_confidence_score >= 90 OR c.email_validated IS TRUE)::int AS email_fiable,
      COUNT(*) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20)::int AS avis_ok,
      COUNT(*) FILTER (WHERE q.scheduled_at <= now())::int AS date_echue,
      COUNT(*) FILTER (
        WHERE c.audit_done IS TRUE
          AND (c.email_confidence_score >= 90 OR c.email_validated IS TRUE)
          AND COALESCE(c.google_reviews_count,0) >= 20
          AND q.scheduled_at <= now()
      )::int AS eligibles_reels
    FROM email_queue q
    JOIN contacts c ON c.id = q.contact_id
    WHERE q.status = 'pending' AND q.sequence_step = 0
    GROUP BY c.sector ORDER BY 1
  `)
  const listEligibles = (eligibles as unknown as { rows?: unknown[] }).rows ?? (eligibles as unknown as unknown[])

  return NextResponse.json({ ok: true, repartition: list, detail_gates: listEligibles })
}
