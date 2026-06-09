import { NextRequest, NextResponse } from 'next/server'

// Random delay: 4 to 12 minutes (feels human)
function randomDelayMs(): number {
  return (4 + Math.floor(Math.random() * 9)) * 60 * 1000 // 4-12 min in ms
}

const CLIENT_NOTIFY_EMAIL = process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'
const RESEND_API_KEY = process.env.RESEND_API_KEY

// ---------------------------------------------------------------------------
// Helper: parse a French date string into a real Date
// ---------------------------------------------------------------------------
function parseExtractedDate(dateStr: string): Date | null {
  // Try direct parse first
  const direct = new Date(dateStr)
  if (!isNaN(direct.getTime()) && direct.getFullYear() > 2020) return direct

  const now = new Date()
  const lower = dateStr.toLowerCase()

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

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, incoming_replies, reply_drafts, blocklist, dashboard_events, email_queue, rdv: rdvTable } = await import('@/lib/db/schema')
  const { eq, and, gte, sql } = await import('drizzle-orm')
  const { lte: lteOp } = await import('drizzle-orm')
  const { getInstantlyReplies, markReplyProcessed, sendReply } = await import('@/lib/instantly/client')
  const { classifyReply } = await import('@/lib/reply-agent/classifier')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')

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
          await sendReply({ reply_to_id: reply.instantly_reply_id, body: draft.body })
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

  try {
    const replies = await getInstantlyReplies({ limit: 50 })

    for (const reply of replies) {
      try {
        // 1. Find contact by email
        const contactRows = await db
          .select()
          .from(contacts)
          .where(eq(contacts.email, reply.lead_email))
          .limit(1)

        const contact = contactRows[0] ?? null

        // Look up the most recent sent email for this contact
        let originalEmailBody = ''
        if (contact) {
          const [lastSent] = await db
            .select({ body: email_queue.body })
            .from(email_queue)
            .where(and(eq(email_queue.contact_id, contact.id), eq(email_queue.status, 'sent')))
            .orderBy(sql`${email_queue.sent_at} desc`)
            .limit(1)
          originalEmailBody = lastSent?.body ?? ''
        }

        // 2. Dedup: skip if already have a reply from this address in the last 24h
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
        const existing = await db
          .select({ id: incoming_replies.id })
          .from(incoming_replies)
          .where(
            and(
              eq(incoming_replies.from_email, reply.from_address),
              gte(incoming_replies.created_at, since24h),
            )
          )
          .limit(1)

        if (existing.length > 0) continue

        // 3. Classify with AI
        const classification = await classifyReply({
          replyBody: reply.body,
          replySubject: reply.subject,
          originalEmailBody,
          contactName: contact?.name ?? reply.from_address,
          contactCompany: contact?.company ?? reply.from_address,
        })

        // 4. Insert into incoming_replies
        const [insertedReply] = await db
          .insert(incoming_replies)
          .values({
            contact_id: contact?.id ?? undefined,
            from_email: reply.from_address,
            subject: reply.subject,
            body: reply.body,
            classification: classification.classification,
            action_taken: classification.action,
            instantly_reply_id: reply.id,
            processed_at: new Date(),
          })
          .returning()

        processed++

        // 5. Handle action
        if (classification.action === 'blocklist') {
          await db.insert(blocklist).values({
            email: reply.from_address,
            reason: 'desinterest',
          })
          blocked++

          await db.insert(dashboard_events).values({
            type: 'reply_received',
            data: {
              contactEmail: reply.from_address,
              classification: classification.classification,
              action: 'blocklist',
              company: contact?.company ?? reply.from_address,
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
              company: contact?.company ?? reply.from_address,
            },
          })
          await markReplyProcessed(reply.id)
          continue
        }

        // auto_reply or draft_for_validation — generate draft
        const draftBody = await generateReplyResponse({
          classification: classification.classification,
          originalEmailBody,
          replyBody: reply.body,
          contactName: contact?.name ?? reply.from_address,
          contactCompany: contact?.company ?? reply.from_address,
          contactCity: contact?.city ?? '',
        })

        if (classification.action === 'auto_reply') {
          // Schedule auto-reply with human-like delay (4-12 min)
          await db.insert(reply_drafts).values({
            incoming_reply_id: insertedReply.id,
            body: draftBody,
            status: 'scheduled',
            send_after: new Date(Date.now() + randomDelayMs()),
          })
          // No notification needed — will be sent by scheduled loop on next cron run
        } else {
          // draft_for_validation — create pending draft and notify human
          await db.insert(reply_drafts).values({
            incoming_reply_id: insertedReply.id,
            body: draftBody,
            status: 'pending',
          })

          // --- RDV auto-booking when classification is rdv_request ---
          if (classification.classification === 'rdv_request') {
            const extractedDate = (classification as { extractedDate?: string }).extractedDate
            try {
              const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
              const availability = await getAvailability()

              const parsedDate = extractedDate ? parseExtractedDate(extractedDate) : null
              const scheduledDate = findNextAvailableSlot(parsedDate, availability)

              const { createCalendarEvent } = await import('@/lib/google-calendar')

              const endTime = new Date(scheduledDate.getTime() + (availability.slotDurationMin || 30) * 60 * 1000)

              const exchangeSummary = buildExchangeSummary({
                originalEmailBody,
                replyBody: reply.body,
                draftBody,
                contactName: contact?.name ?? reply.from_address,
                contactCompany: contact?.company ?? reply.from_address,
              })

              let googleEventId: string | null = null
              let googleMeetLink: string | null = null
              let calendarEventUrl: string | null = null

              try {
                const event = await createCalendarEvent({
                  summary: `RDV - ${contact?.company ?? reply.from_address}`,
                  description: exchangeSummary,
                  startTime: scheduledDate.toISOString(),
                  endTime: endTime.toISOString(),
                  attendeeEmail: reply.from_address,
                  meetLink: true,
                })
                googleEventId = event.eventId
                googleMeetLink = event.meetLink
                calendarEventUrl = event.eventUrl
              } catch (calErr) {
                console.error('[check-replies] Google Calendar error:', calErr)
              }

              const slotNote = parsedDate && scheduledDate.getTime() !== parsedDate.getTime()
                ? `Date demandée : "${extractedDate}" → ajustée au prochain créneau disponible.`
                : extractedDate
                  ? `Date extraite : "${extractedDate}".`
                  : 'Aucune date précisée — prochain créneau disponible sélectionné.'

              // Save RDV to DB
              await db.insert(rdvTable).values({
                contact_id: contact?.id ?? undefined,
                incoming_reply_id: insertedReply.id,
                scheduled_at: scheduledDate,
                duration_min: availability.slotDurationMin || 30,
                status: 'confirmed',
                google_event_id: googleEventId,
                google_meet_link: googleMeetLink,
                notes: `RDV demandé par le prospect. ${slotNote}`,
              })

              // Send enhanced RDV notification
              await sendRdvNotificationEmail({
                contactName: contact?.name ?? reply.from_address,
                contactCompany: contact?.company ?? reply.from_address,
                scheduledAt: scheduledDate,
                googleMeetLink,
                calendarEventUrl,
                exchangeSummary,
              })
            } catch (rdvErr) {
              console.error('[check-replies] RDV auto-booking failed:', rdvErr)
              // Fall through to normal draft notification
              await sendNotificationEmail({
                contactName: contact?.name ?? reply.from_address,
                contactCompany: contact?.company ?? reply.from_address,
                classification: classification.classification,
                replyBody: reply.body,
                draftBody,
              })
            }
          } else {
            // Not an rdv_request — standard notification
            await sendNotificationEmail({
              contactName: contact?.name ?? reply.from_address,
              contactCompany: contact?.company ?? reply.from_address,
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
            company: contact?.company ?? reply.from_address,
            hasDraft: true,
          },
        })

        await markReplyProcessed(reply.id)
      } catch (err) {
        console.error('[check-replies] Error processing reply', reply.id, err)
      }
    }
  } catch (err) {
    console.error('[check-replies] Fatal error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ processed, drafts, blocked })
}
