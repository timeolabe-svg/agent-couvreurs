import { NextRequest, NextResponse } from 'next/server'

// GET /api/leads — list with filters
// POST /api/leads — create single lead

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const sector = searchParams.get('sector')
  const city = searchParams.get('city')
  const search = searchParams.get('search')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Number(searchParams.get('limit') ?? '50'))

  void status

  if (!process.env.DATABASE_URL) {
    const { DEMO_LEADS } = await import('@/data/demo')
    return NextResponse.json({ leads: DEMO_LEADS, total: DEMO_LEADS.length, page: 1 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, rdv, incoming_replies, email_queue } = await import('@/lib/db/schema')
  const { eq, ilike, or, and, sql, inArray } = await import('drizzle-orm')

  // Build conditions array — avoids WHERE overwrite bug
  const conditions = []
  if (sector) conditions.push(eq(contacts.sector, sector))
  if (city) conditions.push(eq(contacts.city, city))
  if (search) conditions.push(
    or(
      ilike(contacts.name, `%${search}%`),
      ilike(contacts.company, `%${search}%`),
      ilike(contacts.email, `%${search}%`)
    )!
  )

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, countResult] = await Promise.all([
    db.select().from(contacts)
      .where(whereClause)
      .limit(limit)
      .offset((page - 1) * limit)
      .orderBy(sql`${contacts.created_at} desc`),
    db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(whereClause),
  ])

  const total = countResult[0]?.count ?? 0

  // STAGE RÉEL par lead (avant : 'contacted' figé pour TOUT le monde → incohérent avec l'agenda
  // qui montrait un RDV). On calcule en 3 requêtes groupées sur les leads de la page :
  // RDV calé > a répondu > contacté (mail envoyé) > prospecté.
  const ids = rows.map(r => r.id)
  const [rdvRows, repliedRows, sentRows] = ids.length > 0
    ? await Promise.all([
        db.select({ id: rdv.contact_id }).from(rdv).where(and(inArray(rdv.contact_id, ids), eq(rdv.status, 'confirmed'))),
        db.selectDistinct({ id: incoming_replies.contact_id }).from(incoming_replies).where(inArray(incoming_replies.contact_id, ids)),
        db.selectDistinct({ id: email_queue.contact_id }).from(email_queue).where(and(inArray(email_queue.contact_id, ids), eq(email_queue.status, 'sent'))),
      ])
    : [[], [], []]
  const rdvSet = new Set(rdvRows.map(r => r.id).filter(Boolean))
  const repliedSet = new Set(repliedRows.map(r => r.id).filter(Boolean))
  const sentSet = new Set(sentRows.map(r => r.id).filter(Boolean))
  const stageOf = (id: string): 'rdv_booked' | 'replied' | 'contacted' | 'prospected' =>
    rdvSet.has(id) ? 'rdv_booked' : repliedSet.has(id) ? 'replied' : sentSet.has(id) ? 'contacted' : 'prospected'

  // Map DB contacts → Lead shape expected by UI
  const leads = rows.map(c => ({
    id: c.id,
    company: c.company,
    contact: c.name ?? '',
    firstName: c.name?.split(' ')[0] ?? '',
    email: c.email,
    phone: c.phone ?? undefined,
    city: c.city ?? '',
    website: c.website ?? undefined,
    googleRating: c.google_rating ?? undefined,
    googleReviews: c.google_reviews_count ?? undefined,
    specialty: c.sector ? [c.sector] : [],
    hasGoogleAds: false,
    hasWebsite: Boolean(c.website),
    stage: stageOf(c.id),
    thread: [],
    score: c.email_confidence_score ?? 50,
    createdAt: c.created_at?.toISOString() ?? new Date().toISOString(),
    lastActivityAt: c.updated_at?.toISOString() ?? c.created_at?.toISOString() ?? new Date().toISOString(),
  }))

  return NextResponse.json({ leads, total, page, limit })
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  let body: {
    email: string
    name?: string
    company?: string
    phone?: string
    city?: string
    sector?: string
    website?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { validateEmail } = await import('@/lib/scraper/email-validator')

  const validation = await validateEmail(body.email)
  const finalEmail = validation.fixedEmail ?? body.email.toLowerCase().trim()

  try {
    const [created] = await db
      .insert(contacts)
      .values({
        email: finalEmail,
        name: body.name ?? null,
        company: body.company ?? finalEmail.split('@')[1],
        phone: body.phone ?? null,
        city: body.city ?? null,
        sector: body.sector ?? null,
        website: body.website ?? null,
        email_confidence_score: validation.confidence,
        email_validated: validation.isValid,
        source: 'manual',
      })
      .returning()

    return NextResponse.json({ lead: created }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Insert failed'
    if (message.includes('unique')) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
