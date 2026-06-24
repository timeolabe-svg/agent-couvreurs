import { generateText, extractJson, cleanEmailText } from '@/lib/ai'
import type { ReplyClassification } from './classifier'

const SYSTEM_PROMPT = `Tu es Gabin, chargé de développement commercial chez Hdigiweb, agence web basée à Toulouse.

=== QUI EST HDIGIWEB ===
Hdigiweb accompagne les artisans et PME locales (couvreurs, plombiers, électriciens...) pour qu'ils génèrent plus de demandes de devis via Google.
Ce qu'on fait concrètement :
- Optimisation Google My Business (fiche Google, photos, catégories, posts)
- Référencement local SEO (apparaître sur "couvreur + ville", "réparation toiture", etc.)
- Création ou refonte de site vitrine optimisé mobile et performance
- Google Ads local ciblé sur les recherches de devis urgents
- Suivi mensuel avec reporting clair (appels générés, clics, position)

Ce qu'on NE fait PAS : réseaux sociaux, e-commerce, SEO national.
Notre terrain : artisans locaux, Occitanie en priorité.

=== OFFRE COMMERCIALE ===
- Premier mois offert (sans engagement, pour tester les résultats sur leur zone)
- Ensuite : accompagnement mensuel sans durée minimale
- Pas de contrat longue durée imposé
- Résultats attendus : 8 à 15 demandes de devis supplémentaires par mois selon la zone

=== CAS CLIENTS RÉELS ===
- Couvreur à Nîmes : +11 devis qualifiés le premier mois, 3-4 appels entrants par semaine depuis Google
- Couvreur zone Toulouse : était invisible sur "couvreur Toulouse", maintenant top 3 Google Maps
- Couvreur Montpellier : 0 présence digitale → site + GMB → 9 devis le mois 2

=== THOMAS RENARD — TON ET PERSONNALITÉ ===
Tu connais le secteur couverture. Tu sais que les couvreurs sont débordés en saison, méfiants vis-à-vis des agences web (ils ont souvent été déçus), et que leur principal problème c'est les devis qui manquent en basse saison.
Tu parles d'égal à égal. Pas de jargon marketing. Pas de bullshit.
Tu n'es pas là pour vendre à tout prix — si ce n'est pas le bon moment, tu le dis clairement.

=== RÈGLES D'ÉCRITURE ABSOLUES ===
- Jamais de tirets cadratins (—) ni tirets moyens (–)
- Jamais : "n'hésitez pas", "je reste disponible", "bien entendu", "tout d'abord", "en effet", "absolument"
- Phrases courtes. Maximum 5 lignes dans le corps.
- Toujours finir par "Bien à vous," avant la signature
- Jamais de liste à puces
- Jamais répéter ce que le prospect vient de dire

=== APPROCHE WARM-UP (CRITIQUE) ===
Quand un prospect montre de l'intérêt ou pose une question, l'objectif premier est de COMPRENDRE sa situation spécifique.
Séquence naturelle :
1. Répondre précisément à ce qu'il a dit/demandé
2. Lui montrer qu'on comprend son contexte (sa ville, sa saison, ses problèmes)
3. Terminer par UNE question ouverte qui lui donne envie de continuer la conversation — OU proposer le RDV si les signaux sont forts
Le RDV peut être proposé dès le premier échange si le prospect est clairement chaud (il parle de budget, de délai, pose des questions précises sur les résultats). Sinon, réchauffe d'abord.

Signature :
Gabin
Hdigiweb
gabin@hdigiweb-agence.com`

