import { NextRequest, NextResponse } from 'next/server'

// LECTURE SEULE — état d'envoi Instantly (initial + relances). Aucun envoi.
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = process.env.INSTANTLY_API_KEY
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID
  const headers = { Authorization: `Bearer ${key}` }
  const out: Record<string, unknown> = {}

  // Analytics globales de la campagne
  try {
    const r = await fetch(`https://api.instantly.ai/api/v2/campaigns/analytics?id=${campaignId}`, { headers })
    out.analytics = await r.json()
  } catch (e) { out.analytics_error = e instanceof Error ? e.message : String(e) }

  // Analytics par étape (montre les relances 2-5)
  try {
    const r = await fetch(`https://api.instantly.ai/api/v2/campaigns/analytics/steps?campaign_id=${campaignId}`, { headers })
    out.steps = await r.json()
  } catch (e) { out.steps_error = e instanceof Error ? e.message : String(e) }

  return NextResponse.json(out)
}
