import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
// Laisse Vercel finir même si plusieurs sites sont lents.
export const maxDuration = 60

// AUDIT EN AMONT — découplé de l'envoi.
// Prend les contacts pas encore audités, analyse leur site (mobile, HTTPS, SEO,
// CMS obsolète, site abandonné/absent...) et stocke les défauts concrets sur le
// contact. L'envoi (autopilot-tick) n'enverra QUE des contacts audités → chaque
// mail pourra attaquer un vrai défaut au lieu d'être générique.

// ⚠️ TIMEOUT (06/08) : le budget était calé sur maxDuration Vercel (60s) alors que la vraie
// contrainte est la coupe DURE de cron-job.org à 30s. Pire cas ancien : 45s de budget + 12s pour
// le dernier site = 57s → « Échec » côté ordonnanceur alors que Vercel finissait le travail.
// Le budget est vérifié AVANT chaque site : pire cas = TIME_BUDGET_MS + PER_SITE_TIMEOUT.
const BATCH = 3               // contacts audités par passage (le cron tourne souvent, la file s'écoule)
const PER_SITE_TIMEOUT = 10000 // ms max par site : > pire cas interne de auditWebsite (fetch 2×5s // checkSSL 2×5s), sinon on coupe un audit sain et on fabrique un faux défaut
const TIME_BUDGET_MS = 15000  // 15s + 10s (dernier site) = 25s, marge sûre sous la coupe 30s

/**
 * ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48, absente ici jusqu'au 06/08).
 * Les try/catch n'existaient qu'À L'INTÉRIEUR de la boucle d'audit : une exception survenue
 * ailleurs (SQL, import, Neon indisponible) remontait en 500 au corps VIDE, et cron-job.org
 * n'affichait qu'« Échec (Erreur HTTP) » sans motif. On expose donc toujours la vraie erreur,
 * et on pose le heartbeat dans les DEUX cas (succès comme échec).
 */
export async function GET(req: Request) {
  try {
    const res = await runCron(req)
    await pingHeartbeat('audit-sites', res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[audit-sites]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat('audit-sites', false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({
      ok: false,
      error: String(e.message ?? err).slice(0, 300),
      cause: e.cause?.message?.slice(0, 200),
      code: e.code,
    }, { status: 500 })
  }
}

async function runCron(req: Request) {
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
