/**
 * GET/POST /api/cron/poll-imap-replies
 *
 * Détection FIABLE des réponses aux envois du moteur MAISON (SMTP Gmail).
 * Lit UNIQUEMENT les boîtes Google (imap.gmail.com) via IMAP, timeouts courts,
 * budget global < 55s, et traite chaque réponse : classification IA + historique
 * de conversation + capture changement d'adresse + RDV auto + blocklist + brouillon.
 *
 * Sur toute vraie réponse (hors absence auto 'oof'), ANNULE les relances en file
 * (ne pas se répéter). Remplace check-replies (Instantly, aveugle aux envois SMTP).
 */
import { NextRequest, NextResponse } from 'next/server'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import { isExplicitOptOut, isRgpdRequestOrComplaint, isPressionSignalee, isNegociationCommerciale } from '@/lib/rgpd'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { sendReplyEmail } from '@/lib/reply-agent/send-reply'
import { isFakeEmail } from '@/lib/fake-email'
import { toParisWallClock } from '@/lib/availability'
import { cleanIncomingBody, decodeQuotedPrintable } from '@/lib/decode-body'
import { detectInventedFacts } from '@/lib/anti-invention'
import { alertIndependent } from '@/lib/alert'

// Client SQL brut, assigné dynamiquement dans le handler (évite d'évaluer neon()
// au build, où DATABASE_URL est absent — cause d'échec de "collect page data").
let sql!: NeonQueryFunction<false, false>

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GLOBAL_DEADLINE_MS = 2_000  // une seule boite par passage : on ne doit jamais en DEMARRER une seconde. 2 + 22 = 24s, sous la coupe de 30s.
const PER_BOX_TIMEOUT_MS = 22_000 // laisse finir UN traitement complet (IMAP 1,2s + IA ~10s + marge). Mesure du 17/08.
const MAX_MSGS_PER_BOX = 180  // le warmup remplit vite la boîte : à 70, une vraie réponse un peu ancienne (ex. répondue tôt puis noyée sous le warmup) sortait de la fenêtre et n'était jamais lue. On élargit.
const LOOKBACK_HOURS = 72     // marge de sécurité : si le cron saute une nuit/journée, on ne rate pas la réponse (dédup Message-ID = pas de retraitement)

const CLIENT_NOTIFY_EMAIL = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr')
  .split(',').map(s => s.trim()).filter(Boolean)
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'
const RESEND_API_KEY = process.env.RESEND_API_KEY

function randomDelayMs(): number {
  return (4 + Math.floor(Math.random() * 9)) * 60 * 1000 // 4-12 min
}

/**
 * ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48) — indispensable ICI plus qu'ailleurs : c'est le cron
 * qui garantit « zéro lead perdu ». Sans elle, une exception (IMAP, SQL, Gemini) remonte en 500
 * au corps VIDE : cron-job.org n'affiche qu'« Erreur HTTP » sans motif, le heartbeat n'est jamais
 * posé (donc le cron paraît juste "muet"), et pendant ce temps des réponses de prospects ne sont
 * plus lues. On expose donc toujours la vraie erreur ET on marque l'échec au heartbeat.
 */
