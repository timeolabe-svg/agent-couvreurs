import { generateText, extractJson } from '@/lib/ai'

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

// Detect opt-out without calling Claude (saves credits + faster)
function isOptOut(body: string, subject: string): boolean {
  const text = (body + ' ' + subject).toLowerCase().trim()
  const optOutPatterns = [
    /^stop$/m,
    /^(d[ée]sinscri(re|ption)|unsubscribe|arr[eê]ter|retirer|supprimer|ne plus recevoir|ne plus contacter|plus de mail|plus d'email|pas int[eé]ress[eé])/m,
    /r[eé]pondez.*stop/,
    /merci de (me retirer|ne plus|stopper|cesser)/,
    /souhait(e|ons) (ne plus|pas) [eê]tre contact/,
  ]
  return optOutPatterns.some(p => p.test(text))
}

export async function classifyReply(params: {
  replyBody: string
  replySubject: string
  originalEmailBody: string
  contactName: string
  contactCompany: string
}): Promise<ClassificationResult> {
  // Fast opt-out detection before calling Claude
  if (isOptOut(params.replyBody, params.replySubject)) {
    return {
      classification: 'desinterest',
      action: 'blocklist',
      confidence: 99,
      reasoning: 'Opt-out explicite détecté — ajout automatique à la blocklist.',
    }
  }

  const prompt = CLASSIFICATION_PROMPT
    .replace('{originalEmailBody}', params.originalEmailBody)
    .replace('{contactName}', params.contactName)
    .replace('{contactCompany}', params.contactCompany)
    .replace('{replySubject}', params.replySubject)
    .replace('{replyBody}', params.replyBody)

  const text = await generateText({
    prompt,
    maxTokens: 400,
    temperature: 0.2, // classification = déterministe
  })

  const raw = extractJson<{
    classification: ReplyClassification
    action: ActionType
    confidence: number
    reasoning: string
    extractedDate?: string | null
    extractedName?: string | null
  }>(text)

  return {
    classification: raw.classification,
    action: raw.action,
    confidence: raw.confidence,
    reasoning: raw.reasoning,
    ...(raw.extractedDate ? { extractedDate: raw.extractedDate } : {}),
    ...(raw.extractedName ? { extractedName: raw.extractedName } : {}),
  }
}
