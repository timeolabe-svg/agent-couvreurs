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

  return NextResponse.json({ ok: true, ...out })
}
