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
     * ⚠️ LE « BRUIT ENTRANT » N'AVAIT AUCUN ÉCHANTILLON — donc personne ne l'avait jamais lu.
     *
     * 733 messages écartés en 7 jours, et le seul regard possible était leur NOMBRE. Un motif qui
     * s'appelle « bruit » et qu'on ne peut pas ouvrir est une poubelle : le jour où un vrai
     * prospect y tombe, rien ne le dira jamais. Le 03/09/2026, Timéo signalait « pas la moindre
     * conversation depuis des jours » et je ne pouvais NI confirmer NI infirmer qu'une réponse
     * dormait là-dedans.
     *
     * On sépare donc ce qui ressemble à une entreprise française (domaine .fr, ou un objet
     * commençant par Re:/RE:, signe d'une réponse à l'un de nos mails) du bruit d'infrastructure
     * (rapports DMARC, notifications Google, mailer-daemon).
     */
    out.bruit_a_relire = await sql`
      SELECT LEFT(motif, 200) AS motif, vu_le, boite
      FROM imap_messages_ecartes
      WHERE vu_le > NOW() - INTERVAL '14 days'
        AND motif LIKE 'BRUIT ENTRANT%'
        AND (motif ~* '@[a-z0-9.-]+\\.fr' OR motif ~* 'objet[^,]*: *re *:')
        AND motif !~* 'dmarc|mailer-daemon|postmaster|noreply|no-reply|newsletter|linkedin|google\\.com|microsoft'
      ORDER BY vu_le DESC LIMIT 40`
    out.bruit_volume = await sql`
      SELECT COUNT(*)::int AS total_14j,
             COUNT(*) FILTER (WHERE motif ~* '@[a-z0-9.-]+\\.fr')::int AS avec_domaine_fr
      FROM imap_messages_ecartes
      WHERE vu_le > NOW() - INTERVAL '14 days' AND motif LIKE 'BRUIT ENTRANT%'`

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

  /**
   * 🔎 QUELLES FONCTIONNALITÉS TOURNENT SANS RIEN PRODUIRE ?
   *
   * Timéo, 31/08 : « vérifie s'il n'y a pas d'autres problèmes comme ça ». Le défaut du bouton
   * Envoyer appartient à une famille précise : **une règle écrite, un cron qui tourne, un battement
   * vert — et zéro effet**. Le heartbeat dit « ok » parce que le cron s'est terminé, pas parce qu'il
   * a servi à quelque chose.
   *
   * On compare donc, pour chaque mécanisme, ce qu'il DEVRAIT produire à ce qu'il a RÉELLEMENT
   * produit. Un compteur à zéro sur trente jours n'est pas forcément une panne — mais il mérite
   * toujours qu'on aille voir.
   */
  if (quoi === 'effets') {
    out.effets_30j = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM email_queue
          WHERE status = 'sent' AND sequence_step >= 20 AND sent_at > NOW() - INTERVAL '30 days') AS relances_de_conversation,
        (SELECT COUNT(*)::int FROM reply_drafts
          WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days') AS reponses_agent_envoyees,
        (SELECT COUNT(*)::int FROM reply_drafts
          WHERE status = 'rejected' AND rejete_le > NOW() - INTERVAL '30 days') AS brouillons_rejetes,
        (SELECT COUNT(*)::int FROM rdv WHERE created_at > NOW() - INTERVAL '30 days') AS rdv_crees,
        (SELECT COUNT(*)::int FROM urgent_tasks WHERE created_at > NOW() - INTERVAL '30 days') AS taches_urgentes,
        (SELECT COUNT(*)::int FROM messages_humains WHERE envoye_le > NOW() - INTERVAL '30 days') AS mails_ecrits_a_la_main,
        (SELECT COUNT(*)::int FROM contacts WHERE absent_jusqu_au IS NOT NULL) AS absences_detectees,
        (SELECT COUNT(*)::int FROM contacts WHERE redirige_vers IS NOT NULL) AS changements_d_adresse,
        (SELECT COUNT(*)::int FROM blocklist WHERE created_at > NOW() - INTERVAL '30 days') AS blocages_30j`

    /**
     * Le mécanisme de relance de conversation : combien de prospects Y SERAIENT éligibles, et
     * combien en sortent réellement ? L'écart dit si un filtre mange tout.
     */
    out.relance_conversation = await sql`
      SELECT
        COUNT(*)::int AS ont_repondu_puis_silence,
        COUNT(*) FILTER (WHERE bloque)::int AS ecartes_blocklist,
        COUNT(*) FILTER (WHERE a_un_rdv)::int AS ecartes_rdv,
        COUNT(*) FILTER (WHERE pression)::int AS ecartes_pression,
        COUNT(*) FILTER (WHERE rejet_humain)::int AS ecartes_rejet_humain,
        COUNT(*) FILTER (WHERE deja_relance)::int AS deja_relances,
        COUNT(*) FILTER (WHERE NOT bloque AND NOT a_un_rdv AND NOT pression AND NOT rejet_humain AND NOT deja_relance)::int AS RESTENT_ELIGIBLES
      FROM (
        SELECT c.id,
          EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)) AS bloque,
          EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed') AS a_un_rdv,
          c.pression_signalee_at IS NOT NULL AS pression,
          EXISTS (SELECT 1 FROM reply_drafts rd JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
                   WHERE ir2.contact_id = c.id AND rd.status = 'rejected' AND rd.rejete_par = 'humain') AS rejet_humain,
          EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.sequence_step >= 20) AS deja_relance
        FROM contacts c
        WHERE EXISTS (
          SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id
            AND ir.classification IN ('interest','question','objection','rdv_request')
        )
      ) x`
  }

  /**
   * 📈 OÙ SONT LES RÉPONSES ? Par étape de séquence et par variante de message.
   *
   * Timéo, 31/08 : « j'ai pas beaucoup de résultats là, ça commence à être chiant ». Avant de
   * proposer quoi que ce soit, il faut savoir ce qui marche déjà : quelle étape déclenche les
   * réponses, et si une variante de message fait mieux que les autres. Sans ça, changer le texte
   * revient à jouer à pile ou face avec sa réputation d'expédition.
   */
  if (quoi === 'ou-sont-les-reponses') {
    out.par_etape = await sql`
      SELECT q.sequence_step AS etape,
             COUNT(DISTINCT q.contact_id)::int AS personnes_touchees,
             COUNT(DISTINCT ir.contact_id)::int AS ont_repondu,
             ROUND(100.0 * COUNT(DISTINCT ir.contact_id) / NULLIF(COUNT(DISTINCT q.contact_id), 0), 2) AS taux_pct
      FROM email_queue q
      LEFT JOIN incoming_replies ir
        ON ir.contact_id = q.contact_id
       AND ir.created_at > q.sent_at
       AND ir.created_at < q.sent_at + INTERVAL '4 days'
       AND (ir.classification IS NULL OR ir.classification NOT IN ('spam','oof','warmup'))
      WHERE q.status = 'sent' AND q.sequence_step < 20
      GROUP BY 1 ORDER BY 1`

    /**
     * ⚠️ L'AUTO-APPRENTISSAGE FAVORISE-T-IL RÉELLEMENT LA MEILLEURE VARIANTE ?
     *
     * Le mécanisme existe (`exp_variant_weights`, ajusté par `weekly-learning`). Mais un mécanisme
     * qui existe n'est pas un mécanisme qui agit : si les poids sont restés à l'uniforme, la
     * variante la plus faible reçoit toujours autant de prospects que la meilleure, et la boucle
     * d'apprentissage ne sert à rien.
     */
    out.poids_variantes = await sql`
      SELECT key, value, updated_at FROM agent_config
      WHERE key IN ('exp_variant_weights', 'exp_sector_weights', 'exp_region_weights')`

    out.par_variante = await sql`
      SELECT COALESCE(q.variant_id, '(aucune)') AS variante,
             COUNT(DISTINCT q.contact_id)::int AS personnes,
             COUNT(DISTINCT ir.contact_id)::int AS ont_repondu,
             ROUND(100.0 * COUNT(DISTINCT ir.contact_id) / NULLIF(COUNT(DISTINCT q.contact_id), 0), 2) AS taux_pct
      FROM email_queue q
      LEFT JOIN incoming_replies ir
        ON ir.contact_id = q.contact_id
       AND (ir.classification IS NULL OR ir.classification NOT IN ('spam','oof','warmup'))
      WHERE q.status = 'sent' AND q.sequence_step = 0
      GROUP BY 1 ORDER BY 4 DESC NULLS LAST`
  }

  /**
   * RETIRER LES ÉTAPES 5 DÉJÀ EN FILE (décision de Timéo, 31/08).
   *
   * La séquence passe de six à cinq mails : l'étape 5 obtenait 0,47 % de réponses contre 1,1 à
   * 1,65 % pour les autres. Changer `SEQUENCE_DELAYS` empêche d'en créer de nouvelles, mais celles
   * déjà programmées partiraient quand même — un correctif de cause ne répare pas le passé.
   *
   * ⚠️ On ANNULE, on ne supprime pas : la ligne reste lisible et la décision est réversible si
   * Timéo veut rétablir le sixième mail.
   */
  if (quoi === 'retirer-etape-5') {
    out.a_annuler = await sql`
      SELECT COUNT(*)::int AS lignes, COUNT(DISTINCT contact_id)::int AS personnes
      FROM email_queue WHERE status IN ('queued', 'pending') AND sequence_step = 5`
    if (req.nextUrl.searchParams.get('appliquer') === '1') {
      const annulees = (await sql`
        UPDATE email_queue SET status = 'cancelled'
        WHERE status IN ('queued', 'pending') AND sequence_step = 5
        RETURNING id`) as unknown[]
      out.lignes_annulees = annulees.length
    }
  }

  /**
   * 🔎 L'OBJET DU MAIL ANNONCE-T-IL LE BON MÉTIER ?
   *
   * Capture de Timéo (31/08) : « TCT Couverture - Couvreur Façadier » a reçu un mail dont l'objet
   * dit « quand on cherche **un peintre** à Valenciennes ». Le prospect lit, en une seconde, qu'on
   * ne sait pas ce qu'il fait. C'est le pire début possible pour un cold mail — et ça n'apparaît
   * dans aucun compteur, parce que techniquement le mail est parti sans erreur.
   */
  if (quoi === 'metier-dans-objet') {
    out.incoherences = await sql`
      SELECT c.company, c.sector, q.subject, q.sequence_step, q.status, q.sent_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE c.sector IS NOT NULL AND q.subject IS NOT NULL
        AND q.subject ILIKE '%cherche un %'
        AND q.subject NOT ILIKE '%' || c.sector || '%'
        AND (q.status IN ('queued','pending') OR q.sent_at > NOW() - INTERVAL '60 days')
      ORDER BY q.sent_at DESC NULLS FIRST LIMIT 25`
    out.total = await sql`
      SELECT COUNT(*)::int AS mails, COUNT(DISTINCT q.contact_id)::int AS personnes,
             COUNT(*) FILTER (WHERE q.status IN ('queued','pending'))::int AS encore_en_file
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE c.sector IS NOT NULL AND q.subject IS NOT NULL
        AND q.subject ILIKE '%cherche un %'
        AND q.subject NOT ILIKE '%' || c.sector || '%'`
  }

  /**
   * ⚠️ UN PROSPECT QUI A ÉCRIT APRÈS SON RENDEZ-VOUS ET QUI ATTEND ENCORE.
   *
   * L'écran de Timéo signale « message sans réponse depuis le rendez-vous ». C'est la pire catégorie
   * de lead perdu : quelqu'un d'assez intéressé pour avoir pris rendez-vous, qui relance, et à qui
   * personne ne répond.
   */
  if (quoi === 'sans-reponse') {
    out.en_attente = await sql`
      SELECT c.company, c.email, ir.created_at AS a_ecrit_le,
             ROUND(EXTRACT(EPOCH FROM (NOW() - ir.created_at)) / 86400)::int AS il_y_a_jours,
             ir.classification, ir.action_taken,
             (SELECT rd.status FROM reply_drafts rd WHERE rd.incoming_reply_id = ir.id LIMIT 1) AS brouillon,
             (SELECT MAX(t.quand) FROM (
                SELECT eq.sent_at AS quand FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent'
                UNION ALL
                SELECT rd2.sent_at FROM reply_drafts rd2 JOIN incoming_replies i2 ON i2.id = rd2.incoming_reply_id
                  WHERE i2.contact_id = c.id AND rd2.status = 'sent'
             ) t) AS dernier_envoi
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.created_at = (SELECT MAX(i3.created_at) FROM incoming_replies i3 WHERE i3.contact_id = c.id)
        AND COALESCE(ir.classification, '') NOT IN ('spam', 'warmup')
        AND NOT EXISTS (
          SELECT 1 FROM reply_drafts rd3 WHERE rd3.incoming_reply_id = ir.id AND rd3.status = 'sent'
        )
      ORDER BY ir.created_at DESC LIMIT 20`
  }

  /**
   * 🔴 LE MÉTIER ENREGISTRÉ CONTREDIT-IL LE NOM DE L'ENTREPRISE ?
   *
   * Cas trouvé le 31/08 sur la capture de Timéo : « TCT Couverture - Couvreur Façadier Valenciennes »
   * est stocké avec `sector = 'peintre'`. Les cinq mails de sa séquence lui ont donc annoncé
   * « votre visibilité quand on cherche **un peintre** à Valenciennes ».
   *
   * Ce n'est pas une faute de frappe, c'est une perte sèche : un artisan qui lit qu'on le prend pour
   * un autre métier sait en une seconde qu'il s'agit d'un envoi de masse mal fait. Aucun compteur ne
   * le voit — le mail part sans erreur, la séquence se déroule, et le prospect ne répond simplement
   * jamais. Ça se paie sur le taux de réponse, pas dans les logs.
   *
   * On compare donc le NOM de l'entreprise, qui dit presque toujours le métier, au secteur stocké.
   */
  if (quoi === 'metier-faux') {
    const INDICES: Array<[string, string]> = [
      ['couvreur', 'couvreur|couverture|toitur|zinguer|charpent'],
      ['pisciniste', 'piscin|spa\\b'],
      ['terrassier', 'terrassement|terrassier|tp\\b|travaux publics'],
      ['maçon', 'maconnerie|maçonnerie|macon\\b|maçon\\b'],
      ['menuisier', 'menuiser|fermetur|veranda|véranda'],
      ['plombier', 'plomb|chauffagi|sanitaire'],
      ['électricien', 'electric|électric'],
      ['peintre', 'peintur|peintre|ravalement'],
    ]
    /**
     * ⚠️ NE PAS COMPTER LES ENTREPRISES MULTI-MÉTIERS. « MEJAN RÉNOV | Peinture, Couverture » fait
     * les deux : la classer « peintre » n'est pas une erreur. Ce qui est faux, c'est de classer
     * peintre une entreprise dont le nom ne parle QUE de couverture.
     *
     * On exige donc que le nom contienne le métier probable ET NE CONTIENNE PAS le métier stocké.
     * Sans ce second test, on annonce cent trente-huit erreurs là où il y en a bien moins — et une
     * mesure gonflée fait prendre de mauvaises décisions aussi sûrement qu'une mesure absente.
     */
    const MOTIF_DE: Record<string, string> = Object.fromEntries(INDICES)
    const lignes: unknown[] = []
    for (const [metier, motif] of INDICES) {
      const r = (await sql`
        SELECT c.company, c.sector AS secteur_enregistre, ${metier} AS metier_probable, c.email,
               (SELECT COUNT(*)::int FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent') AS mails_envoyes,
               (SELECT COUNT(*)::int FROM email_queue q WHERE q.contact_id = c.id AND q.status IN ('queued','pending')) AS encore_en_file
        FROM contacts c
        WHERE c.company ~* ${motif}
          AND c.sector IS NOT NULL
          AND LOWER(c.sector) <> ${metier}
          -- On ignore le fourre-tout : il ne prétend pas nommer un métier précis.
          AND LOWER(c.sector) <> 'artisan du bâtiment'
        LIMIT 200`) as unknown[]
      lignes.push(...r)
    }
    /** Filtre multi-métiers : on écarte les entreprises dont le nom évoque AUSSI le métier stocké. */
    type L = { company: string; secteur_enregistre: string; metier_probable: string; mails_envoyes: number; encore_en_file: number }
    const vraiesErreurs = (lignes as L[]).filter(r => {
      const motifStocke = MOTIF_DE[String(r.secteur_enregistre).toLowerCase()]
      if (!motifStocke) return true
      return !new RegExp(motifStocke, 'i').test(r.company ?? '')
    })

    out.total_signale_avant_filtre = lignes.length
    out.total_vraies_erreurs = vraiesErreurs.length
    out.multi_metiers_ecartes = lignes.length - vraiesErreurs.length
    out.mal_classes = vraiesErreurs.slice(0, 30)
    out.encore_en_file = vraiesErreurs.reduce((s, r) => s + Number(r.encore_en_file ?? 0), 0)
    out.deja_ecrits = vraiesErreurs.reduce((s, r) => s + Number(r.mails_envoyes ?? 0), 0)

    /**
     * RÉPARATION. Deux gestes distincts, et le second est le plus important :
     *
     *  1. corriger le métier sur la fiche — sans ça, la prochaine relance refait la même erreur ;
     *  2. ANNULER les mails encore en file qui portent le mauvais métier dans leur objet. Corriger la
     *     fiche ne réécrit pas un mail déjà rédigé : l'objet et le corps sont figés dans la ligne de
     *     file au moment où elle est créée. Sans cette annulation, on corrigerait la cause en
     *     laissant partir les dégâts — l'erreur exacte de Bleu 30 Piscines.
     *
     * Les lignes annulées seront régénérées par `refresh-queued`, avec le bon métier.
     */
    if (req.nextUrl.searchParams.get('appliquer') === '1') {
      let fiches = 0, mails = 0
      for (const r of vraiesErreurs as Array<L & { email: string }>) {
        const u = (await sql`
          UPDATE contacts SET sector = ${r.metier_probable}
          WHERE LOWER(email) = LOWER(${r.email}) RETURNING id`) as Array<{ id: string }>
        if (!u[0]) continue
        fiches++
        const a = (await sql`
          UPDATE email_queue SET status = 'cancelled'
          WHERE contact_id = ${u[0].id} AND status IN ('queued', 'pending')
          RETURNING id`) as unknown[]
        mails += a.length
      }
      out.fiches_corrigees = fiches
      out.mails_annules_a_regenerer = mails
    }
  }

  /** Fil complet d'un prospect : ses messages, nos brouillons, nos envois — dans l'ordre. */
  if (quoi === 'fil') {
    const email = (req.nextUrl.searchParams.get('email') ?? '').toLowerCase()
    out.messages_recus = await sql`
      SELECT ir.id, ir.created_at, ir.classification, ir.action_taken,
             LEFT(REPLACE(ir.body, E'\n', ' '), 160) AS extrait
      FROM incoming_replies ir
      WHERE LOWER(ir.from_email) = ${email}
         OR ir.contact_id IN (SELECT id FROM contacts WHERE LOWER(email) = ${email})
      ORDER BY ir.created_at`
    out.brouillons = await sql`
      SELECT rd.status, rd.created_at, rd.sent_at, rd.rejete_par,
             LEFT(REPLACE(rd.body, E'\n', ' '), 120) AS extrait
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE LOWER(ir.from_email) = ${email}
         OR ir.contact_id IN (SELECT id FROM contacts WHERE LOWER(email) = ${email})
      ORDER BY rd.created_at`
    out.rdv = await sql`
      SELECT r.scheduled_at, r.status, r.crm_stage, r.created_at
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE LOWER(c.email) = ${email} ORDER BY r.created_at`
  }

  /**
   * 🔎 LES LEADS OUTSCRAPER VALENT-ILS CEUX DE L'API GOOGLE ?
   *
   * Hypothèse de Timéo (31/08) : « depuis qu'on passe par Outscraper il n'y a plus de RDV ; avec
   * l'API Google, plus cher, j'avais largement plus de rendez-vous — peut-être parce qu'on
   * contactait directement le dirigeant ».
   *
   * C'est une hypothèse testable, et elle vaut mieux qu'un avis. On compare donc, source par source,
   * le seul chemin qui compte : contacté → a répondu → rendez-vous. Et on teste séparément sa
   * sous-hypothèse, qui est la plus intéressante : une adresse NOMINATIVE (prenom.nom@) répond-elle
   * mieux qu'une adresse générique (contact@, info@) ?
   */
  if (quoi === 'source') {
    out.par_source = await sql`
      SELECT COALESCE(c.source, '(inconnue)') AS source,
             COUNT(*)::int AS fiches,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent'))::int AS contactes,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id
                                              AND (ir.classification IS NULL OR ir.classification NOT IN ('spam','oof','warmup'))))::int AS ont_repondu,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id))::int AS ont_un_rdv
      FROM contacts c GROUP BY 1 ORDER BY 3 DESC`

    /**
     * ⚠️ NOMINATIVE OU GÉNÉRIQUE ? C'est la vraie question derrière l'intuition de Timéo.
     * `contact@`, `info@`, `devis@` tombent dans une boîte partagée que personne ne lit vraiment ;
     * `prenom.nom@` arrive chez une personne.
     */
    out.par_type_adresse = await sql`
      SELECT CASE
               WHEN split_part(c.email, '@', 1) ~* '^(contact|info|devis|commercial|accueil|secretariat|admin|direction|service|bonjour|hello|sav|entreprise|societe)'
                 THEN 'generique (contact@, info@...)'
               ELSE 'nominative (prenom@, prenom.nom@)'
             END AS type_adresse,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent'))::int AS contactes,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id
                                              AND (ir.classification IS NULL OR ir.classification NOT IN ('spam','oof','warmup'))))::int AS ont_repondu,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id))::int AS ont_un_rdv
      FROM contacts c WHERE c.email IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`

    /**
     * ⚠️ LE CROISEMENT QUI TRANCHE. Deux faits séparés ne font pas une cause : si les fichiers
     * Outscraper contiennent surtout des adresses génériques, alors « Outscraper convertit moins »
     * et « les génériques convertissent moins » sont la MÊME observation, et le levier n'est pas de
     * changer de fournisseur mais de trier les adresses.
     */
    out.source_x_type = await sql`
      SELECT COALESCE(c.source, '(inconnue)') AS source,
             CASE
               WHEN split_part(c.email, '@', 1) ~* '^(contact|info|devis|commercial|accueil|secretariat|admin|direction|service|bonjour|hello|sav|entreprise|societe)'
                 THEN 'generique' ELSE 'nominative' END AS type_adresse,
             COUNT(*)::int AS fiches
      FROM contacts c
      WHERE c.email IS NOT NULL AND c.source IN ('google_places', 'outscraper')
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`

    /**
     * ⚠️ LE FACTEUR QUI PEUT TOUT EXPLIQUER : LA PÉRIODE.
     *
     * Les fiches Google Places ont été démarchées en juin-juillet, les fiches Outscraper surtout en
     * août — le mois où 60 % des réponses reçues étaient des absences de congés. Comparer les deux
     * sources sans tenir compte de ça, c'est comparer un mois normal à un mois mort et conclure sur
     * le fournisseur.
     *
     * On croise donc par MOIS DE PREMIER CONTACT. Si l'écart disparaît à période égale, la cause
     * n'est pas Outscraper — et changer de fournisseur coûterait cher pour rien.
     */
    /**
     * ⚠️ LES BORNES DE MOIS SE CALCULENT EN HEURE DE PARIS, PAS EN UTC (signalé par une session
     * voisine, 31/08).
     *
     * `sent_at` est un timestamp sans fuseau qui stocke de l'UTC. Un mail parti le 1er août à 00h30
     * à Paris vaut le 31 juillet 22h30 en UTC : groupé brut, il tombe dans le MAUVAIS MOIS. Sur ce
     * projet le biais n'est pas théorique — avant la pose de la fenêtre d'envoi, **56 % des mails
     * partaient hors de la plage 8h-20h**, dont 178 à minuit et 217 à deux heures du matin. Ce sont
     * précisément les envois qui basculent d'un mois à l'autre.
     *
     * Et c'est cette comparaison par mois qui sert à trancher « faut-il changer de fournisseur de
     * leads ». Une borne fausse ferait prendre une décision chère sur un artefact de fuseau.
     */
    out.par_mois_et_source = await sql`
      SELECT to_char(date_trunc('month', p.premier AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'), 'YYYY-MM') AS mois,
             p.source,
             COUNT(*)::int AS contactes,
             COUNT(*) FILTER (WHERE p.a_repondu)::int AS ont_repondu
      FROM (
        SELECT c.id, COALESCE(c.source, '(inconnue)') AS source,
               (SELECT MIN(q.sent_at) FROM email_queue q WHERE q.contact_id = c.id AND q.status = 'sent') AS premier,
               EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id
                         AND (ir.classification IS NULL OR ir.classification NOT IN ('spam','oof','warmup'))) AS a_repondu
        FROM contacts c
        WHERE c.source IN ('google_places', 'outscraper')
      ) p
      WHERE p.premier IS NOT NULL
      GROUP BY 1, 2 ORDER BY 1, 2`

    /** Les rendez-vous, datés et rattachés à leur source : la chronologie tranche mieux qu'un ratio. */
    out.rdv_par_mois_et_source = await sql`
      SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') AS mois,
             COALESCE(c.source, '(inconnue)') AS source,
             COUNT(*)::int AS rdv
      FROM rdv r LEFT JOIN contacts c ON c.id = r.contact_id
      GROUP BY 1, 2 ORDER BY 1, 3 DESC`
  }

  return NextResponse.json({ ok: true, ...out })
}

export const GET = handler
