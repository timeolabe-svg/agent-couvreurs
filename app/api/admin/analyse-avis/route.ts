import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ANALYSE RÉELLE DE LA DISTRIBUTION DES AVIS GOOGLE.
 *
 * ⚠️ Pourquoi cet endpoint : j'ai annoncé « 80 % des fiches ont moins de 20 avis » à partir du seul
 * funnel d'un import. Timéo a objecté, à juste titre, que les artisans du BTP ont généralement des
 * avis. Une objection de terrain contre un chiffre de tableau : c'est le terrain qu'il faut aller
 * vérifier, pas le tableau qu'il faut défendre.
 *
 * Le point aveugle possible : une fiche dont le nombre d'avis est ABSENT du fichier source (NULL,
 * vide) est stockée à 0 et devient indiscernable d'une entreprise réellement sans avis. Si le
 * fichier importé était incomplet sur cette colonne, le « 80 % » ne mesurerait pas le marché mais
 * la qualité de l'export. On sépare donc explicitement : absent / vraiment 0 / 1 et plus.
 *
 * Trois sources comparées, parce qu'une seule ne prouve rien :
 *   1. outscraper_leads — le fichier importé, tel quel
 *   2. contacts — les entreprises réellement démarchées (données Google Places, fiables)
 *   3. le croisement site / avis, pour distinguer une fiche pauvre d'une entreprise pauvre
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const res: Record<string, unknown> = {}

  // 1) LE FICHIER IMPORTÉ — en isolant l'absence de donnée.
  res.fichier_importe = (await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE reviews IS NULL)::int                  AS avis_absent_du_fichier,
      COUNT(*) FILTER (WHERE reviews = 0)::int                      AS avis_a_zero,
      COUNT(*) FILTER (WHERE reviews BETWEEN 1 AND 4)::int          AS avis_1_4,
      COUNT(*) FILTER (WHERE reviews BETWEEN 5 AND 9)::int          AS avis_5_9,
      COUNT(*) FILTER (WHERE reviews BETWEEN 10 AND 19)::int        AS avis_10_19,
      COUNT(*) FILTER (WHERE reviews >= 20)::int                    AS avis_20_et_plus,
      COUNT(*) FILTER (WHERE site IS NOT NULL AND site <> '')::int  AS avec_site,
      ROUND(AVG(reviews))::int                                      AS moyenne,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY reviews)::int      AS mediane
    FROM outscraper_leads
  `)

  // 2) LES ENTREPRISES RÉELLEMENT DÉMARCHÉES — source Google Places, la plus fiable dont on dispose.
  res.entreprises_demarchees = (await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE google_reviews_count IS NULL)::int            AS avis_inconnu,
      COUNT(*) FILTER (WHERE google_reviews_count = 0)::int                AS avis_a_zero,
      COUNT(*) FILTER (WHERE google_reviews_count BETWEEN 1 AND 19)::int   AS avis_1_19,
      COUNT(*) FILTER (WHERE google_reviews_count >= 20)::int              AS avis_20_et_plus,
      ROUND(AVG(google_reviews_count) FILTER (WHERE google_reviews_count > 0))::int AS moyenne_hors_zero,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY google_reviews_count)
        FILTER (WHERE google_reviews_count > 0)::int                        AS mediane_hors_zero
    FROM contacts
  `)

  // 3) PAR MÉTIER, sur les entreprises démarchées : le BTP a-t-il vraiment peu d'avis ?
  res.par_metier = (await sql`
    SELECT COALESCE(sector, '(inconnu)') AS metier,
           COUNT(*)::int AS entreprises,
           COUNT(*) FILTER (WHERE google_reviews_count >= 20)::int AS avec_20_avis_ou_plus,
           ROUND(100.0 * COUNT(*) FILTER (WHERE google_reviews_count >= 20) / NULLIF(COUNT(*), 0))::int AS pourcent_eligibles,
           ROUND(AVG(google_reviews_count) FILTER (WHERE google_reviews_count > 0))::int AS moyenne_avis
    FROM contacts
    WHERE google_reviews_count IS NOT NULL
    GROUP BY COALESCE(sector, '(inconnu)')
    ORDER BY entreprises DESC
  `)

  // 4) LE FICHIER EST-IL COMPLET ? Une fiche sans site ET sans avis est probablement une ligne
  // pauvre, pas une entreprise pauvre : c'est le signe d'un export partiel, pas d'un marché.
  res.qualite_du_fichier = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE (site IS NULL OR site = '') AND COALESCE(reviews, 0) = 0)::int AS ni_site_ni_avis,
      COUNT(*) FILTER (WHERE (site IS NOT NULL AND site <> '') AND COALESCE(reviews, 0) = 0)::int AS site_mais_zero_avis,
      COUNT(*) FILTER (WHERE (site IS NULL OR site = '') AND reviews >= 20)::int AS avis_mais_pas_de_site
    FROM outscraper_leads
  `)

  return NextResponse.json({
    ok: true,
    lecture: "Comparer 1 et 2 : si le fichier montre beaucoup moins d'avis que les entreprises réellement démarchées, le problème vient de l'export, pas du marché.",
    ...res,
  })
}

export const GET = wrapCron('analyse-avis', handler)
