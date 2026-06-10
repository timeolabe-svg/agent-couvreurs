import { NextRequest, NextResponse } from 'next/server'

// Diagnostic temporaire : teste la clé Instantly contre v1 et v2
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const key = process.env.INSTANTLY_API_KEY ?? ''
  const out: Record<string, unknown> = {
    key_present: Boolean(key),
    key_length: key.length,
    key_prefix: key.slice(0, 6),
  }

  // V1 : api_key en query param
  try {
    const r1 = await fetch(`https://api.instantly.ai/api/v1/campaign/list?api_key=${key}`)
    out.v1_status = r1.status
    out.v1_body = (await r1.text()).slice(0, 200)
  } catch (e) {
    out.v1_error = e instanceof Error ? e.message : String(e)
  }

  const v2 = async (path: string) => {
    try {
      const r = await fetch(`https://api.instantly.ai/api/v2${path}`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      return { status: r.status, body: (await r.text()).slice(0, 400) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Lister tous les comptes connectés (emails uniquement) + toutes les campagnes
  try {
    const accRes = await fetch('https://api.instantly.ai/api/v2/accounts?limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const accData = await accRes.json()
    out.accounts_emails = (accData.items ?? []).map((a: Record<string, unknown>) => a.email)
  } catch (e) {
    out.accounts_error = e instanceof Error ? e.message : String(e)
  }

  try {
    const campRes = await fetch('https://api.instantly.ai/api/v2/campaigns?limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const campData = await campRes.json()
    out.campaigns_list = (campData.items ?? []).map((c: Record<string, unknown>) => ({
      id: c.id, name: c.name, status: c.status,
    }))
  } catch (e) {
    out.campaigns_error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json(out)
}
