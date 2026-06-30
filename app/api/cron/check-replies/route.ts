import { NextRequest, NextResponse } from 'next/server'
import { toParisWallClock, toNaiveParisISO } from '@/lib/availability'
import { checkCronAuth } from '@/lib/cron-auth'

// Random delay: 4 to 12 minutes (feels human)
function randomDelayMs(): number {
  return (4 + Math.floor(Math.random() * 9)) * 60 * 1000 // 4-12 min in ms
}

// Filtre warmup Instantly : les faux échanges sont en anglais.
// CRITIQUE — on ne doit JAMAIS jeter un vrai prospect. On TRAITE par défaut
// (mieux vaut un faux warmup traité qu'un lead chaud perdu = un RDV perdu).
// On ne saute QUE si le message ressemble clairement à du warmup anglais :
// plusieurs mots anglais ET aucun signal français/téléphone.
function isLikelyFrench(text: string): boolean {
  const lower = text.toLowerCase()

  // Signaux FORTS de vrai prospect FR → toujours traiter
  if (/[àâéèêëîïôùûüçœæ]/.test(lower)) return true
  if (/0[1-9]([\s.]?\d{2}){4}/.test(text)) return true // numéro de téléphone FR
  const frenchWords = [
    'bonjour', 'merci', 'vous', 'nous', 'pour', 'avec', 'salut', 'rappel',
    'cordialement', 'madame', 'monsieur', 'bonne', 'votre', 'notre', 'appel',
    'bien', 'aussi', 'mais', 'comme', 'dans', 'alors', 'donc', 'rdv',
    'oui', 'non', 'devis', 'travaux', 'toiture', 'couverture', 'site', 'prix',
  ]
  if (frenchWords.some(w => lower.includes(w))) return true

  // Message très court (≤ 4 mots) sans signal anglais → on traite (ex: "ok", "0612...", un nom)
  const wordCount = lower.trim().split(/\s+/).filter(Boolean).length
  if (wordCount <= 4) return true

  // Sinon : warmup anglais probable seulement si ≥ 2 mots anglais typiques du warmup
  const englishMarkers = ['the', 'please', 'meeting', 'regards', 'thanks', 'thank you',
    'let me know', 'schedule', 'available', 'hello', 'hi ', 'looking forward', 'best ', 'great ']
  const englishHits = englishMarkers.filter(w => lower.includes(w)).length
  // Pas assez de signal anglais → dans le doute, on TRAITE (ne pas perdre de lead)
  return englishHits < 2
}

// Peut contenir plusieurs adresses séparées par des virgules → tableau pour Resend
const CLIENT_NOTIFY_EMAIL = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr')
  .split(',').map(s => s.trim()).filter(Boolean)
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'
const RESEND_API_KEY = process.env.RESEND_API_KEY

