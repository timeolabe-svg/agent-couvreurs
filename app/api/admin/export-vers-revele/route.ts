import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * EXPORT DU VIVIER BTP D'HDIGIWEB VERS REVELE COMMUNICATION (timelapse de chantier).
 *
 * Les deux clients visent le même monde — les entreprises du bâtiment — mais ne vendent pas la
 * même chose : Hdigiweb un site internet, Revele un timelapse de chantier. Une entreprise qui n'a
 * pas besoin de l'un peut avoir besoin de l'autre. Réutiliser le vivier évite de racheter des
 * données publiques qu'on possède déjà.
 *
 * ⚠️ LA RÈGLE QUI COMMANDE TOUT LE RESTE : L'OPPOSITION SUIT LA PERSONNE, PAS LA CAMPAGNE.
 *
 * Transférer à Revele quelqu'un qui a dit « stop » à Hdigiweb, c'est lui réécrire après un refus.
 * Le fait que ce soit une autre marque, un autre expéditeur et une autre offre ne change rien pour
 * la personne : elle a demandé qu'on cesse de la solliciter. C'est le motif exact de la plainte
 * CNIL du 06/08/2026, et c'est la faute la plus coûteuse que ce système puisse commettre.
 *
 * On exclut donc, sans exception :
 *   — toute adresse ou tout domaine en blocklist, quel qu'en soit le motif ;
 *   — toute entreprise ayant répondu quoi que ce soit de négatif (désintérêt, spam, RGPD) ;
 *   — toute entreprise s'étant plainte de la pression d'envoi, même sans dire « stop » ;
 *   — les fiches fermées, hors métier, et les concurrents de Timéo.
 *
 * ⚠️ CE QU'ON N'EXCLUT PAS, ET POURQUOI. Un prospect simplement démarché par Hdigiweb, qui n'a
 * jamais répondu, n'a rien refusé. Ces coordonnées sont professionnelles et publiques (fiche Google
 * et site de l'entreprise) : Revele pourrait les collecter lui-même. La mention légale de l'article
 * 14 part dans chacun de ses mails, avec son propre lien de désabonnement. Le transfert est donc
 * loyal — à condition que l'exclusion ci-dessus soit sans faille.
 *
 * GET            → aperçu chiffré, rien n'est écrit
 * GET ?csv=1     → le fichier
 */

