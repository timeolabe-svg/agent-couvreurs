import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// One-shot : reclasse en base les vieilles réponses "mail vide / rien reçu"
// mal classées par Gemini (interest/question) → spam/no_action, et annule
// les brouillons encore en attente pour que l'agent arrête de répondre.
// Auth : protégé par le middleware (proxy.ts) → il faut être connecté au dashboard.
// METHODE POST uniquement : une mutation via GET serait vulnérable au CSRF
// (un lien piégé cliqué par un utilisateur connecté déclencherait l'écriture).
export async function POST(_request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { incoming_replies, reply_drafts } = await import('@/lib/db/schema')
  const { ne, inArray, or, isNull, and } = await import('drizzle-orm')
  const { isEmptyEmailComplaint } = await import('@/lib/reply-agent/classifier')

  // Toutes les réponses pas encore marquées spam
  const rows = await db
    .select({ id: incoming_replies.id, body: incoming_replies.body, subject: incoming_replies.subject })
    .from(incoming_replies)
    .where(or(isNull(incoming_replies.classification), ne(incoming_replies.classification, 'spam')))

  const toFix = rows.filter(r => isEmptyEmailComplaint(r.body ?? '', r.subject ?? ''))
  const ids = toFix.map(r => r.id)

  let cancelledDrafts = 0
  if (ids.length > 0) {
    await db.update(incoming_replies)
      .set({ classification: 'spam', action_taken: 'no_action' })
      .where(inArray(incoming_replies.id, ids))

    // Annule UNIQUEMENT les brouillons non encore envoyés (pending/scheduled)
    // — ne jamais écraser le statut 'sent' (historique réel).
    const cancelled = await db.update(reply_drafts)
      .set({ status: 'cancelled' })
      .where(and(
        inArray(reply_drafts.incoming_reply_id, ids),
        inArray(reply_drafts.status, ['pending', 'scheduled']),
      ))
      .returning({ id: reply_drafts.id })
    cancelledDrafts = cancelled.length
  }

  return NextResponse.json({
    scanned: rows.length,
    reclassified: ids.length,
    cancelledDrafts,
    samples: toFix.slice(0, 10).map(r => (r.body ?? '').slice(0, 80)),
  })
}
