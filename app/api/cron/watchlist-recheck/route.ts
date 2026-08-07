import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * WATCHLIST-RECHECK — détecte les prospects qui FRANCHISSENT le seuil des 20 avis Google.
 *
 * Pourquoi : le critère client (≥20 avis) écarte 80% du marché À UN INSTANT T. Mais un
 * terrassier à 18 avis en aura 20 dans quelques mois : sans re-vérification, il serait écarté
 * À VIE alors qu'il devient une cible valide (demande Timéo 03/08).
 *
 * Économie : on ne re-vérifie QUE les leads qui peuvent franchir bientôt (≥ MIN_REVIEWS_WATCH),
 * par ROTATION (le moins récemment vérifié d'abord, leçon 71 : jamais un tri qui bloque toujours
 * sur les mêmes) et dans le budget Places quotidien PARTAGÉ avec scrape-leads (compteur
 * places_calls_today) : ce cron ne peut pas faire déraper la facture.
 *
 * Place Details ne demande que user_ratings_total + website : le strict nécessaire.
 * Un lead qui atteint le seuil repasse en 'new' → l'importeur (import-outscraper?process=1)
 * scrape son email et l'injecte dans le pipeline normal.
 *
 * À brancher sur cron-job.org 1×/jour.
 */

const MIN_REVIEWS_WATCH = 8      // en dessous, aucune chance de franchir 20 avant longtemps
const MAX_CHECKS_PER_RUN = 15    // ~0,33 €/run au pire
const RECHECK_MIN_DAYS = 20      // ne pas re-vérifier le même lead plus d'1× / 20 jours
const DAILY_PLACES_REQ_CAP = 120 // MÊME plafond que scrape-leads (budget commun, non cumulatif)

/** ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48) : jamais de 500 muet, toujours le motif réel. */
export async function GET(req: Request) {
  try {
    const res = await runCron(req)
    // (l'intervalle attendu est déclaré côté heartbeat-check, table EXPECTED)
    await pingHeartbeat('watchlist-recheck', res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[watchlist-recheck]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat('watchlist-recheck', false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({ ok: false, error: String(e.message ?? err).slice(0, 300), cause: e.cause?.message?.slice(0, 200), code: e.code }, { status: 500 })
  }
}

async function runCron(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY manquante' }, { status: 500 })
  if (process.env.SCRAPING_PAUSED === '1') return NextResponse.json({ ok: true, scraping_paused: true })

  const started = Date.now()
  try {
    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')
    const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

    // Colonne de rotation (idempotent).
    await db.execute(sql`ALTER TABLE outscraper_leads ADD COLUMN IF NOT EXISTS last_reviews_check_at TIMESTAMPTZ`)

    const todayKey = new Date().toISOString().slice(0, 10)

    // Candidats : en attente, assez d'avis pour espérer franchir, pas vérifiés récemment.
    // Tri par dernière vérification (jamais vérifié d'abord) PUIS par avis décroissants :
    // rotation équitable + priorité aux plus proches du seuil.
    const candidats = g(await db.execute(sql`
      SELECT place_id, name, reviews, city
      FROM outscraper_leads
      WHERE status = 'skipped_lowreviews'
        AND reviews >= ${MIN_REVIEWS_WATCH}
        AND site IS NOT NULL
        AND (last_reviews_check_at IS NULL OR last_reviews_check_at < NOW() - (${RECHECK_MIN_DAYS} || ' days')::interval)
      ORDER BY last_reviews_check_at ASC NULLS FIRST, reviews DESC
      LIMIT ${MAX_CHECKS_PER_RUN}
    `)) as Array<{ place_id: string; name: string; reviews: number; city: string | null }>

    if (candidats.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'aucun lead à re-vérifier (tous récents ou trop loin du seuil)' })
    }

    // RÉSERVATION ATOMIQUE du budget Places, partagée avec scrape-leads (même clé de compteur).
    const reserveRes = await db.execute(sql`
      INSERT INTO agent_config (key, value, updated_at)
      VALUES ('places_calls_today', ${JSON.stringify({ date: todayKey, count: candidats.length })}, now())
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN (agent_config.value::jsonb->>'date') = ${todayKey}
            THEN jsonb_build_object('date', ${todayKey}::text, 'count', ((agent_config.value::jsonb->>'count')::int + ${candidats.length}::int))::text
          ELSE jsonb_build_object('date', ${todayKey}::text, 'count', ${candidats.length}::int)::text
        END,
        updated_at = now()
      RETURNING value
    `)
    const rrows = g(reserveRes) as Array<{ value: string }>
    let placesToday = 0
    try { placesToday = JSON.parse(rrows[0]?.value ?? '{}').count ?? 0 } catch { /* ignore */ }
    if (placesToday > DAILY_PLACES_REQ_CAP) {
      return NextResponse.json({ ok: true, skipped: true, reason: `budget Places du jour épuisé (${placesToday}/${DAILY_PLACES_REQ_CAP}) — partagé avec le scraping` })
    }

    let verifies = 0, promus = 0, erreurs = 0
    const results: string[] = []

    for (const c of candidats) {
      if (Date.now() - started > 45000) break
      try {
        // Champs STRICTEMENT nécessaires : le nombre d'avis (le critère) + le site (requis à l'import).
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(c.place_id)}&fields=user_ratings_total,website&key=${apiKey}`
        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!resp.ok) { erreurs++; continue }
        const data = await resp.json() as { status?: string; result?: { user_ratings_total?: number; website?: string } }
        if (data.status !== 'OK' || !data.result) {
          // Fiche supprimée/fusionnée côté Google : on horodate quand même pour ne pas boucler dessus.
          await db.execute(sql`UPDATE outscraper_leads SET last_reviews_check_at = NOW() WHERE place_id = ${c.place_id}`)
          erreurs++
          continue
        }
        const avis = data.result.user_ratings_total ?? 0
        const site = data.result.website ?? null
        verifies++

        if (avis >= 20 && site) {
          // FRANCHISSEMENT → repasse en file de traitement : l'importeur scrapera son email.
          await db.execute(sql`
            UPDATE outscraper_leads
            SET reviews = ${avis}, site = COALESCE(${site}, site), status = 'new', last_reviews_check_at = NOW()
            WHERE place_id = ${c.place_id}
          `)
          promus++
          results.push(`🎯 ${c.name} : ${c.reviews} → ${avis} avis (promu)`)
        } else {
          await db.execute(sql`
            UPDATE outscraper_leads
            SET reviews = ${avis}, site = COALESCE(${site}, site), last_reviews_check_at = NOW()
            WHERE place_id = ${c.place_id}
          `)
          if (avis !== c.reviews) results.push(`· ${c.name} : ${c.reviews} → ${avis} avis`)
        }
      } catch { erreurs++ }
    }

    return NextResponse.json({ ok: true, verifies, promus, erreurs, budget_places_jour: placesToday, results })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 })
  }
}
