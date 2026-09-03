import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * REPORTING DU BOT — PAS LA SOURCE DE VÉRITÉ DE SES GARDE-FOUS.
 *
 * Le budget réel (visites de profils/jour, montée en charge) vit dans state.json, LOCAL au VPS,
 * fail-closed si illisible. Cette table est une COPIE que le bot pousse à chaque cycle, à titre
 * informatif pour le dashboard et un futur invariant « bot muet » (E8) — jamais l'inverse : le
 * bot ne doit jamais lire cette table pour décider de son propre budget, sinon on réintroduit une
 * dépendance réseau sur un garde-fou de sécurité.
 *
 * POST /api/linkedin/heartbeat?key=<LINKEDIN_BOT_SECRET>
 * body: { client?: string, daily_profile_visits?, daily_invites_sent?, ramp_start? }
 */
export async function POST(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const payload = await request.json().catch(() => ({})) as {
      client?: string; daily_profile_visits?: number; daily_invites_sent?: number; ramp_start?: string
    }
    const client = payload.client || 'hdigiweb'
    const { sql } = await import('@/lib/db')

    await sql`
      INSERT INTO linkedin_bot_state (client, daily_profile_visits, daily_profile_visits_date, daily_invites_sent, daily_invites_date, ramp_start, last_heartbeat_at, updated_at)
      VALUES (${client}, ${payload.daily_profile_visits ?? 0}, CURRENT_DATE, ${payload.daily_invites_sent ?? 0}, CURRENT_DATE, ${payload.ramp_start ?? null}, NOW(), NOW())
      ON CONFLICT (client) DO UPDATE SET
        daily_profile_visits = EXCLUDED.daily_profile_visits,
        daily_profile_visits_date = EXCLUDED.daily_profile_visits_date,
        daily_invites_sent = EXCLUDED.daily_invites_sent,
        daily_invites_date = EXCLUDED.daily_invites_date,
        ramp_start = COALESCE(EXCLUDED.ramp_start, linkedin_bot_state.ramp_start),
        last_heartbeat_at = NOW(),
        updated_at = NOW()
    `
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[linkedin/heartbeat] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
