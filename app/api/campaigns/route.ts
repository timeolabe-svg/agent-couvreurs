import { NextRequest, NextResponse } from 'next/server'

// Demo campaigns fallback
const DEMO_CAMPAIGNS = [
  { id: '1', name: 'Couvreurs — Toulouse & région', sector: 'couvreur', cities: ['Toulouse'], status: 'active', allocation_pct: 70, sequence_delay_days: [0, 3, 7, 14] },
  { id: '2', name: 'Électriciens — Bordeaux', sector: 'electricien', cities: ['Bordeaux'], status: 'active', allocation_pct: 10, sequence_delay_days: [0, 3, 7, 14] },
  { id: '3', name: 'Maçons — France', sector: 'macon', cities: [], status: 'paused', allocation_pct: 5, sequence_delay_days: [0, 3, 7, 14] },
]

// GET /api/campaigns — list all campaigns
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ campaigns: DEMO_CAMPAIGNS })
  }

  const { db } = await import('@/lib/db')
  const { campaigns } = await import('@/lib/db/schema')
  const { desc } = await import('drizzle-orm')

  try {
    const rows = await db.select().from(campaigns).orderBy(desc(campaigns.created_at))
    return NextResponse.json({ campaigns: rows })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }
}

// POST /api/campaigns — create campaign
export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  let body: {
    name: string
    sector: string
    cities?: string[]
    status?: string
    allocation_pct?: number
    sequence_delay_days?: number[]
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name || !body.sector) {
    return NextResponse.json({ error: 'name and sector are required' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { campaigns } = await import('@/lib/db/schema')

  try {
    const [created] = await db
      .insert(campaigns)
      .values({
        name: body.name,
        sector: body.sector,
        cities: body.cities ?? [],
        status: body.status ?? 'draft',
        allocation_pct: body.allocation_pct ?? 10,
        sequence_delay_days: body.sequence_delay_days ?? [0, 3, 7, 14],
      })
      .returning()

    return NextResponse.json({ campaign: created }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Create failed' }, { status: 500 })
  }
}

// PATCH /api/campaigns — update campaign status/allocation
export async function PATCH(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  let body: {
    id: string
    status?: string
    allocation_pct?: number
    name?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { campaigns } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const updates: Record<string, unknown> = {}
  if (body.status !== undefined) updates.status = body.status
  if (body.allocation_pct !== undefined) updates.allocation_pct = body.allocation_pct
  if (body.name !== undefined) updates.name = body.name

  try {
    const [updated] = await db
      .update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, body.id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    return NextResponse.json({ campaign: updated })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}
