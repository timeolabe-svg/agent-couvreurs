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
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { sendReplyEmail } from '@/lib/reply-agent/send-reply'
import { isFakeEmail } from '@/lib/fake-email'
import { toParisWallClock } from '@/lib/availability'
import { cleanIncomingBody, decodeQuotedPrintable } from '@/lib/decode-body'

// Client SQL brut, assigné dynamiquement dans le handler (évite d'évaluer neon()
// au build, où DATABASE_URL est absent — cause d'échec de "collect page data").
let sql!: NeonQueryFunction<false, false>

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GLOBAL_DEADLINE_MS = 23_000 // cron-job.org (gratuit) coupe à 30s → on répond AVANT (23s + 6s/boîte max ≈ 29s)
const PER_BOX_TIMEOUT_MS = 6_000
const MAX_MSGS_PER_BOX = 180  // le warmup remplit vite la boîte : à 70, une vraie réponse un peu ancienne (ex. répondue tôt puis noyée sous le warmup) sortait de la fenêtre et n'était jamais lue. On élargit.
const LOOKBACK_HOURS = 72     // marge de sécurité : si le cron saute une nuit/journée, on ne rate pas la réponse (dédup Message-ID = pas de retraitement)

const CLIENT_NOTIFY_EMAIL = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr')
  .split(',').map(s => s.trim()).filter(Boolean)
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'
const RESEND_API_KEY = process.env.RESEND_API_KEY

function randomDelayMs(): number {
  return (4 + Math.floor(Math.random() * 9)) * 60 * 1000 // 4-12 min
}

