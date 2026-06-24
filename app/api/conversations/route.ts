import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface ConvMessage {
  role: 'sent' | 'received' | 'agent'
  subject?: string
  body: string
  date: string
  status?: string
  classification?: string
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ conversations: [] })
  }

  try {
    const { db } = await import('@/lib/db')
    const { contacts, email_queue, incoming_replies, reply_drafts } = await import('@/lib/db/schema')
    const { inArray, desc, ne, isNull, or } = await import('drizzle-orm')
    const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')

    // 1. Réponses reçues — on EXCLUT le spam et les réponses automatiques (bots,
    //    accusés de réception) : on ne montre que les vraies conversations.
    const replies = await db
      .select({
        id: incoming_replies.id,
        contact_id: incoming_replies.contact_id,
        from_email: incoming_replies.from_email,
        subject: incoming_replies.subject,
        body: incoming_replies.body,
        classification: incoming_replies.classification,
        created_at: incoming_replies.created_at,
      })
      .from(incoming_replies)
      .where(or(isNull(incoming_replies.classification), ne(incoming_replies.classification, 'spam')))
      .orderBy(desc(incoming_replies.created_at))
      .limit(500)

    if (replies.length === 0) return NextResponse.json({ conversations: [] })

    // Clés de regroupement : par contact si dispo, sinon par email
    const contactIds = [...new Set(replies.map(r => r.contact_id).filter((x): x is string => Boolean(x)))]
    const replyIds = replies.map(r => r.id)

    // 2. Infos contacts
    const contactRows = contactIds.length
      ? await db.select().from(contacts).where(inArray(contacts.id, contactIds))
      : []
    const contactMap = new Map(contactRows.map(c => [c.id, c]))

    // 3. Emails envoyés pour ces contacts
    const sentRows = contactIds.length
      ? await db
          .select({
            contact_id: email_queue.contact_id,
            subject: email_queue.subject,
            body: email_queue.body,
            sent_at: email_queue.sent_at,
            status: email_queue.status,
          })
          .from(email_queue)
          .where(inArray(email_queue.contact_id, contactIds))
      : []

    // 4. Réponses de l'agent (drafts) liées à ces réponses
    const draftRows = await db
      .select({
        incoming_reply_id: reply_drafts.incoming_reply_id,
        body: reply_drafts.body,
        status: reply_drafts.status,
        sent_at: reply_drafts.sent_at,
        created_at: reply_drafts.created_at,
      })
      .from(reply_drafts)
      .where(inArray(reply_drafts.incoming_reply_id, replyIds))

    // Assemble par groupe
    type Group = {
      key: string
      contactId: string | null
      company: string
      email: string
      city: string
      phone: string | null
      website: string | null
      classification: string | null
      messages: ConvMessage[]
      lastDate: string
    }
    const groups = new Map<string, Group>()

    const groupKeyFor = (contactId: string | null, email: string) => contactId ?? `email:${email}`

    for (const r of replies) {
      const key = groupKeyFor(r.contact_id, r.from_email)
      const c = r.contact_id ? contactMap.get(r.contact_id) : null
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          contactId: r.contact_id,
          company: c?.company ?? r.from_email,
          email: c?.email ?? r.from_email,
          city: c?.city ?? '',
          phone: c?.phone ?? null,
          website: c?.website ?? null,
          classification: r.classification,
          messages: [],
          lastDate: r.created_at?.toISOString() ?? '',
        })
      }
      const g = groups.get(key)!
      g.messages.push({
        role: 'received',
        subject: r.subject ?? undefined,
        body: stripQuotedReply(r.body) || r.body,
        date: r.created_at?.toISOString() ?? '',
        classification: r.classification ?? undefined,
      })
      // Drafts liés à cette réponse
      for (const d of draftRows.filter(d => d.incoming_reply_id === r.id)) {
        g.messages.push({
          role: 'agent',
          body: d.body,
          date: (d.sent_at ?? d.created_at)?.toISOString() ?? '',
          status: d.status ?? undefined,
        })
      }
    }

    // Ajoute les emails envoyés dans le bon groupe
    for (const s of sentRows) {
      if (!s.contact_id) continue
      const key = groupKeyFor(s.contact_id, '')
      const g = groups.get(key)
      if (!g) continue
      g.messages.push({
        role: 'sent',
        subject: s.subject,
        body: s.body,
        date: s.sent_at?.toISOString() ?? '',
        status: s.status ?? undefined,
      })
    }

    // Trie les messages par date dans chaque conversation + calcule lastDate
    const conversations = [...groups.values()].map(g => {
      g.messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      g.lastDate = g.messages.length ? g.messages[g.messages.length - 1].date : g.lastDate
      return g
    })
    conversations.sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime())

    return NextResponse.json({ conversations })
  } catch (err) {
    console.error('[conversations] error', err)
    return NextResponse.json({ conversations: [], error: err instanceof Error ? err.message : 'error' }, { status: 200 })
  }
}
