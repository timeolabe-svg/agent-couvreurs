import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/**
 * INJECTE dans le circuit les contacts qualifiés SANS AUCUNE ligne de file (audit 02/08).
 * Trou de circuit (variante leçon 69) : validate-emails ne sélectionne que les contacts ayant
 * une ligne email_queue active → un contact sans ligne n'est JAMAIS validé, donc jamais promu,
 * donc jamais contacté, pour toujours. On crée le placeholder step-0 'pending' → il entre dans
 * la rotation validation → une fois validé, autopilot-tick le promeut normalement.
 * Périmètre : secteurs ACTIFS uniquement (la pause = pas de nouveaux contacts), ≥ 20 avis,
 * email présent, pas blocklisté. ?apply=1 pour écrire.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const apply = request.nextUrl.searchParams.get('apply') === '1'

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const { getPausedSectors } = await import('@/lib/experiments')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])
    const paused = await getPausedSectors()

    const camp = g(await db.execute(sql`SELECT id FROM campaigns WHERE status = 'active' LIMIT 1`)) as Array<{ id: string }>
    if (!camp[0]) return NextResponse.json({ ok: false, error: 'aucune campagne active' })

    const pausedFilter = paused.length > 0
      ? sql`AND (c.sector IS NULL OR c.sector NOT IN (${sql.join(paused.map(s => sql`${s}`), sql`, `)}))`
      : sql``

    const orphans = g(await db.execute(sql`
      SELECT c.id, c.email, c.sector
      FROM contacts c
      WHERE COALESCE(c.google_reviews_count,0) >= 20 AND c.email IS NOT NULL AND c.email <> ''
        AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
          OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain)))
        ${pausedFilter}
      LIMIT 200
    `)) as Array<{ id: string; email: string; sector: string | null }>

    const errors: string[] = []
    let inserted = 0
    if (apply) {
      for (const o of orphans) {
        try {
          // from_email placeholder identique à scrape-leads : remplacé par l'inbox-rotation à la promotion.
          await db.execute(sql`
            INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
            VALUES (${o.id}, ${camp[0].id}, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW())
          `)
          inserted++
        } catch (e) {
          const err = e as Error & { cause?: { message?: string; detail?: string; code?: string } }
          errors.push(`${o.email}: ${err.cause?.message ?? err.message ?? String(e)} ${err.cause?.detail ?? ''} ${err.cause?.code ?? ''}`.slice(0, 250))
          if (errors.length >= 3) break
        }
      }
    }

    const bySector: Record<string, number> = {}
    for (const o of orphans) bySector[o.sector ?? 'inconnu'] = (bySector[o.sector ?? 'inconnu'] ?? 0) + 1
    return NextResponse.json({ ok: true, mode: apply ? 'APPLIQUÉ' : 'APERÇU', total: orphans.length, inserted, errors, par_secteur: bySector })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
