export type ProspectStatus = 'new' | 'contacted' | 'replied' | 'interested' | 'not_interested' | 'rdv_booked' | 'later'

export type ProspectSegment = 'with_site' | 'without_site' | 'active_ads' | 'passive'

export interface Prospect {
  id: string
  company: string
  contact?: string
  email: string
  phone?: string
  city: string
  department: string
  website?: string
  googleRating?: number
  googleReviews?: number
  specialty: string[]
  employees_estimate: '1-3' | '3-10' | '10-20'
  hasGoogleAds: boolean
  hasWebsite: boolean
  marketingMaturity: 'low' | 'medium' | 'high'
  segment: ProspectSegment
  status: ProspectStatus
  notes?: string
  createdAt: string
  lastContactedAt?: string
}

export interface GeneratedEmail {
  id: string
  prospectId: string
  subject: string
  body: string
  type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3'
  generatedAt: string
  sentAt?: string
  openedAt?: string
  repliedAt?: string
  status: 'draft' | 'sent' | 'opened' | 'replied'
}

export interface Campaign {
  id: string
  name: string
  niche: string
  targetZone: string
  status: 'draft' | 'active' | 'paused' | 'completed'
  prospectCount: number
  emailsSent: number
  openRate: number
  replyRate: number
  rdvCount: number
  createdAt: string
  startedAt?: string
}

export interface EmailReply {
  id: string
  prospectId: string
  emailId: string
  content: string
  classification: 'interested' | 'not_interested' | 'later' | 'info_request'
  suggestedResponse?: string
  receivedAt: string
  handledAt?: string
}

export interface DashboardStats {
  totalProspects: number
  totalEmailsSent: number
  avgOpenRate: number
  avgReplyRate: number
  totalRdv: number
  activeSequences: number
  emailsThisWeek: number
  rdvThisMonth: number
}