export async function GET(req: NextRequest) {
  try {
    const res = await POST(req)
    await pingHeartbeat("poll-imap-replies", res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[poll-imap-replies]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat("poll-imap-replies", false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({ ok: false, error: String(e.message ?? err).slice(0, 300), cause: e.cause?.message?.slice(0, 200), code: e.code }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  sql = (await import('@/lib/db')).sql

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ ok: false, results: ['aucune boîte Gmail (IMAP_ACCOUNTS)'] })

  const mode = new URL(req.url).searchParams.get('mode')
  if (mode === 'ping') return NextResponse.json({ ok: true, ping: true, boxes: boxes.map(b => b.email) })

  const started = Date.now()
  const results: string[] = []
  const stats = { processed: 0, replies: 0, bounces: 0, cancelled: 0, sentReplies: 0 }

  // ── Partie A : envoyer les auto-réponses programmées et prêtes (délai humain écoulé) ──
  // BORNÉE EN TEMPS : cron-job.org (gratuit) coupe à 30s. Sans limite, 10 envois SMTP
  // séquentiels pouvaient à eux seuls dépasser 30s et tronquer tout le run. On plafonne
  // la Partie A (deadline + timeout par envoi) ; le reste part au run suivant (toutes les 10 min).
  const PARTIE_A_DEADLINE_MS = 12_000
  try {
    // 🚨 CLAIM ATOMIQUE (audit 09/08). Avant : SELECT → envoi → UPDATE. Trois requêtes distinctes,
    // donc trois occasions pour un second run de passer entre les deux. Or ce cron tourne toutes
    // les 10 min, cron-job.org réessaie sur timeout, et Vercel peut exécuter deux instances en
    // parallèle : deux runs pouvaient lire le MÊME brouillon 'scheduled' et l'envoyer TOUS LES
    // DEUX. Le prospect reçoit la même réponse en double — c'est la mécanique exacte de l'incident
    // des doublons du 8 juillet, appliquée aux réponses.
    //
    // Ici, la réservation et la lecture sont la MÊME requête : seul le premier run obtient la
    // ligne. `FOR UPDATE SKIP LOCKED` évite en plus que deux runs s'attendent l'un l'autre.
    const ready = (await sql`
      WITH pris AS (
        SELECT rd.id FROM reply_drafts rd
        WHERE rd.status = 'scheduled' AND rd.send_after <= NOW()
        ORDER BY rd.send_after
        LIMIT 6
        FOR UPDATE SKIP LOCKED
      )
      UPDATE reply_drafts SET status = 'sending'
      WHERE id IN (SELECT id FROM pris)
      RETURNING id AS draft_id, body, incoming_reply_id
    `) as Array<{ draft_id: string; body: string; incoming_reply_id: string }>
    for (const d of ready) {
      if (Date.now() - started > PARTIE_A_DEADLINE_MS) { results.push('⏱ Partie A: budget atteint, suite au prochain run'); break }
      try {
        const r = await withTimeout(sendReplyEmail(d.incoming_reply_id, d.body), 5_000, `reply ${d.draft_id}`)
        if (r.ok) {
          await sql`UPDATE reply_drafts SET status = 'sent', sent_at = NOW() WHERE id = ${d.draft_id}`
          await sql`UPDATE incoming_replies SET action_taken = 'replied' WHERE id = ${d.incoming_reply_id}`
          stats.sentReplies++
          results.push(`↩ auto-réponse envoyée → ${r.to} via ${r.via}`)
        } else {
          // Échec d'envoi → on RELIBÈRE la ligne, sinon elle reste bloquée en 'sending' pour
          // toujours et la réponse au prospect n'est jamais renvoyée (lead perdu en silence).
          await sql`UPDATE reply_drafts SET status = 'scheduled' WHERE id = ${d.draft_id}`.catch(() => {})
          results.push(`✗ auto-réponse KO (${d.draft_id}): ${(r.error ?? '').slice(0, 80)}`)
        }
      } catch (e) {
        await sql`UPDATE reply_drafts SET status = 'scheduled' WHERE id = ${d.draft_id}`.catch(() => {})
        results.push(`✗ auto-réponse erreur (${d.draft_id}): ${String(e).slice(0, 80)}`)
      }
    }
  } catch (e) {
    results.push(`Partie A erreur: ${String(e).slice(0, 80)}`)
  }

  // REAPER : un run coupé net (timeout cron-job.org à 30 s, redéploiement) laisse des lignes en
  // 'sending' que plus personne ne reprendra. Sans ce filet, le claim atomique ci-dessus troque un
  // risque de double envoi contre un risque de non-envoi — donc contre un lead perdu. On rend au
  // circuit toute réservation qui traîne depuis plus de 15 minutes.
  await sql`
    UPDATE reply_drafts SET status = 'scheduled'
    WHERE status = 'sending' AND send_after < NOW() - INTERVAL '15 minutes'
  `.catch(() => {})

  // ── Partie B : lecture IMAP des boîtes + traitement des nouvelles réponses ──
  // Rotation de l'ordre des boîtes à chaque run (toutes les 10 min) : avec un budget
  // serré (<30s), on ne lit pas forcément les 4 boîtes en un run → on tourne l'ordre
  // pour qu'aucune boîte ne soit jamais oubliée. La dédup Message-ID évite tout doublon.
  /**
   * ⚠️ ROTATION PERSISTANTE, JAMAIS DÉRIVÉE DE L'HORLOGE.
   *
   * `Math.floor(Date.now() / 600_000) % boxes.length` suppose que le cron passe exactement toutes
   * les 10 minutes. Dès que la cadence change — et elle a changé plusieurs fois cette semaine —
   * la bascule devient dégénérée : si la période est un multiple du pas, certaines boîtes ne sont
   * JAMAIS lues, sans la moindre erreur pour le signaler. Un compteur en base ne dépend d'aucune
   * hypothèse sur la fréquence.
   */
  const rotRow = (await sql`
    INSERT INTO agent_config (key, value, updated_at) VALUES ('imap_rotation', '1', now())
    ON CONFLICT (key) DO UPDATE SET
      value = ((COALESCE(NULLIF(agent_config.value, ''), '0')::bigint + 1))::text, updated_at = now()
    RETURNING value
  `.catch(() => [] as Array<{ value: string }>)) as Array<{ value: string }>
  const rot = Number(rotRow[0]?.value ?? 0) % boxes.length

  /**
   * ⚠️ MOINS DE BOÎTES PAR PASSAGE, MAIS DU TEMPS POUR CHACUNE.
   *
   * Constaté le 17/08 : « 101 messages récents » puis « timeout box », sur CHAQUE boîte, et
   * seulement 2 messages traités en 25 secondes. Avec 8 s par boîte, le seul chargement des
   * enveloppes d'une centaine de messages épuisait déjà le délai — la boîte mourait avant d'avoir
   * examiné une seule réponse. Quatre boîtes traitées à moitié valent moins que deux traitées
   * entièrement : une réponse à moitié lue n'est pas lue.
   *
   * Deux boîtes par passage, 12 s chacune. Avec la rotation, chaque boîte est relevée à chaque
   * deuxième passage — soit toutes les 20 minutes à cadence de 10 min.
   */
  /**
   * ⚠️ UNE SEULE BOÎTE PAR PASSAGE — et c'est la mesure qui l'impose, pas une intuition.
   *
   * Mesuré le 17/08 : connexion 570 ms, recherche 360 ms, enveloppes 287 ms. La lecture IMAP coûte
   * 1,2 s. Tout le reste du budget part dans le TRAITEMENT d'un seul message : classification puis
   * génération de réponse par l'IA, une dizaine de secondes. Aucun budget de 8 ou 12 s ne peut
   * contenir ça — j'ai réglé ce chiffre deux fois à l'aveugle avant de le mesurer.
   *
   * Une boîte par passage, avec un budget qui laisse finir un traitement complet. Mieux vaut une
   * boîte lue jusqu'au bout toutes les 40 minutes que quatre boîtes coupées en plein milieu à
   * chaque fois : une réponse à moitié lue n'est pas lue.
   *
   * ⚠️ Pour réduire la latence, c'est la CADENCE du cron qu'il faut augmenter (5 min → chaque
   * boîte toutes les 20 min), pas le nombre de boîtes par passage.
   */
  const BOITES_PAR_PASSAGE = 1
  const orderedBoxes = boxes.slice(rot).concat(boxes.slice(0, rot)).slice(0, BOITES_PAR_PASSAGE)
  const loop = (async () => {
    for (const box of orderedBoxes) {
      if (Date.now() - started > GLOBAL_DEADLINE_MS) { results.push('⏱ budget global atteint'); break }
      try {
        await withTimeout(processBox(box, started, results, stats), PER_BOX_TIMEOUT_MS, `box ${box.email}`)
      } catch (e) {
        results.push(`[${box.email}] ⏱/❌ ${String(e).slice(0, 90)}`)
      }
    }
  })()

  try {
    await withTimeout(loop, 50_000, 'global')
  } catch {
    results.push('⏱ garde-fou global 50s déclenché — réponse partielle')
  }

  return NextResponse.json({
    ok: true,
    processed: stats.processed,
    replies: stats.replies,
    bounces: stats.bounces,
    cancelled_steps: stats.cancelled,
    sent_replies: stats.sentReplies,
    results,
  })
}

interface Stats { processed: number; replies: number; bounces: number; cancelled: number; sentReplies: number }

/** Traite UNE boîte : connexion IMAP, lecture des non-lus, routage vers le pipeline. */
async function processBox(box: { email: string; password: string }, started: number, results: string[], stats: Stats): Promise<void> {
  const { ImapFlow } = await import('imapflow')
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: box.email, pass: box.password.replace(/\s+/g, '') },
    logger: false,
    socketTimeout: 7000,
    greetingTimeout: 5000,
    connectionTimeout: 5000,
  })

  /**
   * ⚠️ ON MESURE AU LIEU DE SUPPOSER. Trois passages de suite se sont terminés par « timeout box »
   * sans qu'on sache si le temps partait dans la connexion Gmail, la recherche ou le chargement
   * des enveloppes. Trois marqueurs coûtent trois lignes et évitent de régler au hasard un budget
   * qu'on ne comprend pas.
   */
  const t0 = Date.now()
  await client.connect()
  const tConnect = Date.now() - t0
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000)
      const tSearch0 = Date.now()
      // TOUS les messages récents (plus seulement les non-lus) : une réponse OUVERTE dans Gmail
      // (marquée "lue") était ratée par seen:false. Dédup par Message-ID + filtre "vrai contact"
      // (le warmup vient d'adresses tierces → ignoré sans coût IA).
      const found = await client.search({ since })
      // Du PLUS RÉCENT au plus ancien : une vraie réponse récente (ex. BJM) doit être traitée AVANT
      // que le budget temps (30s cron / 6s par boîte) ne coupe. Avant, on traitait les vieux d'abord
      // et on timeoutait avant d'atteindre les messages récents → réponse jamais lue.
      const tSearch = Date.now() - tSearch0
      const uids = (Array.isArray(found) ? found : []).slice(-MAX_MSGS_PER_BOX).reverse()
      const tEnv0 = Date.now()

      // ⚠️ AUDIT 07/08 — les 3 boîtes timeoutaient à 6s À CHAQUE RUN (« ⏱/❌ timeout box »).
      // Cause : la boucle faisait TROIS allers-retours réseau PAR MESSAGE (fetchOne enveloppe,
      // SELECT dédup, SELECT contacts) sur 90 à 125 messages, soit ~300 allers-retours pour 6s
      // de budget. En pratique, seuls les ~15 messages les plus récents étaient réellement
      // examinés ; une vraie réponse noyée sous le warmup pouvait n'être JAMAIS lue (violation
      // directe de l'invariant « zéro lead perdu »).
      // Fix : on PRÉ-CHARGE en 3 requêtes au total (1 IMAP + 2 SQL) au lieu de 3 × N. Le corps
      // du message, lui, reste chargé à la demande — uniquement pour les vraies réponses.
      const envs = new Map<number, { from: string; subject: string; messageId: string }>()
      try {
        for await (const msg of client.fetch(uids.join(','), { envelope: true })) {
          const e = msg.envelope
          if (!e) continue
          envs.set(msg.seq, {
            from: (e.from?.[0]?.address ?? '').toLowerCase(),
            subject: e.subject ?? '',
            messageId: e.messageId ?? `imap-${box.email}-${msg.seq}`,
          })
        }
      } catch { /* repli : on continuera avec ce qui a été chargé */ }
      results.push(`[${box.email}] ${uids.length} msg · connexion ${tConnect}ms · recherche ${tSearch}ms · enveloppes ${Date.now() - tEnv0}ms`)

      const tousMessageIds = [...envs.values()].map(v => 'imap:' + v.messageId)
      const tousFroms = [...new Set([...envs.values()].map(v => v.from).filter(Boolean))]
      const dejaTraites = new Set(
        ((await sql`SELECT instantly_reply_id AS id FROM incoming_replies WHERE instantly_reply_id = ANY(${tousMessageIds})`) as Array<{ id: string }>)
          .map(r => r.id)
      )
      const contactsConnus = new Set(
        ((await sql`SELECT LOWER(email) AS email FROM contacts WHERE LOWER(email) = ANY(${tousFroms})`) as Array<{ email: string }>)
          .map(r => r.email)
      )

      for (const uid of uids) {
        if (Date.now() - started > GLOBAL_DEADLINE_MS) { results.push(`⏱ budget atteint pendant ${box.email}`); break }
        const env = envs.get(uid)
        if (!env) continue
        const { from, subject, messageId } = env
        if (!from) continue

        // Dédup par Message-ID : déjà traité ? on saute (jamais de 2e réponse).
        if (dejaTraites.has('imap:' + messageId)) { await client.messageFlagsAdd({ uid }, ['\\Seen']).catch(() => {}); continue }

        const fetchBody = async (): Promise<string> => {
          const src = await client.fetchOne(uid, { source: true }).catch(() => null)
          const raw = src && src.source ? src.source.toString() : ''
          // Filet de sécurité si le parser MIME a raté un corps base64 ou quoted-printable.
          return cleanIncomingBody(extractPlainText(raw.length > 60_000 ? raw.slice(0, 60_000) : raw))
        }

        // Bounce → blocklist du VRAI destinataire (jamais un daemon).
        if (isBounceMessage(from, subject)) {
          const body = await fetchBody()
          const orig = extractOriginalRecipient(body)
          if (orig && !isDaemonAddress(orig)) {
            await blocklistOnce(orig, 'bounce')
            stats.cancelled += await cancelSteps(orig)
            stats.bounces++
            results.push(`[${box.email}] 🔴 bounce ${orig}`)
          } else {
            results.push(`[${box.email}] ⚠ bounce sans destinataire identifiable (ignoré, from=${from})`)
          }
          await client.messageFlagsAdd({ uid }, ['\\Seen']).catch(() => {})
          continue
        }

        // Ne traiter QUE les réponses de VRAIS prospects → filtre le warmup. MAIS un prospect
        // répond parfois depuis une AUTRE adresse que celle qu'on a contactée (perso, alias...).
        // Si l'expéditeur est inconnu mais que le SUJET correspond à un email qu'on a réellement
        // ENVOYÉ (email_queue), c'est une vraie réponse depuis une autre adresse → on la relie au
        // bon contact au lieu de la jeter (sinon lead chaud perdu en silence — cas BJM).
        const known = contactsConnus.has(from)
        let contactHint: string | undefined
        if (!known) {
          const baseSubject = subject.replace(/^\s*(re|ré|fwd|fw|tr|rép)\s*:\s*/gi, '').replace(/^\s*(re|ré|fwd|fw|tr|rép)\s*:\s*/gi, '').trim()
          if (baseSubject.length > 8) {
            const m = (await sql`SELECT contact_id FROM email_queue WHERE LOWER(subject) = LOWER(${baseSubject}) AND status = 'sent' AND contact_id IS NOT NULL ORDER BY sent_at DESC LIMIT 1`) as Array<{ contact_id: string }>
            if (m[0]?.contact_id) contactHint = m[0].contact_id
          }
          if (!contactHint) { await client.messageFlagsAdd({ uid }, ['\\Seen']).catch(() => {}); continue }
        }

        const body = await fetchBody()
        await client.messageFlagsAdd({ uid }, ['\\Seen']).catch(() => {})
        stats.processed++

        try {
          const outcome = await processReply({ from, subject, body, messageId, boxEmail: box.email, results, contactHint })
          if (outcome?.processed) {
            stats.replies++
            if (outcome.classification && outcome.classification !== 'oof') {
              // ⚠️ DEUX ANNULATIONS, PAS UNE. `from` est l'adresse d'où le prospect a écrit ;
              // `contactHint` est la fiche réellement démarchée, quand elle diffère (réponse depuis
              // une adresse perso). N'annuler que la première laissait la séquence de l'entreprise
              // intacte — le cas « NO WAY ! » du 11/08, relancé le 12.
              stats.cancelled += await cancelSteps(from)
              if (contactHint) stats.cancelled += await cancelStepsParContactId(contactHint)
            }
          }
        } catch (e) {
          results.push(`[${box.email}] erreur pipeline ${from}: ${String(e).slice(0, 80)}`)
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => { try { client.close() } catch { /* noop */ } })
  }
}

