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

const BATCH = 5              // contacts audités par passage (réduit : par-site plus long ci-dessous)
const PER_SITE_TIMEOUT = 12000 // ms max par site : > pire cas interne de auditWebsite (fetch 2×5s // checkSSL 2×5s ≈ 10s), sinon la course coupe un audit sain et fabrique un faux défaut
const TIME_BUDGET_MS = 45000  // budget total (marge sous maxDuration 60s : 45s + 1 site 12s = 57s)

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
        // Timeout dur : on n'a PAS pu auditer → JAMAIS inventer un défaut accusatoire (incident
        // 2L2P). On marque audité pour ne pas reboucler, avec un niveau NEUTRE et AUCUNE faiblesse
        // (aligné sur le fail-open de auditWebsite quand le HTML est injoignable) → l'email
        // n'accusera de rien, il partira sur l'offre sans prétendre que le site est mauvais.
        await db.update(contacts).set({
          audit_score: 50,
          audit_level: 'outdated',
          audit_weaknesses: [],
          audit_done: true,
          updated_at: new Date(),
        }).where(eq(contacts.id, c.id))
        failed++
      }
    } catch (err) {
      // Exception (souvent DB, pas le site) → même règle : niveau neutre, aucune faiblesse inventée.
      await db.update(contacts).set({
        audit_done: true,
        audit_level: 'outdated',
        audit_weaknesses: [],
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
