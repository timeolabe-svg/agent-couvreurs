import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: [], page: 1, limit: 20, _demo: true })
  }

  const { db } = await import('@/lib/db')
  const { incoming_replies, reply_drafts, contacts } = await import('@/lib/db/schema')
  const { eq, and } = await import('drizzle-orm')

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'pending'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))
  const offset = (page - 1) * limit

  const rows = await db
    .select({
      reply: incoming_replies,
      draft: reply_drafts,
      contact: contacts,
    })
    .from(incoming_replies)
    .leftJoin(reply_drafts, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
    .leftJoin(contacts, eq(contacts.id, incoming_replies.contact_id))
    .where(and(eq(reply_drafts.status, status)))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ data: rows, page, limit })
}
