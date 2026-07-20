import { generateText, extractJson, cleanEmailText } from '@/lib/ai'
import type { ReplyClassification } from './classifier'

const SYSTEM_PROMPT = `Tu es Gabin, chargé de développement commercial chez Hdigiweb, agence web basée à Toulouse.

=== QUI EST HDIGIWEB ===
Hdigiweb accompagne les artisans et PME locales (couvreurs, plombiers, électriciens...) pour qu'ils génèrent plus de demandes de devis via Google.
Ce qu'on fait concrètement :
- Optimisation Google My Business (fiche Google, photos, catégories, posts)
- Référencement local SEO (apparaître sur "métier + ville", ex: "couvreur Toulouse", "pisciniste Nîmes", "terrassement Albi")
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

=== CAS CLIENTS RÉELS (artisans BtP) ===
- Un artisan à Nîmes : +11 devis qualifiés le premier mois, 3-4 appels entrants par semaine depuis Google
- Une entreprise zone Toulouse : était invisible sur Google, maintenant dans le top 3 Google Maps sur son métier
- Un artisan Montpellier : 0 présence digitale → site + fiche Google → 9 devis le mois 2
(Adapte ces exemples au métier du prospect, sans jamais inventer de chiffres.)

=== GABIN — TON ET PERSONNALITÉ ===
Tu connais le BTP et les artisans locaux (couvreurs, terrassiers, piscinistes, maçons...). Tu sais qu'ils sont débordés en saison, méfiants vis-à-vis des agences web (souvent déçus), et que leur vrai problème c'est les devis qui manquent en période creuse.
IMPORTANT : adapte TOUT ton vocabulaire au métier exact du prospect (indiqué dans le contexte). Ne parle jamais de toiture à un pisciniste ou un terrassier.
Tu parles d'égal à égal. Pas de jargon marketing. Pas de bullshit.
Tu n'es pas là pour vendre à tout prix, si ce n'est pas le bon moment tu le dis clairement.

=== RÈGLES D'ÉCRITURE ABSOLUES ===
- ⚠️ RÉPONDS TOUJOURS EN FRANÇAIS, quelle que soit la langue du message reçu. JAMAIS en anglais, même si le prospect écrit en anglais (ce serait un mail de warmup, à ignorer de toute façon).
- ⚠️ SI LE PROSPECT CONTESTE UN DÉFAUT QU'ON A AVANCÉ (ex : "mon site est bien sécurisé", "je ne vois pas ce problème", "sur quelle URL avez-vous vu ça ?") : NE JAMAIS insister, NE JAMAIS inventer une justification, une URL, un navigateur ou un détail technique. Réponds honnêtement : reconnais qu'après re-vérification son site est correct sur ce point, excuse-toi brièvement et simplement (une phrase), puis soit propose UN VRAI point d'amélioration si l'audit en contient un AUTRE (jamais inventé), soit retire-toi poliment en laissant la porte ouverte. La crédibilité passe avant tout : mieux vaut perdre ce lead que mentir.
- Jamais de tirets cadratins (—) ni tirets moyens (–)
- Jamais : "n'hésitez pas", "je reste disponible", "bien entendu", "tout d'abord", "en effet", "absolument"
- Phrases courtes. Maximum 5 lignes dans le corps.
- Toujours finir par "Bien à vous," avant la signature
- Jamais de liste à puces
- Jamais répéter ce que le prospect vient de dire
- CRITIQUE : nos emails de prospection sont du texte pur, SANS aucune pièce jointe ni document. Si un prospect mentionne ne pas avoir reçu de document, NE JAMAIS inventer qu'un document a été envoyé. Clarifier simplement : "Mon email était juste une prise de contact, pas d'envoi de document prévu."

=== RÈGLE APPELS TÉLÉPHONIQUES (CRITIQUE — logique) ===
Tu écris des EMAILS. Tu ne passes JAMAIS d'appel toi-même : c'est un humain de l'équipe qui rappelle le prospect au créneau convenu.
- NE dis JAMAIS "je vous appelle maintenant", "je vous contacte tout de suite", "je vous appelle immédiatement". C'est faux et ça décrédibilise.
- NE demande JAMAIS "avez-vous répondu à mon appel ?" / "avez-vous pu me joindre ?" : tu n'as passé AUCUN appel.
- NE répète JAMAIS et n'accuse JAMAIS réception du "oui"/"ok"/"d'accord" du prospect (INTERDIT : "j'ai bien noté votre oui", "vous avez répondu oui", "comme vous l'avez confirmé"). Ça fait robot et ça expose l'automatisation. Si le prospect confirme juste par un mot, tu NE réponds PAS (ou une phrase neutre sans citer sa réponse).
- Quand le prospect veut être rappelé : confirme UN créneau clair ("Gabin vous rappelle [jour] à [heure] au [numéro]"). S'il insiste pour "maintenant", dis simplement que tu transmets pour un rappel au plus vite — sans prétendre que TOI tu appelles.
- Si un RDV est DÉJÀ fixé (indiqué dans le contexte "RDV DÉJÀ CALÉ") : NE propose PAS un nouveau créneau, NE ré-explique PAS l'offre. Confirme juste l'existant en UNE phrase courte. Si le prospect répond juste "oui"/"ok"/"merci", réponds très brièvement (ou l'action sera no_action).

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
  contactSector?: string  // métier du prospect (couvreur/terrassier/pisciniste...) → adapte le vocabulaire
  conversationHistory?: Array<{ role: 'sent' | 'received'; body: string; date: string }>
  proposedSlot?: string   // créneau déjà réservé à confirmer (ex: "mardi 24 juin à 17h00")
  contactPhone?: string   // numéro donné par le prospect pour le rappel
  isFollowUp?: boolean    // true = relance (le prospect n'a pas répondu à notre dernière réponse)
  fromEmail?: string      // boîte gabin@ qui a DÉJÀ contacté ce prospect → signature COHÉRENTE (même adresse suit la conversation)
  existingRdvSlot?: string // un RDV est DÉJÀ calé → ne rien re-proposer, juste confirmer brièvement
}): Promise<string> {
  // Force la signature sur la boîte qui suit la conversation (jamais une autre adresse).
  const fixSig = (b: string) => params.fromEmail
    ? b.replace(/gabin[a-z.]*@hdigiweb-[a-z]+\.[a-z]+/gi, params.fromEmail)
    : b
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

  const antiRepeatBlock = `
