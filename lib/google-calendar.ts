const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

let cachedToken: string | null = null
let tokenExpiry = 0

/** Refresh token : lu D'ABORD en base (agent_config, mis à jour par la reconnexion),
 *  sinon repli sur l'env. Ainsi le bouton "Reconnecter" suffit, sans toucher à Vercel. */
export async function getRefreshToken(): Promise<string> {
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const [row] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, 'google_refresh_token')).limit(1)
    if (row?.value) return row.value
  } catch { /* base indispo → env */ }
  return process.env.GOOGLE_REFRESH_TOKEN ?? ''
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const refreshToken = await getRefreshToken()
  if (!refreshToken) throw new Error('[google-calendar] Aucun refresh token (reconnecte Google Calendar)')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[google-calendar] Token refresh failed: ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

export interface CreateCalendarEventParams {
  summary: string
  description: string
  startTime: string
  endTime: string
  attendeeEmail?: string
  meetLink?: boolean
}

export interface CalendarEventResult {
  eventId: string
  eventUrl: string
  meetLink: string | null
}

export async function createCalendarEvent(
  params: CreateCalendarEventParams
): Promise<CalendarEventResult> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[google-calendar] Missing env vars — returning mock event')
    return {
      eventId: `mock_${Date.now()}`,
      eventUrl: 'https://calendar.google.com',
      meetLink: params.meetLink ? 'https://meet.google.com/mock-link' : null,
    }
  }

  const token = await getAccessToken()

  const body: Record<string, unknown> = {
    summary: params.summary,
    description: params.description,
    start: { dateTime: params.startTime, timeZone: 'Europe/Paris' },
    end: { dateTime: params.endTime, timeZone: 'Europe/Paris' },
  }

  if (params.attendeeEmail) {
    body.attendees = [{ email: params.attendeeEmail }]
  }

  if (params.meetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: `hdigiweb_${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    }
  }

  const url = new URL(`${CALENDAR_API_BASE}/calendars/primary/events`)
  if (params.meetLink) url.searchParams.set('conferenceDataVersion', '1')

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[google-calendar] Create event failed: ${text}`)
  }

  const data = (await res.json()) as {
    id: string
    htmlLink: string
    conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> }
  }

  const meet =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null

  return {
    eventId: data.id,
    eventUrl: data.htmlLink,
    meetLink: meet,
  }
}

export interface UpcomingEvent {
  id: string
  summary: string
  start: string
  end: string
  description: string
  meetLink: string | null
  status: string
}

export async function getUpcomingEvents(days = 30): Promise<UpcomingEvent[]> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[google-calendar] Missing env vars — returning empty list')
    return []
  }

  const token = await getAccessToken()
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const url = new URL(`${CALENDAR_API_BASE}/calendars/primary/events`)
  url.searchParams.set('timeMin', timeMin)
  url.searchParams.set('timeMax', timeMax)
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '50')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[google-calendar] List events failed: ${text}`)
  }

  const data = (await res.json()) as {
    items: Array<{
      id: string
      summary?: string
      start: { dateTime?: string; date?: string }
      end: { dateTime?: string; date?: string }
      description?: string
      conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> }
      status: string
    }>
  }

  return (data.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? '',
    start: item.start.dateTime ?? item.start.date ?? '',
    end: item.end.dateTime ?? item.end.date ?? '',
    description: item.description ?? '',
    meetLink:
      item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null,
    status: item.status,
  }))
}

export async function cancelCalendarEvent(eventId: string): Promise<void> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[google-calendar] Missing env vars — skipping cancel')
    return
  }

  const token = await getAccessToken()

  const res = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events/${eventId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[google-calendar] Cancel event failed: ${text}`)
  }
}
