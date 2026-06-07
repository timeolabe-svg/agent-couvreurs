import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import type {
  contacts,
  campaigns,
  email_queue,
  incoming_replies,
  reply_drafts,
  rdv,
  blocklist,
  learning_reports,
  agent_config,
  linkedin_leads,
  phone_leads,
  dashboard_events,
} from './db/schema'

// contacts
export type SelectContact = InferSelectModel<typeof contacts>
export type InsertContact = InferInsertModel<typeof contacts>

// campaigns
export type SelectCampaign = InferSelectModel<typeof campaigns>
export type InsertCampaign = InferInsertModel<typeof campaigns>

// email_queue
export type SelectEmailQueue = InferSelectModel<typeof email_queue>
export type InsertEmailQueue = InferInsertModel<typeof email_queue>

// incoming_replies
export type SelectIncomingReply = InferSelectModel<typeof incoming_replies>
export type InsertIncomingReply = InferInsertModel<typeof incoming_replies>

// reply_drafts
export type SelectReplyDraft = InferSelectModel<typeof reply_drafts>
export type InsertReplyDraft = InferInsertModel<typeof reply_drafts>

// rdv
export type SelectRdv = InferSelectModel<typeof rdv>
export type InsertRdv = InferInsertModel<typeof rdv>

// blocklist
export type SelectBlocklist = InferSelectModel<typeof blocklist>
export type InsertBlocklist = InferInsertModel<typeof blocklist>

// learning_reports
export type SelectLearningReport = InferSelectModel<typeof learning_reports>
export type InsertLearningReport = InferInsertModel<typeof learning_reports>

// agent_config
export type SelectAgentConfig = InferSelectModel<typeof agent_config>
export type InsertAgentConfig = InferInsertModel<typeof agent_config>

// linkedin_leads
export type SelectLinkedinLead = InferSelectModel<typeof linkedin_leads>
export type InsertLinkedinLead = InferInsertModel<typeof linkedin_leads>

// phone_leads
export type SelectPhoneLead = InferSelectModel<typeof phone_leads>
export type InsertPhoneLead = InferInsertModel<typeof phone_leads>

// dashboard_events
export type SelectDashboardEvent = InferSelectModel<typeof dashboard_events>
export type InsertDashboardEvent = InferInsertModel<typeof dashboard_events>
