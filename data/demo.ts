import { Lead, RdvEvent, AgentConfig } from '@/types'

export const DEMO_LEADS: Lead[] = [
  {
    id: 'l1',
    company: 'Couverture Martineau',
    contact: 'Sébastien Martineau',
    firstName: 'Sébastien',
    email: 's.martineau@couverture-martineau.fr',
    phone: '06 12 34 56 78',
    city: 'Lyon',
    website: 'www.couverture-martineau.fr',
    googleRating: 4.6,
    googleReviews: 47,
    specialty: ['rénovation', 'zinguerie'],
    hasGoogleAds: true,
    hasWebsite: true,
    stage: 'rdv_booked',
    createdAt: '2025-04-22T08:00:00',
    lastActivityAt: '2025-04-25T14:30:00',
    rdvDate: '2025-05-02',
    rdvConfirmedAt: '2025-04-25T14:30:00',
    thread: [
      {
        id: 'm1',
        author: 'agent',
        subject: 'Plus de chantiers pour Couverture Martineau ?',
        body: `Bonjour Sébastien,

J'ai vu que Couverture Martineau est bien noté sur Google à Lyon — 4,6/5 pour 47 avis, c'est une vraie réputation. Ça se voit que le travail est sérieux.

Ce que je voulais vous demander : est-ce que le planning est aussi plein qu'il devrait l'être, ou il y a encore de la place pour des chantiers supplémentaires ?

On travaille avec des artisans couvreurs pour générer des demandes en continu — sans passer par des plateformes qui prennent leur commission ou dépendre uniquement du bouche-à-oreille.

Ça vaut le coup qu'on en parle 15 minutes ?

Thomas`,
        sentAt: '2025-04-22T09:15:00',
        openedAt: '2025-04-22T14:02:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm2',
        author: 'lead',
        subject: 'Re: Plus de chantiers pour Couverture Martineau ?',
        body: `Bonjour Thomas,

Oui ça m'intéresse effectivement. On a du travail mais on cherche toujours à développer — surtout sur la zinguerie où on a de la capacité.

Comment ça fonctionne exactement ? Et c'est quoi le modèle ?`,
        sentAt: '2025-04-23T08:45:00',
      },
      {
        id: 'm3',
        author: 'agent',
        subject: 'Re: Plus de chantiers pour Couverture Martineau ?',
        body: `Sébastien,

Merci pour votre retour, c'est exactement le profil pour qui ça fonctionne bien.

En pratique : on identifie des propriétaires dans votre zone qui ont un projet toiture dans les prochains mois, on les contacte pour vous, et on vous envoie des demandes qualifiées — des gens qui attendent votre appel. Pas de commission sur les chantiers signés, vous payez un forfait mensuel fixe.

Sur la zinguerie en particulier, on a de bons résultats sur Lyon et le Rhône.

Je vous propose un appel de 20 minutes cette semaine pour vous montrer concrètement. Jeudi ou vendredi, ça vous va ?`,
        sentAt: '2025-04-23T10:20:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
      {
        id: 'm4',
        author: 'lead',
        subject: 'Re: Plus de chantiers pour Couverture Martineau ?',
        body: `Ok je suis dispo jeudi 14h si c'est bon pour vous. Mon numéro c'est le 06 12 34 56 78.`,
        sentAt: '2025-04-25T14:28:00',
      },
      {
        id: 'm5',
        author: 'agent',
        subject: 'RDV confirmé — Jeudi 2 mai à 14h',
        body: `Parfait Sébastien,

Je vous rappelle jeudi 2 mai à 14h au 06 12 34 56 78.

Je vous envoie également un récapitulatif par mail avec quelques éléments pour préparer l'appel.

À jeudi,
Thomas`,
        sentAt: '2025-04-25T14:35:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },
  {
    id: 'l2',
    company: 'Bernard Couverture',
    contact: 'Thierry Bernard',
    firstName: 'Thierry',
    email: 'tbernard@bernard-couverture.fr',
    phone: '06 45 67 89 01',
    city: 'Bordeaux',
    website: 'www.bernard-couverture.fr',
    googleRating: 4.4,
    googleReviews: 58,
    specialty: ['ardoise', 'zinguerie', 'charpente'],
    hasGoogleAds: true,
    hasWebsite: true,
    stage: 'follow_up_2',
    createdAt: '2025-04-20T08:00:00',
    lastActivityAt: '2025-04-25T09:00:00',
    nextScheduledAt: '2025-04-30T09:00:00',
    thread: [
      {
        id: 'm6',
        author: 'agent',
        subject: 'Remplir le planning de Bernard Couverture',
        body: `Bonjour Thierry,

Je vois que Bernard Couverture est actif sur Google Ads à Bordeaux — bonne démarche. La question c'est si le retour sur investissement est là.

Avec 10 à 20 personnes en équipe, vous avez clairement la capacité de gérer plus de volume. Le problème c'est souvent de générer assez de demandes qualifiées en continu, sans dépendre des plateformes.

On a mis en place un système pour des couvreurs dans votre situation — des demandes entrantes directes, pas de commission par chantier signé.

Disponible pour un appel rapide cette semaine ?

Thomas`,
        sentAt: '2025-04-20T09:00:00',
        openedAt: '2025-04-20T16:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm7',
        author: 'agent',
        subject: 'Re: Bernard Couverture',
        body: `Thierry,

Je reviens vers vous — je voulais savoir si mon message de lundi avait retenu votre attention.

Si le timing n'est pas bon, pas de problème, dites-le moi. Sinon je peux vous montrer quelques résultats concrets sur des couvreurs en Nouvelle-Aquitaine.

Thomas`,
        sentAt: '2025-04-22T09:00:00',
        openedAt: '2025-04-22T11:15:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
      {
        id: 'm8',
        author: 'agent',
        subject: 'Dernière question — Bernard Couverture',
        body: `Thierry,

Je passe une dernière fois.

Je comprends que vous êtes probablement sollicité régulièrement. Ce que je peux vous proposer c'est juste 15 minutes pour que vous voyiez si c'est pertinent pour vous — et si ça ne l'est pas, je ne vous recontacte plus.

La seule question : est-ce que générer plus de chantiers sans dépendre des plateformes c'est quelque chose qui vous intéresse en ce moment, oui ou non ?

Thomas`,
        sentAt: '2025-04-25T09:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_2',
      },
    ],
  },
  {
    id: 'l3',
    company: 'Toiture Durand & Fils',
    contact: 'Patrick Durand',
    firstName: 'Patrick',
    email: 'contact@toiture-durand.com',
    city: 'Marseille',
    website: 'www.toiture-durand.com',
    googleRating: 4.2,
    googleReviews: 31,
    specialty: ['tuile', 'ardoise', 'rénovation'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'replied',
    createdAt: '2025-04-21T08:00:00',
    lastActivityAt: '2025-04-24T16:00:00',
    thread: [
      {
        id: 'm9',
        author: 'agent',
        subject: 'Toiture Durand — chantiers à Marseille',
        body: `Bonjour Patrick,

Toiture Durand & Fils est bien positionné à Marseille — j'ai vu vos avis Google, la clientèle semble satisfaite. Sur la tuile et l'ardoise, il y a clairement de la demande dans la région.

Ce que je voulais vous proposer : un système pour capter cette demande directement, sans passer par des agrégateurs qui gèrent mal la qualité des leads.

Ça vous intéresse qu'on en parle rapidement ?

Thomas`,
        sentAt: '2025-04-21T09:30:00',
        openedAt: '2025-04-21T12:00:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm10',
        author: 'lead',
        subject: 'Re: Toiture Durand — chantiers à Marseille',
        body: `Bonjour Thomas,

On travaille déjà avec une agence pour notre marketing, donc on n'a pas vraiment besoin d'un service supplémentaire pour l'instant.

Merci quand même.

Patrick`,
        sentAt: '2025-04-23T10:00:00',
      },
      {
        id: 'm11',
        author: 'agent',
        subject: 'Re: Toiture Durand — chantiers à Marseille',
        body: `Bonjour Patrick,

Merci pour votre honnêteté, je comprends tout à fait.

Si un jour la situation évolue — ou si vous voulez comparer les résultats — n'hésitez pas à me revenir. Je ne vous recontacte pas de mon côté.

Bonne continuation,
Thomas`,
        sentAt: '2025-04-24T16:00:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },
]

export const DEMO_RDV: RdvEvent[] = [
  {
    id: 'rdv1',
    leadId: 'l1',
    company: 'Couverture Martineau',
    contact: 'Sébastien Martineau',
    date: '2025-05-02',
    time: '14:00',
    duration: 20,
    detectedFrom: 'Ok je suis dispo jeudi 14h si c\'est bon pour vous.',
    confirmedByAgent: true,
    clientNotified: true,
    phone: '06 12 34 56 78',
  },
]

export const AGENT_CONFIG: AgentConfig = {
  persona: 'Commercial senior B2B, 12 ans d\'expérience dans les services aux artisans. Direct, sans jargon, focalisé sur les résultats concrets. Jamais agressif, toujours respectueux du temps du prospect. Sait traiter les objections avec calme et arguments factuels.',
  objective: 'Générer des rendez-vous qualifiés pour Selquia auprès de couvreurs français. Chaque lead doit recevoir un suivi personnalisé jusqu\'à réponse positive, négative, ou fin de séquence.',
  tone: 'Naturel, humain, direct. Pas de jargon marketing. Phrases courtes. Maximum 120 mots par email.',
  maxEmailsPerDay: 30,
  warmupEnabled: true,
  autoReplyEnabled: true,
  autoRdvEnabled: true,
  clientNotifEmail: 'thomas@selquia.fr',
}
