/**
 * GET /api/cron/test-calendar — DIAGNOSTIC Google Calendar.
 * Vérifie la présence des clés, tente de créer un event de test, et renvoie l'erreur EXACTE
 * de Google (token expiré ? API désactivée ? clés absentes ?).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const env = {
    GOOGLE_CLIENT_ID: Boolean(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    GOOGLE_REFRESH_TOKEN: Boolean(process.env.GOOGLE_REFRESH_TOKEN),
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    return NextResponse.json({ ok: false, cause: 'Clés Google absentes dans Vercel', env })
  }

  // 1) Test du refresh token (le point qui casse le plus souvent).
  let tokenOk = false
  let tokenError: string | null = null
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
      }),
    })
    const j = await r.json().catch(() => null)
    tokenOk = r.ok
    if (!r.ok) tokenError = JSON.stringify(j).slice(0, 300)
  } catch (e) {
    tokenError = String(e).slice(0, 200)
  }

  // 2) Test de création d'event (seulement si le token marche).
  let eventResult: unknown = null
  if (tokenOk) {
    try {
      const { createCalendarEvent } = await import('@/lib/google-calendar')
      const start = new Date(Date.now() + 24 * 3600 * 1000)
      const end = new Date(start.getTime() + 30 * 60 * 1000)
      const ev = await createCalendarEvent({
        summary: 'TEST Hdigiweb — à supprimer',
        description: 'Event de test de diagnostic.',
        startTime: start.toISOString().slice(0, 19),
        endTime: end.toISOString().slice(0, 19),
        attendeeEmail: undefined,
        meetLink: false,
      })
      eventResult = { eventId: ev.eventId, mock: String(ev.eventId).startsWith('mock_'), eventUrl: ev.eventUrl }
    } catch (e) {
      eventResult = { error: String(e).slice(0, 300) }
    }
  }

  return NextResponse.json({
    ok: tokenOk && !!eventResult && !(eventResult as { error?: string }).error,
    env,
    refresh_token_ok: tokenOk,
    refresh_token_error: tokenError,
    event: eventResult,
    diagnostic: !tokenOk
      ? "Le refresh token Google est INVALIDE/EXPIRÉ (ou l'API Calendar est désactivée). Cause fréquente : l'app OAuth Google est en mode 'Test' → le refresh token expire après 7 jours. Il faut publier l'app OAuth (statut Production) et regénérer le refresh token."
      : undefined,
  })
}
