import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, _demo: true })
  }

  const body = await request.json() as { body?: string; action: 'send' | 'reject' | 'update' }
  const { action } = body

  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { reply_drafts, incoming_replies, learned_replies, email_queue } = await import('@/lib/db/schema')
  const { eq, and, sql } = await import('drizzle-orm')

  const [draft] = await db.select().from(reply_drafts).where(eq(reply_drafts.id, id))
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  if (action === 'reject') {
    await db.update(reply_drafts).set({ status: 'rejected' }).where(eq(reply_drafts.id, id))
    return NextResponse.json({ ok: true })
  }

  if (action === 'update') {
    if (!body.body) return NextResponse.json({ error: 'body required for update' }, { status: 400 })
    await db.update(reply_drafts).set({ body: body.body }).where(eq(reply_drafts.id, id))
    return NextResponse.json({ ok: true })
  }

  if (action === 'send') {
    const updatedBody = body.body ?? draft.body

    const [incoming] = draft.incoming_reply_id
      ? await db.select().from(incoming_replies).where(eq(incoming_replies.id, draft.incoming_reply_id))
      : [null]

    const { sendReply } = await import('@/lib/instantly/client')
    const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')

    try {
      if (incoming) {
        // Retrouver la boîte gabin@ d'origine (eaccount requis par Instantly)
        let eaccount: string | undefined
        if (incoming.contact_id) {
          const [orig] = await db
            .select({ from_email: email_queue.from_email })
            .from(email_queue)
            .where(and(eq(email_queue.contact_id, incoming.contact_id), eq(email_queue.status, 'sent')))
            .orderBy(sql`${email_queue.sent_at} desc`)
            .limit(1)
          eaccount = orig?.from_email
        }
        await sendReply({
          reply_to_id: incoming.instantly_reply_id ?? incoming.id,
          body: updatedBody,
          eaccount,
          subject: incoming.subject ?? undefined,
        })
      }

      await db
        .update(reply_drafts)
        .set({ status: 'sent', sent_at: new Date(), body: updatedBody })
        .where(eq(reply_drafts.id, id))

      if (incoming) {
        await db
          .update(incoming_replies)
          .set({ action_taken: 'replied' })
          .where(eq(incoming_replies.id, incoming.id))

        // AUTO-APPRENTISSAGE : mémoriser la réponse validée par le client.
        // L'agent réutilisera cette réponse pour des questions similaires → autonomie croissante.
        try {
          const edited = updatedBody.trim() !== draft.body.trim()
          await db.insert(learned_replies).values({
            question: stripQuotedReply(incoming.body) || incoming.body,
            answer: updatedBody,
            classification: incoming.classification,
            edited,
          })
        } catch (learnErr) {
          console.error('[reply-drafts] apprentissage non enregistré:', learnErr)
        }
      }

      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[reply-drafts/send]', err)
      return NextResponse.json({ error: 'Send failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
