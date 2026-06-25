import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, incoming_replies, reply_drafts, rdv } = await import('@/lib/db/schema')
  const { desc, inArray, gte } = await import('drizzle-orm')

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Toutes les réponses humaines (pas spam/oof) des 30 derniers jours
  const replies = await db
    .select({
      id: incoming_replies.id,
      contact_id: incoming_replies.contact_id,
      from_email: incoming_replies.from_email,
      subject: incoming_replies.subject,
      body: incoming_replies.body,
      classification: incoming_replies.classification,
      created_at: incoming_replies.created_at,
    })
    .from(incoming_replies)
    .where(gte(incoming_replies.created_at, thirtyDaysAgo))
    .orderBy(desc(incoming_replies.created_at))
    .limit(100)

  const contactIds = [...new Set(replies.map(r => r.contact_id).filter(Boolean) as string[])]
  const contactRows = contactIds.length
    ? await db.select({ id: contacts.id, company: contacts.company, phone: contacts.phone, city: contacts.city, sector: contacts.sector }).from(contacts).where(inArray(contacts.id, contactIds))
    : []
  const contactMap = new Map(contactRows.map(c => [c.id, c]))

  // RDV
  const rdvRows = await db.select().from(rdv).where(gte(rdv.created_at, thirtyDaysAgo)).orderBy(desc(rdv.created_at))

  const result = replies.map(r => ({
    ...r,
    body: r.body?.slice(0, 200),
    contact: r.contact_id ? contactMap.get(r.contact_id) : null,
  }))

  return NextResponse.json({ replies: result, rdv: rdvRows, total: replies.length })
}