export async function GET(req: NextRequest) { return POST(req) }

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
    const ready = (await sql`
      SELECT rd.id AS draft_id, rd.body, rd.incoming_reply_id
      FROM reply_drafts rd
      WHERE rd.status = 'scheduled' AND rd.send_after <= NOW()
      LIMIT 6
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
          results.push(`✗ auto-réponse KO (${d.draft_id}): ${(r.error ?? '').slice(0, 80)}`)
        }
      } catch (e) {
        results.push(`✗ auto-réponse erreur (${d.draft_id}): ${String(e).slice(0, 80)}`)
      }
    }
  } catch (e) {
    results.push(`Partie A erreur: ${String(e).slice(0, 80)}`)
  }

  // ── Partie B : lecture IMAP des boîtes + traitement des nouvelles réponses ──
  // Rotation de l'ordre des boîtes à chaque run (toutes les 10 min) : avec un budget
  // serré (<30s), on ne lit pas forcément les 4 boîtes en un run → on tourne l'ordre
  // pour qu'aucune boîte ne soit jamais oubliée. La dédup Message-ID évite tout doublon.
  const rot = Math.floor(Date.now() / 600_000) % boxes.length
  const orderedBoxes = boxes.slice(rot).concat(boxes.slice(0, rot))
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

  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000)
      // TOUS les messages récents (plus seulement les non-lus) : une réponse OUVERTE dans Gmail
      // (marquée "lue") était ratée par seen:false. Dédup par Message-ID + filtre "vrai contact"
      // (le warmup vient d'adresses tierces → ignoré sans coût IA).
      const found = await client.search({ since })
      // Du PLUS RÉCENT au plus ancien : une vraie réponse récente (ex. BJM) doit être traitée AVANT
      // que le budget temps (30s cron / 6s par boîte) ne coupe. Avant, on traitait les vieux d'abord
      // et on timeoutait avant d'atteindre les messages récents → réponse jamais lue.
      const uids = (Array.isArray(found) ? found : []).slice(-MAX_MSGS_PER_BOX).reverse()
      results.push(`[${box.email}] ${uids.length} messages récents`)

      for (const uid of uids) {
        if (Date.now() - started > GLOBAL_DEADLINE_MS) { results.push(`⏱ budget atteint pendant ${box.email}`); break }
        // Enveloppe d'abord (léger) → on filtre avant de télécharger le corps.
        let env
        try { env = await client.fetchOne(uid, { envelope: true }) } catch { continue }
        if (!env || !env.envelope) continue
        const from = (env.envelope.from?.[0]?.address ?? '').toLowerCase()
        const subject = env.envelope.subject ?? ''
        const messageId = env.envelope.messageId ?? `imap-${box.email}-${uid}`
        if (!from) continue

        // Dédup par Message-ID : déjà traité ? on saute (jamais de 2e réponse).
        const already = (await sql`SELECT 1 FROM incoming_replies WHERE instantly_reply_id = ${'imap:' + messageId} LIMIT 1`) as Array<unknown>
        if (already.length > 0) { await client.messageFlagsAdd({ uid }, ['\\Seen']).catch(() => {}); continue }

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
        const known = (await sql`SELECT 1 FROM contacts WHERE LOWER(email) = LOWER(${from}) LIMIT 1`) as Array<unknown>
        let contactHint: string | undefined
        if (known.length === 0) {
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
              stats.cancelled += await cancelSteps(from)
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
  type Contact = { id: string; email: string; name: string | null; company: string | null; city: string | null; sector: string | null; phone: string | null }
  const contactRows = contactHint
    ? (await sql`SELECT id, email, name, company, city, sector, phone FROM contacts WHERE id = ${contactHint} LIMIT 1`) as Contact[]
    : (await sql`SELECT id, email, name, company, city, sector, phone FROM contacts WHERE LOWER(email) = LOWER(${from}) LIMIT 1`) as Contact[]
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
    await blocklistOnce(from, 'unsubscribe')
    if (contact?.id) await cancelSteps(from)
    await sql`INSERT INTO dashboard_events (type, data) VALUES ('reply_received', ${JSON.stringify({ contactEmail: from, action: 'blocklist', reason: 'opt-out explicite', company: contact?.company ?? from })}::jsonb)`
    results.push(`⛔ opt-out explicite → blocklist ${from}`)
    return { processed: true, classification: 'desinterest' }
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
      const allowToday = /aujourd'?hui|ce soir|dans la journ[ée]e|maintenant|tout de suite|d[èe]s que possible/i.test(analysisText.replace(/[’‘`´]/g, "'"))
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

  if (proposedExisting) {
    if (parsedDate && candidateSlot) {
      // Le prospect donne une AUTRE date précise → accord sur cette date → on cale.
      await sql`UPDATE rdv SET scheduled_at = ${candidateSlot.toISOString()}, status = 'confirmed', incoming_reply_id = ${incomingReplyId} WHERE id = ${proposedExisting.id}`
      confirmSlotStr = candidateSlotStr; confirmedAt = candidateSlot; bookedNow = true
    } else if (isAffirmativeConfirmation(analysisText) || isOpenCallRequest(analysisText)) {
      // "oui / ok / parfait", OU carte blanche ("appelez-moi quand vous voulez") → on cale AU créneau proposé.
      await sql`UPDATE rdv SET status = 'confirmed', incoming_reply_id = ${incomingReplyId} WHERE id = ${proposedExisting.id}`
      confirmedAt = new Date(proposedExisting.scheduled_at); confirmSlotStr = fmtSlot(confirmedAt); bookedNow = true
    } else if (candidateSlot) {
      // Ni oui clair, ni date : refus / question / autre → on RE-propose un créneau (met à jour le proposé).
      await sql`UPDATE rdv SET scheduled_at = ${candidateSlot.toISOString()} WHERE id = ${proposedExisting.id}`
      proposeSlotStr = candidateSlotStr
    }
  } else if (isRdv && availabilityCfg && candidateSlot && contact?.id) {
    const openCall = isOpenCallRequest(analysisText)
    if (parsedDate || openCall) {
      // Soit il a donné une date précise, soit il a donné CARTE BLANCHE ("appelez-moi", "quand
      // vous voulez"). Dans les deux cas il a dit oui à l'appel → on CALE au prochain créneau
      // (pas de re-demande, sinon on perd le lead et rien n'arrive en agenda).
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
  if (classification.action === 'auto_reply') {
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
      WHERE ir.contact_id = ${contactId} AND rd.status IN ('sent', 'scheduled', 'pending')
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
      UPDATE email_queue SET status = 'cancelled'
      WHERE contact_id = (SELECT id FROM contacts WHERE LOWER(email) = LOWER(${email}) LIMIT 1)
        AND status IN ('pending', 'queued', 'queued_instantly')
      RETURNING id
    `
    return (rows as Array<{ id: string }>).length
  } catch { return 0 }
}

/** Détection DÉTERMINISTE d'un opt-out ("Stop", "désabonnez-moi"...) — indépendante de l'IA.
 *  Analysé sur le texte réel du prospect (cleanBody), pas sur notre footer cité. */
function isExplicitOptOut(text: string): boolean {
  // ⚠️ FILET DE SÉCURITÉ : on retire NOTRE propre pied de page (« répondez simplement "Stop" ») et
  // tout ce qui suit un marqueur de citation, AVANT d'analyser. Sinon, quand le découpage de la
  // citation échoue, on prend notre propre "Stop" pour celui du prospect et on blockliste un lead
  // chaud (cas LJR Couverture : "Ok appelle moi" → blocklisté). Apostrophes courbes normalisées.
  const cleaned = (text || '')
    .replace(/[’‘`´]/g, "'")
    .split(/pour ne plus recevoir mes emails/i)[0]
    .split(/envoy[ée]\s+de\s+mon\s+/i)[0]
    .split(/>\s*le\s/i)[0]
  const t = cleaned.trim().toLowerCase()
  if (/^stop\b/.test(t)) return true
  return /désabonn|désinscri|unsubscribe|ne plus (me |nous )?(recevoir|contacter|écrire|solliciter)|ne plus recevoir (vos|de|d'|ces)?\s*(mail|e-?mail|message|sollicit)|retir(ez|er)[- ]?(moi|nous)?.{0,15}(liste|mailing|base|diffusion)|enlev(ez|er).{0,15}(liste|mailing|base|diffusion)|arrêtez de (m'|nous )?(envoyer|écrire|contacter|solliciter)/i.test(t)
}