/** Métiers du bâtiment — la cible de Revele. Écarte piscinistes hors sujet, hôtels, etc. */
const METIERS_BTP = [
  'couvreur', 'plombier', 'maçon', 'macon', 'menuisier', 'peintre', 'terrassier',
  'électricien', 'electricien', 'charpentier', 'carreleur', 'artisan du bâtiment',
  'entreprise de travaux publics', 'entreprise d assainissement', 'paysagiste', 'pisciniste',
]

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  /**
   * DEUX GISEMENTS, réunis par la même clause d'exclusion :
   *   A. les CONTACTS déjà démarchés par Hdigiweb (ils ont un email vérifié — les plus précieux) ;
   *   B. les LEADS en réserve, jamais contactés (sous les 20 avis : critère d'Hdigiweb, pas de
   *      Revele — un chantier filmé n'a rien à voir avec la notoriété Google de l'entreprise).
   */
  const contacts = (await sql`
    /**
     * ⚠️ ON EXPORTE L'ÉTAT DE VÉRIFICATION, pas seulement l'adresse.
     * Fabien va écrire depuis SES boîtes : lui livrer des adresses non vérifiées, c'est lui faire
     * porter le rebond, et le rebond abîme la réputation d'expédition — le dégât est pour lui, pas
     * pour nous. Une adresse validée par MillionVerifier et une adresse simplement scrapée n'ont
     * pas la même valeur ; les mélanger sans le dire serait lui livrer un fichier qui ment.
     */
    SELECT c.email, c.company, c.website, c.phone, c.city, c.postal_code, c.sector,
           'demarche_hdigiweb' AS origine,
           CASE
             WHEN c.email_validated IS TRUE THEN 'verifiee_millionverifier'
             WHEN EXISTS (SELECT 1 FROM email_queue q
                          WHERE q.contact_id = c.id AND q.status = 'sent') THEN 'mail_deja_delivre'
             ELSE 'non_verifiee'
           END AS fiabilite
    FROM contacts c
    WHERE c.email IS NOT NULL
      AND (c.sector IS NULL OR LOWER(c.sector) = ANY(${METIERS_BTP}))
      -- Jamais quelqu'un qui s'est opposé, quel qu'en soit le motif.
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
           OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
      )
      -- Ni quelqu'un dont la réponse a été classée négative : refus, spam, demande RGPD.
      AND NOT EXISTS (
        SELECT 1 FROM incoming_replies ir
        WHERE LOWER(ir.from_email) = LOWER(c.email)
          AND (ir.classification IN ('desinterest', 'spam', 'rgpd_request')
               OR ir.action_taken IN ('blocklist', 'rgpd_request'))
      )
    ORDER BY c.company
  `) as Array<Record<string, unknown>>

  const leads = (await sql`
    SELECT ol.email, ol.name AS company, ol.site AS website, ol.phone, ol.city, ol.postal_code,
           ol.sector, 'jamais_contacte' AS origine,
           'non_verifiee' AS fiabilite
    FROM outscraper_leads ol
    WHERE ol.email IS NOT NULL
      AND ol.status IN ('skipped_lowreviews', 'no_website', 'deja_en_base')
      AND (ol.sector IS NULL OR LOWER(ol.sector) = ANY(${METIERS_BTP}))
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(ol.email))
           OR (b.domain IS NOT NULL AND LOWER(ol.email) LIKE '%@' || LOWER(b.domain))
      )
      AND NOT EXISTS (
        SELECT 1 FROM incoming_replies ir WHERE LOWER(ir.from_email) = LOWER(ol.email)
      )
    ORDER BY ol.name
  `) as Array<Record<string, unknown>>

  // Une même personne peut être des deux côtés : on ne l'exporte qu'une fois.
  const vus = new Set<string>()
  const tout = [...contacts, ...leads].filter(r => {
    const e = String(r.email ?? '').toLowerCase().trim()
    if (!e || vus.has(e)) return false
    vus.add(e)
    return true
  })

  if (req.nextUrl.searchParams.get('csv') !== '1') {
    const parSecteur: Record<string, number> = {}
    for (const r of tout) parSecteur[String(r.sector ?? '(inconnu)')] = (parSecteur[String(r.sector ?? '(inconnu)')] ?? 0) + 1
    const exclus = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM blocklist) AS opposes_blocklist,
        (SELECT COUNT(DISTINCT LOWER(from_email))::int FROM incoming_replies
          WHERE classification IN ('desinterest','spam','rgpd_request')
             OR action_taken IN ('blocklist','rgpd_request')) AS refus_exprimes
    `) as Array<{ opposes_blocklist: number; refus_exprimes: number }>

    return NextResponse.json({
      ok: true,
      exportables: tout.length,
      dont_deja_demarches_par_hdigiweb: tout.filter(r => r.origine === 'demarche_hdigiweb').length,
      dont_jamais_contactes: tout.filter(r => r.origine === 'jamais_contacte').length,
      par_metier: parSecteur,
      par_fiabilite: tout.reduce<Record<string, number>>((a, r) => {
        const k = String(r.fiabilite ?? '?'); a[k] = (a[k] ?? 0) + 1; return a
      }, {}),
      exclus_pour_opposition: exclus[0],
      regle: 'Aucune personne opposée, ayant refusé, signalé du spam ou exercé un droit RGPD n\'est exportée. L\'opposition suit la personne, jamais la campagne.',
      suite: 'Ajouter ?csv=1 pour le fichier.',
      apercu: tout.slice(0, 5),
    })
  }

  const echap = (v: unknown) => {
    const s = String(v ?? '').replace(/"/g, '""')
    return /[",;\n]/.test(s) ? `"${s}"` : s
  }
  const lignes = [
    'email,company,website,phone,city,postal_code,sector,origine,fiabilite',
    ...tout.map(r => [r.email, r.company, r.website, r.phone, r.city, r.postal_code, r.sector, r.origine, r.fiabilite].map(echap).join(',')),
  ]
  return new NextResponse(lignes.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="btp-hdigiweb-vers-revele.csv"',
    },
  })
}

export const GET = wrapCron('export-vers-revele', handler)
