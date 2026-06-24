import { NextRequest, NextResponse } from 'next/server'

// Diagnostic + correction du nom d'expéditeur des comptes gabin@ (temporaire)
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const key = process.env.INSTANTLY_API_KEY
  const fix = request.nextUrl.searchParams.get('fix') === '1'
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  const inboxes = (process.env.INSTANTLY_INBOXES ?? '').split(',').map(s => s.trim()).filter(Boolean)

  const out: Record<string, unknown> = { inboxes, fix }
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}

  for (const email of inboxes) {
    try {
      const r = await fetch(`https://api.instantly.ai/api/v2/accounts/${encodeURIComponent(email)}`, { headers })
      const d = await r.json()
      before[email] = { first_name: d.first_name, last_name: d.last_name }

      if (fix) {
        const p = await fetch(`https://api.instantly.ai/api/v2/accounts/${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ first_name: 'Gabin', last_name: '' }),
        })
        const pd = await p.json()
        after[email] = { status: p.status, first_name: pd.first_name, last_name: pd.last_name }
      }
    } catch (e) {
      before[email] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  out.before = before
  if (fix) out.after = after
  return NextResponse.json(out)
}
