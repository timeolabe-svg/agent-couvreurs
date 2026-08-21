import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * LE PLAN DE COUVERTURE NATIONALE — quelles villes restent à ratisser, dans quel ordre.
 *
 * Trois usages :
 *   ?charger=1   → charge les communes de France depuis l'API officielle (gratuite), une fois.
 *   (défaut)     → l'état d'avancement : combien de villes faites, restantes, épuisées.
 *   ?prochain=1  → le PROCHAIN lot de villes à acheter, sans rien acheter.
 *
 * ⚠️ POURQUOI UNE LISTE OFFICIELLE PLUTÔT QU'UNE LISTE ÉCRITE À LA MAIN. La première campagne a
 * ratissé « Paris, Marseille, Lyon… » : dix villes choisies de tête. Résultat, des départements
 * entiers jamais visités pendant qu'on repassait sur les mêmes agglomérations. Une liste
 * exhaustive et un ordre déterministe sont la seule façon de couvrir la France sans trou ni
 * répétition — et surtout de pouvoir DIRE où on en est.
 *
 * ⚠️ SEUIL DE POPULATION. On ne descend pas sous 2 000 habitants : une recherche Google Maps sur
 * une ville ramène aussi les entreprises des communes alentour. Aller chercher un village de
 * 300 habitants, c'est re-payer des fiches déjà obtenues via la ville voisine — le doublon sera
 * jeté à l'import, mais l'argent, lui, sera dépensé.
 */

const SEUIL_POPULATION = 2000

/**
 * Les métiers ciblés, avec la CATÉGORIE GOOGLE exacte à cocher chez Outscraper.
 *
 * ⚠️ Le libellé doit venir de la liste déroulante d'Outscraper (taxonomie Google officielle) et
 * être utilisé avec « correspondance exacte ». Taper du texte libre lance une RECHERCHE Google
 * Maps au lieu d'un FILTRE de type : c'est ce qui a ramené 58 hôtels, 34 restaurants et un cabaret
 * dans un fichier de « piscinistes ».
 */
