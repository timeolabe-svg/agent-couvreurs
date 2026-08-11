import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * IMPORT D'UN FICHIER DE LEADS (Excel ou CSV) — analyse d'abord, import ensuite.
 *
 * ⚠️ Pourquoi ce chemin n'existait pas : le bouton « Importer » de la page Prospects renvoyait sur
 * /leads, qui n'a aucun champ fichier. L'endpoint d'import existait, rien ne l'appelait. Timéo
 * devait donc passer par quelqu'un pour charger ses leads — sur l'opération la plus banale du
 * métier.
 *
 * DEUX TEMPS, VOLONTAIREMENT SÉPARÉS :
 *   POST (défaut)        → ANALYSE seule. Rien n'est écrit. On répond : combien de lignes, quelles
 *                          colonnes reconnues, combien passent le seuil d'avis, combien sont déjà
 *                          en base, combien de concurrents. C'est le chiffre AVANT décision.
 *   POST ?importer=1     → charge réellement dans le tampon outscraper_leads.
 *
 * Analyser avant d'écrire n'est pas une politesse : un import de 1 000 lignes engage des envois
 * réels à des entreprises réelles. On regarde ce qu'on a avant, pas après.
 */

/** Noms de colonnes acceptés — les exports Google Maps / Outscraper varient beaucoup. */
const ALIAS: Record<string, string[]> = {
  name: ['name', 'nom', 'company', 'entreprise', 'societe', 'société', 'business', 'title', 'raison sociale'],
  site: ['site', 'website', 'site web', 'url', 'web', 'site internet', 'domain'],
  phone: ['phone', 'telephone', 'téléphone', 'tel', 'tél', 'mobile', 'phone_1', 'numero'],
  city: ['city', 'ville', 'commune', 'locality', 'localite'],
  postal_code: ['postal_code', 'code postal', 'cp', 'zip', 'postcode'],
  reviews: ['reviews', 'avis', 'nb avis', 'nombre avis', 'reviews_count', 'user_ratings_total', 'nombre d\'avis'],
  rating: ['rating', 'note', 'score', 'etoiles', 'étoiles', 'stars'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'email_1'],
  place_id: ['place_id', 'placeid', 'google_id', 'id'],
}

/**
 * On compare SANS accents ni apostrophes : un export écrit aussi bien « Nombre d'avis » que
 * « nombre d avis » ou « NOMBRE D'AVIS ». Une colonne ratée, c'est une donnée perdue en silence —
 * et le téléphone d'un fichier français a justement échoué au premier test.
 */
