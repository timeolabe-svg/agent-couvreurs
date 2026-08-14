import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * QU'AI-JE DÉJÀ ACHETÉ, ET QUE ME RESTE-T-IL À RATISSER ?
 *
 * ⚠️ Outscraper ne garde aucune mémoire de ce qu'il a livré. Relancer « pisciniste + Marseille »
 * rend les mêmes entreprises et les refacture. Notre import écarte bien les doublons, donc la
 * dépense serait totalement invisible : ni fiches en plus, ni erreur, juste de l'argent parti.
 *
 * Cet écran répond aux deux seules questions utiles avant une commande :
 *   — quelles villes ai-je déjà payées, pour ce métier ?
 *   — lesquelles rapportent le moins, donc lesquelles ne pas racheter en priorité ?
 *
 * Le « rendement » affiché est le nombre de fiches obtenues par ville. Une ville à 12 fiches est
 * épuisée ; une ville à 200 a probablement été plafonnée par la limite de résultats et mérite
 * d'être reprise plus finement (par département ou par arrondissement).
 */

/** Les 40 plus grosses agglomérations françaises — le vivier par défaut d'une prochaine commande. */
const VILLES_FR = [
  'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Montpellier', 'Strasbourg',
  'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Toulon', 'Saint-Étienne', 'Le Havre', 'Grenoble',
  'Dijon', 'Angers', 'Nîmes', 'Villeurbanne', 'Clermont-Ferrand', 'Aix-en-Provence', 'Brest',
  'Le Mans', 'Tours', 'Amiens', 'Limoges', 'Annecy', 'Perpignan', 'Boulogne-Billancourt',
  'Metz', 'Besançon', 'Orléans', 'Rouen', 'Argenteuil', 'Mulhouse', 'Caen', 'Nancy',
  'Saint-Denis', 'Avignon',
]

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  const deja = (await sql`
    SELECT categorie, ville, fiches, importe_le
    FROM scrape_couverture
    ORDER BY categorie, fiches DESC
  `) as Array<{ categorie: string; ville: string; fiches: number; importe_le: string }>

  const categories = [...new Set(deja.map(d => d.categorie))]
  const sansAccents = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

  const parCategorie = categories.map(cat => {
    const lignes = deja.filter(d => d.categorie === cat)
    const vues = new Set(lignes.map(l => sansAccents(l.ville)))
    return {
      categorie: cat,
      villes_achetees: lignes.length,
      fiches_totales: lignes.reduce((n, l) => n + l.fiches, 0),
      // Une ville à très peu de fiches est épuisée : la racheter ne rapportera rien.
      epuisees: lignes.filter(l => l.fiches < 15).map(l => `${l.ville} (${l.fiches})`),
      // À l'inverse, une ville très fournie a sans doute été coupée par la limite de résultats.
      a_reprendre_plus_finement: lignes.filter(l => l.fiches >= 150).map(l => `${l.ville} (${l.fiches})`),
      villes_jamais_ratissees: VILLES_FR.filter(v => !vues.has(sansAccents(v))),
    }
  })

  return NextResponse.json({
    ok: true,
    categories_achetees: categories.length,
    villes_x_metiers_enregistres: deja.length,
    par_categorie: parCategorie,
    detail: deja,
    lecture: deja.length
      ? 'Avant une commande : retire des emplacements les villes déjà achetées pour cette catégorie. Outscraper te les revendrait à l\'identique.'
      : 'Aucune couverture enregistrée pour l\'instant — elle se remplit au premier import d\'un fichier contenant la colonne « query ».',
  })
}

export const GET = wrapCron('couverture', handler)
