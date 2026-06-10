// Client Instantly API v2 (Bearer token auth)
// Doc : https://developer.instantly.ai/api/v2
const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2'
const API_KEY = process.env.INSTANTLY_API_KEY

async function instantlyFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`Instantly API error: ${res.status} ${await res.text()}`)
  return res.json()
}

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
    return []
  }
  try {
    const data = await instantlyFetch(`/campaigns?limit=100`)
    const items: Array<Record<string, unknown>> = data.items ?? data ?? []
    return items.map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      status: String(c.status ?? ''),
      created_at: String(c.timestamp_created ?? ''),
    }))
  } catch (err) {
    console.error('[Instantly] getInstantlyCampaigns failed', err)
    return []
  }
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
    return { campaign_id: campaignId, sent: 0, opened: 0, replied: 0, bounced: 0 }
  }
  try {
    // V2 : GET /campaigns/analytics?id=<id>
    const data = await instantlyFetch(`/campaigns/analytics?id=${campaignId}`)
    const a = Array.isArray(data) ? data[0] : data
    return {
      campaign_id: campaignId,
      sent: Number(a?.emails_sent_count ?? a?.sent ?? 0),
      opened: Number(a?.open_count ?? a?.opened ?? 0),
      replied: Number(a?.reply_count ?? a?.replied ?? 0),
      bounced: Number(a?.bounced_count ?? a?.bounced ?? 0),
    }
  } catch (err) {
    console.error('[Instantly] getCampaignAnalytics failed', err)
    return { campaign_id: campaignId, sent: 0, opened: 0, replied: 0, bounced: 0 }
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

  // V2 : un lead par appel POST /leads
  let added = 0
  for (const lead of leads) {
    await instantlyFetch('/leads', {
      method: 'POST',
      body: JSON.stringify({
        campaign: campaignId,
        email: lead.email,
        first_name: lead.first_name,
        last_name: lead.last_name,
        company_name: lead.company_name,
        phone: lead.phone,
        website: lead.website,
        custom_variables: lead.custom_variables ?? {},
        // skip_if_in_campaign évite les doublons côté Instantly
        skip_if_in_workspace: false,
      }),
    })
    added++
  }
  return { added }
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
    return []
  }

  try {
    const limit = params?.limit ?? 50
    // V2 : GET /emails — email_type=received pour les réponses entrantes
    let path = `/emails?limit=${limit}&email_type=received`
    if (params?.campaign_id) path += `&campaign_id=${params.campaign_id}`

    const data = await instantlyFetch(path)
    const items: Array<Record<string, unknown>> = data.items ?? data ?? []
    if (!Array.isArray(items)) return []

    return items
      .map((e) => {
        const bodyObj = (e.body ?? {}) as Record<string, unknown>
        const body =
          typeof e.body === 'string'
            ? e.body
            : String(bodyObj.text ?? bodyObj.html ?? '')
        const toList = e.to_address_email_list ?? e.to_address ?? ''
        return {
          id: String(e.id ?? e.message_id ?? ''),
          from_address: String(e.from_address_email ?? e.from_address ?? ''),
          to_address: Array.isArray(toList) ? String(toList[0] ?? '') : String(toList),
          subject: String(e.subject ?? ''),
          body,
          timestamp: String(e.timestamp_email ?? e.timestamp_created ?? new Date().toISOString()),
          campaign_id: String(e.campaign_id ?? e.campaign ?? ''),
          lead_email: String(e.from_address_email ?? e.from_address ?? ''),
        }
      })
      .filter((e) => e.id && e.from_address)
  } catch (err) {
    console.error('[Instantly] getInstantlyReplies failed — returning []', err)
    return []
  }
}

// ─── Mark as read ───────────────────────────────────────────────────────────

export async function markReplyProcessed(replyId: string): Promise<void> {
  if (!API_KEY) {
    warnNoKey('markReplyProcessed')
    return
  }
  // V2 : pas d'action critique nécessaire (la dédup est gérée en DB).
  // On évite un appel risqué ; no-op volontaire.
  void replyId
}

// ─── Send reply ───────────────────────────────────────────────────────────────

export async function sendReply(params: {
  reply_to_id: string
  body: string
  subject?: string
  eaccount?: string
}): Promise<void> {
  if (!API_KEY) {
    warnNoKey('sendReply')
    console.log('[MOCK] Would send reply to', params.reply_to_id)
    return
  }
  // V2 : POST /emails/reply
  await instantlyFetch('/emails/reply', {
    method: 'POST',
    body: JSON.stringify({
      reply_to_uuid: params.reply_to_id,
      ...(params.eaccount ? { eaccount: params.eaccount } : {}),
      ...(params.subject ? { subject: params.subject } : {}),
      body: { text: params.body },
    }),
  })
}

// ─── Update campaign daily limit ─────────────────────────────────────────────

export async function updateCampaignDailyLimit(campaignId: string, dailyLimit: number): Promise<void> {
  if (!API_KEY) {
    warnNoKey('updateCampaignDailyLimit')
    return
  }
  try {
    // V2 : PATCH /campaigns/{id} — daily_limit dans campaign settings
    await instantlyFetch(`/campaigns/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify({ daily_limit: dailyLimit }),
    })
    console.log(`[Instantly] Daily limit updated → ${dailyLimit} for campaign ${campaignId}`)
  } catch (err) {
    console.warn('[Instantly] updateCampaignDailyLimit failed (non-blocking):', err)
  }
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

export interface InstantlyAccount {
  email: string
  name?: string
  daily_limit: number
  emails_sent_today: number
  warmup_enabled: boolean
}

export async function getInstantlyAccounts(): Promise<InstantlyAccount[]> {
  if (!API_KEY) {
    warnNoKey('getInstantlyAccounts')
    return []
  }
  try {
    const data = await instantlyFetch(`/accounts?limit=100`)
    const items: Array<Record<string, unknown>> = data.items ?? data ?? []
    return items.map((a) => ({
      email: String(a.email ?? ''),
      name: a.first_name ? `${a.first_name} ${a.last_name ?? ''}`.trim() : undefined,
      daily_limit: Number(a.daily_limit ?? 0),
      emails_sent_today: 0,
      warmup_enabled: Number(a.warmup_status ?? 0) === 1,
    }))
  } catch (err) {
    console.error('[Instantly] getInstantlyAccounts failed', err)
    return []
  }
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
    return []
  }
  try {
    const data = await instantlyFetch(`/accounts?limit=100`)
    const items: Array<Record<string, unknown>> = data.items ?? data ?? []
    return items.map((a) => ({
      email: String(a.email ?? ''),
      warmup_enabled: Number(a.warmup_status ?? 0) === 1,
      health_score: Number(a.stat_warmup_score ?? a.warmup_score ?? 0),
      emails_sent_today: 0,
      daily_limit: Number(a.daily_limit ?? 0),
    }))
  } catch (err) {
    console.error('[Instantly] getWarmupStats failed', err)
    return []
  }
}
