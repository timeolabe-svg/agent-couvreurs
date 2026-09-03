import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 🔎 CONTRÔLE D'INVARIANTS — vérifie des FAITS en base, jamais du code.
 *
 * POURQUOI CET OUTIL EXISTE (10/08/2026). En deux jours, six pannes graves ont été trouvées — et
 * TOUTES par Timéo, pas par mes vérifications. Elles partagent le même défaut :
 *
 *   la fonction marchait, mais le TRAJET était cassé.
 *
 *   · la détection des « Stop » passait 13 tests sur 13… mais l'arrêt était appliqué à
 *     l'expéditeur au lieu du contact démarché → deux « Stop » ignorés pendant 5 jours ;
 *   · le garde-fou anti-invention marchait… mais il lisait comme liste blanche un réglage qui
 *     contenait le faux numéro → il VALIDAIT le faux ;
 *   · la requête de l'onglet « À valider » était correcte… mais elle interrogeait la table dont le
 *     statut avait dérivé → cinq prospects invisibles pendant trois semaines ;
 *   · le filtre anti-doublon existait… mais sur un seul des chemins d'entrée → 8 concurrents
 *     démarchés ;
 *   · mes propres audits tronquaient en silence → j'ai annoncé 20 cas là où il y en avait 340.
 *
 * Tester une fonction ne prouve donc RIEN. Ce fichier ne teste aucune fonction : il énonce ce qui
 * doit être VRAI de la base, et le vérifie. Un invariant en échec liste les lignes fautives.
 *
 * Trois familles, dans l'ordre de gravité :
 *   A. JURIDIQUE      — ce qui peut coûter une plainte
 *   B. LEAD PERDU     — ce qui coûte de l'argent en silence
 *   C. COHÉRENCE      — ce qui rend les chiffres faux, donc les décisions fausses
 */
