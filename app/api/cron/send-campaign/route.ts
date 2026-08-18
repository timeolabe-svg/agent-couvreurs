/**
 * GET /api/cron/send-campaign
 *
 * MOTEUR D'ENVOI MAISON — remplace Instantly pour l'ENVOI (Instantly = warmup only).
 * Lit la file email_queue (mails dus), envoie via les boîtes Google chauffées
 * (SMTP smtp.gmail.com). Trois enveloppes indépendantes/jour : nouveaux contacts (garanti,
 * NEW_CAP_PER_BOX/boîte), relances de séquence (RELANCE_CAP_PER_BOX, garde-fou large) et
 * relances de conversation (CONVO_DAILY_CAP, global). Aucune limite de leads.
 *
 * PROTECTIONS ANTI-BOUCLE (leçon du bug "130 mails à un contact") :
 *  - kill-switch SEND_PAUSED=1 (coupe tout envoi instantanément)
 *  - claim ATOMIQUE : une ligne passe en 'sending' avant l'envoi → jamais re-sélectionnée
 *  - reaper : requeue les 'sending' coincés > 15 min (crash/timeout)
 *  - échec d'envoi → 'failed' (JAMAIS de retour en file = zéro renvoi en boucle)
 *  - anti-doublon : ne renvoie JAMAIS un (contact, étape) déjà 'sent'
 *  - plafond À VIE : max 4 mails 'sent' par contact (séquence complète), point.
 *
 * À brancher sur cron-job.org toutes les 5-10 min. Chaque run envoie jusqu'à MAX_PER_RUN mails.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox, type GmailBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'
import { blocLegalRgpd } from '@/lib/rgpd'
import { creerJetonDesabo } from '@/lib/unsubscribe-token'

/**
 * Domaine public de l'application, utilisé pour les liens de désabonnement.
 *
 * ⚠️ On ne se sert PAS de `VERCEL_URL` : sa valeur est l'URL unique du déploiement
 * (`agent-couvreurs-k1ttnbral-….vercel.app`), qui change à CHAQUE mise en production. Un lien de
 * désabonnement doit rester cliquable des mois plus tard, dans un mail archivé — un prospect qui
 * retombe sur une URL morte n'a plus qu'un recours : « Signaler comme spam ».
 */
