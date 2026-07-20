import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Diagnostic de délivrabilité : taux de bounce réel, volume, répartition par boîte.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql

  try {
  const [sent] = (await sql`SELECT count(*)::int AS n, count(distinct contact_id)::int AS contacts FROM email_queue WHERE status = 'sent'`) as Array<{ n: number; contacts: number }>
  const [sent30] = (await sql`SELECT count(*)::int AS n FROM email_queue WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days'`) as Array<{ n: number }>
  const [bounces] = (await sql`SELECT count(*)::int AS n FROM blocklist WHERE reason = 'bounce'`) as Array<{ n: number }>
  const [optouts] = (await sql`SELECT count(*)::int AS n FROM blocklist WHERE reason = 'unsubscribe'`) as Array<{ n: number }>
  const byBox = (await sql`SELECT from_email AS box, count(*)::int AS envoyes FROM email_queue WHERE status = 'sent' AND from_email IS NOT NULL GROUP BY from_email ORDER BY envoyes DESC`) as Array<{ box: string; envoyes: number }>

  // Taux de bounce = adresses ayant bouncé / contacts distincts réellement contactés.
  const contactsSent = sent?.contacts ?? 0
  const bounceRate = contactsSent > 0 ? Math.round((bounces.n / contactsSent) * 1000) / 10 : 0

  let verdict = 'inconnu'
  if (contactsSent >= 20) {
    if (bounceRate < 2) verdict = 'EXCELLENT (< 2%) — réputation saine'
    else if (bounceRate < 5) verdict = 'BON (< 5%) — dans les clous'
    else if (bounceRate < 10) verdict = 'À SURVEILLER (5-10%)'
    else verdict = 'PROBLÈME (> 10%) — validation email à renforcer'
  }

  return NextResponse.json({
    mails_envoyes_total: sent?.n ?? 0,
    mails_envoyes_30j: sent30?.n ?? 0,
    contacts_distincts_contactes: contactsSent,
    bounces: bounces.n,
    taux_de_bounce_pct: bounceRate,
    verdict,
    opt_outs: optouts.n,
    par_boite: byBox,
  })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