/** Adresse technique (daemon/postmaster) qu'il ne faut JAMAIS blocklister comme un prospect. */
function isDaemonAddress(email: string): boolean {
  return /mailer-daemon|postmaster|no[-.]?reply|do[-.]?not[-.]?reply|bounce/i.test(email)
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
const MONTHS_FR: Record<string, number> = { janvier: 0, 'février': 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, 'août': 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, 'décembre': 11, decembre: 11 }
function extractReturnDate(text: string, now: Date): Date | null {
  const t = (text || '').toLowerCase()
  const m = t.match(/(jusqu'?\s*(?:au|à)|de retour le|à partir du|a partir du|reprise le|r[ée]ouverture le|retour le|reprenons le|reprend(?:s|rai|rons)? le)\s+(\d{1,2})(?:\s*[\/.]\s*(\d{1,2}))?(?:\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre))?/)
  if (!m) return null
  const inclusive = /jusqu/.test(m[1])
  const day = parseInt(m[2], 10)
  if (day < 1 || day > 31) return null
  let month = now.getMonth()
  if (m[3]) month = parseInt(m[3], 10) - 1
  else if (m[4]) month = MONTHS_FR[m[4]] ?? month
  let d = new Date(now.getFullYear(), month, day, 9, 0, 0, 0)
  // date déjà passée (>2j) → mois suivant (ou année suivante si le mois était précisé)
  if (d.getTime() < now.getTime() - 2 * 86400000) {
    d = (m[3] || m[4]) ? new Date(now.getFullYear() + 1, month, day, 9, 0, 0, 0) : new Date(now.getFullYear(), month + 1, day, 9, 0, 0, 0)
  }
  if (inclusive) d.setDate(d.getDate() + 1) // "jusqu'au 15" → on relance le 16
  return d
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
  await notifyTeam(`Réponse à valider — ${params.contactCompany}`, text)
}

function normalizeBody(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

