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
    const { contacts, email_queue, incoming_replies, reply_drafts, rdv } = await import('@/lib/db/schema')
    const { inArray, desc, ne, isNull, or, and, eq } = await import('drizzle-orm')
    const { stripQuotedReply, isEmptyEmailComplaint, isChallengeResponseSpam } = await import('@/lib/reply-agent/classifier')
    const { recoverBase64 } = await import('@/lib/decode-body')

    // Nettoyage HTML/CSS à l'affichage : certains mails stockés contiennent encore du
    // HTML brut (style/scripts/balises) qui fuit dans la messagerie du client.
    const stripHtmlLite = (s: string): string => {
      if (!s || !/[<&]/.test(s)) return s
      return s
        .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&eacute;/gi, 'é')
        .replace(/&egrave;/gi, 'è').replace(/&agrave;/gi, 'à').replace(/&ecirc;/gi, 'ê')
        .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    }

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
          // Seulement les VRAIS emails envoyés (jamais les placeholders "__pending_generation__"
          // ni les lignes en attente/annulées) → l'affichage messagerie reste propre.
          .where(and(
            inArray(email_queue.contact_id, contactIds),
            eq(email_queue.status, 'sent'),
            ne(email_queue.body, '__pending_generation__'),
          ))
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

    // 4bis. RDV confirmés → la conversation bascule en onglet "En attente" (le RDV est
    //        calé, on attend qu'il ait lieu — plus rien à traiter). "Positives" reste
    //        réservé aux intéressés SANS RDV encore pris (leads à travailler).
    const rdvRows = contactIds.length
      ? await db.select({ contact_id: rdv.contact_id }).from(rdv)
          .where(and(inArray(rdv.contact_id, contactIds), eq(rdv.status, 'confirmed')))
      : []
    const contactsWithRdv = new Set(rdvRows.map(r => r.contact_id).filter(Boolean))

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
      rdvBooked: boolean
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
          rdvBooked: r.contact_id ? contactsWithRdv.has(r.contact_id) : false,
          messages: [],
          lastDate: r.created_at?.toISOString() ?? '',
        })
      }
      const g = groups.get(key)!
      const decodedBody = stripHtmlLite(recoverBase64(r.body))
      g.messages.push({
        role: 'received',
        subject: r.subject ?? undefined,
        body: stripQuotedReply(decodedBody) || decodedBody,
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

    // Détecte les expéditeurs "junk" (passerelles antispam, no-reply, daemons) à ne pas afficher.
    const isJunkSender = (email: string) =>
      /antispam|xefi\.fr|mailer-daemon|no[-.]?reply|do[-.]?not[-.]?reply|postmaster|bounce@/i.test(email || '')

    // Trie les messages par date dans chaque conversation + calcule lastDate
    const conversations = [...groups.values()]
      .filter(g => {
        // 1) Expéditeur junk (antispam/no-reply/daemon) → jamais une vraie conversation.
        if (isJunkSender(g.email)) return false
        const lastReceived = [...g.messages].reverse().find(m => m.role === 'received')
        // 2) Aucune vraie réponse reçue, ou réponse vide/triviale → on n'affiche pas.
        if (!lastReceived) return false
        const txt = (lastReceived.body || '').trim()
        if (txt.length < 3) return false
        // 3) Spam uniquement → masqué. Les ABSENCES ('oof') restent VISIBLES : c'est un vrai
        //    prospect à relancer à son retour, il ne faut surtout pas les perdre.
        if (lastReceived.classification === 'spam') return false
        // 4) Filtre RÉTROACTIF : vieux leads mal classés (plaintes "mail vide / rien reçu").
        if (isEmptyEmailComplaint(lastReceived.body, '')) return false
        // 5) Anti-spam challenge-response (SpamEnMoins…) déjà stocké → masqué (pas une vraie conv).
        if (isChallengeResponseSpam(lastReceived.body, lastReceived.subject ?? '')) return false
        return true
      })
      .map(g => {
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
