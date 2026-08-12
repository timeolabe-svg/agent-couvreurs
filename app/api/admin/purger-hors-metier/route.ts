import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * PURGE DES FICHES HORS MÉTIER DÉJÀ ENTRÉES EN BASE.
 *
 * ⚠️ Le filtre métier de l'import a été écrit APRÈS un chargement de 631 fiches, et le tampon
 * contenait déjà des fiches d'un import antérieur. Résultat mesuré en production : « La Cigale »
 * (salle de concert, 6 622 avis), « Castorama », « La Poste », « Truffaut », « GiFi » étaient dans
 * la file, et « Paradis Latin » (un cabaret) était DÉJÀ devenu un contact prêt à recevoir un mail
 * « refonte de votre site » signé du client.
 *
 * Corriger le filtre ne suffit donc pas : ce qui est déjà passé doit être retiré, sinon la
 * correction ne protège que les imports futurs.
 *
 * DEUX MÉCANISMES, parce qu'aucun ne suffit seul :
 *
 *  1. LE PLAFOND D'AVIS, applicable côté base sans rien d'autre. C'est le seul signal disponible
 *     rétroactivement : la catégorie Google n'était pas conservée avant aujourd'hui (colonne
 *     ajoutée dans la même livraison). Un artisan à plus de 600 avis n'existe pas.
 *
 *  2. UNE LISTE EXPLICITE de place_id, calculée à partir du fichier source par le même filtre que
 *     l'import. Elle rattrape ce que le plafond ne voit pas — un restaurant à 80 avis.
 *
 * ON NE SUPPRIME RIEN. Les fiches passent en statut 'hors_metier' et les mails encore en file
 * passent en 'cancelled'. Effacer ferait perdre la trace de ce qui a été écarté et pourquoi — et
 * un lead réimporté demain repasserait exactement par le même trou.
 *
 * Les contacts DÉJÀ DÉMARCHÉS ne sont pas touchés : le mail est parti, le retirer de la base ne le
 * rappellerait pas, et effacer l'historique d'un envoi casserait le suivi des réponses et des
 * oppositions. On les signale, on ne les réécrit pas.
 *
 * GET               → aperçu (ne modifie rien)
 * GET  ?apply=1     → applique le plafond d'avis
 * POST ?apply=1     → idem + purge la liste de place_id fournie ({"place_ids": [...]})
 */

const PLAFOND_AVIS = 600

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  let ids: string[] = []
  if (req.method === 'POST') {
    const corps = await req.json().catch(() => null) as { place_ids?: unknown } | null
    ids = Array.isArray(corps?.place_ids) ? corps!.place_ids.map(String).filter(Boolean) : []
  }

  // Ce que le plafond attrape, avec les noms : c'est ce qu'on veut lire avant d'appliquer.
  //
  // ⚠️ SANS filtre de statut, volontairement. Un premier essai ne regardait que les fiches encore
  // en attente ('new'…) et annonçait « 0 contact concerné » — alors que « Paradis Latin » (un
  // cabaret) était DÉJÀ passé en contact, donc en statut 'importe', donc invisible à la requête.
  // La fiche la plus urgente à rattraper est précisément celle qui a franchi l'étape suivante : le
  // filtre de statut cachait exactement les cas qui comptent.
  // Le statut est bien pris en compte plus bas, mais seulement pour décider quoi RÉÉCRIRE.
  const tropGros = (await sql`
    SELECT place_id, name, reviews FROM outscraper_leads
    WHERE reviews > ${PLAFOND_AVIS}
    ORDER BY reviews DESC
  `) as Array<{ place_id: string; name: string; reviews: number }>

  const parListe = ids.length
    ? (await sql`
        SELECT place_id, name, reviews FROM outscraper_leads WHERE place_id = ANY(${ids})
      `) as Array<{ place_id: string; name: string; reviews: number }>
    : []

  // Contacts issus de ces fiches. On sépare NET ceux qui n'ont rien reçu (rattrapables) de ceux
  // qui ont déjà été démarchés (irréversibles) : les confondre donnerait un compte rassurant et
  // faux, exactement le genre d'écran qui ment.
  const cibles = [...new Set([...tropGros, ...parListe].map(r => r.place_id))]
  const contactsTouches = cibles.length
    ? (await sql`
        SELECT c.id, c.email, c.company,
               COALESCE(env.n, 0)::int AS deja_envoyes,
               COALESCE(att.n, 0)::int AS en_file
        FROM contacts c
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n FROM email_queue q
          WHERE q.contact_id = c.id AND q.status = 'sent'
        ) env ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n FROM email_queue q
          WHERE q.contact_id = c.id AND q.status IN ('pending', 'scheduled')
        ) att ON TRUE
        WHERE c.google_place_id = ANY(${cibles})
      `) as Array<{ id: string; email: string; company: string; deja_envoyes: number; en_file: number }>
    : []

  const jamaisEcrits = contactsTouches.filter(c => c.deja_envoyes === 0)
  const dejaDemarches = contactsTouches.filter(c => c.deja_envoyes > 0)

  if (!apply) {
    return NextResponse.json({
      ok: true, mode: 'aperçu',
      au_dessus_du_plafond: tropGros.length,
      dans_la_liste_fournie: parListe.length,
      contacts_crees_a_partir_de_ces_fiches: contactsTouches.length,
      rattrapables_aucun_mail_parti: jamaisEcrits.length,
      irreversibles_deja_demarches: dejaDemarches.length,
      exemples: tropGros.slice(0, 12).map(r => `${r.name} — ${r.reviews} avis`),
      a_annuler: jamaisEcrits.map(c => `${c.company} (${c.en_file} en file)`),
      deja_partis: dejaDemarches.map(c => c.company),
      note: 'Relancer avec ?apply=1. Rien n\'est supprimé : les fiches passent en hors_metier, les mails en file passent en cancelled.',
    })
  }

  const fiches = (await sql`
    UPDATE outscraper_leads SET status = 'hors_metier', processed_at = NOW()
    WHERE place_id = ANY(${cibles}) AND status IN ('new', 'no_email', 'skipped_lowreviews')
    RETURNING place_id
  `) as Array<{ place_id: string }>

  // Seulement les contacts dont AUCUN mail n'est parti : annuler la file d'un prospect déjà
  // démarché le laisserait sans la suite de séquence qu'il attend, sans rien réparer.
  const idsRattrapables = jamaisEcrits.map(c => c.id)
  const annules = idsRattrapables.length
    ? (await sql`
        UPDATE email_queue SET status = 'cancelled'
        WHERE contact_id = ANY(${idsRattrapables}) AND status IN ('pending', 'scheduled')
        RETURNING id
      `) as Array<{ id: string }>
    : []

  return NextResponse.json({
    ok: true, mode: 'appliqué',
    fiches_classees_hors_metier: fiches.length,
    mails_annules_avant_envoi: annules.length,
    contacts_neutralises: idsRattrapables.length,
    deja_demarches_intouchables: dejaDemarches.map(c => c.company),
  })
}

export const GET = wrapCron('purger-hors-metier', handler)
export const POST = wrapCron('purger-hors-metier', handler)
