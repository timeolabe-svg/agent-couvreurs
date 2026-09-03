/**
 * send-linkedin-reply.ts — prépare un brouillon de réponse LinkedIn, N'ENVOIE RIEN.
 *
 * Doctrine reprise de LabegarIA : « l'agent OUVRE et RELANCE, il ne CONVERSE pas ». Sur LinkedIn
 * le message vient d'un profil humain identifiable, une réponse automatique à côté de la plaque
 * coûte plus cher que dans une boîte mail. Cette fonction génère le texte et l'écrit dans
 * `reply_drafts` (status 'pending') ; c'est le bot Playwright, seul détenteur de la session
 * LinkedIn, qui ira le lire via `GET /api/linkedin/pending-replies` et l'enverra lui-même.
 *
 * ⚠️ Ne réutilise PAS `send-reply.ts` tel quel — son garde anti-monologue s'appuie sur
 * `email_queue` (mails de séquence) et `messages_humains` (relevé du dossier Envoyés Gmail), deux
 * concepts qui n'existent pas côté LinkedIn : ici, le bot LUI-MÊME est la seule source d'envoi, il
 * n'y a pas de dossier "Envoyés" externe à relever. La garde ci-dessous porte la MÊME idée
 * (quelqu'un a-t-il déjà répondu à CE message précis ? un monologue est-il en cours ?) avec les
 * données réellement disponibles sur ce canal.
 */

export interface PrepareLinkedinReplyResult {
  ok: boolean
  draftId?: string
  skipped?: string
  error?: string
}

export async function prepareLinkedinReply(incomingReplyId: string): Promise<PrepareLinkedinReplyResult> {
  const { sql } = await import('@/lib/db')

  const rows = (await sql`
    SELECT ir.id, ir.body, ir.classification, ir.created_at, ir.linkedin_lead_id, ir.contact_id,
           ll.first_name, ll.company, ll.status AS lead_status, ll.last_message_at,
           c.city, c.sector
    FROM incoming_replies ir
    LEFT JOIN linkedin_leads ll ON ll.id = ir.linkedin_lead_id
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE ir.id = ${incomingReplyId} AND ir.channel = 'linkedin'
    LIMIT 1
  `) as Array<{
    id: string; body: string; classification: string | null; created_at: string
    linkedin_lead_id: string | null; contact_id: string | null
    first_name: string | null; company: string | null; lead_status: string | null
    last_message_at: string | null; city: string | null; sector: string | null
  }>
  const r = rows[0]
  if (!r) return { ok: false, error: 'incoming_reply LinkedIn introuvable' }

  // Statut TERMINAL : jamais de brouillon pour quelqu'un qui a explicitement décliné.
  if (r.lead_status === 'not_interested') return { ok: false, skipped: 'lead not_interested (terminal)' }

  // Un brouillon existe déjà pour CE message précis (généré ou envoyé) → ne pas en refaire un.
  const existing = (await sql`
    SELECT id, status FROM reply_drafts WHERE incoming_reply_id = ${incomingReplyId} LIMIT 1
  `) as Array<{ id: string; status: string | null }>
  if (existing[0]) return { ok: false, skipped: `brouillon déjà existant (${existing[0].status})` }

  /**
   * ⚠️ ANTI-MONOLOGUE : même idée que send-reply.ts, données différentes. Si le bot a déjà écrit à
   * ce lead récemment ET que le prospect n'a rien dit depuis, on ne prépare pas un second message
   * — le cas Jaky Lesage (trois voix sur le même fil) vaut aussi sur LinkedIn.
   */
  const DELAI_MIN = Number(process.env.DELAI_MIN_ENTRE_MESSAGES_MIN ?? 120)
  if (r.linkedin_lead_id && r.last_message_at) {
    const dernierEnvoi = new Date(r.last_message_at).getTime()
    const dernierRecuRows = (await sql`
      SELECT MAX(created_at) AS d FROM incoming_replies WHERE linkedin_lead_id = ${r.linkedin_lead_id}
    `) as Array<{ d: string | null }>
    const dernierRecu = dernierRecuRows[0]?.d ? new Date(dernierRecuRows[0].d).getTime() : 0
    const prospectAParleDepuis = dernierRecu > dernierEnvoi
    const minutesDepuisEnvoi = (Date.now() - dernierEnvoi) / 60_000
    if (!prospectAParleDepuis && minutesDepuisEnvoi < DELAI_MIN) {
      return { ok: false, skipped: `délai anti-monologue (${Math.round(minutesDepuisEnvoi)} min < ${DELAI_MIN})` }
    }
  }

  const { classifyReply } = await import('./classifier')
  const { generateReplyResponse } = await import('./generator')
  type ReplyClassification = Awaited<ReturnType<typeof classifyReply>>['classification']

  // Le classifieur est générique (aucun couplage email) — replySubject vide, c'est un DM sans objet.
  const classification = r.classification
    ? { classification: r.classification as ReplyClassification, action: 'draft_for_validation' as const, confidence: 80, reasoning: 'déjà classé à l\'ingestion' }
    : await classifyReply({
        replyBody: r.body,
        replySubject: '',
        originalEmailBody: '',
        contactName: r.first_name ?? '',
        contactCompany: r.company ?? '',
      })

  if (classification.classification === 'spam' || classification.classification === 'oof') {
    return { ok: false, skipped: `classification ${classification.classification} : pas de brouillon` }
  }

  const body = await generateReplyResponse({
    classification: classification.classification,
    originalEmailBody: '',
    replyBody: r.body,
    contactName: r.first_name ?? '',
    contactCompany: r.company ?? '',
    contactCity: r.city ?? '',
    contactSector: r.sector ?? undefined,
    channel: 'linkedin',
  })

  const inserted = (await sql`
    INSERT INTO reply_drafts (incoming_reply_id, body, status)
    VALUES (${incomingReplyId}, ${body}, 'pending')
    RETURNING id
  `) as Array<{ id: string }>

  return { ok: true, draftId: inserted[0]?.id }
}