// ── Pipeline de traitement d'une nouvelle réponse (classification → action) ──
async function processReply(params: {
  from: string; subject: string; body: string; messageId: string; boxEmail: string; results: string[]; contactHint?: string
}): Promise<{ processed: boolean; classification?: string } | null> {
  const { from, subject, body, messageId, results, contactHint } = params
  const { classifyReply, stripQuotedReply } = await import('@/lib/reply-agent/classifier')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')

  const dedupKey = `imap:${messageId}`
  // Dédup permanente par Message-ID (index unique sur instantly_reply_id).
  const seen = (await sql`SELECT id FROM incoming_replies WHERE instantly_reply_id = ${dedupKey} LIMIT 1`) as Array<{ id: string }>
  if (seen.length > 0) return null

  // Contact : par contactHint (réponse depuis une autre adresse, résolue par le sujet) sinon par email.
  type Contact = { id: string; email: string; name: string | null; company: string | null; city: string | null; sector: string | null; phone: string | null; website: string | null }
  const contactRows = contactHint
    ? (await sql`SELECT id, email, name, company, city, sector, phone, website FROM contacts WHERE id = ${contactHint} LIMIT 1`) as Contact[]
    : (await sql`SELECT id, email, name, company, city, sector, phone, website FROM contacts WHERE LOWER(email) = LOWER(${from}) LIMIT 1`) as Contact[]
  let contact: Contact | undefined = contactRows[0]
  if (contactHint && contact) results.push(`↪ réponse depuis autre adresse (${from}) reliée à ${contact.company ?? contact.email}`)

  if (!contact && !contactHint && from.includes('@')) {
    const created = (await sql`
      INSERT INTO contacts (email, company, sector, source)
      VALUES (${from}, ${from.split('@')[1]?.split('.')[0] ?? 'Inconnu'}, 'inconnu', 'reply_auto')
      ON CONFLICT DO NOTHING
      RETURNING id, email, name, company, city, sector, phone
    `) as Contact[]
    if (created[0]) contact = created[0]
  }

  const cleanBody = stripQuotedReply(body) || body

  // Dédup par CONTENU (même message ré-entrant) pour ce contact. ⚠️ On DÉCODE les deux côtés
  // (cleanIncomingBody) AVANT de comparer : d'anciens messages stockés en base64 non décodé
  // faisaient échouer la comparaison (base64 ≠ texte) → le même message était ré-ingéré et
  // ré-répondu, polluant la conversation. Fenêtre élargie à 30 messages.
  if (contact?.id) {
    const recent = (await sql`
      SELECT body FROM incoming_replies WHERE contact_id = ${contact.id}
      ORDER BY created_at DESC LIMIT 30
    `) as Array<{ body: string }>
    const norm = normalizeBody(cleanBody)
    if (norm && recent.some(r => {
      const dec = cleanIncomingBody(r.body ?? '')
      return normalizeBody(stripQuotedReply(dec) || dec) === norm
    })) {
      results.push(`doublon contenu ignoré : ${from}`)
      return null
    }
  }

  // Filtre warmup anglais (ne jamais jeter un vrai prospect FR).
  if (!isLikelyFrench(cleanBody)) {
    results.push(`warmup ignoré (anglais) : ${from}`)
    return null
  }

  // Dernier email envoyé (contexte pour la classification).
  let originalEmailBody = ''
  if (contact?.id) {
    const last = (await sql`
      SELECT body FROM email_queue WHERE contact_id = ${contact.id} AND status = 'sent'
      ORDER BY sent_at DESC LIMIT 1
    `) as Array<{ body: string }>
    originalEmailBody = last[0]?.body ?? ''
  }

  const classification = await classifyReply({
    replyBody: cleanBody,
    replySubject: subject,
    originalEmailBody,
    contactName: contact?.name ?? from,
    contactCompany: contact?.company ?? from,
    fromEmail: from,
  })

  // Insert incoming_replies. La dédup permanente est faite par le SELECT ci-dessus
  // (dedupKey = Message-ID). ON CONFLICT DO NOTHING sans cible = filet de sécurité qui
  // ne dépend PAS d'un index unique (pas encore garanti en base) → jamais d'erreur SQL.
  const inserted = (await sql`
    INSERT INTO incoming_replies (contact_id, from_email, subject, body, classification, action_taken, instantly_reply_id, processed_at)
    VALUES (${contact?.id ?? null}, ${from}, ${subject}, ${body}, ${classification.classification}, ${classification.action}, ${dedupKey}, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>
  if (!inserted[0]) return null // course concurrente (index unique présent) → on saute
  const incomingReplyId = inserted[0].id

  // ── OPT-OUT DÉTERMINISTE (prioritaire sur tout, y compris changement d'adresse) ──
  // Ne dépend PAS de l'IA : un "Stop" / "désabonnez-moi" explicite = blocklist immédiate.
  // (Analysé sur cleanBody = texte réel du prospect, pas notre footer cité.)
  if (isExplicitOptOut(cleanBody)) {
    const cibles = await ciblesArret(from, cleanBody, contact?.email)
    for (const c of cibles) { await blocklistOnce(c, 'unsubscribe'); await cancelSteps(c) }
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, action: 'blocklist', reason: 'opt-out explicite', cibles, company: contact?.company ?? from })}::jsonb)`
    results.push(`⛔ opt-out explicite → blocklist ${cibles.join(', ')}`)
    return { processed: true, classification: 'desinterest' }
  }

  // ── DEMANDE RGPD / PLAINTE (prioritaire, traitement RENFORCÉ) ──
  // Incident réel LabegarIA (plainte CNIL) : une demande d'effacement ou une accusation de spam
  // partait au classifieur IA, pouvait être lue comme une simple objection commerciale, et
  // recevoir une RÉPONSE AUTOMATIQUE de vente. C'est ce qui transforme un mécontentement en
  // plainte. Ici : arrêt immédiat, AUCUNE réponse automatique (le RGPD impose une réponse
  // humaine documentée sous 1 mois), et alerte immédiate sur le canal indépendant.
  const rgpd = isRgpdRequestOrComplaint(cleanBody)
  if (rgpd.match) {
    const cibles = await ciblesArret(from, cleanBody, contact?.email)
    for (const c of cibles) { await blocklistOnce(c, `rgpd_${rgpd.motif}`); await cancelSteps(c) }
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, action: 'rgpd_request', reason: rgpd.motif, company: contact?.company ?? from })}::jsonb)`
    // Tâche urgente : une demande RGPD exige une réponse HUMAINE, tracée, sous 1 mois.
    // ⚠️ AUDIT 09/08 : cette écriture échouait DEPUIS TOUJOURS — la table `urgent_tasks` n'avait
    // jamais été créée — et le `.catch(() => {})` l'avalait sans un mot. La trace d'une demande
    // RGPD, qui ouvre un délai légal d'un mois, disparaissait donc en silence. La table est
    // désormais créée (migration), et un échec n'est plus muet : il part sur le canal d'alerte,
    // parce qu'une obligation légale non tracée est pire qu'une erreur visible.
    try {
      await sql`
        INSERT INTO urgent_tasks (type, title, description)
        VALUES ('rgpd', ${`[RGPD] ${rgpd.motif} — ${from}`}, ${`Demande RGPD reçue de ${from} (${contact?.company ?? 'contact inconnu'}).\nMotif détecté : ${rgpd.motif}.\nContact BLOCKLISTÉ et file annulée automatiquement.\n\nACTION HUMAINE REQUISE : répondre sous 1 mois et documenter la suppression.\n\nExtrait du message :\n${cleanBody.slice(0, 500)}`})
        ON CONFLICT DO NOTHING
      `
    } catch (e) {
      console.error('[poll-imap] urgent_tasks KO', e)
      try {
        const { alertIndependent } = await import('@/lib/alert')
        await alertIndependent(
          `RGPD non trace en base — ${from}`,
          `Impossible d'enregistrer la tache RGPD pour ${from} (motif ${rgpd.motif}).\nLe contact EST blockliste et sa file annulee, mais la trace manque.\nErreur : ${String(e).slice(0, 200)}`,
        )
      } catch { /* le canal d'alerte est traité juste après */ }
    }
    try {
      const { alertIndependent } = await import('@/lib/alert')
      await alertIndependent(
        `DEMANDE RGPD (${rgpd.motif}) — ${from}`,
        `Un prospect a exercé un droit RGPD ou signalé un abus.\n\nDe : ${from}\nEntreprise : ${contact?.company ?? 'inconnue'}\nMotif : ${rgpd.motif}\n\nLe contact est déjà blocklisté et sa file d'envoi annulée.\nAUCUNE réponse automatique n'a été envoyée (obligatoire).\n\nTu dois répondre toi-même sous 1 mois et documenter le traitement.\n\nExtrait :\n${cleanBody.slice(0, 600)}`,
      )
    } catch { /* alerte non bloquante */ }
    results.push(`🛑 demande RGPD (${rgpd.motif}) → blocklist + alerte ${from}`)
    return { processed: true, classification: 'desinterest' }
  }

  // ── MÉCONTENTEMENT SUR LA PRESSION D'ENVOI (leçon 106, cas réel du 27/07) ──
  // « ne pas leur écrire trois mails sur le même sujet en quelques heures » : ni un "stop", ni une
  // demande RGPD, donc le contact n'était pas blocklisté — et une RELANCE DE CONVERSATION lui est
  // repartie APRÈS sa plainte. Devoir écrire "stop" après s'être plaint du nombre de mails, c'est
  // exactement ce qui transforme un agacé en plaignant.
  // On ne blockliste PAS (il n'a pas demandé à ne plus jamais être contacté, et le lead reste
  // commercialement ouvert) : on ARRÊTE tout ce qui est automatique. Réponse à ce message : oui.
  // Relances de séquence et de conversation : plus jamais.
  if (contact?.id && isPressionSignalee(cleanBody)) {
    await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pression_signalee_at TIMESTAMPTZ`.catch(() => {})
    await sql`UPDATE contacts SET pression_signalee_at = NOW() WHERE id = ${contact.id} AND pression_signalee_at IS NULL`.catch(() => {})
    await cancelSteps(from)
    results.push(`🤐 pression signalée par ${from} → aucune relance automatique (réponse à ce message uniquement)`)
  }

  // ── Changement d'adresse : le prospect indique une nouvelle adresse mail ──
  // On NE ressuscite PAS l'ancienne file (les 'sent' resteraient comptés → renvoi complet
  // de la séquence + plafond à vie réinitialisé = le bug "130 mails"). À la place : on crée
  // un contact NEUF sur la nouvelle adresse (compteurs anti-doublon/plafond repartent propres),
  // on stoppe l'ancienne file, et l'autopilot régénère une séquence sur-mesure.
  if (contact?.id && classification.action !== 'blocklist') {
    const newEmail = extractNewEmail(cleanBody, contact.email)
    if (newEmail && !isDaemonAddress(newEmail)) {
      try {
        // 1) Stoppe l'ancienne file — JAMAIS les 'sent'/'failed'.
        await sql`UPDATE email_queue SET status = 'cancelled' WHERE contact_id = ${contact.id} AND status IN ('pending', 'queued', 'queued_instantly', 'sending')`
        // 2) Contact neuf (hérite de l'audit déjà fait ; email confirmé par le prospect).
        const nc = (await sql`
          INSERT INTO contacts (email, company, name, city, sector, phone, website, source,
            email_validated, email_confidence_score, audit_done, audit_score, audit_level, audit_weaknesses, audit_cms)
          SELECT ${newEmail}, company, name, city, sector, phone, website, 'email_change',
            true, 99, audit_done, audit_score, audit_level, audit_weaknesses, audit_cms
          FROM contacts WHERE id = ${contact.id}
          ON CONFLICT (email) DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>
        // 3) Une seule ligne step 0 'pending' → autopilot régénère une séquence propre.
        if (nc[0]?.id) {
          await sql`
            INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
            SELECT ${nc[0].id}, campaign_id, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW()
            FROM email_queue WHERE contact_id = ${contact.id} ORDER BY created_at ASC LIMIT 1
          `
        }
        await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, newEmail, company: contact.company, action: 'email_updated' })}::jsonb)`
        results.push(`✉ changement d'adresse : ${contact.email} -> ${newEmail} (contact neuf, file propre)`)
        return { processed: true, classification: classification.classification }
      } catch (e) {
        results.push(`MAJ adresse échouée ${from}: ${String(e).slice(0, 60)}`)
      }
    }
  }

  // ── NÉGOCIATION COMMERCIALE → AUCUNE RÉPONSE, DÉCISION DU CLIENT ──
  //
  // ⚠️ CAS RÉEL 07/08 : un couvreur du Cannet répond « si vous montez un site qui fonctionne très
  // bien, vous gérez tout, je vous donne 20 % de mon bénéfice ». L'agent a rédigé un refus poli
  // en engageant l'offre : « notre modèle repose sur un accompagnement mensuel fixe », « le
  // premier mois est offert ». Ce n'est PAS à lui de dire ça. Accepter, refuser ou aménager un
  // modèle de rémunération est une décision de chef d'entreprise — celle de Haris, pas de l'agent,
  // et pas de Timéo non plus.
  //
  // Le risque n'est pas que la réponse soit mal écrite : c'est qu'elle ferme une porte, ou qu'elle
  // engage le client sur des conditions qu'il n'a pas validées. Un agent commercial doit savoir
  // reconnaître ce qui le dépasse. Ici : on n'écrit rien, on remonte la balle.
  if (isNegociationCommerciale(cleanBody)) {
    await sql`UPDATE incoming_replies SET classification = 'negociation', agent_decision = 'no_action', status = 'awaiting_validation' WHERE instantly_reply_id = ${dedupKey}`.catch(() => {})
    const titre = `[DÉCISION] Proposition commerciale — ${from}`
    await sql`
      INSERT INTO urgent_tasks (type, title, description)
      VALUES ('decision', ${titre}, ${`${contact?.company ?? from} propose un autre modèle de rémunération.\n\nAUCUNE réponse n'a été envoyée : accepter, refuser ou négocier est une décision du client, pas de l'agent.\n\nSon message :\n${cleanBody.slice(0, 600)}`})
      ON CONFLICT DO NOTHING
    `.catch(() => {})
    try {
      const { alertIndependent } = await import('@/lib/alert')
      await alertIndependent(
        `Proposition commerciale a arbitrer — ${from}`,
        `${contact?.company ?? from} propose un autre modele de remuneration.\nAucune reponse envoyee : c'est une decision du client.\n\n${cleanBody.slice(0, 500)}`,
      )
    } catch { /* l'alerte ne doit pas bloquer le traitement */ }
    return { processed: true, classification: 'negociation' }
  }

  // ── Opt-out / désintérêt (classé par l'IA) → blocklist + annulation des relances ──
  if (classification.action === 'blocklist') {
    await blocklistOnce(from, 'desinterest')
    if (contact?.id) await cancelSteps(from)
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, classification: classification.classification, action: 'blocklist', company: contact?.company ?? from })}::jsonb)`
    return { processed: true, classification: classification.classification }
  }

  if (classification.action === 'no_action') {
    // Absence ("fermé/absent jusqu'au X") → on DÉCALE les relances en attente pour
    // qu'elles repartent au retour du prospect (spacing J+3/J+7 préservé), au lieu de
    // relancer dans le vide pendant qu'il est absent.
    if (classification.classification === 'oof' && contact?.id) {
      const ret = extractReturnDate(cleanBody, new Date())
      if (ret) {
        const [minRow] = (await sql`
          SELECT MIN(scheduled_at) AS m FROM email_queue
          WHERE contact_id = ${contact.id} AND status IN ('pending', 'queued') AND sequence_step > 0
        `) as Array<{ m: string | null }>
        if (minRow?.m && new Date(minRow.m).getTime() < ret.getTime()) {
          const deltaSec = Math.round((ret.getTime() - new Date(minRow.m).getTime()) / 1000)
          const shifted = (await sql`
            UPDATE email_queue
            SET scheduled_at = scheduled_at + (${deltaSec} * interval '1 second')
            WHERE contact_id = ${contact.id} AND status IN ('pending', 'queued') AND sequence_step > 0
            RETURNING id
          `) as Array<{ id: string }>
          results.push(`⏰ absence → ${shifted.length} relance(s) repoussée(s) à partir du ${ret.toLocaleDateString('fr-FR')}`)
        }
      }
    }
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, classification: classification.classification, action: 'no_action', company: contact?.company ?? from })}::jsonb)`
    return { processed: true, classification: classification.classification }
  }

  // Vraie conversation (intérêt/question/objection/RDV) → on stoppe les relances froides.
  // On annule par l'email du CONTACT (pas `from`, qui peut être une adresse alternative).
  if (contact?.id && classification.classification !== 'oof') await cancelSteps(contact.email)

  // ── RDV : logique PROPOSER → CONFIRMER (jamais caler une date non acceptée) ──
  // On ne cale JAMAIS un RDV que le prospect n'a pas accepté. L'agent PROPOSE un créneau précis
  // ("mardi 15h ça vous va ?") → le RDV reste 'proposed' (invisible côté agenda/stats). Il ne passe
  // 'confirmed' (+ notif client) QUE quand le prospect dit oui, OU donne lui-même une date précise.
  const isRdv = classification.classification === 'rdv_request'
  const rawExtracted = (classification as { extractedDate?: string }).extractedDate
  // ⚠️ Beaucoup de prospects (surtout depuis un mobile) écrivent tout leur message DANS L'OBJET et
  // laissent un corps vide ("Envoyé de mon iPhone"). En n'analysant que le corps, on ratait le
  // numéro, la demande de rappel et la date → aucun RDV calé, lead chaud perdu (cas Renov Habitat).
  // On analyse donc OBJET + CORPS pour toute la détection.
  const analysisText = `${subject}\n${cleanBody}`
  const phoneMatch = analysisText.match(/0[1-9]([\s. ]?\d{2}){4}/)
  const contactPhone = phoneMatch ? phoneMatch[0].replace(/[\s ]+/g, ' ').trim() : (contact?.phone ?? undefined)

  // RDV DÉJÀ CALÉ (confirmé) = job terminé → l'agent n'envoie plus rien (l'humain gère).
  const existRdv = contact?.id ? (await sql`SELECT scheduled_at FROM rdv WHERE contact_id = ${contact.id} AND status = 'confirmed' ORDER BY scheduled_at ASC LIMIT 1`) as Array<{ scheduled_at: string }> : []
  if (existRdv[0]?.scheduled_at) {
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, action: 'no_action_rdv_deja_cale', company: contact?.company ?? from })}::jsonb)`
    return { processed: true, classification: classification.classification }
  }

  // Créneau candidat (dispo + éventuelle date donnée par le prospect).
  let availabilityCfg: Awaited<ReturnType<typeof import('@/lib/availability').getAvailability>> | null = null
  let parsedDate: Date | null = null
  let candidateSlot: Date | null = null
  let candidateSlotStr: string | undefined
  let allowToday = false
  if (isRdv) {
    try {
      const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
      availabilityCfg = await getAvailability()
      // Date voulue : d'abord l'extraction du classifieur, sinon on parse DIRECTEMENT le corps du
      // message (le classifieur rate parfois "demain avant-midi" → il faut quand même caler au bon
      // moment). Le créneau retenu est TOUJOURS le plus tôt disponible à partir de là.
      parsedDate = (rawExtracted ? parseExtractedDate(rawExtracted) : null) ?? parseExtractedDate(analysisText)
      // Créneaux déjà occupés par un RDV confirmé → on ne double-book pas (sinon deux prospects
      // sur le même horaire, impossible à honorer pour le client).
      const busy = (await sql`SELECT scheduled_at FROM rdv WHERE status = 'confirmed' AND scheduled_at > NOW() - INTERVAL '1 day'`) as Array<{ scheduled_at: string }>
      // Le jour même n'est autorisé QUE si le prospect le demande explicitement.
      allowToday = /aujourd'?hui|ce soir|dans la journ[ée]e|maintenant|tout de suite|d[èe]s que possible/i.test(analysisText.replace(/[’‘`´]/g, "'"))
      candidateSlot = findNextAvailableSlot(parsedDate, availabilityCfg, busy.map(b => b.scheduled_at), allowToday)
      candidateSlotStr = fmtSlot(candidateSlot)
    } catch (e) {
      results.push(`calcul créneau échoué: ${String(e).slice(0, 60)}`)
    }
  }

  // RDV déjà PROPOSÉ (en attente du oui/non du prospect) ?
  const propRows = contact?.id ? (await sql`SELECT id, scheduled_at FROM rdv WHERE contact_id = ${contact.id} AND status = 'proposed' ORDER BY created_at DESC LIMIT 1`) as Array<{ id: string; scheduled_at: string }> : []
  const proposedExisting = propRows[0]

  let confirmSlotStr: string | undefined // créneau qu'on VIENT de caler → l'agent confirme brièvement
  let proposeSlotStr: string | undefined // créneau à PROPOSER (question oui/non)
  let confirmedAt: Date | null = null    // date réelle du RDV calé (pour la notif client)
  let bookedNow = false                  // on vient de passer 'confirmed' → notif client

  // ⚠️ Une carte blanche ("appelez-moi maintenant") qui porte une urgence temporelle NON compatible
  // avec le créneau DÉJÀ proposé (ex : proposé pour lundi, mais le message dit "maintenant"/"ce
  // matin") ne vaut PAS acceptation de ce créneau précis — le prospect exprime une urgence
  // nouvelle, pas un oui à une date qu'il n'a peut-être même plus en tête. Vécu : "vous pouvez
  // m'appeler dès maintenant" a confirmé silencieusement un créneau "lundi 9h" proposé plus tôt,
  // alors que la réponse envoyée au prospect PROPOSAIT toujours une nouvelle date (jamais un oui) —
  // le statut en base mentait par rapport au texte réellement envoyé, et excluait à tort ce
  // contact des relances de confirmation (cf. conversation-followups).
  const openCallConflitUrgence = (existing: { scheduled_at: string }) =>
    allowToday && !isSameUTCDay(new Date(existing.scheduled_at), new Date())

  if (proposedExisting) {
    if (parsedDate && candidateSlot) {
      // Le prospect donne une AUTRE date précise → accord sur cette date → on cale.
      await sql`UPDATE rdv SET scheduled_at = ${candidateSlot.toISOString()}, status = 'confirmed', incoming_reply_id = ${incomingReplyId} WHERE id = ${proposedExisting.id}`
      confirmSlotStr = candidateSlotStr; confirmedAt = candidateSlot; bookedNow = true
    } else if (isAffirmativeConfirmation(analysisText) || (isOpenCallRequest(analysisText) && !openCallConflitUrgence(proposedExisting))) {
      // "oui / ok / parfait", OU carte blanche SANS urgence incompatible ("appelez-moi quand vous
      // voulez") → on cale AU créneau proposé.
      await sql`UPDATE rdv SET status = 'confirmed', incoming_reply_id = ${incomingReplyId} WHERE id = ${proposedExisting.id}`
      confirmedAt = new Date(proposedExisting.scheduled_at); confirmSlotStr = fmtSlot(confirmedAt); bookedNow = true
    } else if (candidateSlot) {
      // Ni oui clair, ni date : refus / question / autre → on RE-propose un créneau (met à jour le proposé).
      await sql`UPDATE rdv SET scheduled_at = ${candidateSlot.toISOString()} WHERE id = ${proposedExisting.id}`
      proposeSlotStr = candidateSlotStr
    }
  } else if (isRdv && availabilityCfg && candidateSlot && contact?.id) {
    const openCall = isOpenCallRequest(analysisText)
    // ⚠️ Le prospect a demandé une URGENCE ("appelez-moi maintenant/dès que possible/ce matin")
    // MAIS le créneau calculé n'est PAS le jour même (le run cron traite le message avec un
    // décalage, "maintenant" est déjà passé) : on ne peut PAS honorer ce qui a été demandé. Cette
    // urgence-là n'est PAS un accord sur un créneau ultérieur que le prospect n'a jamais vu — le
    // confirmer silencieusement mentait par rapport à la réponse envoyée (qui, elle, PROPOSE
    // correctement "lundi 9h, ça vous va ?", une vraie question). Résultat vécu : RDV marqué
    // 'confirmed' en base pour un créneau jamais validé par le prospect, ce qui l'excluait à tort
    // de conversation-followups (aucune relance n'allait jamais chercher sa vraie confirmation).
    // Une carte blanche SANS urgence temporelle ("quand vous voulez", "à votre convenance") reste
    // auto-confirmée normalement : le prospect accepte alors VRAIMENT n'importe quel créneau.
    const urgenceNonHonoree = allowToday && !isSameUTCDay(candidateSlot, new Date())
    if (parsedDate || (openCall && !urgenceNonHonoree)) {
      // Soit il a donné une date précise, soit il a donné CARTE BLANCHE ("appelez-moi", "quand
      // vous voulez") ET le créneau retenu respecte bien ce qu'il a demandé. Dans les deux cas il
      // a dit oui à l'appel → on CALE au prochain créneau (pas de re-demande, sinon on perd le
      // lead et rien n'arrive en agenda).
      await sql`INSERT INTO rdv (contact_id, incoming_reply_id, scheduled_at, duration_min, status, notes)
        VALUES (${contact.id}, ${incomingReplyId}, ${candidateSlot.toISOString()}, ${availabilityCfg.slotDurationMin || 30}, 'confirmed', ${parsedDate ? 'RDV — créneau donné par le prospect.' : 'RDV — le prospect a demandé à être rappelé (carte blanche), calé au prochain créneau.'})`
      confirmSlotStr = candidateSlotStr; confirmedAt = candidateSlot; bookedNow = true
    } else {
      // Aucune date donnée → on PROPOSE un créneau (status 'proposed'), on NE cale PAS, aucune notif.
      await sql`INSERT INTO rdv (contact_id, incoming_reply_id, scheduled_at, duration_min, status, notes)
        VALUES (${contact.id}, ${incomingReplyId}, ${candidateSlot.toISOString()}, ${availabilityCfg.slotDurationMin || 30}, 'proposed', ${'Créneau proposé, en attente de confirmation du prospect.'})`
      proposeSlotStr = candidateSlotStr
    }
  }

  const history = contact?.id ? await buildHistory(contact.id) : undefined

  // Boîte qui suit la conversation (from_email du dernier envoi) → signature cohérente.
  let ownerBox: string | undefined
  if (contact?.id) {
    const ob = (await sql`SELECT from_email FROM email_queue WHERE contact_id = ${contact.id} AND status = 'sent' AND from_email IS NOT NULL ORDER BY sent_at DESC LIMIT 1`) as Array<{ from_email: string }>
    ownerBox = ob[0]?.from_email
  }

  const draftBody = await generateReplyResponse({
    classification: classification.classification,
    originalEmailBody,
    replyBody: cleanBody,
    contactName: contact?.name ?? from,
    contactCompany: contact?.company ?? from,
    contactCity: contact?.city ?? '',
    contactSector: contact?.sector ?? undefined,
    conversationHistory: history,
    proposedSlot: proposeSlotStr,     // créneau à PROPOSER en oui/non (pas encore accepté)
    existingRdvSlot: confirmSlotStr,  // créneau qu'on vient de CALER → confirmation brève
    contactPhone: isRdv ? contactPhone : undefined,
    fromEmail: ownerBox,
  })

  // Notif client UNIQUEMENT quand un RDV vient d'être réellement CALÉ (pas sur une simple proposition).
  let rdvHandled = false
  if (bookedNow && confirmSlotStr) {
    try {
      const exchangeSummary = buildExchangeSummary({
        originalEmailBody, replyBody: cleanBody, draftBody,
        contactName: contact?.name ?? from, contactCompany: contact?.company ?? from,
      })
      await sendRdvNotificationEmail({
        contactName: contact?.name ?? from, contactCompany: contact?.company ?? from,
        scheduledAt: confirmedAt ?? new Date(), googleMeetLink: null, calendarEventUrl: null, exchangeSummary,
        conversationUrl: `${BASE_URL}/conversations?contact=${contact?.id ?? ''}`,
      })
      rdvHandled = true
    } catch (rdvErr) {
      results.push(`RDV notif failed: ${String(rdvErr).slice(0, 60)}`)
      rdvHandled = true // le RDV est calé même si la notif échoue
    }
  }

  // ── Brouillon de réponse ──
  // ⚠️ KILL-SWITCH DE VALIDATION (incident LabegarIA : « les messages à valider partaient sans
  // mon accord »). Avant, la décision auto/validation appartenait ENTIÈREMENT au classifieur IA,
  // et le réglage `auto_reply_enabled` visible dans l'UI n'était lu NULLE PART (cf. leçon 59).
  // Il n'existait donc AUCUN moyen d'exiger une relecture humaine. Désormais : si
  // REQUIRE_VALIDATION=1 (env) ou agent_config.require_validation='true', TOUTE réponse passe en
  // 'pending' et attend une validation manuelle, quoi qu'en dise l'IA.
  const requireValidation = await (async () => {
    if (process.env.REQUIRE_VALIDATION === '1') return true
    try {
      const r = (await sql`SELECT value FROM agent_config WHERE key = 'require_validation' LIMIT 1`) as Array<{ value: string }>
      return String(r[0]?.value ?? '').toLowerCase() === 'true'
    } catch { return false }
  })()

  // ⚠️ GARDE-FOU ANTI-INVENTION (incident 31/07 : l'agent a répondu « mon numéro est le
  // 06 12 34 56 78 » — un numéro d'exemple halluciné — en AUTOMATIQUE à un vrai prospect).
  // Un prompt n'est pas un garde-fou : on RELIT le texte généré et, à la moindre donnée
  // factuelle non vérifiable (téléphone/lien/email/chiffre inventé, mot interdit), la réponse
  // ne part JAMAIS seule — elle bascule en validation humaine avec le motif.
  const invention = await detectInventedFacts(draftBody, { prospectPhone: contactPhone, prospectSite: contact?.website })
  if (invention.suspect) {
    await alertIndependent(
      'Reponse bloquee (donnee inventee)',
      `${contact?.company ?? from}\n${invention.details.join('\n')}`
    ).catch(() => {})
  }

  if (classification.action === 'auto_reply' && !requireValidation && !invention.suspect) {
    // L'agent répond seul → envoi programmé avec délai humain (4-12 min), envoyé par la Partie A.
    await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status, send_after) VALUES (${incomingReplyId}, ${draftBody}, 'scheduled', ${new Date(Date.now() + randomDelayMs()).toISOString()})`
  } else {
    // draft_for_validation → validation humaine
    await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status) VALUES (${incomingReplyId}, ${draftBody}, 'pending')`
    if (!rdvHandled) {
      await sendNotificationEmail({
        contactName: contact?.name ?? from, contactCompany: contact?.company ?? from,
        classification: classification.classification, replyBody: cleanBody, draftBody,
      })
    }
  }

  await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, classification: classification.classification, action: classification.action, company: contact?.company ?? from, hasDraft: true })}::jsonb)`
  return { processed: true, classification: classification.classification }
}

/** Historique chronologique complet d'une conversation (envoyés + reçus + réponses agent). */
async function buildHistory(contactId: string): Promise<Array<{ role: 'sent' | 'received'; body: string; date: string }>> {
  const items: Array<{ role: 'sent' | 'received'; body: string; ts: number }> = []
  try {
    const sent = (await sql`SELECT body, sent_at FROM email_queue WHERE contact_id = ${contactId} AND status = 'sent'`) as Array<{ body: string; sent_at: string | null }>
    for (const e of sent) if (e.body) items.push({ role: 'sent', body: e.body, ts: e.sent_at ? new Date(e.sent_at).getTime() : 0 })

    const received = (await sql`SELECT body, created_at FROM incoming_replies WHERE contact_id = ${contactId}`) as Array<{ body: string; created_at: string | null }>
    for (const r of received) if (r.body) items.push({ role: 'received', body: r.body, ts: r.created_at ? new Date(r.created_at).getTime() : 0 })

    const agent = (await sql`
      SELECT rd.body, rd.sent_at, rd.created_at
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      WHERE ir.contact_id = ${contactId} AND rd.status IN ('sent', 'scheduled', 'sending', 'pending')
    `) as Array<{ body: string; sent_at: string | null; created_at: string | null }>
    for (const a of agent) {
      const ts = a.sent_at ? new Date(a.sent_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0)
      if (a.body) items.push({ role: 'sent', body: a.body, ts })
    }
  } catch { /* non bloquant */ }
  return items
    .sort((x, y) => x.ts - y.ts)
    .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))
}

/** Annule les relances en file pour un email (statuts d'attente/envoi du moteur maison). */
async function cancelSteps(email: string): Promise<number> {
  try {
    const rows = await sql`
      -- ⚠️ Il y avait un LIMIT 1 ici. Un même prospect peut exister en PLUSIEURS fiches contacts
      -- (import répété, adresse retrouvée par deux chemins, casse différente) : sa désinscription
      -- n'annulait alors que la file d'UNE fiche, et il continuait de recevoir les mails de
      -- l'autre. Une opposition à moitié appliquée est une opposition non appliquée — c'est
      -- littéralement le motif de la plainte CNIL.
      -- Signalé par la session labegaria (5 cas de doublons mesurés chez elle), vérifié ici.
      UPDATE email_queue SET status = 'cancelled'
      WHERE contact_id IN (SELECT id FROM contacts WHERE LOWER(email) = LOWER(${email}))
        AND status IN ('pending', 'queued', 'queued_instantly', 'scheduled', 'sending')
      RETURNING id
    `
    return (rows as Array<{ id: string }>).length
  } catch { return 0 }
}

// ⚠️ La détection d'opt-out ET la détection des demandes RGPD vivent désormais dans `lib/rgpd.ts`
// (importées en haut de ce fichier) : elles doivent être IDENTIQUES partout où on lit une réponse,
// et testables isolément. L'ancienne copie locale ratait 8 formulations critiques sur 12
// (« supprimez mes données », « je porte plainte à la CNIL », « je m'oppose »…) — audit du 06/08.

/** Adresse technique (daemon/postmaster) qu'il ne faut JAMAIS blocklister comme un prospect. */
function isDaemonAddress(email: string): boolean {
  return /mailer-daemon|postmaster|no[-.]?reply|do[-.]?not[-.]?reply|bounce/i.test(email)
}

/**
 * 🚨 QUI EST VISÉ PAR CETTE DEMANDE D'ARRÊT ? — pas seulement celui qui écrit.
 *
 * ⚠️ INCIDENT 04→09/08/2026. Un prospect écrit « SUPPRIMER contact@france-valley.com de toutes vos
 * listes » puis « Stop », depuis SON adresse nominative guillaume.toussaint@france-valley.com.
 * Le code blocklistait l'expéditeur et cherchait le contact « dont l'email = expéditeur » : ce
 * contact n'existait pas, donc `cancelSteps` n'annulait RIEN. L'adresse réellement démarchée a reçu
 * deux relances de plus, trois autres étaient programmées. Deux « Stop » explicites, ignorés.
 *
 * Celui qui ÉCRIT n'est pas celui qu'on DÉMARCHE : une boîte générique (contact@, info@, accueil@)
 * est relevée par un humain qui répond avec son adresse nominative. C'est le cas le PLUS courant en
 * B2B, et c'était l'angle mort. On réunit donc trois sources :
 *   1. l'expéditeur ;
 *   2. toute adresse CITÉE dans le message (« supprimez X ») ;
 *   3. tout contact de notre base partageant le DOMAINE professionnel de l'expéditeur.
 * Le point 3 est exclu sur les domaines grand public (deux gmail n'ont aucun lien).
 */
/**
 * ⚠️ INCIDENT DU 12/08/2026 — LE REFUS D'UN PROSPECT N'A PAS ARRÊTÉ SA SÉQUENCE.
 *
 * Un plombier de Brest répond « NO WAY ! » le 11 août. Le système le classe correctement
 * (« désintérêt ») et le blockliste. Une relance part quand même le 12.
 *
 * Cause : il a répondu depuis son adresse PERSONNELLE (yahoo.fr), alors qu'on écrivait à l'adresse
 * PROFESSIONNELLE de son entreprise. On a donc blocklisté le particulier et annulé la file du
 * particulier — qui n'a jamais eu de file. Le contact démarché, lui, n'a rien vu passer.
 *
 * Le plus rageant : le poller SAVAIT de qui il s'agissait. Il retrouve le contact par le sujet du
 * fil (`contactHint`) pour ne pas jeter la réponse. Cette information n'était simplement pas
 * transmise ici. L'extension par domaine ne pouvait pas compenser : yahoo.fr est une messagerie
 * grand public, volontairement exclue (sinon un refus depuis gmail bloquerait tous les prospects
 * en @gmail.com).
 *
 * RÈGLE : l'arrêt vise la PERSONNE ET LE CONTACT DÉMARCHÉ, jamais la seule adresse d'expédition.
 * `contactEmail` est donc OBLIGATOIRE dans le raisonnement, même quand il diffère de `from`.
 */
async function ciblesArret(from: string, corps: string, contactEmail?: string | null): Promise<string[]> {
  const cibles = new Set<string>([from.toLowerCase()])
  if (contactEmail) cibles.add(contactEmail.toLowerCase())
  try {
    const { adressesCiteesDansLeMessage, domaineExploitable } = await import('@/lib/rgpd')
    for (const a of adressesCiteesDansLeMessage(corps, ['hdigiweb.fr', 'hdigiweb-agence.com', 'hdigiweb-digital.com', 'hdigiweb.com'])) {
      cibles.add(a)
    }
    const dom = domaineExploitable(from)
    if (dom) {
      const rows = (await sql`
        SELECT LOWER(email) AS email FROM contacts WHERE LOWER(email) LIKE ${'%@' + dom}
      `) as Array<{ email: string }>
      for (const r of rows) cibles.add(r.email)
    }
  } catch { /* au pire on ne traite que l'expéditeur — jamais moins */ }
  return [...cibles].filter(e => e && !isDaemonAddress(e))
}

/**
 * Annulation par identifiant de contact — indispensable quand le prospect répond depuis une AUTRE
 * adresse que celle démarchée : `cancelSteps(email)` ne trouve alors aucune fiche à couper.
 */
async function cancelStepsParContactId(contactId: string): Promise<number> {
  try {
    const rows = await sql`
      UPDATE email_queue SET status = 'cancelled'
      WHERE contact_id = ${contactId}
        AND status IN ('pending', 'queued', 'queued_instantly', 'scheduled', 'sending')
      RETURNING id
    `
    return (rows as Array<{ id: string }>).length
  } catch { return 0 }
}

/** Ajoute une adresse à la blocklist SANS créer de doublon (la table n'a pas de contrainte unique). */
async function blocklistOnce(email: string, reason: string): Promise<void> {
  try {
    await sql`
      INSERT INTO blocklist (email, reason)
      SELECT ${email}, ${reason}
      WHERE NOT EXISTS (SELECT 1 FROM blocklist WHERE LOWER(email) = LOWER(${email}))
    `
  } catch { /* non bloquant */ }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms)),
  ])
}

// ─── Détection de bounce (échec de remise) ───
function isBounceMessage(from: string, subject: string): boolean {
  const f = from.toLowerCase()
  if (/mailer-daemon|postmaster|mail\.?delivery|no[-.]?reply@.*(google|gmail)/.test(f)) return true
  const s = subject.toLowerCase()
  return /delivery status|undeliverable|mail delivery failed|returned mail|delivery failure|delivery has failed|échec.*remise|non distribu|adresse introuvable|address not found/i.test(s)
}

// ─── Extraction texte lisible d'un message RFC 2822 (ReDoS-safe) ───
function extractPlainText(raw: string): string {
  if (!raw) return ''
  function decodePart(content: string, encoding: string): string {
    const enc = encoding.toLowerCase().trim()
    if (enc === 'base64') {
      try { return Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('utf-8') } catch { return content }
    }
    if (enc === 'quoted-printable') {
      return decodeQuotedPrintable(content) // décodage correct multi-octets UTF-8
    }
    return content
  }
  function stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ').trim()
  }
  const headerEnd = raw.search(/\r?\n\r?\n/)
  const headerZone = headerEnd > 0 ? raw.slice(0, headerEnd) : raw.slice(0, 4000)
  const isMultipart = /Content-Type:\s*multipart\//i.test(headerZone)
  const bMatch = isMultipart ? headerZone.match(/boundary="?([^"\r\n;]+)"?/i) : null
  if (bMatch) {
    const boundary = bMatch[1].trim()
    const parts = raw.split(new RegExp('--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?'))
    let textPlain: string | null = null, textHtml: string | null = null
    for (const part of parts) {
      if (!part.trim() || part.trim() === '--') continue
      const sepIdx = part.search(/\r?\n\r?\n/)
      if (sepIdx === -1) continue
      const partHeaders = part.slice(0, sepIdx)
      const partBody = part.slice(sepIdx).replace(/^\r?\n/, '')
      const ctMatch = partHeaders.match(/Content-Type:\s*([^\s;]+)/i)
      const cteMatch = partHeaders.match(/Content-Transfer-Encoding:\s*([^\s\r\n]+)/i)
      const ct = ctMatch ? ctMatch[1].toLowerCase() : ''
      const cte = cteMatch ? cteMatch[1] : '7bit'
      if (ct === 'text/plain' && textPlain === null) textPlain = decodePart(partBody, cte)
      else if (ct === 'text/html' && textHtml === null) textHtml = decodePart(partBody, cte)
    }
    if (textPlain) return textPlain.trim()
    if (textHtml) return stripHtml(textHtml)
  }
  const sepIdx = raw.search(/\r?\n\r?\n/)
  if (sepIdx !== -1) {
    const headers = raw.slice(0, sepIdx)
    const bodyRaw = raw.slice(sepIdx).replace(/^\r?\n/, '')
    const cteMatch = headers.match(/Content-Transfer-Encoding:\s*([^\s\r\n]+)/i)
    const ctMatch = headers.match(/Content-Type:\s*([^\s;]+)/i)
    const cte = cteMatch ? cteMatch[1] : '7bit'
    const ct = ctMatch ? ctMatch[1].toLowerCase() : 'text/plain'
    const decoded = decodePart(bodyRaw, cte)
    if (ct === 'text/html') return stripHtml(decoded)
    return decoded.replace(/\s+/g, ' ').trim()
  }
  return stripHtml(raw)
}

function extractOriginalRecipient(body: string): string | null {
  const match = body.match(/Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)
    ?? body.match(/Original-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i)
    ?? body.match(/To:\s*([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/i)
  if (match) return match[1].trim().toLowerCase().replace(/[<>.,;)\]]+$/, '')
  // Fallback : 1re adresse du corps qui n'est ni un daemon ni notre propre domaine.
  const emails = body.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) ?? []
  for (const e of emails) {
    const el = e.toLowerCase().replace(/[<>.,;)\]]+$/, '')
    if (!isDaemonAddress(el) && !el.includes('hdigiweb') && !el.includes('google') && !el.includes('gmail')) return el
  }
  return null
}

// ─── Capture d'un changement d'adresse dans la réponse ───
function extractNewEmail(text: string, currentEmail: string): string | null {
  const changeIntent = /(chang\w*\s+d['’]?adresse|nouvelle\s+adresse|nouveau\s+(mail|email)|nouvel\s+(email|e-mail)|contactez[-\s]?(moi|nous)\s+(à|au|sur)|écrivez[-\s]?(moi|nous)|mon\s+(nouveau\s+|nouvel\s+)?(mail|email|adresse)|à\s+cette\s+adresse|utilisez\s+plut[oô]t|désormais\s+à|dorénavant)/i.test(text)
  if (!changeIntent) return null
  const emails = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) ?? []
  const cur = (currentEmail ?? '').toLowerCase()
  for (const e of emails) {
    const el = e.toLowerCase().replace(/[.,;)\]]+$/, '')
    if (el !== cur && !isFakeEmail(el) && !el.includes('hdigiweb') && !el.includes('@instantly')) return el
  }
  return null
}

// ─── Absence : extrait la date de RETOUR d'un message d'absence (oof) ───
// "fermé jusqu'au 15 juillet" → relance le 16 ; "de retour le 16" → relance le 16.
const MOIS_FR: Record<string, number> = { janvier: 0, 'février': 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, 'août': 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, 'décembre': 11, decembre: 11 }
/**
 * ⚠️ RÉÉCRIT LE 15/08/2026 APRÈS MESURE SUR LES VRAIS MESSAGES D'ABSENCE REÇUS.
 *
 * L'ancienne version prenait le PREMIER marqueur trouvé. Testée sur 9 absences réelles : 5 dates
 * extraites, et l'une d'elles fausse D'UN AN.
 *
 * Le cas qui a tout révélé : « fermera à partir du 03 août […] Notre reprise est prévue au
 * 31 août ». Elle a saisi « à partir du 03 août » — qui est la date de DÉPART en congés, pas du
 * retour — puis, constatant que le 3 août était passé, l'a repoussée à… août 2027. Les relances
 * de ce prospect partaient dans un an. Silencieusement : aucune erreur, aucun compteur, juste un
 * lead évaporé.
 *
 * Une date fausse est bien pire qu'une absence de date : sans date, la séquence continue et le
 * prospect reçoit une relance un peu tôt ; avec une date fausse, il n'est jamais recontacté.
 *
 * TROIS CHANGEMENTS :
 *  1. on collecte TOUTES les dates candidates et on retient la PLUS TARDIVE — dans un texte
 *     d'absence, la dernière date mentionnée est la reprise ;
 *  2. les plages « du 8 au 24 août » sont comprises (l'ancienne version les ignorait : 3 des
 *     4 échecs venaient de là) ;
 *  3. FENÊTRE DE PLAUSIBILITÉ de 120 jours. Au-delà, on renonce plutôt que de deviner. C'est ce
 *     garde-fou qui aurait évité le décalage d'un an.
 */
function extractReturnDate(text: string, now: Date): Date | null {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ')
  const MOIS = '(janvier|f[ée]vrier|fevrier|mars|avril|mai|juin|juillet|ao[uû]t|aout|septembre|octobre|novembre|d[ée]cembre|decembre)'
  const candidats: Date[] = []

  /** Construit une date à partir d'un jour et d'un mois éventuel, en restant dans le futur proche. */
  const bâtir = (jour: number, moisTxt?: string, moisNum?: string): Date | null => {
    if (!(jour >= 1 && jour <= 31)) return null
    let mois = now.getMonth()
    if (moisNum) mois = parseInt(moisNum, 10) - 1
    else if (moisTxt) mois = MOIS_FR[moisTxt] ?? mois
    let d = new Date(now.getFullYear(), mois, jour, 9, 0, 0, 0)
    // Une date de quelques jours dans le passé reste crédible (message reçu la veille) ; au-delà,
    // c'est le mois suivant — jamais l'année suivante, qui n'a aucun sens pour un congé.
    if (d.getTime() < now.getTime() - 3 * 86400000) d = new Date(now.getFullYear(), mois + 1, jour, 9, 0, 0, 0)
    return d
  }

  // 1) PLAGES : « du 8 au 24 août », « du 1er août au 31 août ». La FIN de la plage est le dernier
  //    jour d'absence → le retour est le lendemain.
  const plage = new RegExp(`du\\s+(\\d{1,2})(?:er)?\\s*(?:${MOIS})?\\s+(?:au|jusqu'?au)\\s+(\\d{1,2})(?:er)?\\s*(?:${MOIS})?`, 'g')
  // ⚠️ ATTENTION AUX INDICES : la constante MOIS contient elle-même un groupe capturant, donc
  // chaque `(?:${MOIS})?` inséré DÉCALE la numérotation. Ici : 1 = jour de début, 2 = mois de
  // début, 3 = jour de fin, 4 = mois de fin. Mon premier essai lisait m[2] comme jour de fin et
  // ratait les deux plages du jeu de test — un décalage d'indice ne lève aucune erreur, il rend
  // juste un résultat faux.
  for (const m of t.matchAll(plage)) {
    const d = bâtir(parseInt(m[3], 10), m[4] ?? m[2])
    if (d) { d.setDate(d.getDate() + 1); candidats.push(d) }
  }

  // 2) MARQUEURS DE RETOUR explicites. « à partir du » est VOLONTAIREMENT ABSENT : dans un message
  //    d'absence il annonce presque toujours le départ, pas la reprise.
  const retour = new RegExp(
    `(?:de retour(?: le| a partir du| à partir du)?|retour le|reprise (?:est )?(?:pr[ée]vue )?(?:le|au)|r[ée]ouverture le|reprenons(?: du service)? le|reprend(?:s|rai|rons)?(?: du service)? le|jusqu'?\\s*(?:au|à))` +
    `\\s+(?:lundi |mardi |mercredi |jeudi |vendredi |samedi |dimanche )?(\\d{1,2})(?:er)?(?:\\s*[\\/.]\\s*(\\d{1,2}))?\\s*(?:${MOIS})?`, 'g')
  for (const m of t.matchAll(retour)) {
    const d = bâtir(parseInt(m[1], 10), m[3], m[2])
    if (!d) continue
    if (/jusqu/.test(m[0])) d.setDate(d.getDate() + 1) // « jusqu'au 15 » → on repart le 16
    candidats.push(d)
  }

  if (!candidats.length) return null

  // La reprise est la date la plus tardive du message.
  const choisie = candidats.reduce((a, b) => (b.getTime() > a.getTime() ? b : a))

  // ⚠️ FENÊTRE DE PLAUSIBILITÉ. Un congé se compte en semaines ; au-delà de 120 jours on a mal lu,
  // et décaler les relances de plusieurs mois équivaut à perdre le prospect.
  const jours = (choisie.getTime() - now.getTime()) / 86400000
  if (jours < -1 || jours > 120) return null
  return choisie
}

