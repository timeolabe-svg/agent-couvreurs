import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { cleanIncomingBody } from '@/lib/decode-body'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Un FAUX opt-out = le prospect a été blocklisté alors que son message ne contient aucun refus :
// le "Stop" venait de NOTRE pied de page cité dans sa réponse. On détecte ces cas (message réel
// sans refus, classé interest/question/rdv_request) et on les débloque. ?apply=1 pour exécuter.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  const rows = (await sql`
    SELECT DISTINCT ON (b.id) b.id AS bl_id, b.email, b.reason, c.company,
           ir.classification, ir.subject, ir.body, ir.created_at
    FROM blocklist b
    JOIN contacts c ON LOWER(c.email) = LOWER(b.email)
    JOIN incoming_replies ir ON ir.contact_id = c.id
    WHERE b.reason = 'unsubscribe'
      AND ir.classification IN ('interest', 'question', 'objection', 'rdv_request')
    ORDER BY b.id, ir.created_at DESC
  `) as Array<{ bl_id: string; email: string; reason: string; company: string | null; classification: string; subject: string | null; body: string; created_at: string }>

  // Le VRAI texte du prospect : on coupe tout ce qui suit un marqueur de citation / notre footer.
  const realText = (r: { subject?: string | null; body?: string | null }) =>
    `${r.subject ?? ''}\n${cleanIncomingBody(r.body || '')}`
      .replace(/[’‘`´]/g, "'")
      .split(/pour ne plus recevoir mes emails/i)[0]
      .split(/envoy[ée]\s+de\s+mon\s+/i)[0]
      .split(/>\s*le\s/i)[0]
      .toLowerCase()

  // Refus RÉEL du prospect (dans SON texte, pas dans la citation).
  const vraiRefus = (t: string) =>
    /^\s*stop\b/.test(t) || /d[ée]sabonn|d[ée]sinscri|unsubscribe|ne plus (me |nous )?(recevoir|contacter|[ée]crire|solliciter)|pas int[ée]ress|retirez[- ]?(moi|nous)/.test(t)

  const faux = rows.filter(r => !vraiRefus(realText(r)))
  if (!apply) {
    return NextResponse.json({
      dry_run: true, faux_optout: faux.length,
      leads: faux.map(r => ({ company: r.company, email: r.email, classification: r.classification, texte_reel: realText(r).replace(/\s+/g, ' ').slice(0, 70) })),
    })
  }

  const debloques: string[] = []
  for (const r of faux) {
    await sql`DELETE FROM blocklist WHERE id = ${r.bl_id}`
    debloques.push(`${r.company ?? r.email} (${r.classification})`)
  }
  return NextResponse.json({ ok: true, debloques: debloques.length, leads: debloques })
}
