import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * LISTE COMPLÈTE DES LEADS LINKEDIN — source de vérité unique pour le bot.
 *
 * Mirroir volontaire du pattern LabegarIA (charger TOUS les leads une fois par cycle, filtrer
 * localement par statut pour chaque phase) plutôt que d'inventer N endpoints étroits par phase :
 * c'est un pattern déjà éprouvé en production chez LabegarIA, pas une simplification de ma part.
 *
 * GET /api/linkedin/leads?key=<LINKEDIN_BOT_SECRET>&limit=5000
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const limit = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 5000)))
    const { sql } = await import('@/lib/db')
    const rows = await sql`
      SELECT ll.id, ll.first_name, ll.last_name, ll.company, ll.profile_url, ll.status,
             ll.invited_at, ll.connected_at, ll.last_message_at, ll.created_at, ll.contact_id,
             c.city, c.sector
      FROM linkedin_leads ll
      LEFT JOIN contacts c ON c.id = ll.contact_id
      ORDER BY ll.created_at ASC
      LIMIT ${limit}
    `
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[linkedin/leads] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
