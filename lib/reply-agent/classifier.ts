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

TU ES AUTONOME. Tu réponds toi-même à la grande majorité des messages. Tu ne demandes une validation humaine que si tu as un VRAI doute ou si c'est trop technique/sensible.

Choix de l'action :
- desinterest (pas intéressé, "non merci", "déjà accompagné" ferme) → blocklist
- spam → no_action
- oof (absence/accusé réception automatique) → no_action
- interest / question / objection / rdv_request → auto_reply (tu réponds seul)

EXCEPTION → draft_for_validation (demande validation) UNIQUEMENT si :
- le prospect demande un prix précis, un devis chiffré, ou négocie un tarif
- question très technique nécessitant une expertise précise que tu n'as pas
- réclamation, mécontentement, ton agressif ou juridique
- situation ambiguë où tu n'es pas sûr de la bonne réponse (confidence < 70)

Dans le doute léger : réponds toi-même (auto_reply). Ne sur-sollicite pas l'humain.

Si rdv_request : extrais la date/heure proposée si mentionnée, et action = auto_reply.

Réponds en JSON strict :
{
  "classification": "...",
  "action": "...",
  "confidence": 0-100,
  "reasoning": "...",
  "extractedDate": "..." ou null,
  "extractedName": "..." ou null
}`

// CRITIQUE : isole le VRAI texte du prospect en retirant l'historique cité
// (notre email d'origine contient "répondez Stop" → sinon faux opt-out).
export function stripQuotedReply(raw: string): string {
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#3[49];/g, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')

  // Coupe au premier marqueur de citation / historique de conversation
  const markers = [
    /\n\s*Le\s[\s\S]{0,90}?\sa\s+écrit\s*:/i,        // "Le 15 juin 2026, X a écrit :"
    /\n\s*Le\s(lun|mar|mer|jeu|ven|sam|dim)[\s\S]{0,90}?,/i, // "Le lun. 15 juin 2026, ... a"
    /\nOn\s[\s\S]{0,90}?\swrote:/i,
    /-{2,}\s*(Original Message|Message d'origine)\s*-{2,}/i,
    /\n\s*De\s*:[\s\S]{0,250}?Envoyé\s*:/i,           // Outlook FR
    /\n\s*From:[\s\S]{0,250}?Sent:/i,                 // Outlook EN
    /\n_{5,}/,                                         // séparateur Outlook
    /\n>{1,}\s/,                                       // lignes citées ">"
    /\nEnvoyé de mon /i,
    /\nObtenez\s+Outlook/i,
    /\nPour ne plus recevoir mes emails/i,            // notre propre ligne opt-out citée
  ]
  let cutAt = text.length
  for (const m of markers) {
    const match = text.match(m)
    if (match && match.index !== undefined && match.index < cutAt) cutAt = match.index
  }
  text = text.slice(0, cutAt)

  // Retire la signature après "-- "
  text = text.replace(/\n--\s*\n[\s\S]*$/, '')

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// Détecte les réponses AUTOMATIQUES (accusés de réception, absences, bots).
// Ce ne sont PAS de vraies réponses humaines → on les ignore (no_action).
function isAutoResponder(body: string, subject: string, fromEmail: string): boolean {
  const text = (subject + ' ' + body).toLowerCase()
  const from = fromEmail.toLowerCase()

  // Adresses techniques (support, antispam, noreply...)
  if (/(no-?reply|ne-?pas-?repondre|donotreply|mailer-daemon|postmaster|antispam|notification|support@|@webador|@wix|@sendgrid|@mailchimp)/.test(from)) {
    return true
  }

  const autoPatterns = [
    // Accusés de réception
    /nous reviendrons vers vous/,
    /reviendrai vers vous/,
    /accus[ée] de r[ée]ception/,
    /bonne r[ée]ception de (votre|ce)/,
    /bien re[çc]u votre (message|mail|email|demande)/,
    /confirmons la bonne r[ée]ception/,
    /nous mettons tout en [œo]euvre pour/,
    /traiter (votre|ce|le) (message|mail|demande) dans les meilleurs d[ée]lais/,
    /votre (message|demande) a bien [ée]t[ée] re[çc]u/,
    // Réponses automatiques / absences
    /r[ée]ponse automatique/,
    /message automatique/,
    /automatic reply/,
    /out of office/,
    /auto-?reply/,
    /je suis (actuellement )?absent/,
    /actuellement en (cong[ée]s?|vacances|d[ée]placement)/,
    /de retour le \d/,
    /en (cong[ée]s?|vacances) jusqu/,
    /ne pas r[ée]pondre [àa] (cet|ce) (e-?mail|message)/,
  ]
  return autoPatterns.some(p => p.test(text))
}

// Detect opt-out without calling Claude (saves credits + faster)
function isOptOut(body: string, subject: string): boolean {
  const text = (body + ' ' + subject).toLowerCase().trim()
  const optOutPatterns = [
    /^stop\b/m,                                       // "Stop" / "STOP" en début de ligne
    /\bstop\b\s*[.!]?\s*$/m,                           // "... stop" en fin de message
    /^(d[ée]sinscri(re|ption)|unsubscribe|me d[ée]sabonner|ne plus recevoir|ne plus me contacter|ne plus contacter|plus de mail|plus d'email)/m,
    /merci de (me retirer|ne plus|stopper|cesser|me d[ée]sabonner)/,
    /souhait(e|ons) (ne plus|pas) [eê]tre contact/,
    /(ne m'int[eé]resse pas|pas int[eé]ress[eé]e?\b)/,
    /me retirer de (votre|vos|la) (liste|base|mailing)/,
  ]
  return optOutPatterns.some(p => p.test(text))
}

export async function classifyReply(params: {
  replyBody: string
  replySubject: string
  originalEmailBody: string
  contactName: string
  contactCompany: string
  fromEmail?: string
}): Promise<ClassificationResult> {
  // CRITIQUE : on n'analyse QUE le vrai texte du prospect, jamais la citation
  // de notre email (qui contient "répondez Stop" → sinon faux opt-out).
  const cleanBody = stripQuotedReply(params.replyBody)

  // Réponse automatique (accusé de réception, absence, bot) → ignorer totalement
  if (isAutoResponder(cleanBody, params.replySubject, params.fromEmail ?? '')) {
    return {
      classification: 'oof',
      action: 'no_action',
      confidence: 98,
      reasoning: 'Réponse automatique détectée (accusé de réception / absence / bot) — ignorée, pas de brouillon.',
    }
  }

  // Détection opt-out rapide — UNIQUEMENT sur le texte réel du prospect
  if (isOptOut(cleanBody, params.replySubject)) {
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
    .replace('{replyBody}', cleanBody)

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
