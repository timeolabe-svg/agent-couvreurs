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
    /**
     * ⚠️ `proposed` est EXCLU par défaut, et c'est volontaire : un créneau proposé n'est pas un
     * rendez-vous, il ne se facture pas. Mais l'exclure de la liste l'a rendu INVISIBLE — le
     * 03/09/2026, six créneaux dormaient en `proposed` sans que rien ne les montre nulle part.
     * Un créneau proposé qui n'est jamais confirmé est un prospect chaud qu'on a laissé refroidir,
     * donc `?tous=1` permet enfin de les regarder.
     */
    const tous = new URL(request.url).searchParams.get('tous') === '1'
    const rows = g(await db.execute(
      tous
        ? sql`SELECT c.company, c.email, c.sector, c.city, r.scheduled_at, r.status, r.crm_stage,
                     r.created_at, r.ca_ht, r.signed_at
              FROM rdv r JOIN contacts c ON c.id = r.contact_id
              ORDER BY r.created_at DESC`
        : sql`SELECT c.company, c.email, c.sector, c.city, r.scheduled_at, r.status, r.crm_stage,
                     r.created_at, r.ca_ht, r.signed_at
              FROM rdv r JOIN contacts c ON c.id = r.contact_id
              WHERE r.status <> 'proposed'
              ORDER BY r.scheduled_at ASC`
    ))
    const parStatut = g(await db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM rdv GROUP BY status
    `))
    return NextResponse.json({ ok: true, total: rows.length, par_statut: parStatut, rdv: rows })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
