import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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
  const { contacts, email_queue, incoming_replies, rdv, agent_config, dashboard_events } = await import('@/lib/db/schema')
  const { eq, and, gte, sql, notInArray, inArray } = await import('drizzle-orm')
  const { generateText, extractJson } = await import('@/lib/ai')

  // ─── ÉTAPE 1 : Calcul des métriques par secteur sur 30 derniers jours ────

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Emails envoyés par secteur
  const sentBySector = await db
    .select({
      sector: contacts.sector,
      count: sql<number>`count(*)`,
    })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(
      and(
        eq(email_queue.status, 'sent'),
        gte(email_queue.sent_at!, thirtyDaysAgo)
      )
    )
    .groupBy(contacts.sector)

  // Réponses reçues par secteur (exclure spam/oof)
  const repliesBySector = await db
    .select({
      sector: contacts.sector,
      count: sql<number>`count(*)`,
    })
    .from(incoming_replies)
    .innerJoin(contacts, eq(incoming_replies.contact_id, contacts.id))
    .where(
      and(
        gte(incoming_replies.created_at!, thirtyDaysAgo),
        notInArray(incoming_replies.classification, ['spam', 'oof'])
      )
    )
    .groupBy(contacts.sector)

  // RDV obtenus par secteur
  const rdvBySector = await db
    .select({
      sector: contacts.sector,
      count: sql<number>`count(*)`,
    })
    .from(rdv)
    .innerJoin(contacts, eq(rdv.contact_id, contacts.id))
    .where(gte(rdv.created_at!, thirtyDaysAgo))
    .groupBy(contacts.sector)

  // Construire un objet métriques consolidé par secteur
  const sectorMap: Record<string, { sent: number; replies: number; rdv: number; replyRate: number }> = {}

  for (const row of sentBySector) {
    const s = row.sector ?? 'inconnu'
    if (!sectorMap[s]) sectorMap[s] = { sent: 0, replies: 0, rdv: 0, replyRate: 0 }
    sectorMap[s].sent = Number(row.count)
  }
  for (const row of repliesBySector) {
    const s = row.sector ?? 'inconnu'
    if (!sectorMap[s]) sectorMap[s] = { sent: 0, replies: 0, rdv: 0, replyRate: 0 }
    sectorMap[s].replies = Number(row.count)
  }
  for (const row of rdvBySector) {
    const s = row.sector ?? 'inconnu'
    if (!sectorMap[s]) sectorMap[s] = { sent: 0, replies: 0, rdv: 0, replyRate: 0 }
    sectorMap[s].rdv = Number(row.count)
  }

  // Calcul taux de réponse
  for (const s of Object.keys(sectorMap)) {
    const { sent, replies } = sectorMap[s]
    sectorMap[s].replyRate = sent > 0 ? Math.round((replies / sent) * 1000) / 10 : 0
  }

  const totalSent = Object.values(sectorMap).reduce((acc, v) => acc + v.sent, 0)
  const totalRdv = Object.values(sectorMap).reduce((acc, v) => acc + v.rdv, 0)
  const globalReplyRate = totalSent > 0
    ? Math.round((Object.values(sectorMap).reduce((acc, v) => acc + v.replies, 0) / totalSent) * 1000) / 10
    : 0

  // ─── ÉTAPE 2 : Lire la config actuelle ────────────────────────────────────

  const [promptAddonRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'system_prompt_addon'))
  const [priorityRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'sector_priority_override'))
  const [dailyLimitRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'last_daily_capacity'))

  const currentPromptAddon = promptAddonRow?.value ?? ''
  const currentPriorities = priorityRow?.value ?? '{}'
  const currentDailyLimit = parseInt(dailyLimitRow?.value ?? '0')

  // ─── ÉTAPE 3 : Appel Gemini pour décisions stratégiques ───────────────────

  const metricsText = Object.entries(sectorMap)
    .map(([s, m]) => `${s}: ${m.sent} envoyés, ${m.replies} réponses (${m.replyRate}%), ${m.rdv} RDV`)
    .join('\n')

  const geminiPrompt = `Tu es l'agent stratège de Hdigiweb, une agence web qui prospecte des artisans BTP en France.

Données des 30 derniers jours :
${metricsText || 'Pas encore de données disponibles.'}

Total : ${totalSent} emails envoyés, taux de réponse global ${globalReplyRate}%, ${totalRdv} RDV obtenus.

Secteurs disponibles dans le système : couvreur, terrassier, pisciniste, maçon, électricien, plombier, peintre, menuisier.

Objectif : 20-30 RDV/mois.

Config actuelle :
- Priorités secteurs : ${currentPriorities}
- Limite quotidienne courante : ${currentDailyLimit} emails/jour
- Addon prompt actuel : ${currentPromptAddon ? currentPromptAddon.slice(0, 200) + '...' : '(vide)'}

Analyse et décide en JSON STRICT (pas de texte avant ou après) :
{
  "sector_priorities": {
    "couvreur": <0-10>,
    "terrassier": <0-10>,
    "pisciniste": <0-10>,
    "maçon": <0-10>,
    "électricien": <0-10>,
    "plombier": <0-10>,
    "peintre": <0-10>,
    "menuisier": <0-10>
  },
  "prompt_addon": "<instruction courte si changement de style nécessaire, sinon vide>",
  "raise_daily_limit": <true si reply rate >= 1.5% et volume stable, sinon false>,
  "decisions_summary": ["<décision 1>", "<décision 2>", "<décision 3 max>"]
}`

  let geminiDecision: {
    sector_priorities: Record<string, number>
    prompt_addon: string
    raise_daily_limit: boolean
    decisions_summary: string[]
  } | null = null

  try {
    const text = await generateText({
      prompt: geminiPrompt,
      maxTokens: 600,
      temperature: 0.3,
    })
    console.log('[strategy-agent] Gemini raw response:', text.slice(0, 500))
    geminiDecision = extractJson(text)
  } catch (err) {
    console.error('[strategy-agent] Gemini call failed:', err)
    return NextResponse.json({
      error: 'Gemini decision failed',
      metrics: sectorMap,
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  if (!geminiDecision) {
    return NextResponse.json({ error: 'No decision from Gemini' }, { status: 500 })
  }

  // ─── ÉTAPE 4 : Appliquer les décisions ────────────────────────────────────

  const applied: string[] = []

  // 4a. Mettre à jour sector_priority_override
  const newPriorities = JSON.stringify(geminiDecision.sector_priorities)
  await db.insert(agent_config)
    .values({ key: 'sector_priority_override', value: newPriorities, updated_by: 'auto_learning' })
    .onConflictDoUpdate({
      target: agent_config.key,
      set: { value: newPriorities, updated_by: 'auto_learning', updated_at: new Date() },
    })
  applied.push('Priorités secteurs mises à jour')

  // 4b. Mettre à jour system_prompt_addon si Gemini suggère un changement
  if (geminiDecision.prompt_addon && geminiDecision.prompt_addon.trim()) {
    await db.insert(agent_config)
      .values({ key: 'system_prompt_addon', value: geminiDecision.prompt_addon.trim(), updated_by: 'auto_learning' })
      .onConflictDoUpdate({
        target: agent_config.key,
        set: { value: geminiDecision.prompt_addon.trim(), updated_by: 'auto_learning', updated_at: new Date() },
      })
    applied.push('Prompt addon mis à jour')
  }

  // 4c. Augmenter la limite d'envoi Instantly si recommandé
  if (geminiDecision.raise_daily_limit && process.env.INSTANTLY_INBOXES && process.env.INSTANTLY_API_KEY) {
    const inboxes = process.env.INSTANTLY_INBOXES.split(',').map(s => s.trim()).filter(Boolean)
    const currentPerInbox = currentDailyLimit > 0 ? Math.floor(currentDailyLimit / Math.max(inboxes.length, 1)) : 20
    const newPerInbox = Math.min(currentPerInbox + 2, 30)

    for (const inboxEmail of inboxes) {
      try {
        const resp = await fetch(`https://api.instantly.ai/api/v2/accounts/${encodeURIComponent(inboxEmail)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
          },
          body: JSON.stringify({ daily_limit: newPerInbox }),
        })
        if (!resp.ok) {
          console.error(`[strategy-agent] Instantly PATCH failed for ${inboxEmail}: ${resp.status}`)
        }
      } catch (e) {
        console.error(`[strategy-agent] Instantly PATCH error for ${inboxEmail}:`, e)
      }
    }
    applied.push(`Limite Instantly augmentée à ${newPerInbox} emails/boîte/jour`)
  }

  // 4d. Insérer un dashboard_event agent_decision
  await db.insert(dashboard_events).values({
    type: 'agent_decision',
    data: {
      decision: 'strategy_update',
      metrics: sectorMap,
      sector_priorities: geminiDecision.sector_priorities,
      prompt_addon_changed: Boolean(geminiDecision.prompt_addon?.trim()),
      raise_daily_limit: geminiDecision.raise_daily_limit,
      decisions_summary: geminiDecision.decisions_summary,
      applied,
    },
  })

  return NextResponse.json({
    metrics: sectorMap,
    decisions: geminiDecision.decisions_summary,
    applied,
    sector_priorities: geminiDecision.sector_priorities,
    raise_daily_limit: geminiDecision.raise_daily_limit,
  })
}
