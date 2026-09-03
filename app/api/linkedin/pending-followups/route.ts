import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * RELANCES J+3/J+7 DUES — un lead connecté (accepté) mais jamais messagé, ou messagé sans
 * réponse depuis le délai voulu. `RELANCE_APRES_REPONSE_JOURS` est lu côté bot (env), pas ici :
 * cette route donne des dates, le bot décide s'il agit selon SES propres réglages et son budget.
 *
 * GET /api/linkedin/pending-followups?key=<LINKEDIN_BOT_SECRET>&apres_jours=3
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const apresJours = Math.max(1, Number(request.nextUrl.searchParams.get('apres_jours') ?? 3))
    const { sql } = await import('@/lib/db')

    const rows = await sql`
      SELECT ll.id, ll.first_name, ll.last_name, ll.company, ll.profile_url, ll.status,
             ll.connected_at, ll.last_message_at,
             c.city, c.sector
      FROM linkedin_leads ll
      LEFT JOIN contacts c ON c.id = ll.contact_id
      WHERE ll.status IN ('connected', 'messaged')
        AND (
          (ll.status = 'connected' AND ll.connected_at < NOW() - (${apresJours} || ' days')::interval)
          OR (ll.status = 'messaged' AND ll.last_message_at < NOW() - (${apresJours} || ' days')::interval)
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocklist b
          WHERE (c.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
             OR (ll.profile_url IS NOT NULL AND LOWER(b.linkedin_url) = LOWER(ll.profile_url))
        )
      ORDER BY COALESCE(ll.last_message_at, ll.connected_at) ASC
      LIMIT 50
    `
    return NextResponse.json({ ok: true, leads: rows })
  } catch (err) {
    console.error('[linkedin/pending-followups] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
