import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  date,
} from 'drizzle-orm/pg-core'

// contacts — prospects scraped or imported
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ⚠️ NOT NULL retiré le 03/09/2026 (canal LinkedIn) : un dirigeant trouvé via SIRENE peut
  // n'avoir aucun email exploitable. Audit préalable fait sur les 12 fichiers touchant
  // contacts.email dans app/api/cron : aucun ne lit .email sans garde sur un contact qui
  // pourrait être LinkedIn-only — les sélections larges (validate-emails, autopilot-tick)
  // sont toutes ancrées par un innerJoin sur email_queue, où un contact LinkedIn-only n'a
  // jamais de ligne. audit-sites ne touche jamais .email.
  //
  // ⚠️ CONTRAINTE CHECK (email OU linkedin_url) POSÉE PUIS RETIRÉE LE MÊME JOUR : elle cassait
  // le flux légitime de promotion SIRENE → LinkedIn, qui crée le contact AVANT que le bot ait
  // résolu son profile_url (la recherche se fait lors de l'invitation, pas à la promotion). Un
  // contact « en cours de résolution LinkedIn » n'a alors NI email NI linkedin_url, mais IL a
  // une ligne linkedin_leads qui le référence — la garantie « joignable d'une manière ou d'une
  // autre » ne peut donc pas se vérifier sur cette seule ligne, elle doit croiser une autre
  // table. Reportée sur un invariant mesuré (famille linkedin) plutôt qu'une contrainte
  // synchrone qui bloque un flux en plusieurs étapes.
  email: text('email').unique(),
  linkedin_url: text('linkedin_url').unique(),
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
  audit_score: integer('audit_score'),
  audit_level: text('audit_level'), // no-website | abandoned | very-outdated | outdated | modern
  audit_weaknesses: text('audit_weaknesses').array(),
  audit_cms: text('audit_cms'),
  audit_done: boolean('audit_done').default(false),
  // Suivi des tentatives MillionVerifier. Sans ça, la requête de validation (ORDER BY
  // created_at ASC) retente indéfiniment les MÊMES contacts les plus anciens si leur domaine
  // échoue systématiquement (timeout, ip_blocked) — ils bloquent alors TOUTE la file, y compris
  // les secteurs plus récents. mv_last_attempt_at fait tourner la priorité : un contact qui vient
  // d'échouer passe en fin de file plutôt que d'être retenté immédiatement.
  mv_last_attempt_at: timestamp('mv_last_attempt_at'),
  mv_attempts: integer('mv_attempts').default(0),
  /**
   * ⚠️ COLONNES QUI EXISTAIENT EN BASE SANS ÊTRE DÉCLARÉES ICI (26/08, audit A→Z).
   *
   * Une colonne absente de ce fichier est INVISIBLE à tout le code qui passe par Drizzle :
   * `db.select().from(...)` ne demande que les colonnes déclarées. C est ce qui avait vidé l onglet
   * « Absents » — vingt-cinq fiches portaient une date que l écran ne pouvait pas voir.
   *
   * Les quatre ci-dessous n étaient lues que par du SQL brut, donc rien ne cassait aujourd hui. Mais
   * la prochaine requête Drizzle sur ces tables serait repartie dans le même piège. Types relevés
   * dans information_schema, pas devinés.
   */
  /** Verdict rendu par MillionVerifier (ok / catch_all / invalid / unknown...). */
  mv_status: text('mv_status'),
  /** Le prospect s est plaint du NOMBRE de mails : plus aucune relance automatique. */
  pression_signalee_at: timestamp('pression_signalee_at', { withTimezone: true }),
  /**
   * ABSENCE ANNONCÉE PAR LE PROSPECT (« fermé jusqu'au 25 août »).
   *
   * ⚠️ Ces colonnes existaient en base (migration) mais PAS ici : `db.select().from(contacts)` ne
   * renvoie que les colonnes déclarées dans ce schéma. L'onglet « Absents » affichait donc 0 alors
   * que 25 fiches portaient bien une date. Une colonne ajoutée par migration doit toujours être
   * déclarée ici aussi, sinon elle est invisible pour tout le code qui passe par Drizzle.
   */
  absent_jusqu_au: date('absent_jusqu_au'),
  /** Adresse donnée par le prospect pour la suite des échanges (changement d'adresse). */
  redirige_vers: text('redirige_vers'),
  absence_motif: text('absence_motif'),
  absence_vue_le: timestamp('absence_vue_le'),
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
  instantly_campaign_id: text('instantly_campaign_id'), // ID réel de la campagne dans Instantly
  created_at: timestamp('created_at').defaultNow(),
})

