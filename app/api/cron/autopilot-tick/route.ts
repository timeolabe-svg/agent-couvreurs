import { NextRequest, NextResponse } from 'next/server'

const EMAILS_PER_CAMPAIGN_PER_TICK = 5

// Ramp schedule : emails par boîte par jour selon les semaines écoulées
// L'agent monte tout seul — met aussi à jour Instantly automatiquement
const RAMP_SCHEDULE = [
  { weekStart: 0, weekEnd: 2,  perInbox: 8  },  // S1-S2
  { weekStart: 2, weekEnd: 4,  perInbox: 16 },  // S3-S4
  { weekStart: 4, weekEnd: 6,  perInbox: 24 },  // S5-S6
  { weekStart: 6, weekEnd: 8,  perInbox: 30 },  // S7-S8
  { weekStart: 8, weekEnd: 999, perInbox: 42 },  // S9+ — régime de croisière
]

function getInboxCount(): number {
  const inboxes = process.env.INSTANTLY_INBOXES ?? ''
  return inboxes.split(',').filter(Boolean).length || 3
}

function getDailyCapacity(weeksElapsed: number): number {
  const step = RAMP_SCHEDULE.find(s => weeksElapsed >= s.weekStart && weeksElapsed < s.weekEnd)
    ?? RAMP_SCHEDULE[RAMP_SCHEDULE.length - 1]
  return step.perInbox * getInboxCount()
}
const MIN_PIPELINE_LEADS = 80    // scrape quand il reste moins de X leads en attente
const SCRAPE_BATCH_SIZE = 20     // leads par requête

// Termes de recherche : élargit la couverture bien au-delà de "couvreur"
// (chaque terme ramène des entreprises différentes sur Google Maps)
const SECTOR_QUERIES = [
  'couvreur',
  'charpentier couvreur',
  'couvreur zingueur',
  'entreprise de couverture',
  'entreprise de toiture',
  'réparation toiture',
  'rénovation toiture',
  'étanchéité toiture',
  'démoussage toiture',
  'charpentier',
]