// ---------------------------------------------------------------------------
// Helper: parse a French date string into a real Date
// ---------------------------------------------------------------------------
function parseExtractedDate(dateStr: string): Date | null {
  // Try direct parse first
  const direct = new Date(dateStr)
  if (!isNaN(direct.getTime()) && direct.getFullYear() > 2020) return direct

  // CRITIQUE : raisonner en heure de Paris (serveur Vercel = UTC) sinon "demain 14h"
  // devient 16h côté prospect.
  const now = toParisWallClock()
  const lower = dateStr.toLowerCase()

  // Expressions relatives FR : "fin de journée", "ce soir", "aujourd'hui", "demain"
  const setHourFromText = (d: Date) => {
    const hm = lower.match(/(\d{1,2})\s*h\s*(\d{0,2})/)
    if (hm) { d.setHours(parseInt(hm[1]), parseInt(hm[2] || '0'), 0, 0); return }
    if (/fin de journ[ée]e|fin d'?apr[èe]s-?midi|ce soir|en soir[ée]e/.test(lower)) { d.setHours(17, 0, 0, 0); return }
    if (/d[ée]but d'?apr[èe]s-?midi|d[ée]but apr[èe]s-?midi/.test(lower)) { d.setHours(14, 0, 0, 0); return }
    if (/matin|matin[ée]e/.test(lower)) { d.setHours(9, 30, 0, 0); return }
    if (/apr[èe]s-?midi/.test(lower)) { d.setHours(15, 0, 0, 0); return }
    if (/midi/.test(lower)) { d.setHours(12, 0, 0, 0); return }
    d.setHours(17, 0, 0, 0) // défaut : fin de journée
  }

  if (/aujourd'?hui|ce soir|fin de journ[ée]e|en soir[ée]e/.test(lower) && !/demain/.test(lower)) {
    const d = new Date(now); setHourFromText(d); return d
  }
  if (/demain/.test(lower)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); setHourFromText(d); return d
  }

  // "mardi 14h", "jeudi 10h30", "lundi matin", "vendredi après-midi"
  const dayMap: Record<string, number> = {
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    jeudi: 4,
    vendredi: 5,
    samedi: 6,
    dimanche: 0,
  }

  for (const [day, dayNum] of Object.entries(dayMap)) {
    if (lower.includes(day)) {
      const target = new Date(now)
      const currentDay = target.getDay()
      let daysUntil = dayNum - currentDay
      if (daysUntil <= 0) daysUntil += 7
      target.setDate(target.getDate() + daysUntil)

      // Extract hour
      const hourMatch = lower.match(/(\d{1,2})h(\d{0,2})/)
      if (hourMatch) {
        target.setHours(parseInt(hourMatch[1]), parseInt(hourMatch[2] || '0'), 0, 0)
      } else if (lower.includes('matin')) {
        target.setHours(9, 0, 0, 0)
      } else if (lower.includes('après-midi') || lower.includes('apres-midi')) {
        target.setHours(14, 0, 0, 0)
      } else {
        target.setHours(10, 0, 0, 0)
      }
      return target
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Helper: build exchange summary for calendar description
// ---------------------------------------------------------------------------
function buildExchangeSummary(params: {
  originalEmailBody: string
  replyBody: string
  draftBody: string
  contactName: string
  contactCompany: string
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

// ---------------------------------------------------------------------------
// Helper: send RDV notification email (auto-booked)
// ---------------------------------------------------------------------------
async function sendRdvNotificationEmail(params: {
  contactName: string
  contactCompany: string
  scheduledAt: Date
  googleMeetLink: string | null
  calendarEventUrl: string | null
  exchangeSummary: string
  contactId?: string | null
  conversationUrl?: string
}) {
  if (!RESEND_API_KEY) return

  const dateStr = params.scheduledAt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeStr = params.scheduledAt.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
      to: CLIENT_NOTIFY_EMAIL,
      subject: `🎯 RDV automatiquement calé — ${params.contactCompany}`,
      html: `
        <h2 style="color:#22c55e">🎯 RDV calé automatiquement !</h2>
        <p><strong>${params.contactName}</strong> (${params.contactCompany}) a demandé un RDV.</p>
        <p>📅 <strong>${dateStr} à ${timeStr}</strong> — 30 min</p>
        ${params.googleMeetLink ? `<p>🎥 <a href="${params.googleMeetLink}">Lien Google Meet</a></p>` : ''}
        ${params.calendarEventUrl ? `<p>📆 <a href="${params.calendarEventUrl}">Voir dans Google Calendar</a></p>` : ''}
        ${params.conversationUrl ? `<p>💬 <a href="${params.conversationUrl}">Voir la conversation complète →</a></p>` : ''}
        <hr/>
        <h3>Résumé de l'échange</h3>
        <pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:12px;white-space:pre-wrap">${params.exchangeSummary}</pre>
      `,
    }),
  })
}

// ---------------------------------------------------------------------------
// Helper: send standard draft-validation notification email
// ---------------------------------------------------------------------------
async function sendNotificationEmail(params: {
  contactName: string
  contactCompany: string
  classification: string
  replyBody: string
  draftBody: string
}) {
  if (!RESEND_API_KEY) {
    console.warn('[check-replies] RESEND_API_KEY not set — skipping notification email')
    return
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      // RESEND_FROM_EMAIL must be set to a verified Resend domain
      // e.g. agent@hdigiweb.fr (requires DNS verification in resend.com)
      // Falls back to onboarding@resend.dev for testing
      from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
      to: CLIENT_NOTIFY_EMAIL,
      subject: `Réponse à valider — ${params.contactCompany}`,
      html: `
        <h2>Nouvelle réponse à valider</h2>
        <p><strong>De :</strong> ${params.contactName} (${params.contactCompany})</p>
        <p><strong>Classification :</strong> ${params.classification}</p>
        <p><strong>Message reçu :</strong></p>
        <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">${params.replyBody.replace(/\n/g, '<br>')}</blockquote>
        <p><strong>Draft de réponse :</strong></p>
        <blockquote style="border-left:3px solid #2563eb;padding-left:12px;color:#333">${params.draftBody.replace(/\n/g, '<br>')}</blockquote>
        <p><a href="${BASE_URL}/reponses-a-valider" style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">Valider / Modifier</a></p>
      `,
    }),
  })
}

