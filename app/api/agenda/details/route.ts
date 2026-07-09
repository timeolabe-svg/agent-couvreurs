/**
 * GET /api/agenda/details?contactId=xxx
 *
 * Détails enrichis d'un RDV pour l'agenda :
 *  - la CONVERSATION complète (nos envois + réponses du prospect + réponses de l'agent)
 *  - un RÉSUMÉ IA de ce qui s'est passé (pour préparer l'appel en 10 sec)
 *  - une FICHE ENTREPRISE (qui est ce prospect)
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get('contactId')
  if (!contactId) return NextResponse.json({ error: 'Missing contactId' }, { status: 400 })
  if (!process.env.DATABASE_URL) return NextResponse.json({ conversation: [], summary: '', companyDescription: '' })

  try {
    const { db } = await import('@/lib/db')
    const { contacts, email_queue, incoming_replies, reply_drafts } = await import('@/lib/db/schema')
    const { eq, and, ne } = await import('drizzle-orm')
    const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')

    const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1)
    if (!contact) return NextResponse.json({ error: 'Contact introuvable' }, { status: 404 })

    const sent = await db.select({ body: email_queue.body, at: email_queue.sent_at })
      .from(email_queue)
      .where(and(eq(email_queue.contact_id, contactId), eq(email_queue.status, 'sent'), ne(email_queue.body, '__pending_generation__')))
    const received = await db.select({ body: incoming_replies.body, at: incoming_replies.created_at })
      .from(incoming_replies).where(eq(incoming_replies.contact_id, contactId))
    const drafts = await db.select({ body: reply_drafts.body, at: reply_drafts.sent_at, created: reply_drafts.created_at, status: reply_drafts.status })
      .from(reply_drafts).innerJoin(incoming_replies, eq(reply_drafts.incoming_reply_id, incoming_replies.id))
      .where(eq(incoming_replies.contact_id, contactId))

    const msgs = [
      ...sent.filter(s => s.body).map(s => ({ role: 'nous' as const, body: s.body, ts: s.at ? new Date(s.at).getTime() : 0 })),
      ...received.filter(r => r.body).map(r => ({ role: 'prospect' as const, body: stripQuotedReply(r.body) || r.body, ts: r.at ? new Date(r.at).getTime() : 0 })),
      ...drafts.filter(d => d.status === 'sent' && d.body).map(d => ({ role: 'nous' as const, body: d.body, ts: (d.at ?? d.created) ? new Date((d.at ?? d.created) as Date).getTime() : 0 })),
    ].sort((a, b) => a.ts - b.ts)
      .map(m => ({ role: m.role, body: m.body, date: m.ts ? new Date(m.ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '' }))

    const convText = msgs.map(m => `${m.role === 'nous' ? 'NOUS' : 'PROSPECT'} (${m.date}) : ${m.body}`).join('\n\n').slice(0, 4000)

    let summary = ''
    let companyDescription = ''
    const { generateText } = await import('@/lib/ai')
    if (convText.trim()) {
      try {
        summary = await generateText({
          system: 'Tu résumes un échange commercial en français, factuel, court, pour préparer un appel.',
          prompt: `Résume en 4-6 points ce qui s'est passé avec ce prospect : ce qu'il a demandé, son niveau d'intérêt, ce qui a été convenu, la prochaine étape. Concret, pas de blabla. Ne rien inventer.\n\nÉCHANGE :\n${convText}`,
          maxTokens: 400,
          temperature: 0.4,
        })
      } catch { /* résumé optionnel */ }
    }
    try {
      companyDescription = await generateText({
        system: 'Tu décris brièvement une entreprise BTP locale en français, pour préparer un appel. Ne rien inventer, rester factuel.',
        prompt: `Décris en 3-4 phrases cette entreprise (activité, zone, ce qu'on sait d'utile pour l'appel).\nNom : ${contact.company}\nMétier : ${contact.sector ?? '?'}\nVille : ${contact.city ?? '?'}\nSite web : ${contact.website ?? 'aucun'}\nNote Google : ${contact.google_rating ?? '?'} (${contact.google_reviews_count ?? '?'} avis)\nDéfauts du site détectés : ${(contact.audit_weaknesses as string[] | null)?.join(', ') ?? 'non audité'}`,
        maxTokens: 300,
        temperature: 0.5,
      })
    } catch { /* fiche optionnelle */ }

    return NextResponse.json({
      contact: {
        company: contact.company, name: contact.name, city: contact.city, phone: contact.phone,
        email: contact.email, website: contact.website, sector: contact.sector,
        googleRating: contact.google_rating, googleReviews: contact.google_reviews_count,
      },
      conversation: msgs,
      summary,
      companyDescription,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error', conversation: [], summary: '', companyDescription: '' }, { status: 200 })
  }
}
