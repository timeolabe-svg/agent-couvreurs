import Anthropic from '@anthropic-ai/sdk'
import { Prospect } from '@/types'

const client = new Anthropic()

function buildProspectContext(prospect: Prospect): string {
  const parts = [`Entreprise: ${prospect.company}`, `Ville: ${prospect.city}`]

  if (prospect.contact) parts.push(`Contact: ${prospect.contact}`)
  if (prospect.website) parts.push(`Site web: ${prospect.website}`)
  if (prospect.googleRating) parts.push(`Note Google: ${prospect.googleRating}/5 (${prospect.googleReviews} avis)`)
  if (prospect.specialty.length > 0) parts.push(`Spécialités: ${prospect.specialty.join(', ')}`)

  parts.push(`Taille estimée: ${prospect.employees_estimate} employés`)
  parts.push(`Google Ads actif: ${prospect.hasGoogleAds ? 'oui' : 'non'}`)
  parts.push(`Site web: ${prospect.hasWebsite ? 'oui' : 'non'}`)

  return parts.join('\n')
}

function getAngleForSegment(prospect: Prospect): string {
  if (!prospect.hasWebsite) {
    return "L'artisan n'a pas de site web, donc peu de présence digitale. Angle: l'aider à générer des demandes sans dépendre du bouche-à-oreille."
  }
  if (prospect.hasGoogleAds) {
    return "L'artisan fait déjà de la pub Google. Angle: améliorer le ROI, ne plus dépendre uniquement des Ads, systématiser l'acquisition."
  }
  if (prospect.marketingMaturity === 'low') {
    return "L'artisan est passif en acquisition. Angle: l'alerter sur les opportunités qu'il rate, proposer une solution simple."
  }
  return "L'artisan a une présence web correcte. Angle: remplir le planning de façon plus prévisible, sans commissions."
}

export async function generateEmail(
  prospect: Prospect,
  type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3' = 'initial'
): Promise<{ subject: string; body: string }> {
  const prospectContext = buildProspectContext(prospect)
  const angle = getAngleForSegment(prospect)

  const typeInstructions: Record<string, string> = {
    initial: "C'est le premier contact. L'email doit accrocher sans être agressif.",
    followup_1: "C'est une première relance (J+2). Courte, directe, pas de copier-coller du premier mail.",
    followup_2: "C'est la deuxième relance (J+5). Apporter un élément de valeur ou une preuve sociale.",
    followup_3: "C'est la dernière relance (J+10). Boucle la séquence proprement, laisse la porte ouverte.",
  }

  const prompt = `Tu es un expert en cold emailing B2B pour une agence qui génère des chantiers pour des artisans couvreurs en France.

Écris un email de prospection pour ce prospect:
${prospectContext}

Angle à utiliser: ${angle}
Type d'email: ${typeInstructions[type]}

CONTRAINTES ABSOLUES:
- 80 à 120 mots maximum dans le corps (hors signature)
- Ton naturel, humain, direct — pas de jargon marketing
- Pas de "J'espère que vous allez bien", pas de "Notre solution révolutionnaire"
- Accroche personnalisée basée sur le prospect (ville, avis, spécialité, présence en ligne)
- Une seule question ou CTA à la fin, léger
- Signature: "Thomas" seulement
- Pas de formule de politesse ampoulée à la fin

Réponds UNIQUEMENT avec un JSON valide:
{
  "subject": "objet de l'email (court, pas clickbait)",
  "body": "corps complet de l'email"
}`

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

export async function classifyReply(replyContent: string): Promise<{
  classification: 'interested' | 'not_interested' | 'later' | 'info_request'
  suggestedResponse: string
}> {
  const prompt = `Tu analyses une réponse à un cold email de prospection pour une agence qui génère des chantiers pour couvreurs.

Réponse reçue: "${replyContent}"

Classifie la réponse et génère une réponse appropriée.

Réponds UNIQUEMENT avec un JSON:
{
  "classification": "interested" | "not_interested" | "later" | "info_request",
  "suggestedResponse": "réponse suggérée courte et naturelle"
}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')

  return JSON.parse(jsonMatch[0])
}
