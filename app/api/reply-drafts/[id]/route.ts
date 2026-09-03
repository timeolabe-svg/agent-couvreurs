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
    // ⚠️ On TRACE que c'est Timéo qui rejette, pas la machine. Sans cette marque, le rattrapage
    // régénérait le brouillon quelques minutes plus tard : un refus humain contourné par un cron.
    await db.update(reply_drafts).set({ status: 'rejected', rejete_par: 'humain', rejete_le: new Date() }).where(eq(reply_drafts.id, id))
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

    // ⚠️ DÉFENSE EN PROFONDEUR : l'UI masque déjà le bouton Envoyer pour un brouillon LinkedIn
    // (aucune session SMTP pour ce canal), mais cette route reste la SORTIE UNIQUE — un appel
    // direct (cache de page périmé, futur appelant) doit être refusé ici aussi, avec un motif
    // clair, plutôt que de tomber par accident sur "sans adresse" faute de from_email.
    if (incoming?.channel === 'linkedin') {
      return NextResponse.json({ error: 'Brouillon LinkedIn : seul le bot peut l\'envoyer, via /api/linkedin/pending-replies' }, { status: 400 })
    }

    // ⚠️ On envoie par le MOTEUR MAISON (SMTP Gmail), pas par Instantly : Instantly ne sert plus
    // qu'au warmup, donc l'ancien appel échouait systématiquement et la validation manuelle d'une
    // réponse ne partait JAMAIS (échec silencieux côté "À valider").
    const { sendReplyEmail } = await import('@/lib/reply-agent/send-reply')
    const { stripQuotedReply } = await import('@/lib/reply-agent/classifier')

    try {
      if (incoming) {
        const r = await sendReplyEmail(incoming.id, updatedBody)
        if (!r.ok) {
          return NextResponse.json({ error: `Envoi échoué: ${(r.error ?? '').slice(0, 120)}` }, { status: 500 })
        }
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
