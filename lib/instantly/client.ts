const INSTANTLY_BASE = 'https://api.instantly.ai/api/v1'
const API_KEY = process.env.INSTANTLY_API_KEY

async function instantlyFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`Instantly API error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── Mock data fallback ───────────────────────────────────────────────────────

function warnNoKey(fn: string) {
  console.warn(`[Instantly] INSTANTLY_API_KEY not set — returning mock data for ${fn}`)
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string
  name: string
  status: string
  created_at: string
}

export async function getInstantlyCampaigns(): Promise<InstantlyCampaign[]> {
  if (!API_KEY) {
    warnNoKey('getInstantlyCampaigns')
    return [
      { id: 'mock-campaign-1', name: '[MOCK] Couvreurs Toulouse', status: 'active', created_at: new Date().toISOString() },
      { id: 'mock-campaign-2', name: '[MOCK] Couvreurs Montpellier', status: 'paused', created_at: new Date().toISOString() },
    ]
  }
  const data = await instantlyFetch(`/campaigns?api_key=${API_KEY}`)
  return data.data ?? data ?? []
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface CampaignAnalytics {
  campaign_id: string
  sent: number
  opened: number
  replied: number
  bounced: number
}

export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  if (!API_KEY) {
    warnNoKey('getCampaignAnalytics')
    return { campaign_id: campaignId, sent: 42, opened: 18, replied: 5, bounced: 2 }
  }
  const data = await instantlyFetch(`/analytics/campaign/summary?api_key=${API_KEY}&id=${campaignId}`)
  return {
    campaign_id: campaignId,
    sent: data.total_leads_contacted ?? 0,
    opened: data.total_opened ?? 0,
    replied: data.total_replied ?? 0,
    bounced: data.total_bounced ?? 0,
  }
}

// ─── Add leads ────────────────────────────────────────────────────────────────

export interface InstantlyLead {
  email: string
  first_name?: string
  last_name?: string
  company_name?: string
  phone?: string
  website?: string
  custom_variables?: Record<string, string>
}

export async function addLeadsToCampaign(
  campaignId: string,
  leads: InstantlyLead[]
): Promise<{ added: number }> {
  if (!API_KEY) {
    warnNoKey('addLeadsToCampaign')
    console.log(`[MOCK] Would add ${leads.length} leads to campaign ${campaignId}`)
    return { added: leads.length }
  }
  const data = await instantlyFetch('/lead/add', {
    method: 'POST',
    body: JSON.stringify({ api_key: API_KEY, campaign_id: campaignId, leads }),
  })
  return { added: data.leads_added ?? leads.length }
}

// ─── Replies ──────────────────────────────────────────────────────────────────

export interface InstantlyReply {
  id: string
  from_address: string
  to_address: string
  subject: string
  body: string
  timestamp: string
  campaign_id: string
  lead_email: string
}

export async function getInstantlyReplies(params?: {
  limit?: number
  skip?: number
  campaign_id?: string
}): Promise<InstantlyReply[]> {
  if (!API_KEY) {
    warnNoKey('getInstantlyReplies')
    return [
      {
        id: 'mock-reply-1',
        from_address: 'couvreur.martin@example.fr',
        to_address: 'thomas@hdigiweb.fr',
        subject: 'Re: Visibilité Google',
        body: 'Bonjour, je suis intéressé, pouvez-vous m\'envoyer plus d\'infos ?',
        timestamp: new Date().toISOString(),
        campaign_id: 'mock-campaign-1',
        lead_email: 'couvreur.martin@example.fr',
      },
    ]
  }

  const limit = params?.limit ?? 50
  const skip = params?.skip ?? 0
  let url = `/emails/list?api_key=${API_KEY}&limit=${limit}&skip=${skip}`
  if (params?.campaign_id) url += `&campaign_id=${params.campaign_id}`

  const data = await instantlyFetch(url)
  const emails: Array<Record<string, unknown>> = data.data ?? data ?? []

  // Filter to replies only (type === 'reply' or subject starts with Re:)
  return emails
    .filter((e) => e.type === 'reply' || String(e.subject ?? '').toLowerCase().startsWith('re:'))
    .map((e) => ({
      id: String(e.id ?? ''),
      from_address: String(e.from_address ?? e.from ?? ''),
      to_address: String(e.to_address ?? e.to ?? ''),
      subject: String(e.subject ?? ''),
      body: String(e.body ?? e.text ?? ''),
      timestamp: String(e.timestamp ?? e.created_at ?? new Date().toISOString()),
      campaign_id: String(e.campaign_id ?? ''),
      lead_email: String(e.from_address ?? e.from ?? ''),
    }))
}

// ─── Mark as processed ────────────────────────────────────────────────────────

export async function markReplyProcessed(replyId: string): Promise<void> {
  if (!API_KEY) {
    warnNoKey('markReplyProcessed')
    return
  }
  await instantlyFetch(`/emails/${replyId}/mark-read`, {
    method: 'POST',
    body: JSON.stringify({ api_key: API_KEY }),
  })
}

// ─── Send reply ───────────────────────────────────────────────────────────────

export async function sendReply(params: {
  reply_to_id: string
  body: string
  subject?: string
}): Promise<void> {
  if (!API_KEY) {
    warnNoKey('sendReply')
    console.log('[MOCK] Would send reply to', params.reply_to_id)
    return
  }
  await instantlyFetch('/emails/reply', {
    method: 'POST',
    body: JSON.stringify({
      api_key: API_KEY,
      reply_to_uuid: params.reply_to_id,
      body: params.body,
      ...(params.subject ? { subject: params.subject } : {}),
    }),
  })
}

// ─── Warmup stats ─────────────────────────────────────────────────────────────

export interface WarmupStat {
  email: string
  warmup_enabled: boolean
  health_score: number
  emails_sent_today: number
  daily_limit: number
}

export async function getWarmupStats(): Promise<WarmupStat[]> {
  if (!API_KEY) {
    warnNoKey('getWarmupStats')
    return [
      { email: 'thomas@hdigiweb.fr', warmup_enabled: true, health_score: 92, emails_sent_today: 47, daily_limit: 334 },
    ]
  }
  const data = await instantlyFetch(`/accounts?api_key=${API_KEY}`)
  const accounts: Array<Record<string, unknown>> = data.data ?? data ?? []
  return accounts.map((a) => ({
    email: String(a.email ?? ''),
    warmup_enabled: Boolean(a.warmup_enabled ?? a.is_warmup_enabled ?? false),
    health_score: Number(a.health_score ?? 0),
    emails_sent_today: Number(a.emails_sent_today ?? 0),
    daily_limit: Number(a.daily_limit ?? 334),
  }))
}
