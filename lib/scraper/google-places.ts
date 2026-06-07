// Scrape businesses by sector + city using Google Places API
// Returns enriched lead data

export interface PlaceLead {
  googlePlaceId: string
  name: string
  address: string
  city: string
  postalCode: string
  phone: string | null
  website: string | null
  rating: number | null
  reviewsCount: number | null
  sector: string
  // Scraped from website if available:
  email: string | null
  directorName: string | null
  description: string | null
}

interface GoogleTextSearchResult {
  place_id: string
  name: string
  formatted_address: string
  rating?: number
  user_ratings_total?: number
}

interface GoogleTextSearchResponse {
  results: GoogleTextSearchResult[]
  status: string
  error_message?: string
}

interface GooglePlaceDetailsResult {
  place_id: string
  name: string
  formatted_address: string
  formatted_phone_number?: string
  website?: string
  rating?: number
  user_ratings_total?: number
}

interface GooglePlaceDetailsResponse {
  result: GooglePlaceDetailsResult
  status: string
  error_message?: string
}

function extractCityAndPostalCode(address: string): { city: string; postalCode: string } {
  // French address format: "Street, 12345 City, Country"
  const postalMatch = address.match(/(\d{5})\s+([^,]+)/)
  if (postalMatch) {
    return {
      postalCode: postalMatch[1],
      city: postalMatch[2].trim(),
    }
  }
  // Fallback: try to get last meaningful part before "France"
  const parts = address.split(',').map(p => p.trim()).filter(p => p !== 'France')
  return {
    postalCode: '',
    city: parts[parts.length - 1] ?? '',
  }
}

async function scrapeEmailFromWebsite(websiteUrl: string): Promise<string | null> {
  try {
    // Normalize URL
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
    })
    clearTimeout(timeoutId)

    if (!resp.ok) return null

    const html = await resp.text()

    // Look for mailto: links
    const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    if (mailtoMatch) return mailtoMatch[1].toLowerCase()

    // Common patterns: contact@, info@, devis@, bonjour@, hello@
    const emailPatterns = [
      /(?:contact|info|devis|bonjour|hello|accueil|pro|admin|estimation|preventif|preventif|commercial|direction|contact|mail|adresse|courrier)@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi,
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    ]

    for (const pattern of emailPatterns) {
      const matches = html.match(pattern)
      if (matches && matches.length > 0) {
        // Filter out common non-email patterns
        const filtered = matches.filter(m => {
          const lm = m.toLowerCase()
          return (
            !lm.includes('.png') &&
            !lm.includes('.jpg') &&
            !lm.includes('.svg') &&
            !lm.includes('.css') &&
            !lm.includes('@sentry') &&
            !lm.includes('@example') &&
            !lm.includes('@yourdomain') &&
            !lm.includes('noreply') &&
            !lm.includes('no-reply')
          )
        })
        if (filtered.length > 0) return filtered[0].toLowerCase()
      }
    }
  } catch {
    // Silently fail — website scraping is best-effort
  }
  return null
}

export async function scrapeGooglePlaces(params: {
  sector: string
  city: string
  radius?: number
  maxResults?: number
}): Promise<PlaceLead[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured')
  }

  const { sector, city, radius = 20000, maxResults = 20 } = params

  // Step 1: Text Search
  const query = encodeURIComponent(`${sector} ${city}`)
  const textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&radius=${radius}&key=${apiKey}`

  const textSearchResp = await fetch(textSearchUrl)
  if (!textSearchResp.ok) {
    throw new Error(`Google Places Text Search failed: ${textSearchResp.status}`)
  }

  const textSearchData = (await textSearchResp.json()) as GoogleTextSearchResponse
  if (textSearchData.status !== 'OK' && textSearchData.status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places API error: ${textSearchData.status} — ${textSearchData.error_message ?? ''}`)
  }

  const results = textSearchData.results.slice(0, maxResults)

  // Step 2: Place Details for each result
  const leads: PlaceLead[] = []

  for (const place of results) {
    try {
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total&key=${apiKey}`
      const detailsResp = await fetch(detailsUrl)

      if (!detailsResp.ok) continue

      const detailsData = (await detailsResp.json()) as GooglePlaceDetailsResponse
      if (detailsData.status !== 'OK') continue

      const details = detailsData.result
      const { city: extractedCity, postalCode } = extractCityAndPostalCode(details.formatted_address)

      // Step 3: Try to scrape email from website
      let email: string | null = null
      if (details.website) {
        email = await scrapeEmailFromWebsite(details.website)
      }

      leads.push({
        googlePlaceId: place.place_id,
        name: details.name,
        address: details.formatted_address,
        city: extractedCity,
        postalCode,
        phone: details.formatted_phone_number ?? null,
        website: details.website ?? null,
        rating: details.rating ?? null,
        reviewsCount: details.user_ratings_total ?? null,
        sector,
        email,
        directorName: null, // Would require more complex scraping
        description: null,  // Could be AI-generated later
      })
    } catch {
      // Skip failed places silently
    }
  }

  return leads
}
