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
  const { contacts } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  try {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
    if (!c) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

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
      stage: 'contacted' as const,
      thread: [],
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
