import { NextRequest, NextResponse } from 'next/server'

// Test temporaire : valide la génération d'email via Gemini en production
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const out: Record<string, unknown> = {
    gemini_key_present: Boolean(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  }

  try {
    const { generateEmail } = await import('@/lib/email-generator')
    const lead = {
      id: 'test',
      company: 'Couverture Dupont',
      contact: '',
      firstName: '',
      email: 'test@test.fr',
      city: 'Carcassonne',
      specialty: ['couvreur'],
      hasGoogleAds: false,
      hasWebsite: false,
      stage: 'contacted' as const,
      thread: [] as never[],
      createdAt: '2026-06-11',
      lastActivityAt: '2026-06-11',
    }
    const result = await generateEmail(lead as never, 'initial', 'gabin@hdigiweb-agence.com', 'Gabin')
    out.ok = true
    out.subject = result.subject
    out.body_preview = result.body.slice(0, 400)
  } catch (e) {
    out.ok = false
    out.error = e instanceof Error ? e.message : String(e)
  }

  return NextResponse.json(out)
}