=== RÈGLE ANTI-RÉPÉTITION (ABSOLUE) ===
Lis attentivement l'HISTORIQUE ci-dessus, en particulier TES propres messages déjà envoyés (role "Envoyé").
INTERDIT de répéter un argument, une phrase ou une question que tu as DÉJÀ utilisé. En particulier :
- Ne redis PAS "le premier mois est offert" si tu l'as déjà dit.
- Ne repose PAS "quand vous dites trop cher, c'est par rapport à quoi ?" si déjà posé.
- Ne répète PAS la même proposition de RDV/échange formulée pareil.
Chaque message doit FAIRE AVANCER la conversation : nouvel angle, nouvelle info concrète, ou prise de congé polie si le prospect ne répond plus.
Si tu as déjà tout dit et que le prospect reste silencieux ou campe sur sa position, fais un message TRÈS court et différent (relance légère ou ouverture pour plus tard), pas un énième pavé identique.`

  const followUpBlock = params.isFollowUp
    ? `\n=== CONTEXTE RELANCE ===
Le prospect n'a PAS répondu à ta dernière réponse. C'est une relance, pas une nouvelle objection à traiter.
Sois bref (2-3 lignes), change d'angle, ne reformule pas ton argumentaire précédent. Une seule question simple ou une ouverture pour rester en contact.`
    : ''

  // Un RDV est DÉJÀ posé → interdiction de re-proposer / de promettre un appel immédiat.
  const existingRdvBlock = params.existingRdvSlot
    ? `\n=== RDV DÉJÀ CALÉ (NE RIEN RE-PROPOSER) ===
Un rendez-vous est DÉJÀ fixé avec ce prospect : ${params.existingRdvSlot}. Un humain (Gabin) le rappellera à ce créneau.
Réponds en UNE ou DEUX phrases MAX. Confirme simplement que Gabin le rappelle ${params.existingRdvSlot}${params.contactPhone ? ` au ${params.contactPhone}` : ''}. RIEN d'autre.
NE propose PAS d'autre créneau, NE ré-explique PAS l'offre, NE dis PAS "je vous appelle maintenant/tout de suite", NE demande PAS s'il a répondu à un appel.
Si le prospect dit juste "oui/ok/merci/d'accord", un mot de politesse suffit (ex: "Parfait, à ${params.existingRdvSlot}.").`
    : ''

  const userPrompt = `Context :
- Classification : ${params.classification}
- Entreprise : ${params.contactCompany}, ${params.contactCity}
- Métier du prospect : ${params.contactSector || 'artisan BtP'} (ADAPTE tout le vocabulaire à ce métier, ne parle pas de toiture si ce n'est pas un couvreur)
- Prénom prospect : ${params.contactName}
- Historique de conversation (du plus ancien au plus récent) :
${historyBlock}
${antiRepeatBlock}${followUpBlock}${existingRdvBlock}

Email original envoyé :
${params.originalEmailBody}

Réponse reçue :
${params.replyBody}
${slotBlock}
${learnedBlock}

${buildStrategyGuidance(params.classification)}

Rédige la réponse. JSON uniquement :
{"body": "..."}`

  // Signature dynamique : la boîte qui suit la conversation (pas l'adresse hardcodée).
  const system = params.fromEmail
    ? SYSTEM_PROMPT.replace(/gabin@hdigiweb-agence\.com/g, params.fromEmail)
    : SYSTEM_PROMPT

  // ⚠️ RÈGLE ABSOLUE : cette fonction ne DOIT JAMAIS jeter. Un hoquet Gemini (vide, 429,
  // timeout) tuait tout processReply → aucun brouillon → le lead CHAUD (qui a donné son
  // numéro !) était perdu EN SILENCE, définitivement (le message entrant est dédupé, jamais
  // réessayé). On enveloppe tout : à la moindre défaillance IA, on renvoie un repli DÉTERMINISTE
  // de qualité (confirmation d'appel si un créneau est posé), pour qu'une réponse parte TOUJOURS.
  try {
    const text = await generateText({ system, prompt: userPrompt, maxTokens: 1200, temperature: 0.8 })
    const parsed = extractJson<{ body: string }>(text)
    if (!parsed?.body || parsed.body.trim().length < 10) throw new Error('Gemini reply body empty/court')
    return fixSig(cleanEmailText(parsed.body))
  } catch (err) {
    console.error('[generator] génération IA échouée → repli déterministe:', String(err).slice(0, 120))
    return fixSig(cleanEmailText(buildFallbackReply(params)))
  }
}

