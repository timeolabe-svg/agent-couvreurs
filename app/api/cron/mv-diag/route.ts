import { NextRequest, NextResponse } from 'next/server'

// Diagnostic MillionVerifier (temporaire)
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const k1 = process.env.MILLION_VERIFIER_API_KEY ?? ''
  const k2 = process.env.MILLIONVERIFIER_API_KEY ?? ''
  const out: Record<string, unknown> = {
    MILLION_VERIFIER_API_KEY_len: k1.length,
    MILLIONVERIFIER_API_KEY_len: k2.length,
  }

  const key = k1 || k2
  const test = async (email: string) => {
    try {
      const r = await fetch(`https://api.millionverifier.com/api/v3/?api=${key}&email=${encodeURIComponent(email)}`, { signal: AbortSignal.timeout(8000) })
      return { status: r.status, body: (await r.text()).slice(0, 300) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  // un email réel (devrait être ok) + un bidon (devrait être invalid)
  out.test_valid = await test('contact@google.com')
  out.test_fake = await test('zzzqqq-nexistepas-12345@example-fake-domain-xyz.fr')

  return NextResponse.json(out)
}
