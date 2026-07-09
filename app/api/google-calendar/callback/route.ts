/**
 * GET /api/google-calendar/callback?code=...
 * Reçoit le code Google, l'échange contre un refresh token, le STOCKE en base
 * (agent_config.google_refresh_token), puis renvoie sur /parametres.
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BASE = 'https://agent-couvreurs.vercel.app'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const err = req.nextUrl.searchParams.get('error')
  if (err || !code) return NextResponse.redirect(`${BASE}/parametres?calendar=error`)

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: `${BASE}/api/google-calendar/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const data = (await tokenRes.json()) as { refresh_token?: string; error?: string }
    if (!data.refresh_token) {
      // Pas de refresh token : Google n'en renvoie que si prompt=consent (déjà mis) ; sinon révoquer l'accès et réessayer.
      return NextResponse.redirect(`${BASE}/parametres?calendar=notoken`)
    }

    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    await db.insert(agent_config)
      .values({ key: 'google_refresh_token', value: data.refresh_token })
      .onConflictDoUpdate({ target: agent_config.key, set: { value: data.refresh_token, updated_at: new Date() } })

    return NextResponse.redirect(`${BASE}/parametres?calendar=ok`)
  } catch {
    return NextResponse.redirect(`${BASE}/parametres?calendar=error`)
  }
}
