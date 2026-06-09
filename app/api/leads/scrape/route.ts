import { NextRequest, NextResponse } from 'next/server'
import { scrapeGooglePlaces } from '@/lib/scraper/google-places'
import { validateEmail } from '@/lib/scraper/email-validator'

function isAuthorized(request: NextRequest): boolean {
  // Check CRON_SECRET (used by Vercel cron jobs)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader === `Bearer ${cronSecret}`) return true
  }
  // Check x-api-key header as admin auth fallback
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && apiKey === process.env.ADMIN_API_KEY) return true
  // Check NEXT_PUBLIC_SCRAPE_TOKEN for browser requests
  const scrapeToken = process.env.NEXT_PUBLIC_SCRAPE_TOKEN
  if (scrapeToken) {
    const tokenHeader = request.headers.get('x-scrape-token')
    if (tokenHeader === scrapeToken) return true
  }
  // In development, allow all
  if (process.env.NODE_ENV === 'development') return true
  // If no auth is configured at all, allow browser requests (scraping Google Places is not sensitive)
  if (!process.env.CRON_SECRET && !process.env.ADMIN_API_KEY && !process.env.NEXT_PUBLIC_SCRAPE_TOKEN) return true
  return false
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured', scraped: 0, inserted: 0, skipped: 0, leads: [] },
      { status: 200 },
    )
  }

  let body: { sector: string; city: string; radius?: number; campaignId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sector, city, radius, campaignId } = body
  if (!sector || !city) {
    return NextResponse.json({ error: 'sector and city are required' }, { status: 400 })
  }

  // Dynamic import to avoid crashing when DB is not configured at module level
  const { db } = await import('@/lib/db')
  const { contacts, blocklist } = await import('@/lib/db/schema')
  const { eq, or, inArray } = await import('drizzle-orm')

  let leads
  try {
    leads = await scrapeGooglePlaces({ sector, city, radius })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scraping failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  let inserted = 0
  let skipped = 0

  for (const lead of leads) {
    try {
      // Skip leads without email (nothing to send to)
      if (!lead.email) {
        skipped++
        continue
      }

      // Check blocklist
      const blocked = await db
        .select()
        .from(blocklist)
        .where(
          or(
            eq(blocklist.email, lead.email),
            eq(blocklist.domain, lead.email.split('@')[1]),
          ),
        )
        .limit(1)

      if (blocked.length > 0) {
        skipped++
        continue
      }

      // Check duplicates
      const existing = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.email, lead.email))
        .limit(1)

      if (existing.length > 0) {
        skipped++
        continue
      }

      // Validate email
      const validation = await validateEmail(lead.email)
      if (!validation.isValid) {
        skipped++
        continue
      }

      // Insert
      await db.insert(contacts).values({
        email: validation.fixedEmail ?? lead.email,
        name: lead.directorName,
        company: lead.name,
        website: lead.website,
        phone: lead.phone,
        sector: lead.sector,
        city: lead.city,
        postal_code: lead.postalCode,
        google_place_id: lead.googlePlaceId,
        google_rating: lead.rating,
        google_reviews_count: lead.reviewsCount,
        description: lead.description,
        director_name: lead.directorName,
        email_confidence_score: validation.confidence,
        email_validated: validation.confidence >= 70,
        source: 'google_places',
      })

      inserted++
    } catch (err) {
      // Skip individual failures
      skipped++
    }
  }

  // Optionally link to campaign if campaignId was provided
  // (would need email_queue inserts — left for campaign management module)
  void campaignId

  return NextResponse.json({
    scraped: leads.length,
    inserted,
    skipped,
    leads,
  })
}
