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
  const { reply_drafts, incoming_replies } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

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

    try {
      if (incoming) {
        await sendReply({
          reply_to_id: incoming.instantly_reply_id ?? incoming.id,
          body: updatedBody,
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
      }

      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[reply-drafts/send]', err)
      return NextResponse.json({ error: 'Send failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
