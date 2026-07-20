export type AuditLevel = 'no-website' | 'abandoned' | 'very-outdated' | 'outdated' | 'modern'

export interface AuditResult {
  score: number          // 0-100
  level: AuditLevel
  hasWebsite: boolean
  cms: string | null
  ssl: boolean
  mobileOptimized: boolean
  weaknesses: string[]   // phrases concrètes sur les défauts
  totalIssues: number
}

const FAKE_SITE_PATTERNS = [
  'facebook.com', 'fb.com', 'pages.jaunesgooglemap', 'pagesjaunes.fr',
  'linktr.ee', 'linktree', 'instagram.com', 'twitter.com', 'linkedin.com',
  'yelp.com', 'tripadvisor', 'google.com/maps',
]

export function hasNoRealWebsite(website: string | null | undefined): boolean {
  if (!website) return true
  const w = website.toLowerCase()
  return FAKE_SITE_PATTERNS.some(p => w.includes(p))
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  const normalized = url.startsWith('http') ? url : `https://${url}`
  // 2 essais avec 2 User-Agents : navigateur d'abord (le plus accepté), puis Googlebot.
  // Beaucoup de sites (Cloudflare & co) renvoient 403 aux bots → sans ça, faux "site inaccessible".
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ]
  for (const ua of USER_AGENTS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(normalized, {
        signal: ctrl.signal,
        headers: { 'User-Agent': ua, 'Accept': 'text/html' },
      })
      clearTimeout(timer)
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('html')) continue
      const text = await res.text()
      // Page de "challenge" anti-bot (Cloudflare…) = PAS le vrai site → ne surtout pas
      // l'analyser comme si c'était le site du prospect (tous les checks seraient faux).
      const head = text.slice(0, 4000).toLowerCase()
      if (/just a moment|attention required|cf-browser-verification|checking your browser|enable javascript and cookies/.test(head)) continue
      return text.slice(0, 150_000)
    } catch { /* essai suivant */ }
  }
  return null
}

export async function checkSSL(url: string): Promise<boolean> {
  // RÈGLE (après l'incident 2L2P ELEC) : ne JAMAIS conclure "pas de HTTPS" sur un simple
  // timeout ou un hoquet réseau — un site lent n'est pas un site non sécurisé, et une
  // fausse accusation coûte toute la crédibilité auprès du prospect.
  //  - On tente 2 fois (5 s), pour absorber les lenteurs ponctuelles. (5 s et non 8 s : 2×8=16 s
  //    dépassait le garde-fou PER_SITE_TIMEOUT de audit-sites → la course coupait l'audit et
  //    fabriquait un faux "site abandonné". 2×5=10 s tient sous le budget par site.)
  //  - Timeout / erreur indéterminée → BÉNÉFICE DU DOUTE (true = on ne signale rien).
  //  - Seule une vraie erreur TLS/certificat ou un refus de connexion sur 443 = pas de HTTPS.
  const normalized = url.startsWith('http') ? url : `https://${url}`
  const httpsUrl = normalized.replace(/^http:\/\//, 'https://')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fetch(httpsUrl, { method: 'GET', signal: AbortSignal.timeout(5000) })
      return true // la requête HTTPS aboutit (quel que soit le code HTTP) → HTTPS supporté
    } catch (e) {
      const msg = String((e as Error)?.cause ?? e).toLowerCase()
      const isTlsFailure = /cert|tls|ssl|self.signed|unable_to_verify|altname|handshake|econnrefused/.test(msg)
      if (isTlsFailure) return false // preuve POSITIVE d'un problème HTTPS
      // timeout / DNS / réseau : indéterminé → on retente puis bénéfice du doute
    }
  }
  return true
}

