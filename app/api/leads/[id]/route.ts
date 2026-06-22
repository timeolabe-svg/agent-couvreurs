import { NextRequest, NextResponse } from 'next/server'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/leads/[id] — fetch single lead
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  if (!process.env.DATABASE_URL) {
    const { DEMO_LEADS } = await import('@/data/demo')
    const lead = DEMO_LEADS.find(l => l.id === id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    return NextResponse.json({ lead })
  }

  const { db } = await import('@/lib/db')
  const { contacts, email_queue, incoming_replies, reply_drafts, rdv } = await import('@/lib/db/schema')
  const { eq, and, inArray } = await import('drizzle-orm')
  const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')

  try {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    if (!c) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const stepMap: Record<number, string> = { 0: 'initial', 1: 'follow_up_1', 2: 'follow_up_2', 3: 'follow_up_3', 4: 'follow_up_3' }

    // Emails envoyés
    const sent = await db
      .select()
      .from(email_queue)
      .where(and(eq(email_queue.contact_id, id), eq(email_queue.status, 'sent')))

    // Réponses reçues
    const replies = await db.select().from(incoming_replies).where(eq(incoming_replies.contact_id, id))
    const replyIds = replies.map(r => r.id)

    // Réponses de l'agent (drafts) liées
    const drafts = replyIds.length
      ? await db.select().from(reply_drafts).where(inArray(reply_drafts.incoming_reply_id, replyIds))
      : []

    // RDV éventuel
    const [rdvRow] = await db.select().from(rdv).where(eq(rdv.contact_id, id)).limit(1)

    // Prochaine action prévue (email en attente)
    const [nextPending] = await db
      .select()
      .from(email_queue)
      .where(and(eq(email_queue.contact_id, id), eq(email_queue.status, 'pending')))
      .limit(1)

    type Msg = { id: string; author: 'agent' | 'lead'; subject?: string; body: string; sentAt: string; openedAt?: string; isAiGenerated?: boolean; sequenceStep?: string }
    const thread: Msg[] = []

    for (const s of sent) {
      thread.push({
        id: s.id,
        author: 'agent',
        subject: s.subject,
        body: s.body,
        sentAt: (s.sent_at ?? s.created_at)?.toISOString() ?? '',
        openedAt: s.opened_at?.toISOString() ?? undefined,
        isAiGenerated: true,
        sequenceStep: stepMap[s.sequence_step ?? 0] ?? 'initial',
      })
    }
    for (const r of replies) {
      thread.push({
        id: r.id,
        author: 'lead',
        subject: r.subject ?? undefined,
        body: stripQuotedReply(r.body) || r.body,
        sentAt: (r.processed_at ?? r.created_at)?.toISOString() ?? '',
        sequenceStep: 'reply',
      })
    }
    for (const d of drafts) {
      thread.push({
        id: d.id,
        author: 'agent',
        body: d.body,
        sentAt: (d.sent_at ?? d.created_at)?.toISOString() ?? '',
        isAiGenerated: true,
        sequenceStep: 'reply',
      })
    }
    thread.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())

    const stage = rdvRow ? 'rdv_booked' : replies.length ? 'replied' : sent.length ? 'contacted' : 'prospected'

    const lead = {
      id: c.id,
      company: c.company,
      contact: c.name ?? '',
      firstName: c.name?.split(' ')[0] ?? '',
      email: c.email,
      phone: c.phone ?? undefined,
      city: c.city ?? '',
      website: c.website ?? undefined,
      googleRating: c.google_rating ?? undefined,
      googleReviews: c.google_reviews_count ?? undefined,
      specialty: c.sector ? [c.sector] : [],
      hasGoogleAds: false,
      hasWebsite: Boolean(c.website),
      stage,
      thread,
      rdvDate: rdvRow?.scheduled_at?.toISOString() ?? undefined,
      nextScheduledAt: nextPending?.scheduled_at?.toISOString() ?? undefined,
      score: c.email_confidence_score ?? 50,
      createdAt: c.created_at?.toISOString() ?? new Date().toISOString(),
      lastActivityAt: c.updated_at?.toISOString() ?? c.created_at?.toISOString() ?? new Date().toISOString(),
    }

    return NextResponse.json({ lead })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }
}

// PATCH /api/leads/[id] — update lead
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  let body: Partial<{
    name: string
    company: string
    phone: string
    city: string
    sector: string
    website: string
    description: string
    director_name: string
  }>

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  try {
    const [updated] = await db
      .update(contacts)
      .set({ ...body, updated_at: new Date() })
      .where(eq(contacts.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json({ lead: updated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}

// DELETE /api/leads/[id] — delete lead
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  try {
    const [deleted] = await db
      .delete(contacts)
      .where(eq(contacts.id, id))
      .returning()

    if (!deleted) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Delete failed' }, { status: 500 })
  }
}