// Normalise un corps de message pour comparer deux réponses (dédup contenu).
function normalizeBody(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, incoming_replies, reply_drafts, blocklist, dashboard_events, email_queue, rdv: rdvTable } = await import('@/lib/db/schema')
  const { eq, and, sql } = await import('drizzle-orm')
  const { lte: lteOp } = await import('drizzle-orm')
  const { getInstantlyReplies, markReplyProcessed, sendReply } = await import('@/lib/instantly/client')
  const { classifyReply } = await import('@/lib/reply-agent/classifier')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')

  // Construit l'historique chronologique complet d'une conversation pour un contact :
  // emails envoyés + relances + messages reçus + réponses de l'agent déjà envoyées.
  // CRITIQUE : sans ça l'IA ne voit pas ses propres réponses et répète le même pitch.
  async function buildHistory(contactId: string): Promise<Array<{ role: 'sent' | 'received'; body: string; date: string }>> {
    const { eq: eqOp } = await import('drizzle-orm')
    const items: Array<{ role: 'sent' | 'received'; body: string; ts: number }> = []
    try {
      // Emails de prospection envoyés
      const sentEmails = await db
        .select({ body: email_queue.body, sentAt: email_queue.sent_at })
        .from(email_queue)
        .where(and(eqOp(email_queue.contact_id, contactId), eqOp(email_queue.status, 'sent')))
      for (const e of sentEmails) {
        if (e.body) items.push({ role: 'sent', body: e.body, ts: e.sentAt ? new Date(e.sentAt).getTime() : 0 })
      }
      // Messages reçus du prospect
      const received = await db
        .select({ body: incoming_replies.body, createdAt: incoming_replies.created_at })
        .from(incoming_replies)
        .where(eqOp(incoming_replies.contact_id, contactId))
      for (const r of received) {
        if (r.body) items.push({ role: 'received', body: r.body, ts: r.createdAt ? new Date(r.createdAt).getTime() : 0 })
      }
      // Réponses de l'agent : envoyées MAIS AUSSI programmées/en attente — sinon, dans
      // la fenêtre de 4-12 min avant envoi, l'IA ne voit pas ce qu'elle va dire et répète.
      const { inArray: inArrayOp } = await import('drizzle-orm')
      const agentReplies = await db
        .select({ body: reply_drafts.body, sentAt: reply_drafts.sent_at, createdAt: reply_drafts.created_at })
        .from(reply_drafts)
        .innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
        .where(and(
          eqOp(incoming_replies.contact_id, contactId),
          inArrayOp(reply_drafts.status, ['sent', 'scheduled', 'pending']),
        ))
      for (const a of agentReplies) {
        const ts = a.sentAt ? new Date(a.sentAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0)
        if (a.body) items.push({ role: 'sent', body: a.body, ts })
      }
    } catch (e) {
      console.error('[check-replies] buildHistory error', e)
    }
    return items
      .sort((x, y) => x.ts - y.ts)
      .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))
  }

  let processed = 0
  let drafts = 0
  let blocked = 0

  // Send scheduled auto-replies that are ready
  try {
    const readyDrafts = await db
      .select({ draft: reply_drafts, reply: incoming_replies })
      .from(reply_drafts)
      .innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
      .where(
        and(
          eq(reply_drafts.status, 'scheduled'),
          lteOp(reply_drafts.send_after!, new Date())
        )
      )
      .limit(10)

    for (const { draft, reply } of readyDrafts) {
      try {
        if (reply.instantly_reply_id) {
          // Retrouver la boîte gabin@ qui a contacté ce prospect (eaccount requis)
          let eaccount: string | undefined
          if (reply.contact_id) {
            const [orig] = await db
              .select({ from_email: email_queue.from_email })
              .from(email_queue)
              .where(and(eq(email_queue.contact_id, reply.contact_id), eq(email_queue.status, 'sent')))
              .orderBy(sql`${email_queue.sent_at} desc`)
              .limit(1)
            eaccount = orig?.from_email
          }
          await sendReply({ reply_to_id: reply.instantly_reply_id, body: draft.body, eaccount, subject: reply.subject ?? undefined })
        }
        await db.update(reply_drafts)
          .set({ status: 'sent', sent_at: new Date() })
          .where(eq(reply_drafts.id, draft.id))
        await db.update(incoming_replies)
          .set({ action_taken: 'replied' })
          .where(eq(incoming_replies.id, reply.id))
      } catch (err) {
        console.error('[check-replies] Failed to send scheduled reply', draft.id, err)
      }
    }
  } catch (err) {
    console.error('[check-replies] Error processing scheduled drafts', err)
  }

  // ── Relances automatiques : prospects chauds sans réponse depuis 3+ jours ──
  // Si on leur a répondu et qu'ils ne répondent plus → on relance (max 2 fois)
  try {
    const { inArray, gte, isNotNull } = await import('drizzle-orm')
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    const WARM = ['interest', 'rdv_request', 'objection', 'question']

    const staleDrafts = await db
      .select({
        draftId: reply_drafts.id,
        sentAt: reply_drafts.sent_at,
        replyId: incoming_replies.id,
        instantlyReplyId: incoming_replies.instantly_reply_id,
        contactId: incoming_replies.contact_id,
        classification: incoming_replies.classification,
        replyBody: incoming_replies.body,
        replySubject: incoming_replies.subject,
      })
      .from(reply_drafts)
      .innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
      .where(
        and(
          eq(reply_drafts.status, 'sent'),
          lteOp(reply_drafts.sent_at!, threeDaysAgo),
          inArray(incoming_replies.classification, WARM),
          isNotNull(incoming_replies.contact_id),
          isNotNull(incoming_replies.instantly_reply_id),
        )
      )
      .limit(5)

    for (const stale of staleDrafts) {
      try {
        if (!stale.contactId) continue

        // Le prospect a-t-il répondu depuis qu'on lui a répondu ?
        const [laterReply] = await db
          .select({ id: incoming_replies.id })
          .from(incoming_replies)
          .where(and(
            eq(incoming_replies.contact_id, stale.contactId),
            gte(incoming_replies.created_at, stale.sentAt!),
          ))
          .limit(1)
        if (laterReply) continue

        // Max 2 drafts envoyés par conversation (évite le spam)
        const sentCount = await db
          .select({ id: reply_drafts.id })
          .from(reply_drafts)
          .where(and(eq(reply_drafts.incoming_reply_id, stale.replyId), eq(reply_drafts.status, 'sent')))
        if (sentCount.length >= 2) continue

        // On a déjà envoyé un follow-up dans les 3 derniers jours ? → skip
        const [recentFollowUp] = await db
          .select({ id: reply_drafts.id })
          .from(reply_drafts)
          .where(and(
            eq(reply_drafts.incoming_reply_id, stale.replyId),
            eq(reply_drafts.status, 'sent'),
            gte(reply_drafts.sent_at!, threeDaysAgo),
          ))
          .limit(1)
        if (recentFollowUp) continue

        // Récupérer le contact
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, stale.contactId)).limit(1)
        if (!contact) continue

        // Bloqué ?
        const [isBlocked] = await db.select({ id: blocklist.id }).from(blocklist).where(eq(blocklist.email, contact.email)).limit(1)
        if (isBlocked) continue

        // Générer la relance — AVEC l'historique pour ne pas répéter le pitch précédent
        const { generateReplyResponse } = await import('@/lib/reply-agent/generator')
        const followUpHistory = await buildHistory(stale.contactId)
        const followUpBody = await generateReplyResponse({
          classification: stale.classification as import('@/lib/reply-agent/classifier').ReplyClassification,
          originalEmailBody: '',
          replyBody: stale.replyBody,
          contactName: contact.name ?? contact.company,
          contactCompany: contact.company,
          contactCity: contact.city ?? '',
          contactSector: contact.sector ?? undefined,
          conversationHistory: followUpHistory,
          isFollowUp: true,
        })

        // Retrouver la boîte expéditrice
        const [orig] = await db
          .select({ from_email: email_queue.from_email })
          .from(email_queue)
          .where(and(eq(email_queue.contact_id, stale.contactId), eq(email_queue.status, 'sent')))
          .orderBy(sql`${email_queue.sent_at} desc`)
          .limit(1)

        const eaccount = orig?.from_email ?? (process.env.INSTANTLY_INBOXES ?? '').split(',')[0]?.trim()
        if (!eaccount) {
          console.error('[check-replies] Aucun eaccount trouvé pour relance', stale.contactId)
          continue
        }

        await sendReply({
          reply_to_id: stale.instantlyReplyId!,
          body: followUpBody,
          eaccount,
          subject: stale.replySubject ?? undefined,
        })

        await db.insert(reply_drafts).values({
          incoming_reply_id: stale.replyId,
          body: followUpBody,
          status: 'sent',
          sent_at: new Date(),
        })

        console.log(`[check-replies] Follow-up auto → ${contact.company} (${stale.classification})`)
      } catch (e) {
        console.error('[check-replies] Follow-up error for', stale.contactId, e)
      }
    }
  } catch (followUpErr) {
    console.error('[check-replies] Follow-up section error (non-bloquant):', followUpErr)
  }

  try {
    const replies = await getInstantlyReplies({ limit: 50 })

    for (const reply of replies) {
      try {
        // CRITIQUE — normaliser l'email en minuscules pour TOUTES les opérations DB
        // (lookup contact, blocklist, opt-out). Instantly renvoie parfois une casse
        // mixte ; sans ça un "Stop" peut être ignoré (opt-out RGPD non respecté).
        reply.from_address = (reply.from_address ?? '').trim().toLowerCase()
        reply.lead_email = (reply.lead_email ?? '').trim().toLowerCase()

        // 1. Find contact by email
        const contactRows = await db
          .select()
          .from(contacts)
          .where(eq(contacts.email, reply.lead_email))
          .limit(1)

        const contact = contactRows[0] ?? null

        // Auto-créer un contact minimal si l'email n'est pas en base
        // (prospect contacté via un autre canal ou données manquantes)
        let resolvedContact = contact
        if (!resolvedContact && reply.from_address && reply.from_address.includes('@')) {
          try {
            const [newContact] = await db.insert(contacts).values({
              email: reply.from_address,
              company: reply.from_address.split('@')[1]?.split('.')[0] ?? 'Inconnu',
              name: null,
              city: null,
              sector: 'inconnu',
              source: 'reply_auto',
            }).onConflictDoNothing().returning()
            if (newContact) {
              resolvedContact = newContact
              console.log('[check-replies] Contact minimal créé automatiquement:', reply.from_address)
            }
          } catch (e) {
            console.error('[check-replies] Impossible de créer contact minimal:', e)
          }
        }

        // Look up the most recent sent email for this contact
        let originalEmailBody = ''
        if (resolvedContact) {
          const [lastSent] = await db
            .select({ body: email_queue.body })
            .from(email_queue)
            .where(and(eq(email_queue.contact_id, resolvedContact.id), eq(email_queue.status, 'sent')))
            .orderBy(sql`${email_queue.sent_at} desc`)
            .limit(1)
          originalEmailBody = lastSent?.body ?? ''
        }

        // Skip silencieusement les réponses sans ID Instantly (structure API inattendue)
        if (!reply.id || !reply.from_address) {
          console.warn('[check-replies] Reply sans ID ou adresse ignoré', reply)
          continue
        }

        // 2. Dédoublonnage PERMANENT : si cet email Instantly précis a déjà été
        //    traité (même instantly_reply_id), on saute. Évite de re-générer un
        //    brouillon à chaque passage du cron (cause du spam précédent).
        if (reply.id) {
          const already = await db
            .select({ id: incoming_replies.id })
            .from(incoming_replies)
            .where(eq(incoming_replies.instantly_reply_id, reply.id))
            .limit(1)
          if (already.length > 0) continue
        }

        // 2b. Dédup par CONTENU : le même message peut revenir avec un ID Instantly
        //     différent (multi-inbox). Si ce contact a déjà un message reçu identique,
        //     on saute → évite de répondre 2x au même message (bug 11:30 + 11:31).
        if (resolvedContact) {
          const recent = await db
            .select({ body: incoming_replies.body })
            .from(incoming_replies)
            .where(eq(incoming_replies.contact_id, resolvedContact.id))
            .orderBy(sql`${incoming_replies.created_at} desc`)
            .limit(10)
          const norm = normalizeBody(reply.body)
          if (norm && recent.some(r => normalizeBody(r.body ?? '') === norm)) {
            console.log(`[check-replies] Doublon contenu ignoré : ${reply.from_address}`)
            continue
          }
        }

        // 3. Ignorer les faux échanges warmup Instantly (toujours en anglais)
        if (!isLikelyFrench(reply.body + ' ' + reply.subject)) {
          console.log(`[check-replies] Warmup ignoré (anglais) : ${reply.from_address}`)
          continue
        }

        // 4. Classify with AI
        const classification = await classifyReply({
          replyBody: reply.body,
          replySubject: reply.subject,
          originalEmailBody,
          contactName: contact?.name ?? reply.from_address,
          contactCompany: contact?.company ?? reply.from_address,
          fromEmail: reply.from_address,
        })

        // 4. Insert into incoming_replies — onConflictDoNothing sur instantly_reply_id :
        //    si deux crons concurrents passent le SELECT de dédup en même temps, la
        //    contrainte UNIQUE (à créer en base) empêche le doublon et returning() est vide.
        const [insertedReply] = await db
          .insert(incoming_replies)
          .values({
            contact_id: resolvedContact?.id ?? undefined,
            from_email: reply.from_address,
            subject: reply.subject,
            body: reply.body,
            classification: classification.classification,
            action_taken: classification.action,
            instantly_reply_id: reply.id,
            processed_at: new Date(),
          })
          .onConflictDoNothing({ target: incoming_replies.instantly_reply_id })
          .returning()

        // Doublon (course concurrente) → on saute, rien à traiter.
        if (!insertedReply) {
          console.log(`[check-replies] Doublon concurrent ignoré : ${reply.from_address}`)
          continue
        }

        processed++

        // 5. Handle action
        if (classification.action === 'blocklist') {
          await db.insert(blocklist).values({
            email: reply.from_address,
            reason: 'desinterest',
          })
          blocked++

          // CRITIQUE : annuler immédiatement toutes les relances en attente
          // de ce contact. Un opt-out = on arrête tout, relances comprises.
          if (resolvedContact) {
            const cancelled = await db
              .update(email_queue)
              .set({ status: 'cancelled' })
              .where(and(eq(email_queue.contact_id, resolvedContact.id), eq(email_queue.status, 'pending')))
              .returning({ id: email_queue.id })
            if (cancelled.length > 0) {
              console.log(`[check-replies] Opt-out ${reply.from_address} — ${cancelled.length} relance(s) annulée(s)`)
            }
          }

          await db.insert(dashboard_events).values({
            type: 'reply_received',
            data: {
              contactEmail: reply.from_address,
              classification: classification.classification,
              action: 'blocklist',
              company: resolvedContact?.company ?? reply.from_address,
            },
          })

          await markReplyProcessed(reply.id)
          continue
        }

        if (classification.action === 'no_action') {
          await db.insert(dashboard_events).values({
            type: 'reply_received',
            data: {
              contactEmail: reply.from_address,
              classification: classification.classification,
              action: 'no_action',
              company: resolvedContact?.company ?? reply.from_address,
            },
          })
          await markReplyProcessed(reply.id)
          continue
        }

        // Le prospect engage une vraie conversation (intérêt, question, objection, RDV).
        // On stoppe les relances froides automatiques : le reply-agent prend le relais.
        // (on ne stoppe PAS pour 'oof' = absence : il reviendra, les relances continuent)
        if (resolvedContact && classification.classification !== 'oof') {
          await db
            .update(email_queue)
            .set({ status: 'cancelled' })
            .where(and(eq(email_queue.contact_id, resolvedContact.id), eq(email_queue.status, 'pending')))
        }

        // Pour un RDV : on calcule le créneau AVANT de rédiger, pour que l'agent
        // confirme une date/heure précise ET qu'on cale exactement le même créneau.
        const isRdv = classification.classification === 'rdv_request'
        const extractedDate = (classification as { extractedDate?: string }).extractedDate
        const phoneMatch = reply.body.match(/0[1-9]([\s. ]?\d{2}){4}/)
        const contactPhone = phoneMatch ? phoneMatch[0].replace(/[\s ]+/g, ' ').trim() : (resolvedContact?.phone ?? undefined)

        let availabilityCfg: Awaited<ReturnType<typeof import('@/lib/availability').getAvailability>> | null = null
        let parsedDate: Date | null = null
        let scheduledDate: Date | null = null
        let proposedSlotStr: string | undefined

        if (isRdv) {
          try {
            const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
            availabilityCfg = await getAvailability()
            parsedDate = extractedDate ? parseExtractedDate(extractedDate) : null
            scheduledDate = findNextAvailableSlot(parsedDate, availabilityCfg)
            proposedSlotStr =
              scheduledDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) +
              ' à ' +
              scheduledDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          } catch (e) {
            console.error('[check-replies] Calcul créneau échoué', e)
          }
        }

        // Historique complet (emails envoyés + reçus + réponses agent passées)
        // → l'IA voit ce qu'elle a déjà dit et ne se répète plus.
        const history = resolvedContact ? await buildHistory(resolvedContact.id) : undefined

        // auto_reply or draft_for_validation — generate draft (confirme le créneau si RDV)
        const draftBody = await generateReplyResponse({
          classification: classification.classification,
          originalEmailBody,
          replyBody: reply.body,
          contactName: resolvedContact?.name ?? reply.from_address,
          contactCompany: resolvedContact?.company ?? reply.from_address,
          contactCity: resolvedContact?.city ?? '',
          contactSector: resolvedContact?.sector ?? undefined,
          conversationHistory: history,
          proposedSlot: proposedSlotStr,
          contactPhone: isRdv ? contactPhone : undefined,
        })

        // --- RDV auto-booking quand rdv_request (autonome, peu importe l'action) ---
        let rdvHandled = false
        if (isRdv && scheduledDate && availabilityCfg) {
          const availability = availabilityCfg
          try {
            const { createCalendarEvent } = await import('@/lib/google-calendar')
            const endTime = new Date(scheduledDate.getTime() + (availability.slotDurationMin || 30) * 60 * 1000)

            const exchangeSummary = buildExchangeSummary({
              originalEmailBody,
              replyBody: reply.body,
              draftBody,
              contactName: resolvedContact?.name ?? reply.from_address,
              contactCompany: resolvedContact?.company ?? reply.from_address,
            })

            let googleEventId: string | null = null
            let googleMeetLink: string | null = null
            let calendarEventUrl: string | null = null

            try {
              const event = await createCalendarEvent({
                summary: `RDV - ${resolvedContact?.company ?? reply.from_address}`,
                description: exchangeSummary,
                // ISO LOCAL Paris (sans Z) — scheduledDate porte déjà l'heure murale Paris.
                startTime: toNaiveParisISO(scheduledDate),
                endTime: toNaiveParisISO(endTime),
                attendeeEmail: reply.from_address,
                meetLink: true,
              })
              // Un event "mock_" = variables Google manquantes → PAS un vrai RDV.
              // On ne le considère pas comme calé (sinon RDV fantôme + facturation à tort).
              if (event.eventId && !event.eventId.startsWith('mock_')) {
                googleEventId = event.eventId
                googleMeetLink = event.meetLink
                calendarEventUrl = event.eventUrl
              } else {
                console.warn('[check-replies] Google Calendar non configuré (mock) — RDV non calé, pas de facturation')
              }
            } catch (calErr) {
              console.error('[check-replies] Google Calendar error:', calErr)
            }

            const slotNote = parsedDate && scheduledDate.getTime() !== parsedDate.getTime()
              ? `Date demandée : "${extractedDate}" → ajustée au prochain créneau disponible.`
              : extractedDate
                ? `Date extraite : "${extractedDate}".`
                : 'Aucune date précisée — prochain créneau disponible sélectionné.'

            const [insertedRdv] = await db.insert(rdvTable).values({
              contact_id: resolvedContact?.id ?? undefined,
              incoming_reply_id: insertedReply.id,
              scheduled_at: scheduledDate,
              duration_min: availability.slotDurationMin || 30,
              status: 'confirmed',
              google_event_id: googleEventId,
              google_meet_link: googleMeetLink,
              notes: `RDV demandé par le prospect. ${slotNote}${!googleEventId ? ' ⚠️ Sync Google Calendar échouée — à créer manuellement.' : ''}`,
            }).returning()

            // Facturation : UNIQUEMENT si un VRAI RDV Google a été calé (pas un mock),
            // et avec une clé d'idempotence = id du RDV (re-traiter le même RDV ne
            // refacture jamais le client). Pas de vrai event → pas de facturation.
            if (process.env.STRIPE_SECRET_KEY && insertedRdv?.id && googleEventId) {
              try {
                const { stripe } = await import('@/lib/stripe')
                const { agent_config } = await import('@/lib/db/schema')
                const [customerRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_customer_id'))
                const [pmRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_payment_method_id'))
                if (customerRow?.value && pmRow?.value) {
                  await stripe.paymentIntents.create({
                    amount: 5000,
                    currency: 'eur',
                    customer: customerRow.value,
                    payment_method: pmRow.value,
                    confirm: true,
                    off_session: true,
                    description: `RDV Hdigiweb auto — ${resolvedContact?.company ?? reply.from_address} — ${scheduledDate.toLocaleDateString('fr-FR')}`,
                    metadata: { rdv_id: insertedRdv.id, contact_company: resolvedContact?.company ?? reply.from_address },
                  }, { idempotencyKey: `rdv-charge-${insertedRdv.id}` })
                  console.log('[check-replies] Stripe charge 50€ OK for', resolvedContact?.company)
                }
              } catch (stripeErr) {
                console.error('[check-replies] Stripe charge failed:', stripeErr)
              }
            }

            // Notification au client : RDV calé (action effectuée, pas une demande)
            await sendRdvNotificationEmail({
              contactName: resolvedContact?.name ?? reply.from_address,
              contactCompany: resolvedContact?.company ?? reply.from_address,
              scheduledAt: scheduledDate,
              googleMeetLink,
              calendarEventUrl,
              exchangeSummary,
              contactId: resolvedContact?.id ?? null,
              conversationUrl: `${BASE_URL}/conversations?contact=${resolvedContact?.id ?? ''}`,
            })
            rdvHandled = true
          } catch (rdvErr) {
            console.error('[check-replies] RDV auto-booking failed:', rdvErr)
          }
        }

        // --- Brouillon de réponse ---
        if (classification.action === 'auto_reply') {
          // L'agent répond seul : on programme l'envoi avec délai humain (4-12 min)
          await db.insert(reply_drafts).values({
            incoming_reply_id: insertedReply.id,
            body: draftBody,
            status: 'scheduled',
            send_after: new Date(Date.now() + randomDelayMs()),
          })
        } else {
          // draft_for_validation : doute / technique → on demande validation humaine
          await db.insert(reply_drafts).values({
            incoming_reply_id: insertedReply.id,
            body: draftBody,
            status: 'pending',
          })
          // Notifier l'humain (sauf si un RDV a déjà été calé et notifié)
          if (!rdvHandled) {
            await sendNotificationEmail({
              contactName: resolvedContact?.name ?? reply.from_address,
              contactCompany: resolvedContact?.company ?? reply.from_address,
              classification: classification.classification,
              replyBody: reply.body,
              draftBody,
            })
          }
        }

        drafts++

        await db.insert(dashboard_events).values({
          type: 'reply_received',
          data: {
            contactEmail: reply.from_address,
            classification: classification.classification,
            action: classification.action,
            company: resolvedContact?.company ?? reply.from_address,
            hasDraft: true,
          },
        })

        await markReplyProcessed(reply.id)
      } catch (err) {
        console.error('[check-replies] Error processing reply', reply.id, err)
      }
    }
  } catch (err) {
    // Log but don't crash the cron — return 200 so cron-job.org keeps running
    console.error('[check-replies] Fatal error (non-blocking)', err)
    return NextResponse.json({
      processed,
      drafts,
      blocked,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  return NextResponse.json({ processed, drafts, blocked })
}
