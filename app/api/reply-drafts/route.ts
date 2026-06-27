import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const countOnly = searchParams.get('count') === 'true'
  const statusFilter = searchParams.get('status') ?? 'pending'

  if (!process.env.DATABASE_URL) {
    if (countOnly) return NextResponse.json({ count: 0, _demo: true })
    return NextResponse.json({ drafts: [], _demo: true })
  }

  const { db } = await import('@/lib/db')
  const { reply_drafts, incoming_replies, contacts } = await import('@/lib/db/schema')
  const { eq, and } = await import('drizzle-orm')

  if (countOnly) {
    const rows = await db
      .select({ id: reply_drafts.id })
      .from(reply_drafts)
      .where(eq(reply_drafts.status, 'pending'))
    return NextResponse.json({ count: rows.length })
  }

  const whereClause = statusFilter === 'all'
    ? undefined
    : eq(reply_drafts.status, statusFilter)

  const rows = await db
    .select({
      draft: reply_drafts,
      incomingReply: incoming_replies,
      contact: contacts,
    })
    .from(reply_drafts)
    .leftJoin(incoming_replies, eq(incoming_replies.id, reply_drafts.incoming_reply_id))
    .leftJoin(contacts, eq(contacts.id, incoming_replies.contact_id))
    .where(whereClause)
    .orderBy(reply_drafts.created_at)

  const drafts = rows.map((row) => ({
    id: row.draft.id,
    body: row.draft.body,
    status: row.draft.status,
    created_at: row.draft.created_at,
    incomingReply: row.incomingReply
      ? {
          id: row.incomingReply.id,
          from_email: row.incomingReply.from_email,
          subject: row.incomingReply.subject,
          body: row.incomingReply.body,
          classification: row.incomingReply.classification,
          instantly_reply_id: row.incomingReply.instantly_reply_id,
        }
      : null,
    contact: row.contact
      ? {
          id: row.contact.id,
          name: row.contact.name,
          company: row.contact.company,
          city: row.contact.city,
          email: row.contact.email,
          phone: row.contact.phone,
        }
      : null,
  }))

  return NextResponse.json({ drafts })
}
