import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : taux de bounce récent + détail des contacts bounced pour trouver un motif commun. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    const global = await db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE status='sent')::int AS sent,
             COUNT(*) FILTER (WHERE status='bounced')::int AS bounced
      FROM email_queue WHERE sent_at > NOW() - INTERVAL '30 days'
    `)
    const detail = await db.execute(sql`
      SELECT c.email, c.email_confidence_score, c.email_validated, c.source, eq.sent_at, eq.sequence_step
      FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status = 'bounced' AND eq.sent_at > NOW() - INTERVAL '30 days'
      ORDER BY eq.sent_at DESC LIMIT 30
    `)
    const g = (rr: unknown) => (rr as { rows?: unknown[] }).rows ?? (rr as unknown[])
    return NextResponse.json({ ok: true, mv_active: Boolean(process.env.MILLION_VERIFIER_API_KEY), global: g(global), detail: g(detail) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
