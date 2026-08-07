import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/**
 * NETTOYAGE des lignes de file mortes (audit 02/08). Deux familles, jamais envoyées :
 *  A) FANTÔMES : step-0 'queued' alors qu'un step-0 'sent' existe déjà pour le même contact
 *     (doublons résiduels d'anciens backfills). L'anti-doublon de send-campaign les bloque à
 *     jamais — elles polluent la file et les diagnostics.
 *  B) MORTS-VIVANTS : step-0 'pending' (placeholder de génération) pour un contact < 20 avis
 *     Google — le critère client fait qu'autopilot-tick ne les promouvra JAMAIS. Ils gonflaient
 *     la réserve anti-coût de scrape-leads (44/46 côté terrassier) et freinaient le scraping.
 * Annulation (status='cancelled'), pas de suppression : trace conservée, ré-activable si le
 * critère client change un jour. ?apply=1 pour écrire, sinon aperçu.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const apply = request.nextUrl.searchParams.get('apply') === '1'

  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

    const ghosts = g(await db.execute(sql`
      SELECT eq.id FROM email_queue eq
      WHERE eq.status = 'queued' AND eq.sequence_step = 0
        AND EXISTS (SELECT 1 FROM email_queue s WHERE s.contact_id = eq.contact_id AND s.sequence_step = 0 AND s.status = 'sent')
    `)) as Array<{ id: string }>

    const deadPending = g(await db.execute(sql`
      SELECT eq.id FROM email_queue eq JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status = 'pending' AND eq.sequence_step = 0 AND eq.body = '__pending_generation__'
        AND COALESCE(c.google_reviews_count, 0) < 20
    `)) as Array<{ id: string }>

    if (apply) {
      const all = [...ghosts.map(r => r.id), ...deadPending.map(r => r.id)]
      // Par paquets (éviter une requête géante).
      for (let i = 0; i < all.length; i += 200) {
        const chunk = all.slice(i, i + 200)
        await db.execute(sql`UPDATE email_queue SET status = 'cancelled' WHERE id IN (${sql.join(chunk.map(x => sql`${x}`), sql`, `)})`)
      }
    }

    return NextResponse.json({
      ok: true, mode: apply ? 'APPLIQUÉ' : 'APERÇU',
      fantomes_step0_deja_sent: ghosts.length,
      morts_vivants_sous_20_avis: deadPending.length,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
