import { NextRequest, NextResponse } from 'next/server'

// Traite une objection en retard : génère + envoie la réponse (temporaire)
export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { db } = await import('@/lib/db')
  const { incoming_replies, contacts, email_queue, reply_drafts } = await import('@/lib/db/schema')
  const { eq, and, sql } = await import('drizzle-orm')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')
  const { sendReply } = await import('@/lib/instantly/client')

  const TARGET = 'couvreurdugers@gmail.com'

  const [reply] = await db.select().from(incoming_replies).where(eq(incoming_replies.from_email, TARGET)).limit(1)
  if (!reply) return NextResponse.json({ error: 'reply not found' })

  const contact = reply.contact_id
    ? (await db.select().from(contacts).where(eq(contacts.id, reply.contact_id)).limit(1))[0]
    : null

  // dernier email envoyé + boîte d'envoi
  let originalEmailBody = ''
  let eaccount: string | undefined
  if (contact) {
    const [sent] = await db.select({ body: email_queue.body, from_email: email_queue.from_email })
      .from(email_queue)
      .where(and(eq(email_queue.contact_id, contact.id), eq(email_queue.status, 'sent')))
      .orderBy(sql`${email_queue.sent_at} desc`).limit(1)
    originalEmailBody = sent?.body ?? ''
    eaccount = sent?.from_email
  }

  const body = await generateReplyResponse({
    classification: 'objection',
    originalEmailBody,
    replyBody: reply.body,
    contactName: contact?.name ?? '',
    contactCompany: contact?.company ?? TARGET,
    contactCity: contact?.city ?? '',
  })

  const out: Record<string, unknown> = { generated: body, eaccount }

  if (request.nextUrl.searchParams.get('send') === '1' && reply.instantly_reply_id) {
    try {
      await sendReply({ reply_to_id: reply.instantly_reply_id, body, eaccount, subject: reply.subject ?? undefined })
      await db.insert(reply_drafts).values({ incoming_reply_id: reply.id, body, status: 'sent', sent_at: new Date() })
      await db.update(incoming_replies).set({ classification: 'objection', action_taken: 'replied' }).where(eq(incoming_replies.id, reply.id))
      out.sent = true
    } catch (e) {
      out.sent = false
      out.error = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json(out)
}
