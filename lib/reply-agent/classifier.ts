import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export type ReplyClassification =
  | 'desinterest'
  | 'objection'
  | 'question'
  | 'interest'
  | 'rdv_request'
  | 'oof'
  | 'spam'
  | 'other'

export type ActionType =
  | 'auto_reply'
  | 'draft_for_validation'
  | 'no_action'
  | 'blocklist'

export interface ClassificationResult {
  classification: ReplyClassification
  action: ActionType
  confidence: number
  reasoning: string
  extractedDate?: string
  extractedName?: string
}

const CLASSIFICATION_PROMPT = `Tu es l'agent IA de Hdigiweb, une agence web toulousaine.
Tu analyses les réponses à nos emails de prospection envoyés à des couvreurs en Occitanie.

Notre service : Améliorer la visibilité Google des couvreurs pour leur générer plus de devis.

Email envoyé :
{originalEmailBody}

Réponse reçue de {contactName} ({contactCompany}) :
Objet : {replySubject}
Message : {replyBody}

Classifie cette réponse parmi : desinterest / objection / question / interest / rdv_request / oof / spam / other

Action recommandée :
- desinterest → no_action + blocklist
- oof → auto_reply (relance à leur retour)
- spam → no_action
- objection/question/interest/rdv_request → draft_for_validation

Si rdv_request : extrais la date/heure proposée si mentionnée.

Réponds en JSON strict :
{
  "classification": "...",
  "action": "...",
  "confidence": 0-100,
  "reasoning": "...",
  "extractedDate": "..." ou null,
  "extractedName": "..." ou null
}`

export async function classifyReply(params: {
  replyBody: string
  replySubject: string
  originalEmailBody: string
  contactName: string
  contactCompany: string
}): Promise<ClassificationResult> {
  const prompt = CLASSIFICATION_PROMPT
    .replace('{originalEmailBody}', params.originalEmailBody)
    .replace('{contactName}', params.contactName)
    .replace('{contactCompany}', params.contactCompany)
    .replace('{replySubject}', params.replySubject)
    .replace('{replyBody}', params.replyBody)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in classification response')

  const raw = JSON.parse(jsonMatch[0]) as {
    classification: ReplyClassification
    action: ActionType
    confidence: number
    reasoning: string
    extractedDate?: string | null
    extractedName?: string | null
  }

  return {
    classification: raw.classification,
    action: raw.action,
    confidence: raw.confidence,
    reasoning: raw.reasoning,
    ...(raw.extractedDate ? { extractedDate: raw.extractedDate } : {}),
    ...(raw.extractedName ? { extractedName: raw.extractedName } : {}),
  }
}
