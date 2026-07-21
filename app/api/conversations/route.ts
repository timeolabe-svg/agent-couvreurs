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
    const { inArray, desc, ne, isNull, or, and, eq, sql, gte } = await import('drizzle-orm')
    const { stripQuotedReply, isEmptyEmailComplaint, isChallengeResponseSpam } = await import('@/lib/reply-agent/classifier')
    const { cleanIncomingBody } = await import('@/lib/decode-body')

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

    // 4ter. ÉPUISÉ : plus rien ne partira automatiquement pour ce contact — aucun mail en file,
    // aucun brouillon en attente d'envoi, et les 2 relances de conversation ont été consommées.
    // Ces conversations n'ont plus rien à faire dans "En attente" → onglet "Échoué".
    const [mailsEnFile, brouillonsEnAttente, relancesConvo] = contactIds.length
      ? await Promise.all([
          db.selectDistinct({ id: email_queue.contact_id }).from(email_queue)
            .where(and(inArray(email_queue.contact_id, contactIds), inArray(email_queue.status, ['pending', 'queued', 'sending']))),
          db.selectDistinct({ id: incoming_replies.contact_id }).from(reply_drafts)
            .innerJoin(incoming_replies, eq(incoming_replies.id, reply_drafts.incoming_reply_id))
            .where(and(inArray(incoming_replies.contact_id, contactIds), inArray(reply_drafts.status, ['pending', 'scheduled']))),
          db.select({ id: email_queue.contact_id, n: sql<number>`count(*)::int` }).from(email_queue)
            .where(and(inArray(email_queue.contact_id, contactIds), gte(email_queue.sequence_step, 20), eq(email_queue.status, 'sent')))
            .groupBy(email_queue.contact_id),
        ])
      : [[], [], []]
    const aMailEnFile = new Set(mailsEnFile.map(r => r.id).filter(Boolean))
    const aBrouillon = new Set(brouillonsEnAttente.map(r => r.id).filter(Boolean))
    const relancesFinies = new Set(relancesConvo.filter(r => (r.n ?? 0) >= 2).map(r => r.id).filter(Boolean))
    const contactsExhausted = new Set(
      contactIds.filter(id => !aMailEnFile.has(id) && !aBrouillon.has(id) && relancesFinies.has(id))
    )

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
      exhausted: boolean // plus aucune relance ni brouillon à venir → conversation morte
      messages: ConvMessage[]
      lastDate: string
    }
    const groups = new Map<string, Group>()

    const groupKeyFor = (contactId: string | null, email: string) => contactId ?? `email:${email}`

    // Anti-doublon d'AFFICHAGE (le même message parfois ré-ingéré → base64 non reconnu → il
    // apparaissait 2-3 fois, le fil semblait "dans tous les sens"). Normalisation pour comparer.
    const normForDedup = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9àâäéèêëîïôöùûüç]+/gi, ' ').trim().slice(0, 160)

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
          exhausted: r.contact_id ? contactsExhausted.has(r.contact_id) : false,
          messages: [],
          lastDate: r.created_at?.toISOString() ?? '',
        })
      }
      const g = groups.get(key)!
      const decodedBody = stripHtmlLite(cleanIncomingBody(r.body))
      const displayBody = stripQuotedReply(decodedBody) || decodedBody
      g.messages.push({
        role: 'received',
        subject: r.subject ?? undefined,
        body: displayBody,
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
        // 6) Auto-réponses (accusé de réception / absence = 'oof') → masquées de la messagerie
        //    (ce sont des bots, pas une vraie conversation). MAIS le prospect reste dans la
        //    séquence : ses relances continuent / sont décalées au retour. On le recontacte.
        if (lastReceived.classification === 'oof') return false
        // 7) Changement d'adresse mail → pas une conversation (le prospect est recontacté sur
        //    sa nouvelle adresse via un contact neuf ; inutile d'afficher ça comme un échange).
        if (/changement d'?adresse|nouvelle adresse\s*(mail|e-?mail|[ée]lectronique|de messagerie)|notez\s+(notre|ma)\s+nouvelle\s+adresse/i.test(lastReceived.body)) return false
        // 8) Conversation clairement en ANGLAIS = mail de warmup (cible = artisans FR) → masquée.
        {
          const b = (lastReceived.body || '').toLowerCase()
          const hasFrench = /[àâäéèêëîïôöùûüç]/.test(b) || /\b(bonjour|merci|vous|nous|votre|oui|non|pas|devis|rappel|cordialement|à|est|pour|avec|bien)\b/.test(b)
          const hasEnglish = /\b(the|thanks|thank you|please|regards|meeting|would|your|hello|hi there|no thank|i want|we can|best regards|sent from my iphone)\b/.test(b)
          if (!hasFrench && hasEnglish) return false
        }
        // 9) AUTO-ARCHIVAGE : plus aucun échange (ni eux ni nous) depuis 14 jours et pas de
        //    RDV calé → conversation morte, masquée automatiquement. (Une relance envoyée
        //    compte comme un échange → elle la fait réapparaître, c'est voulu.)
        {
          const lastTs = Math.max(0, ...g.messages.map(m => new Date(m.date).getTime() || 0))
          if (!g.rdvBooked && lastTs > 0 && Date.now() - lastTs > 14 * 86400000) return false
        }
        return true
      })
      .map(g => {
        g.messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        // Dédup d'AFFICHAGE des messages REÇUS en double (même contenu ré-ingéré → base64 non
        // reconnu), APRÈS le tri chronologique : on garde la PREMIÈRE occurrence (la plus ancienne,
        // celle qui porte les vraies réponses de l'agent) et on retire les répétitions ultérieures.
        // Les messages 'sent'/'agent' ne sont jamais dédupliqués.
        const seen = new Set<string>()
        g.messages = g.messages.filter(m => {
          if (m.role !== 'received') return true
          const norm = normForDedup(m.body)
          if (!norm) return true
          if (seen.has(norm)) return false
          seen.add(norm)
          return true
        })
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
