import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { detectInventedFacts } from '@/lib/anti-invention'
import { alertIndependent } from '@/lib/alert'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * ⚠️ GARDE-FOU ANTI-INVENTION — ce cron est le SECOND chemin par lequel un texte généré par l'IA
 * part vers un vrai prospect (le premier étant poll-imap-replies). Un garde-fou posé sur un seul
 * chemin donne une fausse impression de contrôle. Ici, les relances sont mises en file
 * directement en 'queued' : il n'y a AUCUNE relecture humaine possible en aval. Donc à la
 * moindre donnée factuelle inventée (téléphone, lien, email, chiffre) ou mot interdit, on
 * N'ENFILE RIEN et on alerte : le contact reste éligible et sera régénéré au prochain run.
 * @returns true si le texte est propre et peut partir.
 */
async function texteSur(body: string, qui: string, site?: string | null): Promise<boolean> {
  const v = await detectInventedFacts(body, { prospectSite: site })
  if (!v.suspect) return true
  await alertIndependent('Relance bloquee (donnee inventee)', `${qui}\n${v.details.join('\n')}`).catch(() => {})
  return false
}

let sql!: NeonQueryFunction<false, false>

// RELANCE DES CONVERSATIONS SILENCIEUSES.
// Après que l'agent a répondu à un prospect intéressé, si celui-ci ne répond plus,
// on ne le laisse pas mourir : on remet UNE relance en file (email_queue), que
// send-campaign enverra avec TOUTES ses protections anti-boucle (claim atomique,
// anti-doublon, plafond 4/contact, blocklist, dédup step). Aucun envoi direct ici.
//
// Garde-fous : uniquement les vraies conversations (interest/question/objection/rdv),
// silencieuses depuis >= SILENCE_DAYS, pas blocklistées, sans RDV calé, et MAX 2
// relances de conversation par contact (steps 20/21). La relance est annulée
// automatiquement (cancelSteps) dès que le prospect répond.

const SILENCE_DAYS = 3
const MAX_CONVO_RELANCES = 2
// ⚠️ TIMEOUT 06/08 : ce cron faisait 34s (coupe cron-job.org = 30s) → "Échec" à chaque run.
// Cause : les relances sont devenues CONTEXTUELLES (1 appel Gemini de 3-5s chacune) et la
// re-proposition de RDV en ajoute autant, alors que MAX_PER_RUN valait encore 20 (hérité de
// l'époque où le texte était un template figé, donc gratuit en temps). 20 × 4s = 80s.
// ⇒ Budget temps mur vérifié AVANT chaque appel IA + plafonds bas. Le cron tourne souvent,
// la file s'écoule au fil de l'eau (leçon 30 : chaque endpoint doit répondre sous 30s).
const MAX_PER_RUN = 3
const MAX_RDV_REPROPOSES_PER_RUN = 2
const TIME_BUDGET_MS = 20_000

/**
 * ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48, absente ici jusqu'au 06/08).
 * Ce cron n'avait que des try/catch DANS ses boucles : toute exception survenue en dehors
 * (requête SQL lente, Neon indisponible, import qui échoue) remontait en 500 au corps VIDE.
 * Depuis cron-job.org on ne voyait qu'« Échec (Erreur HTTP) » sans le moindre motif — impossible
 * à diagnostiquer, et le heartbeat n'était jamais posé. On renvoie donc TOUJOURS la vraie erreur.
 */
export async function GET(req: Request) {
  try {
    return await runCron(req)
  } catch (err) {
    console.error('[conversation-followups]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat('conversation-followups', false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({
      ok: false,
      error: String(e.message ?? err).slice(0, 300),
      cause: e.cause?.message?.slice(0, 200),
      code: e.code,
    }, { status: 500 })
  }
}

