import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// VALIDATION EMAIL EN AMONT (MillionVerifier) — découplée de l'envoi.
// Prend les contacts pas encore validés qui ont un email en file, vérifie leur
// adresse via MillionVerifier :
//  - 'ok'                              → email_validated = true (autorisé à l'envoi)
//  - 'invalid'/'catch_all'/'disposable' → on ANNULE leur file (jamais envoyé, pas de bounce)
//  - 'unknown'/'error'/MV indispo       → on laisse (re-tenté au prochain passage)
// L'envoi (autopilot-tick) n'enverra QUE les contacts email_validated=true.

const BATCH = 15
const TIME_BUDGET_MS = 50000

export async function GET(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })

  const mvKey = process.env.MILLION_VERIFIER_API_KEY
  if (!mvKey) {
    // Pas de MillionVerifier configuré → on ne valide rien (les contacts restent
    // en stock, non envoyés). C'est le comportement voulu : on attend d'avoir MV.
    return NextResponse.json({ skipped: true, reason: 'MILLION_VERIFIER_API_KEY manquante — validation en attente' })
  }

  const started = Date.now()
  try {
  const { db } = await import('@/lib/db')
  const { contacts, email_queue } = await import('@/lib/db/schema')
  const { eq, and, or, isNull, sql, inArray } = await import('drizzle-orm')

  // Contacts NON validés qui ont au moins un email PAS ENCORE ENVOYÉ (pending OU queued) :
  // on les valide AVANT que send-campaign ne les envoie → aucun bounce.
  const rows = await db
    // created_at DOIT figurer dans le SELECT DISTINCT car on trie dessus (règle Postgres,
    // sinon "ORDER BY expressions must appear in select list" → 500). id étant unique, la
    // dé-duplication du DISTINCT (contact avec plusieurs mails en file) reste correcte.
    .selectDistinct({ id: contacts.id, email: contacts.email, company: contacts.company, created_at: contacts.created_at })
    .from(contacts)
    .innerJoin(email_queue, and(eq(email_queue.contact_id, contacts.id), inArray(email_queue.status, ['pending', 'queued'])))
    .where(or(eq(contacts.email_validated, false), isNull(contacts.email_validated)))
    .orderBy(sql`${contacts.created_at} asc`)
    .limit(BATCH)

  let validated = 0
  let rejected = 0
  let unknown = 0

  for (const c of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      const resp = await fetch(
        `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(c.email)}&timeout=10`,
        { signal: AbortSignal.timeout(12000) }
      )
      if (!resp.ok) { unknown++; continue }
      const data = (await resp.json()) as { result?: string }
      const r = data.result

      if (r === 'ok') {
        await db.update(contacts).set({ email_validated: true, email_confidence_score: 99, updated_at: new Date() }).where(eq(contacts.id, c.id))
        validated++
      } else if (r === 'invalid' || r === 'catch_all' || r === 'disposable') {
        // Adresse non fiable → on annule sa file (jamais envoyée) pour éviter le bounce.
        await db.update(email_queue)
          .set({ status: 'cancelled' })
          .where(and(eq(email_queue.contact_id, c.id), inArray(email_queue.status, ['pending', 'queued'])))
        rejected++
      } else {
        // 'unknown' / 'error' (crédits) → on laisse, re-tenté plus tard.
        unknown++
      }
    } catch {
      // MV indisponible / timeout → on laisse pour re-tenter.
      unknown++
    }
  }

  return NextResponse.json({
    processed: rows.length,
    validated,   // autorisés à l'envoi
    rejected,    // annulés (adresse non fiable)
    unknown,     // re-tentés plus tard
    remaining: rows.length === BATCH ? 'oui (encore à valider)' : 'dernier batch',
  })
  } catch (e) {
    // Plus jamais de 500 muet : on renvoie la vraie erreur pour diagnostic (visible dans cron-job.org).
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 })
  }
}
