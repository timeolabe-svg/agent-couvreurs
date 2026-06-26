export type LeadStage =
  | 'prospected'
  | 'contacted'
  | 'follow_up_1'
  | 'follow_up_2'
  | 'replied'
  | 'rdv_booked'
  | 'not_interested'

export type MessageAuthor = 'agent' | 'lead'

export interface EmailMessage {
  id: string
  author: MessageAuthor
  subject?: string
  body: string
  sentAt: string
  openedAt?: string
  isAiGenerated?: boolean
  sequenceStep?: 'initial' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3' | 'reply'
}

export interface Lead {
  id: string
  company: string
  contact: string
  firstName: string
  email: string
  phone?: string
  city: string
  website?: string
  googleRating?: number
  googleReviews?: number
  specialty: string[]
  hasGoogleAds: boolean
  hasWebsite: boolean
  auditScore?: number
  auditLevel?: string
  auditWeaknesses?: string[]
  auditCms?: string
  stage: LeadStage
  thread: EmailMessage[]
  rdvDate?: string
  rdvConfirmedAt?: string
  createdAt: string
  lastActivityAt: string
  nextScheduledAt?: string
  notes?: string
}

export interface RdvEvent {
  id: string
  leadId: string
  company: string
  contact: string
  date: string
  time: string
  duration: number
  detectedFrom: string
  confirmedByAgent: boolean
  clientNotified: boolean
  phone?: string
}

export interface AgentConfig {
  persona: string
  objective: string
  tone: string
  maxEmailsPerDay: number
  warmupEnabled: boolean
  autoReplyEnabled: boolean
  autoRdvEnabled: boolean
  clientNotifEmail: string
}
