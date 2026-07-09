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
  const { contacts, incoming_replies, reply_drafts, email_queue } = await import('@/lib/db/schema')
  const { eq, and, sql } = await import('drizzle-orm')
  const { sendReply } = await import('@/lib/instantly/client')
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

  if (!latestReply.instantly_reply_id) {
    return NextResponse.json({ error: 'Latest incoming reply has no instantly_reply_id' }, { status: 422 })
  }

  // 3. Find the original sender email account
  const [orig] = await db
    .select({ from_email: email_queue.from_email })
    .from(email_queue)
    .where(and(eq(email_queue.contact_id, contact.id), eq(email_queue.status, 'sent')))
    .orderBy(sql`${email_queue.sent_at} desc`)
    .limit(1)

  const eaccount = orig?.from_email

  // 3b. HISTORIQUE COMPLET (nos envois + réponses reçues + réponses agent déjà envoyées)
  //     → l'IA LIT toute la conversation et ne RÉPÈTE pas ce qui a déjà été dit.
  const sentEmails = await db.select({ body: email_queue.body, sentAt: email_queue.sent_at })
    .from(email_queue).where(and(eq(email_queue.contact_id, contact.id), eq(email_queue.status, 'sent')))
  const received = await db.select({ body: incoming_replies.body, createdAt: incoming_replies.created_at })
    .from(incoming_replies).where(eq(incoming_replies.contact_id, contact.id))
  const agentDrafts = await db.select({ body: reply_drafts.body, sentAt: reply_drafts.sent_at, createdAt: reply_drafts.created_at, status: reply_drafts.status })
    .from(reply_drafts).innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
    .where(eq(incoming_replies.contact_id, contact.id))

  // ANTI-DOUBLON : si l'agent a déjà envoyé une relance dans les 2 derniers jours → on stoppe.
  const recentSend = agentDrafts.some(a => a.status === 'sent' && a.sentAt && (Date.now() - new Date(a.sentAt).getTime()) < 2 * 24 * 3600 * 1000)
  if (recentSend) {
    return NextResponse.json({ skipped: true, reason: 'relance déjà envoyée récemment (anti-doublon)', company: contact.company })
  }

  const histItems = [
    ...sentEmails.filter(e => e.body).map(e => ({ role: 'sent' as const, body: e.body, ts: e.sentAt ? new Date(e.sentAt).getTime() : 0 })),
    ...received.filter(r => r.body).map(r => ({ role: 'received' as const, body: r.body, ts: r.createdAt ? new Date(r.createdAt).getTime() : 0 })),
    ...agentDrafts.filter(a => a.body).map(a => ({ role: 'sent' as const, body: a.body, ts: (a.sentAt ?? a.createdAt) ? new Date((a.sentAt ?? a.createdAt) as Date).getTime() : 0 })),
  ].sort((x, y) => x.ts - y.ts)
    .map(i => ({ role: i.role, body: i.body, date: i.ts ? new Date(i.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '' }))

  // 4. Génère une relance (stratégie rdv_request) EN LISANT l'historique.
  const replyBody = await generateReplyResponse({
    classification: 'rdv_request',
    originalEmailBody: '',
    replyBody: latestReply.body,
    contactName: contact.name ?? contact.company,
    contactCompany: contact.company,
    contactCity: contact.city ?? '',
    contactSector: contact.sector ?? undefined,
    conversationHistory: histItems,
    fromEmail: eaccount, // signature = boîte qui a contacté ce prospect
  })

  // ANTI-MAIL-VIDE : jamais d'envoi si la génération est vide/trop courte.
  if (!replyBody || replyBody.trim().length < 20) {
    return NextResponse.json({ error: 'génération vide — envoi annulé (anti-mail-vide)', company: contact.company }, { status: 500 })
  }

  // 5. Send via Instantly
  await sendReply({
    reply_to_id: latestReply.instantly_reply_id,
    body: replyBody,
    eaccount,
    subject: latestReply.subject ?? undefined,
  })

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