// ─── Filtre langue : garde tout vrai prospect FR, ne saute que du warmup anglais évident ───
function isLikelyFrench(text: string): boolean {
  const lower = text.toLowerCase()
  if (/[àâéèêëîïôùûüçœæ]/.test(lower)) return true
  if (/0[1-9]([\s.]?\d{2}){4}/.test(text)) return true
  const frenchWords = ['bonjour', 'merci', 'vous', 'nous', 'pour', 'avec', 'salut', 'rappel',
    'cordialement', 'madame', 'monsieur', 'bonne', 'votre', 'notre', 'appel',
    'bien', 'aussi', 'mais', 'comme', 'dans', 'alors', 'donc', 'rdv',
    'oui', 'non', 'devis', 'travaux', 'toiture', 'couverture', 'site', 'prix']
  if (frenchWords.some(w => lower.includes(w))) return true
  const wordCount = lower.trim().split(/\s+/).filter(Boolean).length
  if (wordCount <= 4) return true
  const englishMarkers = ['the', 'please', 'meeting', 'regards', 'thanks', 'thank you',
    'let me know', 'schedule', 'available', 'hello', 'hi ', 'looking forward', 'best ', 'great ']
  return englishMarkers.filter(w => lower.includes(w)).length < 2
}

// ─── Parse d'une date FR relative en Date (heure murale Paris) ───
function parseExtractedDate(dateStr: string): Date | null {
  const direct = new Date(dateStr)
  if (!isNaN(direct.getTime()) && direct.getFullYear() > 2020) return toParisWallClock(direct)
  const now = toParisWallClock()
  const lower = dateStr.toLowerCase()
  const setHourFromText = (d: Date) => {
    const hm = lower.match(/(\d{1,2})\s*h\s*(\d{0,2})/)
    if (hm) { d.setHours(parseInt(hm[1]), parseInt(hm[2] || '0'), 0, 0); return }
    if (/fin de journ[ée]e|fin d'?apr[èe]s-?midi|ce soir|en soir[ée]e/.test(lower)) { d.setHours(17, 0, 0, 0); return }
    if (/d[ée]but d'?apr[èe]s-?midi|d[ée]but apr[èe]s-?midi/.test(lower)) { d.setHours(14, 0, 0, 0); return }
    if (/matin|matin[ée]e|avant[- ]?midi|dans la matin/.test(lower)) { d.setHours(9, 30, 0, 0); return }
    if (/apr[èe]s-?midi/.test(lower)) { d.setHours(15, 0, 0, 0); return }
    if (/midi/.test(lower)) { d.setHours(12, 0, 0, 0); return }
    // DÉFAUT = matin. Avant c'était 17h (fin de journée) : un prospect qui écrit juste "à demain"
    // se retrouvait calé en fin d'après-midi alors que l'agent lui avait répondu "demain matin"
    // → promesse non tenue. On veut toujours le créneau le PLUS TÔT.
    d.setHours(9, 30, 0, 0)
  }
  if (/aujourd'?hui|ce soir|fin de journ[ée]e|en soir[ée]e/.test(lower) && !/demain/.test(lower)) {
    const d = new Date(now); setHourFromText(d); return d
  }
  if (/demain/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); setHourFromText(d); return d
  }
  const dayMap: Record<string, number> = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 }
  for (const [day, dayNum] of Object.entries(dayMap)) {
    if (lower.includes(day)) {
      const target = new Date(now)
      const currentDay = target.getDay()
      let daysUntil = dayNum - currentDay
      if (daysUntil <= 0) daysUntil += 7
      target.setDate(target.getDate() + daysUntil)
      const hourMatch = lower.match(/(\d{1,2})h(\d{0,2})/)
      if (hourMatch) target.setHours(parseInt(hourMatch[1]), parseInt(hourMatch[2] || '0'), 0, 0)
      else if (lower.includes('matin')) target.setHours(9, 0, 0, 0)
      else if (lower.includes('après-midi') || lower.includes('apres-midi')) target.setHours(14, 0, 0, 0)
      else target.setHours(10, 0, 0, 0)
      return target
    }
  }
  return null
}

