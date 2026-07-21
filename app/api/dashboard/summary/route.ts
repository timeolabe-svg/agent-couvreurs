import { NextResponse } from 'next/server'

// Prix facturé par RDV généré (accord Hdigiweb). À mettre à jour si le tarif change.
const PRIX_PAR_RDV = 80
export const dynamic = 'force-dynamic'

function getMockSummary() {
  const rdvThisMonth = 12
  const revenue = rdvThisMonth * PRIX_PAR_RDV

  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)

  const weekCalendar = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const dayNames = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']
    return {
      date: d.toISOString().slice(0, 10),
      dayName: dayNames[d.getDay()],
      rdvCount: i === 2 ? 1 : i === 4 ? 2 : 0,
    }
  })

  const emailsSentThisWeek = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return { date: d.toISOString().slice(0, 10), count: Math.floor(Math.random() * 30) + 5 }
  })

  return {
    totalEmailsSent: 847,
    totalReplies: 63,
    totalRdv: 12,
    totalSigned: 3,
    emailsSentToday: 22,
    repliesToday: 4,
    rdvToday: 1,
    rdvThisWeek: 5,
    rdvThisMonth,
    draftsAwaitingValidation: 3,
    replyRate: 7.4,
    rdvRate: 19.0,
    activeCampaigns: 2,
    totalCampaigns: 3,
    lastTickMinutesAgo: 8,
    revenue_this_month: revenue,
    // new fields
    repliesReceived: 63,
    clientsSigned: 3,
    emailsSentThisWeek,
    replyRateVsLastWeek: 12,
    pendingFollowups: 4,
    weekCalendar,
    topCampaigns: [
      { name: 'Couvreurs IDF — Relance Q2', sentThisMonth: 234, replyRate: 7.7, rdvCount: 5, status: 'active' },
      { name: 'Couvreurs Lyon — Initial', sentThisMonth: 98, replyRate: 4.1, rdvCount: 2, status: 'active' },
      { name: 'Toitures Nord — Test A/B', sentThisMonth: 45, replyRate: 0, rdvCount: 0, status: 'paused' },
    ],
    recentActivity: [
      { id: 'a1', type: 'rdv_created', time: '09:42', text: 'RDV pris avec Couverture Martin', daysAgo: 0, created_at: new Date().toISOString() },
      { id: 'a2', type: 'reply_received', time: '08:15', text: 'Réponse reçue de Toitures Vidal & Fils', daysAgo: 0, created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'a3', type: 'email_sent', time: '07:30', text: 'Email envoyé à Couverture Roussel', daysAgo: 0, created_at: new Date(Date.now() - 7200000).toISOString() },
      { id: 'a4', type: 'email_sent', time: '06:00', text: 'Email envoyé à Toitures Dupont', daysAgo: 1, created_at: new Date(Date.now() - 86400000).toISOString() },
    ],
    weeklyLearning: null,
    revenue,
    monthlyHistory: [
      { month: 'Mai 2026', rdv: 8, revenue: 400 },
      { month: 'Avril 2026', rdv: 5, revenue: 250 },
      { month: 'Mars 2026', rdv: 3, revenue: 150 },
    ],
    recentEvents: [
      {
        id: 'e1',
        type: 'rdv_created',
        data: { company: 'Toiture Carpentier', scheduledAt: new Date().toISOString() },
        created_at: new Date().toISOString(),
      },
      {
        id: 'e2',
        type: 'reply_received',
        data: { company: 'Toitures Vidal & Fils', classification: 'rdv_request' },
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 'e3',
        type: 'email_sent',
        data: { company: 'Couverture Roussel', step: 'initial' },
        created_at: new Date(Date.now() - 7200000).toISOString(),
      },
    ],
    pendingDrafts: [
      { id: 'd1', company: 'Toitures Vidal & Fils', classification: 'rdv_request', created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'd2', company: 'Couverture Martin', classification: 'interest', created_at: new Date(Date.now() - 7200000).toISOString() },
    ],
    upcomingRdvs: [
      { id: 'r1', company: 'Toiture Carpentier', scheduled_at: new Date(Date.now() + 86400000).toISOString() },
      { id: 'r2', company: 'Toitures Vidal & Fils', scheduled_at: new Date(Date.now() + 172800000).toISOString() },
    ],
    dailyActivity: emailsSentThisWeek.map(d => ({ date: d.date, sent: d.count, replies: 0 })),
    pipeline: {
      prospects: 847,
      contacted: 234,
      replied: 63,
      rdv: 12,
      signed: 3,
    },
    _demo: true,
  }
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(getMockSummary())
  }

  const { db } = await import('@/lib/db')
  const {
    email_queue, incoming_replies, reply_drafts, rdv, contacts,
    dashboard_events, campaigns, agent_config, learning_reports,
  } = await import('@/lib/db/schema')
  const { count, eq, gte, and, desc, sql, lte, ne, or, isNull } = await import('drizzle-orm')

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1) // borne haute "aujourd'hui" (demain 00:00)

  // This week Mon..Sun
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  // This month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // Last week
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(weekStart.getDate() - 7)
  const lastWeekEnd = new Date(weekStart)

  const [
    [{ totalEmailsSent }],
    [{ totalReplies }],
    [{ totalRdv }],
    [{ totalSigned }],
    [{ emailsSentToday }],
    [{ repliesToday }],
    [{ rdvToday }],
    [{ draftsAwaitingValidation }],
    [{ totalContacts }],
    [{ rdvThisMonth }],
    [{ repliesReceived }],
    [{ clientsSigned }],
    [{ pendingFollowups }],
    recentEvents,
    pendingDraftsRaw,
    upcomingRdvsRaw,
    activeCampaignsCount,
    totalCampaignsCount,
    lastTickRow,
    weeklyLearningRaw,
  ] = await Promise.all([
    db.select({ totalEmailsSent: count() }).from(email_queue).where(eq(email_queue.status, 'sent')),
    // Nombre de PERSONNES distinctes ayant vraiment répondu (hors spam et auto-répondeurs)
    // — pas le nombre de messages : un prospect qui répond 3 fois compte 1.
    db.select({ totalReplies: sql<number>`count(distinct lower(from_email))::int` }).from(incoming_replies).where(
      or(isNull(incoming_replies.classification), and(ne(incoming_replies.classification, 'spam'), ne(incoming_replies.classification, 'oof')))
    ),
    db.select({ totalRdv: count() }).from(rdv).where(ne(rdv.status, 'proposed')),
    db.select({ totalSigned: count() }).from(rdv).where(eq(rdv.status, 'signed')),
    db.select({ emailsSentToday: count() }).from(email_queue).where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, todayStart))),
    db.select({ repliesToday: sql<number>`count(distinct lower(from_email))::int` }).from(incoming_replies).where(and(
      gte(incoming_replies.created_at, todayStart),
      or(isNull(incoming_replies.classification), and(ne(incoming_replies.classification, 'spam'), ne(incoming_replies.classification, 'oof'))),
    )),
    db.select({ rdvToday: count() }).from(rdv).where(and(gte(rdv.scheduled_at, todayStart), sql`${rdv.scheduled_at} < ${todayEnd}`, ne(rdv.status, 'proposed'))),
    db.select({ draftsAwaitingValidation: count() }).from(reply_drafts).where(eq(reply_drafts.status, 'pending')),
    db.select({ totalContacts: count() }).from(contacts),
    db.select({ rdvThisMonth: count() }).from(rdv).where(and(gte(rdv.created_at, monthStart), ne(rdv.status, 'proposed'))),
    // repliesReceived ce mois = PERSONNES distinctes ayant répondu (hors spam / auto-répondeurs)
    db.select({ repliesReceived: sql<number>`count(distinct lower(from_email))::int` }).from(incoming_replies).where(and(
      gte(incoming_replies.created_at, monthStart),
      or(isNull(incoming_replies.classification), and(ne(incoming_replies.classification, 'spam'), ne(incoming_replies.classification, 'oof'))),
    )),
    // clientsSigned this month
    db.select({ clientsSigned: count() }).from(rdv).where(and(eq(rdv.status, 'signed'), gte(rdv.created_at, monthStart))),
    // pendingFollowups: pending emails scheduled within next 24h
    db.select({ pendingFollowups: count() }).from(email_queue).where(
      and(
        eq(email_queue.status, 'pending'),
        gte(email_queue.scheduled_at, now),
        lte(email_queue.scheduled_at, new Date(now.getTime() + 86400000)),
      )
    ),
    db.select().from(dashboard_events).orderBy(desc(dashboard_events.created_at)).limit(10),
    // Pending drafts with company info
    db.select({
      id: reply_drafts.id,
      classification: incoming_replies.classification,
      created_at: reply_drafts.created_at,
      company: contacts.company,
      from_email: incoming_replies.from_email,
    })
      .from(reply_drafts)
      .innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
      .leftJoin(contacts, eq(incoming_replies.contact_id, contacts.id))
      .where(eq(reply_drafts.status, 'pending'))
      .orderBy(desc(reply_drafts.created_at))
      .limit(5),
    // Upcoming RDVs
    db.select({ id: rdv.id, scheduled_at: rdv.scheduled_at, company: contacts.company })
      .from(rdv)
      .leftJoin(contacts, eq(rdv.contact_id, contacts.id))
      .where(and(gte(rdv.scheduled_at, now), eq(rdv.status, 'confirmed')))
      .orderBy(rdv.scheduled_at)
      .limit(3),
    // Active campaigns
    db.select({ cnt: count() }).from(campaigns).where(eq(campaigns.status, 'active')),
    db.select({ cnt: count() }).from(campaigns),
    // Last tick from dashboard_events
    db.select({ created_at: dashboard_events.created_at })
      .from(dashboard_events)
      .where(eq(dashboard_events.type, 'agent_decision'))
      .orderBy(desc(dashboard_events.created_at))
      .limit(1),
    // Latest learning report
    db.select().from(learning_reports).orderBy(desc(learning_reports.created_at)).limit(1),
  ])

  // RDV this week
  const weekRdvRows = await db
    .select({ scheduled_at: rdv.scheduled_at })
    .from(rdv)
    .where(and(gte(rdv.scheduled_at, weekStart), sql`${rdv.scheduled_at} < ${weekEnd}`, ne(rdv.status, 'proposed')))
  const rdvThisWeek = weekRdvRows.length

  // Daily activity last 7 days (for bar chart)
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const sentPerDay = await db
    .select({
      date: sql<string>`DATE(${email_queue.sent_at})`,
      cnt: count(),
    })
    .from(email_queue)
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, sevenDaysAgo)))
    .groupBy(sql`DATE(${email_queue.sent_at})`)

  const sentMap = Object.fromEntries(sentPerDay.map(r => [r.date, r.cnt]))
  const dailyActivity = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo)
    d.setDate(sevenDaysAgo.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    return { date: dateStr, sent: sentMap[dateStr] ?? 0, replies: 0 }
  })

  const emailsSentThisWeek = dailyActivity.map(d => ({ date: d.date, count: d.sent }))

  // Last tick minutes ago
  let lastTickMinutesAgo: number | null = null
  if (lastTickRow.length > 0 && lastTickRow[0].created_at) {
    lastTickMinutesAgo = Math.floor((now.getTime() - new Date(lastTickRow[0].created_at).getTime()) / 60000)
  }

  if (lastTickMinutesAgo === null) {
    const lastTickConfig = await db.select().from(agent_config).where(eq(agent_config.key, 'last_tick_at')).limit(1)
    if (lastTickConfig[0]) {
      lastTickMinutesAgo = Math.floor((now.getTime() - new Date(lastTickConfig[0].updated_at!).getTime()) / 60000)
    }
  }

  // Reply rate vs last week
  const [lastWeekSent] = await db
    .select({ cnt: count() })
    .from(email_queue)
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, lastWeekStart), sql`${email_queue.sent_at} < ${lastWeekEnd}`))
  const [lastWeekReplies] = await db
    .select({ cnt: count() })
    .from(incoming_replies)
    .where(and(gte(incoming_replies.created_at, lastWeekStart), sql`${incoming_replies.created_at} < ${lastWeekEnd}`))

  const contacted = totalEmailsSent
  const replied = totalReplies
  const replyRate = contacted > 0 ? +((replied / contacted) * 100).toFixed(1) : 0
  const rdvRate = replied > 0 ? +((totalRdv / replied) * 100).toFixed(1) : 0

  const lastWeekRate = lastWeekSent.cnt > 0 ? (lastWeekReplies.cnt / lastWeekSent.cnt) * 100 : 0
  const thisWeekSentRows = await db
    .select({ cnt: count() })
    .from(email_queue)
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, weekStart), sql`${email_queue.sent_at} < ${weekEnd}`))
  const thisWeekRepliesRows = await db
    .select({ cnt: count() })
    .from(incoming_replies)
    .where(and(gte(incoming_replies.created_at, weekStart), sql`${incoming_replies.created_at} < ${weekEnd}`))
  const thisWeekRate = thisWeekSentRows[0]?.cnt > 0
    ? (thisWeekRepliesRows[0]?.cnt / thisWeekSentRows[0]?.cnt) * 100
    : 0
  const replyRateVsLastWeek = lastWeekRate > 0
    ? +((((thisWeekRate - lastWeekRate) / lastWeekRate) * 100).toFixed(1))
    : 0

  // Week calendar
  const dayNames = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']
  const rdvThisWeekRows = await db
    .select({ scheduled_at: rdv.scheduled_at })
    .from(rdv)
    .where(and(gte(rdv.scheduled_at, weekStart), sql`${rdv.scheduled_at} < ${weekEnd}`, ne(rdv.status, 'proposed')))

  const rdvByDate: Record<string, number> = {}
  for (const r of rdvThisWeekRows) {
    const d = new Date(r.scheduled_at).toISOString().slice(0, 10)
    rdvByDate[d] = (rdvByDate[d] ?? 0) + 1
  }

  const weekCalendar = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    return {
      date: dateStr,
      dayName: dayNames[d.getDay()],
      rdvCount: rdvByDate[dateStr] ?? 0,
    }
  })

  // Top campaigns
  const campaignsRaw = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status })
    .from(campaigns)
    .orderBy(desc(campaigns.created_at))
    .limit(5)

  const topCampaigns = await Promise.all(
    campaignsRaw.map(async (c) => {
      const [{ sentThisMonth }] = await db
        .select({ sentThisMonth: count() })
        .from(email_queue)
        .where(and(eq(email_queue.campaign_id, c.id), eq(email_queue.status, 'sent'), gte(email_queue.sent_at, monthStart)))
      const [{ rdvCnt }] = await db
        .select({ rdvCnt: count() })
        .from(rdv)
        .where(and(eq((rdv as typeof rdv & { campaign_id?: unknown }).campaign_id as Parameters<typeof eq>[0], c.id), gte(rdv.created_at, monthStart), ne(rdv.status, 'proposed')))
        .catch(() => [{ rdvCnt: 0 }])
      // TAUX DE RÉPONSE de CETTE campagne (avant : numérateur = TOUTES les réponses du mois, non
      // filtré campagne ni spam → taux > 100% aberrant). Numérateur = PERSONNES distinctes ayant
      // répondu parmi les contacts de la campagne (hors spam/oof) ; dénominateur = contacts
      // distincts réellement contactés ce mois. Cap 100% par sécurité.
      const [{ repliedPersons }] = await db
        .select({ repliedPersons: sql<number>`count(distinct lower(${incoming_replies.from_email}))::int` })
        .from(incoming_replies)
        .where(and(
          gte(incoming_replies.created_at, monthStart),
          or(isNull(incoming_replies.classification), and(ne(incoming_replies.classification, 'spam'), ne(incoming_replies.classification, 'oof'))),
          sql`EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = ${incoming_replies.contact_id} AND eq.campaign_id = ${c.id} AND eq.status = 'sent')`,
        ))
      const [{ sentContacts }] = await db
        .select({ sentContacts: sql<number>`count(distinct ${email_queue.contact_id})::int` })
        .from(email_queue)
        .where(and(eq(email_queue.campaign_id, c.id), eq(email_queue.status, 'sent'), gte(email_queue.sent_at, monthStart)))
      const rr = sentContacts > 0 ? Math.min(100, +((repliedPersons / sentContacts) * 100).toFixed(1)) : 0
      return {
        name: c.name,
        sentThisMonth,
        replyRate: rr,
        rdvCount: rdvCnt ?? 0,
        status: c.status ?? 'draft',
      }
    })
  ).catch(() => [] as { name: string; sentThisMonth: number; replyRate: number; rdvCount: number; status: string }[])

  // Recent activity
  const recentActivity = recentEvents.slice(0, 10).map(ev => {
    const d = ev.data as Record<string, unknown>
    let text = ''
    const time = new Date(ev.created_at!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const diffDays = Math.floor((now.getTime() - new Date(ev.created_at!).getTime()) / 86400000)
    if (ev.type === 'rdv_created') text = `RDV pris avec ${String(d?.company ?? '')}`
    else if (ev.type === 'email_sent') text = `Email envoyé à ${String(d?.company ?? '')}`
    else if (ev.type === 'reply_received') text = `Réponse reçue de ${String(d?.company ?? d?.from_email ?? '')}`
    else text = String(d?.message ?? ev.type)
    return {
      id: ev.id,
      type: ev.type,
      time,
      text,
      daysAgo: diffDays,
      created_at: ev.created_at!.toISOString(),
    }
  })

  const pendingDrafts = pendingDraftsRaw.map(r => ({
    id: r.id,
    company: r.company ?? r.from_email,
    classification: r.classification ?? 'unknown',
    created_at: r.created_at?.toISOString() ?? new Date().toISOString(),
  }))

  const upcomingRdvs = upcomingRdvsRaw.map(r => ({
    id: r.id,
    company: r.company ?? 'Contact',
    scheduled_at: r.scheduled_at.toISOString(),
  }))

  // Monthly history — last 6 months RDV + revenue
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const rdvPerMonth = await db
    .select({
      month: sql<string>`TO_CHAR(${rdv.created_at}, 'Month YYYY')`,
      monthKey: sql<string>`TO_CHAR(${rdv.created_at}, 'YYYY-MM')`,
      cnt: count(),
    })
    .from(rdv)
    .where(and(gte(rdv.created_at, sixMonthsAgo), ne(rdv.status, 'proposed')))
    .groupBy(sql`TO_CHAR(${rdv.created_at}, 'Month YYYY'), TO_CHAR(${rdv.created_at}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${rdv.created_at}, 'YYYY-MM') DESC`)

  // Exclude current month from history (shown live in main widget)
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthlyHistory = rdvPerMonth
    .filter(r => r.monthKey !== currentMonthKey)
    .map(r => ({
      month: r.month.trim(),
      rdv: r.cnt,
      revenue: r.cnt * PRIX_PAR_RDV,
    }))

  const weeklyLearning = weeklyLearningRaw[0]
    ? {
        id: weeklyLearningRaw[0].id,
        period_start: weeklyLearningRaw[0].period_start.toISOString(),
        period_end: weeklyLearningRaw[0].period_end.toISOString(),
        emails_sent: weeklyLearningRaw[0].emails_sent,
        reply_rate: weeklyLearningRaw[0].reply_rate,
        rdv_count: weeklyLearningRaw[0].rdv_count,
        top_sectors: weeklyLearningRaw[0].top_sectors,
        top_subject_patterns: weeklyLearningRaw[0].top_subject_patterns,
        recommendations: weeklyLearningRaw[0].recommendations as Record<string, unknown> | null,
        created_at: weeklyLearningRaw[0].created_at!.toISOString(),
      }
    : null

  return NextResponse.json({
    totalEmailsSent,
    totalReplies,
    totalRdv,
    totalSigned,
    emailsSentToday,
    repliesToday,
    rdvToday,
    rdvThisWeek,
    rdvThisMonth,
    draftsAwaitingValidation,
    replyRate,
    rdvRate,
    activeCampaigns: activeCampaignsCount[0]?.cnt ?? 0,
    totalCampaigns: totalCampaignsCount[0]?.cnt ?? 0,
    lastTickMinutesAgo,
    revenue_this_month: rdvThisMonth * PRIX_PAR_RDV,
    // new
    repliesReceived,
    clientsSigned,
    emailsSentThisWeek,
    replyRateVsLastWeek,
    pendingFollowups,
    weekCalendar,
    topCampaigns,
    recentActivity,
    weeklyLearning,
    revenue: rdvThisMonth * PRIX_PAR_RDV,
    monthlyHistory,
    // legacy
    recentEvents,
    pendingDrafts,
    upcomingRdvs,
    dailyActivity,
    pipeline: {
      prospects: totalContacts,
      contacted,
      replied,
      rdv: totalRdv,
      signed: totalSigned,
    },
  })
}
