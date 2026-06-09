import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Period = '7d' | '30d' | '90d' | 'all'

function getMockAnalytics(period: Period) {
  const multiplier = period === '7d' ? 0.23 : period === '30d' ? 1 : period === '90d' ? 3 : 5
  const emailsSent = Math.round(847 * multiplier)
  const replies = Math.round(63 * multiplier)
  const replyRate = +(replies / emailsSent * 100).toFixed(1)
  const rdvCount = Math.round(12 * multiplier)
  const optouts = Math.round(8 * multiplier)
  const bounces = Math.round(5 * multiplier)
  return {
    period,
    emailsSent,
    replies,
    replyRate,
    optouts,
    bounces,
    rdvCount,
    revenue: rdvCount * 50,
    conversionRate: +(rdvCount / emailsSent * 100).toFixed(2),
    topCities: [
      { city: 'Toulouse', sent: Math.round(180 * multiplier), replies: Math.round(15 * multiplier), replyRate: 8.3, rdv: Math.round(3 * multiplier), revenue: Math.round(3 * multiplier) * 50 },
      { city: 'Montpellier', sent: Math.round(120 * multiplier), replies: Math.round(9 * multiplier), replyRate: 7.5, rdv: Math.round(2 * multiplier), revenue: Math.round(2 * multiplier) * 50 },
      { city: 'Nîmes', sent: Math.round(90 * multiplier), replies: Math.round(7 * multiplier), replyRate: 7.8, rdv: Math.round(2 * multiplier), revenue: Math.round(2 * multiplier) * 50 },
      { city: 'Perpignan', sent: Math.round(75 * multiplier), replies: Math.round(5 * multiplier), replyRate: 6.7, rdv: Math.round(1 * multiplier), revenue: Math.round(1 * multiplier) * 50 },
      { city: 'Carcassonne', sent: Math.round(60 * multiplier), replies: Math.round(4 * multiplier), replyRate: 6.7, rdv: Math.round(1 * multiplier), revenue: Math.round(1 * multiplier) * 50 },
    ],
    dailyActivity: Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (29 - i))
      return { date: d.toISOString().slice(0, 10), sent: Math.floor(Math.random() * 35) + 5, replies: Math.floor(Math.random() * 6) }
    }),
    pipeline: {
      prospects: 312,
      contacted: emailsSent,
      replied: replies,
      rdv: rdvCount,
    },
    bestCity: { city: 'Toulouse', replyRate: 8.3, rdv: Math.round(3 * multiplier) },
    _demo: true,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') ?? '30d') as Period

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(getMockAnalytics(period))
  }

  const { db } = await import('@/lib/db')
  const { email_queue, incoming_replies, rdv, contacts, blocklist } = await import('@/lib/db/schema')
  const { count, eq, gte, and, sql } = await import('drizzle-orm')

  const now = new Date()
  let periodStart: Date | null = null
  if (period === '7d') {
    periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === '30d') {
    periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (period === '90d') {
    periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  }

  const emailConditions = periodStart
    ? and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, periodStart))
    : eq(email_queue.status, 'sent')

  const replyConditions = periodStart
    ? gte(incoming_replies.created_at, periodStart)
    : undefined

  const rdvConditions = periodStart
    ? gte(rdv.created_at, periodStart)
    : undefined

  const [
    [{ emailsSent }],
    [{ replies }],
    [{ rdvCount }],
    [{ optouts }],
  ] = await Promise.all([
    db.select({ emailsSent: count() }).from(email_queue).where(emailConditions),
    db.select({ replies: count() }).from(incoming_replies).where(replyConditions),
    db.select({ rdvCount: count() }).from(rdv).where(rdvConditions),
    db.select({ optouts: count() }).from(blocklist).where(
      periodStart ? gte(blocklist.created_at, periodStart) : undefined
    ),
  ])

  const replyRate = emailsSent > 0 ? +(replies / emailsSent * 100).toFixed(1) : 0
  const revenue = rdvCount * 50
  const conversionRate = emailsSent > 0 ? +(rdvCount / emailsSent * 100).toFixed(2) : 0

  // Top cities
  const citySentRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(emailConditions)
    .groupBy(contacts.city)
    .orderBy(sql`count(*) desc`)
    .limit(10)

  const cityRepliesRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(incoming_replies)
    .innerJoin(contacts, eq(incoming_replies.contact_id, contacts.id))
    .where(replyConditions)
    .groupBy(contacts.city)

  const cityRdvRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(rdv)
    .innerJoin(contacts, eq(rdv.contact_id, contacts.id))
    .where(rdvConditions)
    .groupBy(contacts.city)

  const replyMap = Object.fromEntries(cityRepliesRaw.map(r => [r.city ?? '', r.cnt]))
  const rdvMap = Object.fromEntries(cityRdvRaw.map(r => [r.city ?? '', r.cnt]))

  const topCities = citySentRaw
    .filter(r => r.city)
    .map(r => {
      const city = r.city ?? ''
      const sent = r.cnt
      const cityReplies = replyMap[city] ?? 0
      const cityRdv = rdvMap[city] ?? 0
      return {
        city,
        sent,
        replies: cityReplies,
        replyRate: sent > 0 ? +(cityReplies / sent * 100).toFixed(1) : 0,
        rdv: cityRdv,
        revenue: cityRdv * 50,
      }
    })
    .slice(0, 5)

  // Best city
  const bestCity = topCities.length > 0
    ? topCities.reduce((best, c) => c.replyRate > best.replyRate ? c : best, topCities[0])
    : null

  // Daily activity last 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const dailySentRaw = await db
    .select({ date: sql<string>`DATE(${email_queue.sent_at})`, cnt: count() })
    .from(email_queue)
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, thirtyDaysAgo)))
    .groupBy(sql`DATE(${email_queue.sent_at})`)

  const dailyRepliesRaw = await db
    .select({ date: sql<string>`DATE(${incoming_replies.created_at})`, cnt: count() })
    .from(incoming_replies)
    .where(gte(incoming_replies.created_at, thirtyDaysAgo))
    .groupBy(sql`DATE(${incoming_replies.created_at})`)

  const sentByDay = Object.fromEntries(dailySentRaw.map(r => [r.date, r.cnt]))
  const repliesByDay = Object.fromEntries(dailyRepliesRaw.map(r => [r.date, r.cnt]))

  const dailyActivity = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(thirtyDaysAgo)
    d.setDate(thirtyDaysAgo.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    return { date: dateStr, sent: sentByDay[dateStr] ?? 0, replies: repliesByDay[dateStr] ?? 0 }
  })

  // Pipeline
  const [{ totalContacts }] = await db.select({ totalContacts: count() }).from(contacts)

  return NextResponse.json({
    period,
    emailsSent,
    replies,
    replyRate,
    optouts,
    bounces: 0, // bounced emails not tracked separately yet
    rdvCount,
    revenue,
    conversionRate,
    topCities,
    dailyActivity,
    pipeline: {
      prospects: totalContacts,
      contacted: emailsSent,
      replied: replies,
      rdv: rdvCount,
    },
    bestCity: bestCity ? { city: bestCity.city, replyRate: bestCity.replyRate, rdv: bestCity.rdv } : null,
  })
}
