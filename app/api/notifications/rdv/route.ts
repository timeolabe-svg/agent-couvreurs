import { NextRequest, NextResponse } from 'next/server'

const CLIENT_NOTIFY_EMAIL = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr')
  .split(',').map(s => s.trim()).filter(Boolean)
const RESEND_API_KEY = process.env.RESEND_API_KEY
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://hdigiweb.fr'

export async function POST(request: NextRequest) {
  const body = await request.json() as { rdvId: string }

  if (!body.rdvId) {
    return NextResponse.json({ error: 'rdvId required' }, { status: 400 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { rdv, contacts, incoming_replies } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const rows = await db
    .select({ rdv, contact: contacts, reply: incoming_replies })
    .from(rdv)
    .leftJoin(contacts, eq(contacts.id, rdv.contact_id))
    .leftJoin(incoming_replies, eq(incoming_replies.id, rdv.incoming_reply_id))
    .where(eq(rdv.id, body.rdvId))
    .limit(1)

  if (!rows[0]) {
    return NextResponse.json({ error: 'RDV not found' }, { status: 404 })
  }

  const { rdv: rdvData, contact, reply } = rows[0]

  if (!RESEND_API_KEY) {
    console.warn('[notifications/rdv] RESEND_API_KEY not set — skipping email')
    return NextResponse.json({ sent: false, reason: 'RESEND_API_KEY not set' })
  }

  const scheduledAt = rdvData.scheduled_at
  const dateStr = scheduledAt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeStr = scheduledAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  const html = buildRdvConfirmationEmail({
    contact: {
      name: contact?.name ?? null,
      company: contact?.company ?? 'Contact inconnu',
      city: contact?.city ?? null,
      phone: contact?.phone ?? null,
      email: contact?.email ?? '',
    },
    dateStr,
    timeStr,
    durationMin: rdvData.duration_min ?? 30,
    calendarEventUrl: rdvData.google_event_id
      ? `https://calendar.google.com/calendar/event?eid=${rdvData.google_event_id}`
      : null,
    meetLink: rdvData.google_meet_link,
    replyContext: reply?.body ?? null,
    notes: rdvData.notes,
    baseUrl: BASE_URL,
  })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'agent@hdigiweb.fr',
      to: CLIENT_NOTIFY_EMAIL,
      subject: `🎯 Nouveau RDV confirmé — ${contact?.company ?? 'Contact'}`,
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[notifications/rdv] Resend error:', text)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  return NextResponse.json({ sent: true })
}

function buildRdvConfirmationEmail(params: {
  contact: { name: string | null; company: string; city: string | null; phone: string | null; email: string }
  dateStr: string
  timeStr: string
  durationMin: number
  calendarEventUrl: string | null
  meetLink: string | null
  replyContext: string | null
  notes: string | null
  baseUrl: string
}) {
  const { contact, dateStr, timeStr, durationMin, calendarEventUrl, meetLink, replyContext, notes, baseUrl } = params

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Nouveau RDV</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e1e4e8;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:12px 12px 0 0;padding:24px 28px">
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff">🎯 Nouveau RDV confirmé !</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#bbf7d0">L'agent IA a détecté et confirmé un rendez-vous</p>
    </div>

    <!-- Body -->
    <div style="background:#1a1d27;border-radius:0 0 12px 12px;padding:24px 28px">

      <!-- Contact card -->
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 10px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;font-weight:600">CONTACT</p>
        <p style="margin:0 0 3px;font-size:16px;font-weight:700;color:#e1e4e8">${contact.name ?? contact.email}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#8b949e">${contact.company}${contact.city ? ` — ${contact.city}` : ''}</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${contact.phone ? `<span style="font-size:13px;color:#e1e4e8">📞 <a href="tel:${contact.phone}" style="color:#5c9b82;text-decoration:none">${contact.phone}</a></span>` : ''}
          <span style="font-size:13px;color:#e1e4e8">✉️ <a href="mailto:${contact.email}" style="color:#5c9b82;text-decoration:none">${contact.email}</a></span>
        </div>
      </div>

      <!-- RDV details -->
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 10px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;font-weight:600">RDV</p>
        <p style="margin:0 0 4px;font-size:14px;color:#e1e4e8">📅 ${dateStr} à ${timeStr}</p>
        <p style="margin:0 0 12px;font-size:13px;color:#8b949e">Durée estimée : ${durationMin} minutes</p>
        ${calendarEventUrl ? `<a href="${calendarEventUrl}" style="display:inline-block;margin-right:12px;font-size:13px;color:#5c9b82;text-decoration:none">📆 Voir dans Google Calendar →</a>` : ''}
        ${meetLink ? `<a href="${meetLink}" style="display:inline-block;font-size:13px;color:#5f83ac;text-decoration:none">📹 Rejoindre Google Meet →</a>` : ''}
      </div>

      ${replyContext ? `
      <!-- Conversation context -->
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 10px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;font-weight:600">MESSAGE QUI A DÉCLENCHÉ LE RDV</p>
        <blockquote style="margin:0;padding:10px 14px;border-left:3px solid #5c9b82;background:#0d1117;border-radius:0 4px 4px 0;font-size:13px;color:#c9d1d9;font-style:italic;line-height:1.5">${replyContext.replace(/\n/g, '<br>').substring(0, 500)}${replyContext.length > 500 ? '…' : ''}</blockquote>
      </div>` : ''}

      ${notes ? `
      <!-- Notes -->
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:16px">
        <p style="margin:0 0 6px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;font-weight:600">NOTES</p>
        <p style="margin:0;font-size:13px;color:#e1e4e8">${notes}</p>
      </div>` : ''}

      <!-- CTA -->
      <a href="${baseUrl}" style="display:inline-block;background:#5c9b82;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.01em">Voir dans le dashboard →</a>
    </div>

    <p style="margin:16px 0 0;font-size:11px;color:#484f58;text-align:center">Hdigiweb · Agent IA Couvreurs · ${BASE_URL}</p>
  </div>
</body>
</html>`
}
