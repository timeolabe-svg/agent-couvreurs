import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
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

  const importees = Number(f?.fiches_importees ?? 0)
  const demarches = Number(c?.reellement_demarches ?? 0)
  const pct = (n: number) => (importees > 0 ? Math.round((n / importees) * 1000) / 10 : 0)

  return NextResponse.json({
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
    rendement_reel_pct: pct(demarches),
    lecture: `Sur 100 fiches achetées, ${pct(demarches)} personnes ont été réellement démarchées. Le taux de validité MillionVerifier ne porte QUE sur les fiches qui avaient déjà un email, il ne mesure pas la qualité du fichier.`,
  })
}
