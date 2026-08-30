import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * ⚠️ COMBIEN DE FICHES UNE VILLE RAPPORTE-T-ELLE VRAIMENT ?
 *
 * L'estimation de coût du cron d'achat suppose 500 fiches par ville — le maximum demandé. C'est
 * volontairement pessimiste, mais ça a une conséquence que Timéo vient de rencontrer : un lot de
 * quinze villes est estimé à 22,50 $ et bute sur le plafond de 10 $/jour, alors que la dépense
 * réelle sera de quelques centimes. **Le garde-fou bloque sur un chiffre imaginaire.**
 *
 * On mesure donc le rendement réel, par ville et par métier, pour pouvoir estimer sur des faits.
 */
export async function rendementParVille(sql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) {
  return await sql`
    SELECT COALESCE(sector, '(inconnu)') AS metier,
           COUNT(DISTINCT city)::int AS villes,
           COUNT(*)::int AS fiches,
           ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT city), 0), 1) AS fiches_par_ville,
           MAX(cnt.n)::int AS pire_ville
    FROM outscraper_leads ol
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM outscraper_leads o2
      WHERE o2.city = ol.city AND COALESCE(o2.sector,'') = COALESCE(ol.sector,'')
    ) cnt ON TRUE
    WHERE ol.city IS NOT NULL
    GROUP BY 1 ORDER BY 3 DESC`
}
export const maxDuration = 30

