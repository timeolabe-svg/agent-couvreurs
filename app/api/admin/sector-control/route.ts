import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 30

/**
 * PILOTAGE DES SECTEURS — pause et priorité.
 *
 * Deux leviers distincts, à ne pas confondre :
 *  - `paused`  : secteurs EXCLUS du tirage (aucun nouveau contact scrapé, aucune nouvelle
 *    séquence step 0 démarrée). Un secteur en pause n'affecte PAS les relances déjà engagées
 *    (steps ≥ 1) ni les réponses des prospects : l'invariant "zéro lead perdu" continue.
 *  - `weights` : poids d'exploration (exp_sector_weights) parmi les secteurs NON en pause.
 *    weightedPick garde un plancher (MIN_WEIGHT) : un poids à 0 ne suffit PAS à exclure un
 *    secteur, seule la pause le fait. Les weights servent à PRIORISER (ex: "on passe sur les
 *    terrassiers"), pas à interdire.
 *
 * GET  ?key=<CRON_SECRET>                         état actuel (secteurs en pause + poids)
 * POST ?key=<CRON_SECRET>
 *      { paused?: string[], weights?: Record<string, number>, apply: true }
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { getPausedSectors, getWeights, WEIGHTS_KEYS } = await import('@/lib/experiments')
  const { SECTORS } = await import('@/lib/scrape-targets')

  const paused = await getPausedSectors()
  const weights = await getWeights(WEIGHTS_KEYS.sector)

  return NextResponse.json({
    ok: true,
    secteurs_disponibles: SECTORS,
    secteurs_en_pause: paused,
    secteurs_actifs: SECTORS.filter(s => !paused.includes(s)),
    poids_actuels: weights,
  })
}

export async function POST(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const { setPausedSectors, setWeights, getWeights, WEIGHTS_KEYS } = await import('@/lib/experiments')
    const { SECTORS } = await import('@/lib/scrape-targets')

    if (body.apply !== true) {
      return NextResponse.json({ ok: false, error: 'ajouter apply:true' }, { status: 400 })
    }

    const resultats: string[] = []

    if (Array.isArray(body.paused)) {
      const inconnus = body.paused.filter((s: string) => !SECTORS.includes(s))
      if (inconnus.length > 0) {
        return NextResponse.json({ ok: false, error: `secteur(s) inconnu(s) : ${inconnus.join(', ')}`, secteurs_disponibles: SECTORS }, { status: 400 })
      }
      await setPausedSectors(body.paused, 'admin_sector_control')
      resultats.push(`secteurs en pause : ${body.paused.length > 0 ? body.paused.join(', ') : '(aucun)'}`)
    }

    if (body.weights && typeof body.weights === 'object') {
      const current = await getWeights(WEIGHTS_KEYS.sector)
      const merged = { ...current, ...body.weights }
      await setWeights(WEIGHTS_KEYS.sector, merged, 'admin_sector_control')
      resultats.push(`poids mis à jour : ${JSON.stringify(body.weights)}`)
    }

    return NextResponse.json({ ok: true, resultats })
  } catch (err) {
    console.error('[admin/sector-control]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
