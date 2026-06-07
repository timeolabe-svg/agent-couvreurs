import Anthropic from '@anthropic-ai/sdk'
import type { ReplyClassification } from './classifier'

const client = new Anthropic()

const SYSTEM_PROMPT = `Tu es Thomas Renard, commercial chez Hdigiweb (agence web Toulouse).
Tu réponds à un couvreur qui a répondu à ton email de prospection.

VOIX : naturel, direct, sans bullshit commercial. Phrases courtes. Jamais de tirets cadratins.
JAMAIS : "n'hésitez pas", "je reste disponible", "bien entendu", "tout d'abord"
TOUJOURS : réponse courte (3-5 lignes max), "Bien à vous," avant la signature

Signature :
Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`

function buildStrategyGuidance(classification: ReplyClassification): string {
  switch (classification) {
    case 'objection':
      return `Stratégie : Ouvrir par "Logique." Reconnaître la préoccupation sans la répéter. Pivoter immédiatement sur un angle précis non couvert. Position haute : "si c'est couvert, je vous laisse tranquille."`
    case 'question':
      return `Stratégie : Répondre précisément à la question posée. Terminer par UNE question de suivi qui ouvre la prochaine étape (pas une question fermée oui/non).`
    case 'interest':
      return `Stratégie : Proposer une étape concrète (échange téléphonique ou démo courte). CTA avec alternative A/B : "début ou fin de semaine ?"`
    case 'rdv_request':
      return `Stratégie : Confirmer le RDV souhaité. Proposer 2 créneaux précis (la date exacte est autorisée car le prospect l'a évoquée). Ton chaleureux et direct.`
    case 'oof':
      return `Stratégie : Message très court. Indiquer "je reviendrai vers vous à votre retour". Pas de pitch.`
    default:
      return `Stratégie : Réponse courte, naturelle, qui ouvre la prochaine étape.`
  }
}

export async function generateReplyResponse(params: {
  classification: ReplyClassification
  originalEmailBody: string
  replyBody: string
  contactName: string
  contactCompany: string
  contactCity: string
  conversationHistory?: Array<{ role: 'sent' | 'received'; body: string; date: string }>
}): Promise<string> {
  const historyBlock =
    params.conversationHistory && params.conversationHistory.length > 0
      ? params.conversationHistory
          .map((m) => `[${m.date}] ${m.role === 'sent' ? 'Envoyé' : 'Reçu'} : ${m.body}`)
          .join('\n\n')
      : 'Aucun historique.'

  const userPrompt = `Context :
- Classification : ${params.classification}
- Entreprise : ${params.contactCompany}, ${params.contactCity}
- Prénom prospect : ${params.contactName}
- Historique de conversation :
${historyBlock}

Email original envoyé :
${params.originalEmailBody}

Réponse reçue :
${params.replyBody}

${buildStrategyGuidance(params.classification)}

Rédige la réponse. JSON uniquement :
{"body": "..."}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in generator response')

  const parsed = JSON.parse(jsonMatch[0]) as { body: string }
  return parsed.body
}
