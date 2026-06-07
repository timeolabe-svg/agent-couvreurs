import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  try {
    const { db } = await import('@/lib/db')
    const { learning_reports, agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    // Get the report
    const [report] = await db
      .select()
      .from(learning_reports)
      .where(eq(learning_reports.id, id))
      .limit(1)

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    // Mark as applied
    await db
      .update(learning_reports)
      .set({ applied: true })
      .where(eq(learning_reports.id, id))

    // Apply prompt_adjustments if present
    const recs = report.recommendations as Record<string, unknown> | null
    const adj = (recs?.recommendations as Record<string, unknown> | undefined)?.prompt_adjustments as string | undefined

    if (adj) {
      const now = new Date()
      await db
        .insert(agent_config)
        .values({
          key: 'system_prompt_addon',
          value: adj,
          updated_by: 'manual_apply',
        })
        .onConflictDoUpdate({
          target: agent_config.key,
          set: {
            value: adj,
            updated_by: 'manual_apply',
            updated_at: now,
          },
        })
    }

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    console.error('[learning/reports/[id]] PATCH error:', err)
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    )
  }
}
