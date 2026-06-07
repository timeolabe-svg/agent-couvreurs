import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function getMockSummary() {
  return {
    totalEmailsSent: 847,
    totalReplies: 63,
    totalRdv: 12,
    totalSigned: 3,
    emailsSentToday: 22,
    repliesToday: 4,
    rdvToday: 1,
    draftsAwaitingValidation: 3,
    rdvThisWeek: [2, 1, 3, 2, 1, 0, 0],
    replyRate: 7.4,
    rdvRate: 19.0,
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
  const { email_queue, incoming_replies, reply_drafts, rdv, contacts, dashboard_events } =
    await import('@/lib/db/schema')
  const { count, eq, gte, and, desc } = await import('drizzle-orm')
  const { sql } = await import('drizzle-orm')

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // This week Mon..Sun
  const day = now.getDay() // 0=Sun
  const weekStart = new Date(now)
  const diffToMon = day === 0 ? -6 : 1 - day
  weekStart.setDate(now.getDate() + diffToMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

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
    recentEvents,
  ] = await Promise.all([
    db.select({ totalEmailsSent: count() }).from(email_queue).where(eq(email_queue.status, 'sent')),
    db.select({ totalReplies: count() }).from(incoming_replies),
    db.select({ totalRdv: count() }).from(rdv),
    db.select({ totalSigned: count() }).from(rdv).where(eq(rdv.status, 'signed')),
    db
      .select({ emailsSentToday: count() })
      .from(email_queue)
      .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, todayStart))),
    db
      .select({ repliesToday: count() })
      .from(incoming_replies)
      .where(gte(incoming_replies.created_at, todayStart)),
    db
      .select({ rdvToday: count() })
      .from(rdv)
      .where(gte(rdv.scheduled_at, todayStart)),
    db
      .select({ draftsAwaitingValidation: count() })
      .from(reply_drafts)
      .where(eq(reply_drafts.status, 'pending')),
    db.select({ totalContacts: count() }).from(contacts),
    db
      .select()
      .from(dashboard_events)
      .orderBy(desc(dashboard_events.created_at))
      .limit(20),
  ])

  // RDV per weekday (Mon=0..Sun=6)
  const rdvThisWeek = [0, 0, 0, 0, 0, 0, 0]
  const weekRdvs = await db
    .select({ scheduled_at: rdv.scheduled_at })
    .from(rdv)
    .where(and(gte(rdv.scheduled_at, weekStart), sql`${rdv.scheduled_at} < ${weekEnd}`))

  for (const r of weekRdvs) {
    const d = r.scheduled_at.getDay()
    const idx = d === 0 ? 6 : d - 1
    rdvThisWeek[idx]++
  }

  // Counts for pipeline
  const contacted = totalEmailsSent
  const replied = totalReplies

  const replyRate = contacted > 0 ? +((replied / contacted) * 100).toFixed(1) : 0
  const rdvRate = replied > 0 ? +((totalRdv / replied) * 100).toFixed(1) : 0

  return NextResponse.json({
    totalEmailsSent,
    totalReplies,
    totalRdv,
    totalSigned,
    emailsSentToday,
    repliesToday,
    rdvToday,
    draftsAwaitingValidation,
    rdvThisWeek,
    replyRate,
    rdvRate,
    recentEvents,
    pipeline: {
      prospects: totalContacts,
      contacted,
      replied,
      rdv: totalRdv,
      signed: totalSigned,
    },
  })
}
