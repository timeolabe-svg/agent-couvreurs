import { NextRequest, NextResponse } from 'next/server'
import { stripEmojis } from '@/lib/utils'
import { checkCronAuth } from '@/lib/cron-auth'
import { scrapeEmailFromWebsite } from '@/lib/scraper/google-places'
import { isFakeEmail } from '@/lib/fake-email'

export const maxDuration = 60

/**
 * IMPORT OUTSCRAPER (03/08) — nouvelle source de leads à ~0 coût récurrent.
 * Un export Google Maps en masse (Outscraper, ~3-5 €/1000 fiches, quota gratuit au début)
 * remplace le scraping Places au goutte-à-goutte : site web + nb d'avis inclus dans la fiche.
 *
 * Deux phases :
 *  POST {rows:[...]}          → charge le CSV (normalisé côté client) dans la table tampon
 *                               outscraper_leads. Dédup place_id + marquage des déjà-en-base.
 *  GET  ?process=1&batch=8    → traite un lot : scrape email GRATUIT sur le site → si email,
 *                               insère le contact + placeholder step-0 'pending' → il entre dans
 *                               la rotation validate-emails → autopilot promeut → send envoie.
 *  GET  ?stats=1              → funnel cumulé.
 *
 * Respecte tous les invariants existants : critère ≥20 avis, dédup contacts, blocklist,
 * gate MV avant envoi (les emails scrapés < confiance 90 attendent leur validation).
 */
