import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { VARIANT_IDS, MESSAGE_VARIANTS, WEIGHTS_KEYS, getWeights, setWeights } from '@/lib/experiments'
import { SECTORS, REGIONS, CITY_TO_REGION } from '@/lib/scrape-targets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─────────────────────────────────────────────────────────────────────────────
// LE CERVEAU — auto-apprentissage mensuel, 100% autonome.
// Mesure les perfs (réponses + RDV combinés) par variante d'angle, par secteur et
// par région sur la période, puis RÉÉCRIT les poids en base pour favoriser les
// gagnants — tout en gardant un plancher d'exploration (marathon, jamais d'abandon).
// Envoie ensuite un rapport clair. Aucune intervention humaine.
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_DAYS = 30
const MIN_SENDS = 15      // en dessous : pas assez de data → on continue d'explorer
const RDV_WEIGHT = 3      // un RDV vaut 3x une réponse dans le score combiné
const FLOOR = 0.08        // poids plancher (exploration garantie)
const SMOOTH = 0.5        // lissage : 50% nouveau / 50% ancien (évite les swings)

type Stat = { sent: number; replied: number; rdv: number }

function computeWeights(
  allValues: readonly string[],
  stats: Record<string, Stat>,
  oldWeights: Record<string, number>,
): { weights: Record<string, number>; table: Array<{ value: string; sent: number; replyRate: number; rdvRate: number; weight: number }> } {
  const perf: Record<string, number | null> = {}
  for (const v of allValues) {
    const s = stats[v] ?? { sent: 0, replied: 0, rdv: 0 }
    perf[v] = s.sent >= MIN_SENDS ? (s.replied / s.sent + RDV_WEIGHT * (s.rdv / s.sent)) : null
  }
  const scored = allValues.filter(v => perf[v] !== null) as string[]
  const maxPerf = scored.length ? Math.max(0, ...scored.map(v => perf[v] as number)) : 0

  const weights: Record<string, number> = {}
  const table = []
  for (const v of allValues) {
    const s = stats[v] ?? { sent: 0, replied: 0, rdv: 0 }
    let target: number
    if (perf[v] === null) target = 0.5            // pas assez de data → explorer
    else if (maxPerf <= 0) target = 0.5           // personne ne répond encore → uniforme
    else target = FLOOR + ((perf[v] as number) / maxPerf) * (1 - FLOOR)

    const old = oldWeights[v]
    const w = typeof old === 'number' ? SMOOTH * target + (1 - SMOOTH) * old : target
    weights[v] = +Math.max(FLOOR, w).toFixed(3)
    table.push({
      value: v,
      sent: s.sent,
      replyRate: s.sent ? +((s.replied / s.sent) * 100).toFixed(1) : 0,
      rdvRate: s.sent ? +((s.rdv / s.sent) * 100).toFixed(1) : 0,
      weight: weights[v],
    })
  }
  table.sort((a, b) => b.weight - a.weight)
  return { weights, table }
}

async function sendReport(html: string, subject: string) {
  const key = process.env.RESEND_API_KEY
  const to = process.env.CLIENT_NOTIFY_EMAIL
  if (!key || !to) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
      to: to.split(',').map(s => s.trim()).filter(Boolean),
      subject, html,
    }),
  })
}

