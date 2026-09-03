import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * BROUILLONS LINKEDIN PRÊTS À ENVOYER — générés côté serveur par
 * lib/reply-agent/send-linkedin-reply.ts, jamais envoyés par lui. Le bot, seul détenteur de la
 * session LinkedIn, les lit ici et les poste lui-même dans la conversation (Ctrl+Entrée, doctrine
 * LabegarIA) avant de confirmer via POST sur cette même route.
 *
 * GET  /api/linkedin/pending-replies?key=<LINKEDIN_BOT_SECRET>
 * POST /api/linkedin/pending-replies?key=<LINKEDIN_BOT_SECRET>   body: { id: string }
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const { sql } = await import('@/lib/db')
    const rows = await sql`
      SELECT rd.id, rd.body, ir.linkedin_lead_id, ll.profile_url, ll.first_name, ll.company
      FROM reply_drafts rd
      JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
      JOIN linkedin_leads ll ON ll.id = ir.linkedin_lead_id
      WHERE ir.channel = 'linkedin' AND rd.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.linkedin_url) = LOWER(ll.profile_url))
      ORDER BY rd.created_at ASC
      LIMIT 20
    `
    return NextResponse.json({ ok: true, drafts: rows })
  } catch (err) {
    console.error('[linkedin/pending-replies] GET error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const payload = await request.json() as { id?: string }
    if (!payload.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const { sql } = await import('@/lib/db')
    await sql`UPDATE reply_drafts SET status = 'sent', sent_at = NOW() WHERE id = ${payload.id}`
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[linkedin/pending-replies] POST error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
