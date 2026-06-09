import { NextRequest, NextResponse } from 'next/server'

// GET /api/settings — return all agent_config rows as {key: value}
export async function GET() {
  if (!process.env.DATABASE_URL) {
    // Return demo defaults
    return NextResponse.json({
      settings: {
        mode: 'prod',
        ton: 'neutre',
        max_emails_per_day: '334',
        warmup_enabled: 'true',
        auto_reply_enabled: 'true',
        auto_rdv_enabled: 'true',
        client_notif_email: 'thomas@hdigiweb.fr',
        persona: 'Thomas Renard, consultant en acquisition digitale chez Hdigiweb.',
        objective: 'Obtenir un RDV téléphonique de 20 min avec le dirigeant pour présenter nos services SEO/Google.',
        tone: 'Ton direct, concis, humain. Pas de jargon marketing. Phrases courtes. Une seule question par email.',
      },
      _demo: true,
    })
  }

  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')

  try {
    const rows = await db.select().from(agent_config)
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return NextResponse.json({ settings })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }
}

// POST /api/settings — upsert array of {key, value}
export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ success: true, _demo: true })
  }

  let body: Array<{ key: string; value: string }>

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an array of {key, value}' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  try {
    for (const { key, value } of body) {
      if (!key) continue
      // Upsert: try update first, then insert
      const [existing] = await db
        .select({ id: agent_config.id })
        .from(agent_config)
        .where(eq(agent_config.key, key))
        .limit(1)

      if (existing) {
        await db
          .update(agent_config)
          .set({ value, updated_at: new Date(), updated_by: 'manual' })
          .where(eq(agent_config.key, key))
      } else {
        await db
          .insert(agent_config)
          .values({ key, value, updated_by: 'manual' })
      }
    }

    return NextResponse.json({ success: true, updated: body.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
  }
}
