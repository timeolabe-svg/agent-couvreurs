/**
 * GET /api/cron/interested-report
 *
 * Rapport LECTURE SEULE : liste les prospects qui ont montré de l'INTÉRÊT (interest,
 * rdv_request, question, objection) d'après les réponses traitées (incoming_replies),
 * regroupés par contact, avec : dernière réponse, si l'agent a déjà répondu, et si des
 * relances sont encore en file. Sert à repérer les leads chauds OUBLIÉS / à relancer.
 *
 * Ne modifie RIEN. Protégé par cron-auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

const WARM = ['interest', 'rdv_request', 'question', 'objection']

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const { sql } = await import('@/lib/db')

  // Dernière réponse "chaude" par contact + statut de suivi.
  const rows = (await sql`
    WITH warm AS (
      SELECT DISTINCT ON (COALESCE(ir.contact_id::text, ir.from_email))
        ir.id, ir.contact_id, ir.from_email, ir.classification, ir.body, ir.created_at
      FROM incoming_replies ir
      WHERE ir.classification = ANY(${WARM})
      ORDER BY COALESCE(ir.contact_id::text, ir.from_email), ir.created_at DESC
    )
    SELECT
      w.from_email, w.classification, w.body, w.created_at,
      c.company, c.city, c.phone, c.website,
      -- l'agent a-t-il déjà envoyé une réponse à ce prospect ?
      (SELECT COUNT(*) FROM reply_drafts rd
        JOIN incoming_replies ir2 ON ir2.id = rd.incoming_reply_id
        WHERE ir2.contact_id = w.contact_id AND rd.status = 'sent')::int AS agent_replies_sent,
      -- le prospect a-t-il répondu APRÈS notre dernière réponse ? (silence = à relancer)
      (SELECT MAX(ir3.created_at) FROM incoming_replies ir3 WHERE ir3.contact_id = w.contact_id) AS last_incoming_at
    FROM warm w
    LEFT JOIN contacts c ON c.id = w.contact_id
    ORDER BY w.created_at DESC
    LIMIT 100
  `) as Array<{
    from_email: string; classification: string; body: string; created_at: string
    company: string | null; city: string | null; phone: string | null; website: string | null
    agent_replies_sent: number; last_incoming_at: string | null
  }>

  const prospects = rows.map(r => ({
    company: r.company ?? r.from_email,
    email: r.from_email,
    city: r.city ?? '',
    phone: r.phone ?? '',
    classification: r.classification,
    lastMessage: (r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
    lastMessageAt: r.created_at,
    agentReplied: r.agent_replies_sent > 0,
  }))

  return NextResponse.json({
    ok: true,
    count: prospects.length,
    // Priorité : les intéressés à qui l'agent n'a JAMAIS répondu (= oubliés).
    jamais_relances: prospects.filter(p => !p.agentReplied),
    deja_repondu: prospects.filter(p => p.agentReplied),
  })
}
