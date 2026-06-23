import { NextRequest, NextResponse } from 'next/server'

// Inspecte / corrige les comptes d'envoi assignés à la campagne Instantly (temporaire)
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = process.env.INSTANTLY_API_KEY
  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID
  const fix = request.nextUrl.searchParams.get('fix') === '1'
  const out: Record<string, unknown> = { campaignId, fix }

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }

  // 1. État actuel de la campagne
  try {
    const r = await fetch(`https://api.instantly.ai/api/v2/campaigns/${campaignId}`, { headers })
    const data = await r.json()
    out.current_email_list = data.email_list ?? data.eaccounts ?? '(champ non trouvé)'
    out.status = data.status
  } catch (e) {
    out.get_error = e instanceof Error ? e.message : String(e)
  }

  // 2. Si fix=1 : assigner les 4 boîtes gabin@
  if (fix) {
    const accounts = (process.env.INSTANTLY_INBOXES ?? '').split(',').map(s => s.trim()).filter(Boolean)
    try {
      const r = await fetch(`https://api.instantly.ai/api/v2/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ email_list: accounts }),
      })
      out.patch_status = r.status
      const data = await r.json()
      out.patched_email_list = data.email_list ?? '(non confirmé)'
    } catch (e) {
      out.patch_error = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json(out)
}
