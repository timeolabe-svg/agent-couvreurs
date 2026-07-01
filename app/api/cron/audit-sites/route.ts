import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
// Laisse Vercel finir même si plusieurs sites sont lents.
export const maxDuration = 60

// AUDIT EN AMONT — découplé de l'envoi.
// Prend les contacts pas encore audités, analyse leur site (mobile, HTTPS, SEO,
// CMS obsolète, site abandonné/absent...) et stocke les défauts concrets sur le
// contact. L'envoi (autopilot-tick) n'enverra QUE des contacts audités → chaque
// mail pourra attaquer un vrai défaut au lieu d'être générique.

const BATCH = 8              // contacts audités par passage
const PER_SITE_TIMEOUT = 8000 // ms max par site (garde-fou anti-timeout)
const TIME_BUDGET_MS = 50000  // budget total (marge sous maxDuration 60s)

export async function GET(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  }

  const started = Date.now()
  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { eq, or, isNull, sql } = await import('drizzle-orm')
  const { auditWebsite } = await import('@/lib/website-audit')

  // Contacts jamais audités (audit_done false OU null), les plus anciens d'abord.
  const rows = await db
    .select({ id: contacts.id, website: contacts.website, sector: contacts.sector, company: contacts.company })
    .from(contacts)
    .where(or(eq(contacts.audit_done, false), isNull(contacts.audit_done)))
    .orderBy(sql`${contacts.created_at} asc`)
    .limit(BATCH)

  let audited = 0
  let failed = 0
  const samples: string[] = []

  for (const c of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      // auditWebsite gère déjà le cas "pas de site" (level 'no-website') et
      // "site inaccessible" (level 'abandoned'). On borne quand même par un timeout dur.
      const audit = await Promise.race([
        auditWebsite(c.website, c.sector ?? undefined),
        new Promise<null>(resolve => setTimeout(() => resolve(null), PER_SITE_TIMEOUT)),
      ])

      if (audit) {
        await db.update(contacts).set({
          audit_score: audit.score,
          audit_level: audit.level,
          audit_weaknesses: audit.weaknesses,
          audit_cms: audit.cms ?? null,
          audit_done: true,
          updated_at: new Date(),
        }).where(eq(contacts.id, c.id))
        audited++
        if (samples.length < 8) samples.push(`${c.company} → ${audit.level} (${audit.weaknesses.length} défauts)`)
      } else {
        // Timeout dur : site trop lent → on marque audité (défaut = lenteur) pour ne pas reboucler
        await db.update(contacts).set({
          audit_score: 15,
          audit_level: 'abandoned',
          audit_weaknesses: ['site très lent ou inaccessible'],
          audit_done: true,
          updated_at: new Date(),
        }).where(eq(contacts.id, c.id))
        failed++
      }
    } catch (err) {
      // On marque quand même audité pour ne pas bloquer la file indéfiniment.
      await db.update(contacts).set({
        audit_done: true,
        audit_level: 'abandoned',
        audit_weaknesses: ['audit indisponible'],
        updated_at: new Date(),
      }).where(eq(contacts.id, c.id))
      failed++
      console.error('[audit-sites] Erreur audit', c.company, err)
    }
  }

  return NextResponse.json({
    processed: rows.length,
    audited,
    failed,
    remaining: rows.length === BATCH ? 'oui (encore des contacts à auditer)' : 'dernier batch',
    samples,
  })
}