export const METIERS_CIBLES: { sector: string; categorie_google: string }[] = [
  { sector: 'couvreur',     categorie_google: 'Roofing contractor' },
  { sector: 'terrassier',   categorie_google: 'Excavating contractor' },
  { sector: 'pisciniste',   categorie_google: 'Swimming pool contractor' },
  { sector: 'maçon',        categorie_google: 'Masonry contractor' },
  { sector: 'menuisier',    categorie_google: 'Carpenter' },
  { sector: 'plombier',     categorie_google: 'Plumber' },
  { sector: 'électricien',  categorie_google: 'Electrician' },
  { sector: 'peintre',      categorie_google: 'Painter' },
]

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  // ── Chargement initial des communes (gratuit, source officielle) ─────────────
  if (req.nextUrl.searchParams.get('charger') === '1') {
    const res = await fetch(
      'https://geo.api.gouv.fr/communes?fields=nom,code,population,departement&format=json',
      { signal: AbortSignal.timeout(60_000) },
    )
    if (!res.ok) return NextResponse.json({ error: `API communes : HTTP ${res.status}` }, { status: 502 })
    const communes = (await res.json()) as Array<{
      nom: string; code: string; population?: number; departement?: { code: string; nom: string }
    }>

    const retenues = communes.filter(c => (c.population ?? 0) >= SEUIL_POPULATION)
    let ecrites = 0
    // Par lots : 5 500 INSERT un par un dépasseraient largement le budget de la requête.
    for (let i = 0; i < retenues.length; i += 500) {
      const lot = retenues.slice(i, i + 500)
      await sql`
        INSERT INTO villes_scraping (code_insee, nom, departement, population)
        SELECT x.code, x.nom, x.dep, x.pop::int
        FROM jsonb_to_recordset(${JSON.stringify(lot.map(c => ({
          code: c.code, nom: c.nom, dep: c.departement?.code ?? null, pop: c.population ?? 0,
        })))}::jsonb) AS x(code text, nom text, dep text, pop text)
        ON CONFLICT (code_insee) DO UPDATE SET population = EXCLUDED.population
      `
      ecrites += lot.length
    }

    return NextResponse.json({
      ok: true,
      communes_en_france: communes.length,
      seuil_population: SEUIL_POPULATION,
      communes_retenues: ecrites,
      lecture: `On ne descend pas sous ${SEUIL_POPULATION} habitants : les communes plus petites sont déjà couvertes par la recherche sur la ville voisine, y aller reviendrait à payer deux fois les mêmes entreprises.`,
    })
  }

  // ── Le prochain lot à acheter (aucun achat déclenché ici) ────────────────────
  if (req.nextUrl.searchParams.get('prochain') === '1') {
    const metier = req.nextUrl.searchParams.get('metier') ?? METIERS_CIBLES[0].sector
    const cible = METIERS_CIBLES.find(m => m.sector === metier)
    if (!cible) return NextResponse.json({ error: `métier inconnu : ${metier}` }, { status: 400 })

    const taille = Math.min(5, Math.max(1, parseInt(req.nextUrl.searchParams.get('taille') || '4', 10)))

    /**
     * ⚠️ LES PLUS PEUPLÉES D'ABORD, ET JAMAIS DEUX FOIS.
     *
     * L'ordre par population décroissante met l'argent là où il y a le plus d'entreprises par euro.
     * Le NOT EXISTS sur la couverture est ce qui garantit qu'une ville déjà achetée pour ce métier
     * ne repasse jamais — c'est la protection la plus importante de tout ce mécanisme.
     */
    const lot = (await sql`
      SELECT v.code_insee, v.nom, v.departement, v.population
      FROM villes_scraping v
      WHERE NOT EXISTS (
        SELECT 1 FROM scrape_couverture sc
        WHERE LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = LOWER(${cible.categorie_google})
      )
      ORDER BY v.population DESC NULLS LAST, v.code_insee ASC
      LIMIT ${taille}
    `) as Array<{ code_insee: string; nom: string; departement: string; population: number }>

    return NextResponse.json({
      metier: cible.sector,
      categorie_google_a_cocher: cible.categorie_google,
      correspondance_exacte: true,
      prochain_lot: lot,
      lecture: 'Aucun achat n\'a été déclenché. Ce lot est ce que l\'automatisation commanderait au prochain passage.',
    })
  }

  // ── État d'avancement ────────────────────────────────────────────────────────
  const [villes] = (await sql`
    SELECT COUNT(*)::int AS total, COALESCE(SUM(population), 0)::int AS habitants
    FROM villes_scraping
  `) as Array<{ total: number; habitants: number }>

  const parMetier = await Promise.all(METIERS_CIBLES.map(async m => {
    const [r] = (await sql`
      SELECT
        COUNT(*)::int AS villes_faites,
        COUNT(*) FILTER (WHERE statut = 'epuise')::int AS villes_epuisees,
        COALESCE(SUM(fiches), 0)::int AS fiches_obtenues,
        COALESCE(SUM(cout_usd), 0)::numeric AS cout_total
      FROM scrape_couverture
      WHERE LOWER(categorie) = LOWER(${m.categorie_google})
    `) as Array<Record<string, number>>
    const faites = Number(r?.villes_faites ?? 0)
    return {
      metier: m.sector,
      categorie_google: m.categorie_google,
      villes_faites: faites,
      villes_restantes: Math.max(0, Number(villes?.total ?? 0) - faites),
      villes_epuisees: Number(r?.villes_epuisees ?? 0),
      fiches_obtenues: Number(r?.fiches_obtenues ?? 0),
      cout_total_usd: Number(r?.cout_total ?? 0),
      avancement_pct: villes?.total ? Math.round((faites / villes.total) * 1000) / 10 : 0,
    }
  }))

  return NextResponse.json({
    villes_au_plan: villes?.total ?? 0,
    seuil_population: SEUIL_POPULATION,
    par_metier: parMetier,
    lecture: villes?.total
      ? 'Chaque ligne dit où en est la couverture nationale pour un métier. « épuisées » = la ville n\'a plus rien à donner pour ce métier.'
      : '⚠️ Le plan est vide : lancer ?charger=1 pour charger les communes de France (gratuit).',
  })
}
