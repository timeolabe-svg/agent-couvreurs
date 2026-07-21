import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// ONE-SHOT : deux RDV confirmés sur le MÊME créneau → on décale le plus récent vers le prochain
// créneau libre (impossible d'honorer deux appels à la même heure). ?apply=1 pour exécuter.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  const rows = (await sql`
    SELECT r.id, r.scheduled_at, r.created_at, c.company
    FROM rdv r LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'confirmed' AND r.scheduled_at > NOW()
    ORDER BY r.scheduled_at ASC, r.created_at ASC
  `) as Array<{ id: string; scheduled_at: string; created_at: string; company: string | null }>

  const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
  const availability = await getAvailability()

  const seen = new Set<number>()
  const moves: Array<{ id: string; company: string | null; de: string; vers: string }> = []
  for (const r of rows) {
    const t = new Date(r.scheduled_at); t.setSeconds(0, 0)
    if (!seen.has(t.getTime())) { seen.add(t.getTime()); continue }
    // Créneau déjà occupé → on cherche le suivant libre (en tenant compte de tout ce qu'on a vu).
    const slot = findNextAvailableSlot(t, availability, [...seen].map(ms => new Date(ms)))
    seen.add(slot.getTime())
    moves.push({ id: r.id, company: r.company, de: r.scheduled_at, vers: slot.toISOString() })
    if (apply) await sql`UPDATE rdv SET scheduled_at = ${slot.toISOString()} WHERE id = ${r.id}`
  }
  return NextResponse.json({ ok: true, applique: apply, decales: moves.length, moves })
}
