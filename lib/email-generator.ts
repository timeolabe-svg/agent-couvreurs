import Anthropic from '@anthropic-ai/sdk'
import { Lead } from '@/types'

const client = new Anthropic()

function buildLeadContext(lead: Lead): string {
  const parts = [
    `Entreprise: ${lead.company}`,
    `Ville: ${lead.city}`,
    `Contact: ${lead.contact}`,
  ]
  if (lead.website) parts.push(`Site web: ${lead.website}`)
  if (lead.googleRating) parts.push(`Note Google: ${lead.googleRating}/5 (${lead.googleReviews} avis)`)
  if (lead.specialty.length) parts.push(`Specialites: ${lead.specialty.join(', ')}`)
  parts.push(`Google Ads: ${lead.hasGoogleAds ? 'oui' : 'non'}`)
  parts.push(`Site web: ${lead.hasWebsite ? 'oui' : 'non'}`)
  return parts.join('\n')
}

function getAngle(lead: Lead): string {
  if (!lead.hasWebsite) return "Pas de site web — peu de presence digitale. Angle: generer des demandes sans dependre du bouche-a-oreille."
  if (lead.hasGoogleAds) return "Fait deja de la pub Google. Angle: ameliorer le ROI, systématiser l'acquisition."
  return "Presence web correcte. Angle: remplir le planning de facon plus previsible, sans commissions."
}

export async function generateEmail(
  lead: Lead,
  type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3' = 'initial'
): Promise<{ subject: string; body: string }> {
  const context = buildLeadContext(lead)
  const angle = getAngle(lead)

  const typeInstructions: Record<string, string> = {
    initial:    "Premier contact. Doit accrocher sans etre agressif.",
    followup_1: "Premiere relance (J+2). Courte, directe, pas de copier-coller du premier mail.",
    followup_2: "Deuxieme relance (J+5). Apporter un element de valeur.",
    followup_3: "Derniere relance (J+10). Boucler proprement, laisser la porte ouverte.",
  }

  const prompt = `Tu es un commercial senior B2B qui genere des rendez-vous pour une agence qui aide des artisans couvreurs a trouver des chantiers en France.

Prospect:
${context}

Angle: ${angle}
Type: ${typeInstructions[type]}

CONTRAINTES:
- 80 a 120 mots max dans le corps
- Ton naturel, humain, direct — zero jargon marketing
- Pas de "J'espere que vous allez bien"
- Accroche personnalisee (ville, avis Google, specialite)
- Une seule question ou CTA a la fin
- Signature: "Thomas" seulement

Reponds UNIQUEMENT avec un JSON:
{"subject": "...", "body": "..."}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')
  return JSON.parse(jsonMatch[0])
}

export async function generateReply(
  lead: Lead,
  incomingReply: string,
  threadContext: string
): Promise<{ body: string; classification: string }> {
  const prompt = `Tu es un commercial senior B2B. Tu geres des leads pour une agence qui aide des couvreurs a trouver des chantiers.

Lead: ${lead.company} (${lead.city})
Contexte thread: ${threadContext}
Reponse recue: "${incomingReply}"

Classifie la reponse ET redige une reponse naturelle, efficace, qui pousse vers un rendez-vous.

Si le lead mentionne une disponibilite (ex: "jeudi 14h", "vendredi matin"), confirme le rendez-vous et demande le numero de telephone si pas deja eu.

Si objection: repondre avec calme et un argument factuel.
Si pas interesse: clore proprement, laisser la porte ouverte.

JSON uniquement:
{"classification": "interested|not_interested|later|info_request|rdv_proposed", "body": "..."}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')
  return JSON.parse(jsonMatch[0])
}
