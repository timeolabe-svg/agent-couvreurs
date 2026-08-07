import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// VALIDATION EMAIL EN AMONT (MillionVerifier) — découplée de l'envoi.
// Prend les contacts pas encore validés qui ont un email en file, vérifie leur
// adresse via MillionVerifier :
//  - 'ok'                              → email_validated = true (autorisé à l'envoi)
//  - 'invalid'/'catch_all'/'disposable' → on ANNULE leur file (jamais envoyé, pas de bounce)
//  - 'unknown'/'error'/MV indispo       → on laisse (re-tenté au prochain passage)
// L'envoi (autopilot-tick) n'enverra QUE les contacts email_validated=true.

// cron-job.org COUPE à 30s (pas 60s comme Vercel). Chaque email = 1 appel MillionVerifier EN
// SÉRIE, budget vérifié AVANT chaque appel. ⚠️ La marge se calcule sur le PIRE cas d'UN appel
// (son timeout dur), pas sur la latence moyenne : avec l'ancien couple 22s de budget + 12s de
// timeout par appel, démarrer un appel à 21,9s menait à ~34s > coupe 30s (même classe de bug que
// l'incident MillionVerifier labegaria du 27/07, cf. leçon 77). Resserré : timeout par appel 8s
// (AbortSignal) + budget 16s → pire cas ~24s + updates SQL, marge confortable.
const BATCH = 5
// ⚠️ Ramené de 16000 à 13000 le 07/08 : le nettoyage de la file zombie (requête CTE) tourne
// APRÈS la boucle, donc en dehors du budget. Mesuré 22,9s sur 30s de coupe — marge trop mince.
const TIME_BUDGET_MS = 13000

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

/** ⚠️ ENVELOPPE D'ERREUR GLOBALE (leçon 48) : jamais de 500 muet, toujours le motif réel. */
export async function GET(req: Request) {
  try {
    const res = await runCron(req)
    await pingHeartbeat("validate-emails", res.status < 400).catch(() => {})
    return res
  } catch (err) {
    console.error('[validate-emails]', err)
    const e = err as { message?: string; cause?: { message?: string }; code?: string }
    await pingHeartbeat("validate-emails", false, String(e.message ?? err).slice(0, 300)).catch(() => {})
    return NextResponse.json({ ok: false, error: String(e.message ?? err).slice(0, 300), cause: e.cause?.message?.slice(0, 200), code: e.code }, { status: 500 })
  }
}
async function runCron(req: Request) {
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
  // ⚠️ AUDIT 07/08 : 3 runs d'affilée à "validated:0 / unknown:3" sans qu'on puisse savoir POURQUOI
  // (vrai 'unknown' du serveur ? 'error' = crédits épuisés ? HTTP KO ? timeout ?). Un compteur qui
  // agrège tous les échecs sous une même étiquette rend le diagnostic impossible : on trace le
  // motif RÉEL renvoyé par MillionVerifier. Sans e-mail, uniquement le code (aucune donnée perso).
  const motifs: Record<string, number> = {}
  const noter = (m: string) => { motifs[m] = (motifs[m] ?? 0) + 1 }

  for (const c of rows) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    const attemptFields = { mv_last_attempt_at: new Date(), mv_attempts: (c.mv_attempts ?? 0) + 1 }
    try {
      const resp = await fetch(
        // timeout=6 (serveur MV) + AbortSignal 8s : borne dure par appel, cohérente avec TIME_BUDGET_MS.
        `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(c.email)}&timeout=6`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!resp.ok) {
        await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id))
        noter('http_' + resp.status)
        unknown++; continue
      }
      const data = (await resp.json()) as { result?: string; error?: string }
      const r = data.result
      noter(data.error ? 'error:' + String(data.error).slice(0, 40) : (r ?? 'sans_resultat'))

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
    } catch (e) {
      noter('exception:' + String((e as Error)?.name ?? e).slice(0, 30))
      // MV indisponible / timeout → on laisse pour re-tenter, même logique de rotation.
      await db.update(contacts).set(attemptFields).where(eq(contacts.id, c.id)).catch(() => {})
      unknown++
    }
  }

  // ⚠️ AUDIT 07/08 — FILE ZOMBIE. Un contact qui épuise ses MAX_MV_ATTEMPTS sans jamais être
  // validé n'était plus jamais retenté (bien), mais sa file d'emails restait 'queued'/'pending'
  // À VIE : 111 contacts et 483 lignes mortes en base, invisibles, qui faussent tous les
  // compteurs de pipeline et font tourner à vide les requêtes de sélection d'envoi.
  // Ces contacts ont TOUS une confiance email < 90 (sinon le gate d'autopilot les laisserait
  // passer sans MV) ET sont invérifiables : les envoyer, c'est un bounce quasi certain, donc
  // de la réputation de boîte perdue. On ferme donc proprement leur file, en le TRAÇANT
  // (mv_status = 'injoignable') pour qu'ils restent exploitables sur un autre canal
  // (téléphone) au lieu de disparaître — invariant « zéro lead perdu ».
  let injoignables = 0
  try {
    await db.execute(sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mv_status TEXT`)
    const r = await db.execute(sql`
      WITH perdus AS (
        SELECT c.id FROM contacts c
        WHERE c.mv_attempts >= ${MAX_MV_ATTEMPTS}
          AND c.email_validated IS NOT TRUE
          AND COALESCE(c.email_confidence_score, 0) < 90
          AND c.mv_status IS DISTINCT FROM 'injoignable'
        LIMIT 200
      ), fermeture AS (
        UPDATE email_queue SET status = 'cancelled'
        WHERE contact_id IN (SELECT id FROM perdus) AND status IN ('pending','queued')
        RETURNING contact_id
      )
      UPDATE contacts SET mv_status = 'injoignable'
      WHERE id IN (SELECT id FROM perdus)
      RETURNING id
    `)
    injoignables = ((r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])).length
  } catch { /* non bloquant : le nettoyage repassera au prochain run */ }

  return NextResponse.json({
    processed: rows.length,
    validated,   // autorisés à l'envoi
    rejected,    // annulés (adresse non fiable)
    unknown,     // re-tentés plus tard, en fin de rotation
    motifs,      // motif RÉEL renvoyé par MillionVerifier (diagnostic : crédits, timeout, HTTP…)
    injoignables, // MV épuisé + confiance faible : file fermée, marqués pour le canal téléphone
    remaining: rows.length === BATCH ? 'oui (encore à valider)' : 'dernier batch',
  })
  } catch (e) {
    // Plus jamais de 500 muet : on renvoie la vraie erreur pour diagnostic (visible dans cron-job.org).
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 })
  }
}