type Etat = 'OK' | 'ECHEC' | 'INDISPONIBLE'
interface Invariant {
  code: string
  famille: 'juridique' | 'lead_perdu' | 'coherence'
  enonce: string
  etat: Etat
  nb: number
  lignes?: unknown[]
  avertissement?: string
  note?: string
}

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const out: Invariant[] = []

  /** Un invariant est VÉRIFIÉ quand la requête ne renvoie AUCUNE ligne. Toute ligne = contre-exemple. */
  /**
   * ⚠️ AUCUN PLAFOND SILENCIEUX (leçon du 09/08, re-appliquée à l'outil censé traquer cette
   * classe de défaut). Chaque requête est bornée pour rester lisible ; sans le total RÉEL, « 20
   * cas » se lit « il y en a 20 » alors qu'il peut y en avoir 340. On exécute donc l'échantillon
   * ET son COUNT, et on annonce les deux.
   */
  const verifierAvecTotal = async (
    code: string,
    famille: Invariant['famille'],
    enonce: string,
    echantillon: () => Promise<unknown>,
    total: () => Promise<unknown>,
    note?: string,
  ) => {
    try {
      const [ech, tot] = await Promise.all([echantillon(), total()])
      const lignes = Array.isArray(ech) ? ech : []
      const n = Number((tot as Array<{ n?: number }>)?.[0]?.n ?? lignes.length)
      out.push({
        code, famille, enonce,
        etat: n === 0 ? 'OK' : 'ECHEC',
        nb: n,
        ...(n > lignes.length ? { avertissement: `${n} cas au total, ${lignes.length} listés ci-dessous` } : {}),
        ...(lignes.length ? { lignes } : {}),
        ...(note ? { note } : {}),
      } as Invariant)
    } catch (e) {
      out.push({ code, famille, enonce, etat: 'INDISPONIBLE', nb: 0, note: String((e as Error)?.message ?? e).slice(0, 180) })
    }
  }

  const verifier = async (
    code: string,
    famille: Invariant['famille'],
    enonce: string,
    requete: () => Promise<unknown>,
    note?: string,
  ) => {
    try {
      const r = (await requete()) as unknown[]
      const lignes = Array.isArray(r) ? r : []
      out.push({
        code, famille, enonce,
        etat: lignes.length === 0 ? 'OK' : 'ECHEC',
        nb: lignes.length,
        ...(lignes.length ? { lignes: lignes.slice(0, 15) } : {}),
        ...(lignes.length > 15 ? { avertissement: lignes.length + ' cas au total, 15 listés' } : {}),
        ...(note ? { note } : {}),
      })
    } catch (e) {
      out.push({ code, famille, enonce, etat: 'INDISPONIBLE', nb: 0, note: String((e as Error)?.message ?? e).slice(0, 180) })
    }
  }

  // ─────────────────────────── A. JURIDIQUE ───────────────────────────

  await verifier('A1', 'juridique',
    'Aucun contact blocklisté n\'a de mail encore programmé',
    async () => await sql`
      SELECT c.email, COUNT(*)::int AS mails_programmes
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')
        AND EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      GROUP BY c.email LIMIT 500`,
    'Le cas du 04/08 : deux Stop, et 3 relances encore en file pour chacun.')

  await verifier('A2', 'juridique',
    'Aucun mail n\'est parti APRÈS que le contact a été blocklisté',
    async () => await sql`
      SELECT c.email, q.sent_at, b.created_at AS bloque_le
      FROM email_queue q
      JOIN contacts c ON c.id = q.contact_id
      JOIN blocklist b ON LOWER(b.email) = LOWER(c.email)
      WHERE q.status = 'sent' AND b.created_at IS NOT NULL AND q.sent_at > b.created_at
      ORDER BY q.sent_at DESC LIMIT 500`)

  await verifier('A3', 'juridique',
    'Aucun mail sortant ne contient un numéro d\'exemple (06 12 34 56 78 & co)',
    async () => await sql`
      SELECT c.email, q.sequence_step, q.status, q.sent_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending') AND q.body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
      ORDER BY q.sent_at DESC NULLS LAST LIMIT 500`,
    'Le faux numéro était DANS les réglages : il a donc pu partir en toute légitimité apparente.')

  await verifier('A4', 'juridique',
    'Le téléphone configuré n\'est pas un numéro d\'exemple',
    async () => await sql`
      SELECT key, value FROM agent_config
      WHERE key = 'agence_telephone'
        AND REGEXP_REPLACE(value, '\\D', '', 'g') IN
            ('0612345678','0123456789','0645454545','0600000000','0102030405','0611111111','0666666666')`,
    'Une valeur de configuration n\'est pas une vérité : c\'est une saisie humaine.')

  await verifier('A5', 'juridique',
    'Tout mail de prospection porte la mention légale d\'origine des données',
    async () => await sql`
      SELECT c.email, q.sequence_step, q.sent_at
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '30 days'
        AND q.body NOT ILIKE '%sources publiques%'
        AND q.body NOT ILIKE '%pour ne plus recevoir%'
      ORDER BY q.sent_at DESC LIMIT 500`,
    'Art. 14 RGPD : la personne doit savoir d\'où viennent ses données et comment s\'y opposer.')

  await verifier('A6', 'juridique',
    'Aucun contact en bounce n\'a de mail programmé',
    async () => await sql`
      SELECT c.email, COUNT(*)::int AS programmes
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')
        AND EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email) AND b.reason = 'bounce')
      GROUP BY c.email LIMIT 500`)

  // ─────────────────────────── B. LEAD PERDU ───────────────────────────

  await verifier('B1', 'lead_perdu',
    'Toute réponse chaude a produit une réponse envoyée ou un brouillon',
    async () => await sql`
      SELECT ir.from_email, ir.classification, ir.created_at
      FROM incoming_replies ir
      WHERE ir.created_at > NOW() - INTERVAL '60 days'
        AND ir.classification IN ('interest', 'question', 'rdv_request', 'objection')
        -- Une réponse PARTIE sans ligne de brouillon reste une réponse reçue par le prospect :
        -- c'est un trou de traçabilité, pas un lead perdu. L'invariant ne doit signaler que ce qui
        -- laisse VRAIMENT le prospect sans nouvelles, sinon il crie au loup et on l'ignore.
        AND COALESCE(ir.action_taken, '') NOT IN ('replied', 'auto_reply')
        AND NOT EXISTS (SELECT 1 FROM reply_drafts rd WHERE rd.incoming_reply_id = ir.id)
      ORDER BY ir.created_at DESC LIMIT 500`)

  await verifier('B2', 'lead_perdu',
    'Aucun brouillon en attente ne dort depuis plus de 3 jours',
    async () => await sql`
      SELECT rd.id, ir.from_email, rd.created_at,
             EXTRACT(DAY FROM NOW() - rd.created_at)::int AS jours
      FROM reply_drafts rd LEFT JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE rd.status IN ('pending', 'awaiting_validation')
        AND rd.created_at < NOW() - INTERVAL '3 days'
      ORDER BY rd.created_at LIMIT 500`,
    'Un brouillon qui dort = un prospect qui n\'a JAMAIS reçu de réponse.')

  await verifier('B3', 'lead_perdu',
    'Aucun brouillon n\'est bloqué en cours d\'envoi',
    async () => await sql`
      SELECT id, status, send_after FROM reply_drafts
      WHERE status = 'sending' AND send_after < NOW() - INTERVAL '30 minutes' LIMIT 500`,
    'Le claim atomique protège du double envoi ; sans reaper il crée du non-envoi.')

  await verifier('B4', 'lead_perdu',
    'Aucune réponse récente n\'est restée sans classification',
    async () => await sql`
      SELECT from_email, created_at, LEFT(body, 80) AS extrait
      FROM incoming_replies
      WHERE classification IS NULL AND created_at > NOW() - INTERVAL '14 days'
      ORDER BY created_at DESC LIMIT 500`)

  await verifier('B5', 'lead_perdu',
    'Aucun contact qualifié n\'est resté sans aucune ligne de file',
    async () => await sql`
      SELECT c.email, c.company FROM contacts c
      WHERE c.email_validated = true AND c.audit_done = true
        AND NOT EXISTS (SELECT 1 FROM email_queue q WHERE q.contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      LIMIT 500`,
    'Contact prêt à contacter, jamais mis en file : invisible et jamais contacté, à vie.')

  // ─────────────────────────── C. COHÉRENCE ───────────────────────────

  await verifier('C1', 'coherence',
    'Aucun contact ne reçoit deux mails le même jour',
    async () => await sql`
      SELECT c.email, q.sent_at::date AS jour, COUNT(*)::int AS n
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '7 days'
      GROUP BY c.email, q.sent_at::date HAVING COUNT(*) > 1
      ORDER BY 2 DESC LIMIT 500`)

  /**
   * ⚠️ CET INVARIANT ET LE MOTEUR SE CONTREDISAIENT D'UNE UNITÉ (signalé par la session LabegarIA,
   * 26/08). Le moteur autorise 8 mails à vie — 6 étapes de séquence plus au maximum 2 relances de
   * conversation — et cette justification est écrite dans `send-campaign`. L'invariant, lui, criait
   * dès 8. Un contact qui touchait exactement la limite prévue faisait donc échouer l'audit sans
   * qu'aucun garde-fou n'ait cédé.
   *
   * Une alerte qui se déclenche sur le comportement NORMAL est pire qu'une absence d'alerte : elle
   * apprend à ignorer le tableau. On aligne donc sur le chiffre documenté, plutôt que d'inventer un
   * seuil sans justification.
   *
   * ⚠️ Si Timéo veut réduire la pression à 7, c'est le MOTEUR qu'il faut serrer, et cet invariant
   * suivra. Ne jamais faire l'inverse : un audit plus permissif que la machine ne surveille rien.
   */
  await verifier('C2', 'coherence',
    'Aucun contact n\'a reçu plus de 8 mails à vie (5 paliers de séquence + jusqu\'à 3 de conversation)',
    async () => await sql`
      SELECT c.email, COUNT(*)::int AS mails
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent'
      GROUP BY c.email HAVING COUNT(*) > 8 ORDER BY 2 DESC LIMIT 500`)

  await verifier('C3', 'coherence',
    'Aucune relance de séquence n\'est partie après une réponse du prospect',
    async () => await sql`
      -- ⚠️ On expose sequence_step, sans quoi cet invariant est indiagnostiquable : les étapes
      -- >= 20 sont des relances DE CONVERSATION, volontairement exemptées côté send-campaign (un
      -- prospect qui a répondu puis s'est tu doit être relancé). Sans le numéro d'étape, impossible
      -- de savoir si une ligne rouge est une vraie faute ou le fonctionnement voulu — et une alerte
      -- qu'on ne peut pas trancher est une alerte qu'on finit par ignorer.
      SELECT c.email, q.sequence_step, ir.created_at AS a_repondu, q.sent_at AS relance
      FROM incoming_replies ir
      JOIN contacts c ON LOWER(c.email) = LOWER(ir.from_email)
      JOIN email_queue q ON q.contact_id = c.id
      WHERE q.status = 'sent' AND q.sent_at > ir.created_at + INTERVAL '1 hour'
        -- ⚠️ L'invariant signalait le comportement VOULU. Les étapes >= 20 sont des relances de
        -- CONVERSATION : un prospect qui a répondu puis s'est tu doit être relancé, et
        -- send-campaign les exempte explicitement de la règle « il a répondu, on s'arrête ».
        -- Les 3 lignes rouges du 06/08 étaient toutes en étape 21, donc parfaitement légitimes.
        -- Un contrôle qui n'applique pas la même règle que le moteur qu'il surveille produit une
        -- alerte permanente sur du fonctionnement normal — et une alerte permanente est une alerte
        -- morte, qui masquera la vraie le jour où elle arrivera.
        AND q.sequence_step < 20
        AND COALESCE(ir.classification, '') NOT IN ('oof', 'spam', 'warmup')
        AND ir.created_at > NOW() - INTERVAL '60 days'
        AND q.sent_at > NOW() - INTERVAL '7 days'
      ORDER BY q.sent_at DESC LIMIT 500`,
    'Le prospect doit reprendre la main : la séquence froide s\'arrête dès qu\'il écrit.')

  await verifier('C4', 'coherence',
    'Aucun mail envoyé sans trace de la boîte émettrice',
    async () => await sql`
      SELECT id, sequence_step, sent_at FROM email_queue
      WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days'
        AND (from_email IS NULL OR from_email = '' OR from_email = 'pending@hdigiweb.fr')
      ORDER BY sent_at DESC LIMIT 500`,
    'Sans boîte tracée : impossible de mesurer la réputation ni d\'épingler le fil.')

  await verifier('C5', 'coherence',
    'Aucun cron vital n\'est muet depuis plus de 3 intervalles',
    async () => await sql`
      SELECT cron_name, last_run_at, expected_interval_minutes
      FROM cron_heartbeats
      WHERE expected_interval_minutes IS NOT NULL
        AND last_run_at < NOW() - (expected_interval_minutes * 3 || ' minutes')::interval
      LIMIT 500`)

  /**
   * ⚠️ CET INVARIANT ALERTAIT SUR LE STOCK NORMAL (recalibré le 26/08).
   *
   * Il criait dès qu'un `__pending_generation__` dépassait 24 h. Or c'est exactement ce que la
   * réserve EST : une ligne `pending` porteuse d'un placeholder est un lead en attente d'admission,
   * et `autopilot-tick` n'écrit son mail qu'au moment de l'admettre. Avec 23 admissions par jour et
   * 425 leads en réserve, la quasi-totalité du stock a par construction plus de 24 h — l'invariant
   * serait passé au rouge sur 425 lignes demain matin, pour un système en parfait état.
   *
   * La bonne question n'est pas « depuis quand attend-il » mais « la file s'écoule-t-elle ». À 23
   * par jour, un lead admis en dernier attend environ trois semaines. Au-delà de soixante jours, ce
   * n'est plus de l'attente, c'est un blocage — et c'est ce qu'on surveille.
   */
  await verifier('C6', 'coherence',
    'Aucun lead en réserve n\'attend son admission depuis plus de 60 jours',
    async () => await sql`
      SELECT q.id, c.email, c.company,
             EXTRACT(DAY FROM NOW() - q.created_at)::int AS jours_d_attente
      FROM email_queue q LEFT JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'pending' AND q.body = '__pending_generation__'
        AND q.created_at < NOW() - INTERVAL '60 days'
      ORDER BY q.created_at LIMIT 500`,
    'La réserve attend par construction : ce qui doit alerter, c\'est un stock qui ne s\'écoule plus.')

  /**
   * ⚠️ C8 — LE CONTRÔLE QUI AURAIT ATTRAPÉ L'INCIDENT DU 12/08.
   *
   * Un prospect répond « NO WAY ! » depuis son adresse personnelle ; le contact professionnel
   * démarché, lui, garde sa séquence et reçoit une relance le lendemain. Aucun invariant existant
   * ne le voyait : A1 ne regarde que les contacts BLOCKLISTÉS, et c'est bien le particulier qui
   * l'avait été, pas l'entreprise.
   *
   * Celui-ci part de l'autre bout, le seul qui ne mente pas : `incoming_replies.contact_id` dit
   * QUELLE FICHE a répondu, quelle que soit l'adresse d'expédition. Dès qu'une fiche a répondu,
   * plus aucun mail FROID (étape < 20) ne doit rester programmé pour elle. Les étapes >= 20 sont
   * les relances de conversation, qui sont précisément faites pour ce cas.
   *
   * C'est l'invariant « un refus doit arrêter la machine », vérifié sur les données et non sur
   * l'intention du code.
   */
  await verifier('C8', 'juridique',
    'Aucune fiche ayant répondu ne garde de mail froid programmé',
    async () => await sql`
      SELECT DISTINCT c.email, c.company, q.sequence_step, q.scheduled_at, ir.created_at AS a_repondu_le
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      JOIN email_queue q ON q.contact_id = c.id
      WHERE q.status IN ('pending', 'queued', 'queued_instantly', 'scheduled')
        AND q.sequence_step < 20
        AND COALESCE(ir.classification, '') NOT IN ('oof', 'spam', 'warmup')
      ORDER BY q.scheduled_at ASC
      LIMIT 500`,
    'Un prospect qui a écrit reprend la main : la séquence froide s\'arrête, même s\'il a écrit depuis une autre adresse.')

  /**
   * ⚠️ C7 — ajouté le 12/08, sur signalement de la session labegaria (5 cas mesurés chez elle).
   *
   * TOUS les garde-fous du moteur d'envoi joignent sur `contact_id` : « déjà envoyé cette étape »,
   * « déjà un mail aujourd'hui », « plafond de 4 mails à vie ». Ils reposent donc entièrement sur
   * l'hypothèse « une personne = une ligne dans contacts ». La colonne `email` est UNIQUE, ce qui
   * rend l'hypothèse vraie pour une adresse à la casse identique — mais PAS pour « A@x.fr » et
   * « a@x.fr », qui sont deux lignes distinctes pour Postgres.
   *
   * Si ce cas apparaît, les trois plafonds sautent d'un coup et en silence : le prospect reçoit
   * tout en double, y compris après s'être désinscrit. Plutôt que de réécrire les cinq requêtes du
   * moteur sur une hypothèse (coûteux, risqué, et peut-être inutile), on SURVEILLE la condition qui
   * les rend fausses. Si elle se déclenche un jour, on saura qu'il faut basculer sur l'email.
   */
  await verifier('C7', 'coherence',
    'Aucune personne n\'existe en double dans contacts (même adresse, casse différente)',
    async () => await sql`
      -- ⚠️ WHERE email IS NOT NULL ajouté le 03/09/2026 (canal LinkedIn) : sans lui, GROUP BY
      -- réunit TOUS les email=NULL dans un seul groupe — 150 contacts LinkedIn (email
      -- volontairement NULL, joignables via linkedin_leads) se sont vus signalés comme UNE
      -- personne en double 150 fois. Le doublon qu'on cherche ici est une adresse EMAIL
      -- dupliquée, pas l'absence d'email — ça n'a jamais été la question posée par cet invariant.
      SELECT LOWER(email) AS adresse, COUNT(*)::int AS fiches,
             STRING_AGG(email, ' | ') AS variantes
      FROM contacts
      WHERE email IS NOT NULL
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
      LIMIT 500`)

  /**
   * ─────────────────────── D. LES CONSIGNES DE TIMÉO ───────────────────────
   *
   * ⚠️ POURQUOI CETTE FAMILLE EXISTE (26/08/2026). Timéo m'avait demandé de relire le skill pour
   * vérifier qu'aucune fonctionnalité n'avait disparu. J'ai relu du CODE, trouvé les règles à leur
   * place, et conclu que tout allait bien. Trois jours plus tard il découvre Bleu 30 Piscines : le
   * prospect avait donné une nouvelle adresse le 14/07 et six mails sont partis à l'ancienne.
   *
   *   « c'était ça mon réel objectif, tu t'es planté dans ça alors qu'avant ça marchait,
   *     c'est peut-être le cas pour d'autres fonctionnalités »
   *
   * Il a raison, et le défaut de méthode est net : **relire du code ne prouve rien**. Le code des
   * redirections était PARFAITEMENT correct — et trois prospects se faisaient quand même relancer,
   * parce qu'ils dataient d'avant le correctif. Une règle peut être vraie dans le code et fausse
   * dans la base ; c'est la base que les prospects reçoivent.
   *
   * Chaque consigne donnée par Timéo devient donc ici un FAIT vérifiable, et non une intention
   * qu'on relit. Toute consigne future s'ajoute à cette liste — c'est la réponse à sa demande
   * « faut bien réenregistrer toutes les consignes que je t'ai données, que ça marche vraiment et
   * que ça ne se supprime pas ». Une consigne qui n'est pas mesurée ici n'est pas tenue : elle est
   * seulement espérée.
   */

  await verifier('D1', 'juridique',
    'Un prospect qui a donné une nouvelle adresse n\'a plus aucun mail en file',
    async () => await sql`
      SELECT c.company, c.email, c.redirige_vers,
             COUNT(*)::int AS encore_en_file
      FROM contacts c JOIN email_queue q ON q.contact_id = c.id
      WHERE q.status IN ('queued', 'pending', 'sending', 'scheduled')
        AND EXISTS (
          SELECT 1 FROM incoming_replies ir
          WHERE ir.contact_id = c.id
            AND (ir.body ILIKE '%changement d%adresse%' OR ir.body ILIKE '%nouvelle adresse%'
              OR ir.body ILIKE '%nouveau mail%' OR ir.body ILIKE '%nouvel email%')
        )
      GROUP BY c.company, c.email, c.redirige_vers LIMIT 500`,
    'Le cas Bleu 30 Piscines : nouvelle adresse annoncée le 14/07, six mails partis à l\'ancienne.')

  /**
   * ⚠️ CE QUE CET INVARIANT NE DOIT PAS COMPTER (corrigé le 26/08, dès sa première exécution).
   *
   * Ma première version joignait sur `incoming_reply_id` : elle criait dès qu'un message PARTAIT
   * après un refus sur le même fil. Elle a donc épinglé Jaky Lesage, où Timéo avait refusé un
   * « Bien noté, merci » puis m'avait demandé lui-même d'écrire « on n'a pas pu se libérer, quel
   * jour vous arrange ». Deux textes n'ayant rien à voir.
   *
   * Or ce que la consigne interdit, c'est de REPRÉSENTER le texte refusé, pas de reparler au
   * prospect. On compare donc les corps : seule la réapparition du MÊME message est une faute. Une
   * alerte qui se déclenche sur le comportement voulu est une alerte qu'on apprend à ignorer, et
   * c'est justement ce tableau qui doit rester crédible.
   */
  await verifier('D2', 'lead_perdu',
    'Aucun brouillon REFUSÉ par Timéo n\'est reparti avec le même texte',
    async () => await sql`
      SELECT ir.from_email, rd.rejete_le, rd2.sent_at AS renvoye_le,
             LEFT(rd2.body, 80) AS texte
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      JOIN reply_drafts rd2 ON rd2.incoming_reply_id = rd.incoming_reply_id
      WHERE rd.status = 'rejected' AND rd.rejete_par = 'humain'
        AND rd2.status = 'sent' AND rd2.sent_at > rd.rejete_le
        AND LEFT(REGEXP_REPLACE(rd2.body, '\\s+', ' ', 'g'), 60)
          = LEFT(REGEXP_REPLACE(rd.body, '\\s+', ' ', 'g'), 60)
      ORDER BY rd2.sent_at DESC LIMIT 500`,
    '« À valider » est sacré : un texte que Timéo a refusé ne doit jamais repartir par un autre chemin.')

  await verifier('D3', 'coherence',
    'Aucun mail n\'est parti à un prospect APRÈS que son rendez-vous a été confirmé',
    async () => await sql`
      SELECT c.email, r.scheduled_at AS rdv_le, q.sequence_step, q.sent_at
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      JOIN email_queue q ON q.contact_id = c.id
      WHERE r.status = 'confirmed' AND q.status = 'sent'
        AND q.sent_at > r.created_at + INTERVAL '1 hour'
        AND q.sequence_step < 20
        AND q.sent_at > NOW() - INTERVAL '30 days'
      ORDER BY q.sent_at DESC LIMIT 500`,
    'Consigne du 20/08 : « une fois qu\'il a dit oui tu dois arrêter de lui envoyer des messages ».')

  await verifier('D4', 'coherence',
    'Jamais deux messages de notre part à moins de 2 h sans que le prospect ait écrit entre les deux',
    async () => await sql`
      WITH envois AS (
        SELECT q.contact_id, q.sent_at,
               LAG(q.sent_at) OVER (PARTITION BY q.contact_id ORDER BY q.sent_at) AS precedent
        FROM email_queue q
        WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '14 days'
      )
      SELECT c.email, e.precedent, e.sent_at,
             ROUND(EXTRACT(EPOCH FROM (e.sent_at - e.precedent)) / 60)::int AS minutes
      FROM envois e JOIN contacts c ON c.id = e.contact_id
      WHERE e.precedent IS NOT NULL
        AND e.sent_at - e.precedent < INTERVAL '120 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM incoming_replies ir
          WHERE ir.contact_id = e.contact_id
            AND ir.created_at BETWEEN e.precedent AND e.sent_at
        )
      ORDER BY e.sent_at DESC LIMIT 500`,
    'Jaky Lesage, 25/08 : six messages en vingt et une minutes, trois voix sur le même fil.')

  /**
   * ⚠️ RÉPONDRE À UN ROBOT N'EST PAS RÉPONDRE À UN ROBOT (corrigé le 26/08, dès la première
   * exécution : seize lignes rouges, seize faux positifs).
   *
   * Il existe DEUX gestes très différents sur un message d'absence, et ma première version les
   * confondait :
   *
   *   · répondre TOUT DE SUITE à l'auto-répondeur, comme si une personne avait écrit. C'est la
   *     faute du 19/08 (« t'es con ou quoi tu veux répondre à un bot ?? »).
   *   · relancer APRÈS la date de retour annoncée — « vous m'aviez indiqué être fermé, j'espère
   *     que la reprise se passe bien ». C'est une fonctionnalité que Timéo a explicitement voulue,
   *     et dispensée de validation le 21/08.
   *
   * Les seize lignes étaient toutes des reprises après congés, envoyées le lendemain du retour. La
   * frontière n'est donc pas « a-t-on répondu » mais « QUAND ». On ne signale que la réponse tirée
   * dans les 24 h suivant l'auto-répondeur : à ce moment-là, l'entreprise est encore fermée et
   * personne ne lit.
   */
  await verifier('D5', 'coherence',
    'Aucune réponse immédiate n\'a été envoyée à un robot (absence, accusé de réception)',
    async () => await sql`
      SELECT ir.from_email, ir.classification, ir.created_at AS robot_recu_le, rd.sent_at
      FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE rd.status = 'sent' AND ir.classification IN ('oof', 'spam', 'warmup')
        AND rd.sent_at < ir.created_at + INTERVAL '24 hours'
      ORDER BY rd.sent_at DESC LIMIT 500`,
    'Répondre tout de suite à un auto-répondeur est une faute ; relancer après la date de retour est la fonctionnalité voulue.')

  /**
   * ⚠️ CET INVARIANT ÉTAIT VERT POUR LA MAUVAISE RAISON (corrigé le 27/08).
   *
   * Il filtrait sur `q.sent_at > NOW() - INTERVAL '30 days'`. Or `sent_at` est NULL tant qu'un mail
   * n'est pas parti : la condition écartait donc TOUTE la file, c'est-à-dire précisément ce qu'on
   * peut encore empêcher. Mesuré ce jour-là : 326 entreprises sous 20 avis avaient des mails en
   * file, et l'invariant affichait vert.
   *
   * Le moteur les filtre bien au moment d'envoyer (`send-campaign`, clause sur `google_reviews_count`),
   * donc rien ne partait — mais un invariant qui ne peut pas voir la file ne surveille que le passé.
   * On sépare donc les deux : ce qui est PARTI (faute consommée) et ce qui est EN FILE (encore
   * évitable), sans jamais confondre les deux.
   */
  await verifier('D6', 'coherence',
    'Aucun mail froid vers une entreprise sous les 20 avis Google, parti OU en file',
    async () => await sql`
      SELECT c.company, c.email, c.google_reviews_count,
             COUNT(*) FILTER (WHERE q.status = 'sent')::int AS deja_partis,
             COUNT(*) FILTER (WHERE q.status IN ('queued', 'pending'))::int AS en_file
      FROM contacts c JOIN email_queue q ON q.contact_id = c.id
      WHERE c.google_reviews_count IS NOT NULL AND c.google_reviews_count < 20
        AND q.sequence_step < 20
        AND (
          (q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '30 days')
          OR q.status IN ('queued', 'pending')
        )
      GROUP BY c.company, c.email, c.google_reviews_count
      ORDER BY c.google_reviews_count LIMIT 500`,
    'Consigne Timéo : on ne contacte QUE les entreprises à 20 avis ou plus. Les autres vont à LabegarIA.')

  /**
   * ⚠️ D13 — LE NUMÉRO QUI SORT DOIT ÊTRE LE VRAI, PAS SEULEMENT « PAS UN FAUX ».
   *
   * Consigne de Timéo le 27/08, après avoir appris que 640 entreprises avaient reçu le numéro
   * d'exemple : « pour tous les prochains mails tu dois mettre le bon numéro, c'est important ».
   *
   * L'invariant A3 ne cherchait que trois numéros d'exemple connus — il ne voyait donc pas un
   * quatrième numéro inventé. Celui-ci prend le problème par l'autre bout : on extrait TOUS les
   * numéros français du corps et on vérifie qu'il n'en reste aucun autre que celui de l'agence.
   * Une liste de choses interdites est toujours incomplète ; une liste de ce qui est autorisé, non.
   */
  await verifier('D13', 'juridique',
    'Aucun numéro de téléphone sortant autre que celui de l\'agence',
    async () => await sql`
      SELECT numero, COUNT(*)::int AS occurrences
      FROM (
        SELECT REGEXP_REPLACE((REGEXP_MATCHES(body, '0[1-9](?:[ .-]?[0-9]{2}){4}', 'g'))[1], '[^0-9]', '', 'g') AS numero
        FROM email_queue
        WHERE status IN ('queued', 'pending')
           OR (status = 'sent' AND sent_at > NOW() - INTERVAL '14 days')
      ) x
      WHERE numero <> '0629990396'
      GROUP BY numero ORDER BY 2 DESC LIMIT 20`,
    'Le vrai numéro Hdigiweb est le 06 29 99 03 96. Tout autre numéro dans un mail est une invention.')

  await verifier('D7', 'coherence',
    'Aucun mail en partance ne contient de tiret cadratin',
    async () => await sql`
      SELECT c.email, q.sequence_step, q.status
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')
        AND (q.body LIKE '%—%' OR q.body LIKE '%–%')
      LIMIT 500`,
    'Consigne de style : les mails ne contiennent ni tiret cadratin ni deux-points.')

  await verifier('D8', 'juridique',
    'Une plainte sur le NOMBRE de mails a bien coupé les relances',
    async () => await sql`
      SELECT c.email, ir.created_at AS plainte_le, COUNT(q.id)::int AS encore_en_file
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      JOIN email_queue q ON q.contact_id = c.id AND q.status IN ('queued', 'pending', 'scheduled')
      WHERE (ir.body ILIKE '%arretez de m%envoyer%' OR ir.body ILIKE '%trop de mails%'
          OR ir.body ILIKE '%cesser de m%envoyer%' OR ir.body ILIKE '%combien de mails%'
          OR ir.body ILIKE '%plusieurs mails%' OR ir.body ILIKE '%harc%')
      GROUP BY c.email, ir.created_at LIMIT 500`,
    'Se plaindre de la pression d\'envoi vaut « stop », même sans le mot : leçon écrite le 14/08 et jamais mise en code jusqu\'ici.')

  await verifier('D9', 'coherence',
    'Aucune adresse non validée par MillionVerifier n\'a reçu de mail',
    async () => await sql`
      SELECT c.email, c.email_validated, MAX(q.sent_at) AS dernier_envoi
      FROM contacts c JOIN email_queue q ON q.contact_id = c.id
      WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '30 days'
        AND COALESCE(c.email_validated, false) = false
      GROUP BY c.email, c.email_validated LIMIT 500`,
    'Le catch_all est une source de bounce : seules les adresses validées partent.')

  /**
   * ⚠️ D10 — UN RATTACHEMENT QUI ÉCRIT DOIT DÉSIGNER QUELQU'UN (26/08, session LabegarIA).
   *
   * Une réponse venue d'une adresse inconnue est rattachée à une fiche par l'OBJET du mail. Si cet
   * objet a servi à plusieurs contacts — 417 objets sur 3 799 chez nous — le rattachement ne désigne
   * personne, et il sert pourtant à blockliser et à annuler des files.
   *
   * L'invariant ne juge que ce qui est encore réparable : une réponse rattachée à une fiche dont ce
   * n'est pas l'adresse, alors que son objet est ambigu. C'est le contre-exemple exact.
   */
  await verifier('D10', 'juridique',
    'Aucune réponse n\'est rattachée à une fiche par un objet qui désigne plusieurs contacts',
    async () => await sql`
      SELECT ir.from_email, c.email AS fiche, c.company, ir.created_at,
             (SELECT COUNT(DISTINCT eq.contact_id)::int FROM email_queue eq
               WHERE LOWER(eq.subject) = LOWER(ir.subject) AND eq.status = 'sent') AS contacts_partageant_l_objet
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.subject IS NOT NULL
        AND LOWER(c.email) <> LOWER(ir.from_email)
        AND (SELECT COUNT(DISTINCT eq.contact_id) FROM email_queue eq
              WHERE LOWER(eq.subject) = LOWER(ir.subject) AND eq.status = 'sent') > 1
      ORDER BY ir.created_at DESC LIMIT 500`,
    'Un rattachement approximatif est pire qu\'une absence de rattachement, parce qu\'il écrit.')

  /**
   * ⚠️ D11 — CE QU'ON N'A PAS SU RATTACHER DOIT ÊTRE REPRIS À LA MAIN.
   *
   * Depuis qu'on refuse les rattachements par objet ambigu (D10), des messages restent sans fiche.
   * Ils sont tracés dans `imap_messages_ecartes` avec le motif « A RATTACHER A LA MAIN ». Cet
   * invariant s'assure qu'ils ne dorment pas : au-delà de trois jours, personne ne les reprendra
   * jamais, et un message reçu qu'on n'a jamais lu est le pire des leads perdus — on ne sait même
   * pas qu'il existait.
   */
  await verifier('D11', 'lead_perdu',
    'Aucun message non rattaché n\'attend d\'être repris depuis plus de 3 jours',
    async () => await sql`
      SELECT message_id, motif, boite, vu_le
      FROM imap_messages_ecartes
      WHERE motif LIKE 'A RATTACHER A LA MAIN%'
        AND vu_le < NOW() - INTERVAL '3 days'
      ORDER BY vu_le LIMIT 500`,
    'Ne pas rattacher ne veut pas dire jeter : un message écarté sans reprise est un lead perdu invisible.')

  /**
   * ⚠️ D12 — LA FENÊTRE D'ENVOI MORD-ELLE VRAIMENT ?
   *
   * Avoir écrit la règle ne prouve pas qu'elle s'applique : un kill-switch laissé en environnement,
   * un autre chemin d'envoi, et la fenêtre devient inopérante sans que rien ne le signale. On mesure
   * donc le fait, pas l'intention.
   *
   * Deux précautions de mise en œuvre, données par la session LabegarIA qui s'est fait piéger sur les
   * deux :
   *
   *  1. BORNER AU LENDEMAIN DE LA POSE, pas au jour même. Sinon les mails partis quelques heures
   *     avant le déploiement ressortent à chaque passage — un invariant rouge à vie sur une faute
   *     irréversible est un invariant qu'on cesse de regarder. C'est la leçon de D4, appliquée à une
   *     borne fixe.
   *  2. NE COMPTER QUE LE COLD (étape < 20). Les relances de conversation sont un autre régime ;
   *     les inclure ferait échouer le contrôle en permanence, et on finirait par relâcher la fenêtre
   *     pour faire taire l'alerte — exactement l'inverse du but.
   */
  await verifier('D12', 'coherence',
    'Aucun mail froid n\'est parti hors de la fenêtre lun-ven 8h-19h Paris',
    async () => await sql`
      SELECT c.email, q.sequence_step, q.sent_at,
             to_char(q.sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris', 'Dy HH24:MI') AS heure_paris
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent'
        AND q.sequence_step < 20
        AND q.sent_at >= TIMESTAMP '2026-08-27'
        AND (
          EXTRACT(DOW FROM q.sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') IN (0, 6)
          OR EXTRACT(HOUR FROM q.sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') < 8
          OR EXTRACT(HOUR FROM q.sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris') >= 19
        )
      ORDER BY q.sent_at DESC LIMIT 500`,
    'Borné au 27/08, lendemain de la pose : avant, 56 % des mails partaient hors fenêtre — dette irréversible, pas alerte.')

  // ── MÉMOIRE DES FAUTES DÉJÀ COMMISES ─────────────────────────────────
  // Un invariant doit être SATISFIABLE : s'il compte des faits passés qu'on ne peut plus défaire,
  // il reste rouge à vie et on cesse de le regarder — c'est ce qui est arrivé à l'alerte
  // « linkedin-bot MUET », et ce que j'ai refait deux fois aujourd'hui. Les invariants ci-dessus
  // ne jugent donc QUE ce qui peut encore se produire. Ce qui est déjà parti est compté ici, à
  // part : c'est une dette, pas une alerte.
  const historique: Record<string, number> = {}
  try {
    const [a] = (await sql`
      SELECT COUNT(*)::int AS n FROM email_queue
      WHERE status = 'sent'
        AND body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
    `) as Array<{ n: number }>
    historique.mails_partis_avec_un_faux_numero = a?.n ?? 0
    const [b] = (await sql`
      SELECT COUNT(DISTINCT c.email)::int AS n
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent'
        AND q.body ~ '0(6[\\s.-]?12[\\s.-]?34[\\s.-]?56[\\s.-]?78|1[\\s.-]?23[\\s.-]?45[\\s.-]?67[\\s.-]?89|6[\\s.-]?45[\\s.-]?45[\\s.-]?45[\\s.-]?45)'
    `) as Array<{ n: number }>
    historique.prospects_ayant_recu_un_faux_numero = b?.n ?? 0
  } catch { /* informatif */ }

  const echecs = out.filter(i => i.etat === 'ECHEC')
  const indispo = out.filter(i => i.etat === 'INDISPONIBLE')
  return NextResponse.json({
    ok: true,
    projet: 'Hdigiweb (agent-couvreurs)',
    verifie_le: new Date().toISOString(),
    resume: {
      total: out.length,
      respectes: out.filter(i => i.etat === 'OK').length,
      EN_ECHEC: echecs.length,
      non_verifiables: indispo.length,
      echecs_juridiques: echecs.filter(i => i.famille === 'juridique').length,
    },
    historique,
    invariants: out,
  })
}

export const GET = wrapCron('invariants', handler)