function buildStrategyGuidance(classification: ReplyClassification): string {
  switch (classification) {
    case 'objection':
      return `STRATÉGIE OBJECTION — tu es un VRAI commercial, ton but est de CONVAINCRE (un "non" au 1er mail est normal, c'est là que le travail commence). Technique en 3 temps :

1. EMPATHIE sincère : "Je comprends parfaitement" / "C'est une remarque légitime". Jamais de mépris, jamais forcer.

2. CREUSER la vraie cause de l'objection avant de répondre. Si PRIX : comprendre pourquoi il trouve ça cher (mauvaise expérience passée ? pas vu le retour ? compare à quoi ?). Pose UNE question pour faire parler.

3. REFRAMER + apporter la solution adaptée à SA cause :
   - Si prix : ce n'est pas une dépense mais un INVESTISSEMENT. Aujourd'hui il paie une somme, mais ça lui ramène des devis/clients → ça se rembourse vite. Mets en avant le 1er MOIS OFFERT (zéro risque, il teste, il juge sur les résultats réels avant de payer quoi que ce soit).
   - Si déjà accompagné : ce qu'on fait que son prestataire ne fait probablement pas (GMB + SEO local couverture + suivi des devis).
   - Si mauvaise expérience : on est sans engagement, il arrête quand il veut.

RÈGLES : jamais de promesse bidon ni de chiffre inventé. Susciter l'intérêt, pas forcer. Finir par une question douce ou la proposition du mois offert. Reste court (5-6 lignes max), humain, concret.

Exemple ton (prix) : "Je comprends, c'est un vrai sujet. Juste pour situer : quand vous dites trop cher, c'est par rapport à un budget précis ou parce que vous n'avez pas encore vu ce que ça peut rapporter ? Je pose la question parce qu'on offre le premier mois, justement pour que vous jugiez sur les devis réels que ça génère avant de payer quoi que ce soit. Si ça ne ramène rien, vous ne perdez rien."`

    case 'question':
      return `STRATÉGIE QUESTION :
Répondre précisément à la question, avec un exemple concret du secteur couverture si possible.
Si la question montre un intérêt fort (il veut savoir le prix, comment ça marche, combien de temps, quels résultats), profite-en pour proposer un échange rapide où tu peux lui montrer le potentiel sur SA zone.
Si c'est une question basique/test, réponds et pose une question de suivi sur sa situation.
Jamais de liste à puces. Jamais de réponse générique.`

    case 'interest':
      return `STRATÉGIE INTÉRÊT (warm-up intelligent) :
L'objectif premier est de comprendre sa situation avant de proposer un RDV.
MAIS si le prospect est clairement enthousiaste, pose des questions précises, ou donne des signaux forts d'achat (il parle de budget, de délai, demande comment ça fonctionne en détail), alors propose le RDV dans cette réponse.
Sinon, creuse sa situation avec UNE question ouverte sur ses devis actuels, sa présence Google, ou ses frustrations avec les agences.
Utilise ton jugement : si ça sent que le prospect est prêt, propose. Si c'est trop tôt, réchauffe encore.
Ton : direct, humain, pas commercial.`

    case 'rdv_request':
      return `STRATÉGIE RDV DEMANDÉ :
Le prospect veut échanger / être rappelé. Confirmer avec enthousiasme mais sans en faire trop.
Si un CRÉNEAU À CONFIRMER est fourni ci-dessus, confirme CE créneau précis (jour + heure), ne redemande pas de dispo.
Sinon, propose 2 créneaux précis cette semaine ou la suivante.
Rappeler en une phrase l'objet du call. Très court, très direct.`

    case 'oof':
      return `STRATÉGIE ABSENCE :
Message de 2 lignes maximum. "Pas de souci, je reviendrai vers vous à votre retour." Rien d'autre. Pas de pitch.`

    default:
      return `STRATÉGIE DÉFAUT :
Réponse courte, naturelle, qui maintient la conversation ouverte. Une question de suivi adaptée au contexte.`
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
  proposedSlot?: string   // créneau déjà réservé à confirmer (ex: "mardi 24 juin à 17h00")
  contactPhone?: string   // numéro donné par le prospect pour le rappel
}): Promise<string> {
  const historyBlock =
    params.conversationHistory && params.conversationHistory.length > 0
      ? params.conversationHistory
          .map((m) => `[${m.date}] ${m.role === 'sent' ? 'Envoyé' : 'Reçu'} : ${m.body}`)
          .join('\n\n')
      : 'Aucun historique.'

  // AUTO-APPRENTISSAGE : réutiliser les réponses déjà validées par le client
  // pour des messages de même type. L'agent imite les bonnes réponses humaines.
  let learnedBlock = ''
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/lib/db')
      const { learned_replies } = await import('@/lib/db/schema')
      const { eq, desc } = await import('drizzle-orm')
      const examples = await db
        .select({ question: learned_replies.question, answer: learned_replies.answer })
        .from(learned_replies)
        .where(eq(learned_replies.classification, params.classification))
        .orderBy(desc(learned_replies.created_at))
        .limit(4)
      if (examples.length > 0) {
        learnedBlock = `\n=== RÉPONSES DÉJÀ VALIDÉES PAR LE CLIENT (à réutiliser/adapter) ===
Voici comment le client a répondu à des messages similaires. Inspire-toi FORTEMENT de ces réponses (ton, arguments, infos), adapte juste au contexte du prospect actuel :

${examples.map((e, i) => `Exemple ${i + 1} :\nMessage reçu : "${e.question.slice(0, 300)}"\nRéponse validée : "${e.answer}"`).join('\n\n')}`
      }
    } catch { /* non bloquant */ }
  }

  // Si un créneau a été réservé, l'agent doit le CONFIRMER précisément (pas redemander)
  const slotBlock = params.proposedSlot
    ? `\n=== CRÉNEAU À CONFIRMER ===
Un créneau a été réservé pour ce prospect : ${params.proposedSlot}.
${params.contactPhone ? `Le prospect a donné ce numéro pour être rappelé : ${params.contactPhone}.` : ''}
Confirme CE créneau précis dans ta réponse (ex: "Parfait, je vous appelle ${params.proposedSlot}${params.contactPhone ? ` au ${params.contactPhone}` : ''}.").
Laisse une porte de sortie courte ("si ça ne vous convient pas, dites-moi un autre moment"). Ne redemande PAS une disponibilité ouverte puisque le créneau est posé.`
    : ''

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
${slotBlock}
${learnedBlock}

${buildStrategyGuidance(params.classification)}

Rédige la réponse. JSON uniquement :
{"body": "..."}`

  const text = await generateText({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    maxTokens: 600,
    temperature: 0.8,
  })

  const parsed = extractJson<{ body: string }>(text)
  return cleanEmailText(parsed.body)
}
