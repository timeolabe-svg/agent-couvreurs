import { NextRequest, NextResponse } from 'next/server'

const DAILY_CAPACITY = 334
const EMAILS_PER_CAMPAIGN_PER_TICK = 5

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
  const { contacts, campaigns, email_queue, dashboard_events } = await import('@/lib/db/schema')
  const { eq, and, gte, lte, sql } = await import('drizzle-orm')
  const { addLeadsToCampaign } = await import('@/lib/instantly/client')
  const { generateEmail } = await import('@/lib/email-generator')
  const { getSequenceStep, renderTemplate, getNextStep } = await import('@/data/sequence')
  const { getNextInbox } = await import('@/lib/instantly/inbox-rotation')

  let sent = 0
  let campaignsProcessed = 0

  try {
    const activeCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, 'active'))

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [sentTodayResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(email_queue)
      .where(
        and(
          eq(email_queue.status, 'sent'),
          gte(email_queue.sent_at!, todayStart)
        )
      )

    const sentToday = Number(sentTodayResult?.count ?? 0)
    const remainingCapacity = DAILY_CAPACITY - sentToday

    if (remainingCapacity <= 0) {
      return NextResponse.json({ sent: 0, campaigns_processed: 0, reason: 'daily_capacity_reached' })
    }

    for (const campaign of activeCampaigns) {
      if (sent >= remainingCapacity) break

      const now = new Date()

      const pendingLeads = await db
        .select({
          queue: email_queue,
          contact: contacts,
        })
        .from(email_queue)
        .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
        .where(
          and(
            eq(email_queue.campaign_id, campaign.id),
            eq(email_queue.status, 'pending'),
            lte(email_queue.scheduled_at!, now)
          )
        )
        .limit(EMAILS_PER_CAMPAIGN_PER_TICK)

      if (pendingLeads.length === 0) continue

      campaignsProcessed++

      for (const { queue, contact } of pendingLeads) {
        if (sent >= remainingCapacity) break

        try {
          // Pick next inbox via round-robin rotation
          const inbox = await getNextInbox()

          const lead = {
            id: contact.id,
            company: contact.company,
            contact: contact.name ?? '',
            firstName: contact.name?.split(' ')[0] ?? '',
            email: contact.email,
            phone: contact.phone ?? undefined,
            city: contact.city ?? '',
            website: contact.website ?? undefined,
            googleRating: contact.google_rating ?? undefined,
            googleReviews: contact.google_reviews_count ?? undefined,
            specialty: contact.sector ? [contact.sector] : [] as string[],
            hasGoogleAds: false,
            hasWebsite: Boolean(contact.website),
            stage: 'contacted' as const,
            thread: [] as never[],
            createdAt: contact.created_at?.toISOString() ?? new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
          }

          const step = queue.sequence_step ?? 0
          const sequenceTypeMap: Record<number, 'initial' | 'followup_1' | 'followup_2' | 'followup_3'> = {
            0: 'initial',
            1: 'followup_1',
            2: 'followup_2',
            3: 'followup_3',
            4: 'followup_3',
          }
          const emailType = sequenceTypeMap[step] ?? 'initial'

          // Step 0: full AI personalization
          // Steps 1-4: use fixed templates (faster, consistent, proven)
          let generated: { subject: string; body: string }
          if (step === 0) {
            generated = await generateEmail(lead, emailType, inbox.email, inbox.senderName)
          } else {
            const template = getSequenceStep(step)
            if (template) {
              generated = {
                subject: renderTemplate(template.subject, {
                  firstName: lead.firstName,
                  city: lead.city,
                  company: lead.company,
                  fromEmail: inbox.email,
                  fromName: inbox.senderName,
                }),
                body: renderTemplate(template.body, {
                  firstName: lead.firstName,
                  city: lead.city,
                  company: lead.company,
                  fromEmail: inbox.email,
                  fromName: inbox.senderName,
                }),
              }
            } else {
              generated = await generateEmail(lead, emailType, inbox.email, inbox.senderName)
            }
          }

          await addLeadsToCampaign(campaign.id, [
            {
              email: contact.email,
              first_name: lead.firstName || undefined,
              last_name: contact.name?.split(' ').slice(1).join(' ') || undefined,
              company_name: contact.company,
              phone: contact.phone ?? undefined,
              website: contact.website ?? undefined,
              custom_variables: {
                city: contact.city ?? '',
                sector: contact.sector ?? '',
                subject: generated.subject,
                body: generated.body,
              },
            },
          ])

          await db
            .update(email_queue)
            .set({
              status: 'sent',
              sent_at: new Date(),
              subject: generated.subject,
              body: generated.body,
              from_email: inbox.email,
            })
            .where(eq(email_queue.id, queue.id))

          await db.insert(dashboard_events).values({
            type: 'email_sent',
            data: {
              contactId: contact.id,
              contactEmail: contact.email,
              company: contact.company,
              city: contact.city,
              campaignId: campaign.id,
              campaignName: campaign.name,
              sequenceStep: queue.sequence_step,
              subject: generated.subject,
            },
          })

          // After marking current step as sent, enqueue next step
          const currentStepDef = getSequenceStep(step)
          const nextStep = getNextStep(step)
          if (nextStep && nextStep.active) {
            const currentDelay = currentStepDef?.delayDays ?? 0
            const daysUntilNext = nextStep.delayDays - currentDelay
            const nextScheduledAt = new Date()
            nextScheduledAt.setDate(nextScheduledAt.getDate() + daysUntilNext)

            await db.insert(email_queue).values({
              contact_id: contact.id,
              campaign_id: campaign.id,
              sequence_step: nextStep.step,
              from_email: inbox.email,
              subject: renderTemplate(nextStep.subject, { firstName: lead.firstName, city: lead.city, company: lead.company, fromEmail: inbox.email, fromName: inbox.senderName }),
              body: renderTemplate(nextStep.body, { firstName: lead.firstName, city: lead.city, company: lead.company, fromEmail: inbox.email, fromName: inbox.senderName }),
              status: 'pending',
              scheduled_at: nextScheduledAt,
            }).onConflictDoNothing()
          }

          sent++
        } catch (err) {
          console.error('[autopilot-tick] Error processing lead', queue.id, err)
        }
      }
    }
  } catch (err) {
    console.error('[autopilot-tick] Fatal error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ sent, campaigns_processed: campaignsProcessed })
}
