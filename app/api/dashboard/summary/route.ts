import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function getMockSummary() {
  const rdvThisMonth = 12
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
    revenue_this_month: rdvThisMonth * 50,
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
    dailyActivity: Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return { date: d.toISOString().slice(0, 10), sent: Math.floor(Math.random() * 30) + 5, replies: Math.floor(Math.random() * 5) }
    }),
    pipeline: {
      prospects: 312,
      contacted: 847,
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
    dashboard_events, campaigns, agent_config,
  } = await import('@/lib/db/schema')
  const { count, eq, gte, and, desc, sql } = await import('drizzle-orm')

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // This week Mon..Sun
  const day = now.getDay()
  const weekStart = new Date(now)
  const diffToMon = day === 0 ? -6 : 1 - day
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  // This month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

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
    recentEvents,
    pendingDraftsRaw,
    upcomingRdvsRaw,
    activeCampaignsCount,
    totalCampaignsCount,
    lastTickRow,
  ] = await Promise.all([
    db.select({ totalEmailsSent: count() }).from(email_queue).where(eq(email_queue.status, 'sent')),
    db.select({ totalReplies: count() }).from(incoming_replies),
    db.select({ totalRdv: count() }).from(rdv),
    db.select({ totalSigned: count() }).from(rdv).where(eq(rdv.status, 'signed')),
    db.select({ emailsSentToday: count() }).from(email_queue).where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, todayStart))),
    db.select({ repliesToday: count() }).from(incoming_replies).where(gte(incoming_replies.created_at, todayStart)),
    db.select({ rdvToday: count() }).from(rdv).where(gte(rdv.scheduled_at, todayStart)),
    db.select({ draftsAwaitingValidation: count() }).from(reply_drafts).where(eq(reply_drafts.status, 'pending')),
    db.select({ totalContacts: count() }).from(contacts),
    db.select({ rdvThisMonth: count() }).from(rdv).where(gte(rdv.created_at, monthStart)),
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
  ])

  // RDV this week
  const weekRdvRows = await db
    .select({ scheduled_at: rdv.scheduled_at })
    .from(rdv)
    .where(and(gte(rdv.scheduled_at, weekStart), sql`${rdv.scheduled_at} < ${weekEnd}`))
  const rdvThisWeek = weekRdvRows.length

  // Daily activity last 7 days
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

  // Last tick minutes ago
  let lastTickMinutesAgo: number | null = null
  if (lastTickRow.length > 0 && lastTickRow[0].created_at) {
    lastTickMinutesAgo = Math.floor((now.getTime() - new Date(lastTickRow[0].created_at).getTime()) / 60000)
  }

  // Also try agent_config for last tick
  if (lastTickMinutesAgo === null) {
    const lastTickConfig = await db.select().from(agent_config).where(eq(agent_config.key, 'last_tick_at')).limit(1)
    if (lastTickConfig[0]) {
      lastTickMinutesAgo = Math.floor((now.getTime() - new Date(lastTickConfig[0].updated_at!).getTime()) / 60000)
    }
  }

  const contacted = totalEmailsSent
  const replied = totalReplies
  const replyRate = contacted > 0 ? +((replied / contacted) * 100).toFixed(1) : 0
  const rdvRate = replied > 0 ? +((totalRdv / replied) * 100).toFixed(1) : 0

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
    revenue_this_month: rdvThisMonth * 50,
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
