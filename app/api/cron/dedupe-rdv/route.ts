/**
 * GET /api/cron/dedupe-rdv
 *
 * Supprime les RDV en DOUBLE : garde le plus ancien RDV confirmé par contact, supprime les autres.
 * Corrige la double-facturation (2 RDV pour le même prospect = client facturé 2x).
 * Idempotent. Protégé par cron-auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const { sql } = await import('@/lib/db')

  // Garde 1 RDV confirmé par contact (le plus ancien), supprime les doublons.
  const deleted = (await sql`
    DELETE FROM rdv
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at ASC) AS rn
        FROM rdv
        WHERE status = 'confirmed' AND contact_id IS NOT NULL
      ) t WHERE t.rn > 1
    )
    RETURNING id, contact_id
  `) as Array<{ id: string; contact_id: string }>

  return NextResponse.json({ ok: true, supprimes: deleted.length, ids: deleted.map(d => d.id) })
}