async function runCron(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  if (process.env.SEND_PAUSED === '1') return NextResponse.json({ ok: true, paused: true })

  const runStart = Date.now()
  const budgetDepasse = () => Date.now() - runStart > TIME_BUDGET_MS

  sql = (await import('@/lib/db')).sql

  // Colonne « pression signalée » (idempotent) : les requêtes de sélection ci-dessous la filtrent,
  // elle doit donc exister même si poll-imap-replies n'a encore jamais rencontré le cas.
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pression_signalee_at TIMESTAMPTZ`

  const [campaign] = (await sql`SELECT id FROM campaigns WHERE status = 'active' LIMIT 1`) as Array<{ id: string }>
  if (!campaign) return NextResponse.json({ ok: true, reason: 'aucune campagne active' })

  // ── PARTIE A : RÉPARE les réponses restées SANS brouillon ──
  // Trou possible dans le poll : le message entrant est enregistré (dédup) puis la
  // génération du brouillon échoue (budget/IA) → la réponse ne serait JAMAIS traitée
  // et la conversation mourrait en silence. Cette passe régénère le brouillon.
  // Kill-switch de validation (même source de vérité que poll-imap-replies) : env REQUIRE_VALIDATION=1
  // OU agent_config.require_validation='true' → toute réponse générée attend une relecture humaine.
  const requireValidation = await (async () => {
    if (process.env.REQUIRE_VALIDATION === '1') return true
    try {
      const r = (await sql`SELECT value FROM agent_config WHERE key = 'require_validation' LIMIT 1`) as Array<{ value: string }>
      return String(r[0]?.value ?? '').toLowerCase() === 'true'
    } catch { return false }
  })()

  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')
  const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')
  const { cleanIncomingBody } = await import('@/lib/decode-body')
  const repairs: string[] = []
  // ⚠️ NE PAS exclure les leads avec RDV : un lead qui a un RDV calé MAIS pas de brouillon
  // (génération IA tombée) était le PIRE cas — il a donné son numéro, on l'a noté en RDV, mais
  // on ne lui a JAMAIS répondu. Il faut au contraire lui répondre pour CONFIRMER l'appel.
  // Fenêtre élargie à 30 j (les orphelins anciens restaient bloqués à vie sous 72h) et on ne
  // répond qu'au DERNIER message de chaque contact (jamais un message dépassé par la suite).
  const orphans = (await sql`
    SELECT ir.id, ir.contact_id, ir.body, ir.subject, ir.from_email, ir.classification, ir.action_taken
    FROM incoming_replies ir
    WHERE ir.created_at > NOW() - INTERVAL '30 days'
      AND ir.classification IN ('interest', 'question', 'objection', 'rdv_request')
      /**
       * ⚠️ UN RENDEZ-VOUS CONFIRMÉ COUPE TOUTE RELANCE AUTOMATIQUE. RÈGLE ABSOLUE.
       *
       * INCIDENT DU 18/08, COUVREUR JIMMY. RDV confirmé pour 10:00. À 10:00:49 — quarante-neuf
       * secondes après l'heure du rendez-vous — l'agent a généré un message, puis l'a envoyé à
       * 11:07 : « Je peux vous appeler dès demain matin, à 10h ». Le prospect, qui avait dit oui et
       * attendait un appel, reçoit une proposition de nouveau créneau comme si rien n'existait.
       *
       * La cause tenait à un seul mot : le garde-fou testait un rendez-vous STRICTEMENT FUTUR. Une
       * seconde après l'heure dite, le rendez-vous n'est plus « futur », donc plus vu, donc l'agent
       * recommence à démarcher quelqu'un avec qui l'affaire était déjà conclue.
       *
       * Un no-show n'est pas une situation à rattraper par un mail automatique une heure plus tard.
       * C'est une décision humaine : rappeler, reprogrammer, ou laisser tomber. La machine s'arrête
       * dès que le rendez-vous est pris, et elle ne reprend pas la main toute seule.
       *
       * Seul un RDV ANNULÉ rouvre la porte : là, il n'y a plus d'engagement à respecter.
       */
      AND NOT EXISTS (
        SELECT 1 FROM rdv r
        WHERE r.contact_id = ir.contact_id
          AND r.status IN ('confirmed', 'signed')
      )
      AND ir.contact_id IS NOT NULL
      /**
       * ⚠️ UN BROUILLON REJETÉ TOMBAIT ENTRE LES DEUX FILETS (constaté le 17/08/2026).
       *
       * Cette partie cherchait les réponses SANS AUCUN brouillon ; la partie A-bis, celles dont le
       * brouillon avait été ENVOYÉ. Un brouillon en statut 'rejected' n'entre ni dans l'une ni dans
       * l'autre : le prospect n'a jamais reçu de réponse, et aucun rattrapage ne se déclenche.
       *
       * Cas réel : un couvreur du Cannet propose « je vous donne 20 % de mon bénéfice » le 7 août.
       * Un brouillon est créé, rejeté, et plus rien pendant dix jours. C'est une négociation
       * commerciale — le lead le plus chaud de la semaine — perdue en silence.
       *
       * On ne considère donc plus « il existe un brouillon » mais « il existe un brouillon VIVANT ».
       * Les statuts d'attente de validation sont exclus du rattrapage : ceux-là attendent
       * légitimement une décision humaine, les régénérer créerait des doublons.
       */
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rd
        WHERE rd.incoming_reply_id = ir.id
          AND rd.status IN ('sent', 'pending', 'awaiting_validation', 'scheduled', 'sending')
      )
      /**
       * ⚠️ UN REFUS HUMAIN NE SE REDISCUTE PAS.
       *
       * Le 17/08, Timéo rejette un brouillon dans « À valider ». Treize minutes plus tard ce
       * rattrapage en régénère un identique. Rien n'est parti — mais de son point de vue la machine
       * est passée outre son refus, et le bouton « rejeter » ne veut plus rien dire.
       *
       * Le rattrapage existe pour réparer ce que la MACHINE a raté (génération tombée, brouillon
       * jamais créé), jamais pour revenir sur ce qu'un HUMAIN a écarté volontairement.
       */
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rdh
        WHERE rdh.incoming_reply_id = ir.id AND rdh.rejete_par = 'humain'
      )
      /**
       * ⚠️ NE PAS RÉPONDRE À UN SIMPLE ACQUIESCEMENT.
       *
       * Cas réel : « je vous rappelle mardi 18 août à 10:00 » → le prospect répond « Ok » → l'agent
       * lui renvoie MOT POUR MOT la même phrase. Répondre n'est pas une obligation : quand le
       * rendez-vous est calé et que le message ne contient qu'un accord, le silence est la bonne
       * réponse. Un mail de plus n'apporte rien et donne l'impression d'un robot.
       */
      AND NOT (
        LENGTH(REGEXP_REPLACE(COALESCE(ir.body, ''), '(^|\n)>.*', '', 'g')) < 240
        AND REGEXP_REPLACE(LOWER(COALESCE(ir.body, '')), '[^a-zà-ÿ]', '', 'g') ~
            '^(ok|okay|dac|dacc|daccord|oui|parfait|trescebien|tresbien|superbien|super|nickel|impeccable|impec|merci|mercibeaucoup|entendu|bienrecu|noté|note|cavamerci|ca marche|camarche)'
        AND EXISTS (
          SELECT 1 FROM rdv r
          WHERE r.contact_id = ir.contact_id AND r.status = 'confirmed' AND r.scheduled_at > NOW()
        )
      )
      /**
       * ⚠️ UN RENDEZ-VOUS CONFIRMÉ COUPE TOUTE RELANCE AUTOMATIQUE. DÉFINITIVEMENT.
       *
       * Incident du 18/08, Couvreur Jimmy : RDV confirmé à 10:00, brouillon généré à 10:00:49 et
       * ENVOYÉ à 11:07 pour reproposer un créneau. Le prospect avait dit oui, on lui a réécrit une
       * heure après le rendez-vous comme si rien n'avait été convenu. Il n'est pas venu.
       *
       * La cause : le garde-fou ne regardait que les RDV FUTURS (scheduled_at superieur a NOW). Quarante-
       * neuf secondes après l'heure du rendez-vous, celui-ci devenait « passé », donc invisible pour
       * la requête, et l'agent concluait qu'aucun rendez-vous n'existait.
       *
       * Consigne de Timéo, mot pour mot : « une fois qu'il a dit oui tu dois arrêter de lui envoyer
       * des messages ». On ne borne donc plus dans le temps : la seule existence d'un RDV confirmé
       * suffit à couper. Un no-show se rattrape à la main ou par les rappels (cron rappels-rdv), pas
       * par un mail automatique une heure trop tard.
       */
      AND NOT EXISTS (
        SELECT 1 FROM rdv r
        WHERE r.contact_id = ir.contact_id AND r.status IN ('confirmed', 'signed')
      )
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(ir.from_email))
      /**
       * ⚠️ GARDE-FOU PAR LE CONTACT, ET PAS SEULEMENT PAR LE LIEN. Constaté dans la foulée du
       * correctif ci-dessus : « Couvreur Jimmy » avait bien reçu sa réponse à 09h25, et le
       * rattrapage lui en a régénéré une seconde dix minutes plus tard.
       *
       * La raison : le test précédent passe par rd.incoming_reply_id. Si ce lien manque ou a
       * dérivé — ça arrive, c'est l'incident des leads invisibles du 08/08 — la réponse envoyée
       * devient introuvable et le message paraît orphelin.
       *
       * On vérifie donc AUSSI qu'aucune réponse n'est partie à CE CONTACT depuis son message.
       * Deux vérifications indépendantes sur la même question : si l'une déraille, l'autre tient.
       */
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rd3
        JOIN incoming_replies ir3 ON ir3.id = rd3.incoming_reply_id
        WHERE ir3.contact_id = ir.contact_id
          AND rd3.status = 'sent'
          AND rd3.sent_at >= ir.created_at
      )
      AND ir.created_at = (SELECT MAX(ir2.created_at) FROM incoming_replies ir2 WHERE ir2.contact_id = ir.contact_id)
    ORDER BY ir.created_at DESC
    LIMIT 5
  `) as Array<{ id: string; contact_id: string; body: string; subject: string | null; from_email: string; classification: string; action_taken: string | null }>

  // ── PARTIE A-bis : rattrape les NON-RÉPONSES déjà envoyées ──
  // Quand la génération IA échoue, on envoie un repli générique ("je reviens vers vous très vite").
  // Ça évite le silence, MAIS le prospect n'a aucune réponse utile et rien ne repassait derrière :
  // il restait bloqué avec un non-message (cas EDDIE JACKEL qui demandait comment remonter sur
  // Google). On détecte ces envois et on régénère une VRAIE réponse.
  const nonReponses = (await sql`
    SELECT ir.id, ir.contact_id, ir.body, ir.subject, ir.from_email, ir.classification, ir.action_taken
    FROM incoming_replies ir
    JOIN reply_drafts rd ON rd.incoming_reply_id = ir.id
    WHERE ir.created_at > NOW() - INTERVAL '30 days'
      AND ir.classification IN ('interest', 'question', 'objection', 'rdv_request')
      /**
       * ⚠️ UN RENDEZ-VOUS CONFIRMÉ COUPE TOUTE RELANCE AUTOMATIQUE. RÈGLE ABSOLUE.
       *
       * INCIDENT DU 18/08, COUVREUR JIMMY. RDV confirmé pour 10:00. À 10:00:49 — quarante-neuf
       * secondes après l'heure du rendez-vous — l'agent a généré un message, puis l'a envoyé à
       * 11:07 : « Je peux vous appeler dès demain matin, à 10h ». Le prospect, qui avait dit oui et
       * attendait un appel, reçoit une proposition de nouveau créneau comme si rien n'existait.
       *
       * La cause tenait à un seul mot : le garde-fou testait un rendez-vous STRICTEMENT FUTUR. Une
       * seconde après l'heure dite, le rendez-vous n'est plus « futur », donc plus vu, donc l'agent
       * recommence à démarcher quelqu'un avec qui l'affaire était déjà conclue.
       *
       * Un no-show n'est pas une situation à rattraper par un mail automatique une heure plus tard.
       * C'est une décision humaine : rappeler, reprogrammer, ou laisser tomber. La machine s'arrête
       * dès que le rendez-vous est pris, et elle ne reprend pas la main toute seule.
       *
       * Seul un RDV ANNULÉ rouvre la porte : là, il n'y a plus d'engagement à respecter.
       */
      AND NOT EXISTS (
        SELECT 1 FROM rdv r
        WHERE r.contact_id = ir.contact_id
          AND r.status IN ('confirmed', 'signed')
      )
      AND rd.status = 'sent'
      AND (rd.body ILIKE '%je reviens vers vous%' OR rd.body ILIKE '%meilleures conditions%' OR rd.body ILIKE '%je transmets%')
      AND NOT EXISTS (SELECT 1 FROM reply_drafts rd2 WHERE rd2.incoming_reply_id = ir.id AND rd2.created_at > rd.created_at)
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(ir.from_email))
      AND ir.created_at = (SELECT MAX(ir2.created_at) FROM incoming_replies ir2 WHERE ir2.contact_id = ir.contact_id)
    ORDER BY ir.created_at DESC
    LIMIT 3
  `) as typeof orphans

  // Le prospect a-t-il donné CARTE BLANCHE pour l'appel ? (objet + corps, apostrophes normalisées)
  const isOpenCallRequest = (text: string): boolean => {
    const t = (text || '').toLowerCase().replace(/[’‘`´]/g, "'")
    if (/\b(non|pas maintenant|plus tard|arr[êe]tez)\b/.test(t)) return false
    return /(appel(ez|e|er)[- ]?moi|rappel(ez|e|er)[- ]?moi|veuillez m'?appeler|veiller m'?appeler|me contacter|contactez[- ]?moi|vous pouvez m'?appeler|quand vous (voulez|voudrez|le souhaitez|souhaitez)|[àa] votre convenance|n'?importe quand|quand [çc]a vous arrange|je suis (dispo|disponible|joignable)|(pouvez|pourriez|peux|peut)[- ]?(vous|tu)?\s*m'?(appeler|e (rappeler|contacter|joindre))|possible de m'?(appeler|e (rappeler|contacter))|j'?(aimerais|souhaite|voudrais) (qu'?on m'?appelle|[êe]tre (rappel[ée]|contact[ée])))/.test(t)
  }

  // Orphelins (aucune réponse) + non-réponses (réponse vide de sens) : même traitement.
  const aTraiter = [...orphans, ...nonReponses.filter(n => !orphans.some(o => o.id === n.id))]
  for (const o of aTraiter) {
    // Chaque réparation = 1 classification + 1 génération Gemini (+ audit site) : on ne DÉMARRE
    // pas un traitement si le budget est déjà consommé. Le reste passe au run suivant.
    if (budgetDepasse()) { repairs.push('⏱ budget atteint — réparations restantes au prochain run'); break }
    try {
      const [ct] = (await sql`SELECT id, name, company, city, sector, website FROM contacts WHERE id = ${o.contact_id}`) as Array<{ id: string; name: string | null; company: string; city: string | null; sector: string | null; website: string | null }>
      const sent = (await sql`SELECT body, sent_at FROM email_queue WHERE contact_id = ${o.contact_id} AND status = 'sent' ORDER BY sent_at ASC`) as Array<{ body: string; sent_at: string | null }>
      const recv = (await sql`SELECT body, created_at FROM incoming_replies WHERE contact_id = ${o.contact_id} ORDER BY created_at ASC`) as Array<{ body: string; created_at: string | null }>
      const history = [
        ...sent.map(x => ({ role: 'sent' as const, body: x.body, ts: x.sent_at ? new Date(x.sent_at).getTime() : 0 })),
        ...recv.map(x => ({ role: 'received' as const, body: cleanIncomingBody(x.body || ''), ts: x.created_at ? new Date(x.created_at).getTime() : 0 })),
      ].sort((a, b) => a.ts - b.ts)
        .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))
      const [ob] = (await sql`SELECT from_email FROM email_queue WHERE contact_id = ${o.contact_id} AND status = 'sent' AND from_email IS NOT NULL ORDER BY sent_at DESC LIMIT 1`) as Array<{ from_email: string }>
      // Un RDV FUTUR déjà calé ? → la réponse doit le CONFIRMER (pas re-proposer). Un RDV passé
      // (créneau auto choisi il y a des jours, jamais honoré) est ignoré → on re-propose un moment.
      const [futureRdv] = (await sql`SELECT scheduled_at FROM rdv WHERE contact_id = ${o.contact_id} AND status = 'confirmed' AND scheduled_at > NOW() ORDER BY scheduled_at ASC LIMIT 1`) as Array<{ scheduled_at: string }>
      const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      let existingRdvSlot = futureRdv?.scheduled_at ? fmt(new Date(futureRdv.scheduled_at)) : undefined

      // AUTONOMIE : si le prospect a demandé à être rappelé (carte blanche) et qu'aucun RDV n'est
      // calé, on le CALE ici (au prochain créneau libre, jamais le jour même) et on notifie le
      // client — sinon le lead restait "en attente" sans RDV, et il fallait vérifier à la main.
      if (!existingRdvSlot && isOpenCallRequest(`${o.subject ?? ''}\n${cleanIncomingBody(o.body || '')}`)) {
        try {
          const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
          const availability = await getAvailability()
          const busy = (await sql`SELECT scheduled_at FROM rdv WHERE status = 'confirmed' AND scheduled_at > NOW() - INTERVAL '1 day'`) as Array<{ scheduled_at: string }>
          const slot = findNextAvailableSlot(null, availability, busy.map(b => b.scheduled_at))
          await sql`INSERT INTO rdv (contact_id, incoming_reply_id, scheduled_at, duration_min, status, notes)
            VALUES (${o.contact_id}, ${o.id}, ${slot.toISOString()}, ${availability.slotDurationMin || 30}, 'confirmed', ${'RDV — le prospect a demandé à être rappelé (carte blanche), calé au prochain créneau.'})`
          existingRdvSlot = fmt(slot)
          repairs.push(`📅 RDV calé ${existingRdvSlot} → ${ct?.company ?? o.from_email}`)
        } catch (e) {
          repairs.push(`✗ RDV non calé ${o.from_email}: ${String(e).slice(0, 50)}`)
        }
      }
      const phoneMatch = cleanIncomingBody(o.body || '').match(/0[1-9]([\s. ]?\d{2}){4}/)
      const cleaned = cleanIncomingBody(o.body || '')
      const cleanBody = stripQuotedReply(cleaned) || cleaned
      const draft = await generateReplyResponse({
        // la requête SQL filtre déjà sur ces 4 classifications
        classification: o.classification as 'interest' | 'question' | 'objection' | 'rdv_request',
        originalEmailBody: sent.length ? sent[sent.length - 1].body : '',
        replyBody: cleanBody,
        contactName: ct?.name ?? o.from_email,
        contactCompany: ct?.company ?? o.from_email,
        contactCity: ct?.city ?? '',
        contactSector: ct?.sector ?? undefined,
        conversationHistory: history,
        contactPhone: phoneMatch ? phoneMatch[0].trim() : undefined,
        existingRdvSlot,
        fromEmail: ob?.from_email,
      })
      // ENVOI AUTO PAR DÉFAUT (autonomie). On ne met en validation humaine QUE si la réponse avait
      // été explicitement classée "à valider". Avant, un message déjà répondu passait en
      // action_taken='replied' → la régénération partait en 'pending' et restait bloquée dans
      // "À valider" au lieu d'être envoyée : le lead attendait une action manuelle.
      // ⚠️ Le kill-switch de validation s'applique AUSSI ici : c'est le SECOND chemin par lequel
      // une réponse peut partir sans relecture (passe de réparation). Un kill-switch posé sur un
      // seul chemin donne une fausse impression de contrôle — incident LabegarIA.
      // Anti-invention : un brouillon suspect ne peut PAS partir seul, il passe en validation.
      const draftSur = await texteSur(draft, `réparation ${o.from_email}`, ct?.website)
      if (o.action_taken !== 'draft_for_validation' && !requireValidation && draftSur) {
        await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status, send_after) VALUES (${o.id}, ${draft}, 'scheduled', NOW())`
      } else {
        await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status) VALUES (${o.id}, ${draft}, 'pending')`
      }
      repairs.push(`🩹 brouillon régénéré → ${o.from_email} (${o.action_taken === 'auto_reply' ? 'envoi auto' : 'à valider'})`)
    } catch (e) {
      repairs.push(`✗ réparation ${o.from_email}: ${String(e).slice(0, 60)}`)
    }
  }

  // ── PARTIE B : RDV PROPOSÉS EXPIRÉS — relance pour VALIDER une date (audit 02/08, demande
  // Timéo). Un créneau proposé ("lundi 9h, ça vous va ?") resté sans réponse jusqu'à être PASSÉ
  // mourait en silence : le rdv restait 'proposed' à une date révolue pour toujours, et rien ne
  // repartait chercher la confirmation. Ici : on recalcule un créneau FUTUR, on met à jour la
  // ligne rdv (toujours 'proposed' — jamais confirmé sans un oui), et on met en file UNE relance
  // qui propose ce nouveau créneau en question oui/non. Placée AVANT la sélection des candidats
  // de la Partie C : la ligne mise en file ici exclut le contact de la relance générique du même
  // run (pas de double relance).
  const expiredProposed = (await sql`
    SELECT r.id AS rdv_id, r.contact_id, c.email, c.name, c.company, c.city, c.sector, c.website,
      (SELECT eq.from_email FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.from_email IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS owner_box,
      (SELECT eq.subject FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.subject IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS last_subject,
      (SELECT COUNT(*) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status = 'sent')::int AS convo_relances
    FROM rdv r JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'proposed' AND r.scheduled_at < NOW() - INTERVAL '1 day'
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      AND NOT EXISTS (SELECT 1 FROM rdv r2 WHERE r2.contact_id = c.id AND r2.status = 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status IN ('pending','queued','sending'))
      -- Leçon 106 / cas réel du 27/07 : un contact qui s'est plaint du NOMBRE de mails ne reçoit
      -- plus aucune relance automatique, même s'il n'a jamais écrit "stop". Devoir se désabonner
      -- après s'être plaint de la pression d'envoi, c'est ce qui déclenche le signalement.
      AND c.pression_signalee_at IS NULL
      -- La balle doit être dans NOTRE camp (le prospect n'a pas répondu depuis la proposition) :
      -- s'il a répondu, le poll gère déjà la conversation, on ne double-relance pas.
      AND NOT EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id AND ir.created_at > r.created_at)
    LIMIT 5
  `) as Array<{ rdv_id: string; contact_id: string; email: string; name: string | null; company: string; city: string | null; sector: string | null; website: string | null; owner_box: string | null; last_subject: string | null; convo_relances: number }>

  let rdvReproposes = 0
  for (const x of expiredProposed) {
    if (x.convo_relances >= MAX_CONVO_RELANCES || !x.owner_box) continue
    if (rdvReproposes >= MAX_RDV_REPROPOSES_PER_RUN || budgetDepasse()) break
    rdvReproposes++
    try {
      const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
      const availability = await getAvailability()
      const busy = (await sql`SELECT scheduled_at FROM rdv WHERE status = 'confirmed' AND scheduled_at > NOW() - INTERVAL '1 day'`) as Array<{ scheduled_at: string }>
      const slot = findNextAvailableSlot(null, availability, busy.map(b => b.scheduled_at))
      const slotStr = slot.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
        + ' à ' + slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
      await sql`UPDATE rdv SET scheduled_at = ${slot.toISOString()} WHERE id = ${x.rdv_id}`

      const sentH = (await sql`SELECT body, sent_at FROM email_queue WHERE contact_id = ${x.contact_id} AND status = 'sent' ORDER BY sent_at ASC`) as Array<{ body: string; sent_at: string | null }>
      const recvH = (await sql`SELECT body, created_at FROM incoming_replies WHERE contact_id = ${x.contact_id} ORDER BY created_at ASC`) as Array<{ body: string; created_at: string | null }>
      const history = [
        ...sentH.map(m => ({ role: 'sent' as const, body: m.body, ts: m.sent_at ? new Date(m.sent_at).getTime() : 0 })),
        ...recvH.map(m => ({ role: 'received' as const, body: cleanIncomingBody(m.body || ''), ts: m.created_at ? new Date(m.created_at).getTime() : 0 })),
      ].sort((a, b) => a.ts - b.ts)
        .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))

      const body = await generateReplyResponse({
        classification: 'rdv_request',
        originalEmailBody: sentH.length ? sentH[sentH.length - 1].body : '',
        replyBody: recvH.length ? cleanIncomingBody(recvH[recvH.length - 1].body || '') : '',
        contactName: x.name ?? x.email,
        contactCompany: x.company ?? x.email,
        contactCity: x.city ?? '',
        contactSector: x.sector ?? undefined,
        conversationHistory: history,
        proposedSlot: slotStr,
        isFollowUp: true,
        fromEmail: x.owner_box,
      })
      if (!(await texteSur(body, `re-proposition RDV ${x.email}`, x.website))) {
        repairs.push(`⛔ re-proposition bloquée (donnée inventée) → ${x.email}`)
        continue
      }
      const subject = x.last_subject ? (x.last_subject.startsWith('Re:') ? x.last_subject : `Re: ${x.last_subject}`) : 'Re: votre visibilité sur Google'
      await sql`
        INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
        VALUES (${x.contact_id}, ${campaign.id}, ${20 + x.convo_relances}, ${x.owner_box}, ${subject}, ${body}, 'queued', NOW())
      `
      repairs.push(`📅 RDV expiré re-proposé ${slotStr} → ${x.email}`)
    } catch (e) {
      repairs.push(`✗ re-proposition ${x.email}: ${String(e).slice(0, 60)}`)
    }
  }

  // ⚠️ NE PAS « clôturer » les créneaux 'proposed' passés en leur donnant un autre statut.
  // Piège vérifié le 07/08 : le dashboard, /api/rdv, rdv-list et export-leads comptent les VRAIS
  // rendez-vous avec `status <> 'proposed'`. Tout autre statut (même 'expired') les ferait
  // basculer dans le compteur de RDV réels et INVENTERAIT des rendez-vous qui n'ont jamais eu
  // lieu. Ils restent donc 'proposed' : correctement exclus partout, et listés par deep-audit
  // (section rdv_proposes_expires) comme « à rappeler à la main ».

  // Candidats : conversations réelles, silencieuses après NOTRE dernier message.
  const rows = (await sql`
    SELECT c.id, c.email, c.company, c.name, c.city, c.sector, c.website,
      (SELECT eq.from_email FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.from_email IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS owner_box,
      (SELECT eq.subject FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.subject IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS last_subject,
      GREATEST(
        COALESCE((SELECT MAX(eq.sent_at) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent'), TIMESTAMP 'epoch'),
        COALESCE((SELECT MAX(rd.sent_at) FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id WHERE ir.contact_id = c.id AND rd.status = 'sent'), TIMESTAMP 'epoch')
      ) AS last_out,
      COALESCE((SELECT MAX(ir.created_at) FROM incoming_replies ir WHERE ir.contact_id = c.id), TIMESTAMP 'epoch') AS last_in,
      (SELECT ir2.classification FROM incoming_replies ir2 WHERE ir2.contact_id = c.id ORDER BY ir2.created_at DESC LIMIT 1) AS last_classification,
      (SELECT COUNT(*) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status = 'sent')::int AS convo_relances
    FROM contacts c
    WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id AND ir.classification IN ('interest','question','objection','rdv_request'))
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status IN ('pending','queued','sending'))
      -- Leçon 106 / cas réel du 27/07 : un contact qui s'est plaint du NOMBRE de mails ne reçoit
      -- plus aucune relance automatique, même s'il n'a jamais écrit "stop". Devoir se désabonner
      -- après s'être plaint de la pression d'envoi, c'est ce qui déclenche le signalement.
      AND c.pression_signalee_at IS NULL
    LIMIT 200
  `) as Array<{ id: string; email: string; company: string; name: string | null; city: string | null; sector: string | null; website: string | null; owner_box: string | null; last_subject: string | null; last_out: string; last_in: string; last_classification: string | null; convo_relances: number }>

  const now = Date.now()
  const cutoff = now - SILENCE_DAYS * 86400000
  const due = rows.filter(r => {
    const out = new Date(r.last_out).getTime()
    const inn = new Date(r.last_in).getTime()
    return out > inn                    // la balle est dans leur camp (on a parlé en dernier)
      && out <= cutoff                  // silence depuis >= SILENCE_DAYS
      && r.convo_relances < MAX_CONVO_RELANCES
      && !!r.owner_box                  // on connaît la boîte qui suit la conversation
  }).slice(0, MAX_PER_RUN)

  let queued = 0
  const results: string[] = []
  // ⚠️ AVANT : relance codée en dur, TOUJOURS le même pitch générique ("1er mois offert"), sans
  // aucun rapport avec ce qui avait été RÉELLEMENT expliqué dans la conversation. Signalé après
  // qu'une relance a ignoré une réponse détaillée (fiche Google) déjà envoyée quelques jours plus
  // tôt, en resservant le pitch générique comme si de rien n'était. Fix : passer par le MÊME
  // générateur IA contextuel que la Partie A (réparations), avec `isFollowUp: true` (déjà prévu
  // pour ça dans generateReplyResponse : bref, change d'angle, ne reformule pas l'argumentaire
  // précédent) et l'historique COMPLET de la conversation, pour que la relance reste dans le fil
  // de ce qui a VRAIMENT été dit, plutôt qu'un pitch de secours identique pour tout le monde.
  for (const r of due) {
    if (budgetDepasse()) { results.push('⏱ budget atteint — relances restantes au prochain run'); break }
    const step = 20 + r.convo_relances // 20 puis 21
    const subject = r.last_subject ? (r.last_subject.startsWith('Re:') ? r.last_subject : `Re: ${r.last_subject}`) : 'Re: votre visibilité sur Google'
    try {
      const sent = (await sql`SELECT body, sent_at FROM email_queue WHERE contact_id = ${r.id} AND status = 'sent' ORDER BY sent_at ASC`) as Array<{ body: string; sent_at: string | null }>
      const recv = (await sql`SELECT body, created_at FROM incoming_replies WHERE contact_id = ${r.id} ORDER BY created_at ASC`) as Array<{ body: string; created_at: string | null }>
      const history = [
        ...sent.map(x => ({ role: 'sent' as const, body: x.body, ts: x.sent_at ? new Date(x.sent_at).getTime() : 0 })),
        ...recv.map(x => ({ role: 'received' as const, body: cleanIncomingBody(x.body || ''), ts: x.created_at ? new Date(x.created_at).getTime() : 0 })),
      ].sort((a, b) => a.ts - b.ts)
        .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))

      const body = await generateReplyResponse({
        classification: (r.last_classification as 'interest' | 'question' | 'objection' | 'rdv_request') ?? 'interest',
        originalEmailBody: sent.length ? sent[sent.length - 1].body : '',
        replyBody: recv.length ? cleanIncomingBody(recv[recv.length - 1].body || '') : '',
        contactName: r.name ?? r.email,
        contactCompany: r.company ?? r.email,
        contactCity: r.city ?? '',
        contactSector: r.sector ?? undefined,
        conversationHistory: history,
        isFollowUp: true,
        fromEmail: r.owner_box ?? undefined,
      })

      if (!(await texteSur(body, `relance conversation ${r.email}`, r.website))) {
        results.push(`⛔ relance bloquée (donnée inventée) → ${r.email}`)
        continue
      }
      await sql`
        INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
        VALUES (${r.id}, ${campaign.id}, ${step}, ${r.owner_box}, ${subject}, ${body}, 'queued', NOW())
      `
      queued++
      results.push(`↻ relance conversation (contextuelle) → ${r.email} (relance ${r.convo_relances + 1}/${MAX_CONVO_RELANCES})`)
    } catch (e) {
      results.push(`✗ ${r.email}: ${String(e).slice(0, 60)}`)
    }
  }

  // Heartbeat : figurait dans EXPECTED de heartbeat-check sans jamais pinger (angle mort, audit 02/08).
  const { pingHeartbeat } = await import('@/lib/heartbeat')
  await pingHeartbeat('conversation-followups', true, `dus=${due.length} mis_en_file=${queued}`)

  return NextResponse.json({ ok: true, candidats: rows.length, dus: due.length, mis_en_file: queued, réparations: repairs, results })
}
