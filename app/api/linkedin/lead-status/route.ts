import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

const STATUTS_VALIDES = new Set([
  'pending', 'invited', 'connected', 'messaged', 'relanced_1', 'relanced_2',
  'replied', 'reply_relanced', 'rdv', 'not_interested', 'ignored', 'expired',
])

/**
 * MISE À JOUR DE STATUT D'UN LEAD — appelée par le bot après chaque action réelle (invitation
 * envoyée, connexion détectée, message posté...). `not_interested` est TERMINAL : une fois posé,
 * cette route refuse tout nouveau changement de statut pour ce lead, quel qu'il soit — un lead
 * qui a décliné ne redevient jamais un candidat, même si le bot se trompe une seconde fois.
 *
 * POST /api/linkedin/lead-status?key=<LINKEDIN_BOT_SECRET>
 * body: { id: string, status: string, profile_url?: string }
 */
export async function POST(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const payload = await request.json() as { id?: string; status?: string; profile_url?: string }
    if (!payload.id || !payload.status) return NextResponse.json({ error: 'id et status requis' }, { status: 400 })
    if (!STATUTS_VALIDES.has(payload.status)) {
      return NextResponse.json({ error: `status inconnu : ${payload.status}` }, { status: 400 })
    }

    const { sql } = await import('@/lib/db')
    const current = (await sql`SELECT status FROM linkedin_leads WHERE id = ${payload.id} LIMIT 1`) as Array<{ status: string | null }>
    if (!current[0]) return NextResponse.json({ error: 'lead introuvable' }, { status: 404 })
    if (current[0].status === 'not_interested') {
      return NextResponse.json({ ok: false, skipped: 'statut terminal (not_interested), jamais modifié' })
    }

    // ⚠️ Pas de fragment SQL composé dynamiquement : le driver Neon (voir la mésaventure du
    // 02/09 sur les migrations) n'exécute qu'une requête ENTIÈRE à la fois, et rien ne garantit
    // ici la composabilité de sous-fragments. Un CASE WHEN plat reste portable à coup sûr.
    const s = payload.status
    await sql`
      UPDATE linkedin_leads SET
        invited_at = CASE WHEN ${s} = 'invited' THEN NOW() ELSE invited_at END,
        connected_at = CASE WHEN ${s} = 'connected' THEN NOW() ELSE connected_at END,
        last_message_at = CASE WHEN ${s} IN ('messaged', 'relanced_1', 'relanced_2') THEN NOW() ELSE last_message_at END,
        status = ${s},
        profile_url = COALESCE(${payload.profile_url ?? null}, profile_url)
      WHERE id = ${payload.id}
    `
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[linkedin/lead-status] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
