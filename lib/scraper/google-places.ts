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
  emailConfidence: number // 0-100 : 90 = mailto explicite, 70 = préfixe pro, 40 = deviné
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

function isJunkEmail(email: string): boolean {
  const lm = email.toLowerCase()
  return (
    lm.includes('.png') || lm.includes('.jpg') || lm.includes('.jpeg') ||
    lm.includes('.svg') || lm.includes('.gif') || lm.includes('.webp') ||
    lm.includes('.css') || lm.includes('.js') ||
    lm.includes('@sentry') || lm.includes('@example') || lm.includes('@yourdomain') ||
    lm.includes('@domain') || lm.includes('@email') || lm.includes('@sentry.io') ||
    lm.includes('noreply') || lm.includes('no-reply') || lm.includes('wixpress') ||
    lm.includes('.wix') || lm.includes('godaddy') || lm.includes('@2x') ||
    lm.endsWith('.webp') || /@[\d.]+$/.test(lm)
  )
}

// Retourne l'email + un score de confiance (0-100).
// 90 = mailto: explicite (l'entreprise a publié son email comme lien cliquable)
// 70 = préfixe pro reconnu (contact@, devis@...) sur le domaine du site
// 40 = email deviné par regex générique (peu fiable)
export async function scrapeEmailFromWebsite(
  websiteUrl: string
): Promise<{ email: string; confidence: number } | null> {
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
    })
    clearTimeout(timeoutId)

    if (!resp.ok) return null

    const html = await resp.text()

    // Domaine du site (pour vérifier que l'email est bien sur leur domaine)
    let siteDomain = ''
    try {
      siteDomain = new URL(url).hostname.replace(/^www\./, '')
    } catch { /* ignore */ }

    // 1. mailto: explicite — le plus fiable
    const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i)
    if (mailtoMatch && !isJunkEmail(mailtoMatch[1])) {
      const email = mailtoMatch[1].toLowerCase()
      // mailto sur le domaine du site = quasi certain (95), sinon 90
      const onDomain = siteDomain && email.endsWith('@' + siteDomain)
      return { email, confidence: onDomain ? 95 : 90 }
    }

    // 2. Préfixe pro reconnu
    const proPattern = /(?:contact|info|devis|bonjour|hello|accueil|pro|estimation|commercial|direction|mail|courrier|secretariat|entreprise)@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi
    const proMatches = html.match(proPattern)
    if (proMatches) {
      const valid = proMatches.map(m => m.toLowerCase()).filter(m => !isJunkEmail(m))
      if (valid.length > 0) {
        const onDomain = siteDomain && valid.find(e => e.endsWith('@' + siteDomain))
        const chosen = onDomain || valid[0]
        // préfixe pro sur leur domaine = 75, sinon 60
        return { email: chosen, confidence: onDomain ? 75 : 60 }
      }
    }

    // 3. Email générique deviné — peu fiable
    const genericPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
    const genericMatches = html.match(genericPattern)
    if (genericMatches) {
      const valid = genericMatches.map(m => m.toLowerCase()).filter(m => !isJunkEmail(m))
      // garder seulement ceux sur le domaine du site (un peu plus sûr)
      const onDomain = siteDomain ? valid.find(e => e.endsWith('@' + siteDomain)) : null
      if (onDomain) return { email: onDomain, confidence: 55 }
      if (valid.length > 0) return { email: valid[0], confidence: 40 }
    }
  } catch {
    // Silently fail — website scraping is best-effort
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function scrapeGooglePlaces(params: {
  sector: string
  city: string
  radius?: number
  maxResults?: number
  maxPages?: number     // pagination Google (1 page = ~20 résultats)
  deadlineMs?: number   // budget temps max (évite les timeouts cron 30s)
  /** Avis Google minimum (lu GRATUITEMENT dans le Text Search) : en dessous, on ne paie NI le
   *  Place Details NI le scrape email — le critère client (≥20 avis) l'écartera de toute façon. */
  minReviews?: number
  /** Filtre de dédup AVANT paiement : reçoit les place_ids du Text Search, renvoie ceux DÉJÀ en
   *  base — exclus avant tout appel Place Details. Avant ce filtre, on payait un Details (+ scrape
   *  email web) pour chaque doublon re-croisé par les combos ville/terme (audit 03/08 : la grande
   *  majorité des requêtes payées partaient dans des doublons, d'où ~10 nouveaux/jour à peine). */
  excludeKnownIds?: (placeIds: string[]) => Promise<Set<string>>
}): Promise<PlaceLead[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured')
  }

  const startedAt = Date.now()
  // 1 page par défaut (pas de pagination = pas de sleep 2.1s) + budget temps 14s
  const { sector, city, radius = 20000, maxResults = 15, maxPages = 1, deadlineMs = 7000, minReviews = 0, excludeKnownIds } = params

  // Step 1: Text Search avec pagination (capter un max de couvreurs par ville)
  const query = encodeURIComponent(`${sector} ${city}`)
  const allResults: GoogleTextSearchResult[] = []
  let nextPageToken: string | undefined

  for (let page = 0; page < maxPages; page++) {
    let textSearchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&radius=${radius}&key=${apiKey}`
    if (nextPageToken) {
      // Google exige un court délai avant que le token soit valide
      await sleep(2100)
      textSearchUrl += `&pagetoken=${nextPageToken}`
    }

    const textSearchResp = await fetch(textSearchUrl)
    if (!textSearchResp.ok) {
      throw new Error(`Google Places Text Search failed: ${textSearchResp.status}`)
    }

    const textSearchData = (await textSearchResp.json()) as GoogleTextSearchResponse & { next_page_token?: string }
    if (textSearchData.status !== 'OK' && textSearchData.status !== 'ZERO_RESULTS') {
      // INVALID_REQUEST sur token pas encore prêt — on s'arrête proprement
      if (page > 0) break
      throw new Error(`Google Places API error: ${textSearchData.status} — ${textSearchData.error_message ?? ''}`)
    }

    allResults.push(...textSearchData.results)
    nextPageToken = textSearchData.next_page_token
    // On ne s'arrête plus sur le compte BRUT : une page est payée entière de toute façon, et les
    // filtres ci-dessous (avis/doublons) vont en écarter une partie — maxResults plafonne les
    // Details payés, maxPages plafonne les Text Search payés.
    if (!nextPageToken) break
  }

  // ── FILTRES AVANT PAIEMENT (audit 03/08) — le Text Search donne GRATUITEMENT place_id et
  // user_ratings_total : on écarte ici les < minReviews avis ET les doublons déjà en base, AVANT
  // de payer le moindre Place Details. Avant, chaque doublon re-croisé coûtait 1 Details + un
  // scrape email web pour être jeté à l'INSERT → rendement par euro divisé par 3-5.
  let candidates = allResults
  if (minReviews > 0) {
    candidates = candidates.filter(p => (p.user_ratings_total ?? 0) >= minReviews)
  }
  if (excludeKnownIds && candidates.length > 0) {
    try {
      const known = await excludeKnownIds(candidates.map(p => p.place_id))
      candidates = candidates.filter(p => !known.has(p.place_id))
    } catch { /* filtre indisponible → on continue sans (comportement historique) */ }
  }
  const results = candidates.slice(0, maxResults)

  // Step 2: Place Details for each result
  const leads: PlaceLead[] = []

  for (const place of results) {
    // Budget temps : on arrête proprement pour ne jamais dépasser le timeout cron
    if (Date.now() - startedAt > deadlineMs) break
    try {
      // ⚠️ COÛT (03/08) : on ne demande QUE website + téléphone (bucket "Contact Data"). Les
      // autres champs (nom, adresse, note, nb d'avis) sont DÉJÀ fournis GRATUITEMENT par le Text
      // Search — les redemander ici facturait en plus le bucket "Atmosphere" (~20% du Details
      // pour rien). L'email, lui, ne coûte RIEN à Google : on le scrape nous-mêmes sur le site.
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website&key=${apiKey}`
      const detailsResp = await fetch(detailsUrl)

      if (!detailsResp.ok) continue

      const detailsData = (await detailsResp.json()) as GooglePlaceDetailsResponse
      if (detailsData.status !== 'OK') continue

      const details = detailsData.result
      const { city: extractedCity, postalCode } = extractCityAndPostalCode(place.formatted_address)

      // Step 3: Try to scrape email from website (avec score de confiance)
      let email: string | null = null
      let emailConfidence = 0
      if (details.website) {
        const result = await scrapeEmailFromWebsite(details.website)
        if (result) {
          email = result.email
          emailConfidence = result.confidence
        }
      }

      leads.push({
        googlePlaceId: place.place_id,
        // Nom/adresse/note/avis : depuis le Text Search (gratuits), plus depuis le Details (payant).
        name: place.name,
        address: place.formatted_address,
        city: extractedCity,
        postalCode,
        phone: details.formatted_phone_number ?? null,
        website: details.website ?? null,
        rating: place.rating ?? null,
        reviewsCount: place.user_ratings_total ?? null,
        sector,
        email,
        emailConfidence,
        directorName: null, // Would require more complex scraping
        description: null,  // Could be AI-generated later
      })
    } catch {
      // Skip failed places silently
    }
  }

  return leads
}
