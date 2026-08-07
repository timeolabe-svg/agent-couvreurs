import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import { isFakeEmail } from '@/lib/fake-email'
import { SECTOR_QUERIES, SECTORS, REGIONS, CITIES_BY_REGION } from '@/lib/scrape-targets'
import { WEIGHTS_KEYS, weightedPick, getWeights, getPausedSectors } from '@/lib/experiments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SCRAPING EN AMONT — découplé de l'envoi et de l'audit.
// Rotation (secteur × ville) : à chaque passage on scrape UN combo, on insère les
// nouveaux contacts (audit_done=false → seront audités par audit-sites), et on met
// en file d'envoi ceux dont l'email est fiable. Léger, jamais de timeout.

// ⚠️ 03/08 : le palier agressif (400 req/jour ≈ 12-16 €/jour) a été ANNULÉ par Timéo dans
// l'heure ("impossible pour moi de payer aussi cher, stop") — retour au budget historique
// 120 req/jour (≈ 3-5 €/jour max). On GARDE en revanche le fix de rendement (filtres
// avis+doublons AVANT de payer les Place Details, cf. scrapeGooglePlaces) : lui fait
// ÉCONOMISER — chaque requête payée n'achète plus que des candidats neufs et qualifiés.
// Ne remonter le plafond QU'avec un accord explicite de Timéo sur le coût chiffré.
const SCRAPE_MAX_RESULTS = 12  // Details payés max par run (tous des candidats NEUFS ≥20 avis)
const SCRAPE_MAX_PAGES = 2     // Text Search paginé (2 pages = jusqu'à 40 résultats bruts, 2 req)
// ⚠️ 20s et non 45s : la contrainte réelle est la coupe DURE de cron-job.org à 30s, pas le
// maxDuration Vercel (60s). À 45s, un run qui allait au bout était compté « Échec » côté
// ordonnanceur alors que Vercel finissait le travail — même bug que audit-sites (06/08).
const TIME_BUDGET_MS = 20000

// ─── FREINS COÛT GOOGLE PLACES (API payante ~0,03-0,04 €/requête) ───
// Ne JAMAIS payer pour scraper alors qu'on a déjà des leads en réserve.
const SCRAPE_PIPELINE_THRESHOLD = 100 // ne scrape QUE s'il reste < 100 leads promouvables en attente
const SCRAPE_MIN_INTERVAL_MIN = 30    // throttle : au plus 1 scrape / 30 min
// IMPORTANT : un run = SCRAPE_MAX_PAGES Text Search + jusqu'à SCRAPE_MAX_RESULTS Place Details =
// ~14 requêtes FACTURÉES au pire. On réserve le VRAI volume, le plafond compte des REQUÊTES.
const PLACES_REQ_PER_RUN = SCRAPE_MAX_RESULTS + SCRAPE_MAX_PAGES // pire cas d'un run
const DAILY_PLACES_REQ_CAP = 120  // plafond DUR : ≈ 3-5 €/jour MAX, budget validé par Timéo

/** ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48) : jamais de 500 muet, toujours le motif réel. */
export async function GET(req: Request) {
  try {
    const res = await runCron(req)
    await pingHeartbeat("scrape-leads", res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[scrape-leads]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat("scrape-leads", false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({ ok: false, error: String(e.message ?? err).slice(0, 300), cause: e.cause?.message?.slice(0, 200), code: e.code }, { status: 500 })
  }
}
async function runCron(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY manquante' }, { status: 500 })
  }

  const started = Date.now()
  try {
  const { db } = await import('@/lib/db')
  const { contacts, campaigns, email_queue, blocklist, agent_config } = await import('@/lib/db/schema')
  const { eq, and, sql, notInArray, isNull, or, gte, inArray } = await import('drizzle-orm')
  const { scrapeGooglePlaces } = await import('@/lib/scraper/google-places')

  // Campagne active (pour rattacher les email_queue)
  const [activeCampaign] = await db.select().from(campaigns).where(eq(campaigns.status, 'active')).limit(1)
  if (!activeCampaign) return NextResponse.json({ skipped: true, reason: 'aucune campagne active' })

  // ─── FREINS COÛT GOOGLE PLACES ──────────────────────────────────────────
  const now = new Date()
  const todayKey = now.toISOString().slice(0, 10)

  // 1) Kill-switch manuel : SCRAPING_PAUSED=1 → zéro appel Places.
  if (process.env.SCRAPING_PAUSED === '1') {
    return NextResponse.json({ ok: true, scraping_paused: true })
  }
  // 2) Réserve suffisante : leads frais en attente (pending step 0). >= seuil → pas de scraping.
  // ⚠️ INCIDENT 2026-07-27 : cette réserve comptait TOUS les secteurs, y compris ceux mis en
  // pause. Un secteur en pause n'est plus jamais promu par autopilot-tick (cf. lib/experiments.ts)
  // → ses leads 'pending' restent coincés pour toujours et gonflent la réserve indéfiniment,
  // bloquant le scraping du secteur qu'on vient précisément de prioriser. On ne compte donc que
  // les leads des secteurs ACTIFS (OR isNull : même piège NULL que dans autopilot-tick, un
  // contact sans secteur classé ne doit jamais être exclu par erreur).
  const pausedSectors = await getPausedSectors()
  // ⚠️ AUDIT 02/08 : ne compter que les leads PROMOUVABLES. 44/46 pending terrassier avaient
  // < 20 avis Google (critère client : jamais promus par autopilot-tick) — des morts-vivants qui
  // occupaient la moitié du seuil de 100 en permanence et freinaient le scraping de VRAIS leads.
  // Même logique que la promotion : ≥ 20 avis, et rotation MV pas épuisée (mv_attempts < 5).
  const [reserveRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(and(
      eq(email_queue.campaign_id, activeCampaign.id),
      eq(email_queue.status, 'pending'),
      eq(email_queue.sequence_step, 0),
      gte(contacts.google_reviews_count, 20),
      or(isNull(contacts.mv_attempts), sql`${contacts.mv_attempts} < 5`)!,
      ...(pausedSectors.length > 0 ? [or(isNull(contacts.sector), notInArray(contacts.sector, pausedSectors))!] : []),
    ))
  // ?force=1 : saute les freins de CONFORT (réserve pleine, throttle) pour tester ou débloquer
  // manuellement. Le plafond DUR de requêtes Places du jour (garde-fou COÛT) reste actif : le
  // forçage ne peut jamais faire déraper la facture.
  const force = new URL(req.url).searchParams.get('force') === '1'
  const reserve = Number(reserveRow?.n ?? 0)
  if (!force && reserve >= SCRAPE_PIPELINE_THRESHOLD) {
    return NextResponse.json({ ok: true, skipped: true, reason: `réserve pleine (${reserve} leads actifs ≥ ${SCRAPE_PIPELINE_THRESHOLD}) — économie API`, reserve })
  }
  // 3) Throttle : au plus 1 scrape / SCRAPE_MIN_INTERVAL_MIN (évite de consommer un crédit pour rien).
  const [lastRow] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'last_scrape_at'))
  if (!force && lastRow?.value) {
    const ageMin = (now.getTime() - new Date(lastRow.value).getTime()) / 60000
    if (ageMin >= 0 && ageMin < SCRAPE_MIN_INTERVAL_MIN) {
      return NextResponse.json({ ok: true, skipped: true, reason: `throttle (${ageMin.toFixed(0)}/${SCRAPE_MIN_INTERVAL_MIN} min)` })
    }
  }
  // 4) Plafond DUR journalier — RÉSERVE ATOMIQUE d'un crédit AVANT l'appel Places.
  //    Un seul UPDATE incrémente ET retourne le compteur → deux runs concurrents ne peuvent
  //    PAS dépasser le plafond (contrairement à un lire-puis-écrire non atomique).
  const reserveRes = await db.execute(sql`
    INSERT INTO agent_config (key, value, updated_at)
    VALUES ('places_calls_today', ${JSON.stringify({ date: todayKey, count: PLACES_REQ_PER_RUN })}, now())
    ON CONFLICT (key) DO UPDATE SET
      value = CASE
        WHEN (agent_config.value::jsonb->>'date') = ${todayKey}
          THEN jsonb_build_object('date', ${todayKey}::text, 'count', ((agent_config.value::jsonb->>'count')::int + ${PLACES_REQ_PER_RUN}))::text
        ELSE jsonb_build_object('date', ${todayKey}::text, 'count', ${PLACES_REQ_PER_RUN}::int)::text
      END,
      updated_at = now()
    RETURNING (value::jsonb->>'count')::int AS count
  `)
  const rrows = (Array.isArray(reserveRes) ? reserveRes : (reserveRes as unknown as { rows?: Array<{ count?: number }> }).rows) ?? []
  const placesToday = Number(rrows[0]?.count ?? 999)
  if (placesToday > DAILY_PLACES_REQ_CAP) {
    return NextResponse.json({ ok: true, skipped: true, reason: `plafond requêtes Places atteint (${placesToday}/${DAILY_PLACES_REQ_CAP})` })
  }

  const results: string[] = []
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

  // SÉLECTION PONDÉRÉE (auto-apprentissage) : l'agent scrape davantage les secteurs
  // et régions qui répondent le mieux, tout en continuant d'explorer les autres
  // (plancher de poids). Puis terme + ville tirés au hasard dans le secteur/région choisis.
  const sectorWeights = await getWeights(WEIGHTS_KEYS.sector)
  const regionWeights = await getWeights(WEIGHTS_KEYS.region)
  // Secteurs en PAUSE (ex: "mets en pause les couvreurs") : retirés du tirage, pas juste
  // sous-pondérés — un poids à 0 ne suffit pas, weightedPick garde un plancher d'exploration.
  const activeSectors = SECTORS.filter(s => !pausedSectors.includes(s))
  const sector = weightedPick(activeSectors.length > 0 ? activeSectors : SECTORS, sectorWeights)
  const region = weightedPick(REGIONS, regionWeights)
  const termsForSector = SECTOR_QUERIES.filter(q => q.sector === sector)
  const citiesInRegion = CITIES_BY_REGION[region] ?? []

  // ⚠️ COUVERTURE (04/08) : terme et ville étaient tirés AU HASARD → sur 206 villes × ~30 termes,
  // le hasard repasse constamment sur les mêmes combos déjà épuisés pendant que des zones
  // entières ne sont jamais visitées. Résultat : on paie des recherches qui ne ramènent que des
  // entreprises déjà en base (le stock de nouveaux leads stagne). On mémorise donc chaque combo
  // (secteur, terme, ville) avec sa date de dernier passage et son rendement, et on choisit
  // TOUJOURS le combo jamais fait — sinon le plus ancien, en écartant ceux déjà épuisés
  // (0 nouveau lead au dernier passage ET revisité récemment). Même principe que la rotation de
  // la leçon 71 : un tri qui garantit que tout le territoire finit par être couvert.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scrape_combos (
      sector TEXT NOT NULL,
      term TEXT NOT NULL,
      city TEXT NOT NULL,
      last_scraped_at TIMESTAMPTZ,
      times_scraped INT NOT NULL DEFAULT 0,
      last_new_leads INT,
      total_new_leads INT NOT NULL DEFAULT 0,
      PRIMARY KEY (sector, term, city)
    )
  `)

  let queryDef = termsForSector[Math.floor(Math.random() * termsForSector.length)] ?? SECTOR_QUERIES[0]
  let city = citiesInRegion[Math.floor(Math.random() * citiesInRegion.length)] ?? 'Paris'

  if (termsForSector.length > 0 && citiesInRegion.length > 0) {
    // Tous les combos possibles pour ce (secteur, région) — puis on retire ceux déjà connus pour
    // trouver un combo VIERGE en priorité.
    const combosPossibles: Array<{ term: string; city: string }> = []
    for (const t of termsForSector) for (const c of citiesInRegion) combosPossibles.push({ term: t.term, city: c })

    const connus = g(await db.execute(sql`
      SELECT term, city, last_scraped_at, last_new_leads
      FROM scrape_combos WHERE sector = ${sector}
    `)) as Array<{ term: string; city: string; last_scraped_at: string | null; last_new_leads: number | null }>
    const clefsConnues = new Set(connus.map(c => `${c.term}|${c.city}`))

    const vierges = combosPossibles.filter(c => !clefsConnues.has(`${c.term}|${c.city}`))
    if (vierges.length > 0) {
      // Priorité absolue : une zone jamais explorée (100% de chances de trouver du nouveau).
      const choisi = vierges[Math.floor(Math.random() * vierges.length)]
      queryDef = { term: choisi.term, sector }
      city = choisi.city
      results.push(`combo VIERGE (${vierges.length} restants sur ${combosPossibles.length})`)
    } else {
      // Tout est déjà exploré : on reprend le plus ancien, en écartant les combos épuisés
      // (dernier passage sans aucun nouveau lead et revu il y a moins de 30 jours).
      const candidats = connus
        .filter(c => !(c.last_new_leads === 0 && c.last_scraped_at && Date.now() - new Date(c.last_scraped_at).getTime() < 30 * 86400000))
        .sort((a, b) => new Date(a.last_scraped_at ?? 0).getTime() - new Date(b.last_scraped_at ?? 0).getTime())
      const choisi = candidats[0] ?? connus[0]
      if (choisi) {
        queryDef = { term: choisi.term, sector }
        city = choisi.city
        results.push(`combo recyclé (le plus ancien, ${candidats.length} non épuisés)`)
      }
    }
  }

  let rawLeads: Awaited<ReturnType<typeof scrapeGooglePlaces>> = []
  try {
    rawLeads = await scrapeGooglePlaces({
      sector: queryDef.term, city,
      maxResults: SCRAPE_MAX_RESULTS,
      maxPages: SCRAPE_MAX_PAGES,
      deadlineMs: 20000,
      // RENDEMENT (audit 03/08) : filtres AVANT paiement — on ne paie un Place Details ni pour
      // un < 20 avis (critère client, gratuit dans le Text Search) ni pour un doublon déjà en base.
      minReviews: 20,
      excludeKnownIds: async (placeIds: string[]) => {
        const rows = await db.select({ id: contacts.google_place_id })
          .from(contacts)
          .where(inArray(contacts.google_place_id, placeIds))
        return new Set(rows.map(r => r.id).filter((x): x is string => Boolean(x)))
      },
    })
  } catch (err) {
    console.error('[scrape-leads] Google Places échoué :', err)
  }

  // Crédit Places déjà réservé atomiquement en amont. On ne fait qu'horodater le scrape (throttle).
  await db.insert(agent_config).values({ key: 'last_scrape_at', value: now.toISOString() })
    .onConflictDoUpdate({ target: agent_config.key, set: { value: now.toISOString(), updated_at: new Date() } })


  // Emails présents, confiance minimale, pas de fausse adresse.
  const leadsWithEmail = rawLeads
    .filter(l => l.email && l.email.includes('@') && l.emailConfidence >= 40 && !isFakeEmail(l.email))
    .sort((a, b) => {
      const s = (l: typeof a) => (l.website ? 0 : 30) + Math.max(0, 20 - (l.reviewsCount ?? 20))
      return s(b) - s(a) // meilleures cibles (sans site, peu d'avis) d'abord
    })

  let inserted = 0
  let queued = 0
  let skipped = 0

  for (const lead of leadsWithEmail) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const email = lead.email!.toLowerCase()
    try {
      // Jamais recontacter un opt-out.
      const [b] = await db.select({ id: blocklist.id }).from(blocklist).where(eq(blocklist.email, email)).limit(1)
      if (b) { skipped++; continue }

      // Insert contact (audit_done=false → audité plus tard par audit-sites).
      const [ins] = await db.insert(contacts).values({
        email,
        company: lead.name,
        city: lead.city || city,
        postal_code: lead.postalCode || null,
        phone: lead.phone,
        website: lead.website,
        sector: queryDef.sector,
        google_place_id: lead.googlePlaceId,
        google_rating: lead.rating,
        google_reviews_count: lead.reviewsCount,
        source: 'google_places',
        email_validated: false,
        email_confidence_score: lead.emailConfidence,
        audit_done: false,
      }).onConflictDoNothing().returning({ id: contacts.id })

      if (!ins) { skipped++; continue } // déjà en base → pas de recontact
      inserted++

      // On ne met en file que les emails PLAUSIBLES (confiance >= 70 : mailto publié
      // ou préfixe pro). La VALIDATION réelle est faite en amont par validate-emails
      // (MillionVerifier), et l'envoi ne partira QU'aux contacts email_validated=true.
      // Les emails trop incertains restent en base (stock), jamais mis en file.
      if (lead.emailConfidence < 70) continue

      // File d'envoi : partira une fois le contact validé (MV) ET audité.
      await db.insert(email_queue).values({
        contact_id: ins.id,
        campaign_id: activeCampaign.id,
        sequence_step: 0,
        from_email: 'pending@hdigiweb.fr', // remplacé par inbox-rotation à l'envoi
        subject: '__pending_generation__',
        body: '__pending_generation__',
        status: 'pending',
        scheduled_at: new Date(),
      })
      queued++
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('duplicate') && !msg.includes('unique')) {
        console.error('[scrape-leads] Erreur import lead :', email, err)
      }
    }
  }

  // MÉMORISATION DU COMBO : date de passage + rendement réel. C'est ce qui permet à la rotation
  // de savoir quelles zones sont vierges, lesquelles sont épuisées (0 nouveau) et lesquelles
  // méritent d'être revisitées plus tard.
  await db.execute(sql`
    INSERT INTO scrape_combos (sector, term, city, last_scraped_at, times_scraped, last_new_leads, total_new_leads)
    VALUES (${queryDef.sector}, ${queryDef.term}, ${city}, NOW(), 1, ${inserted}, ${inserted})
    ON CONFLICT (sector, term, city) DO UPDATE SET
      last_scraped_at = NOW(),
      times_scraped = scrape_combos.times_scraped + 1,
      last_new_leads = ${inserted},
      total_new_leads = scrape_combos.total_new_leads + ${inserted}
  `).catch(() => {})

  return NextResponse.json({
    sector: queryDef.sector,
    term: queryDef.term,
    region,
    city,
    scraped: rawLeads.length,
    inserted,
    queued,
    skipped,
    rotation: results,
  })
  } catch (err) {
    // Plus jamais de 500 muet : sans ce filet, un échec silencieux ressemble à "aucun résultat"
    // et se debug à l'aveugle depuis cron-job.org (cf. leçon 48 du skill).
    console.error('[scrape-leads] erreur', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    return NextResponse.json({
      error: String(e?.message ?? err).slice(-800),
      cause: e?.cause?.message,
      code: e?.code,
    }, { status: 500 })
  }
}
