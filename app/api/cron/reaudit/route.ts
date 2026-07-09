/**
 * GET /api/cron/reaudit?email=xxx   (ou ?all=1 pour re-auditer les leads chauds)
 * Relance l'audit du site d'un contact et met à jour ses faiblesses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const email = req.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'Missing ?email=' }, { status: 400 })

  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const { auditWebsite } = await import('@/lib/website-audit')

  const [c] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1)
  if (!c) return NextResponse.json({ error: 'contact introuvable' }, { status: 404 })
  if (!c.website) return NextResponse.json({ error: 'ce contact n\'a pas de site web' }, { status: 400 })

  const audit = await auditWebsite(c.website, c.sector ?? undefined)
  await db.update(contacts).set({
    audit_score: audit.score,
    audit_level: audit.level,
    audit_weaknesses: audit.weaknesses,
    audit_cms: audit.cms ?? null,
    audit_done: true,
  }).where(eq(contacts.id, c.id))

  return NextResponse.json({
    ok: true,
    company: c.company,
    website: c.website,
    score: audit.score,
    level: audit.level,
    nb_faiblesses: audit.weaknesses.length,
    weaknesses: audit.weaknesses,
  })
}
