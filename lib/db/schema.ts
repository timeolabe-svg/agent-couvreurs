import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

// contacts — prospects scraped or imported
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  name: text('name'),
  company: text('company').notNull(),
  website: text('website'),
  phone: text('phone'),
  sector: text('sector'), // 'couvreur', 'plombier', etc.
  city: text('city'),
  postal_code: text('postal_code'),
  google_place_id: text('google_place_id').unique(),
  google_rating: real('google_rating'),
  google_reviews_count: integer('google_reviews_count'),
  description: text('description'), // AI-generated business description
  director_name: text('director_name'),
  email_confidence_score: integer('email_confidence_score'), // 0-100
  email_validated: boolean('email_validated').default(false),
  source: text('source'), // 'google_places', 'csv_import', 'manual'
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  sectorIdx: index('contacts_sector_idx').on(table.sector),
  cityIdx: index('contacts_city_idx').on(table.city),
}))

// campaigns
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sector: text('sector').notNull(),
  cities: text('cities').array(),
  status: text('status').default('draft'), // draft/active/paused/done
  allocation_pct: integer('allocation_pct').default(10),
  sequence_delay_days: integer('sequence_delay_days').array().default([0, 3, 7, 14]),
  created_at: timestamp('created_at').defaultNow(),
})

// email_queue — all emails (sent + pending)
export const email_queue = pgTable('email_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  contact_id: uuid('contact_id').references(() => contacts.id),
  campaign_id: uuid('campaign_id').references(() => campaigns.id),
  sequence_step: integer('sequence_step').default(0), // 0=initial, 1=follow1, 2=follow2, 3=follow3
  from_email: text('from_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').default('pending'), // pending/sent/bounced/failed/opened/replied
  scheduled_at: timestamp('scheduled_at'),
  sent_at: timestamp('sent_at'),
  opened_at: timestamp('opened_at'),
  replied_at: timestamp('replied_at'),
  instantly_email_id: text('instantly_email_id'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  statusScheduledIdx: index('eq_status_scheduled_idx').on(table.status, table.scheduled_at),
  campaignIdx: index('eq_campaign_idx').on(table.campaign_id),
  contactIdx: index('eq_contact_idx').on(table.contact_id),
}))

// incoming_replies — replies received from prospects
export const incoming_replies = pgTable('incoming_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  contact_id: uuid('contact_id').references(() => contacts.id),
  email_queue_id: uuid('email_queue_id').references(() => email_queue.id),
  from_email: text('from_email').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  classification: text('classification'), // desinterest/objection/question/interest/rdv_request/oof/spam/other
  action_taken: text('action_taken'), // auto_reply/draft_for_validation/no_action/blocklisted
  instantly_reply_id: text('instantly_reply_id'), // Instantly's own reply UUID (needed for sendReply)
  processed_at: timestamp('processed_at'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  fromEmailCreatedIdx: index('ir_from_email_created_idx').on(table.from_email, table.created_at),
  contactIdx: index('ir_contact_idx').on(table.contact_id),
}))

// reply_drafts — AI-generated drafts waiting for human validation
export const reply_drafts = pgTable('reply_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  incoming_reply_id: uuid('incoming_reply_id').references(() => incoming_replies.id),
  body: text('body').notNull(),
  status: text('status').default('pending'), // pending/sent/rejected/modified
  sent_at: timestamp('sent_at'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  statusIdx: index('rd_status_idx').on(table.status),
  incomingReplyIdx: index('rd_incoming_reply_idx').on(table.incoming_reply_id),
}))

// rdv — appointments
export const rdv = pgTable('rdv', {
  id: uuid('id').primaryKey().defaultRandom(),
  contact_id: uuid('contact_id').references(() => contacts.id),
  incoming_reply_id: uuid('incoming_reply_id').references(() => incoming_replies.id),
  scheduled_at: timestamp('scheduled_at').notNull(),
  duration_min: integer('duration_min').default(30),
  status: text('status').default('confirmed'), // confirmed/cancelled/rescheduled/signed
  google_event_id: text('google_event_id'),
  google_meet_link: text('google_meet_link'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow(),
})

// blocklist
export const blocklist = pgTable('blocklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email'),
  domain: text('domain'),
  reason: text('reason'), // unsubscribe/bounce/desinterest/manual
  created_at: timestamp('created_at').defaultNow(),
})

// learning_reports — weekly AI self-improvement reports
export const learning_reports = pgTable('learning_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  period_start: timestamp('period_start').notNull(),
  period_end: timestamp('period_end').notNull(),
  emails_sent: integer('emails_sent'),
  reply_rate: real('reply_rate'),
  rdv_count: integer('rdv_count'),
  top_sectors: text('top_sectors').array(),
  top_subject_patterns: text('top_subject_patterns').array(),
  recommendations: jsonb('recommendations'), // {prompt_adjustments, timing, sectors, ...}
  applied: boolean('applied').default(false),
  created_at: timestamp('created_at').defaultNow(),
})

// agent_config — dynamic agent configuration (self-improving)
export const agent_config = pgTable('agent_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  value: text('value').notNull(),
  updated_by: text('updated_by').default('manual'), // 'manual' or 'auto_learning'
  updated_at: timestamp('updated_at').defaultNow(),
})

// linkedin_leads
export const linkedin_leads = pgTable('linkedin_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  first_name: text('first_name'),
  last_name: text('last_name'),
  company: text('company'),
  profile_url: text('profile_url'),
  campaign_id: uuid('campaign_id').references(() => campaigns.id),
  status: text('status').default('pending'), // pending/invited/connected/messaged/replied/rdv
  message_sent: text('message_sent'),
  created_at: timestamp('created_at').defaultNow(),
})

// phone_leads
export const phone_leads = pgTable('phone_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  google_place_id: text('google_place_id').unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  rating: real('rating'),
  reviews_count: integer('reviews_count'),
  website: text('website'),
  ai_pitch: text('ai_pitch'), // AI-generated phone pitch suggestion
  status: text('status').default('pending'), // pending/called/interested/callback/refused/rdv
  notes: text('notes'),
  called_at: timestamp('called_at'),
  created_at: timestamp('created_at').defaultNow(),
})

// dashboard_events — realtime event stream for SSE
export const dashboard_events = pgTable('dashboard_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // 'email_sent', 'reply_received', 'rdv_created', 'agent_decision'
  data: jsonb('data').notNull(),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  createdAtIdx: index('de_created_at_idx').on(table.created_at),
}))