const BASE_URL = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ⚠️ TROIS ENVELOPPES TOTALEMENT INDÉPENDANTES (demande explicite : "160 entreprises contactées
// par jour SANS compter les relances, et si 300 relances à faire, fait les 300 en plus"). Une
// enveloppe pleine ne mange JAMAIS la capacité d'une autre — sinon on retombe dans le bug du
// 27/07 (140 mails envoyés, 0 nouveau contact, tout mangé par les relances).
// 1) NOUVEAUX CONTACTS (step 0) : cible garantie, jamais réduite par les relances.
const NEW_CAP_PER_BOX = 40 // × 4 boîtes = 160/jour
// 2) RELANCES DE SÉQUENCE (step 1-19) : PAS de plafond métier — juste un garde-fou technique très
// large. Boîtes = Google Workspace (domaines custom hdigiweb-*.com, pas du Gmail grand public),
// limite réelle Google très supérieure à ce plafond. Sert seulement à éviter un bug qui enverrait
// un volume infini en boucle.
const RELANCE_CAP_PER_BOX = 150 // × 4 boîtes = 600/jour de marge — largement au-dessus du besoin réel
// 3) RELANCES DE CONVERSATION (step >= 20) : gens qui ont RÉPONDU, risque quasi nul, plafond
// global séparé (pas per-boîte, peu de volume en pratique).
const CONVO_DAILY_CAP = 30
const MAX_PER_RUN = 8 // Runs fréquents (5-10 min) → débit total largement suffisant même bridé par TIME_BUDGET_MS ci-dessous.
// ⚠️ L'envoi est SÉQUENTIEL (un mail SMTP après l'autre) : un seul envoi lent (jusqu'à ~8s au
// pire avec les timeouts nodemailer resserrés, cf. gmail-sender.ts) peut, cumulé, dépasser la
// coupe dure de 30s de cron-job.org avant même d'atteindre MAX_PER_RUN. Budget temps mur : on
// arrête proprement AVANT le prochain envoi si on approche la coupe, la ligne reste 'sending'
// et sera récupérée par le REAPER (>15 min) au prochain run — jamais de renvoi en double.
const TIME_BUDGET_MS = 15_000 // 20s était trop haut : 20s + un envoi SMTP lent (socketTimeout 8s + retry) dépassait la coupe 30s de cron-job.org. 15s + ~8s = ~23s, marge sûre.
// Plafond à vie par contact. La séquence validée fait 6 mails (J+0/2/5/8/12/16) et un lead qui
// répond peut recevoir jusqu'à 2 relances de conversation → 8 au maximum absolu, JAMAIS plus.
// (Garde-fou anti-boucle hérité de l'incident des 130 mails : ne pas monter au-delà.)
const LIFETIME_CAP_PER_CONTACT = 8

interface ClaimedRow {
  id: string
  subject: string
  body: string
  sequence_step: number
  campaign_id: string
  contact_id: string
  from_email: string
}

/**
 * ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48). Le try interne de runCron ne couvre PAS ce qui le
 * précède (lecture des secteurs en pause, import de la lib DB) : une erreur là remontait en 500
 * au corps vide, sans motif visible depuis cron-job.org et sans heartbeat posé.
 */
export async function GET(req: NextRequest) {
  try {
    const res = await runCron(req)
    await pingHeartbeat("send-campaign", res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[send-campaign]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat("send-campaign", false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({ ok: false, error: String(e.message ?? err).slice(0, 300), cause: e.cause?.message?.slice(0, 200), code: e.code }, { status: 500 })
  }
}
async function runCron(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // KILL-SWITCH d'urgence : coupe tout envoi si SEND_PAUSED=1 (env Vercel).
  if (process.env.SEND_PAUSED === '1') {
    return NextResponse.json({ ok: true, paused: true, message: 'Envoi en pause (SEND_PAUSED=1)' })
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  // Si MillionVerifier est configuré → on n'envoie QU'aux emails VALIDÉS (email_validated=true),
  // ce qui élimine les bounces. Sans MV → on garde l'ancien comportement (confiance >= 90).
  const requireValidated = Boolean(process.env.MILLION_VERIFIER_API_KEY)

  const { sql } = await import('@/lib/db')

  // SECTEURS EN PAUSE — verrou aussi au niveau de l'ENVOI (audit 02/08) : la pause n'était
  // vérifiée qu'à la promotion (autopilot-tick). Un step-0 déjà 'queued' AVANT la pause, ou
  // débloqué plus tard (validation MV tardive), serait parti quand même. Ceinture + bretelles :
  // le claim ci-dessous exclut les step-0 des secteurs en pause (relances steps ≥ 1 non touchées,
  // conformément à la règle "la pause ne bloque QUE les nouveaux contacts").
  let pausedSectors: string[] = []
  try {
    const { getPausedSectors } = await import('@/lib/experiments')
    pausedSectors = await getPausedSectors()
  } catch { /* pas de pause configurée */ }

  const started = Date.now()
  try {
    const boxes = getGmailBoxes()
    if (boxes.length === 0) {
      return NextResponse.json({ error: 'aucune boîte Gmail configurée (IMAP_ACCOUNTS)' }, { status: 500 })
    }

    // Colonnes de traçage (idempotent).
    await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS sent_via TEXT`

    // Capacité restante par boîte aujourd'hui, PAR ENVELOPPE (nouveaux vs relances de séquence).
    // Les deux compteurs sont indépendants : le sent_via + sequence_step de chaque mail déjà
    // envoyé aujourd'hui détermine dans QUELLE enveloppe il a été décompté.
    const sentToday = (await sql`
      SELECT sent_via,
        SUM(CASE WHEN sequence_step = 0 THEN 1 ELSE 0 END)::int AS new_sent,
        SUM(CASE WHEN sequence_step BETWEEN 1 AND 19 THEN 1 ELSE 0 END)::int AS relance_sent
      FROM email_queue
      WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sent_via IS NOT NULL
      GROUP BY sent_via
    `) as Array<{ sent_via: string; new_sent: number; relance_sent: number }>
    const newSentByBox = new Map(sentToday.map(r => [r.sent_via, r.new_sent]))
    const relanceSentByBox = new Map(sentToday.map(r => [r.sent_via, r.relance_sent]))
    const capNew = new Map(boxes.map(b => [b.email, NEW_CAP_PER_BOX - (newSentByBox.get(b.email) ?? 0)]))
    const capRelance = new Map(boxes.map(b => [b.email, RELANCE_CAP_PER_BOX - (relanceSentByBox.get(b.email) ?? 0)]))
    const totalNewCap = [...capNew.values()].reduce((s, c) => s + Math.max(0, c), 0)
    const totalRelanceCap = [...capRelance.values()].reduce((s, c) => s + Math.max(0, c), 0)

    const results: string[] = []
    results.push(`Boîtes: ${boxes.length} | nouveaux dispo aujourd'hui: ${totalNewCap} | relances dispo: ${totalRelanceCap}`)

    // Plafond SÉPARÉ pour les relances de conversation (step >= 20) : elles passent même si les
    // deux autres enveloppes sont saturées (destinataire = a répondu, faible risque).
    const [{ convoSent }] = (await sql`SELECT COUNT(*)::int AS "convoSent" FROM email_queue WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sequence_step >= 20`) as Array<{ convoSent: number }>
    const convoCapacity = Math.max(0, CONVO_DAILY_CAP - (convoSent ?? 0))
    if (totalNewCap <= 0 && totalRelanceCap <= 0 && convoCapacity <= 0) {
      return NextResponse.json({ ok: true, sent: 0, results: [...results, 'Plafond quotidien atteint (nouveaux, relances ET conversation)'] })
    }

    // REAPER : une ligne coincée en 'sending' > 15 min = le run qui l'a réclamée a crashé.
    // On ne peut PAS savoir si le SMTP est parti avant le crash → on la marque 'failed' (JAMAIS
    // 'queued'), pour ne JAMAIS risquer de renvoyer un mail déjà parti. Un mail rare perdu est
    // acceptable ; un doublon (réputation/juridique) ne l'est pas. Cas très rare (runs < 30s).
    const reaped = (await sql`
      UPDATE email_queue SET status = 'failed'
      WHERE status = 'sending' AND sent_at < NOW() - INTERVAL '15 minutes'
      RETURNING id
    `) as Array<{ id: string }>
    if (reaped.length > 0) results.push(`⚠ ${reaped.length} ligne(s) 'sending' coincée(s) → 'failed' (anti-renvoi)`)

    // CLAIM ATOMIQUE : sort les lignes 'queued' → 'sending' en UNE requête (UPDATE ... WHERE id IN (SELECT)).
    // Une ligne passée en 'sending' ne peut PLUS être re-sélectionnée par un run concurrent
    // ni par une réexécution après timeout → zéro renvoi en boucle.
    const limit = MAX_PER_RUN
    const claimed = (await sql`
      UPDATE email_queue SET status = 'sending', sent_at = NOW()
      WHERE id IN (
        -- ⚠️ DISTINCT ON (contact_id) : le NOT EXISTS anti-clustering ci-dessous vérifie l'état de
        -- la table AVANT cette requête, donc il ne voit PAS les autres lignes réclamées dans LE
        -- MÊME lot. Sans ce DISTINCT ON, un contact avec 3 relances en retard (aucune 'sent'
        -- aujourd'hui pour l'instant) passait les 3 en même temps dans un seul UPDATE — vécu le
        -- 28/07 (3-4 mails au même contact à quelques secondes d'intervalle, MALGRÉ la garde anti-
        -- clustering déjà en place). Ce DISTINCT ON garantit AU PLUS UNE ligne par contact PAR LOT,
        -- quel que soit le nombre d'étapes en retard.
        -- ⚠️ Postgres interdit FOR UPDATE combiné à DISTINCT/DISTINCT ON dans la MÊME requête :
        -- le verrou (FOR UPDATE SKIP LOCKED) reste isolé dans la sous-requête candidates la plus
        -- interne (simple SELECT filtré, sans DISTINCT) ; le DISTINCT ON s'applique ENSUITE, sur le
        -- résultat déjà verrouillé, dans une requête sans clause de verrou (pas nécessaire ni permis).
        SELECT picked.id FROM (
          SELECT DISTINCT ON (candidates.contact_id) candidates.id, candidates.sequence_step, candidates.scheduled_at
          FROM (
        SELECT eq.id, eq.contact_id, eq.sequence_step, eq.scheduled_at
        FROM email_queue eq
        JOIN contacts c ON c.id = eq.contact_id
        WHERE eq.status = 'queued'
          AND eq.scheduled_at <= NOW()
          AND c.email IS NOT NULL
          -- Chaque ligne ne peut être réclamée QUE si SON enveloppe a encore de la place :
          -- nouveaux (step 0) / relances de séquence (step 1-19) / relances de conversation (step >= 20).
          AND (
            (eq.sequence_step = 0 AND ${totalNewCap} > 0)
            OR (eq.sequence_step BETWEEN 1 AND 19 AND ${totalRelanceCap} > 0)
            OR (eq.sequence_step >= 20 AND ${convoCapacity} > 0)
          )
          -- SECTEUR EN PAUSE (verrou envoi, audit 02/08) : un step-0 d'un secteur en pause ne part
          -- JAMAIS, même s'il était déjà en file avant la pause ou débloqué par une validation MV
          -- tardive. COALESCE(..., false) = NULL-safe : un contact sans secteur classé n'est pas
          -- bloqué par erreur (piège NULL NOT IN, leçon 72). Les relances (steps >= 1) passent.
          AND NOT (
            eq.sequence_step = 0
            AND COALESCE(c.sector IN (SELECT jsonb_array_elements_text(${JSON.stringify(pausedSectors)}::jsonb)), false)
          )
          -- ANTI-RÉPÉTITION : jamais de relance FROIDE (steps 0-3) à un contact qui a déjà
          -- répondu. EXCEPTION : les relances de CONVERSATION (steps >= 20) visent justement
          -- des gens qui ont répondu puis se sont tus → elles doivent passer.
          AND (
            eq.sequence_step >= 20
            OR NOT EXISTS (
              SELECT 1 FROM incoming_replies ir
              WHERE LOWER(ir.from_email) = LOWER(c.email)
                AND (ir.classification IS NULL OR ir.classification NOT IN ('oof', 'spam'))
            )
          )
          -- CIBLAGE CLIENT (Haris) : au moins 20 avis Google. Bloque aussi les contacts déjà en
          -- file qui étaient sous le seuil. EXCEPTION : les relances de conversation (step >= 20)
          -- vont à des gens qui ont DÉJÀ répondu — on ne les abandonne pas pour un critère de ciblage.
          AND (eq.sequence_step >= 20 OR COALESCE(c.google_reviews_count, 0) >= 20)
          -- ANTI-BOUNCE : si MillionVerifier est actif, on n'envoie QU'aux emails validés.
          -- EXCEPTION : les relances de CONVERSATION (step >= 20) visent des gens qui ont DÉJÀ
          -- RÉPONDU → leur email est prouvé livrable. Les bloquer sur le gate MV faisait qu'un lead
          -- chaud silencieux n'était jamais relancé (relance restait 'queued' à vie). On les exempte.
          AND (eq.sequence_step >= 20 OR c.email_validated IS TRUE OR ${!requireValidated})
          -- OPT-OUT / BOUNCE : jamais à une adresse ou un domaine blocklisté.
          AND NOT EXISTS (
            SELECT 1 FROM blocklist b
            WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
               OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
          )
          -- ANTI-DOUBLON : ne JAMAIS renvoyer un (contact, étape) déjà envoyé.
          AND NOT EXISTS (
            SELECT 1 FROM email_queue s
            WHERE s.contact_id = eq.contact_id AND s.sequence_step = eq.sequence_step AND s.status = 'sent'
          )
          -- ANTI-CLUSTERING : jamais 2 mails au MÊME contact le MÊME jour. Un contact qui a
          -- accumulé plusieurs relances en retard (scheduled_at dans le passé sur 2-3 steps à la
          -- fois — ça arrive dès qu'un backlog s'accumule) ne doit PAS les recevoir toutes le même
          -- jour à quelques heures d'intervalle : le prospect le vit comme un harcèlement (vécu
          -- le 27/07 : 3 relances à 09h30/09h56/12h13 → plainte explicite du prospect). Chaque
          -- étape en retard part le jour suivant, pas le jour même que la précédente.
          AND NOT EXISTS (
            SELECT 1 FROM email_queue s5
            WHERE s5.contact_id = eq.contact_id AND s5.status = 'sent' AND s5.sent_at::date = CURRENT_DATE
          )
          -- ANTI-DOUBLON INTRA-RUN : si DEUX lignes 'queued' existent pour le même (contact, étape)
          -- (double enqueue / backfill / requeue), aucune n'est encore 'sent' → sans ce garde les
          -- deux seraient réclamées dans le même lot et envoyées. On ne garde que la plus ancienne
          -- (id min) ; sa jumelle est ignorée (elle finira annulée/écrasée en aval).
          AND NOT EXISTS (
            SELECT 1 FROM email_queue s3
            WHERE s3.contact_id = eq.contact_id AND s3.sequence_step = eq.sequence_step
              AND s3.status = 'queued' AND s3.id < eq.id
          )
          -- PLAFOND À VIE : jamais plus de 4 mails envoyés à un même contact.
          AND (
            SELECT COUNT(*) FROM email_queue s2
            WHERE s2.contact_id = eq.contact_id AND s2.status = 'sent'
          ) < ${LIFETIME_CAP_PER_CONTACT}
          -- VERROU DE FILE (anti-double-envoi entre runs concurrents) : chaque ligne 'queued' est
          -- verrouillée le temps du claim ; un run parallèle SKIP LOCKED la saute au lieu de la
          -- réclamer aussi. Sans ça, deux runs (cron qui se chevauche / rejeu après timeout) peuvent
          -- sélectionner le MÊME lot puis l'envoyer chacun → double envoi (l'incident des 130 mails).
          FOR UPDATE OF eq SKIP LOCKED
          ) candidates
          -- PRIORITÉ AUX NOUVEAUX CONTACTS (step 0) : sans ça, les relances (step 1-3), mises en
          -- file plus tôt, passaient TOUJOURS devant (tri scheduled_at ASC) et pouvaient épuiser
          -- tout le plafond du jour avant qu'un seul nouveau prospect ne soit contacté (constaté :
          -- 140 mails envoyés un jour donné, 0 en step 0). Un step 0 prêt passe donc toujours en
          -- premier ; les relances ne prennent que la capacité restante. DISTINCT ON impose un tri
          -- par contact_id EN PREMIER (règle Postgres) ; la priorité step0/scheduled_at départage
          -- ENSUITE quelle ligne du contact est retenue.
          ORDER BY candidates.contact_id, (candidates.sequence_step = 0) DESC, candidates.scheduled_at ASC
        ) picked
        -- Tri final (post-dédoublonnage par contact) + plafond du lot.
        ORDER BY (picked.sequence_step = 0) DESC, picked.scheduled_at ASC
        LIMIT ${limit}
      )
      RETURNING id, subject, body, sequence_step, campaign_id, contact_id, from_email
    `) as ClaimedRow[]

    // Infos contact des lignes réclamées.
    const contactIds = [...new Set(claimed.map(r => r.contact_id))]
    const contactRows = contactIds.length > 0
      ? ((await sql`SELECT id, email, name, company, city FROM contacts WHERE id = ANY(${contactIds})`) as Array<{ id: string; email: string; name: string | null; company: string | null; city: string | null }>)
      : []
    const contactMap = new Map(contactRows.map(c => [c.id, c]))

    results.push(`Mails réclamés à envoyer: ${claimed.length}`)

    let sent = 0, skipped = 0, failed = 0

    // Sélection de boîte : PRÉFÈRE la boîte assignée (from_email) — signature = enveloppe.
    // capMap = null pour les relances de conversation (pas de plafond per-boîte, juste le global convoCapacity).
    /**
     * ⚠️ UNE RELANCE NE CHANGE JAMAIS DE BOÎTE — MÊME SI CETTE BOÎTE EST PLEINE.
     *
     * Le prospect voit une conversation, pas une infrastructure. Recevoir la relance d'un fil depuis
     * une AUTRE adresse casse le fil chez lui (nouveau thread, expéditeur inconnu), fait retomber le
     * message en indésirable, et sa réponse repart vers une boîte qui n'a pas l'historique.
     *
     * L'ancienne version basculait sur n'importe quelle boîte disponible dès que la boîte assignée
     * était pleine. Pour une relance, mieux vaut ATTENDRE demain que partir de la mauvaise adresse :
     * la ligne retourne en file, rien n'est perdu, le fil reste intact.
     *
     * Le premier mail (step 0), lui, garde la rotation libre : aucun fil n'existe encore.
     */
    const pickBox = (preferred: string, capMap: Map<string, number> | null, sticky: boolean): GmailBox | null => {
      if (!capMap) return boxes.find(b => b.email.toLowerCase() === preferred.toLowerCase()) ?? boxes[0] ?? null
      const pref = boxes.find(b => b.email.toLowerCase() === preferred.toLowerCase() && (capMap.get(b.email) ?? 0) > 0)
      if (pref) return pref
      // Boîte assignée pleine, mais toujours vivante (elle est dans `boxes`, donc ni morte ni en
      // pause) → on attend. Si elle a disparu de `boxes`, on autorise le repli : mieux vaut une
      // autre adresse qu'un lead qui n'est jamais relancé.
      const assigneeVivante = boxes.some(b => b.email.toLowerCase() === preferred.toLowerCase())
      if (sticky && assigneeVivante) return null
      return boxes.find(b => (capMap.get(b.email) ?? 0) > 0) ?? null
    }

    let convoRemaining = convoCapacity

    for (let i = 0; i < claimed.length; i++) {
      const row = claimed[i]
      // BUDGET TEMPS MUR : un envoi SMTP de plus risquerait de dépasser la coupe 30s de
      // cron-job.org. On s'arrête AVANT et on remet EXPLICITEMENT les lignes non traitées en
      // 'queued' (on sait avec certitude qu'aucun sendFromBox n'a été tenté dessus — contrairement
      // au REAPER qui suppose un crash et attend 15 min par précaution, ici l'arrêt est volontaire
      // et sûr : reprise dès le prochain run, sans attendre).
      if (Date.now() - started > TIME_BUDGET_MS) {
        const rest = claimed.slice(i)
        await sql`UPDATE email_queue SET status = 'queued' WHERE id = ANY(${rest.map(r => r.id)})`
        results.push(`⏱ budget temps atteint — ${rest.length} ligne(s) remise(s) en file (reprises au run suivant)`)
        break
      }
      const contact = contactMap.get(row.contact_id)
      if (!contact?.email) {
        await sql`UPDATE email_queue SET status = 'failed' WHERE id = ${row.id}`
        skipped++; continue
      }
      if (!row.subject || !row.body) {
        await sql`UPDATE email_queue SET status = 'skipped' WHERE id = ${row.id}`
        skipped++; continue
      }

      // Enveloppe de CETTE ligne — indépendante des deux autres (une pleine ne bloque pas les autres).
      const bucket: 'new' | 'relance' | 'convo' = row.sequence_step === 0 ? 'new' : row.sequence_step >= 20 ? 'convo' : 'relance'
      if (bucket === 'convo' && convoRemaining <= 0) {
        await sql`UPDATE email_queue SET status = 'queued' WHERE id = ${row.id}`
        continue
      }
      const capMap = bucket === 'new' ? capNew : bucket === 'relance' ? capRelance : null

      // sticky = relance : la boîte du fil ne se remplace pas (cf. pickBox).
      let box = pickBox(row.from_email, capMap, row.sequence_step >= 1)
      if (!box) {
        // Soit l'enveloppe est pleine, soit c'est une relance dont la boîte est saturée : dans les
        // deux cas la ligne retourne en file et repart au prochain run. On continue les suivantes,
        // une autre enveloppe (ou une autre boîte) peut encore avoir de la place.
        await sql`UPDATE email_queue SET status = 'queued' WHERE id = ${row.id}`
        results.push(`Plus de capacité (${bucket}) — ligne remise en file`)
        continue
      }

      // 1) Corrige une salutation "Bonjour ENTREPRISE," / "Bonjour VISION," → "Bonjour,".
      let finalBody = row.body
      const g = finalBody.match(/^\s*Bonjour\s+([^,\n]+),/i)
      if (g) {
        const nm = g[1].trim()
        const comp = (contact.company ?? '').toLowerCase()
        const isCompany = comp && (comp.includes(nm.toLowerCase()) || nm.toLowerCase().includes(comp.slice(0, 6)))
        const isAllCaps = nm.length > 1 && nm === nm.toUpperCase()
        if (isCompany || isAllCaps) finalBody = finalBody.replace(/^\s*Bonjour\s+[^,\n]+,/i, 'Bonjour,')
      }

      /**
       * ⚠️ CIVILITÉ VIDE — « Bonjour M., ». Constaté le 13/08 dans les mails réellement générés.
       * Le modèle produit une civilité seule quand il n'a pas de nom de dirigeant : « M. », « Mme »,
       * parfois « M. X ». Le prospect lit ça en première ligne, et ça signe le publipostage mal
       * fait — l'effet exactement inverse de celui recherché.
       * Le nettoyage précédent ne l'attrapait pas : il ne se déclenche que si le nom ressemble au
       * nom de l'entreprise ou est tout en majuscules.
       */
      finalBody = finalBody.replace(/^\s*Bonjour\s+(M\.|Mme\.?|Mr\.?|Monsieur|Madame)(\s+[A-Z]\.?)?\s*,/i, 'Bonjour,')

      // 2) MENTION LÉGALE RGPD garantie sur CHAQUE mail (art. 14 : les données ne viennent PAS de
      // la personne — elles sont scrapées de sources publiques — donc on DOIT l'informer de leur
      // origine et de son droit d'opposition. L'ancien pied de page ne disait que "répondez Stop",
      // ce qui couvre l'opt-out mais PAS l'obligation d'information : c'est ce manquement qui rend
      // une plainte CNIL difficile à défendre (incident LabegarIA, août 2026).
      /**
       * DÉSABONNEMENT EN UN CLIC (RFC 8058) — le lien ET l'en-tête, jamais l'un sans l'autre.
       *
       * ⚠️ Sans l'en-tête `List-Unsubscribe`, Gmail et Outlook n'affichent PAS leur bouton natif
       * « Se désabonner ». Le seul geste restant pour un prospect agacé est « Signaler comme
       * spam » : ça ne l'inscrit sur aucune liste, ne l'empêche pas de recevoir la suite, et abîme
       * durablement la réputation d'expédition des boîtes du client. Le lien seul dans le corps ne
       * suffit donc pas — c'est l'en-tête qui protège la délivrabilité.
       *
       * `One-Click` indique aux messageries qu'elles peuvent appeler l'URL en POST directement,
       * sans ouvrir de navigateur ni demander confirmation.
       */
      const jeton = creerJetonDesabo(contact.email)
      const lienDesabo = `${BASE_URL}/u/${jeton}`

      if (!/coordonnées professionnelles proviennent/i.test(finalBody)) {
        // On retire un éventuel ancien pied de page "Stop" seul pour ne pas empiler deux blocs.
        finalBody = finalBody.replace(/\n*---\nPour ne plus recevoir mes emails[^\n]*\n?/i, '\n')
        finalBody = `${finalBody.trimEnd()}\n\n${blocLegalRgpd(lienDesabo)}`
      }

      const enTetesDesabo = {
        'List-Unsubscribe': `<${lienDesabo}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }

      const senderName = getInboxSenderName(box.email)
      let r = await sendFromBox(box, { to: contact.email, subject: row.subject, text: finalBody, senderName, headers: enTetesDesabo })

      // Boîte HS (535 BadCredentials) → désactivée ce run, retry ailleurs.
      if (!r.ok && /BadCredentials|Invalid login|535/.test(r.error ?? '')) {
        results.push(`⚠ boîte HS: ${box.email} (mdp d'application invalide) — désactivée ce run`)
        if (capMap) capMap.set(box.email, 0)
        const alt = capMap ? boxes.find(b => (capMap.get(b.email) ?? 0) > 0) : boxes.find(b => b.email !== box!.email)
        if (alt) {
          box = alt
          // ⚠️ Les en-têtes doivent être repassés ici aussi : sur le chemin de secours (boîte HS →
          // on renvoie depuis une autre), les oublier produirait un mail SANS bouton « Se
          // désabonner ». Un mail sur dix sans issue de sortie, invisible dans les compteurs.
          r = await sendFromBox(alt, { to: contact.email, subject: row.subject, text: finalBody, senderName: getInboxSenderName(alt.email), headers: enTetesDesabo })
        }
      }

      if (r.ok) {
        await sql`UPDATE email_queue SET status = 'sent', sent_at = NOW(), sent_via = ${box.email}, body = ${finalBody} WHERE id = ${row.id}`

        /**
         * LA BOÎTE RÉELLE DEVIENT LA BOÎTE DU FIL.
         *
         * ⚠️ Quand le premier mail part d'une autre boîte que celle assignée (rotation libre au
         * step 0, ou repli après une boîte HS), les relances gardaient l'ANCIENNE adresse en base.
         * Le prospect recevait donc le premier message d'une adresse et la relance d'une autre :
         * fil cassé chez lui, risque d'indésirable, et sa réponse partant vers une boîte qui n'a pas
         * l'historique. Rendre les relances « sticky » ne sert à rien si on les colle à la mauvaise
         * boîte — on propage donc l'adresse réellement utilisée.
         */
        if (box.email.toLowerCase() !== (row.from_email ?? '').toLowerCase()) {
          await sql`
            UPDATE email_queue SET from_email = ${box.email}
            WHERE contact_id = ${row.contact_id} AND sequence_step > 0 AND status IN ('queued', 'pending')
          `
          results.push(`↪ boîte du fil alignée sur ${box.email} (assignée: ${row.from_email})`)
        }

        if (capMap) capMap.set(box.email, (capMap.get(box.email) ?? 1) - 1)
        else convoRemaining--
        sent++
        results.push(`✓ step ${row.sequence_step} → ${contact.email} via ${box.email}`)
        try {
          await sql`
            INSERT INTO dashboard_events (type, data)
            VALUES ('email_sent', ${JSON.stringify({
              contactEmail: contact.email, company: contact.company, city: contact.city,
              campaignId: row.campaign_id, sequenceStep: row.sequence_step, subject: row.subject, sentVia: box.email,
            })}::jsonb)
          `
        } catch { /* non-bloquant */ }
      } else {
        // Échec → 'failed' (JAMAIS de retour en 'queued' → aucun renvoi en boucle).
        await sql`UPDATE email_queue SET status = 'failed' WHERE id = ${row.id}`
        failed++
        results.push(`✗ ${contact.email} via ${box.email}: ${(r.error ?? '').slice(0, 90)}`)
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, results })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 400) : undefined },
      { status: 500 },
    )
  }
}
