import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/**
 * Répare les RDV marqués 'confirmed' à tort par l'ancien bug (carte blanche avec urgence non
 * honorée qui confirmait silencieusement un créneau jamais réellement accepté). Signature
 * fiable : notes = texte de la version PROPOSÉE d'origine, mais status déjà passé à 'confirmed'
 * SANS que les notes n'aient été mises à jour (l'UPDATE bugué ne touchait que status).
 * ?apply=1 pour écrire, sinon aperçu seul.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const apply = request.nextUrl.searchParams.get('apply') === '1'

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    const suspects = await db.execute(sql`
      SELECT r.id, r.contact_id, r.scheduled_at, r.status, r.notes, c.email, c.company
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE r.status = 'confirmed' AND r.notes ILIKE '%en attente de confirmation%'
    `)
    const g = (rr: unknown) => (rr as { rows?: unknown[] }).rows ?? (rr as unknown[])
    const rows = g(suspects) as Array<{ id: string; email: string; company: string; scheduled_at: string }>

    if (apply && rows.length > 0) {
      const ids = rows.map(r => r.id)
      await db.execute(sql`UPDATE rdv SET status = 'proposed' WHERE id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`)
    }

    return NextResponse.json({ ok: true, mode: apply ? 'APPLIQUÉ' : 'APERÇU', trouves: rows.length, rows })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
