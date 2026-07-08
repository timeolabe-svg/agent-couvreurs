import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { isFakeEmail } from '@/lib/fake-email'

// Laisse Vercel exécuter jusqu'à 60s (la génération de plusieurs séquences peut être longue).
export const maxDuration = 60

// Le scraping est désormais géré par le cron DÉDIÉ /api/cron/scrape-leads (découplé).
// autopilot-tick ne fait plus que L'ENVOI → rapide, jamais de timeout.
// (Réactivable via AUTOPILOT_SCRAPING=true si besoin de secours.)
const SCRAPING_IN_AUTOPILOT = process.env.AUTOPILOT_SCRAPING === 'true'

const EMAILS_PER_CAMPAIGN_PER_TICK = 8 // génération parallèle → reste rapide, atteint 168/jour

// Ramp schedule : emails par boîte par jour selon les semaines écoulées
// L'agent monte tout seul — met aussi à jour Instantly automatiquement.
// Les boîtes sont déjà chauffées (2-3 semaines) → on vise 35/boîte/jour rapidement.
const RAMP_SCHEDULE = [
  { weekStart: 0, weekEnd: 1,  perInbox: 15 },  // S1
  { weekStart: 1, weekEnd: 2,  perInbox: 25 },  // S2
  { weekStart: 2, weekEnd: 999, perInbox: 35 }, // S3+ — régime de croisière (cible client)
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
const SCRAPE_BATCH_SIZE = 12     // leads par requête (réduit pour tenir sous le timeout)

// Secteurs ciblés (BtP) + termes de recherche par secteur. Priorité Gabin :
// couvreurs, terrassiers, piscinistes. Facile d'ajouter d'autres métiers BtP.
// Chaque requête est taguée avec son secteur → stocké sur le contact + email adapté.
const SECTOR_QUERIES: { term: string; sector: string }[] = [
  // Couvreurs (prioritaires)
  { term: 'couvreur', sector: 'couvreur' },
  { term: 'charpentier couvreur', sector: 'couvreur' },
  { term: 'couvreur zingueur', sector: 'couvreur' },
  { term: 'entreprise de couverture', sector: 'couvreur' },
  { term: 'réparation toiture', sector: 'couvreur' },
  { term: 'rénovation toiture', sector: 'couvreur' },
  { term: 'étanchéité toiture', sector: 'couvreur' },
  // Terrassiers (prioritaires)
  { term: 'terrassier', sector: 'terrassier' },
  { term: 'entreprise de terrassement', sector: 'terrassier' },
  { term: 'terrassement', sector: 'terrassier' },
  { term: 'travaux terrassement VRD', sector: 'terrassier' },
  { term: 'assainissement terrassement', sector: 'terrassier' },
  // Piscinistes (prioritaires)
  { term: 'pisciniste', sector: 'pisciniste' },
  { term: 'construction piscine', sector: 'pisciniste' },
  { term: 'rénovation piscine', sector: 'pisciniste' },
  { term: 'installation piscine', sector: 'pisciniste' },
  // Maçons
  { term: 'maçon', sector: 'maçon' },
  { term: 'maçonnerie', sector: 'maçon' },
  { term: 'entreprise maçonnerie', sector: 'maçon' },
  // Électriciens
  { term: 'électricien', sector: 'électricien' },
  { term: 'installateur électrique', sector: 'électricien' },
  // Plombiers
  { term: 'plombier', sector: 'plombier' },
  { term: 'plomberie chauffage', sector: 'plombier' },
  // Peintres
  { term: 'peintre en bâtiment', sector: 'peintre' },
  { term: 'peinture bâtiment', sector: 'peintre' },
  // Menuisiers
  { term: 'menuisier', sector: 'menuisier' },
  { term: 'menuiserie', sector: 'menuisier' },
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
  const cronAuth = checkCronAuth(request)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, campaigns, email_queue, dashboard_events, agent_config, blocklist } = await import('@/lib/db/schema')
  const { eq, and, or, gte, lte, sql } = await import('drizzle-orm')
  const { generateEmail, generateSequence } = await import('@/lib/email-generator')
  const { getSequenceStep, renderTemplate } = await import('@/data/sequence')
  const { getNextInbox } = await import('@/lib/instantly/inbox-rotation')

  let queued = 0
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
      // NOTE : la limite journalière Instantly est gérée MANUELLEMENT par le client
      // (réglée à 200, au-dessus du max 4×42=168). On ne la touche plus automatiquement
      // pour ne pas écraser sa valeur. Notre DAILY_CAPACITY (ramp) contrôle le vrai volume.

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

  // ─── ÉTAPE 2 : Scraping — DÉSACTIVÉ ici (délégué au cron scrape-leads) ─────
  if (SCRAPING_IN_AUTOPILOT && activeCampaignId && process.env.GOOGLE_PLACES_API_KEY) {
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

      // THROTTLE scraping : au plus une fois toutes les 2h. Le scraping (Google Places
      // + MillionVerifier) est lent ; le faire à chaque tick faisait timeout la fonction
      // et bloquait l'ENVOI. En throttlant, la plupart des ticks ne font que l'envoi (rapide).
      let scrapeThrottled = false
      try {
        const [lastScrapeRow] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'last_scrape_at'))
        if (lastScrapeRow?.value) {
          const ageMs = Date.now() - new Date(lastScrapeRow.value).getTime()
          if (ageMs < 2 * 60 * 60 * 1000) scrapeThrottled = true // < 2h → on saute le scraping
        }
      } catch { /* non bloquant */ }

      if (pendingCount < MIN_PIPELINE_LEADS && !scrapeThrottled) {
        // Marque tout de suite l'horodatage pour throttler les prochains ticks
        await db.insert(agent_config)
          .values({ key: 'last_scrape_at', value: new Date().toISOString() })
          .onConflictDoUpdate({ target: agent_config.key, set: { value: new Date().toISOString(), updated_at: new Date() } })

        // Lire sector_priority_override pour pondérer le choix des combos
        const [priorityRow] = await db
          .select({ value: agent_config.value })
          .from(agent_config)
          .where(eq(agent_config.key, 'sector_priority_override'))

        let sectorPriorities: Record<string, number> = {}
        if (priorityRow?.value) {
          try {
            sectorPriorities = JSON.parse(priorityRow.value)
          } catch {
            console.warn('[autopilot] sector_priority_override JSON invalide, fallback à priorités neutres')
            sectorPriorities = {}
          }
        }

        // Construire une liste pondérée des SECTOR_QUERIES selon les priorités
        // score 8-10 = 3x, score 4-7 = 1x (normal), score 0-3 = 1/3 (on garde 1 entrée sur 3)
        const weightedQueries: { term: string; sector: string }[] = []
        for (const q of SECTOR_QUERIES) {
          const score = sectorPriorities[q.sector] ?? 5 // défaut = normal
          if (score >= 8) {
            weightedQueries.push(q, q, q) // 3x
          } else if (score >= 4) {
            weightedQueries.push(q) // 1x
          } else {
            // score 0-3 : 1 fois sur 3 (on n'ajoute que la première occurrence du secteur)
            const alreadyAdded = weightedQueries.some(w => w.sector === q.sector)
            if (!alreadyAdded) weightedQueries.push(q)
          }
        }
        const effectiveQueries = weightedQueries.length > 0 ? weightedQueries : SECTOR_QUERIES

        // Index global de combo (terme de recherche × ville) — couvre tout le marché
        const TOTAL_COMBOS = effectiveQueries.length * OCCITANIE_CITIES.length
        const [comboRow] = await db
          .select({ value: agent_config.value })
          .from(agent_config)
          .where(eq(agent_config.key, 'scrape_combo_index'))

        const combo = parseInt(comboRow?.value ?? '0') % TOTAL_COMBOS
        const queryDef = effectiveQueries[combo % effectiveQueries.length]
        const term = queryDef.term
        const sectorLabel = queryDef.sector
        const cityIndex = Math.floor(combo / effectiveQueries.length) % OCCITANIE_CITIES.length
        scrapedCity = OCCITANIE_CITIES[cityIndex]

        console.log(`[autopilot] Pipeline faible (${pendingCount}). Scraping "${term} ${scrapedCity}" (secteur: ${sectorLabel})...`)

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

        // Candidats : email présent + confiance minimale
        // Triés par score d'opportunité : sans site web + peu d'avis Google = meilleure cible pour Hdigiweb
        const leadsWithEmail = rawLeads
          .filter((l) => l.email && l.email.includes('@') && l.emailConfidence >= 40)
          .sort((a, b) => {
            const scoreA = (a.website ? 0 : 30) + Math.max(0, 20 - (a.reviewsCount ?? 20))
            const scoreB = (b.website ? 0 : 30) + Math.max(0, 20 - (b.reviewsCount ?? 20))
            return scoreB - scoreA // plus haut score en premier
          })

        const skippedLowConfidence = rawLeads.filter(
          (l) => l.email && l.emailConfidence < 40
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
                sector: sectorLabel,
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

            // Audit site web — détecte les failles techniques pour personnaliser l'email
            if (lead.website) {
              try {
                const { auditWebsite } = await import('@/lib/website-audit')
                const audit = await Promise.race([
                  auditWebsite(lead.website, sectorLabel),
                  new Promise<null>(r => setTimeout(() => r(null), 6000)),
                ])
                if (audit) {
                  await db.update(contacts).set({
                    audit_score: audit.score,
                    audit_level: audit.level,
                    audit_weaknesses: audit.weaknesses,
                    audit_cms: audit.cms ?? null,
                    audit_done: true,
                  }).where(eq(contacts.id, inserted.id))
                }
              } catch { /* non-bloquant */ }
            }

            // VALIDATION FAIL-CLOSED : on n'envoie QUE si on est sûr de l'adresse.
            // Base : confiance >= 70 (mailto explicite / préfixe pro sur le domaine
            // = email réellement publié par l'entreprise, bounce très rare).
            // MillionVerifier affine : "ok" => sûr ; invalid/catch_all/disposable => jeté ;
            // si MV indispo (erreur, crédits épuisés, timeout) => on garde la règle de confiance.
            let emailOk = lead.emailConfidence >= 70
            // On n'interroge MillionVerifier QUE pour les emails incertains (<70).
            // Les emails >=70 (mailto publié) sont déjà sûrs → on évite un appel réseau
            // inutile par lead (gros gain de temps, évite les timeouts cron).
            if (hasMillionVerifier && lead.emailConfidence < 70) {
              try {
                const mvResp = await fetch(
                  `https://api.millionverifier.com/api/v3/?api=${process.env.MILLION_VERIFIER_API_KEY}&email=${encodeURIComponent(lead.email!)}`,
                  { signal: AbortSignal.timeout(5000) }
                )
                if (mvResp.ok) {
                  const mvData = (await mvResp.json()) as { result?: string }
                  const r = mvData.result
                  if (r === 'ok') {
                    emailOk = true
                    await db.update(contacts)
                      .set({ email_validated: true, email_confidence_score: 99 })
                      .where(eq(contacts.id, inserted.id))
                  } else if (r === 'invalid' || r === 'catch_all' || r === 'disposable') {
                    emailOk = false // MV formel → on jette, même si haute confiance
                    console.log(`[autopilot] Email rejeté par MV (${r}) : ${lead.email}`)
                  }
                  // r === 'error' (crédits) / 'unknown' → on s'en tient à la confiance
                }
              } catch {
                // MV indisponible → on s'en tient à la règle de confiance (>= 70)
              }
            }

            // Pas sûr → on garde le contact en base (pour ne pas le re-scraper) mais on
            // ne l'envoie PAS. Évite les bounces "adresse introuvable".
            if (!emailOk) {
              console.log(`[autopilot] Email non envoyé (non vérifié, confiance ${lead.emailConfidence}) : ${lead.email}`)
              continue
            }

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

        if (skippedLowConfidence > 0) {
          console.log(`[autopilot] ${skippedLowConfidence} emails écartés (confiance < 40)`)
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
                    to: (process.env.CLIENT_NOTIFY_EMAIL ?? 'smma.ranked@gmail.com').split(',').map(s => s.trim()).filter(Boolean),
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

  // ─── ÉTAPE 3 : Génération + mise en FILE (moteur d'envoi MAISON) ───────────
  // On ne pousse PLUS vers Instantly (limite dure de leads, partagée/saturée).
  // Pour chaque nouveau contact (ligne step 0 'pending', audité + email fiable),
  // on génère la séquence de 4 emails sur-mesure et on insère 4 lignes dans
  // email_queue (J+0/J+3/J+7/J+14, status 'queued'). Le cron send-campaign envoie
  // ensuite ces lignes via nos boîtes Google chauffées (SMTP), sans limite de leads.
  // Instantly ne sert plus qu'au WARMUP.
  try {
    const activeCampaigns = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, 'active'))

    for (const campaign of activeCampaigns) {
      const now = new Date()
      // Délais entre étapes (jours). Par défaut [0, 3, 7, 14].
      const delays = ((campaign.sequence_delay_days as number[] | null) ?? [0, 3, 7, 14])

      // Nouveaux contacts à préparer : ligne step 0 'pending', déjà auditée + email fiable.
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
            eq(email_queue.sequence_step, 0),
            lte(email_queue.scheduled_at!, now),
            // GARANTIE QUALITÉ : on ne prépare QUE des contacts déjà audités.
            // Les non-audités attendent que le cron audit-sites les traite → l'IA
            // aura toujours un vrai défaut à citer, jamais de mail générique.
            eq(contacts.audit_done, true),
            // GARANTIE DÉLIVRABILITÉ : on prépare si l'email est SÛR (email cliquable
            // publié sur leur site, confiance >= 90) OU validé par MillionVerifier.
            // Les emails INCERTAINS (préfixe deviné) attendent MV → pas de bounce.
            or(
              gte(contacts.email_confidence_score, 90),
              eq(contacts.email_validated, true),
            ),
          )
        )
        .limit(EMAILS_PER_CAMPAIGN_PER_TICK)

      if (pendingLeads.length === 0) continue

      campaignsProcessed++

      // 1. Pré-filtre : retirer les blocklistés (et annuler leur file restante)
      const candidates: typeof pendingLeads = []
      for (const row of pendingLeads) {
        // Filtre FAKE EMAILS : ne jamais envoyer à nom@exemple.fr, test@..., etc.
        // (ça bounce → abîme la réputation). On annule leur file.
        if (isFakeEmail(row.contact.email)) {
          await db.update(email_queue).set({ status: 'cancelled' })
            .where(and(eq(email_queue.contact_id, row.contact.id), eq(email_queue.status, 'pending')))
          console.log(`[autopilot] Email bidon ignoré : ${row.contact.email}`)
          continue
        }
        const [blocked] = await db
          .select({ id: blocklist.id })
          .from(blocklist)
          .where(eq(blocklist.email, row.contact.email))
          .limit(1)
        if (blocked) {
          await db.update(email_queue).set({ status: 'cancelled' })
            .where(and(eq(email_queue.contact_id, row.contact.id), eq(email_queue.status, 'pending')))
          continue
        }
        candidates.push(row)
      }

      // Poids des variantes d'angle (auto-apprentissage) — lus une fois par tick.
      const { MESSAGE_VARIANTS, VARIANT_IDS, WEIGHTS_KEYS, weightedPick, getWeights } = await import('@/lib/experiments')
      const variantWeights = await getWeights(WEIGHTS_KEYS.variant)

      // 2. Générer la SÉQUENCE COMPLÈTE (4 emails adaptés au métier) par lead, en parallèle.
      //    1 appel IA par lead → tous les emails (initial + relances) sont sur-mesure et par secteur.
      const prepared = await Promise.all(candidates.map(async ({ queue, contact }) => {
        try {
          const inbox = await getNextInbox()
          const lead = {
            id: contact.id, company: contact.company, contact: contact.name ?? '',
            firstName: contact.name?.split(' ')[0] ?? '', email: contact.email,
            phone: contact.phone ?? undefined, city: contact.city ?? '',
            website: contact.website ?? undefined, googleRating: contact.google_rating ?? undefined,
            googleReviews: contact.google_reviews_count ?? undefined,
            specialty: contact.sector ? [contact.sector] : [] as string[],
            hasGoogleAds: false, hasWebsite: Boolean(contact.website),
            auditScore: contact.audit_score ?? undefined,
            auditLevel: contact.audit_level ?? undefined,
            auditWeaknesses: contact.audit_weaknesses ?? undefined,
            auditCms: contact.audit_cms ?? undefined,
            stage: 'contacted' as const, thread: [] as never[],
            createdAt: contact.created_at?.toISOString() ?? new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
          }
          // Tire une variante d'angle pondérée (l'agent teste et favorise les gagnantes).
          const variantId = weightedPick(VARIANT_IDS, variantWeights)
          const variantInstruction = MESSAGE_VARIANTS.find(v => v.id === variantId)?.instruction

          let emails: Array<{ subject: string; body: string }> = []
          try {
            emails = await generateSequence(lead, inbox.email, inbox.senderName, variantInstruction)
          } catch {
            // Repli : email initial seul (sector-aware), sinon template
            try {
              emails = [await generateEmail(lead, 'initial', inbox.email, inbox.senderName)]
            } catch {
              const tpl = getSequenceStep(0)
              const vars = { firstName: lead.firstName, city: lead.city, company: lead.company, fromEmail: inbox.email, fromName: inbox.senderName }
              emails = tpl ? [{ subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars) }] : []
            }
          }

          // CRITIQUE — garantir EXACTEMENT 4 emails NON VIDES.
          // Le template Instantly a 4 étapes ({{body}}..{{body4}}). Si une relance
          // manque ou a un body vide, Instantly envoie un mail VIDE au prospect.
          // On comble chaque trou par le template officiel (jamais de vide).
          const tplVars = { firstName: lead.firstName, city: lead.city, company: lead.company, fromEmail: inbox.email, fromName: inbox.senderName }
          const isValid = (e?: { subject: string; body: string }) =>
            Boolean(e && e.body && e.body.trim().length >= 20 && e.subject && e.subject.trim().length > 0)
          const filled: Array<{ subject: string; body: string }> = []
          for (let i = 0; i < 4; i++) {
            if (isValid(emails[i])) {
              filled.push(emails[i])
            } else {
              const tpl = getSequenceStep(i)
              if (tpl) filled.push({ subject: renderTemplate(tpl.subject, tplVars), body: renderTemplate(tpl.body, tplVars) })
            }
          }
          // L'email INITIAL doit absolument être valide, sinon on n'envoie pas
          // (le lead reste pending et sera retenté au prochain tick).
          if (!isValid(filled[0])) {
            console.warn(`[autopilot-tick] Email initial vide pour ${contact.email} — lead gardé pending`)
            return null
          }
          return { queue, contact, inbox, emails: filled, variantId }
        } catch (e) {
          console.error('[autopilot-tick] prep error', contact.email, e)
          return null
        }
      }))

      // 3. Mettre en FILE (moteur maison) : on réutilise la ligne step 0 existante
      //    pour l'email initial, et on insère 3 lignes planifiées pour les relances.
      //    Rien n'est envoyé ici — send-campaign draine la file via SMTP.
      for (const item of prepared) {
        if (!item || item.emails.length === 0) continue
        const { queue, contact, inbox, emails, variantId } = item
        try {
          // Étape 0 (initial) : réutilise la ligne 'pending' existante → 'queued', J+0.
          await db.update(email_queue)
            .set({
              status: 'queued',
              from_email: inbox.email,
              subject: emails[0].subject,
              body: emails[0].body,
              variant_id: variantId,
              scheduled_at: now,
            })
            .where(eq(email_queue.id, queue.id))

          // Étapes 1..3 (relances) : nouvelles lignes planifiées J+delays[i].
          for (let i = 1; i < emails.length; i++) {
            const dayOffset = delays[i] ?? [0, 3, 7, 14][i] ?? i * 3
            const when = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000)
            await db.insert(email_queue).values({
              contact_id: contact.id,
              campaign_id: campaign.id,
              sequence_step: i,
              from_email: inbox.email,
              subject: emails[i].subject,
              body: emails[i].body,
              status: 'queued',
              scheduled_at: when,
              variant_id: variantId,
            })
          }

          await db.insert(dashboard_events).values({
            type: 'email_queued',
            data: {
              contactId: contact.id, contactEmail: contact.email, company: contact.company,
              city: contact.city, campaignId: campaign.id, campaignName: campaign.name,
              steps: emails.length, fromEmail: inbox.email, subject: emails[0].subject,
            },
          })
          queued++
        } catch (err) {
          console.error('[autopilot-tick] Error queueing lead', queue.id, err)
          if (!firstSendError) firstSendError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }
      }
    }
  } catch (err) {
    console.error('[autopilot-tick] Fatal error in email sending', err)
    return NextResponse.json({
      queued,
      campaigns_processed: campaignsProcessed,
      leads_scraped: leadsScraped,
      scraped_city: scrapedCity,
      agent_decisions: agentDecisions,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  return NextResponse.json({
    queued,
    campaigns_processed: campaignsProcessed,
    leads_scraped: leadsScraped,
    scraped_city: scrapedCity || null,
    agent_decisions: agentDecisions,
    first_send_error: firstSendError,
  })
}