function sansAccents(s: string): string {
  return String(s ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/['’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliserEntete(h: string): string | null {
  const n = sansAccents(h)
  for (const [champ, alias] of Object.entries(ALIAS)) {
    if (alias.some(a => sansAccents(a) === n)) return champ
  }
  return null
}

function estConcurrent(texte: string): boolean {
  const t = (texte || '').toLowerCase()
  return /\b(agence|studio|agency)\b[^.]{0,30}\b(com|communication|marketing|pub|publicit[ée]|digital|cr[ée]a|web|seo|sea|r[ée]f[ée]rencement|design|prospection|commerciale?)\b/.test(t)
      || /\b(web\s?agency|webdesign|cr[ée]ation\s+de\s+sites?|refonte\s+de\s+sites?|d[ée]veloppement\s+web|community\s+manager|g[ée]n[ée]ration\s+de\s+leads?)\b/.test(t)
}

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const fichier = form?.get('fichier')
  if (!fichier || typeof fichier === 'string') {
    return NextResponse.json({ error: 'aucun fichier reçu (champ "fichier")' }, { status: 400 })
  }

  const buf = Buffer.from(await (fichier as File).arrayBuffer())
  let lignes: Record<string, unknown>[] = []
  try {
    // ⚠️ codepage 65001 (UTF-8) OBLIGATOIRE : sans lui, un CSV francais est lu en ANSI et l entete
    // "Telephone" arrive en "TÃ©lÃ©phone" — la colonne devient invisible. Teste : la colonne
    // telephone d un export FR standard n etait PAS reconnue.
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 })
    const feuille = wb.Sheets[wb.SheetNames[0]]
    lignes = XLSX.utils.sheet_to_json(feuille, { defval: '' })
  } catch (e) {
    return NextResponse.json({ error: 'fichier illisible : ' + String(e).slice(0, 150) }, { status: 400 })
  }
  if (lignes.length === 0) return NextResponse.json({ error: 'fichier vide' }, { status: 400 })

  // Correspondance des colonnes, et surtout : ce qu'on N'A PAS reconnu (le plus utile à afficher).
  const entetes = Object.keys(lignes[0])
  const mapping: Record<string, string> = {}
  const nonReconnues: string[] = []
  for (const h of entetes) {
    const champ = normaliserEntete(h)
    if (champ && !mapping[champ]) mapping[champ] = h
    else if (!champ) nonReconnues.push(h)
  }
  if (!mapping.name) {
    return NextResponse.json({
      error: 'colonne du NOM d\'entreprise introuvable — impossible d\'importer',
      entetes_trouvees: entetes,
      noms_acceptes: ALIAS.name,
    }, { status: 400 })
  }

  const val = (l: Record<string, unknown>, champ: string): string => {
    const col = mapping[champ]
    return col ? String(l[col] ?? '').trim() : ''
  }
  const nombre = (s: string): number => {
    const n = parseInt(String(s).replace(/[^\d]/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  }

  const SEUIL_AVIS = 20
  const { sql } = await import('@/lib/db')

  // Ce qui est DÉJÀ en base : on ne veut pas annoncer comme neuf ce qu'on connaît déjà.
  const sitesConnus = new Set(
    ((await sql`SELECT LOWER(site) AS site FROM outscraper_leads WHERE site IS NOT NULL`) as Array<{ site: string }>)
      .map(r => r.site),
  )
  const nomsConnus = new Set(
    ((await sql`SELECT LOWER(company) AS c FROM contacts`) as Array<{ c: string }>).map(r => r.c),
  )

  let sansNom = 0, concurrents = 0, dejaConnus = 0, sousSeuil = 0, sansSite = 0, exploitables = 0
  const aCharger: Array<Record<string, unknown>> = []

  for (const l of lignes) {
    const nom = val(l, 'name')
    if (!nom) { sansNom++; continue }
    if (estConcurrent(nom)) { concurrents++; continue }
    const site = val(l, 'site')
    const avis = nombre(val(l, 'reviews'))
    if (sitesConnus.has(site.toLowerCase()) || nomsConnus.has(nom.toLowerCase())) { dejaConnus++; continue }
    if (avis < SEUIL_AVIS) { sousSeuil++; continue }
    if (!site) { sansSite++; continue }
    exploitables++
    aCharger.push({
      place_id: val(l, 'place_id') || `imp-${Buffer.from(nom + site).toString('base64').slice(0, 40)}`,
      name: nom, site, phone: val(l, 'phone'), city: val(l, 'city'),
      postal_code: val(l, 'postal_code'), rating: parseFloat(val(l, 'rating')) || null, reviews: avis,
    })
  }

  const analyse = {
    lignes_dans_le_fichier: lignes.length,
    colonnes_reconnues: mapping,
    colonnes_ignorees: nonReconnues,
    ecartes: {
      sans_nom: sansNom,
      concurrents: concurrents,
      deja_en_base: dejaConnus,
      moins_de_20_avis: sousSeuil,
      sans_site_web: sansSite,
    },
    EXPLOITABLES: exploitables,
    taux: lignes.length ? Math.round((exploitables / lignes.length) * 100) + '%' : '0%',
  }

  if (req.nextUrl.searchParams.get('importer') !== '1') {
    return NextResponse.json({ ok: true, mode: 'analyse', ...analyse, apercu: aCharger.slice(0, 5) })
  }

  let charges = 0
  for (const r of aCharger) {
    const res = (await sql`
      INSERT INTO outscraper_leads (place_id, name, site, phone, city, postal_code, rating, reviews, status)
      VALUES (${r.place_id as string}, ${r.name as string}, ${r.site as string}, ${r.phone as string || null},
              ${r.city as string || null}, ${r.postal_code as string || null}, ${r.rating as number | null},
              ${r.reviews as number}, 'new')
      ON CONFLICT (place_id) DO NOTHING
      RETURNING place_id
    `) as Array<{ place_id: string }>
    charges += res.length
  }

  return NextResponse.json({
    ok: true, mode: 'importé', ...analyse, charges_en_base: charges,
    suite: 'GET /api/admin/import-outscraper?process=1&batch=10 — scrape l\'email sur leur site puis met en file.',
  })
}

export const POST = wrapCron('import-fichier', handler)
