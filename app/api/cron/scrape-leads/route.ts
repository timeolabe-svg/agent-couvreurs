import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { isFakeEmail } from '@/lib/fake-email'
import { SECTOR_QUERIES, CITIES } from '@/lib/scrape-targets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SCRAPING EN AMONT — découplé de l'envoi et de l'audit.
// Rotation (secteur × ville) : à chaque passage on scrape UN combo, on insère les
// nouveaux contacts (audit_done=false → seront audités par audit-sites), et on met
// en file d'envoi ceux dont l'email est fiable. Léger, jamais de timeout.

const SCRAPE_MAX_RESULTS = 12
const TIME_BUDGET_MS = 45000

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
  const { eq } = await import('drizzle-orm')
  const { scrapeGooglePlaces } = await import('@/lib/scraper/google-places')

  // Campagne active (pour rattacher les email_queue)
  const [activeCampaign] = await db.select().from(campaigns).where(eq(campaigns.status, 'active')).limit(1)
  if (!activeCampaign) return NextResponse.json({ skipped: true, reason: 'aucune campagne active' })

  // Rotation combo (secteur × ville) via un compteur en base.
  const TOTAL_COMBOS = SECTOR_QUERIES.length * CITIES.length
  const [comboRow] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'scrape_combo_index'))
  const combo = (parseInt(comboRow?.value ?? '0', 10) || 0) % TOTAL_COMBOS
  const queryDef = SECTOR_QUERIES[combo % SECTOR_QUERIES.length]
  const cityIndex = Math.floor(combo / SECTOR_QUERIES.length) % CITIES.length
  const city = CITIES[cityIndex]

  // Avance l'index pour le prochain passage (round-robin sur tout le marché).
  await db.insert(agent_config)
    .values({ key: 'scrape_combo_index', value: String(combo + 1), updated_by: 'scrape-leads' })
    .onConflictDoUpdate({ target: agent_config.key, set: { value: String(combo + 1), updated_at: new Date() } })

  let rawLeads: Awaited<ReturnType<typeof scrapeGooglePlaces>> = []
  try {
    rawLeads = await scrapeGooglePlaces({ sector: queryDef.term, city, maxResults: SCRAPE_MAX_RESULTS })
  } catch (err) {
    console.error('[scrape-leads] Google Places échoué :', err)
  }


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
    combo,
    sector: queryDef.sector,
    term: queryDef.term,
    city,
    scraped: rawLeads.length,
    inserted,
    queued,
    skipped,
  })
}
