import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * VÉRIFICATION DE BLOCKLIST POUR LE BOT LINKEDIN — FAIL-CLOSED.
 *
 * Doctrine reprise de LabegarIA à l'identique : un envoi raté se rattrape au cycle suivant, un
 * envoi à quelqu'un qui a demandé l'arrêt, non. Toute panne interne renvoie donc `blocked: true`
 * en HTTP 503 plutôt qu'un 500 nu — côté bot, un statut non-200 doit lui aussi être traité comme
 * bloqué (timeout réseau, HTTP non-200, réponse illisible → bloqué dans les trois cas).
 *
 * ⚠️ Auth par LINKEDIN_BOT_SECRET, PAS CRON_SECRET : le bot tourne sur un VPS externe, il ne doit
 * jamais détenir le secret des crons internes — sinon compromettre le VPS compromet aussi
 * cron-job.org, ce que le secret séparé existe précisément pour éviter.
 *
 * GET /api/blocklist/check?key=<LINKEDIN_BOT_SECRET>&email=...&linkedin_url=...
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error, blocked: true }, { status: auth.status })

  try {
    const { estBloque } = await import('@/lib/blocklist')
    const email = request.nextUrl.searchParams.get('email')
    const linkedinUrl = request.nextUrl.searchParams.get('linkedin_url')
    const blocked = await estBloque({ email, linkedinUrl })
    return NextResponse.json({ blocked })
  } catch (err) {
    console.error('[blocklist/check] error', err)
    return NextResponse.json({ blocked: true, error: 'verification indisponible' }, { status: 503 })
  }
}
