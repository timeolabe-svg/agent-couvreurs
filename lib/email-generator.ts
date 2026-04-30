import Anthropic from '@anthropic-ai/sdk'
import { Lead } from '@/types'

const client = new Anthropic()

function auditSummary(lead: Lead): string {
  const issues: string[] = []
  if (!lead.hasWebsite) issues.push('aucun site web détecté')
  if (lead.hasWebsite) issues.push('site web existant')
  if (lead.hasGoogleAds) issues.push('Google Ads actif')
  else issues.push('pas de Google Ads')
  if (lead.googleReviews && lead.googleReviews < 30) issues.push(`seulement ${lead.googleReviews} avis Google`)
  else if (lead.googleReviews) issues.push(`${lead.googleReviews} avis Google (${lead.googleRating}/5)`)
  return issues.join(', ')
}

function getAngle(lead: Lead): string {
  if (!lead.hasWebsite)
    return 'Pas de site web. Angle : invisible sur Google, perd des clients en ligne chaque jour au profit des concurrents qui ont un site.'
  if (!lead.hasGoogleAds)
    return 'Pas de Google Ads. Angle : les concurrents captent tout le trafic payant sur leur secteur à Toulouse. Manque à gagner hebdomadaire visible.'
  return 'Site présent mais sous-performant. Angle : mauvais positionnement SEO, site non optimisé mobile, concurrents mieux placés.'
}

export async function generateEmail(
  lead: Lead,
  type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3' = 'initial'
): Promise<{ subject: string; body: string }> {
  const audit = auditSummary(lead)
  const angle = getAngle(lead)

  const typeInstructions: Record<string, string> = {
    initial:    'Premier contact. Citer UN signal précis observé sur leur business. Accrocher sans vendre.',
    followup_1: 'Première relance J+2. Apporter un chiffre concret (volume de recherches locales, position concurrents). Court.',
    followup_2: 'Deuxième relance J+5. Offrir quelque chose de gratuit (audit, chiffre précis). Pas de copier-coller.',
    followup_3: 'Dernière relance J+10. Clore proprement. Laisser la porte ouverte.',
  }

  const prompt = `Tu es un commercial senior pour Hdigiweb, agence web à Toulouse qui aide les PME/TPE à être visibles sur internet.

Services Hdigiweb : création de sites web, SEO, Google Ads, Local Service Ads, gestion fiche Google, community management.

Lead à contacter :
- Entreprise : ${lead.company}
- Ville : ${lead.city}
- Secteur : ${lead.specialty?.join(', ') || 'non précisé'}
- Contact : ${lead.firstName || 'le responsable'}
- Audit digital : ${audit}

Angle à utiliser : ${angle}
Type d'email : ${typeInstructions[type]}

RÈGLES ABSOLUES :
- 80 à 120 mots maximum dans le corps
- Citer un fait précis et observé sur leur business (pas générique)
- Ton direct, humain, pas de jargon marketing
- Pas de "j'espère que vous allez bien" ni de "notre solution révolutionnaire"
- Un seul CTA à la fin, léger (question ou proposition d'appel)
- Signature : "Thomas — Hdigiweb"

JSON uniquement :
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
): Promise<{ body: string; classification: 'interested' | 'not_interested' | 'later' | 'info_request' | 'rdv_proposed' }> {
  const prompt = `Tu es un commercial senior pour Hdigiweb (agence web Toulouse). Tu traites une réponse de prospect.

Lead : ${lead.company} (${lead.city}) — ${lead.specialty?.join(', ')}
Réponse reçue : "${incomingReply}"

Ton rôle :
- Si le prospect est intéressé → proposer un appel de 15-20 min, demander disponibilités
- Si le prospect cite une heure/date → confirmer le RDV, demander un numéro si pas encore eu
- Si objection "j'ai déjà quelqu'un" → question directe sur ce qui est couvert, laisser ouvrir une porte
- Si pas intéressé → clore proprement, laisser la porte ouverte, court
- Si demande d'info → répondre précisément sur le service concerné, enchaîner vers un appel

Ton : commercial senior, direct, pas de bullshit, toujours orienté vers le RDV.
Max 100 mots. Signature : "Thomas — Hdigiweb"

JSON uniquement :
{"classification": "interested|not_interested|later|info_request|rdv_proposed", "body": "..."}`

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