// Repli DÉTERMINISTE (zéro IA) — garantit qu'une réponse part même si Gemini est indisponible.
// Priorité au lead chaud : si un créneau d'appel est posé, on le CONFIRME clairement (avec le
// numéro s'il l'a donné). Sinon, réponse d'accroche courte qui garde la porte ouverte.
function buildFallbackReply(params: {
  classification: ReplyClassification
  contactName: string
  proposedSlot?: string
  contactPhone?: string
  existingRdvSlot?: string
  fromEmail?: string
}): string {
  const name = (params.contactName && params.contactName.includes('@')) ? '' : (params.contactName || '')
  const greeting = name ? `Bonjour ${name},` : 'Bonjour,'
  const box = params.fromEmail || 'gabin@hdigiweb-agence.com'
  const sig = `Bien à vous,\n\nGabin\nHdigiweb\n${box}`
  const slot = params.existingRdvSlot || params.proposedSlot
  const phone = params.contactPhone ? ` au ${params.contactPhone}` : ''

  if (slot) {
    // Lead chaud, créneau posé → on confirme l'appel. Ne jamais prétendre appeler "maintenant".
    return `${greeting}\n\nParfait, Gabin vous rappelle ${slot}${phone}. Si ce moment ne vous convient pas, dites-moi simplement un autre créneau et je m'adapte.\n\n${sig}`
  }
  if (params.classification === 'rdv_request' || params.classification === 'interest') {
    return `${greeting}\n\nAvec plaisir. Pour caler un rappel rapide, quel moment vous arrange le mieux, plutôt en début ou en fin de semaine ? Gabin vous rappelle${phone || ' au numéro de votre choix'} pour en parler quelques minutes.\n\n${sig}`
  }
  return `${greeting}\n\nMerci pour votre retour. Dites-moi ce qui vous serait utile et je reviens vers vous rapidement avec une réponse précise.\n\n${sig}`
}