// email_queue — all emails (sent + pending)
export const email_queue = pgTable('email_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  contact_id: uuid('contact_id').references(() => contacts.id),
  campaign_id: uuid('campaign_id').references(() => campaigns.id),
  sequence_step: integer('sequence_step').default(0), // 0=initial, 1=follow1, 2=follow2, 3=follow3
  from_email: text('from_email').notNull(),
  /** Boîte réellement utilisée pour l envoi (réputation, fidélité de boîte). */
  sent_via: text('sent_via'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').default('pending'), // pending/sent/bounced/failed/opened/replied
  scheduled_at: timestamp('scheduled_at'),
  sent_at: timestamp('sent_at'),
  opened_at: timestamp('opened_at'),
  replied_at: timestamp('replied_at'),
  instantly_email_id: text('instantly_email_id'),
  variant_id: text('variant_id'), // variante d'angle testée (auto-apprentissage)
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
  // NULLABLE depuis le canal LinkedIn : un message LinkedIn n'a pas de ligne email_queue en amont.
  email_queue_id: uuid('email_queue_id').references(() => email_queue.id),
  linkedin_lead_id: uuid('linkedin_lead_id').references(() => linkedin_leads.id),
  // 'email' | 'linkedin'. Point de jonction unique entre les deux canaux, à l'identique du
  // principe éprouvé chez LabegarIA — c'est lui qui alimente la messagerie unifiée.
  channel: text('channel').notNull().default('email'),
  // NOT NULL retiré : un message LinkedIn n'a pas d'adresse email.
  from_email: text('from_email'),
  subject: text('subject'),
  body: text('body').notNull(),
  classification: text('classification'), // desinterest/objection/question/interest/rdv_request/oof/spam/other
  /** Retrait manuel de la messagerie (séquelle d'un ancien bug). Le message reste en base. */
  archive_le: timestamp('archive_le'),
  action_taken: text('action_taken'), // auto_reply/draft_for_validation/no_action/blocklisted
  instantly_reply_id: text('instantly_reply_id'), // Instantly's own reply UUID (needed for sendReply)
  processed_at: timestamp('processed_at'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  fromEmailCreatedIdx: index('ir_from_email_created_idx').on(table.from_email, table.created_at),
  contactIdx: index('ir_contact_idx').on(table.contact_id),
  // Dédup permanente : un même email Instantly ne peut être inséré qu'une fois
  // (protège contre les crons concurrents). Migration SQL à appliquer en base.
  instantlyReplyIdUq: uniqueIndex('ir_instantly_reply_id_uq').on(table.instantly_reply_id),
}))

// reply_drafts — AI-generated drafts waiting for human validation
export const reply_drafts = pgTable('reply_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  incoming_reply_id: uuid('incoming_reply_id').references(() => incoming_replies.id),
  body: text('body').notNull(),
  status: text('status').default('pending'), // pending/sent/rejected/modified/scheduled
  send_after: timestamp('send_after'), // for auto_reply: don't send before this time (human delay simulation)
  sent_at: timestamp('sent_at'),
  // Qui a rejeté : 'humain' (Timéo, dans « À valider ») ou null/'systeme'. Une décision humaine
  // ne se rediscute pas — le rattrapage ne régénère jamais un brouillon rejeté par un humain.
  // Proposition ORIGINALE de l'IA, conservée quand Timéo modifie le texte : sans elle on sait
  // qu'il a corrigé, jamais ce qu'il a corrigé — et c'est l'écart qui enseigne.
  body_ia: text('body_ia'),
  rejete_par: text('rejete_par'),
  rejete_le: timestamp('rejete_le'),
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
  status: text('status').default('confirmed'), // proposed/confirmed/cancelled/rescheduled/signed
  google_event_id: text('google_event_id'),
  google_meet_link: text('google_meet_link'),
  notes: text('notes'),
  // Suivi de la commission de 5 % sur le CA apporté. Le client marque le RDV comme signé et
  // renseigne le CA HT réellement ENCAISSÉ (pas facturé), cumulé au fil des encaissements.
  ca_ht: numeric('ca_ht', { precision: 12, scale: 2 }),
  // Abonnement MENSUEL que le client paie a Hdigiweb. La commission de 5 % court chaque mois
  // tant que client_actif_jusqu_a est NULL (ou dans le futur) — elle n'est PAS ponctuelle.
  montant_mensuel: numeric('montant_mensuel', { precision: 12, scale: 2 }),
  // Date de fin d'abonnement. On ne SUPPRIME jamais un client perdu : effacer la ligne
  // reecrirait les factures des mois deja preleves.
  client_actif_jusqu_a: date('client_actif_jusqu_a'),
  // Classement commercial fait par le CLIENT (Haris) : a_venir / qualifie / signe / perdu /
  // non_qualifie. Distinct de `status`, qui est l'état technique du rendez-vous.
  crm_stage: text('crm_stage').default('a_venir'),
  /** Horodatage de la RÉSERVATION de facturation (cf. lib/facturation.ts : on réserve avant de prélever). */
  facture_le: timestamp('facture_le', { withTimezone: true }),
  unqualified_reason: text('unqualified_reason'),
  signed_at: timestamp('signed_at'),
  client_note: text('client_note'),
  created_at: timestamp('created_at').defaultNow(),
})

// blocklist
export const blocklist = pgTable('blocklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email'),
  domain: text('domain'),
  // Clé canonique normalisée (in/<slug>) — voir profileKey() dans lib/blocklist.ts. Un stop
  // LinkedIn doit bloquer aussi l'email de la même personne et réciproquement (blocklist au
  // niveau PERSONNE, pas au niveau canal — doctrine LabegarIA).
  linkedin_url: text('linkedin_url'),
  reason: text('reason'), // unsubscribe/bounce/desinterest/manual
  source: text('source'), // 'email' | 'linkedin' | 'manual' — traçabilité d'où vient le blocage
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

