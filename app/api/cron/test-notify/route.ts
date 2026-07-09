/**
 * GET /api/cron/test-notify   — DIAGNOSTIC notifications (Resend).
 * Envoie un email de test comme une notif de RDV et RETOURNE la réponse brute de Resend
 * (statut + corps) + l'état des variables. Sert à comprendre pourquoi les notifs n'arrivent pas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const key = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
  const recipientsEnv = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr').split(',').map(s => s.trim()).filter(Boolean)
  const extra = req.nextUrl.searchParams.get('to')
  const to = [...new Set([...(extra ? [extra] : []), ...recipientsEnv])]

  const config = {
    RESEND_API_KEY_present: Boolean(key),
    RESEND_FROM_EMAIL: from,
    CLIENT_NOTIFY_EMAIL: recipientsEnv,
    recipients_utilisés: to,
  }

  if (!key) return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY manquante → AUCUNE notif ne part', config })

  let resendStatus = 0
  let resendBody: unknown = null
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to,
        subject: '🧪 Test notification RDV — Hdigiweb',
        html: '<h2>Test</h2><p>Si tu reçois ce mail, les notifications de RDV fonctionnent.</p>',
      }),
    })
    resendStatus = r.status
    resendBody = await r.json().catch(() => null)
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'fetch Resend a échoué', error: String(e), config })
  }

  return NextResponse.json({
    ok: resendStatus >= 200 && resendStatus < 300,
    resend_status: resendStatus,
    resend_response: resendBody,
    config,
    aide: resendStatus === 403 || resendStatus === 401
      ? 'Clé Resend invalide OU domaine expéditeur (RESEND_FROM_EMAIL) non vérifié dans Resend.'
      : undefined,
  })
}
