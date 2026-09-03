/**
 * GET /api/cron/debug-contact?email=xxx
 *
 * Diagnostic LECTURE SEULE : dump TOUT ce qui est stocké pour un contact —
 * réponses reçues (brut + id Instantly), réponses de l'agent, RDV, file d'envoi.
 * Sert à vérifier si une "réponse" est réelle (venue d'Instantly) ou suspecte.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const email = req.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'Missing ?email=' }, { status: 400 })

  const { sql } = await import('@/lib/db')

  try {
  // ⚠️ `google_reviews_count` et `email_validated` sont dans la liste depuis le 03/09/2026 : sans
  // eux, ce diagnostic ne pouvait pas répondre à la seule question qui compte quand Haris rejette
  // un lead (« combien d'avis avait-il ? »). Un champ absent d'un SELECT se lit `undefined`, ce qui
  // ressemble à « la valeur est vide » — et j'ai conclu deux fois de travers là-dessus dans la
  // même journée. Ce qu'on n'a pas demandé à la base ne dit rien.
  const contact = (await sql`SELECT id, email, company, city, phone, source, created_at, website, sector, google_reviews_count, email_validated, audit_score, audit_level, audit_weaknesses, audit_done FROM contacts WHERE LOWER(email) = LOWER(${email}) LIMIT 1`) as Array<Record<string, unknown>>
  const cid = (contact[0]?.id as string | undefined) ?? null

  const incoming = (await sql`
    SELECT id, from_email, subject, body, classification, action_taken, instantly_reply_id, created_at, processed_at
    FROM incoming_replies
    WHERE LOWER(from_email) = LOWER(${email})
    ORDER BY created_at ASC
  `) as Array<Record<string, unknown>>

  const drafts = cid ? (await sql`
    SELECT rd.id, rd.body, rd.status, rd.sent_at, rd.created_at
    FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
    WHERE ir.contact_id = ${cid}::uuid
    ORDER BY rd.created_at ASC
  `) as Array<Record<string, unknown>> : []

  const rdvs = cid ? (await sql`SELECT id, scheduled_at, status, google_event_id, notes, created_at FROM rdv WHERE contact_id = ${cid}::uuid ORDER BY created_at ASC`) as Array<Record<string, unknown>> : []

  // ⚠️ Le CONTENU des mails partis manquait ici. On pouvait donc voir qu'un mail avait été envoyé,
  // jamais CE QU'IL DISAIT au prospect — impossible de vérifier qu'il correspond bien à l'offre du
  // client, ce qui est pourtant la première question à se poser quand un prospect répond de travers.
  const queue = cid ? (await sql`SELECT id, sequence_step, status, from_email, sent_at, scheduled_at, subject, body FROM email_queue WHERE contact_id = ${cid}::uuid ORDER BY sequence_step ASC`) as Array<Record<string, unknown>> : []

  return NextResponse.json({
    contact: contact[0] ?? null,
    incoming_replies: incoming.map(r => ({
      ...r,
      // instantly_reply_id : préfixe 'imap:' = lu via IMAP maison ; UUID/autre = venu d'Instantly.
      source: typeof r.instantly_reply_id === 'string' && (r.instantly_reply_id as string).startsWith('imap:') ? 'IMAP-maison' : (r.instantly_reply_id ? 'Instantly' : 'inconnu'),
    })),
    reply_drafts: drafts,
    rdv: rdvs,
    email_queue: queue,
  })
  } catch (err) {
    return NextResponse.json({ error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 300) : undefined }, { status: 500 })
  }
}
