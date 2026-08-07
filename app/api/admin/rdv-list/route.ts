import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Liste complète des RDV (hors 'proposed') avec entreprise et date — base de facturation. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    const rows = g(await db.execute(sql`
      SELECT c.company, c.email, c.sector, c.city, r.scheduled_at, r.status, r.created_at, r.ca_ht, r.signed_at
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE r.status <> 'proposed'
      ORDER BY r.scheduled_at ASC
    `))
    const parStatut = g(await db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM rdv GROUP BY status
    `))
    return NextResponse.json({ ok: true, total: rows.length, par_statut: parStatut, rdv: rows })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
