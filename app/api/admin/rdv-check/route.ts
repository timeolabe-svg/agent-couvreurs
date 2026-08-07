import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : lignes rdv pour un contact (email). */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = request.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'missing ?email=' }, { status: 400 })

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute(sql`
      SELECT r.id, r.contact_id, r.scheduled_at, r.status, r.duration_min, r.notes, r.created_at
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE LOWER(c.email) = LOWER(${email})
      ORDER BY r.created_at DESC
    `)
    const g = (rr: unknown) => (rr as { rows?: unknown[] }).rows ?? (rr as unknown[])
    return NextResponse.json({ ok: true, rdv: g(rows) })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
