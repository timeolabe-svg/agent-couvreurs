import { NextRequest, NextResponse } from 'next/server'

const CLIENT_NOTIFY_EMAIL = process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'
const RESEND_API_KEY = process.env.RESEND_API_KEY

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
  const { contacts, incoming_replies, reply_drafts, blocklist, dashboard_events, email_queue } = await import('@/lib/db/schema')
  const { eq, and, gte, sql } = await import('drizzle-orm')
  const { getInstantlyReplies, markReplyProcessed, sendReply } = await import('@/lib/instantly/client')
  const { classifyReply } = await import('@/lib/reply-agent/classifier')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')

  let processed = 0
  let drafts = 0
  let blocked = 0

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
          // Auto-send without human validation (for OOF, etc.)
          try {
            await sendReply({
              reply_to_id: reply.id,
              body: draftBody,
            })
            await db.insert(reply_drafts).values({
              incoming_reply_id: insertedReply.id,
              body: draftBody,
              status: 'sent',
            })
            // No notification needed for auto-sent replies
          } catch (err) {
            console.error('[check-replies] Auto-reply failed, falling back to draft', err)
            await db.insert(reply_drafts).values({
              incoming_reply_id: insertedReply.id,
              body: draftBody,
              status: 'pending',
            })
            await sendNotificationEmail({
              contactName: contact?.name ?? reply.from_address,
              contactCompany: contact?.company ?? reply.from_address,
              classification: classification.classification,
              replyBody: reply.body,
              draftBody,
            })
          }
        } else {
          // draft_for_validation — create pending draft and notify human
          await db.insert(reply_drafts).values({
            incoming_reply_id: insertedReply.id,
            body: draftBody,
            status: 'pending',
          })
          await sendNotificationEmail({
            contactName: contact?.name ?? reply.from_address,
            contactCompany: contact?.company ?? reply.from_address,
            classification: classification.classification,
            replyBody: reply.body,
            draftBody,
          })
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
