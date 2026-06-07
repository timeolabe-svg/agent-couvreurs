import { NextRequest, NextResponse } from 'next/server'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { id } = await context.params
  const body = await request.json() as {
    status?: string
    scheduledAt?: string
    durationMin?: number
    notes?: string
  }

  const { db } = await import('@/lib/db')
  const { rdv, dashboard_events } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const existing = await db
    .select()
    .from(rdv)
    .where(eq(rdv.id, id))
    .limit(1)
    .then((r) => r[0])

  if (!existing) {
    return NextResponse.json({ error: 'RDV not found' }, { status: 404 })
  }

  const updates: Partial<{
    status: string
    scheduled_at: Date
    duration_min: number
    notes: string
  }> = {}

  if (body.status) updates.status = body.status
  if (body.scheduledAt) updates.scheduled_at = new Date(body.scheduledAt)
  if (body.durationMin) updates.duration_min = body.durationMin
  if (body.notes !== undefined) updates.notes = body.notes

  const [updated] = await db
    .update(rdv)
    .set(updates)
    .where(eq(rdv.id, id))
    .returning()

  // If cancelled, update Google Calendar event
  if (body.status === 'cancelled' && existing.google_event_id) {
    try {
      const { cancelCalendarEvent } = await import('@/lib/google-calendar')
      await cancelCalendarEvent(existing.google_event_id)
    } catch (err) {
      console.error('[api/rdv/[id]] Google Calendar cancel error:', err)
    }
  }

  // Dashboard event
  await db.insert(dashboard_events).values({
    type: 'rdv_updated',
    data: {
      rdvId: id,
      action: body.status ?? 'updated',
      previousStatus: existing.status,
    },
  })

  return NextResponse.json({
    rdv: {
      ...updated,
      scheduled_at: updated.scheduled_at.toISOString(),
      created_at: updated.created_at?.toISOString() ?? null,
    },
  })
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { id } = await context.params

  const { db } = await import('@/lib/db')
  const { rdv } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const existing = await db
    .select()
    .from(rdv)
    .where(eq(rdv.id, id))
    .limit(1)
    .then((r) => r[0])

  if (!existing) {
    return NextResponse.json({ error: 'RDV not found' }, { status: 404 })
  }

  if (existing.google_event_id) {
    try {
      const { cancelCalendarEvent } = await import('@/lib/google-calendar')
      await cancelCalendarEvent(existing.google_event_id)
    } catch (err) {
      console.error('[api/rdv/[id]] Google Calendar cancel error:', err)
    }
  }

  await db.delete(rdv).where(eq(rdv.id, id))

  return NextResponse.json({ success: true })
}
