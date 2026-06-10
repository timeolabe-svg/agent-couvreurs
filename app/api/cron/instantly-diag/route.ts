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

  out.v2_campaigns = await v2('/campaigns?limit=1')
  out.v2_accounts = await v2('/accounts?limit=5')
  out.v2_emails = await v2('/emails?limit=2')

  return NextResponse.json(out)
}
