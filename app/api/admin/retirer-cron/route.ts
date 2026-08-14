import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * METTRE UN CRON « À LA RETRAITE » — sans effacer son historique.
 *
 * ⚠️ POURQUOI CET OUTIL. Le garde-fou C5 (« aucun cron vital n'est muet ») compare le dernier
 * passage à `expected_interval_minutes`. Quand on décide volontairement d'ARRÊTER un cron, cet
 * intervalle reste inscrit en base : l'alerte crie alors tous les jours, pour un arrêt voulu.
 *
 * Et une alerte qui crie tous les jours pour rien est pire qu'une absence d'alerte : on cesse de
 * la lire, et le jour où un cron VITAL tombe, personne ne le voit. C'est exactement ce qui est
 * arrivé à l'alerte « linkedin-bot MUET » côté LabegarIA.
 *
 * On efface donc l'INTERVALLE ATTENDU, pas la ligne : le battement garde la trace du dernier
 * passage et de l'historique, mais ne déclenche plus rien. Si le cron est un jour relancé, il
 * réinscrira son intervalle tout seul au premier passage.
 *
 * GET ?nom=watchlist-recheck            → aperçu
 * GET ?nom=watchlist-recheck&apply=1    → applique
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const nom = (req.nextUrl.searchParams.get('nom') ?? '').trim()
  if (!nom) return NextResponse.json({ error: 'paramètre ?nom= requis' }, { status: 400 })
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  const { sql } = await import('@/lib/db')
  const avant = (await sql`
    SELECT cron_name, last_run_at, expected_interval_minutes
    FROM cron_heartbeats WHERE cron_name = ${nom}
  `) as Array<{ cron_name: string; last_run_at: string | null; expected_interval_minutes: number | null }>

  if (!avant.length) return NextResponse.json({ ok: false, error: `aucun battement pour « ${nom} »` }, { status: 404 })

  if (!apply) {
    return NextResponse.json({
      ok: true, mode: 'aperçu', cron: avant[0],
      effet: 'L\'intervalle attendu sera effacé : plus d\'alerte « muet », l\'historique reste. Relancer avec &apply=1.',
    })
  }

  await sql`UPDATE cron_heartbeats SET expected_interval_minutes = NULL WHERE cron_name = ${nom}`
  return NextResponse.json({
    ok: true, mode: 'appliqué', cron: nom,
    note: 'Alerte désactivée. Si ce cron est relancé un jour, il réinscrira son intervalle au premier passage.',
  })
}

export const GET = wrapCron('retirer-cron', handler)
