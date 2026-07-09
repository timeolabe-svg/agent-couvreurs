import { NextRequest, NextResponse } from 'next/server'

const CLIENT_NOTIFY_EMAIL = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr')
  .split(',').map(s => s.trim()).filter(Boolean)
const RESEND_API_KEY = process.env.RESEND_API_KEY
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'

// Mock data for when there's no DB
const MOCK_RDVS = [
  {
    id: 'rdv1',
    contact_id: 'c1',
    incoming_reply_id: null,
    scheduled_at: new Date('2026-05-04T14:30:00').toISOString(),
    duration_min: 30,
    status: 'confirmed',
    google_event_id: null,
    google_meet_link: null,
    notes: 'RDV de démonstration',
    created_at: new Date().toISOString(),
    contact: {
      id: 'c1',
      name: 'Laurent Carpentier',
      company: 'Toiture Carpentier',
      email: 'l.carpentier@gmail.com',
      phone: '06 74 23 11 89',
      city: 'Toulouse',
    },
  },
  {
    id: 'rdv2',
    contact_id: 'c2',
    incoming_reply_id: null,
    scheduled_at: new Date('2026-05-06T10:00:00').toISOString(),
    duration_min: 30,
    status: 'confirmed',
    google_event_id: null,
    google_meet_link: null,
    notes: null,
    created_at: new Date().toISOString(),
    contact: {
      id: 'c2',
      name: 'Sébastien Vidal',
      company: 'Toitures Vidal & Fils',
      email: 'contact@toitures-vidal.fr',
      phone: '05 61 42 87 03',
      city: 'Tournefeuille',
    },
  },
]

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ rdvs: MOCK_RDVS, _demo: true })
  }

  const { db } = await import('@/lib/db')
  const { rdv, contacts } = await import('@/lib/db/schema')
  const { eq, and, gte, lte } = await import('drizzle-orm')

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const conditions = []
  if (status) conditions.push(eq(rdv.status, status))
  if (from) conditions.push(gte(rdv.scheduled_at, new Date(from)))
  if (to) conditions.push(lte(rdv.scheduled_at, new Date(to)))

  const rows = await db
    .select({ rdv, contact: contacts })
    .from(rdv)
    .leftJoin(contacts, eq(contacts.id, rdv.contact_id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(rdv.scheduled_at)

  const rdvs = rows.map(({ rdv: r, contact: c }) => ({
    ...r,
    scheduled_at: r.scheduled_at.toISOString(),
    created_at: r.created_at?.toISOString() ?? null,
    contact: c
      ? {
          id: c.id,
          name: c.name,
          company: c.company,
          email: c.email,
          phone: c.phone,
          city: c.city,
        }
      : null,
  }))

  return NextResponse.json({ rdvs })
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    contactId: string
    scheduledAt: string
    durationMin?: number
    notes?: string
    meetLink?: boolean
  }

  if (!body.contactId || !body.scheduledAt) {
    return NextResponse.json({ error: 'contactId and scheduledAt required' }, { status: 400 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { rdv, contacts, dashboard_events } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const { createCalendarEvent } = await import('@/lib/google-calendar')

  // Fetch contact
  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, body.contactId))
    .limit(1)

  const contact = contactRows[0]
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const startTime = new Date(body.scheduledAt)
  const durationMin = body.durationMin ?? 30
  const endTime = new Date(startTime.getTime() + durationMin * 60 * 1000)

  // Create Google Calendar event
  let googleEventId: string | null = null
  let googleMeetLink: string | null = null
  let calendarEventUrl: string | null = null

  try {
    const event = await createCalendarEvent({
      summary: `RDV - ${contact.company} (${contact.city ?? ''})`,
      description: `Contact: ${contact.name ?? contact.email}\nEntreprise: ${contact.company}\nTéléphone: ${contact.phone ?? 'N/A'}\nEmail: ${contact.email}\n\n${body.notes ?? ''}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      attendeeEmail: contact.email,
      meetLink: body.meetLink ?? true,
    })
    googleEventId = event.eventId
    googleMeetLink = event.meetLink
    calendarEventUrl = event.eventUrl
  } catch (err) {
    console.error('[api/rdv] Google Calendar error:', err)
  }

  // Insert RDV
  const [inserted] = await db
    .insert(rdv)
    .values({
      contact_id: body.contactId,
      scheduled_at: startTime,
      duration_min: durationMin,
      status: 'confirmed',
      google_event_id: googleEventId,
      google_meet_link: googleMeetLink,
      notes: body.notes,
    })
    .returning()

  // Dashboard event
  await db.insert(dashboard_events).values({
    type: 'rdv_created',
    data: {
      rdvId: inserted.id,
      contactEmail: contact.email,
      company: contact.company,
      scheduledAt: startTime.toISOString(),
      manual: true,
    },
  })

  // Auto-charge 50€ if customer has a saved payment method
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const { stripe } = await import('@/lib/stripe')
      const { agent_config } = await import('@/lib/db/schema')

      const [customerRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_customer_id'))
      const [pmRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_payment_method_id'))

      if (customerRow?.value && pmRow?.value) {
        await stripe.paymentIntents.create({
          amount: 5000, // 50€ in cents
          currency: 'eur',
          customer: customerRow.value,
          payment_method: pmRow.value,
          confirm: true,
          off_session: true,
          description: `RDV Hdigiweb — ${contact.company} — ${startTime.toLocaleDateString('fr-FR')}`,
          metadata: { rdv_id: inserted.id, contact_company: contact.company },
        })
        console.log('[api/rdv] Stripe charge 50€ OK for', contact.company)
      }
    } catch (stripeErr) {
      console.error('[api/rdv] Stripe charge failed:', stripeErr)
      // Don't block RDV creation on payment failure
    }
  }

  // Notification email
  if (RESEND_API_KEY) {
    const dateStr = startTime.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const timeStr = startTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        // RESEND_FROM_EMAIL must be set to a verified Resend domain
        // e.g. agent@hdigiweb.fr (requires DNS verification in resend.com)
        // Falls back to onboarding@resend.dev for testing
        from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
        to: CLIENT_NOTIFY_EMAIL,
        subject: `🎯 Nouveau RDV — ${contact.company}`,
        html: buildRdvEmailHtml({
          contact,
          dateStr,
          timeStr,
          durationMin,
          calendarEventUrl,
          meetLink: googleMeetLink,
          notes: body.notes,
          baseUrl: BASE_URL,
        }),
      }),
    })
  }

  return NextResponse.json({
    rdv: {
      ...inserted,
      scheduled_at: inserted.scheduled_at.toISOString(),
      created_at: inserted.created_at?.toISOString() ?? null,
    },
    calendarEventUrl,
  })
}

function buildRdvEmailHtml(params: {
  contact: { name: string | null; company: string; city: string | null; phone: string | null; email: string }
  dateStr: string
  timeStr: string
  durationMin: number
  calendarEventUrl: string | null
  meetLink: string | null
  notes?: string
  baseUrl: string
}) {
  const { contact, dateStr, timeStr, durationMin, calendarEventUrl, meetLink, notes, baseUrl } = params
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto">
    <div style="background:#16a34a;border-radius:8px 8px 0 0;padding:20px 24px">
      <h1 style="margin:0;font-size:18px;color:#fff">🎯 Nouveau RDV confirmé !</h1>
    </div>
    <div style="background:#1a1d27;border-radius:0 0 8px 8px;padding:24px">
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">CONTACT</p>
        <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#e1e4e8">${contact.name ?? contact.email}</p>
        <p style="margin:0 0 2px;font-size:13px;color:#8b949e">${contact.company} — ${contact.city ?? ''}</p>
        ${contact.phone ? `<p style="margin:4px 0 0;font-size:13px;color:#e1e4e8">📞 ${contact.phone}</p>` : ''}
        <p style="margin:4px 0 0;font-size:13px;color:#e1e4e8">✉️ ${contact.email}</p>
      </div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">RDV</p>
        <p style="margin:0 0 2px;font-size:14px;color:#e1e4e8">📅 ${dateStr} à ${timeStr}</p>
        <p style="margin:0;font-size:13px;color:#8b949e">Durée : ${durationMin} min</p>
        ${calendarEventUrl ? `<p style="margin:8px 0 0"><a href="${calendarEventUrl}" style="color:#10b981;font-size:13px">Voir dans Google Calendar →</a></p>` : ''}
        ${meetLink ? `<p style="margin:4px 0 0"><a href="${meetLink}" style="color:#3b82f6;font-size:13px">Rejoindre Google Meet →</a></p>` : ''}
      </div>
      ${notes ? `<div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:16px"><p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">NOTES</p><p style="margin:0;font-size:13px;color:#e1e4e8">${notes}</p></div>` : ''}
      <a href="${baseUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">Voir dans le dashboard →</a>
    </div>
  </div>
</body>
</html>`
}