/**
 * CE QU'UN FICHIER OUTSCRAPER RAPPORTE VRAIMENT, DE LA FICHE ACHETÉE AU MAIL ENVOYÉ.
 *
 * ⚠️ La question « les fichiers Outscraper sont-ils bons ? » ne se répond pas avec le taux de
 * validité MillionVerifier : ce taux ne porte que sur les fiches QUI AVAIENT DÉJÀ UN EMAIL, donc
 * sur les survivantes de trois filtres antérieurs. Le regarder seul fait croire à un excellent
 * rendement là où l'essentiel du fichier a déjà été perdu en amont.
 *
 * Les pertes se MULTIPLIENT, elles ne s'additionnent pas. C'est l'erreur déjà commise en annonçant
 * « 596 fiches exploitables » sur un fichier qui en donnait ~230 de contactables. On déroule donc
 * l'entonnoir complet, chaque étage rapporté au fichier de départ.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  const [f] = (await sql`
    SELECT
      COUNT(*)::int                                                        AS fiches_importees,
      COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int       AS avec_email,
      COUNT(*) FILTER (WHERE status = 'hors_metier')::int                  AS hors_metier,
      COUNT(*) FILTER (WHERE status = 'skipped_lowreviews')::int           AS sous_le_seuil_avis,
      COUNT(*) FILTER (WHERE status LIKE 'deja%')::int                     AS doublons
    FROM outscraper_leads
  `) as Array<Record<string, number>>

  // Ce que ces fiches sont devenues une fois passées en contacts.
  const [c] = (await sql`
    SELECT
      COUNT(*)::int                                                              AS contacts_crees,
      COUNT(*) FILTER (WHERE email_validated IS TRUE)::int                       AS adresses_validees,
      COUNT(*) FILTER (WHERE mv_status = 'injoignable')::int                     AS injoignables,
      COUNT(*) FILTER (WHERE COALESCE(google_reviews_count,0) < 20)::int         AS sous_seuil_client,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM email_queue q
        WHERE q.contact_id = contacts.id AND q.sequence_step = 0 AND q.status = 'sent'
      ))::int                                                                    AS reellement_demarches
    FROM contacts
    WHERE source = 'outscraper'
  `) as Array<Record<string, number>>

  /**
   * ⚠️ LES PERTES SE CHEVAUCHENT — ne jamais les additionner.
   *
   * Une fiche peut être à la fois sans email ET sous le seuil d'avis. Annoncer « 2 175 fiches
   * récupérables en baissant le seuil » serait faux si la plupart n'ont de toute façon pas
   * d'adresse. On mesure donc le levier RÉEL : celles qui ont un email ET qui n'attendent que le
   * critère client.
   *
   * ⚠️ ET LE PIÈGE QUI M'A EU : un alias SQL non quoté est mis en MINUSCULES par Postgres.
   * `AS sous_seuil_avec_email` devient `sous_seuil_mais_avec_email`, la lecture JS sur la
   * casse d'origine rendait undefined, et le `?? 0` transformait ça en un rassurant « 0 levier ».
   * Le croisement brut ci-dessous disait 428. Un compteur qui affiche zéro doit toujours être
   * confronté à une lecture brute avant d'être annoncé.
   */
  const [levier] = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'skipped_lowreviews'
                         AND email IS NOT NULL AND email <> '')::int AS sous_seuil_avec_email,
      COUNT(*) FILTER (WHERE (email IS NULL OR email = '')
                         AND status NOT IN ('hors_metier')
                         AND phone IS NOT NULL AND phone <> '')::int  AS sans_email_avec_telephone
    FROM outscraper_leads
  `) as Array<Record<string, number>>

  /**
   * ⚠️ UN ZÉRO NE SE CROIT PAS SUR PAROLE. Le calcul des leviers a d'abord rendu 0 sur les deux
   * lignes — ce qui peut vouloir dire « aucun levier » comme « ma condition ne correspond à rien ».
   * On sort donc le croisement brut statut × présence d'email : lui, on peut le lire.
   */
  const croisement = (await sql`
    SELECT COALESCE(status, 'sans_statut') AS statut,
           COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')::int AS avec_email
    FROM outscraper_leads
    GROUP BY 1 ORDER BY 2 DESC
  `) as Array<Record<string, string | number>>

  const importees = Number(f?.fiches_importees ?? 0)
  const demarches = Number(c?.reellement_demarches ?? 0)
  const pct = (n: number) => (importees > 0 ? Math.round((n / importees) * 1000) / 10 : 0)

  const rendement_par_ville = await rendementParVille(sql as never)
  return NextResponse.json({
    rendement_par_ville,
    entonnoir: {
      '1_fiches_importees': importees,
      '2_avec_une_adresse_email': { n: Number(f?.avec_email ?? 0), pct_du_fichier: pct(Number(f?.avec_email ?? 0)) },
      '3_contacts_crees': { n: Number(c?.contacts_crees ?? 0), pct_du_fichier: pct(Number(c?.contacts_crees ?? 0)) },
      '4_adresses_validees_MV': { n: Number(c?.adresses_validees ?? 0), pct_du_fichier: pct(Number(c?.adresses_validees ?? 0)) },
      '5_reellement_demarches': { n: demarches, pct_du_fichier: pct(demarches) },
    },
    pertes_en_amont: {
      hors_metier: Number(f?.hors_metier ?? 0),
      sous_le_seuil_avis: Number(f?.sous_le_seuil_avis ?? 0),
      doublons: Number(f?.doublons ?? 0),
      sans_email: importees - Number(f?.avec_email ?? 0),
      injoignables_apres_MV: Number(c?.injoignables ?? 0),
      sous_seuil_client: Number(c?.sous_seuil_client ?? 0),
    },
    /**
     * LE SEUL CHIFFRE QUI COMPTE POUR DÉCIDER D'UN ACHAT : combien de personnes réellement
     * démarchées pour 100 fiches payées. C'est lui qu'il faut multiplier par le prix de la fiche.
     */
    croisement_statut_email: croisement,
    leviers_disponibles: {
      // Récupérables si Haris accepte des entreprises avec moins de 20 avis.
      sous_seuil_avis_MAIS_avec_email: Number(levier?.sous_seuil_avec_email ?? 0),
      // Récupérables sur un autre canal : pas d'adresse, mais un numéro.
      sans_email_MAIS_avec_telephone: Number(levier?.sans_email_avec_telephone ?? 0),
    },
    rendement_reel_pct: pct(demarches),
    lecture: `Sur 100 fiches achetées, ${pct(demarches)} personnes ont été réellement démarchées. Le taux de validité MillionVerifier ne porte QUE sur les fiches qui avaient déjà un email, il ne mesure pas la qualité du fichier.`,
  })
}
