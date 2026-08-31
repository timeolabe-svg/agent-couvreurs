import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 📨 AUDIT DU CONTENU RÉELLEMENT ENVOYÉ, ET DE LA QUALITÉ DES LEADS EN FILE.
 *
 * ⚠️ DEUX ZONES QUE JE N'AI JAMAIS AUDITÉES AUTREMENT QU'EN LISANT LE CODE.
 *
 * Tout ce que j'ai vérifié jusqu'ici portait sur la mécanique : les routes répondent, les crons
 * battent, les colonnes existent. Mais un prospect ne reçoit pas une mécanique — il reçoit un TEXTE,
 * et ce texte peut être parfaitement produit par un système parfaitement sain :
 *   · une consigne de style non respectée (tiret cadratin, deux-points) ;
 *   · un pied de page légal absent = infraction à l'article 14 ;
 *   · un gabarit non remplacé (« Bonjour {{prenom}} ») ;
 *   · un numéro de téléphone inventé — 368 prospects en ont déjà reçu un.
 *
 * Et symétriquement : la file peut être pleine de gens qu'on n'aurait jamais dû démarcher.
 *
 * Lecture seule. On lit ce qui est EN FILE (donc ce qui va partir) et ce qui est PARTI récemment.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL absent' }, { status: 503 })

  const { sql } = await import('@/lib/db')
  const out: Record<string, unknown> = {}
  const quoi = req.nextUrl.searchParams.get('quoi') ?? 'contenu'

  if (quoi === 'contenu') {
    /**
     * ⚠️ On regarde les mails EN FILE (`queued`/`pending`) : ce sont ceux qu'on peut encore
     * empêcher de partir. Les mails déjà envoyés sont comptés à part, comme dette.
     */
    out.en_file = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE body NOT ILIKE '%sources publiques%' AND body NOT ILIKE '%pour ne plus recevoir%')::int AS sans_mention_legale,
        COUNT(*) FILTER (WHERE body NOT ILIKE '%/u/%')::int AS sans_lien_desabonnement,
        COUNT(*) FILTER (WHERE body LIKE '%—%' OR body LIKE '%–%' OR subject LIKE '%—%')::int AS avec_tiret_cadratin,
        COUNT(*) FILTER (WHERE body LIKE '%{{%' OR body LIKE '%[[%' OR body ILIKE '%__pending%' OR subject LIKE '%{{%')::int AS gabarit_non_remplace,
        COUNT(*) FILTER (WHERE subject IS NULL OR BTRIM(subject) = '')::int AS sujet_vide,
        COUNT(*) FILTER (WHERE LENGTH(body) < 120)::int AS corps_trop_court,
        COUNT(*) FILTER (WHERE LENGTH(body) > 4000)::int AS corps_tres_long
      FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'`

    /**
     * ⚠️ TOUT NUMÉRO SORTANT DOIT ÊTRE LE VRAI. Incident du 08/08 : Gemini inventait la signature et
     * 368 prospects ont reçu un faux numéro. Le vrai est `06 29 99 03 96`. On cherche donc TOUS les
     * numéros français dans les corps, et on écarte celui-là.
     */
    out.numeros_sortants = await sql`
      SELECT numero, COUNT(*)::int AS occurrences, MIN(statut) AS vu_en
      FROM (
        SELECT REGEXP_REPLACE((REGEXP_MATCHES(body, '0[1-9](?:[ .-]?[0-9]{2}){4}', 'g'))[1], '[^0-9]', '', 'g') AS numero,
               status AS statut
        FROM email_queue
        WHERE status IN ('queued', 'pending', 'sent') AND sent_at > NOW() - INTERVAL '30 days'
      ) x
      WHERE numero <> '0629990396'
      GROUP BY numero ORDER BY 2 DESC LIMIT 10`

    /**
     * ⚠️ DATER ET COMPTER EN PERSONNES AVANT DE CRIER. Un décompte d'occurrences ne dit rien : le
     * même mail peut citer le numéro deux fois, et une dette de juillet n'est pas une fuite en cours.
     * On veut : combien de MAILS, combien de PERSONNES, et sur quelle période.
     */
    out.faux_numero = await sql`
      SELECT
        COUNT(*)::int AS mails,
        COUNT(DISTINCT contact_id)::int AS personnes,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS deja_partis,
        COUNT(*) FILTER (WHERE status IN ('queued','pending'))::int AS encore_en_file,
        MIN(sent_at) AS premier_envoi, MAX(sent_at) AS dernier_envoi
      FROM email_queue
      WHERE body ~ '0[ .-]?6[ .-]?12[ .-]?34[ .-]?56[ .-]?78'`

    /** Les deux-points dans le corps : consigne de style de Timéo. On exclut les URL (http://). */
    out.deux_points = await sql`
      SELECT COUNT(*)::int AS n FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'
        AND REGEXP_REPLACE(body, 'https?://[^ ]*', '', 'g') LIKE '%:%'`

    /** Échantillon lisible : un mail réellement en file, pour juger à l'œil. */
    out.exemple = await sql`
      SELECT subject, LEFT(body, 700) AS corps
      FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'
      ORDER BY scheduled_at LIMIT 1`
  }

  if (quoi === 'leads') {
    /**
     * QUI VA ÊTRE DÉMARCHÉ ? Un moteur sain qui écrit à la mauvaise cible reste un moteur qui gâche
     * la réputation des boîtes et le temps du client.
     */
    out.file_a_partir = await sql`
      SELECT
        COUNT(DISTINCT c.id)::int AS personnes,
        COUNT(DISTINCT c.id) FILTER (WHERE c.google_reviews_count IS NOT NULL AND c.google_reviews_count < 20)::int AS sous_20_avis,
        COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.email_validated, false) = false)::int AS non_valides,
        COUNT(DISTINCT c.id) FILTER (WHERE c.redirige_vers IS NOT NULL)::int AS fiches_redirigees,
        COUNT(DISTINCT c.id) FILTER (WHERE c.absent_jusqu_au IS NOT NULL AND c.absent_jusqu_au > CURRENT_DATE)::int AS absents,
        COUNT(DISTINCT c.id) FILTER (WHERE c.pression_signalee_at IS NOT NULL)::int AS ont_signale_la_pression,
        COUNT(DISTINCT c.id) FILTER (WHERE EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)))::int AS blocklistes,
        COUNT(DISTINCT c.id) FILTER (WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id))::int AS ont_deja_repondu
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')`

    out.par_metier = await sql`
      SELECT COALESCE(c.sector, '(vide)') AS metier, COUNT(DISTINCT c.id)::int AS personnes
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`

    out.doublons_par_entreprise = await sql`
      SELECT LOWER(BTRIM(company)) AS entreprise, COUNT(*)::int AS fiches
      FROM contacts WHERE company IS NOT NULL AND BTRIM(company) <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC LIMIT 10`
  }

  /**
   * SUPPRESSION DES TROIS FICHES BLOQUÉES À TORT (décision de Timéo, 27/08).
   *
   * Paradis Latin, France Bâtiment FBRE et Emmanuel Lambal ont été blocklistées à cause du refus de
   * QUELQU'UN D'AUTRE : une réponse venue d'une adresse inconnue avait été rattachée à leur dossier
   * par l'objet du mail, alors que cet objet servait à des dizaines de contacts.
   *
   * Timéo tranche : on les retire de la base, elles ne seront plus jamais démarchées.
   *
   * ⚠️ ON CONSERVE L'ENTRÉE DE BLOCKLIST, et on l'ajoute si elle manque. Supprimer la fiche sans
   * cela ne protège de rien : le prochain import Outscraper les remettrait dans la file, et on
   * recommencerait. La blocklist est la seule mémoire qui survit à une suppression de fiche.
   *
   * ⚠️ ON REFUSE DE SUPPRIMER S'IL EXISTE UN RENDEZ-VOUS. Un rendez-vous porte de la facturation :
   * l'effacer réécrirait des factures passées. La règle est déjà posée pour les clients perdus, elle
   * vaut ici.
   */
  if (quoi === 'supprimer-3') {
    const EMAILS = ['alesia@francebatiment.com', 'paradislatin@paradislatin.com', 'contact@emmanuel-lambal.fr']
    const appliquer = req.nextUrl.searchParams.get('appliquer') === '1'

    const etat = await sql`
      SELECT c.id, c.email, c.company,
             (SELECT COUNT(*)::int FROM rdv r WHERE r.contact_id = c.id) AS rdv,
             (SELECT COUNT(*)::int FROM email_queue q WHERE q.contact_id = c.id) AS lignes_de_file,
             (SELECT COUNT(*)::int FROM incoming_replies ir WHERE ir.contact_id = c.id) AS reponses,
             EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)) AS deja_blocklistee
      FROM contacts c WHERE LOWER(c.email) = ANY(${EMAILS.map(e => e.toLowerCase())})`
    out.etat = etat

    const avecRdv = (etat as Array<{ rdv: number; company: string }>).filter(r => r.rdv > 0)
    if (avecRdv.length > 0) {
      out.refus = `suppression refusée : ${avecRdv.map(r => r.company).join(', ')} porte(nt) un rendez-vous, donc de la facturation`
      return NextResponse.json({ ok: false, ...out })
    }

    if (appliquer) {
      const ids = (etat as Array<{ id: string }>).map(r => r.id)
      // 1) La blocklist d'abord : elle doit survivre à la fiche.
      for (const e of EMAILS) {
        await sql`INSERT INTO blocklist (email, reason) VALUES (${e}, 'manuel') ON CONFLICT (email) DO NOTHING`
      }
      // 2) Puis les dépendances, puis la fiche (les clés étrangères l'exigent dans cet ordre).
      if (ids.length > 0) {
        await sql`DELETE FROM reply_drafts WHERE incoming_reply_id IN (SELECT id FROM incoming_replies WHERE contact_id = ANY(${ids}))`
        await sql`DELETE FROM incoming_replies WHERE contact_id = ANY(${ids})`
        await sql`DELETE FROM email_queue WHERE contact_id = ANY(${ids})`
        const restants = (await sql`DELETE FROM contacts WHERE id = ANY(${ids}) RETURNING email`) as Array<{ email: string }>
        out.supprimees = restants.map(r => r.email)
      }
      out.blocklist_posee = EMAILS
    }
  }

  /** Répartition des avis Google : combien de fiches sont sous le seuil, et combien sont INCONNUES. */
  if (quoi === 'avis') {
    out.repartition = await sql`
      SELECT CASE
               WHEN google_reviews_count IS NULL THEN 'inconnu'
               WHEN google_reviews_count < 20 THEN 'sous 20'
               ELSE '20 et plus' END AS tranche,
             COUNT(*)::int AS fiches,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = contacts.id AND q.status = 'sent'))::int AS deja_demarchees
      FROM contacts GROUP BY 1 ORDER BY 2 DESC`
  }

  /**
   * VIDER LA FILE DES ENTREPRISES SOUS 20 AVIS (consigne Timéo, 27/08).
   *
   * « Faut contacter que ceux avec plus de 20 avis, les autres tu dois les envoyer à LabegarIA et
   * seulement LabegarIA. »
   *
   * Ces lignes ne partiraient de toute façon jamais : le moteur exige 20 avis au moment de réclamer
   * un mail. Elles restaient donc en file indéfiniment — du poids mort qui fausse les compteurs et
   * qui, surtout, maintient l'invariant D6 au rouge sur des cas qui ne peuvent plus nuire. **Un
   * invariant rouge en permanence est un invariant qu'on cesse de lire**, et le jour où une vraie
   * fuite apparaîtra, elle se perdra dans le bruit.
   *
   * ⚠️ On ANNULE, on ne supprime pas : la ligne reste lisible, et la décision est réversible.
   * ⚠️ On ne touche QUE le froid (étape < 20). Une relance de conversation s'adresse à quelqu'un qui
   * a déjà écrit — le nombre d'avis Google n'a plus rien à voir avec elle.
   */
  if (quoi === 'vider-file-sous-20') {
    const constat = await sql`
      SELECT COUNT(DISTINCT c.id)::int AS entreprises, COUNT(*)::int AS lignes
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending') AND q.sequence_step < 20
        AND c.google_reviews_count IS NOT NULL AND c.google_reviews_count < 20`
    out.a_annuler = constat

    if (req.nextUrl.searchParams.get('appliquer') === '1') {
      const annulees = (await sql`
        UPDATE email_queue q SET status = 'cancelled'
        FROM contacts c
        WHERE c.id = q.contact_id
          AND q.status IN ('queued', 'pending') AND q.sequence_step < 20
          AND c.google_reviews_count IS NOT NULL AND c.google_reviews_count < 20
        RETURNING q.id`) as unknown[]
      out.lignes_annulees = annulees.length
    }
  }

  /**
   * 🔎 POURQUOI PAS DE RENDEZ-VOUS ? — l'entonnoir étape par étape, sur 30 jours.
   *
   * Timéo, 27/08 : « ça fait un moment que j'obtiens pas de RDV, faut vraiment qu'il y en ait qui
   * tombe ». La question n'est pas « combien de mails » mais À QUELLE ÉTAPE ça s'arrête. Un entonnoir
   * qui perd tout au premier palier ne se répare pas comme un entonnoir qui perd tout au dernier.
   */
  if (quoi === 'pourquoi-pas-de-rdv') {
    out.entonnoir_30j = await sql`
      SELECT
        (SELECT COUNT(DISTINCT contact_id)::int FROM email_queue
          WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days') AS personnes_contactees,
        (SELECT COUNT(DISTINCT contact_id)::int FROM incoming_replies
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND (classification IS NULL OR classification NOT IN ('spam','oof','warmup'))) AS ont_repondu,
        (SELECT COUNT(DISTINCT contact_id)::int FROM incoming_replies
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND classification IN ('interest','rdv_request','question')) AS interesses,
        (SELECT COUNT(*)::int FROM rdv WHERE created_at > NOW() - INTERVAL '30 days') AS rdv_crees,
        (SELECT COUNT(*)::int FROM rdv WHERE created_at > NOW() - INTERVAL '30 days'
          AND COALESCE(status,'') NOT IN ('cancelled','proposed')) AS rdv_tenus`

    /** Les réponses par nature : ce que les gens répondent vraiment. */
    out.reponses_par_nature = await sql`
      SELECT COALESCE(classification, '(non classe)') AS nature, COUNT(*)::int AS n
      FROM incoming_replies WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 2 DESC`

    /**
     * ⚠️ LE POINT LE PLUS COÛTEUX : un lead chaud qui attend une décision humaine. Chaque jour
     * d'attente refroidit un prospect qui, lui, a répondu.
     */
    out.leads_chauds_en_attente = await sql`
      SELECT c.company, c.email, ir.classification, ir.created_at AS a_ecrit_le,
             rd.status AS etat_brouillon,
             ROUND(EXTRACT(EPOCH FROM (NOW() - ir.created_at)) / 3600)::int AS depuis_heures
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      LEFT JOIN reply_drafts rd ON rd.incoming_reply_id = ir.id
      WHERE ir.classification IN ('interest','rdv_request','question')
        AND ir.created_at > NOW() - INTERVAL '30 days'
        AND (rd.status IS NULL OR rd.status IN ('pending','awaiting_validation','scheduled'))
      ORDER BY ir.created_at DESC LIMIT 20`

    /**
     * ⚠️ QUI A DEMANDÉ UN RENDEZ-VOUS SANS EN OBTENIR UN ? C'est le seul endroit où un rendez-vous
     * peut être PERDU plutôt que simplement pas encore gagné — et donc le seul qui se rattrape.
     */
    out.demandes_rdv_sans_rdv = await sql`
      SELECT c.company, c.email, ir.created_at AS a_demande_le,
             ROUND(EXTRACT(EPOCH FROM (NOW() - ir.created_at)) / 86400)::int AS il_y_a_jours,
             (SELECT COUNT(*)::int FROM rdv r WHERE r.contact_id = c.id) AS rdv_existants,
             (SELECT rd.status FROM reply_drafts rd WHERE rd.incoming_reply_id = ir.id LIMIT 1) AS brouillon,
             LEFT(REPLACE(ir.body, E'\n', ' '), 140) AS extrait
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.classification IN ('rdv_request', 'interest')
        AND ir.created_at > NOW() - INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id)
      ORDER BY ir.created_at DESC LIMIT 15`

    /**
     * ⚠️ LE GISEMENT LE PLUS PROCHE : ceux qui étaient EN CONGÉS et qui sont revenus.
     *
     * Sur 110 réponses en 30 jours, 66 sont des absences automatiques — 60 %. Ce ne sont pas des
     * refus, ce sont des gens qui n'ont pas encore lu. Chacun porte une date de retour qu'il a
     * annoncée lui-même : le jour où elle passe, c'est le meilleur moment pour reprendre, et c'est
     * du volume qui ne coûte aucun lead neuf.
     */
    out.absents_revenus = await sql`
      SELECT c.company, c.email, c.absent_jusqu_au,
             (CURRENT_DATE - c.absent_jusqu_au)::int AS revenu_depuis_jours,
             (SELECT MAX(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent') AS dernier_mail,
             (SELECT COUNT(*)::int FROM email_queue q WHERE q.contact_id = c.id AND q.status IN ('queued','pending')) AS en_file,
             /**
              * ⚠️ LE MESSAGE DE REPRISE NE PASSE PAS PAR LA FILE. Il part par le chemin des RÉPONSES
              * (reply_drafts), puisque c'est une réponse à leur message d'absence. Un contrôle qui
              * ne regarde que email_queue conclut donc « jamais relancé » pour quelqu'un qui l'a
              * parfaitement été. J'ai failli l'annoncer à Timéo — troisième fausse alerte évitée
              * aujourd'hui en vérifiant avant de parler.
              */
             (SELECT MAX(rd.sent_at) FROM reply_drafts rd
               JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
               WHERE ir.contact_id = c.id AND rd.status = 'sent') AS derniere_reponse_envoyee
      FROM contacts c
      WHERE c.absent_jusqu_au IS NOT NULL
        AND c.absent_jusqu_au <= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      ORDER BY c.absent_jusqu_au DESC LIMIT 40`

    /** Depuis quand n'a-t-on pas créé de rendez-vous ? */
    out.dernier_rdv = await sql`
      SELECT MAX(created_at) AS dernier_cree,
             ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400)::int AS il_y_a_jours
      FROM rdv`
  }

  /**
   * 📅 LA JOURNÉE, ET RIEN QUE LA JOURNÉE.
   *
   * Timéo, 27/08 : « je te parle pas depuis 30 j mais aujourd'hui, si tout s'est bien passé ». Un
   * cumul sur trente jours répond à une autre question que la sienne — et noie la journée dedans.
   * Tout est calé sur l'heure de PARIS, pas sur UTC : « aujourd'hui » commence à minuit chez lui.
   */
  if (quoi === 'aujourdhui') {
    out.envois = await sql`
      SELECT COUNT(*)::int AS mails,
             COUNT(*) FILTER (WHERE sequence_step = 0)::int AS nouveaux_contacts,
             COUNT(*) FILTER (WHERE sequence_step BETWEEN 1 AND 19)::int AS relances_sequence,
             COUNT(*) FILTER (WHERE sequence_step >= 20)::int AS relances_conversation,
             MIN(sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') AS premier,
             MAX(sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') AS dernier,
             COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') < 8
                                 OR EXTRACT(HOUR FROM sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') >= 19)::int AS hors_fenetre
      FROM email_queue
      WHERE status = 'sent'
        AND (sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date`

    out.par_boite = await sql`
      SELECT COALESCE(sent_via, from_email, '(inconnue)') AS boite, COUNT(*)::int AS mails
      FROM email_queue
      WHERE status = 'sent'
        AND (sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date
      GROUP BY 1 ORDER BY 2 DESC`

    out.reponses = await sql`
      SELECT COALESCE(classification, '(non classe)') AS nature, COUNT(*)::int AS n
      FROM incoming_replies
      WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date
      GROUP BY 1 ORDER BY 2 DESC`

    out.a_traiter = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM reply_drafts WHERE status IN ('pending','awaiting_validation')) AS brouillons_a_valider,
        (SELECT COUNT(*)::int FROM rdv
          WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date) AS rdv_crees_aujourdhui,
        (SELECT COUNT(*)::int FROM email_queue WHERE status = 'failed'
          AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date) AS envois_en_echec`
  }

  /**
   * ⚠️ MON PROPRE GARDE-FOU D'HIER JETTE-T-IL DES RÉPONSES ?
   *
   * En refusant les rattachements par objet ambigu, j'ai augmenté le nombre de messages non
   * rattachés. Ils sont tracés « A RATTACHER A LA MAIN » — s'ils s'accumulent, j'ai échangé une
   * mauvaise attribution contre un lead perdu. C'est la vérification que je me dois à moi-même.
   */
  if (quoi === 'ecartes') {
    out.par_motif = await sql`
      SELECT LEFT(motif, 60) AS motif, COUNT(*)::int AS n, MAX(vu_le) AS dernier
      FROM imap_messages_ecartes
      WHERE vu_le > NOW() - INTERVAL '7 days'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`
    /**
     * ⚠️ AVANT DE RECLASSER 164 LIGNES, REGARDER QUI EST DEDANS. Les étiqueter en bloc « bruit »
     * ferait disparaître un vrai prospect au milieu du spam — exactement la faute que la trace était
     * censée empêcher. On extrait donc le domaine de chaque expéditeur : un `.fr` d'artisan ne se
     * confond pas avec `dmarcreport@microsoft.com`.
     */
    out.expediteurs_ecartes = await sql`
      SELECT SUBSTRING(motif FROM 'de ([^ ]+@[^ ]+) ') AS expediteur, COUNT(*)::int AS n
      FROM imap_messages_ecartes
      WHERE motif LIKE 'A RATTACHER A LA MAIN%'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 40`

    /**
     * RECLASSEMENT DES TRACES HISTORIQUES.
     *
     * Les lignes écrites avant le 27/08 portent toutes le préfixe « A RATTACHER A LA MAIN », que le
     * message soit un vrai prospect ambigu ou du bruit — mon libellé ne distinguait pas les deux.
     * Dans trois jours, l'invariant D11 passerait donc au rouge sur 164 rapports DMARC et courriers
     * de démarchage anglophone. **Une alerte qui se déclenche sur du bruit est une alerte qu'on cesse
     * de lire**, et le jour où un vrai prospect s'y trouvera, il se perdra dedans.
     *
     * ⚠️ Vérifié AVANT de reclasser : les 40 expéditeurs distincts sont des rapports DMARC
     * (microsoft, google, yahoo) et du démarchage international. **Zéro domaine français, zéro
     * métier du bâtiment.** Reclasser en bloc sans ce contrôle aurait pu enterrer un vrai prospect.
     */
    if (req.nextUrl.searchParams.get('reclasser') === '1') {
      const modifiees = (await sql`
        UPDATE imap_messages_ecartes
        SET motif = REPLACE(motif, 'A RATTACHER A LA MAIN', 'BRUIT ENTRANT (reclasse le 27/08, motif d origine non fiable)')
        WHERE motif LIKE 'A RATTACHER A LA MAIN%'
        RETURNING message_id`) as unknown[]
      out.lignes_reclassees = modifiees.length
    }

    out.a_rattacher_a_la_main = await sql`
      SELECT motif, boite, vu_le FROM imap_messages_ecartes
      WHERE motif LIKE 'A RATTACHER A LA MAIN%'
      ORDER BY vu_le DESC LIMIT 15`
  }

  /**
   * 🔎 POURQUOI LE BOUTON « ENVOYER » NE FAIT RIEN ?
   *
   * Timéo, 31/08 : « j'appuie sur envoyer ça ne marche pas ». `sendReplyEmail` porte plusieurs
   * gardes anti-doublon ; l'une d'elles refuse probablement l'envoi, et l'écran ne le dit pas. On
   * reconstitue donc, pour chaque brouillon en attente, exactement ce que ces gardes voient.
   */
  if (quoi === 'pourquoi-envoi-bloque') {
    out.brouillons = await sql`
      SELECT rd.id AS brouillon, rd.status, c.company, ir.from_email,
             ir.created_at AS message_recu_le,
             (SELECT MAX(t.quand) FROM (
                SELECT eq.sent_at AS quand FROM email_queue eq
                  WHERE eq.contact_id = ir.contact_id AND eq.status = 'sent'
                UNION ALL
                SELECT rd2.sent_at FROM reply_drafts rd2
                  JOIN incoming_replies ir2 ON ir2.id = rd2.incoming_reply_id
                  WHERE ir2.contact_id = ir.contact_id AND rd2.status = 'sent'
                UNION ALL
                SELECT mh.envoye_le FROM messages_humains mh
                  WHERE LOWER(mh.destinataire) = LOWER(ir.from_email)
             ) t) AS dernier_envoi,
             (SELECT MAX(ir3.created_at) FROM incoming_replies ir3
               WHERE ir3.contact_id = ir.contact_id) AS derniere_reponse_prospect,
             EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(ir.from_email)) AS blocklistee
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      LEFT JOIN contacts c ON c.id = ir.contact_id
      WHERE rd.status IN ('pending', 'awaiting_validation')
      ORDER BY rd.created_at DESC LIMIT 10`

    /** Ce que sont devenus les brouillons de reprise après congés — partis, ou perdus ? */
    out.reprises = await sql`
      SELECT rd.status, rd.sent_at, c.company, c.email, ir.created_at AS oof_recu_le
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      LEFT JOIN contacts c ON c.id = ir.contact_id
      WHERE rd.body LIKE '%aviez indiqué être fermé%'
      ORDER BY rd.created_at DESC LIMIT 15`
  }

  return NextResponse.json({ ok: true, ...out })
}

export const GET = handler
