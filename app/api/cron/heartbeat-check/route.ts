export const dynamic = "force-dynamic"
export const maxDuration = 30

import { NextRequest, NextResponse } from "next/server"
import { checkCronAuth } from "@/lib/cron-auth"
import { alertIndependent } from "@/lib/alert"

// ─────────────────────────────────────────────────────────────────────────────
// HEARTBEAT-CHECK (Hdigiweb) — détecte un cron MORT, indépendamment de cron-job.org.
//
// Un cron peut cesser de tourner sans que ça apparaisse comme un échec côté ordonnanceur (tâche
// désactivée par erreur, secret changé, tâche supprimée, ou run qui répond 200 sans rien faire).
// cron_heartbeats est rempli par CHAQUE cron via pingHeartbeat(). Ici on compare last_run_at à
// l'intervalle attendu. Tolérance ×3 (un run en retard ne doit pas déclencher une fausse alerte).
// À brancher sur cron-job.org toutes les 30-60 min. Porté depuis labegaria.
// ─────────────────────────────────────────────────────────────────────────────

// Intervalles attendus (minutes) des crons qu'on surveille. Un cron muet > 3× cet intervalle alerte.
const EXPECTED: Record<string, number> = {
  "send-campaign": 10,
  "poll-imap-replies": 10,
  "scrape-leads": 30,
  "validate-emails": 30,
  "autopilot-tick": 30,
  // ⚠️ 720 (12h, tolérance ×3 = 36h) et non 60 : la cadence RÉELLE de ce cron sur cron-job.org
  // est incertaine (dernier envoi constaté : quotidien vers 18h). Un intervalle attendu trop
  // court déclenchait une fausse alerte "MUET" à chaque vérification. À resserrer quand la
  // cadence réelle sera confirmée (recommandé : toutes les heures).
  "conversation-followups": 720,
  // Détection des franchisseurs du seuil 20 avis : 1×/jour (tolérance ×3 = 3 jours).
  "watchlist-recheck": 1440,
  // Audit des sites : alimente autopilot-tick (un contact non audité n'est jamais promu).
  // S'il s'arrête, le pipeline se tarit en silence sans qu'aucun envoi n'échoue.
  "audit-sites": 30,
  /**
   * ⚠️ AJOUTÉS APRÈS L'AUDIT DU 19/08 — TROIS ANGLES MORTS.
   *
   * Ces crons tournaient (ou ne tournaient plus) sans aucun intervalle attendu : la surveillance
   * les sautait poliment, donc leur arrêt ne déclenchait rien. Constaté ce jour-là :
   *   - weekly-learning et self-improve : dernier passage le 09/08, DIX JOURS de silence. Les
   *     rapports d'apprentissage ne se produisaient plus, personne ne pouvait le savoir.
   *   - promote-leads : le maillon qui transforme un lead en contact démarchable. S'il s'arrête,
   *     le pipeline se tarit sans qu'aucun envoi n'échoue (c'est la panne du 13/08).
   *   - rappels-rdv et reprendre-apres-absence : greffés au moteur d'envoi. Si la greffe casse,
   *     les rappels anti no-show et les reprises de congés s'arrêtent en silence.
   *
   * Un cron surveillé qui n'a pas d'intervalle attendu n'est PAS surveillé.
   */
  "promote-leads": 30,
  "rappels-rdv": 60,
  "reprendre-apres-absence": 1440,
  "weekly-learning": 10080,
  "self-improve": 43200,
  // Le déclencheur des travaux périodiques : s il se tait, watchlist/apprentissage se taisent aussi.
  "maintenance-tick": 60,
}

interface HeartbeatRow {
  cron_name: string
  last_run_at: string | null
  last_ok: boolean | null
  last_detail: string | null
  expected_interval_minutes: number | null
}

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import("@/lib/db")

  // Table + seed des intervalles (idempotent, pas de migration séparée nécessaire).
  await sql`
    CREATE TABLE IF NOT EXISTS cron_heartbeats (
      cron_name TEXT PRIMARY KEY,
      last_run_at TIMESTAMPTZ,
      last_ok BOOLEAN,
      last_detail TEXT,
      expected_interval_minutes INT
    )
  `
  for (const [name, mins] of Object.entries(EXPECTED)) {
    await sql`
      INSERT INTO cron_heartbeats (cron_name, expected_interval_minutes)
      VALUES (${name}, ${mins})
      ON CONFLICT (cron_name) DO UPDATE SET expected_interval_minutes = ${mins}
    `
  }

  const rows = (await sql`SELECT cron_name, last_run_at, last_ok, last_detail, expected_interval_minutes FROM cron_heartbeats ORDER BY cron_name`) as HeartbeatRow[]

  const now = Date.now()
  const stale: Array<{ name: string; minutesAgo: number; expected: number }> = []
  const failed: Array<{ name: string; detail: string | null }> = []

  for (const r of rows) {
    if (!r.expected_interval_minutes || !r.last_run_at) continue // jamais encore vu → on attend son 1er run
    const minutesAgo = Math.round((now - new Date(r.last_run_at).getTime()) / 60000)
    if (minutesAgo > r.expected_interval_minutes * 3) stale.push({ name: r.cron_name, minutesAgo, expected: r.expected_interval_minutes })
    else if (!r.last_ok) failed.push({ name: r.cron_name, detail: r.last_detail })
  }

  if (stale.length === 0 && failed.length === 0) {
    return NextResponse.json({ ok: true, alert: false, checked: rows.length })
  }

  const lines = [`Heartbeat-check Hdigiweb — ${stale.length} cron(s) muet(s), ${failed.length} en échec.`, ""]
  for (const s of stale) lines.push(`🔴 ${s.name} : silence depuis ${s.minutesAgo} min (attendu ~${s.expected} min) — vérifier cron-job.org (tâche active ? planifiée ?).`)
  for (const f of failed) lines.push(`🟠 ${f.name} : dernier run en échec — ${f.detail ?? "(pas de détail)"}`)
  lines.push("", "Vérifier aussi CRON_SECRET / l'auth ?key= si un cron est muet sans raison.")

  const { ntfy, email } = await alertIndependent(`🚨 Heartbeat Hdigiweb : ${stale.length} muet(s), ${failed.length} échec(s)`, lines.join("\n"))
  return NextResponse.json({ ok: true, alert: true, stale, failed, ntfy, email })
}

export async function GET(req: NextRequest) {
  try {
    return await handler(req)
  } catch (err) {
    console.error("[cron heartbeat-check]", err)
    return NextResponse.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 })
  }
}