// Formate un créneau en français lisible ("mardi 21 juillet à 12:00").
function fmtSlot(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Même jour calendaire (UTC, cohérent avec le stockage des scheduled_at). Sert à détecter quand
// une demande d'urgence ("appelez-moi maintenant") n'a PAS pu être honorée le jour même — le
// créneau calculé a glissé à un jour ultérieur que le prospect n'a jamais explicitement accepté.
function isSameUTCDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

// Le prospect donne-t-il CARTE BLANCHE pour l'appel ? ("appelez-moi", "quand vous voulez",
// "vous pouvez me contacter", + souvent son numéro) SANS préciser d'heure.
// Dans ce cas il a déjà dit oui à l'appel : on CALE directement au prochain créneau (demain)
// au lieu de re-demander une dispo. Avant, l'agent se contentait de proposer → aucun RDV en
// agenda, aucune notif client, et le lead chaud restait invisible (cas Renov Habitat).
function isOpenCallRequest(text: string): boolean {
  // ⚠️ On NORMALISE les apostrophes courbes (’ ‘ `) en apostrophe droite : les mails envoyés depuis
  // iPhone/Outlook utilisent ’, et toutes les regex écrites avec ' échouaient silencieusement
  // (cas Renov Habitat : "veiller m’appeler" jamais détecté → aucun RDV calé).
  const t = (text || '').toLowerCase().replace(/[’‘`´]/g, "'")
  if (/\b(non|pas maintenant|plus tard|rappelez plus tard|arr[êe]tez)\b/.test(t)) return false
  return /(appel(ez|e|er)[- ]?moi|rappel(ez|e|er)[- ]?moi|veuillez m'?appeler|veiller m'?appeler|me contacter|contactez[- ]?moi|joignez[- ]?moi|vous pouvez m'?appeler|quand vous (voulez|voudrez|le souhaitez|souhaitez)|[àa] votre convenance|n'?importe quand|quand [çc]a vous arrange|je suis (dispo|disponible|joignable)|(pouvez|pourriez|peux|peut)[- ]?(vous|tu)?\s*m'?(appeler|e (rappeler|contacter|joindre))|possible de m'?(appeler|e (rappeler|contacter))|j'?(aimerais|souhaite|voudrais) (qu'?on m'?appelle|[êe]tre (rappel[ée]|contact[ée])))/.test(t)
}

// Le prospect confirme-t-il un créneau proposé ? ("oui", "ok", "parfait", "ça marche"...).
// Message COURT + marqueur positif + AUCUN marqueur négatif ("non", "pas", "plutôt", "annul").
function isAffirmativeConfirmation(text: string): boolean {
  const t = (text || '').trim().toLowerCase().replace(/[’‘`´]/g, "'") // apostrophes courbes normalisées
  if (!t || t.length > 140) return false
  if (/\b(non|pas|plut[oô]t|impossible|ne peux|ne pourrai|annul|autre (jour|moment|cr[ée]neau)|d[ée]cal)/.test(t)) return false
  return /\b(oui|ouais|ok|okay|d'?accord|parfait|nickel|impec(cable)?|ça marche|ca marche|ça me va|ca me va|ça (me )?convient|ca (me )?convient|c'?est bon|c'?est parfait|tr[eè]s bien|volontiers|avec plaisir|je confirme|convient|top|banco|allons-?y|allez-?y|entendu|ça roule|ca roule)\b/.test(t)
}

function buildExchangeSummary(params: {
  originalEmailBody: string; replyBody: string; draftBody: string; contactName: string; contactCompany: string
}): string {
  return `=== RÉSUMÉ DE L'ÉCHANGE ===

PROSPECT : ${params.contactName} (${params.contactCompany})

EMAIL ENVOYÉ :
${params.originalEmailBody.substring(0, 500)}${params.originalEmailBody.length > 500 ? '...' : ''}

RÉPONSE DU PROSPECT :
${params.replyBody.substring(0, 500)}${params.replyBody.length > 500 ? '...' : ''}

DRAFT DE RÉPONSE PRÉPARÉ :
${params.draftBody.substring(0, 300)}${params.draftBody.length > 300 ? '...' : ''}

=== FIN DU RÉSUMÉ ===`
}

// Destinataires de notif : PRIORITÉ au champ UI (agent_config.client_notif_email, réglé dans
// l'écran Agent) → sinon l'env CLIENT_NOTIFY_EMAIL. AVANT : on lisait UNIQUEMENT l'env, donc
// changer l'adresse dans l'UI ne changeait rien et le client ne recevait pas les notifs.
async function getNotifyRecipients(): Promise<string[]> {
  try {
    const r = (await sql`SELECT value FROM agent_config WHERE key = 'client_notif_email' LIMIT 1`) as Array<{ value: string }>
    const fromUi = (r[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (fromUi.length > 0) return fromUi
  } catch { /* table/clé absente → repli env */ }
  return CLIENT_NOTIFY_EMAIL
}

// Envoie une notif interne SOBRE (texte, zéro émoji) via le moteur Gmail SMTP —
// pas de limite "mode test" comme Resend, donc TOUS les destinataires reçoivent.
// Repli sur Resend (par destinataire) si aucune boîte Gmail configurée.
async function notifyTeam(subject: string, text: string): Promise<void> {
  const recipients = await getNotifyRecipients()
  if (recipients.length === 0) return
  const boxes = getGmailBoxes()
  if (boxes.length > 0) {
    for (const to of recipients) {
      await sendFromBox(boxes[0], { to, subject, text, senderName: 'Agent Hdigiweb' }).catch(() => {})
    }
    return
  }
  // Repli Resend : 1 envoi PAR destinataire (mode test = seul l'owner reçoit, mais au moins lui).
  if (!RESEND_API_KEY) return
  for (const to of recipients) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
        to, subject, text,
      }),
    }).catch(() => {})
  }
}

