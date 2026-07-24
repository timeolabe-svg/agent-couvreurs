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

// cron-job.org COUPE à 30s (pas 60s comme Vercel). Chaque email = 1 appel MillionVerifier
// (~3-5s, timeout 12s) EN SÉRIE → un lot de 15 visant 50s se faisait couper à 30s et l'endpoint
// ne renvoyait jamais son 200 (échec cron systématique). On plafonne à 5/run sous ~22s ; le cron
// 30 min écoule la file au fil de l'eau.
const BATCH = 5
const TIME_BUDGET_MS = 22000

// ⚠️ INCIDENT 2026-07-24 : la sélection triait uniquement par created_at ASC. Un domaine qui
// échoue systématiquement chez MillionVerifier (timeout, ip_blocked) reste alors éligible pour
// toujours (email_validated ne passe jamais à true) et RESTE le plus ancien de la file : il est
// donc retenté à CHAQUE passage, bloquant tous les contacts plus récents derrière lui — y compris
// ceux d'un secteur qu'on vient de prioriser. Constaté : 5 mêmes emails "unknown" en boucle sur
// 3 runs consécutifs pendant que d'autres contacts, plus récents, n'étaient jamais essayés.
// Fix : trier par mv_last_attempt_at (jamais tenté d'abord), pas par created_at. Un échec pousse
// le contact en fin de rotation au lieu de le retenter immédiatement. Plafond de tentatives pour
// ne pas dépenser des crédits MV indéfiniment sur une adresse structurellement injoignable.
const MAX_MV_ATTEMPTS = 5

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
  const { eq, and, or, isNull, lt, sql, inArray } = await import('drizzle-orm')

  // Contacts NON validés qui ont au moins un email PAS ENCORE ENVOYÉ (pending OU queued) :
  // on les valide AVANT que send-campaign ne les envoie → aucun bounce.
  // Tri par mv_last_attempt_at (jamais tenté d'abord) : un échec pousse le contact en fin de
  // rotation au lieu de le retenter immédiatement, donc plus jamais de blocage permanent (cf.
  // incident ci-dessus). created_at reste le départage à tentative égale.
  const rows = await db
    .selectDistinct({
      id: contacts.id, email: contacts.email, company: contacts.company,
      created_at: contacts.created_at, mv_attempts: contacts.mv_attempts,
      mv_last_attempt_at: contacts.mv_last_attempt_at,
    })
    .from(contacts)
    .innerJoin(email_queue, and(eq(email_queue.contact_id, contacts.id), inArray(email_queue.status, ['pending', 'queued'])))
    .where(and(
      or(eq(contacts.email_validated, false), isNull(contacts.email_validated)),
      or(lt(contacts.mv_attempts, MAX_MV_ATTEMPTS), isNull(contacts.mv_attempts)),
    ))
    .orderBy(sql`${contacts.mv_last_attempt_at} asc nulls first`, sql`${contacts.created_at} asc`)
    .limit(BATCH)

  let validated = 0
  let rejected = 0
  let unknown = 0

  for (const c of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const attemptFields = { mv_last_attempt_at: new Date(), mv_attempts: (c.mv_attempts ?? 0) + 1 }
    try {
      const resp = await fetch(
        `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(c.email)}&timeout=10`,
        { signal: AbortSignal.timeout(12000) }
      )
      if (!resp.ok) {
        await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id))
        unknown++; continue
      }
      const data = (await resp.json()) as { result?: string }
      const r = data.result

      if (r === 'ok') {
        await db.update(contacts).set({ ...attemptFields, email_validated: true, email_confidence_score: 99, updated_at: new Date() }).where(eq(contacts.id, c.id))
        validated++
      } else if (r === 'invalid' || r === 'catch_all' || r === 'disposable') {
        // Adresse non fiable → on annule sa file (jamais envoyée) pour éviter le bounce.
        await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id))
        await db.update(email_queue)
          .set({ status: 'cancelled' })
          .where(and(eq(email_queue.contact_id, c.id), inArray(email_queue.status, ['pending', 'queued'])))
        rejected++
      } else {
        // 'unknown' / 'error' (crédits) → on laisse, re-tenté plus tard (en fin de rotation).
        await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id))
        unknown++
      }
    } catch {
      // MV indisponible / timeout → on laisse pour re-tenter, même logique de rotation.
      await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id)).catch(() => {})
      unknown++
    }
  }

  return NextResponse.json({
    processed: rows.length,
    validated,   // autorisés à l'envoi
    rejected,    // annulés (adresse non fiable)
    unknown,     // re-tentés plus tard, en fin de rotation
    remaining: rows.length === BATCH ? 'oui (encore à valider)' : 'dernier batch',
  })
  } catch (e) {
    // Plus jamais de 500 muet : on renvoie la vraie erreur pour diagnostic (visible dans cron-job.org).
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 })
  }
}
