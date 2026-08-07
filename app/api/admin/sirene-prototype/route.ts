import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { scrapeEmailFromWebsite } from '@/lib/scraper/google-places'

export const maxDuration = 60

/**
 * PROTOTYPE SIRENE (03/08) — circuit d'acquisition GRATUIT, en test isolé.
 * Objectif : mesurer combien d'emails on peut obtenir SANS payer Google Places, via :
 *   1. recherche-entreprises.api.gouv.fr (base SIRENE officielle, GRATUITE) — tous les
 *      terrassiers de France (NAF 43.12A/B), par département.
 *   2. Découverte du site web SANS Google : recherche DuckDuckGo (gratuit) + vérification
 *      que la page correspond bien à l'entreprise (tokens du nom présents), sinon essai des
 *      domaines devinés (slug.fr / slug.com).
 *   3. Scrape email sur le site (notre scraper existant, gratuit).
 * ISOLÉ : table à part (sirene_prospects), ne touche NI contacts NI email_queue — aucun envoi.
 * Le critère "≥20 avis Google" n'est PAS vérifié ici (c'est l'étape payante qu'on ferait EN
 * DERNIER, uniquement pour les contacts qui ont déjà un email — décision à valider ensuite).
 *
 * Usage : ?dept=31&batch=5 (traite 5 entreprises), répété jusqu'à un échantillon suffisant.
 * ?stats=1 → juste le funnel cumulé.
 */

const JUNK_DOMAINS = [
  'pagesjaunes', 'societe.com', 'verif.com', 'pappers', 'infogreffe', 'annuaire',
  'facebook', 'instagram', 'linkedin', 'twitter', 'youtube', 'tiktok',
  'mappy', 'yelp', 'trustpilot', 'houzz', 'travaux.com', 'homly', 'habitatpresto',
  'wikipedia', 'leboncoin', 'gouv.fr', 'duckduckgo', 'kompass', 'manageo',
  'score3', 'bilansgratuits', 'rubypayeur', 'entreprises.lefigaro', 'lentreprise',
  'dnb.com', 'fr.kompass', 'aef.cci', 'charpente.com', 'plus.codes', 'google.',
]

function normalizeTokens(name: string): string[] {
  return name.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !['sarl', 'sas', 'sasu', 'eurl', 'entreprise', 'societe', 'ets', 'les', 'des', 'travaux', 'terrassement'].includes(t))
}

async function fetchWithTimeout(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers } })
    clearTimeout(t)
    return r
  } catch { return null }
}

/** La page appartient-elle vraisemblablement à l'entreprise ? (≥1 token distinctif du nom présent) */
async function pageMatchesCompany(url: string, tokens: string[]): Promise<boolean> {
  if (tokens.length === 0) return false
  const r = await fetchWithTimeout(url, 4000)
  if (!r || !r.ok) return false
  const html = (await r.text().catch(() => '')).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  return tokens.some(t => html.includes(t))
}

