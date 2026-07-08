import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })

  const email = request.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'Missing ?email= query param' }, { status: 400 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, incoming_replies, reply_drafts } = await import('@/lib/db/schema')
  const { eq, sql } = await import('drizzle-orm')
  const { sendReplyEmail } = await import('@/lib/reply-agent/send-reply')
  const { generateReplyResponse } = await import('@/lib/reply-agent/generator')

  // 1. Find contact by email
  const [contact] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1)
  if (!contact) {
    return NextResponse.json({ error: `Contact not found: ${email}` }, { status: 404 })
  }

  // 2. Find the latest incoming_reply for this contact
  const [latestReply] = await db
    .select()
    .from(incoming_replies)
    .where(eq(incoming_replies.contact_id, contact.id))
    .orderBy(sql`${incoming_replies.created_at} desc`)
    .limit(1)

  if (!latestReply) {
    return NextResponse.json({ error: `No incoming reply found for contact: ${email}` }, { status: 404 })
  }

  // 3. Generate a targeted follow-up with rdv_request strategy
  const replyBody = await generateReplyResponse({
    classification: 'rdv_request',
    originalEmailBody: '',
    replyBody: latestReply.body,
    contactName: contact.name ?? contact.company,
    contactCompany: contact.company,
    contactCity: contact.city ?? '',
    contactSector: contact.sector ?? undefined,
  })

  // 4. Send via le moteur MAISON (SMTP Gmail) — depuis la boîte gabin@ d'origine.
  const sendRes = await sendReplyEmail(latestReply.id, replyBody)
  if (!sendRes.ok) {
    return NextResponse.json({ error: `Send failed: ${sendRes.error ?? 'inconnu'}` }, { status: 500 })
  }

  // 6. Insert into reply_drafts with status sent
  await db.insert(reply_drafts).values({
    incoming_reply_id: latestReply.id,
    body: replyBody,
    status: 'sent',
    sent_at: new Date(),
  })

  console.log(`[manual-relay] Relance envoyée → ${contact.company} (${email})`)

  return NextResponse.json({
    sent: true,
    to: email,
    company: contact.company,
  })
}