export async function GET(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 503 })

  const { db } = await import('@/lib/db')
  const { email_queue, incoming_replies, rdv: rdvTable, contacts, learning_reports } = await import('@/lib/db/schema')
  const { eq, and, gte, ne, isNotNull, sql } = await import('drizzle-orm')

  const now = new Date()
  const periodStart = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000)

  // 1. Tous les emails envoyés sur la période, avec leur variante + secteur + ville + DATE.
  const sentRows = await db
    .select({ variant: email_queue.variant_id, contactId: email_queue.contact_id, sector: contacts.sector, city: contacts.city, sentAt: email_queue.sent_at })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, periodStart)))

  // 2. VRAIES réponses (pas spam ni auto/absence) et RDV, AVEC leur date, par contact.
  //    On n'attribue une réponse à un envoi que si elle est arrivée APRÈS lui → pas de
  //    comptage des vieilles plaintes comme si c'était des réponses aux envois récents.
  const replyRows = await db
    .select({ id: incoming_replies.contact_id, ts: incoming_replies.created_at, cls: incoming_replies.classification })
    .from(incoming_replies)
    .where(isNotNull(incoming_replies.contact_id))
  const rdvRows = await db
    .select({ id: rdvTable.contact_id, ts: rdvTable.created_at })
    .from(rdvTable)
    .where(and(isNotNull(rdvTable.contact_id), ne(rdvTable.status, 'cancelled')))

  // Une "vraie" réponse = engagement humain réel (on exclut spam / auto-réponse / absence).
  const IGNORED_CLS = new Set(['spam', 'oof'])
  const repliesByContact = new Map<string, number[]>()
  for (const r of replyRows) {
    if (!r.id || !r.ts) continue
    if (r.cls && IGNORED_CLS.has(r.cls)) continue
    ;(repliesByContact.get(r.id) ?? repliesByContact.set(r.id, []).get(r.id)!).push(new Date(r.ts).getTime())
  }
  const rdvByContact = new Map<string, number[]>()
  for (const r of rdvRows) {
    if (!r.id || !r.ts) continue
    ;(rdvByContact.get(r.id) ?? rdvByContact.set(r.id, []).get(r.id)!).push(new Date(r.ts).getTime())
  }

  // 3. Agréger par variante / secteur / région, avec attribution APRÈS l'envoi.
  const emptyStat = (): Stat => ({ sent: 0, replied: 0, rdv: 0 })
  const byVariant: Record<string, Stat> = {}
  const bySector: Record<string, Stat> = {}
  const byRegion: Record<string, Stat> = {}
  const bump = (map: Record<string, Stat>, key: string | null | undefined, replied: boolean, hasRdv: boolean) => {
    if (!key) return
    const s = (map[key] ??= emptyStat())
    s.sent++
    if (replied) s.replied++
    if (hasRdv) s.rdv++
  }
  for (const row of sentRows) {
    const sentTs = row.sentAt ? new Date(row.sentAt).getTime() : 0
    const replied = row.contactId ? (repliesByContact.get(row.contactId) ?? []).some(t => t > sentTs) : false
    const hasRdv = row.contactId ? (rdvByContact.get(row.contactId) ?? []).some(t => t > sentTs) : false
    bump(byVariant, row.variant, replied, hasRdv)
    bump(bySector, row.sector, replied, hasRdv)
    bump(byRegion, row.city ? CITY_TO_REGION[row.city] : null, replied, hasRdv)
  }

  // 4. Calculer les nouveaux poids et les ÉCRIRE en base (l'agent s'ajuste seul).
  const [oldV, oldS, oldR] = await Promise.all([
    getWeights(WEIGHTS_KEYS.variant), getWeights(WEIGHTS_KEYS.sector), getWeights(WEIGHTS_KEYS.region),
  ])
  const variant = computeWeights(VARIANT_IDS, byVariant, oldV)
  const sector = computeWeights(SECTORS, bySector, oldS)
  const region = computeWeights(REGIONS, byRegion, oldR)

  await Promise.all([
    setWeights(WEIGHTS_KEYS.variant, variant.weights),
    setWeights(WEIGHTS_KEYS.sector, sector.weights),
    setWeights(WEIGHTS_KEYS.region, region.weights),
  ])

  const totalSent = sentRows.length
  const totalReplied = sentRows.filter(r => {
    const t = r.sentAt ? new Date(r.sentAt).getTime() : 0
    return r.contactId && (repliesByContact.get(r.contactId) ?? []).some(x => x > t)
  }).length
  const totalRdv = sentRows.filter(r => {
    const t = r.sentAt ? new Date(r.sentAt).getTime() : 0
    return r.contactId && (rdvByContact.get(r.contactId) ?? []).some(x => x > t)
  }).length

  // 5. Rapport (stocké + envoyé).
  const label = (id: string) => MESSAGE_VARIANTS.find(v => v.id === id)?.label ?? id
  const tableHtml = (title: string, rows: typeof variant.table, isVariant = false) => `
    <h3 style="margin:18px 0 6px;font-size:14px">${title}</h3>
    <table width="100%" style="border-collapse:collapse;font-size:12px">
      <tr style="color:#888"><th align="left">Option</th><th>Envoyés</th><th>Réponses</th><th>RDV</th><th>Poids</th></tr>
      ${rows.map(r => `<tr style="border-top:1px solid #eee">
        <td>${isVariant ? label(r.value) : r.value}</td>
        <td align="center">${r.sent}</td>
        <td align="center">${r.replyRate}%</td>
        <td align="center">${r.rdvRate}%</td>
        <td align="center"><b>${r.weight}</b></td>
      </tr>`).join('')}
    </table>`

  const html = `<div style="font-family:system-ui;max-width:680px;margin:0 auto">
    <h2>🧠 Rapport d'auto-apprentissage — ${PERIOD_DAYS} derniers jours</h2>
    <p>${totalSent} emails envoyés · ${totalReplied} réponses · ${totalRdv} RDV.</p>
    <p style="color:#666;font-size:13px">L'agent a réajusté ses priorités tout seul. Les options avec le meilleur (réponses + RDV) prennent plus de poids ; les moins bonnes gardent un minimum pour continuer d'être testées.</p>
    ${tableHtml('Angles de message', variant.table, true)}
    ${tableHtml('Secteurs', sector.table)}
    ${tableHtml('Régions', region.table)}
    <p style="color:#999;font-size:11px;margin-top:18px">Généré automatiquement · Hdigiweb IA</p>
  </div>`

  try {
    await db.insert(learning_reports).values({
      period_start: periodStart,
      period_end: now,
      emails_sent: totalSent,
      reply_rate: totalSent ? +((totalReplied / totalSent) * 100).toFixed(1) : 0,
      rdv_count: totalRdv,
      top_sectors: sector.table.slice(0, 3).map(r => r.value),
      top_subject_patterns: variant.table.slice(0, 3).map(r => r.value),
      recommendations: { variant: variant.weights, sector: sector.weights, region: region.weights } as unknown as Record<string, unknown>,
      applied: true,
    })
  } catch (e) { console.error('[self-improve] insert report', e) }

  await sendReport(html, `🧠 Auto-apprentissage : ${totalSent} envois · ${totalReplied} réponses · ${totalRdv} RDV`)

  return NextResponse.json({
    period_days: PERIOD_DAYS,
    totals: { sent: totalSent, replied: totalReplied, rdv: totalRdv },
    variant: variant.table,
    sector: sector.table,
    region: region.table,
  })
}
