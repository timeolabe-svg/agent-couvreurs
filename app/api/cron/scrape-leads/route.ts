import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { isFakeEmail } from '@/lib/fake-email'
import { SECTOR_QUERIES, SECTORS, REGIONS, CITIES_BY_REGION } from '@/lib/scrape-targets'
import { WEIGHTS_KEYS, weightedPick, getWeights } from '@/lib/experiments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SCRAPING EN AMONT — découplé de l'envoi et de l'audit.
// Rotation (secteur × ville) : à chaque passage on scrape UN combo, on insère les
// nouveaux contacts (audit_done=false → seront audités par audit-sites), et on met
// en file d'envoi ceux dont l'email est fiable. Léger, jamais de timeout.

const SCRAPE_MAX_RESULTS = 12
const TIME_BUDGET_MS = 45000

// ─── FREINS COÛT GOOGLE PLACES (API payante ~0,03-0,04 €/recherche) ───
// Ne JAMAIS payer pour scraper alors qu'on a déjà des leads en réserve.
const SCRAPE_PIPELINE_THRESHOLD = 100 // ne scrape QUE s'il reste < 100 leads frais en attente
const DAILY_PLACES_CAP = 30           // plafond DUR d'appels Places / jour (protège la facture)
const SCRAPE_MIN_INTERVAL_MIN = 30    // throttle : au plus 1 scrape / 30 min

export async function GET(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY manquante' }, { status: 500 })
  }

  const started = Date.now()
  const { db } = await import('@/lib/db')
  const { contacts, campaigns, email_queue, blocklist, agent_config } = await import('@/lib/db/schema')
  const { eq, and, sql } = await import('drizzle-orm')
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
  const [reserveRow] = await db.select({ n: sql<number>`count(*)::int` }).from(email_queue)
    .where(and(eq(email_queue.campaign_id, activeCampaign.id), eq(email_queue.status, 'pending'), eq(email_queue.sequence_step, 0)))
  const reserve = Number(reserveRow?.n ?? 0)
  if (reserve >= SCRAPE_PIPELINE_THRESHOLD) {
    return NextResponse.json({ ok: true, skipped: true, reason: `réserve pleine (${reserve} leads ≥ ${SCRAPE_PIPELINE_THRESHOLD}) — économie API`, reserve })
  }
  // 3) Plafond DUR journalier d'appels Places.
  const [capRow] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'places_calls_today'))
  let placesToday = 0
  try { const p = capRow?.value ? JSON.parse(capRow.value) : null; if (p?.date === todayKey) placesToday = p.count ?? 0 } catch { /* défaut 0 */ }
  if (placesToday >= DAILY_PLACES_CAP) {
    return NextResponse.json({ ok: true, skipped: true, reason: `plafond Places atteint (${placesToday}/${DAILY_PLACES_CAP})` })
  }
  // 4) Throttle : au plus 1 scrape / SCRAPE_MIN_INTERVAL_MIN.
  const [lastRow] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'last_scrape_at'))
  if (lastRow?.value) {
    const ageMin = (now.getTime() - new Date(lastRow.value).getTime()) / 60000
    if (ageMin >= 0 && ageMin < SCRAPE_MIN_INTERVAL_MIN) {
      return NextResponse.json({ ok: true, skipped: true, reason: `throttle (${ageMin.toFixed(0)}/${SCRAPE_MIN_INTERVAL_MIN} min)` })
    }
  }

  // SÉLECTION PONDÉRÉE (auto-apprentissage) : l'agent scrape davantage les secteurs
  // et régions qui répondent le mieux, tout en continuant d'explorer les autres
  // (plancher de poids). Puis terme + ville tirés au hasard dans le secteur/région choisis.
  const sectorWeights = await getWeights(WEIGHTS_KEYS.sector)
  const regionWeights = await getWeights(WEIGHTS_KEYS.region)
  const sector = weightedPick(SECTORS, sectorWeights)
  const region = weightedPick(REGIONS, regionWeights)
  const termsForSector = SECTOR_QUERIES.filter(q => q.sector === sector)
  const queryDef = termsForSector[Math.floor(Math.random() * termsForSector.length)] ?? SECTOR_QUERIES[0]
  const citiesInRegion = CITIES_BY_REGION[region] ?? []
  const city = citiesInRegion[Math.floor(Math.random() * citiesInRegion.length)] ?? 'Paris'

  let rawLeads: Awaited<ReturnType<typeof scrapeGooglePlaces>> = []
  try {
    rawLeads = await scrapeGooglePlaces({ sector: queryDef.term, city, maxResults: SCRAPE_MAX_RESULTS })
  } catch (err) {
    console.error('[scrape-leads] Google Places échoué :', err)
  }

  // Un appel Places a été consommé → compte (plafond/jour) + horodate (throttle).
  placesToday++
  const placesVal = JSON.stringify({ date: todayKey, count: placesToday })
  await db.insert(agent_config).values({ key: 'places_calls_today', value: placesVal })
    .onConflictDoUpdate({ target: agent_config.key, set: { value: placesVal, updated_at: new Date() } })
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

  return NextResponse.json({
    sector: queryDef.sector,
    term: queryDef.term,
    region,
    city,
    scraped: rawLeads.length,
    inserted,
    queued,
    skipped,
  })
}