async function sendRdvNotificationEmail(params: {
  contactName: string; contactCompany: string; scheduledAt: Date
  googleMeetLink: string | null; calendarEventUrl: string | null; exchangeSummary: string; conversationUrl?: string
}) {
  const dateStr = params.scheduledAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = params.scheduledAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const text = [
    `${params.contactName || params.contactCompany} (${params.contactCompany}) a demandé un rendez-vous.`,
    `Quand : ${dateStr} à ${timeStr} (30 min)`,
    params.conversationUrl ? `Conversation : ${params.conversationUrl}` : '',
    ``,
    `Résumé de l'échange :`,
    params.exchangeSummary || '(résumé indisponible)',
    ``,
    `Agenda : https://agent-couvreurs.vercel.app/agenda`,
  ].join('\n')
  await notifyTeam(`Nouveau rendez-vous — ${params.contactCompany}`, text)
}

async function sendNotificationEmail(params: {
  contactName: string; contactCompany: string; classification: string; replyBody: string; draftBody: string
}) {
  const text = [
    `De : ${params.contactName} (${params.contactCompany})`,
    `Classification : ${params.classification}`,
    ``,
    `Message reçu :`,
    params.replyBody,
    ``,
    `Réponse proposée :`,
    params.draftBody,
    ``,
    `Valider / modifier : ${BASE_URL}/reponses-a-valider`,
  ].join('\n')

  /**
   * GARDE-FOU « LE CLIENT NE REÇOIT JAMAIS DE JURIDIQUE ».
   *
   * La branche légale traite normalement ces messages en amont, vers l'opérateur seul. Mais si une
   * demande RGPD ou une plainte CNIL passe entre les mailles de la détection, elle finit en
   * « réponse à valider » — et `notifyTeam`, c'est le canal CLIENT. Haris recevrait donc une mise en
   * demeure adressée à notre traitement de données.
   *
   * On re-teste ici, en dernier rideau : tout ce qui sent le juridique part vers l'OPÉRATEUR
   * (alertIndependent → ntfy + ALERT_EMAIL) et s'arrête là. Une détection en double coûte un test ;
   * une fuite coûte la confiance du client et une réponse légale hors délai.
   */
  try {
    const { isRgpdRequestOrComplaint } = await import('@/lib/rgpd')
    if (isRgpdRequestOrComplaint(params.replyBody).match) {
      const { alertIndependent } = await import('@/lib/alert')
      await alertIndependent(`Message juridique a verifier — ${params.contactCompany}`, text)
      return
    }
  } catch { /* détection indisponible → on retombe sur la notification standard */ }

  await notifyTeam(`Réponse à valider — ${params.contactCompany}`, text)
}

function normalizeBody(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

