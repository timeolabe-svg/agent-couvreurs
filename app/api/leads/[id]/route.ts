import { NextRequest, NextResponse } from 'next/server'

type RouteContext = { params: Promise<{ id: string }> }

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
