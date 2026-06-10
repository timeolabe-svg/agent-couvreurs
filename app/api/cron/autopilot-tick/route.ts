import { NextRequest, NextResponse } from 'next/server'

const DAILY_CAPACITY = 24 // 3 boîtes × 8 emails/jour (ramp-up semaine 1)
const EMAILS_PER_CAMPAIGN_PER_TICK = 5
const MIN_PIPELINE_LEADS = 80   // scrape quand il reste moins de X leads en attente
const SCRAPE_BATCH_SIZE = 20    // leads par ville par tick

// Villes d'Occitanie ciblées — couvreurs
const OCCITANIE_CITIES = [
  'Toulouse', 'Montpellier', 'Nîmes', 'Perpignan', 'Carcassonne',
  'Béziers', 'Albi', 'Tarbes', 'Foix', 'Auch', 'Mende', 'Cahors',
  'Rodez', 'Castres', 'Millau', 'Sète', 'Lunel', 'Narbonne',
  'Lézignan-Corbières', 'Limoux', 'Pamiers', 'Saint-Gaudens',
  'Montauban', 'Muret', 'Blagnac', 'Tournefeuille', 'Colomiers',
  'Balma', 'Ramonville-Saint-Agne', 'Cugnaux', 'Portet-sur-Garonne',
  'Gaillac', 'Lavaur', 'Mazamet', 'Mèze', 'Agde', 'Frontignan',
  'Palavas-les-Flots', 'La Grande-Motte', 'Laudun-l\'Ardoise',
  'Bagnols-sur-Cèze', 'Alès', 'Uzès', 'Le Vigan', 'Ganges',
]

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
  const { contacts, campaigns, email_queue, dashboard_events, agent_config } = await import('@/lib/db/schema')
  const { eq, and, gte, lte, sql, isNull, or } = await import('drizzle-orm')
  const { addLeadsToCampaign } = await import('@/lib/instantly/client')
  const { generateEmail } = await import('@/lib/email-generator')
  const { getSequenceStep, renderTemplate, getNextStep } = await import('@/data/sequence')
  const { getNextInbox } = await import('@/lib/instantly/inbox-rotation')

  let sent = 0
  let campaignsProcessed = 0
  let leadsScraped = 0
  let scrapedCity = ''
  let agentDecisions: string[] = []

  // ─── ÉTAPE 1 : Garantir qu'il existe une campagne active ──────────────────
  let activeCampaignId: string | null = null
  try {
    const [existingCampaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(eq(campaigns.status, 'active'))
      .limit(1)

    if (existingCampaign) {
      activeCampaignId = existingCampaign.id
    } else {
      // Aucune campagne active — l'agent en crée une automatiquement
      const [newCampaign] = await db
        .insert(campaigns)
        .values({
          name: 'Couvreurs Occitanie — Agent Autonome',
          sector: 'couvreur',
          cities: OCCITANIE_CITIES,
          status: 'active',
          allocation_pct: 100,
          sequence_delay_days: [0, 3, 7, 14],
        })
        .returning({ id: campaigns.id })

      activeCampaignId = newCampaign.id
      agentDecisions.push(`Campagne créée automatiquement : "Couvreurs Occitanie — Agent Autonome"`)

      await db.insert(dashboard_events).values({
        type: 'agent_decision',
        data: {
          decision: 'campaign_created',
          campaignId: activeCampaignId,
          campaignName: 'Couvreurs Occitanie — Agent Autonome',
          reason: 'Aucune campagne active trouvée — création automatique',
        },
      })

      console.log('[autopilot] Campagne active créée :', activeCampaignId)
    }
  } catch (err) {
    console.error('[autopilot] Erreur vérification campagne :', err)
  }

  // ─── ÉTAPE 2 : Scraping autonome si pipeline faible ───────────────────────
  if (activeCampaignId && process.env.GOOGLE_PLACES_API_KEY) {
    try {
      // Compter les leads en attente
      const [pendingCountResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(email_queue)
        .where(
          and(
            eq(email_queue.campaign_id, activeCampaignId),
            eq(email_queue.status, 'pending')
          )
        )

      const pendingCount = Number(pendingCountResult?.count ?? 0)

      if (pendingCount < MIN_PIPELINE_LEADS) {
        // Récupérer l'index de la prochaine ville à scraper
        const [cityIndexRow] = await db
          .select({ value: agent_config.value })
          .from(agent_config)
          .where(eq(agent_config.key, 'scrape_city_index'))

        const cityIndex = parseInt(cityIndexRow?.value ?? '0') % OCCITANIE_CITIES.length
        scrapedCity = OCCITANIE_CITIES[cityIndex]

        console.log(`[autopilot] Pipeline faible (${pendingCount} leads). Scraping "${scrapedCity}"...`)

        const { scrapeGooglePlaces } = await import('@/lib/scraper/google-places')
        let rawLeads: Awaited<ReturnType<typeof scrapeGooglePlaces>> = []

        try {
          rawLeads = await scrapeGooglePlaces({
            sector: 'couvreur',
            city: scrapedCity,
            maxResults: SCRAPE_BATCH_SIZE,
          })
        } catch (scrapeErr) {
          console.error('[autopilot] Scraping Google Places échoué :', scrapeErr)
        }

        // Filtrer les leads avec email
        const leadsWithEmail = rawLeads.filter((l) => l.email && l.email.includes('@'))

        for (const lead of leadsWithEmail) {
          try {
            // Insérer le contact (ignorer si email déjà présent)
            const [inserted] = await db
              .insert(contacts)
              .values({
                email: lead.email!,
                company: lead.name,
                city: lead.city || scrapedCity,
                postal_code: lead.postalCode || null,
                phone: lead.phone,
                website: lead.website,
                sector: 'couvreur',
                google_place_id: lead.googlePlaceId,
                google_rating: lead.rating,
                google_reviews_count: lead.reviewsCount,
                source: 'google_places',
                email_validated: false,
              })
              .onConflictDoNothing()
              .returning({ id: contacts.id })

            if (!inserted) continue // contact déjà en base

            // Vérifier qu'il n'est pas déjà dans la queue pour cette campagne
            const [alreadyInQueue] = await db
              .select({ id: email_queue.id })
              .from(email_queue)
              .where(
                and(
                  eq(email_queue.contact_id, inserted.id),
                  eq(email_queue.campaign_id, activeCampaignId!)
                )
              )
              .limit(1)

            if (alreadyInQueue) continue

            // Valider l'email avec MillionVerifier si clé disponible
            let emailValid = true
            if (process.env.MILLION_VERIFIER_API_KEY) {
              try {
                const mvResp = await fetch(
                  `https://api.millionverifier.com/api/v3/?api=${process.env.MILLION_VERIFIER_API_KEY}&email=${encodeURIComponent(lead.email!)}`,
                  { signal: AbortSignal.timeout(4000) }
                )
                if (mvResp.ok) {
                  const mvData = (await mvResp.json()) as { result?: string; quality?: string }
                  if (mvData.result === 'invalid' || mvData.quality === 'bad') {
                    emailValid = false
                    console.log(`[autopilot] Email invalide ignoré : ${lead.email}`)
                  } else {
                    // Mettre à jour le statut de validation
                    await db
                      .update(contacts)
                      .set({
                        email_validated: true,
                        email_confidence_score: mvData.quality === 'good' ? 95 : 60,
                      })
                      .where(eq(contacts.id, inserted.id))
                  }
                }
              } catch {
                // MillionVerifier optionnel — continuer si erreur
              }
            }

            if (!emailValid) continue

            // Ajouter à la queue email (sera envoyé lors du prochain tick)
            await db.insert(email_queue).values({
              contact_id: inserted.id,
              campaign_id: activeCampaignId!,
              sequence_step: 0,
              from_email: 'thomas@hdigiweb.fr', // sera remplacé par inbox-rotation au moment d'envoyer
              subject: '__pending_generation__',
              body: '__pending_generation__',
              status: 'pending',
              scheduled_at: new Date(), // disponible immédiatement
            })

            leadsScraped++
          } catch (leadErr) {
            // Skip les erreurs individuelles (doublons, etc.)
            const errMsg = leadErr instanceof Error ? leadErr.message : ''
            if (!errMsg.includes('duplicate') && !errMsg.includes('unique')) {
              console.error('[autopilot] Erreur import lead :', lead.email, leadErr)
            }
          }
        }

        // Avancer l'index de ville
        const nextIndex = cityIndex + 1
        await db
          .insert(agent_config)
          .values({ key: 'scrape_city_index', value: String(nextIndex) })
          .onConflictDoUpdate({
            target: agent_config.key,
            set: { value: String(nextIndex), updated_at: new Date() },
          })

        if (leadsScraped > 0) {
          agentDecisions.push(`${leadsScraped} nouveaux leads importés depuis Google Maps (${scrapedCity})`)
          await db.insert(dashboard_events).values({
            type: 'agent_decision',
            data: {
              decision: 'leads_scraped',
              city: scrapedCity,
              leadsFound: rawLeads.length,
              leadsWithEmail: leadsWithEmail.length,
              leadsImported: leadsScraped,
              reason: `Pipeline faible (${pendingCount} leads restants) — auto-scraping déclenché`,
            },
          })
        } else {
          console.log(`[autopilot] Aucun nouveau lead trouvé pour ${scrapedCity} (${rawLeads.length} places, ${leadsWithEmail.length} avec email)`)
        }
      } else {
        console.log(`[autopilot] Pipeline OK (${pendingCount} leads en attente) — pas de scraping`)
      }
    } catch (scrapeError) {
      console.error('[autopilot] Erreur étape scraping :', scrapeError)
      // Non bloquant — continue
    }
  } else if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn('[autopilot] GOOGLE_PLACES_API_KEY manquante — scraping désactivé')
  }

  // ─── ÉTAPE 3 : Envoi des emails (logique existante) ───────────────────────
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
      return NextResponse.json({
        sent: 0,
        campaigns_processed: 0,
        leads_scraped: leadsScraped,
        scraped_city: scrapedCity,
        agent_decisions: agentDecisions,
        reason: 'daily_capacity_reached',
      })
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

          // Enqueue next sequence step
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
    console.error('[autopilot-tick] Fatal error in email sending', err)
    return NextResponse.json({
      sent,
      campaigns_processed: campaignsProcessed,
      leads_scraped: leadsScraped,
      scraped_city: scrapedCity,
      agent_decisions: agentDecisions,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  return NextResponse.json({
    sent,
    campaigns_processed: campaignsProcessed,
    leads_scraped: leadsScraped,
    scraped_city: scrapedCity || null,
    agent_decisions: agentDecisions,
  })
}