export async function POST(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS outscraper_leads (
      place_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site TEXT,
      phone TEXT,
      city TEXT,
      postal_code TEXT,
      rating REAL,
      reviews INT,
      email TEXT,
      email_confidence INT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `)

  /**
   * `sector` / `category` : le MÉTIER de la fiche, porté depuis l'achat.
   *
   * ⚠️ Sans lui, le vivier est une masse indistincte d'« entreprises du bâtiment ». Or le fichier
   * hebdomadaire part vers Revele, Labegaria et Optimum Expertise, qui n'y piochent PAS la même
   * chose : un couvreur intéresse l'un, un pisciniste l'autre. Un vivier sans métier oblige chaque
   * projet à redeviner ce qu'on savait déjà au moment de l'achat.
   */
  const body = await request.json().catch(() => null) as {
    rows?: Array<{ place_id?: string; name?: string; site?: string; phone?: string; city?: string; postal_code?: string; rating?: number; reviews?: number; category?: string; sector?: string }>
    sector?: string
    category?: string
  } | null
  if (!body?.rows?.length) return NextResponse.json({ error: 'rows manquantes' }, { status: 400 })

  let inserted = 0, dupStaging = 0, dejaEnBase = 0, sans20Avis = 0, sansSite = 0, promus = 0
  for (const r of body.rows) {
    if (!r.place_id || !r.name) continue
    const reviews = Number(r.reviews ?? 0)
    // Statut initial selon les critères : on stocke TOUT (traçabilité), mais seuls les 'new'
    // (≥20 avis + site) seront traités. Les autres restent visibles dans les stats.
    let status = 'new'
    if (reviews < 20) { status = 'skipped_lowreviews'; sans20Avis++ }
    else if (!r.site) { status = 'no_website'; sansSite++ }
    try {
      // ⚠️ UPSERT (pas DO NOTHING) : un ré-export périodique doit RAFRAÎCHIR le nombre d'avis des
      // fiches déjà connues. C'est ce qui rend la détection des "franchisseurs" automatique : un
      // lead à 18 avis re-exporté 3 mois plus tard avec 21 avis repasse en 'new' et part en
      // séquence. Sans ça, un lead écarté une fois restait écarté à vie (marché figé).
      // On ne réécrit JAMAIS un statut terminal (importe/blockliste/deja_en_base) : ces leads ont
      // déjà suivi leur chemin, les ressusciter re-contacterait quelqu'un ou casserait un opt-out.
      const res = await db.execute(sql`
        INSERT INTO outscraper_leads (place_id, name, site, phone, city, postal_code, rating, reviews, status, category, sector)
        VALUES (${r.place_id}, ${r.name}, ${r.site ?? null}, ${r.phone ?? null}, ${r.city ?? null}, ${r.postal_code ?? null}, ${r.rating ?? null}, ${reviews}, ${status},
                ${r.category ?? body.category ?? null}, ${r.sector ?? body.sector ?? null})
        ON CONFLICT (place_id) DO UPDATE SET
          reviews = EXCLUDED.reviews,
          rating  = EXCLUDED.rating,
          category = COALESCE(outscraper_leads.category, EXCLUDED.category),
          sector   = COALESCE(outscraper_leads.sector,   EXCLUDED.sector),
          site    = COALESCE(EXCLUDED.site, outscraper_leads.site),
          phone   = COALESCE(EXCLUDED.phone, outscraper_leads.phone),
          -- PROMOTION AUTOMATIQUE : en attente + franchit 20 avis + a un site → repasse en 'new'.
          status = CASE
            WHEN outscraper_leads.status IN ('importe','blockliste','deja_en_base') THEN outscraper_leads.status
            WHEN EXCLUDED.reviews >= 20 AND COALESCE(EXCLUDED.site, outscraper_leads.site) IS NOT NULL
              AND outscraper_leads.status IN ('skipped_lowreviews','no_website') THEN 'new'
            ELSE outscraper_leads.status
          END
        RETURNING place_id, (xmax = 0) AS est_nouveau, status
      `)
      const rows = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{ est_nouveau: boolean; status: string }>
      if (rows[0]?.est_nouveau) inserted++
      else { dupStaging++; if (rows[0]?.status === 'new') promus++ }
    } catch { dupStaging++ }
  }

  // Marque comme doublons ceux dont le place_id est DÉJÀ dans contacts (déjà travaillés par l'agent).
  const dupRes = await db.execute(sql`
    UPDATE outscraper_leads ol SET status = 'deja_en_base'
    WHERE ol.status = 'new'
      AND EXISTS (SELECT 1 FROM contacts c WHERE c.google_place_id = ol.place_id)
    RETURNING place_id
  `)
  const dupRows = (dupRes as unknown as { rows?: unknown[] }).rows ?? (dupRes as unknown as unknown[])
  dejaEnBase = Array.isArray(dupRows) ? dupRows.length : 0

  return NextResponse.json({ ok: true, recus: body.rows.length, inserts: inserted, doublons_rafraichis: dupStaging, promus_20avis: promus, deja_en_base: dejaEnBase, sous_20_avis: sans20Avis, sans_site: sansSite })
}

export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()

  try {
  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

  // Idempotent : le GET peut arriver avant le premier POST (stats sur table encore absente).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS outscraper_leads (
      place_id TEXT PRIMARY KEY, name TEXT NOT NULL, site TEXT, phone TEXT, city TEXT,
      postal_code TEXT, rating REAL, reviews INT, email TEXT, email_confidence INT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ
    )
  `)

  const funnel = async () => {
    const rows = g(await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM outscraper_leads GROUP BY status`)) as Array<{ status: string; n: number }>
    return Object.fromEntries(rows.map(r => [r.status, r.n]))
  }

  if (request.nextUrl.searchParams.get('stats') === '1') {
    return NextResponse.json({ ok: true, funnel: await funnel() })
  }
  if (request.nextUrl.searchParams.get('process') !== '1') {
    return NextResponse.json({ error: 'utiliser ?process=1 ou ?stats=1 (POST pour charger)' }, { status: 400 })
  }

  const batch = Math.min(parseInt(request.nextUrl.searchParams.get('batch') || '8'), 12)
  const camp = g(await db.execute(sql`SELECT id FROM campaigns WHERE status = 'active' LIMIT 1`)) as Array<{ id: string }>
  if (!camp[0]) return NextResponse.json({ ok: false, error: 'aucune campagne active' })

  const todo = g(await db.execute(sql`
    SELECT place_id, name, site, phone, city, postal_code, rating, reviews, sector, email
    FROM outscraper_leads WHERE status = 'new' ORDER BY reviews DESC LIMIT ${batch}
  `)) as Array<{ place_id: string; name: string; site: string; phone: string | null; city: string | null; postal_code: string | null; rating: number | null; reviews: number; sector: string | null; email: string | null }>

  const results: string[] = []
  let importes = 0
  for (const l of todo) {
    if (Date.now() - started > 45000) break
    try {
      /**
       * ⚠️ ON N'ALLAIT JAMAIS CHERCHER L'EMAIL DÉJÀ FOURNI PAR LE FICHIER.
       *
       * L'import conserve bien la colonne `email` d'un export enrichi, mais cette boucle appelait
       * `scrapeEmailFromWebsite()` dans TOUS les cas. Deux conséquences, chacune suffisante :
       *  - payer l'enrichissement email chez Outscraper n'aurait servi à RIEN, l'adresse achetée
       *    était ignorée puis re-cherchée sur le site ;
       *  - le lead était classé « sans email » quand le site n'en publiait pas, alors qu'on avait
       *    l'adresse sous la main.
       *
       * Et surtout, c'est ce qui débloque le VOLUME. Visiter un site coûte ~1,8 s, ce qui plafonne
       * la promotion à ~290 leads/jour : un fichier de 12 000 fiches demanderait six semaines rien
       * que pour être lu. Avec l'email fourni, l'étape disparaît et l'import devient immédiat.
       *
       * Confiance 95 : une adresse achetée chez un fournisseur vaut mieux qu'une adresse devinée
       * sur une page « contact » — MillionVerifier tranchera de toute façon avant tout envoi.
       */
      const fourni = (l.email ?? '').trim().toLowerCase()
      const em = fourni
        ? { email: fourni, confidence: 95 }
        : await scrapeEmailFromWebsite(l.site)
      if (!em?.email) {
        await db.execute(sql`UPDATE outscraper_leads SET status = 'no_email', processed_at = NOW() WHERE place_id = ${l.place_id}`)
        results.push(`∅ email: ${l.name}`)
        continue
      }
      const email = em.email.toLowerCase()
      // ⚠️ ASYMÉTRIE ENTRE LES DEUX CHEMINS D'ENTRÉE. `scrape-leads` filtrait les adresses
      // placeholder par isFakeEmail(), pas celui-ci — alors que les deux créent des contacts.
      // Observé en production : « exemple@mail.com » scrapé sur un vrai site et enregistré comme
      // adresse de contact. L'envoi l'aurait bien refusé plus loin (autopilot-tick), mais la fiche
      // occupait une place dans le CRM en se faisant passer pour un prospect joignable.
      // Règle générale : deux chemins qui écrivent dans la même table doivent porter les mêmes
      // garde-fous, sinon le plus récent hérite silencieusement des trous de l'autre.
      if (isFakeEmail(email)) {
        await db.execute(sql`UPDATE outscraper_leads SET status = 'no_email', processed_at = NOW() WHERE place_id = ${l.place_id}`)
        results.push(`∅ adresse bidon (${email}) : ${l.name}`)
        continue
      }
      // Blocklist (opt-out d'anciens contacts) — jamais réimporter.
      const bl = g(await db.execute(sql`
        SELECT 1 AS x FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(${email}))
           OR (b.domain IS NOT NULL AND LOWER(${email}) LIKE '%@' || LOWER(b.domain))
        LIMIT 1
      `))
      if (bl.length > 0) {
        await db.execute(sql`UPDATE outscraper_leads SET status = 'blockliste', email = ${email}, processed_at = NOW() WHERE place_id = ${l.place_id}`)
        results.push(`⛔ blocklisté: ${l.name}`)
        continue
      }
      // Insert contact (email UNIQUE : un doublon d'email → contact existant, on n'écrase rien).
      //
      // ⚠️ Le métier était écrit EN DUR à 'terrassier' pour TOUT LE MONDE. Or la colonne sector
      // décide du vocabulaire du mail généré ("ce prospect est un {sector}") : chaque pisciniste
      // recevait un texte de terrassier, signé du nom du client.
      // Le repli est générique et surtout PAS 'terrassier' — un métier faux est pire qu'un métier
      // vague, parce qu'il produit un message confiant et hors sujet.
      /**
       * ⚠️ « ON CONFLICT (email) » NE COUVRAIT QU'UNE SEULE CONTRAINTE.
       *
       * La table porte aussi un index unique sur google_place_id. Un établissement déjà connu qui
       * revient dans un nouveau fichier avec une AUTRE adresse e-mail ne déclenche donc pas le
       * conflit sur l'email : il viole l'unicité du place_id et l'insertion lève une erreur. Le
       * lead est alors perdu sans jamais changer de statut, et la promotion se bloque dessus à
       * chaque passage. Mesuré le 25/08 : 8 leads sur 12 en échec, promotion figée à 862 restants.
       *
       * Sans cible, le DO NOTHING couvre TOUTES les contraintes uniques, et le code traite déjà
       * correctement le cas « rien inséré » en marquant le lead comme déjà en base.
       *
       * ⚠️ Ce commentaire est en dehors du gabarit SQL : un accent grave à l'intérieur d'un
       * template literal le referme et casse la compilation.
       */
      const ins = g(await db.execute(sql`
        INSERT INTO contacts (email, company, website, phone, sector, city, postal_code, google_place_id, google_rating, google_reviews_count, email_confidence_score, source, audit_done)
        VALUES (${email}, ${stripEmojis(l.name)}, ${l.site}, ${l.phone}, ${l.sector || 'artisan du bâtiment'}, ${l.city}, ${l.postal_code}, ${l.place_id}, ${l.rating}, ${l.reviews}, ${em.confidence}, 'outscraper', false)
        ON CONFLICT DO NOTHING
        RETURNING id
      `)) as Array<{ id: string }>
      if (ins.length === 0) {
        await db.execute(sql`UPDATE outscraper_leads SET status = 'deja_en_base', email = ${email}, processed_at = NOW() WHERE place_id = ${l.place_id}`)
        results.push(`↺ email déjà en base: ${l.name}`)
        continue
      }
      // Placeholder step-0 'pending' → entre dans la rotation validate-emails puis autopilot.
      await db.execute(sql`
        INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
        VALUES (${ins[0].id}, ${camp[0].id}, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW())
      `)
      await db.execute(sql`UPDATE outscraper_leads SET status = 'importe', email = ${email}, email_confidence = ${em.confidence}, processed_at = NOW() WHERE place_id = ${l.place_id}`)
      importes++
      results.push(`✓ ${l.name} → ${email} (conf ${em.confidence}, ${l.reviews} avis)`)
    } catch (e) {
      /**
       * ⚠️ TRONQUER UNE ERREUR PAR LE DÉBUT, C'EST JETER LA CAUSE.
       * Les 60 premiers caractères d'une erreur Postgres ne contiennent que « Failed query: INSERT
       * INTO contacts (email, c… » — c'est-à-dire la question, jamais la réponse. Le nom de la
       * contrainte violée est à la fin. Huit leads sur douze échouaient sans qu'on puisse dire
       * pourquoi.
       */
      const msg = String((e as Error)?.message ?? e)
      results.push(`✗ ${l.name}: ${msg.length > 160 ? '…' + msg.slice(-160) : msg}`)
    }
  }

  return NextResponse.json({ ok: true, traites: results.length, importes, results, funnel: await funnel() })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 })
  }
}