// learned_replies — réponses validées/écrites par le client → l'agent réutilise
// Permet à l'agent de devenir autonome : il apprend des corrections humaines.
export const learned_replies = pgTable('learned_replies', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),        // message du prospect (texte nettoyé)
  answer: text('answer').notNull(),            // réponse finale validée/écrite par le client
  classification: text('classification'),      // question/objection/interest/rdv_request...
  edited: boolean('edited').default(false),    // le client a-t-il modifié la proposition IA ?
  answer_ia: text('answer_ia'),                // ce que l'IA avait proposé (pour apprendre de l'écart)
  rejete: boolean('rejete').default(false),    // exemple NÉGATIF : réponse écartée par le client
  times_reused: integer('times_reused').default(0),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  classificationIdx: index('lr_classification_idx').on(table.classification),
}))

// agent_config — dynamic agent configuration (self-improving)
export const agent_config = pgTable('agent_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').unique().notNull(),
  value: text('value').notNull(),
  updated_by: text('updated_by').default('manual'), // 'manual' or 'auto_learning'
  updated_at: timestamp('updated_at').defaultNow(),
})

// linkedin_leads
//
// ⚠️ Réécrite le 03/09/2026 (canal LinkedIn Hdigiweb). Cette table existait déjà dans le schéma
// mais était totalement morte : aucune route API, aucun cron, aucune UI ne la lisait/l'écrivait —
// un embryon jamais branché. `contact_id` est le pont vers le référentiel unique de personnes ;
// c'est lui qui permet à un lead LinkedIn de traverser la MÊME messagerie, les MÊMES stats et le
// MÊME pipeline RDV que l'email, au lieu de dupliquer tout un sous-système parallèle non
// surveillé — défaut connu chez LabegarIA (aucun invariant LinkedIn, garde-fous codés en dur).
export const linkedin_leads = pgTable('linkedin_leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  contact_id: uuid('contact_id').references(() => contacts.id),
  first_name: text('first_name'),
  last_name: text('last_name'),
  company: text('company'),
  profile_url: text('profile_url').unique(),
  campaign_id: uuid('campaign_id').references(() => campaigns.id),
  // Cycle complet répliqué du bot LabegarIA (pas la version tronquée d'origine) :
  // pending/invited/connected/messaged/relanced_1/relanced_2/replied/reply_relanced/rdv
  // /not_interested/ignored/expired. `not_interested` est un statut TERMINAL, jamais recontacté.
  status: text('status').default('pending'),
  // Nécessaire pour la règle d'expiration à 21 jours (une invitation en attente au-delà de 3
  // semaines n'est PAS déductible comme acceptée — 52 faux positifs vécus chez LabegarIA).
  invited_at: timestamp('invited_at'),
  connected_at: timestamp('connected_at'),
  message_sent: text('message_sent'),
  // Nécessaire pour les relances J+3/J+7.
  last_message_at: timestamp('last_message_at'),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  contactIdx: index('ll_contact_idx').on(table.contact_id),
  statusIdx: index('ll_status_idx').on(table.status),
}))

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

// linkedin_bot_state — REPORTING seulement, jamais la source de vérité des garde-fous.
//
// Le budget réel (visites de profils/jour, montée en charge) vit dans state.json, LOCAL au VPS
// du bot, fail-closed si illisible — le bot ne doit JAMAIS dépendre du réseau pour connaître son
// propre budget, sinon on réintroduit une dépendance réseau sur un garde-fou de sécurité. Cette
// table est une copie que le bot pousse à chaque cycle, à titre informatif pour le dashboard et
// un futur invariant « bot muet » (E8) — jamais l'inverse.
export const linkedin_bot_state = pgTable('linkedin_bot_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Une ligne par client dès maintenant, même à un seul (Hdigiweb) — n'attend pas un 2e client
  // pour être multi-client.
  client: text('client').notNull().default('hdigiweb'),
  daily_profile_visits: integer('daily_profile_visits').default(0),
  daily_profile_visits_date: date('daily_profile_visits_date'),
  daily_invites_sent: integer('daily_invites_sent').default(0),
  daily_invites_date: date('daily_invites_date'),
  ramp_start: timestamp('ramp_start'),
  last_heartbeat_at: timestamp('last_heartbeat_at'),
  updated_at: timestamp('updated_at').defaultNow(),
}, (table) => ({
  clientIdx: uniqueIndex('lbs_client_uq').on(table.client),
}))

// dashboard_events — realtime event stream for SSE
export const dashboard_events = pgTable('dashboard_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // 'email_sent', 'reply_received', 'rdv_created', 'agent_decision'
  data: jsonb('data').notNull(),
  created_at: timestamp('created_at').defaultNow(),
}, (table) => ({
  createdAtIdx: index('de_created_at_idx').on(table.created_at),
}))
