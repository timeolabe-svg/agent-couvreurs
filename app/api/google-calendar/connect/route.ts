/**
 * GET /api/google-calendar/connect
 * Démarre la reconnexion Google Calendar : redirige vers le consentement Google
 * (access_type=offline + prompt=consent → on récupère un refresh token neuf).
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BASE = 'https://agent-couvreurs.vercel.app'

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'GOOGLE_CLIENT_ID manquant' }, { status: 500 })

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${BASE}/api/google-calendar/callback`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return NextResponse.redirect(url.toString())
}
