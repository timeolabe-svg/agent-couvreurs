import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * DIAGNOSTIC DES QUATRE PANNES SIGNALÉES LE 21/08 — lecture seule, ne corrige rien.
 *
 * Timéo a signalé quatre choses le même jour :
 *   1. des conversations marquées « RDV » restent dans l'onglet « En attente »
 *   2. un prospect qui demandait à être rappelé (numéro en 06 06) n'a pas été détecté
 *   3. il ne voit qu'une boîte sur son téléphone et soupçonne qu'on rate des réponses
 *   4. une entreprise à moins de 20 avis a été démarchée
 *
 * Aucune de ces quatre-là ne se règle en relisant le code : il faut voir les données. Ce fichier
 * pose les questions, il ne répond à aucune.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const seul = req.nextUrl.searchParams.get('q')
  const out: Record<string, unknown> = {}

  // ── 1. Badge RDV mais pas de ligne de rendez-vous ────────────────────────────
  if (!seul || seul === '1') {
    out.rdv_sans_ligne = await sql`
      SELECT c.id, c.company, c.google_reviews_count, c.sector, ir.classification, ir.created_at,
             EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id) AS a_une_ligne_rdv,
             (SELECT r.status FROM rdv r WHERE r.contact_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS statut_rdv
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.classification IN ('rdv_request', 'interest', 'rdv', 'interested')
        AND ir.created_at > NOW() - INTERVAL '12 days'
      ORDER BY ir.created_at DESC
      LIMIT 20
    `
  }

  // ── 2. Le prospect qui voulait être rappelé ─────────────────────────────────
  if (!seul || seul === '2') {
    out.demandes_de_rappel = await sql`
      SELECT c.company, c.email, ir.classification, ir.created_at,
             LEFT(REGEXP_REPLACE(ir.body, '\\s+', ' ', 'g'), 260) AS extrait
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at > NOW() - INTERVAL '20 days'
        AND (ir.body ~* 'rappel|rappeler|appelez|téléphon|telephon|joignable|mon num'
             OR ir.body ~ '0[1-9]([ .-]?[0-9]{2}){4}')
      ORDER BY ir.created_at DESC
      LIMIT 25
    `
  }

  // ── 3. Les boîtes sont-elles toutes relevées, et à quel rythme ? ────────────
  if (!seul || seul === '3') {
    out.reponses_par_boite = await sql`
      SELECT m.from_email AS boite,
             COUNT(*)::int AS reponses_recues,
             MAX(ir.created_at) AS derniere
      FROM incoming_replies ir
      LEFT JOIN email_queue m ON m.id = ir.email_queue_id
      WHERE ir.created_at > NOW() - INTERVAL '14 days'
      GROUP BY m.from_email
      ORDER BY reponses_recues DESC
    `
    out.passages_du_poller = await sql`
      SELECT last_run_at, last_ok, last_detail
      FROM cron_heartbeats WHERE cron_name = 'poll-imap-replies'
    `
    /**
     * ⚠️ LA VRAIE QUESTION N'EST PAS « LES 4 BOÎTES SONT-ELLES LUES » mais « le traitement
     * va-t-il au bout ». Une boîte ouverte dont on ne traite qu'un message par passage laisse
     * grossir un retard que rien n'affiche.
     */
    out.retard_de_traitement = await sql`
      SELECT COUNT(*)::int AS reponses_sans_classification,
             MIN(created_at) AS la_plus_ancienne
      FROM incoming_replies
      WHERE classification IS NULL AND created_at > NOW() - INTERVAL '30 days'
    `
  }

  // ── 4. Le filtre des 20 avis a-t-il laissé passer quelqu'un ? ───────────────
  if (!seul || seul === '4') {
    out.contactes_sous_20_avis = await sql`
      SELECT c.company, c.google_reviews_count, c.city, MIN(m.sent_at) AS premier_mail
      FROM contacts c
      JOIN email_queue m ON m.contact_id = c.id AND m.status = 'sent'
      WHERE COALESCE(c.google_reviews_count, 0) < 20
      GROUP BY c.id, c.company, c.google_reviews_count, c.city
      ORDER BY premier_mail DESC
      LIMIT 20
    `
    out.total_sous_20_avis = await sql`
      SELECT
        COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.google_reviews_count, 0) < 20)::int AS sous_20,
        COUNT(DISTINCT c.id) FILTER (WHERE c.google_reviews_count IS NULL)::int AS avis_inconnus,
        COUNT(DISTINCT c.id)::int AS total_demarches
      FROM contacts c
      JOIN email_queue m ON m.contact_id = c.id AND m.status = 'sent'
    `
  }

  // ── 5. Qui a REPONDU recemment, et combien d avis avait-il au moment du demarchage ? ──
  if (!seul || seul === '5') {
    out.repondeurs_recents = await sql`
      SELECT c.company, c.sector, c.google_reviews_count, c.city,
             ir.classification, ir.created_at,
             (SELECT MIN(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent') AS premier_mail
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at > NOW() - INTERVAL '20 days'
      ORDER BY ir.created_at DESC
      LIMIT 30
    `
  }

  // ── 6. Les relances continuent-elles de partir vers les moins de 20 avis ? ──
  if (!seul || seul === '6') {
    out.file_sous_20_avis = await sql`
      SELECT q.status, COUNT(*)::int AS n, MIN(q.scheduled_at) AS prochaine, MAX(q.sent_at) AS dernier_envoi
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE COALESCE(c.google_reviews_count, 0) < 20
      GROUP BY q.status ORDER BY n DESC
    `
    out.envois_recents_sous_20 = await sql`
      SELECT c.company, c.google_reviews_count, q.sequence_step, q.sent_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE COALESCE(c.google_reviews_count, 0) < 20 AND q.status = 'sent'
      ORDER BY q.sent_at DESC LIMIT 12
    `
  }

  // ── 7. Les conversations visibles a l ecran, avec leur nombre d avis ──
  if (!seul || seul === '7') {
    out.conversations_visibles = await sql`
      SELECT DISTINCT c.company, c.google_reviews_count, c.sector, c.city,
             (SELECT MIN(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status='sent') AS premier_mail,
             (SELECT MAX(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status='sent') AS dernier_mail
      FROM incoming_replies ir JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.archive_le IS NULL
        AND COALESCE(c.google_reviews_count, 0) < 20
      ORDER BY dernier_mail DESC NULLS LAST
      LIMIT 20
    `
  }

  // ── 8. Une opposition jamais ingeree a-t-elle ete respectee ? ──
  if (seul === '8') {
    const mail = req.nextUrl.searchParams.get('email') ?? ''
    out.contact = await sql`SELECT id, company, email, google_reviews_count FROM contacts WHERE LOWER(email) = LOWER(${mail})`
    out.blocklist = await sql`SELECT email, domain, reason, created_at FROM blocklist WHERE LOWER(email) = LOWER(${mail})`
    out.envois = await sql`
      SELECT q.status, q.sequence_step, q.sent_at, q.scheduled_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE LOWER(c.email) = LOWER(${mail}) ORDER BY COALESCE(q.sent_at, q.scheduled_at) DESC LIMIT 12
    `
  }

  // ── 9. Nettoyage des lignes versees a tort par le balayage ──
  if (seul === '9') {
    out.avant = await sql`SELECT COUNT(*)::int AS n FROM incoming_replies WHERE action_taken = 'balayage_rattrapage'`
    if (req.nextUrl.searchParams.get('supprimer') === '1') {
      /**
       * ⚠️ On ne supprime QUE ce que le balayage a inseré lui-même (action_taken), jamais une
       * réponse arrivée par le relevé normal. La colonne sert de laisse : sans elle on ne saurait
       * pas distinguer ce qu'on a versé par erreur de ce que le prospect a vraiment envoyé.
       */
      out.supprimees = await sql`
        DELETE FROM incoming_replies WHERE action_taken = 'balayage_rattrapage' RETURNING from_email
      `
    }
  }

  // ── 10. Que contiennent vraiment les brouillons en attente ? ──
  if (seul === '10') {
    out.brouillons_pending = await sql`
      SELECT rd.id, rd.status, rd.created_at, c.company, c.email,
             LEFT(rd.body, 90) AS debut,
             (rd.body LIKE '%aviez indiqué être fermé%') AS matche_reprise,
             EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)) AS blockliste
      FROM reply_drafts rd
      LEFT JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      LEFT JOIN contacts c ON c.id = ir.contact_id
      WHERE rd.status = 'pending'
      ORDER BY rd.created_at DESC LIMIT 10
    `
  }

  // ── 11. Les absences enregistrees et leur date de retour ──
  if (seul === '11') {
    out.absences = await sql`
      SELECT c.company, c.email, c.absent_jusqu_au, c.absence_vue_le,
             (c.absent_jusqu_au <= CURRENT_DATE) AS retour_passe,
             EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status IN ('confirmed','signed')) AS a_rdv,
             EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)) AS blockliste,
             EXISTS (SELECT 1 FROM reply_drafts rd JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
                     WHERE ir2.contact_id = c.id AND rd.created_at > c.absence_vue_le) AS deja_relance
      FROM contacts c WHERE c.absent_jusqu_au IS NOT NULL
      ORDER BY c.absent_jusqu_au ASC LIMIT 30
    `
  }

  // ── 12. Pourquoi le stock de nouveaux contacts ne part pas ──
  if (seul === '12') {
    out.impasse = await sql`
      SELECT
        COUNT(*)::int AS jamais_demarches,
        COUNT(*) FILTER (WHERE c.email_validated IS TRUE)::int AS valides,
        COUNT(*) FILTER (WHERE COALESCE(c.email_validated, FALSE) = FALSE)::int AS non_valides,
        COUNT(*) FILTER (WHERE COALESCE(c.email_validated, FALSE) = FALSE
                           AND EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status IN ('pending','queued')))::int AS non_valides_AVEC_file,
        COUNT(*) FILTER (WHERE COALESCE(c.email_validated, FALSE) = FALSE
                           AND NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status IN ('pending','queued')))::int AS non_valides_SANS_file,
        COUNT(*) FILTER (WHERE COALESCE(c.email_validated, FALSE) = FALSE
                           AND COALESCE(c.mv_attempts, 0) >= 2)::int AS essais_epuises,
        COUNT(*) FILTER (WHERE COALESCE(c.google_reviews_count, 0) < 20)::int AS sous_20_avis
      FROM contacts c
      WHERE NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent')
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    `
    out.sans_file_detail = await sql`
      SELECT c.sector, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20)::int AS cibles
      FROM contacts c
      WHERE NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      GROUP BY c.sector ORDER BY n DESC LIMIT 12
    `
  }

  // ── 13. Dans quel etat sont les lignes de file des contacts jamais demarches ──
  if (seul === '13') {
    out.etat_file = await sql`
      SELECT COALESCE(q.status, 'AUCUNE LIGNE') AS statut,
             COUNT(DISTINCT c.id)::int AS contacts,
             COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20)::int AS cibles_20avis,
             COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20 AND COALESCE(c.mv_attempts,0) < 2)::int AS cibles_encore_retentables
      FROM contacts c
      LEFT JOIN email_queue q ON q.contact_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM email_queue s2 WHERE s2.contact_id = c.id AND s2.status = 'sent')
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
        AND COALESCE(c.email_validated, FALSE) = FALSE
      GROUP BY q.status ORDER BY contacts DESC
    `
  }

  // ── 14. Les 500 annulations sont-elles volontaires ou accidentelles ? ──
  if (seul === '14') {
    /**
     * mv_attempts n'est incremente QUE sur un verdict rendu par MillionVerifier (le code ne compte
     * ni les pannes HTTP ni les erreurs de credits). Un contact annule AVEC des essais a donc ete
     * ecarte volontairement pour eviter un bounce ; un contact annule SANS essai a ete ecarte pour
     * une autre raison, et c est celui-la qui peut etre recuperable.
     */
    out.annulations = await sql`
      SELECT COALESCE(c.mv_attempts, 0) AS essais_mv,
             COUNT(DISTINCT c.id)::int AS contacts,
             COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20)::int AS cibles_20avis
      FROM contacts c
      WHERE COALESCE(c.email_validated, FALSE) = FALSE
        AND NOT EXISTS (SELECT 1 FROM email_queue s2 WHERE s2.contact_id = c.id AND s2.status = 'sent')
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
        AND EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'cancelled')
      GROUP BY COALESCE(c.mv_attempts, 0) ORDER BY essais_mv
    `
  }

  // ── 15. Un prospect attend-il une reponse qu on ne lui enverra jamais ? ──
  if (seul === '15') {
    out.rdv_tct = await sql`
      SELECT r.scheduled_at, r.status, r.crm_stage, r.created_at, LEFT(COALESCE(r.notes,''), 200) AS notes, c.company
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE c.company ILIKE '%TCT%' ORDER BY r.created_at DESC
    `
    out.brouillons_tct = await sql`
      SELECT rd.status, rd.created_at, rd.sent_at, LEFT(rd.body, 120) AS debut
      FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      JOIN contacts c ON c.id = ir.contact_id
      WHERE c.company ILIKE '%TCT%' ORDER BY rd.created_at DESC LIMIT 6
    `
    /**
     * Le cas general : une reponse de prospect qui n a JAMAIS ete suivie d un message de l agent.
     * C est l invariant  zero lead perdu  applique a la lettre.
     */
    out.reponses_sans_suite = await sql`
      SELECT c.company, ir.classification, ir.created_at,
             EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status IN ('confirmed','signed')) AS a_rdv,
             (SELECT rd.status FROM reply_drafts rd WHERE rd.incoming_reply_id = ir.id ORDER BY rd.created_at DESC LIMIT 1) AS dernier_brouillon
      FROM incoming_replies ir JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at > NOW() - INTERVAL '30 days'
        AND ir.classification NOT IN ('oof','spam','desinterest')
        AND NOT EXISTS (
          SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent' AND q.sent_at > ir.created_at
        )
      ORDER BY ir.created_at ASC
    `
  }

  // ── 16. OU PART LE STOCK : envoye, ou detruit par la validation ? ──
  if (seul === '16') {
    out.sorties_par_jour = await sql`
      SELECT jour, SUM(envoyes)::int AS envoyes, SUM(rejetes)::int AS detruits_par_validation
      FROM (
        SELECT DATE(q.sent_at) AS jour, COUNT(DISTINCT q.contact_id) AS envoyes, 0 AS rejetes
        FROM email_queue q WHERE q.status='sent' AND q.sequence_step=0 AND q.sent_at > NOW() - INTERVAL '10 days'
        GROUP BY DATE(q.sent_at)
        UNION ALL
        SELECT DATE(c.mv_last_attempt_at) AS jour, 0, COUNT(*)
        FROM contacts c
        WHERE c.mv_last_attempt_at > NOW() - INTERVAL '10 days'
          AND COALESCE(c.email_validated, FALSE) = FALSE
          AND NOT EXISTS (SELECT 1 FROM email_queue q2 WHERE q2.contact_id=c.id AND q2.status='sent')
        GROUP BY DATE(c.mv_last_attempt_at)
      ) x GROUP BY jour ORDER BY jour DESC
    `
    out.verdicts_mv = await sql`
      SELECT COUNT(*)::int AS testes_10j,
             COUNT(*) FILTER (WHERE c.email_validated IS TRUE)::int AS acceptes,
             COUNT(*) FILTER (WHERE COALESCE(c.email_validated,FALSE) = FALSE)::int AS refuses
      FROM contacts c WHERE c.mv_last_attempt_at > NOW() - INTERVAL '10 days'
    `
    out.envois_par_boite_par_jour = await sql`
      SELECT DATE(q.sent_at) AS jour, q.sent_via AS boite, COUNT(*)::int AS mails
      FROM email_queue q
      WHERE q.status='sent' AND q.sent_at > NOW() - INTERVAL '5 days'
      GROUP BY DATE(q.sent_at), q.sent_via ORDER BY jour DESC, mails DESC
    `
  }

  // ── 17. D ou viennent les contacts, et quand ont-ils ete crees ? ──
  if (seul === '17') {
    out.creations_par_jour = await sql`
      SELECT DATE(created_at) AS jour, source, COUNT(*)::int AS n
      FROM contacts WHERE created_at > NOW() - INTERVAL '20 days'
      GROUP BY DATE(created_at), source ORDER BY jour DESC, n DESC
    `
    out.total_par_source = await sql`
      SELECT COALESCE(source,'(nul)') AS source, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE email_validated IS TRUE)::int AS valides,
             MIN(created_at) AS premier, MAX(created_at) AS dernier
      FROM contacts GROUP BY source ORDER BY total DESC
    `
  }

  // ── 18. La couverture enregistree correspond-elle a des villes VRAIMENT cherchees ? ──
  if (seul === '18') {
    out.distribution = await sql`
      SELECT categorie,
             COUNT(*)::int AS villes,
             COUNT(*) FILTER (WHERE fiches = 1)::int AS avec_1_fiche,
             COUNT(*) FILTER (WHERE fiches BETWEEN 2 AND 5)::int AS avec_2_a_5,
             COUNT(*) FILTER (WHERE fiches BETWEEN 6 AND 20)::int AS avec_6_a_20,
             COUNT(*) FILTER (WHERE fiches > 20)::int AS avec_plus_de_20,
             SUM(fiches)::int AS fiches_total
      FROM scrape_couverture GROUP BY categorie ORDER BY villes DESC
    `
    out.les_plus_fournies = await sql`
      SELECT categorie, ville, fiches, importe_le FROM scrape_couverture
      ORDER BY fiches DESC LIMIT 20
    `
    out.les_plus_maigres = await sql`
      SELECT categorie, ville, fiches FROM scrape_couverture
      WHERE fiches <= 2 ORDER BY categorie, ville LIMIT 25
    `
  }

  // ── 19. Les vraies villes cherchees sont-elles vues par le planificateur ? ──
  if (seul === '19') {
    out.villes_reelles_terrassier = await sql`
      SELECT ville, fiches FROM scrape_couverture WHERE categorie = 'terrassier' ORDER BY fiches DESC
    `
    out.villes_reelles_pisciniste = await sql`
      SELECT ville, fiches FROM scrape_couverture WHERE categorie = 'pisciniste' ORDER BY fiches DESC
    `
  }

  // ── 20. Deux messages quasi identiques envoyes a la suite au meme contact ──
  if (seul === '20') {
    out.envois = await sql`
      SELECT c.company, c.email, q.sequence_step, q.sent_at, q.subject,
             LEFT(REGEXP_REPLACE(q.body, '\s+', ' ', 'g'), 400) AS corps
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '25 days'
      ORDER BY c.id, q.sent_at ASC
    `
  }

  // ── 21. Le corps BRUT, sans aucune transformation SQL ──
  if (seul === '21') {
    out.brut = await sql`
      SELECT q.sequence_step, q.sent_at, q.sent_via, LEFT(q.body, 300) AS corps_brut, LENGTH(q.body) AS taille
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE c.email = 'plomberiemultiservices@gmail.com' OR c.company ILIKE '%Plomberie Multi Services%'
      ORDER BY q.sent_at DESC LIMIT 6
    `
  }

  // ── 22. Pourquoi le moteur ne reclame rien alors que des mails sont prets ──
  if (seul === '22') {
    out.file_step0 = await sql`
      SELECT q.status,
             COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE q.scheduled_at <= NOW())::int AS echus,
             MIN(q.scheduled_at) AS plus_tot, MAX(q.scheduled_at) AS plus_tard
      FROM email_queue q WHERE q.sequence_step = 0 GROUP BY q.status ORDER BY n DESC
    `
    out.par_boite_aujourdhui = await sql`
      SELECT sent_via AS boite, COUNT(*)::int AS envoyes_aujourdhui
      FROM email_queue WHERE status='sent' AND sent_at::date = CURRENT_DATE
      GROUP BY sent_via ORDER BY envoyes_aujourdhui DESC
    `
    out.prochains_creneaux = await sql`
      SELECT DATE(scheduled_at) AS jour, COUNT(*)::int AS n
      FROM email_queue WHERE status='queued' AND sequence_step = 0
      GROUP BY DATE(scheduled_at) ORDER BY jour LIMIT 8
    `
  }

  // ── 23. Quelle ETAPE de la sequence rapporte les reponses ? ──
  if (seul === '23') {
    /**
     * Pour chaque reponse de prospect, on regarde le DERNIER mail envoye avant elle et son etape.
     * C est la seule facon de dire si les relances tardives servent a quelque chose ou si elles ne
     * font que consommer la capacite des boites.
     */
    out.reponses_par_etape = await sql`
      SELECT etape,
             COUNT(*)::int AS reponses,
             COUNT(*) FILTER (WHERE classification IN ('rdv_request','interest'))::int AS chaudes,
             COUNT(*) FILTER (WHERE classification = 'desinterest')::int AS refus
      FROM (
        SELECT ir.classification,
               (SELECT q.sequence_step FROM email_queue q
                 WHERE q.contact_id = ir.contact_id AND q.status='sent' AND q.sent_at < ir.created_at
                 ORDER BY q.sent_at DESC LIMIT 1) AS etape
        FROM incoming_replies ir
        WHERE ir.contact_id IS NOT NULL
          AND ir.classification NOT IN ('oof','spam')
      ) x WHERE etape IS NOT NULL
      GROUP BY etape ORDER BY etape
    `
    out.envois_par_etape = await sql`
      SELECT sequence_step AS etape, COUNT(*)::int AS envoyes
      FROM email_queue WHERE status='sent' AND sequence_step < 20
      GROUP BY sequence_step ORDER BY sequence_step
    `
  }

  // ── 24. Qui a cree ce rendez-vous, et sur quel message ? ──
  if (seul === '24') {
    const nom = req.nextUrl.searchParams.get('entreprise') ?? ''
    out.rdv = await sql`
      SELECT r.id, r.scheduled_at, r.status, r.crm_stage, r.created_at, r.incoming_reply_id,
             LEFT(COALESCE(r.notes,''), 300) AS notes, c.company
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE c.company ILIKE ${'%' + nom + '%'} ORDER BY r.created_at DESC
    `
    out.messages = await sql`
      SELECT 'recu' AS sens, ir.created_at, ir.classification,
             LEFT(REGEXP_REPLACE(ir.body, E'\s+', ' ', 'g'), 200) AS texte
      FROM incoming_replies ir JOIN contacts c ON c.id = ir.contact_id
      WHERE c.company ILIKE ${'%' + nom + '%'}
      UNION ALL
      SELECT 'envoye', q.sent_at, 'step ' || q.sequence_step,
             LEFT(REGEXP_REPLACE(q.body, E'\s+', ' ', 'g'), 200)
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE c.company ILIKE ${'%' + nom + '%'} AND q.status = 'sent'
      ORDER BY 2 ASC
    `
  }

  // ── 25. Les derniers messages RECUS d un contact, non tronques ──
  if (seul === '25') {
    const mail = (req.nextUrl.searchParams.get('email') ?? '').toLowerCase()
    out.recus = await sql`
      SELECT ir.created_at, ir.classification, ir.subject, LEFT(ir.body, 500) AS corps
      FROM incoming_replies ir
      WHERE LOWER(ir.from_email) = ${mail}
      ORDER BY ir.created_at DESC LIMIT 5
    `
  }

  // ── 26. Ce qui est parti vers un prospect, toutes mains confondues ──
  if (seul === '26') {
    const mail = (req.nextUrl.searchParams.get('email') ?? '').toLowerCase()
    out.sortants = await sql`
      SELECT envoye_le, boite, LEFT(sujet, 90) AS sujet FROM messages_humains
      WHERE LOWER(destinataire) = ${mail} ORDER BY envoye_le DESC LIMIT 12
    `
  }

  // ── 27. Purge des communes marquees couvertes a tort (apercu puis application) ──
  if (seul === '27') {
    /**
     * ⚠️ ON SUPPRIME PLUTOT QUE DE GARDER UN DOUTE. Re-scraper une commune coute quelques
     * centimes ; ne jamais la scraper coute TOUS ses leads, definitivement et sans que rien ne le
     * signale. Face a une incertitude, on penche du cote reversible.
     */
    const seuil = parseInt(req.nextUrl.searchParams.get('seuil') ?? '5', 10)
    out.a_supprimer = await sql`
      SELECT categorie, COUNT(*)::int AS villes, COALESCE(SUM(fiches), 0)::int AS fiches
      FROM scrape_couverture WHERE fiches <= ${seuil}
      GROUP BY categorie ORDER BY villes DESC
    `
    out.exemples = await sql`
      SELECT categorie, ville, fiches FROM scrape_couverture
      WHERE fiches <= ${seuil} ORDER BY fiches DESC LIMIT 10
    `
    if (req.nextUrl.searchParams.get('supprimer') === '1') {
      const del = (await sql`
        DELETE FROM scrape_couverture WHERE fiches <= ${seuil} RETURNING ville
      `) as unknown[]
      out.supprimees = del.length
    }
  }

  // ── 28. Changements d adresse : la sequence a-t-elle ete arretee ? ──
  /**
   * ── 28. UN CHANGEMENT D'ADRESSE A-T-IL ARRÊTÉ LA SÉQUENCE ? ────────────────────
   *
   * Bleu 30 Piscines a écrit le 14/07 « veuillez noter notre changement d'adresse mail ». Six mails
   * sont partis APRÈS, à l'ancienne adresse, jusqu'au 30/07. On mesure ici l'étendue réelle.
   *
   * ⚠️ Volontairement SANS expression régulière : les deux tentatives précédentes ont vu leurs
   * antislashes mangés par le shell et rendaient zéro ligne — une requête qui ne trouve rien
   * ressemble exactement à un problème qui n'existe pas.
   */
  if (seul === '28') {
    out.redirections = await sql`
      WITH signale AS (
        SELECT ir.contact_id, MIN(ir.created_at) AS le
        FROM incoming_replies ir
        WHERE ir.body ILIKE '%changement d%adresse%'
           OR ir.body ILIKE '%nouvelle adresse%'
           OR ir.body ILIKE '%nouveau mail%'
           OR ir.body ILIKE '%nouvel email%'
        GROUP BY ir.contact_id
      )
      SELECT c.company, c.email, c.redirige_vers, s.le AS signale_le,
             (SELECT COUNT(*) FROM email_queue q
               WHERE q.contact_id = c.id AND q.status = 'sent' AND q.sent_at > s.le)::int AS mails_apres,
             (SELECT COUNT(*) FROM email_queue q
               WHERE q.contact_id = c.id AND q.status IN ('queued','pending'))::int AS encore_en_file
      FROM signale s JOIN contacts c ON c.id = s.contact_id
      ORDER BY mails_apres DESC
    `
  }

  /**
   * ── 29. ARRÊTER LES SÉQUENCES QUI PARTENT VERS UNE ADRESSE ABANDONNÉE ─────────
   *
   * ⚠️ UN CORRECTIF DE CAUSE NE RÉPARE PAS LE PASSÉ. Le poller annule bien la file depuis août
   * quand un prospect annonce une nouvelle adresse. Mais les changements signalés AVANT ce
   * correctif n'ont jamais été traités : Bleu 30 Piscines a reçu six mails après son message du
   * 14/07, MOREL trois, et SAE REOLON en avait encore TROIS en file au 26/08 — prêts à partir vers
   * une boîte que le prospect a lui-même déclarée abandonnée.
   *
   * ⚠️ Et l'outil censé rattraper ces cas (`rattacher-redirections`) répondait « APPLIQUÉ » en
   * n'écrivant rien : `fiches_mises_a_jour: 0`. Un outil de réparation qui annonce une action qu'il
   * ne fait pas est pire qu'une absence d'outil, parce qu'on le croit.
   *
   * On annule donc la file, et on marque la fiche comme redirigée pour qu'elle sorte de la
   * messagerie active. On ne SUPPRIME rien : l'historique des envois reste lisible.
   */
  if (seul === '29') {
    const aArreter = await sql`
      WITH signale AS (
        SELECT ir.contact_id, MIN(ir.created_at) AS le
        FROM incoming_replies ir
        WHERE ir.body ILIKE '%changement d%adresse%'
           OR ir.body ILIKE '%nouvelle adresse%'
           OR ir.body ILIKE '%nouveau mail%'
           OR ir.body ILIKE '%nouvel email%'
        GROUP BY ir.contact_id
      )
      SELECT c.id, c.company, c.email,
             (SELECT COUNT(*) FROM email_queue q
               WHERE q.contact_id = c.id AND q.status IN ('queued','pending','sending'))::int AS en_file
      FROM signale s JOIN contacts c ON c.id = s.contact_id
      WHERE c.redirige_vers IS NULL
      ORDER BY en_file DESC
    `
    out.a_arreter = aArreter

    if (req.nextUrl.searchParams.get('appliquer') === '1') {
      const ids = (aArreter as Array<{ id: string }>).map(r => r.id)
      if (ids.length > 0) {
        const annules = (await sql`
          UPDATE email_queue SET status = 'cancelled'
          WHERE contact_id = ANY(${ids}) AND status IN ('queued','pending','sending')
          RETURNING id
        `) as unknown[]
        await sql`
          UPDATE contacts SET redirige_vers = COALESCE(redirige_vers, 'adresse abandonnée, signalée par le prospect')
          WHERE id = ANY(${ids})
        `
        out.mails_annules = annules.length
        out.fiches_marquees = ids.length
      }
    }
  }

  /** 30. Ce qui a été RÉPONDU à des messages classés robot (invariant D5) — pour trancher alarme ou faux positif. */
  if (seul === '30') {
    out.reponses_a_des_robots = await sql`
      SELECT ir.from_email, ir.classification, rd.sent_at,
             LEFT(REPLACE(ir.body, E'\n', ' '), 130) AS message_recu,
             LEFT(REPLACE(rd.body, E'\n', ' '), 200) AS notre_reponse
      FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE rd.status = 'sent' AND ir.classification IN ('oof', 'spam', 'warmup')
      ORDER BY rd.sent_at DESC LIMIT 20`
  }

  /** 31. Le brouillon refusé par Timéo puis renvoyé (invariant D2). */
  if (seul === '31') {
    out.refuse_puis_renvoye = await sql`
      SELECT ir.from_email, rd.status, rd.rejete_par, rd.rejete_le, rd.sent_at,
             LEFT(REPLACE(rd.body, E'\n', ' '), 220) AS corps
      FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE LOWER(ir.from_email) = 'lesagecouvreur@gmail.com'
      ORDER BY rd.created_at LIMIT 20`
  }

  /** 32. Étapes de séquence parties à moins de 24 h l'une de l'autre — sur TOUT l'historique. */
  if (seul === '32') {
    out.sequences_trop_rapprochees = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sequence_step, q.sent_at, q.scheduled_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent,
               LAG(q.sequence_step) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS step_precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT c.email, e.step_precedent, e.sequence_step, e.precedent, e.sent_at, e.scheduled_at,
             ROUND(EXTRACT(EPOCH FROM (e.sent_at - e.precedent)) / 60)::int AS minutes
      FROM e JOIN contacts c ON c.id = e.contact_id
      WHERE e.precedent IS NOT NULL AND e.sent_at - e.precedent < INTERVAL '24 hours'
      ORDER BY e.sent_at DESC LIMIT 60`
    const [t] = (await sql`
      WITH e AS (
        SELECT q.contact_id, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT COUNT(*)::int AS n FROM e
      WHERE precedent IS NOT NULL AND sent_at - precedent < INTERVAL '24 hours'`) as Array<{ n: number }>
    out.total_reel = t?.n ?? 0
  }

  /** 33. Répartition des écarts entre deux étapes de séquence, et étapes parties dans le désordre. */
  if (seul === '33') {
    out.repartition_des_ecarts = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT CASE
               WHEN sent_at - precedent < INTERVAL '2 hours'  THEN 'a. moins de 2 h'
               WHEN sent_at - precedent < INTERVAL '12 hours' THEN 'b. 2 h a 12 h'
               WHEN sent_at - precedent < INTERVAL '23 hours' THEN 'c. 12 h a 23 h'
               WHEN sent_at - precedent < INTERVAL '25 hours' THEN 'd. environ 1 jour'
               WHEN sent_at - precedent < INTERVAL '2 days'   THEN 'e. 1 a 2 jours'
               ELSE 'f. 2 jours ou plus (normal)' END AS ecart,
             COUNT(*)::int AS n
      FROM e WHERE precedent IS NOT NULL
      GROUP BY 1 ORDER BY 1`
    out.etapes_dans_le_desordre = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sequence_step, q.sent_at,
               LAG(q.sequence_step) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS step_precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT COUNT(*)::int AS n FROM e
      WHERE step_precedent IS NOT NULL AND sequence_step < step_precedent`
    out.ecarts_recents = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT COUNT(*)::int AS moins_de_2_jours_depuis_le_20_aout FROM e
      WHERE precedent IS NOT NULL AND sent_at > '2026-08-20' AND sent_at - precedent < INTERVAL '2 days'`
  }

  /** 34. Quand les envois trop rapprochés ont-ils eu lieu ? Dette ancienne ou fuite en cours ? */
  if (seul === '34') {
    out.par_semaine = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT to_char(date_trunc('week', sent_at), 'YYYY-MM-DD') AS semaine,
             COUNT(*) FILTER (WHERE sent_at - precedent < INTERVAL '2 hours')::int AS moins_2h,
             COUNT(*) FILTER (WHERE sent_at - precedent < INTERVAL '2 days')::int AS moins_2j,
             COUNT(*)::int AS total_paires
      FROM e WHERE precedent IS NOT NULL
      GROUP BY 1 ORDER BY 1`
    out.les_29_recents = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sequence_step, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent,
               LAG(q.sequence_step) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS step_precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT c.email, e.step_precedent, e.sequence_step, e.precedent, e.sent_at,
             ROUND(EXTRACT(EPOCH FROM (e.sent_at - e.precedent)) / 3600)::int AS heures
      FROM e JOIN contacts c ON c.id = e.contact_id
      WHERE e.precedent IS NOT NULL AND e.sent_at > '2026-08-20'
        AND e.sent_at - e.precedent < INTERVAL '2 days'
      ORDER BY e.sent_at DESC LIMIT 30`
  }

  /** 35. Étapes parties dans le désordre (step 4 avant step 3) — datées, pour séparer dette et fuite. */
  if (seul === '35') {
    out.desordre_par_semaine = await sql`
      WITH e AS (
        SELECT q.contact_id, q.sequence_step, q.sent_at,
               LAG(q.sequence_step) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS step_precedent
        FROM email_queue q WHERE q.status = 'sent' AND q.sequence_step < 20
      )
      SELECT to_char(date_trunc('week', sent_at), 'YYYY-MM-DD') AS semaine, COUNT(*)::int AS n
      FROM e WHERE step_precedent IS NOT NULL AND sequence_step < step_precedent
      GROUP BY 1 ORDER BY 1`
    out.placeholder_bloque = await sql`
      SELECT q.id, c.email, c.company, q.sequence_step, q.created_at, q.scheduled_at, q.status
      FROM email_queue q LEFT JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'pending' AND q.body = '__pending_generation__'`
  }

  /**
   * 36. LE RATTACHEMENT PAR OBJET DÉSIGNE-T-IL QUELQU'UN ? (signalé par la session LabegarIA, 26/08)
   *
   * Quand un prospect répond depuis une adresse inconnue, on le rattache au contact par l'OBJET du
   * mail, en prenant le plus récent. Or un objet de CAMPAGNE est identique pour des centaines de
   * contacts : le « plus récent » n'est alors pas l'auteur de la réponse, c'est quelqu'un d'autre.
   * On mesure donc, pour chaque objet réellement utilisé, combien de contacts distincts le portent.
   */
  if (seul === '36') {
    out.objets_ambigus = await sql`
      SELECT LOWER(subject) AS objet,
             COUNT(DISTINCT contact_id)::int AS contacts_distincts,
             MAX(sent_at) AS dernier_envoi
      FROM email_queue
      WHERE status = 'sent' AND subject IS NOT NULL AND contact_id IS NOT NULL
      GROUP BY LOWER(subject)
      HAVING COUNT(DISTINCT contact_id) > 1
      ORDER BY 2 DESC LIMIT 15`
    const [t] = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE n > 1)::int AS objets_ambigus,
        COUNT(*)::int AS objets_total,
        COALESCE(MAX(n), 0)::int AS pire_cas
      FROM (
        SELECT COUNT(DISTINCT contact_id) AS n
        FROM email_queue
        WHERE status = 'sent' AND subject IS NOT NULL AND contact_id IS NOT NULL
        GROUP BY LOWER(subject)
      ) x`) as Array<{ objets_ambigus: number; objets_total: number; pire_cas: number }>
    out.synthese = t
    // Combien de réponses sont réellement passées par ce chemin (expéditeur inconnu des fiches) ?
    out.reponses_d_expediteurs_inconnus = await sql`
      SELECT COUNT(*)::int AS n FROM incoming_replies ir
      WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE LOWER(c.email) = LOWER(ir.from_email))`
  }

  /**
   * 37. LES 9 RATTACHEMENTS AMBIGUS ONT-ILS COÛTÉ UNE ENTREPRISE ?
   *
   * Un rattachement faux ne fait de dégât que s'il a ÉCRIT. On regarde donc, pour chaque fiche
   * touchée : sa classification, si elle a été blocklistée, et si sa file a été annulée. Une
   * entreprise blocklistée à cause du refus de quelqu'un d'autre est un lead perdu définitif — et
   * elle ne viendra jamais réclamer.
   */
  if (seul === '37') {
    out.degats = await sql`
      SELECT ir.from_email, c.email AS fiche, c.company, ir.classification, ir.action_taken,
             ir.created_at,
             EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)) AS fiche_blocklistee,
             (SELECT b.reason FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email) LIMIT 1) AS motif_blocage,
             (SELECT COUNT(*)::int FROM email_queue q
               WHERE q.contact_id = c.id AND q.status = 'cancelled') AS mails_annules,
             (SELECT COUNT(*)::int FROM email_queue q
               WHERE q.contact_id = c.id AND q.status IN ('queued','pending')) AS encore_en_file
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.subject IS NOT NULL
        AND LOWER(c.email) <> LOWER(ir.from_email)
        AND (SELECT COUNT(DISTINCT eq.contact_id) FROM email_queue eq
              WHERE LOWER(eq.subject) = LOWER(ir.subject) AND eq.status = 'sent') > 1
      ORDER BY ir.created_at DESC`
  }

  /** 38. À quelle HEURE DE PARIS partent réellement les mails, et quel jour de la semaine ? */
  if (seul === '38') {
    out.par_heure_paris = await sql`
      SELECT EXTRACT(HOUR FROM sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::int AS heure,
             COUNT(*)::int AS n
      FROM email_queue
      WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '14 days'
      GROUP BY 1 ORDER BY 1`
    out.week_end = await sql`
      SELECT to_char(sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris', 'Dy') AS jour,
             COUNT(*)::int AS n
      FROM email_queue
      WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '14 days'
      GROUP BY 1 ORDER BY 2 DESC`
  }

  /** 39. L'entonnoir dit-il enfin la vérité ? Des PERSONNES, jamais des mails. */
  if (seul === '39') {
    const [r] = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM contacts) AS prospects,
        (SELECT COUNT(*)::int FROM email_queue WHERE status = 'sent') AS mails_envoyes,
        (SELECT COUNT(DISTINCT contact_id)::int FROM email_queue WHERE status = 'sent') AS personnes_contactees,
        (SELECT COUNT(DISTINCT LOWER(from_email))::int FROM incoming_replies
          WHERE classification IS NULL OR classification NOT IN ('spam','oof')) AS personnes_ayant_repondu
    `) as Array<Record<string, number>>
    out.entonnoir = {
      ...r,
      taux_de_reponse_juste: r.personnes_contactees > 0
        ? +((r.personnes_ayant_repondu / r.personnes_contactees) * 100).toFixed(1) : 0,
      taux_de_reponse_avant_correctif: r.mails_envoyes > 0
        ? +((r.personnes_ayant_repondu / r.mails_envoyes) * 100).toFixed(1) : 0,
    }
  }

  return NextResponse.json({ ok: true, ...out })
}