function detectCMS(html: string): string | null {
  const h = html.toLowerCase()
  // Marqueurs SPÉCIFIQUES (assets/CDN) pour éviter les faux positifs : un simple lien
  // sortant vers shopify.com ne fait pas du prospect un site Shopify.
  if (h.includes('wp-content') || h.includes('wp-includes')) return 'WordPress'
  if (h.includes('wixstatic') || h.includes('static.wixstatic')) return 'Wix'
  if (h.includes('squarespace-cdn') || h.includes('static1.squarespace')) return 'Squarespace'
  if (h.includes('cdn.shopify.com') || h.includes('myshopify')) return 'Shopify'
  if (h.includes('assets.website-files.com') || h.includes('webflow.io')) return 'Webflow'
  if (h.includes('/joomla/') || h.includes('com_content')) return 'Joomla'
  if (h.includes('/_next/') || h.includes('__next_data__')) return 'Next.js'
  return null
}

function detectObsoleteTags(html: string): string[] {
  const issues: string[] = []
  const h = html.toLowerCase()
  if (/<font[\s>]/i.test(html)) issues.push('balises <font> obsolètes (HTML 3)')
  if (/<marquee/i.test(html)) issues.push('balise <marquee> obsolète')
  if (/<frameset/i.test(html)) issues.push('architecture frameset obsolète')
  if (/jquery[\s"'/]1\.[0-6]/i.test(html)) issues.push('jQuery version très ancienne (1.x)')
  if (/jquery[\s"'/]1\.(7|8|9|10|11|12)/i.test(html)) issues.push('jQuery 1.x obsolète')
  // Marqueurs RÉELS de Flash uniquement — jamais le simple mot "flash" (promo flash,
  // flash info… = faux positif garanti et accusation fausse envoyée au prospect).
  if (/\.swf["'\s)>]|application\/x-shockwave-flash|shockwave-flash|<embed[^>]+flash/i.test(html)) issues.push('contenu Flash détecté (non supporté)')
  if (/text\/javascript/.test(html) && /<script[^>]+language/i.test(html)) issues.push('attribut language= sur balises script (déprécié)')
  return issues
}

function detectMissingModern(html: string): string[] {
  const issues: string[] = []
  const h = html.toLowerCase()
  if (!h.includes('viewport')) issues.push('pas de balise viewport (site non optimisé mobile)')
  if (!/<title[^>]*>[^<]{3,}/i.test(html)) issues.push('balise <title> absente ou vide')
  if (!/meta[^>]+name=["']description["']/i.test(html)) issues.push('meta description absente (invisibilité Google)')
  if (!/meta[^>]+property=["']og:/i.test(html)) issues.push('balises Open Graph absentes (pas de prévisualisation réseaux sociaux)')
  if (!h.includes('schema.org') && !h.includes('application/ld+json')) issues.push('pas de données structurées Schema.org (manque de référencement local)')
  return issues
}

function detectSeoIssues(html: string): string[] {
  const issues: string[] = []
  if (!/<h1[\s>]/i.test(html)) issues.push('pas de balise H1 (structure SEO défaillante)')
  if ((html.match(/<h1[\s>]/gi) ?? []).length > 1) issues.push('plusieurs balises H1 (structure SEO incohérente)')
  const imgMatches = html.match(/<img[^>]+>/gi) ?? []
  const imgWithoutAlt = imgMatches.filter(img => !/alt=["'][^"']+["']/i.test(img))
  if (imgWithoutAlt.length > 0) issues.push(`${imgWithoutAlt.length} image(s) sans attribut alt`)
  if (html.length < 3000) issues.push('contenu HTML très léger (probablement peu indexé)')
  return issues
}

// Manques "marketing/conversion" — angles de vente concrets pour un artisan, même si le site est propre.
function detectMarketingGaps(html: string): string[] {
  const issues: string[] = []
  const h = html.toLowerCase()
  if (!/href=["']tel:/i.test(html)) issues.push("pas de numéro cliquable (appel en 1 clic impossible depuis un mobile)")
  if (!/<form/i.test(html) && !/href=["']mailto:/i.test(html)) issues.push("pas de formulaire ni d'email de contact (difficile de vous demander un devis en ligne)")
  if (!/gtag|google-analytics|googletagmanager|gtm\.js|plausible|matomo/i.test(h)) issues.push("aucun suivi de fréquentation (impossible de savoir d'où viennent vos visiteurs)")
  if (!/avis|témoignage|google review|★|étoile/i.test(h)) issues.push("pas d'avis clients mis en avant (rassure moins les prospects)")
  if (!/devis|estimation gratuite/i.test(h)) issues.push('aucun appel à "devis gratuit" visible (les visiteurs ne passent pas à l\'action)')
  return issues
}

function detectAbandoned(html: string, url: string): string[] {
  const issues: string[] = []
  const h = html.toLowerCase()
  const currentYear = new Date().getFullYear()
  // Copyright year check — fenêtre courte après "copyright"/"©" et année plausible
  // (sinon on capte un SIRET, un numéro de tél, une date au hasard dans le footer).
  // Gère les PLAGES "© 2018-2026" : on prend l'année la PLUS RÉCENTE de la fenêtre,
  // sinon on accuserait à tort un site à jour d'avoir 8 ans de retard.
  const copyrightWindow = html.match(/(?:copyright|©)[^0-9]{0,12}(20\d{2}(?:\s*[-–—/]\s*20\d{2})?)/i)
  if (copyrightWindow) {
    const years = (copyrightWindow[1].match(/20\d{2}/g) ?? []).map(Number).filter(y => y >= 2000 && y <= currentYear)
    const year = years.length ? Math.max(...years) : 0
    if (year && currentYear - year >= 4) {
      issues.push(`copyright ${year} (site probablement non mis à jour depuis ${currentYear - year} ans)`)
    }
  }
  if (h.includes('lorem ipsum')) issues.push('contenu Lorem Ipsum détecté (site factice ou non finalisé)')
  if (h.includes('coming soon') || h.includes('bientôt disponible') || h.includes('en construction')) issues.push('page "en construction" ou "coming soon"')
  return issues
}

export async function auditWebsite(website: string | null | undefined, _sector?: string): Promise<AuditResult> {
  if (hasNoRealWebsite(website)) {
    return { score: 0, level: 'no-website', hasWebsite: false, cms: null, ssl: false, mobileOptimized: false, weaknesses: ['aucun site web trouvé'], totalIssues: 1 }
  }

  const url = website!
  const [html, ssl] = await Promise.all([
    fetchPage(url, 5000),
    checkSSL(url),
  ])

  if (!html) {
    // INCONCLUSIF (site lent, anti-bot, erreur passagère) → on n'affirme RIEN de faux.
    // Aucune faiblesse "arme d'ouverture" : l'email retombera sur l'angle générique
    // (visibilité Google), subjectif et sans risque. JAMAIS "site inaccessible/abandonné"
    // sur un simple échec de fetch — même famille de faux positif que l'incident HTTPS 2L2P.
    return { score: 55, level: 'outdated', hasWebsite: true, cms: null, ssl, mobileOptimized: true, weaknesses: [], totalIssues: 0 }
  }

  const cms = detectCMS(html)
  const obsoleteTags = detectObsoleteTags(html)
  const missingModern = detectMissingModern(html)
  const seoIssues = detectSeoIssues(html)
  const abandonedSigns = detectAbandoned(html, url)
  const marketingGaps = detectMarketingGaps(html)
  const mobileOptimized = html.toLowerCase().includes('viewport')

  const weaknesses: string[] = [
    ...(!ssl ? ['pas de HTTPS (site affiché "non sécurisé" par Chrome)'] : []),
    ...missingModern,
    ...seoIssues,
    ...marketingGaps,
    ...obsoleteTags,
    ...abandonedSigns,
  ]

  const totalIssues = weaknesses.length
  const score = Math.max(0, 100
    - obsoleteTags.length * 4
    - missingModern.length * 5
    - seoIssues.length * 3
    - marketingGaps.length * 3
    - abandonedSigns.length * 8
    - (!ssl ? 5 : 0)
  )

  let level: AuditLevel
  if (abandonedSigns.length >= 2 || score < 25) level = 'abandoned'
  else if (score < 50) level = 'very-outdated'
  else if (score < 75) level = 'outdated'
  else level = 'modern'

  return { score, level, hasWebsite: true, cms, ssl, mobileOptimized, weaknesses, totalIssues }
}
