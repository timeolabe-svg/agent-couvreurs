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

  // V2 : Bearer token
  try {
    const r2 = await fetch('https://api.instantly.ai/api/v2/campaigns?limit=1', {
      headers: { Authorization: `Bearer ${key}` },
    })
    out.v2_status = r2.status
    out.v2_body = (await r2.text()).slice(0, 200)
  } catch (e) {
    out.v2_error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json(out)
}
