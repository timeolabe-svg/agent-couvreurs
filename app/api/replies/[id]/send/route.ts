import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, _demo: true })
  }
  const { db } = await import('@/lib/db')
  const { reply_drafts, incoming_replies } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const { sendReplyEmail } = await import('@/lib/reply-agent/send-reply')

  const [draft] = await db.select().from(reply_drafts).where(eq(reply_drafts.id, id))
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const [incoming] = await db.select().from(incoming_replies).where(eq(incoming_replies.id, draft.incoming_reply_id!))

  try {
    if (incoming) {
      // Envoi via le moteur MAISON (SMTP Gmail).
      const r = await sendReplyEmail(incoming.id, draft.body)
      if (!r.ok) return NextResponse.json({ error: `Send failed: ${r.error ?? 'inconnu'}` }, { status: 500 })
    }
    await db.update(reply_drafts).set({ status: 'sent', sent_at: new Date() }).where(eq(reply_drafts.id, id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[reply/send]', err)
    return NextResponse.json({ error: 'Send failed' }, { status: 500 })
  }
}