/** Découverte du site : DuckDuckGo HTML (gratuit) puis domaines devinés. */
async function findWebsite(name: string, city: string): Promise<{ website: string; method: string } | null> {
  const tokens = normalizeTokens(name)

  // 1) DuckDuckGo HTML (pas d'API key). On prend le 1er résultat non-annuaire dont la page
  //    contient bien le nom de l'entreprise (anti "mauvais site → mauvais email").
  const q = encodeURIComponent(`"${name}" ${city}`)
  const ddg = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${q}`, 6000)
  if (ddg?.ok) {
    const html = await ddg.text().catch(() => '')
    // liens résultats : uddg=<url encodée>
    const links = [...html.matchAll(/uddg=([^&"]+)/g)].map(m => { try { return decodeURIComponent(m[1]) } catch { return '' } })
    const seen = new Set<string>()
    for (const link of links) {
      if (!link.startsWith('http')) continue
      let host = ''
      try { host = new URL(link).hostname.replace(/^www\./, '') } catch { continue }
      if (!host || seen.has(host)) continue
      seen.add(host)
      if (JUNK_DOMAINS.some(j => host.includes(j))) continue
      const root = `https://${host}`
      if (await pageMatchesCompany(root, tokens)) return { website: root, method: 'ddg' }
      if (seen.size >= 4) break // au plus 4 candidats testés (budget temps)
    }
  }

  // 2) Domaines devinés à partir du nom (slug.fr / slug.com).
  // ⚠️ Garde-fou faux positif (constaté au 1er run : belmonte.com validé pour "SARL BELMONTE"
  // alors que rien ne prouve que c'est SON site — un nom de famille seul matche n'importe quel
  // site homonyme dans le monde). Un domaine DEVINÉ n'est accepté QUE si la page contient AUSSI
  // la ville OU un marqueur métier français — sinon on préfère rendre "pas de site" qu'un
  // mauvais site (leçon 39 : jamais écrire à la mauvaise entreprise).
  const slug = tokens.join('-')
  if (slug.length >= 5) {
    const metierMarkers = ['terrassement', 'terrassier', 'travaux publics', 'vrd', 'assainissement', 'demolition', 'démolition', 'btp', 'chantier']
    const strictCheck = async (url: string): Promise<boolean> => {
      const r = await fetchWithTimeout(url, 4000)
      if (!r || !r.ok) return false
      const html = (await r.text().catch(() => '')).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      const nameOk = tokens.some(t => html.includes(t))
      const cityOk = city ? html.includes(city.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')) : false
      const metierOk = metierMarkers.some(m => html.includes(m))
      return nameOk && (cityOk || metierOk)
    }
    for (const dom of [`https://www.${slug}.fr`, `https://${slug}.fr`, `https://www.${slug}.com`]) {
      if (await strictCheck(dom)) return { website: dom, method: 'guess' }
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sirene_prospects (
      siren TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      naf TEXT,
      city TEXT,
      dept TEXT,
      website TEXT,
      website_method TEXT,
      email TEXT,
      email_confidence INT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `)

  const funnel = async () => {
    const rows = g(await db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM sirene_prospects GROUP BY status
    `)) as Array<{ status: string; n: number }>
    const emails = g(await db.execute(sql`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE email_confidence >= 60)::int AS fiables
      FROM sirene_prospects WHERE email IS NOT NULL
    `)) as Array<{ n: number; fiables: number }>
    return { par_statut: Object.fromEntries(rows.map(r => [r.status, r.n])), emails_trouves: emails[0]?.n ?? 0, emails_fiables: emails[0]?.fiables ?? 0 }
  }

  if (request.nextUrl.searchParams.get('stats') === '1') {
    const methods = g(await db.execute(sql`
      SELECT website_method, COUNT(*)::int AS n FROM sirene_prospects WHERE website IS NOT NULL GROUP BY website_method
    `))
    return NextResponse.json({ ok: true, funnel: await funnel(), methodes_site: methods })
  }

  // Debug : DuckDuckGo répond-il depuis les IPs Vercel ? (403/captcha datacenter fréquent)
  if (request.nextUrl.searchParams.get('ddgtest') === '1') {
    const r = await fetchWithTimeout('https://html.duckduckgo.com/html/?q=terrassement+toulouse', 8000)
    const body = r ? await r.text().catch(() => '') : ''
    return NextResponse.json({
      ok: true, http: r?.status ?? 'timeout', longueur: body.length,
      liens_uddg: (body.match(/uddg=/g) || []).length,
      extrait: body.slice(0, 200),
    })
  }

  const dept = request.nextUrl.searchParams.get('dept') || '31'
  const batch = Math.min(parseInt(request.nextUrl.searchParams.get('batch') || '5'), 8)

  // ── Phase A : recharger le stock depuis SIRENE si besoin (GRATUIT) ──
  const [stock] = g(await db.execute(sql`SELECT COUNT(*)::int AS n FROM sirene_prospects WHERE status = 'new' AND dept = ${dept}`)) as Array<{ n: number }>
  let fetched = 0
  if ((stock?.n ?? 0) < batch) {
    for (const naf of ['43.12A', '43.12B']) {
      const [pg] = g(await db.execute(sql`
        SELECT COALESCE(MAX((naf_page)::int), 0) + 1 AS next FROM (
          SELECT (regexp_match(status, 'page:(\\d+)'))[1] AS naf_page FROM sirene_prospects WHERE dept = ${dept} AND naf = ${naf} AND status LIKE 'meta%'
        ) x
      `)) as Array<{ next: number }>
      const page = pg?.next ?? 1
      const r = await fetchWithTimeout(`https://recherche-entreprises.api.gouv.fr/search?activite_principale=${naf}&departement=${dept}&etat_administratif=A&per_page=25&page=${page}`, 8000)
      if (!r?.ok) continue
      const data = await r.json().catch(() => null) as { results?: Array<{ siren: string; nom_complet: string; siege?: { libelle_commune?: string; commune?: string } }> } | null
      for (const e of data?.results ?? []) {
        if (!e.siren || !e.nom_complet) continue
        try {
          await db.execute(sql`
            INSERT INTO sirene_prospects (siren, name, naf, city, dept)
            VALUES (${e.siren}, ${e.nom_complet}, ${naf}, ${e.siege?.libelle_commune ?? ''}, ${dept})
            ON CONFLICT (siren) DO NOTHING
          `)
          fetched++
        } catch { /* doublon */ }
      }
      // marqueur de pagination (ligne meta, jamais traitée)
      await db.execute(sql`
        INSERT INTO sirene_prospects (siren, name, naf, dept, status)
        VALUES (${`meta-${naf}-${dept}-${page}`}, 'meta', ${naf}, ${dept}, ${`meta page:${page}`})
        ON CONFLICT (siren) DO NOTHING
      `)
    }
  }

  // ── Phase B : traiter un lot (site → email), budget temps strict ──
  const todo = g(await db.execute(sql`
    SELECT siren, name, city FROM sirene_prospects
    WHERE status = 'new' AND dept = ${dept} ORDER BY created_at ASC LIMIT ${batch}
  `)) as Array<{ siren: string; name: string; city: string }>

  const results: string[] = []
  for (const c of todo) {
    if (Date.now() - started > 45000) break
    try {
      const site = await findWebsite(c.name, c.city || '')
      if (!site) {
        await db.execute(sql`UPDATE sirene_prospects SET status = 'no_website', processed_at = NOW() WHERE siren = ${c.siren}`)
        results.push(`∅ site: ${c.name}`)
        continue
      }
      const em = await scrapeEmailFromWebsite(site.website)
      if (em?.email) {
        await db.execute(sql`UPDATE sirene_prospects SET status = 'ok', website = ${site.website}, website_method = ${site.method}, email = ${em.email}, email_confidence = ${em.confidence}, processed_at = NOW() WHERE siren = ${c.siren}`)
        results.push(`✓ ${c.name} → ${em.email} (conf ${em.confidence}, ${site.method})`)
      } else {
        await db.execute(sql`UPDATE sirene_prospects SET status = 'no_email', website = ${site.website}, website_method = ${site.method}, processed_at = NOW() WHERE siren = ${c.siren}`)
        results.push(`∅ email: ${c.name} (site: ${site.website})`)
      }
    } catch (e) {
      results.push(`✗ ${c.name}: ${String(e).slice(0, 60)}`)
    }
  }

  return NextResponse.json({ ok: true, dept, sirene_charges: fetched, traites: results.length, results, funnel: await funnel() })
}
