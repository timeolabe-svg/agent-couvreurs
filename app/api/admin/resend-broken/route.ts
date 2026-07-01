import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Re-contacte proprement les contacts qui ont reçu un email avec l'ANCIEN code bugué
// (mails vides / relances vides). On remet leur file en 'pending' → l'autopilot
// régénère des emails CORRECTS et les renvoie progressivement (35/boîte/jour).
//
// GARDE-FOUS (jamais re-contacter) :
//  - les contacts blocklistés (opt-out — illégal)
//  - les contacts qui ont DÉJÀ répondu (déjà en conversation)
//
// Auth : protégé par le middleware (proxy.ts) → être connecté au dashboard.
//
// USAGE (ouvrir l'URL dans le navigateur, connecté) :
//  - Voir le nombre éligible (aucune modif) :  /api/admin/resend-broken
//  - Relancer réellement N contacts          :  POST { confirm:true, limit:N }

async function selectEligible(limit: number | null) {
  const { db } = await import('@/lib/db')
  const { email_queue, contacts, blocklist, incoming_replies } = await import('@/lib/db/schema')
  const { eq, and, sql, notInArray } = await import('drizzle-orm')

  const base = db
    .select({ queueId: email_queue.id, email: contacts.email, company: contacts.company })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(and(
      eq(email_queue.status, 'sent'),
      notInArray(contacts.email, db.select({ e: blocklist.email }).from(blocklist)),
      notInArray(contacts.id, db.select({ c: incoming_replies.contact_id }).from(incoming_replies).where(sql`${incoming_replies.contact_id} is not null`)),
    ))
    .orderBy(sql`${email_queue.sent_at} asc`)

  return limit ? base.limit(limit) : base
}

async function doReset(limit: number) {
  const { db } = await import('@/lib/db')
  const { email_queue } = await import('@/lib/db/schema')
  const { inArray } = await import('drizzle-orm')

  const eligible = await selectEligible(limit)
  const ids = eligible.map(e => e.queueId)
  let reset = 0
  if (ids.length > 0) {
    const updated = await db
      .update(email_queue)
      .set({
        status: 'pending',
        scheduled_at: new Date(),
        sent_at: null,
        sequence_step: 0,
        subject: '__pending_generation__',
        body: '__pending_generation__',
      })
      .where(inArray(email_queue.id, ids))
      .returning({ id: email_queue.id })
    reset = updated.length
  }
  return {
    reset,
    message: `${reset} contact(s) remis en file. L'autopilot va leur renvoyer un email correct, progressivement (35/boîte/jour).`,
    samples: eligible.slice(0, 10).map(e => `${e.company} <${e.email}>`),
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  // GET = DRY-RUN en LECTURE SEULE uniquement (aucune mutation → pas de vecteur CSRF).
  // Pour relancer réellement, utiliser POST { confirm:true, limit:N }.
  const eligible = await selectEligible(null)
  return NextResponse.json({
    dryRun: true,
    message: 'DRY-RUN (lecture seule). Pour relancer : POST {"confirm":true,"limit":N}.',
    eligibleCount: eligible.length,
    samples: eligible.slice(0, 10).map(e => `${e.company} <${e.email}>`),
  })
}

// POST conservé (équivalent), pour un usage programmatique.
export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }
  let confirm = false
  let limit = 20
  try {
    const body = await request.json() as { confirm?: boolean; limit?: number }
    confirm = body.confirm === true
    if (typeof body.limit === 'number' && body.limit > 0) limit = Math.min(body.limit, 600)
  } catch { /* body optionnel */ }

  if (!confirm) {
    const eligible = await selectEligible(null)
    return NextResponse.json({
      dryRun: true,
      message: 'DRY-RUN : rien modifié. Renvoie avec {"confirm":true} pour relancer.',
      eligibleCount: eligible.length,
      samples: eligible.slice(0, 10).map(e => `${e.company} <${e.email}>`),
    })
  }
  const result = await doReset(limit)
  return NextResponse.json({ dryRun: false, ...result })
}