// Villes ciblées — FRANCE ENTIÈRE (toutes régions). L'email étant personnalisé
// avec la ville du prospect, le ciblage reste local pour chaque destinataire.
const OCCITANIE_CITIES = [
  // Île-de-France
  'Paris', 'Boulogne-Billancourt', 'Saint-Denis', 'Argenteuil', 'Montreuil',
  'Nanterre', 'Créteil', 'Versailles', 'Vitry-sur-Seine', 'Colombes',
  'Aulnay-sous-Bois', 'Asnières-sur-Seine', 'Courbevoie', 'Rueil-Malmaison',
  'Champigny-sur-Marne', 'Meaux', 'Cergy', 'Évry-Courcouronnes', 'Pontoise',
  'Mantes-la-Jolie', 'Melun', 'Étampes', 'Rambouillet',
  // Auvergne-Rhône-Alpes
  'Lyon', 'Villeurbanne', 'Grenoble', 'Saint-Étienne', 'Clermont-Ferrand',
  'Valence', 'Chambéry', 'Annecy', 'Annemasse', 'Bourg-en-Bresse', 'Roanne',
  'Vienne', 'Montluçon', 'Aurillac', 'Le Puy-en-Velay', 'Privas', 'Romans-sur-Isère',
  'Bourgoin-Jallieu', 'Thonon-les-Bains', 'Aix-les-Bains', 'Vichy', 'Moulins',
  // PACA
  'Marseille', 'Nice', 'Toulon', 'Aix-en-Provence', 'Avignon', 'Antibes',
  'Cannes', 'La Seyne-sur-Mer', 'Hyères', 'Fréjus', 'Grasse', 'Martigues',
  'Cagnes-sur-Mer', 'Gap', 'Digne-les-Bains', 'Draguignan', 'Manosque', 'Salon-de-Provence',
  // Nouvelle-Aquitaine
  'Bordeaux', 'Limoges', 'Poitiers', 'Pau', 'La Rochelle', 'Mérignac',
  'Pessac', 'Angoulême', 'Niort', 'Bayonne', 'Périgueux', 'Agen', 'Mont-de-Marsan',
  'Brive-la-Gaillarde', 'Bergerac', 'Saintes', 'Rochefort', 'Biarritz', 'Anglet',
  'Villeneuve-sur-Lot', 'Tulle', 'Guéret',
  // Occitanie
  'Toulouse', 'Montpellier', 'Nîmes', 'Perpignan', 'Carcassonne', 'Béziers',
  'Albi', 'Tarbes', 'Auch', 'Cahors', 'Rodez', 'Castres', 'Sète', 'Narbonne',
  'Montauban', 'Muret', 'Blagnac', 'Colomiers', 'Alès', 'Lourdes', 'Foix', 'Mende',
  // Grand Est
  'Strasbourg', 'Reims', 'Metz', 'Nancy', 'Mulhouse', 'Colmar', 'Troyes',
  'Charleville-Mézières', 'Châlons-en-Champagne', 'Épinal', 'Thionville', 'Haguenau',
  'Schiltigheim', 'Saint-Dizier', 'Verdun', 'Chaumont', 'Bar-le-Duc',
  // Hauts-de-France
  'Lille', 'Amiens', 'Roubaix', 'Tourcoing', 'Dunkerque', 'Calais', 'Villeneuve-d\'Ascq',
  'Saint-Quentin', 'Beauvais', 'Valenciennes', 'Boulogne-sur-Mer', 'Compiègne',
  'Arras', 'Douai', 'Lens', 'Béthune', 'Soissons', 'Cambrai', 'Maubeuge', 'Laon',
  // Normandie
  'Rouen', 'Le Havre', 'Caen', 'Cherbourg-en-Cotentin', 'Évreux', 'Dieppe',
  'Saint-Lô', 'Alençon', 'Lisieux', 'Vernon', 'Bayeux',
  // Bretagne
  'Rennes', 'Brest', 'Quimper', 'Lorient', 'Vannes', 'Saint-Malo', 'Saint-Brieuc',
  'Lannion', 'Concarneau', 'Fougères', 'Lamballe', 'Morlaix',
  // Pays de la Loire
  'Nantes', 'Angers', 'Le Mans', 'Saint-Nazaire', 'Cholet', 'La Roche-sur-Yon',
  'Laval', 'Saumur', 'La Baule-Escoublac', 'Les Sables-d\'Olonne', 'Château-Gontier',
  // Centre-Val de Loire
  'Tours', 'Orléans', 'Bourges', 'Blois', 'Châteauroux', 'Chartres', 'Dreux',
  'Vierzon', 'Montargis', 'Vendôme', 'Romorantin-Lanthenay',
  // Bourgogne-Franche-Comté
  'Dijon', 'Besançon', 'Belfort', 'Chalon-sur-Saône', 'Nevers', 'Auxerre',
  'Mâcon', 'Montbéliard', 'Sens', 'Le Creusot', 'Dole', 'Vesoul', 'Lons-le-Saunier',
  // Corse
  'Ajaccio', 'Bastia', 'Porto-Vecchio', 'Calvi',
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
  const { contacts, campaigns, email_queue, dashboard_events, agent_config, blocklist } = await import('@/lib/db/schema')
  const { eq, and, gte, lte, sql } = await import('drizzle-orm')
  const { addLeadsToCampaign } = await import('@/lib/instantly/client')
  const { generateEmail } = await import('@/lib/email-generator')
  const { getSequenceStep, renderTemplate } = await import('@/data/sequence')
  const { getNextInbox } = await import('@/lib/instantly/inbox-rotation')

  let sent = 0
  let campaignsProcessed = 0
  let leadsScraped = 0
  let scrapedCity = ''
  let agentDecisions: string[] = []
  let dailyCapacity = 24 // valeur par défaut semaine 1
  let firstSendError: string | null = null // diagnostic temporaire

  // ─── ÉTAPE 0 : Auto-ramp — calcule la capacité selon les semaines écoulées ─
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    // Initialiser la date de départ si premier tick
    const [startRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'ramp_start_date'))
    let rampStart: Date

    if (!startRow) {
      rampStart = new Date()
      await db.insert(agent_config).values({ key: 'ramp_start_date', value: rampStart.toISOString() })
      console.log('[autopilot] Ramp démarré :', rampStart.toISOString())
    } else {
      rampStart = new Date(startRow.value)
    }

    const msElapsed = Date.now() - rampStart.getTime()
    const weeksElapsed = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000))
    dailyCapacity = getDailyCapacity(weeksElapsed)

    // Vérifier si le palier a changé depuis la dernière fois
    const [lastCapRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'last_daily_capacity'))
    const lastCapacity = parseInt(lastCapRow?.value ?? '0')

    if (dailyCapacity !== lastCapacity) {
      // Monter en charge — mettre à jour Instantly aussi
      const instantlyCampaignId = process.env.INSTANTLY_CAMPAIGN_ID
      if (instantlyCampaignId) {
        const { updateCampaignDailyLimit } = await import('@/lib/instantly/client')
        // Marge de +6 pour que Instantly ne coupe pas juste à la limite
        await updateCampaignDailyLimit(instantlyCampaignId, dailyCapacity + 6)
      }

      await db.insert(agent_config)
        .values({ key: 'last_daily_capacity', value: String(dailyCapacity) })
        .onConflictDoUpdate({ target: agent_config.key, set: { value: String(dailyCapacity), updated_at: new Date() } })

      const inboxCount = getInboxCount()
      const perInbox = Math.floor(dailyCapacity / inboxCount)
      const msg = `Palier S${weeksElapsed + 1} atteint : ${perInbox} emails/boîte/jour (${dailyCapacity} total, ${inboxCount} boîtes)`
      agentDecisions.push(msg)
      console.log('[autopilot] Ramp →', msg)
    }
  } catch (err) {
    console.error('[autopilot] Erreur auto-ramp (non-bloquant) :', err)
  }

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
      const instantlyCampaignId = process.env.INSTANTLY_CAMPAIGN_ID ?? null
      const [newCampaign] = await db
        .insert(campaigns)
        .values({
          name: 'Couvreurs Occitanie — Agent Autonome',
          sector: 'couvreur',
          cities: OCCITANIE_CITIES,
          status: 'active',
          allocation_pct: 100,
          sequence_delay_days: [0, 3, 7, 14],
          instantly_campaign_id: instantlyCampaignId,
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
        // Index global de combo (terme de recherche × ville) — couvre tout le marché
        const TOTAL_COMBOS = SECTOR_QUERIES.length * OCCITANIE_CITIES.length
        const [comboRow] = await db
          .select({ value: agent_config.value })
          .from(agent_config)
          .where(eq(agent_config.key, 'scrape_combo_index'))

        const combo = parseInt(comboRow?.value ?? '0') % TOTAL_COMBOS
        const term = SECTOR_QUERIES[combo % SECTOR_QUERIES.length]
        const cityIndex = Math.floor(combo / SECTOR_QUERIES.length) % OCCITANIE_CITIES.length
        scrapedCity = OCCITANIE_CITIES[cityIndex]

        console.log(`[autopilot] Pipeline faible (${pendingCount}). Scraping "${term} ${scrapedCity}"...`)

        const { scrapeGooglePlaces } = await import('@/lib/scraper/google-places')
        let rawLeads: Awaited<ReturnType<typeof scrapeGooglePlaces>> = []

        try {
          rawLeads = await scrapeGooglePlaces({
            sector: term,
            city: scrapedCity,
            maxResults: SCRAPE_BATCH_SIZE,
          })
        } catch (scrapeErr) {
          console.error('[autopilot] Scraping Google Places échoué :', scrapeErr)
        }

        const hasMillionVerifier = Boolean(process.env.MILLION_VERIFIER_API_KEY)
        // Sans MillionVerifier : n'envoyer QUE les emails sûrs (confiance >= 70).
        // 70+ = mailto explicite ou préfixe pro (contact@/devis@) sur leur propre domaine.
        // Avec MillionVerifier : on accepte plus large, MV tranche ensuite.
        const MIN_CONFIDENCE = hasMillionVerifier ? 40 : 70

        // Filtrer : email présent ET confiance suffisante
        const leadsWithEmail = rawLeads.filter(
          (l) => l.email && l.email.includes('@') && l.emailConfidence >= MIN_CONFIDENCE
        )

        const skippedLowConfidence = rawLeads.filter(
          (l) => l.email && l.emailConfidence < MIN_CONFIDENCE
        ).length

        for (const lead of leadsWithEmail) {
          try {
            // Ne jamais recontacter une adresse blocklistée (opt-out)
            const [isBlocked] = await db
              .select({ id: blocklist.id })
              .from(blocklist)
              .where(eq(blocklist.email, lead.email!))
              .limit(1)
            if (isBlocked) continue

            // Insérer le contact (ignorer si email/place_id déjà présent → pas de recontact)
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
                email_confidence_score: lead.emailConfidence,
              })
              .onConflictDoNothing()
              .returning({ id: contacts.id })

            if (!inserted) continue // contact déjà en base → déjà contacté ou en cours, on ne recontacte pas

            // Valider l'email avec MillionVerifier si clé disponible
            let emailValid = true
            if (hasMillionVerifier) {
              try {
                const mvResp = await fetch(
                  `https://api.millionverifier.com/api/v3/?api=${process.env.MILLION_VERIFIER_API_KEY}&email=${encodeURIComponent(lead.email!)}`,
                  { signal: AbortSignal.timeout(4000) }
                )
                if (mvResp.ok) {
                  const mvData = (await mvResp.json()) as { result?: string; quality?: string }
                  if (mvData.result === 'invalid' || mvData.quality === 'bad' || mvData.result === 'catch_all') {
                    emailValid = false
                    console.log(`[autopilot] Email invalide ignoré (MV) : ${lead.email}`)
                  } else {
                    await db
                      .update(contacts)
                      .set({
                        email_validated: true,
                        email_confidence_score: mvData.result === 'ok' ? 99 : 80,
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
              from_email: 'gabin@hdigiweb-agence.com', // remplacé par inbox-rotation à l'envoi
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

        if (skippedLowConfidence > 0 && !hasMillionVerifier) {
          console.log(`[autopilot] ${skippedLowConfidence} emails ignorés (confiance < ${MIN_CONFIDENCE}, MillionVerifier non connecté)`)
        }

        // Avancer l'index de combo (terme × ville)
        const nextCombo = (combo + 1) % TOTAL_COMBOS
        await db
          .insert(agent_config)
          .values({ key: 'scrape_combo_index', value: String(nextCombo) })
          .onConflictDoUpdate({
            target: agent_config.key,
            set: { value: String(nextCombo), updated_at: new Date() },
          })

        // ── Détection fin de marché : si une rotation complète ne ramène rien ──
        const [emptyRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'consecutive_empty_scrapes'))
        let consecutiveEmpty = parseInt(emptyRow?.value ?? '0')

        if (leadsScraped > 0) {
          consecutiveEmpty = 0
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
          consecutiveEmpty++
          console.log(`[autopilot] Aucun nouveau lead pour "${term} ${scrapedCity}" (${consecutiveEmpty}/${TOTAL_COMBOS} combos vides d'affilée)`)
        }

        await db.insert(agent_config)
          .values({ key: 'consecutive_empty_scrapes', value: String(consecutiveEmpty) })
          .onConflictDoUpdate({ target: agent_config.key, set: { value: String(consecutiveEmpty), updated_at: new Date() } })

        // Tous les combos (terme × ville) secs = marché Occitanie réellement épuisé
        if (consecutiveEmpty >= TOTAL_COMBOS) {
          const [notifiedRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'market_exhausted_notified'))
          if (notifiedRow?.value !== 'true') {
            console.log('[autopilot] MARCHÉ ÉPUISÉ — notification envoyée')
            agentDecisions.push('Marché couvreurs Occitanie épuisé — notification envoyée au client')

            await db.insert(dashboard_events).values({
              type: 'agent_decision',
              data: {
                decision: 'market_exhausted',
                sector: 'couvreur',
                region: 'Occitanie',
                reason: 'Tous les couvreurs Occitanie avec email fiable ont été contactés. En attente de validation pour tester un autre marché.',
              },
            })

            // Notifier le client par email (Resend)
            if (process.env.RESEND_API_KEY) {
              try {
                await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
                  body: JSON.stringify({
                    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
                    to: process.env.CLIENT_NOTIFY_EMAIL ?? 'smma.ranked@gmail.com',
                    subject: '🏁 Marché couvreurs Occitanie épuisé — quel marché ensuite ?',
                    html: `
                      <h2>Marché couvreurs Occitanie épuisé</h2>
                      <p>L'agent IA a contacté tous les couvreurs d'Occitanie avec un email fiable.</p>
                      <p>Il est prêt à attaquer un nouveau marché (autre secteur ou autre région), mais il attend ta validation avant de se lancer.</p>
                      <p>Dis-moi quel secteur / région cibler ensuite et je le configure.</p>
                    `,
                  }),
                })
              } catch (notifErr) {
                console.error('[autopilot] Notification fin de marché échouée :', notifErr)
              }
            }

            await db.insert(agent_config)
              .values({ key: 'market_exhausted_notified', value: 'true' })
              .onConflictDoUpdate({ target: agent_config.key, set: { value: 'true', updated_at: new Date() } })
          }
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
    const remainingCapacity = dailyCapacity - sentToday

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
          // Sécurité opt-out : ne jamais envoyer à une adresse blocklistée.
          // Annule la file restante de ce contact (relances comprises).
          const [blockedAtSend] = await db
            .select({ id: blocklist.id })
            .from(blocklist)
            .where(eq(blocklist.email, contact.email))
            .limit(1)
          if (blockedAtSend) {
            await db
              .update(email_queue)
              .set({ status: 'cancelled' })
              .where(and(eq(email_queue.contact_id, contact.id), eq(email_queue.status, 'pending')))
            console.log('[autopilot] Contact blocklisté — file annulée :', contact.email)
            continue
          }

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

          // Template de secours (utilisé si l'IA est indisponible — ex: crédits Anthropic épuisés)
          const renderFallbackTemplate = (s: number): { subject: string; body: string } | null => {
            const tpl = getSequenceStep(s) ?? getSequenceStep(0)
            if (!tpl) return null
            const vars = {
              firstName: lead.firstName,
              city: lead.city,
              company: lead.company,
              fromEmail: inbox.email,
              fromName: inbox.senderName,
            }
            return {
              subject: renderTemplate(tpl.subject, vars),
              body: renderTemplate(tpl.body, vars),
            }
          }

          let generated: { subject: string; body: string }
          if (step === 0) {
            // Email initial : IA personnalisée, avec repli sur template si l'IA échoue
            try {
              generated = await generateEmail(lead, emailType, inbox.email, inbox.senderName)
            } catch (aiErr) {
              const fallback = renderFallbackTemplate(0)
              if (!fallback) throw aiErr
              console.warn('[autopilot-tick] IA indisponible — repli template email initial pour', contact.email, aiErr instanceof Error ? aiErr.message : '')
              generated = fallback
            }
          } else {
            const fallback = renderFallbackTemplate(step)
            if (fallback) {
              generated = fallback
            } else {
              generated = await generateEmail(lead, emailType, inbox.email, inbox.senderName)
            }
          }

          // Utiliser l'ID de campagne Instantly réel (pas notre UUID interne)
          const instantlyId = campaign.instantly_campaign_id ?? process.env.INSTANTLY_CAMPAIGN_ID
          if (!instantlyId) {
            console.warn('[autopilot-tick] Pas d\'INSTANTLY_CAMPAIGN_ID — email ignoré pour', contact.email)
            continue
          }

          await addLeadsToCampaign(instantlyId, [
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

          // NOTE : les relances (J+3, J+7, J+14, J+21) sont gérées nativement par
          // Instantly (étapes 2-5 de la séquence). Instantly refuse d'ajouter 2x le
          // même lead, donc on ne ré-empile PAS les relances ici — sinon double envoi.
          // Notre code ne gère que l'email initial (step 0) personnalisé par l'IA.

          sent++
        } catch (err) {
          console.error('[autopilot-tick] Error processing lead', queue.id, err)
          if (!firstSendError) {
            firstSendError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          }
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
    first_send_error: firstSendError,
  })
}
