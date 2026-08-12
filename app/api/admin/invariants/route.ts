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

  await verifier('C2', 'coherence',
    'Aucun contact n\'a reçu plus de 7 mails à vie',
    async () => await sql`
      SELECT c.email, COUNT(*)::int AS mails
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent'
      GROUP BY c.email HAVING COUNT(*) > 7 ORDER BY 2 DESC LIMIT 500`)

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

  await verifier('C6', 'coherence',
    'Aucun placeholder de génération n\'est resté figé plus de 24 h',
    async () => await sql`
      SELECT id, contact_id, created_at FROM email_queue
      WHERE status = 'pending' AND body = '__pending_generation__'
        AND created_at < NOW() - INTERVAL '24 hours'
      LIMIT 500`)

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
      SELECT LOWER(email) AS adresse, COUNT(*)::int AS fiches,
             STRING_AGG(email, ' | ') AS variantes
      FROM contacts
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
      LIMIT 500`)

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
