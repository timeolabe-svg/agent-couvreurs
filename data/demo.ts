import { Lead, RdvEvent, AgentConfig } from '@/types'

// Cible Hdigiweb : PME/TPE Toulouse & région Occitanie
// Signaux recherchés : pas de site, site obsolète, mauvais SEO, peu d'avis Google, pas de Google Ads

export const DEMO_LEADS: Lead[] = [
  {
    id: 'l1',
    company: 'Menuiserie Carpentier',
    contact: 'Laurent Carpentier',
    firstName: 'Laurent',
    email: 'l.carpentier.menuiserie@gmail.com',
    phone: '06 74 23 11 89',
    city: 'Toulouse',
    googleRating: 4.3,
    googleReviews: 18,
    specialty: ['menuiserie', 'pose de fenêtres', 'dressing sur mesure'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'rdv_booked',
    createdAt: '2025-04-22T08:00:00',
    lastActivityAt: '2025-04-25T15:10:00',
    rdvDate: '2025-05-02',
    rdvConfirmedAt: '2025-04-25T15:10:00',
    notes: 'Audit digital : pas de site web. Fiche GMB existante avec 18 avis. Invisible sur "menuisier Toulouse" — position 0 en organique et 0 en Ads.',
    thread: [
      {
        id: 'm1',
        author: 'agent',
        subject: 'Menuiserie Carpentier — invisible sur Google',
        body: `Bonjour Laurent,

J'ai cherché "menuisier Toulouse" sur Google ce matin. Menuiserie Carpentier n'apparaît pas dans les résultats — ni en organique, ni dans Google Maps.

Pourtant vos 18 avis montrent que vous faites du bon travail. Le problème c'est que sans site web, vous êtes invisible pour tous les clients qui cherchent un menuisier en ligne. Et aujourd'hui, c'est la majorité.

On aide des artisans à Toulouse à se rendre visibles sur Google et à remplir leur agenda avec de nouveaux clients, sans dépendre du bouche-à-oreille.

15 minutes pour vous montrer ce que ça donnerait concrètement pour vous ?

Thomas — Hdigiweb`,
        sentAt: '2025-04-22T09:10:00',
        openedAt: '2025-04-22T12:45:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm2',
        author: 'lead',
        subject: 'Re: Menuiserie Carpentier — invisible sur Google',
        body: `Bonjour Thomas,

C'est vrai que j'ai jamais eu de site, je tourne principalement au bouche à oreille. Mais là j'aimerais bien avoir plus de clients réguliers.

C'est quoi exactement ce que vous proposez et quel budget ça représente ?`,
        sentAt: '2025-04-23T07:55:00',
      },
      {
        id: 'm3',
        author: 'agent',
        subject: 'Re: Menuiserie Carpentier — invisible sur Google',
        body: `Bonjour Laurent,

Merci pour votre réponse.

Ce qu'on ferait pour vous : un site professionnel optimisé pour Google (pour que vous apparaissiez quand quelqu'un cherche "menuisier Toulouse"), + on optimise votre fiche Google avec vos photos et vos services. Résultat : les gens vous trouvent et vous appellent directement.

Pour le budget, ça dépend de vos besoins — c'est justement pour ça que je préfère qu'on en parle 15 minutes plutôt que de vous envoyer un tarif qui ne correspondra peut-être pas.

Vous êtes disponible jeudi ou vendredi cette semaine ?

Thomas`,
        sentAt: '2025-04-23T10:30:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
      {
        id: 'm4',
        author: 'lead',
        subject: 'Re: Menuiserie Carpentier — invisible sur Google',
        body: `Ok jeudi ça me va, vers 14h30 si c'est possible. Mon 06 c'est le 06 74 23 11 89.`,
        sentAt: '2025-04-25T15:08:00',
      },
      {
        id: 'm5',
        author: 'agent',
        subject: 'RDV confirmé — Jeudi 2 mai à 14h30',
        body: `Parfait Laurent,

Je vous appelle jeudi 2 mai à 14h30 au 06 74 23 11 89.

Je prépare un audit rapide de votre visibilité Google d'ici là pour qu'on aille droit au but.

À jeudi,
Thomas — Hdigiweb`,
        sentAt: '2025-04-25T15:15:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  {
    id: 'l2',
    company: 'Salon Sublime Coiffure',
    contact: 'Isabelle Morin',
    firstName: 'Isabelle',
    email: 'salonsublimeltoulouse@gmail.com',
    city: 'Toulouse',
    website: 'www.salon-sublime-toulouse.fr',
    googleRating: 4.5,
    googleReviews: 34,
    specialty: ['coiffure', 'coloration', 'soins capillaires'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'follow_up_2',
    createdAt: '2025-04-20T08:00:00',
    lastActivityAt: '2025-04-25T09:15:00',
    nextScheduledAt: '2025-04-30T09:00:00',
    notes: 'Audit digital : site web de 2017, non adapté mobile (score PageSpeed 34/100), pas de Google Ads. Concurrent "Salon Elisa" en position 1 avec 128 avis. Manque à gagner énorme sur le trafic local.',
    thread: [
      {
        id: 'm6',
        author: 'agent',
        subject: 'Votre site perd des clientes chaque jour',
        body: `Bonjour Isabelle,

J'ai testé le site du Salon Sublime sur mobile — il met 9 secondes à charger et le menu est quasiment inutilisable sur téléphone. Or 80% de vos visiteuses consultent depuis leur smartphone.

Google pénalise les sites lents : c'est pourquoi quand on tape "salon coiffure Toulouse", vous apparaissez loin derrière des concurrentes qui ont moins d'avis que vous.

Vous avez 4,5/5 avec 34 avis — c'est votre meilleur argument commercial. On peut faire en sorte que les bonnes personnes le voient.

Disponible pour un échange rapide ?

Thomas — Hdigiweb`,
        sentAt: '2025-04-20T09:00:00',
        openedAt: '2025-04-20T19:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm7',
        author: 'agent',
        subject: 'Re: Salon Sublime',
        body: `Isabelle,

Je reviens rapidement — j'ai regardé les recherches locales cette semaine : "salon coiffure Toulouse" génère plus de 1 200 recherches par mois. Le Salon Elisa capte une bonne partie de ce trafic avec son site optimisé.

Vous avez les avis pour être en tête. Il manque juste la vitrine digitale qui va avec.

15 minutes cette semaine ?

Thomas`,
        sentAt: '2025-04-22T09:00:00',
        openedAt: '2025-04-22T12:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
      {
        id: 'm8',
        author: 'agent',
        subject: 'Derniere relance — Salon Sublime',
        body: `Isabelle,

Je ne veux pas vous relancer indéfiniment, donc c'est mon dernier message.

Si vous n'êtes pas prête à investir dans votre visibilité en ligne maintenant, je comprends tout à fait. Si la situation change, n'hésitez pas à me revenir.

En attendant, si vous voulez récupérer gratuitement l'audit de votre site que j'ai préparé, je vous l'envoie sur un mot de votre part.

Thomas — Hdigiweb`,
        sentAt: '2025-04-25T09:15:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_2',
      },
    ],
  },

  {
    id: 'l3',
    company: 'Brasserie Le Capitole',
    contact: 'Franck Devaux',
    firstName: 'Franck',
    email: 'contact@brasserie-lecapitole.fr',
    city: 'Toulouse',
    website: 'www.brasserie-lecapitole.fr',
    googleRating: 4.4,
    googleReviews: 89,
    specialty: ['restauration', 'brasserie', 'séminaires'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'replied',
    createdAt: '2025-04-21T08:00:00',
    lastActivityAt: '2025-04-24T14:00:00',
    notes: 'Audit : 89 avis Google (excellent), mais 0 Google Ads sur "brasserie Toulouse". Concurrent "Le Père Louis" capte tout le trafic payant. Site mobile OK mais pas optimisé SEO (pas de balises, temps de chargement 5s).',
    thread: [
      {
        id: 'm9',
        author: 'agent',
        subject: 'Brasserie Le Capitole — vos concurrents captent vos clients',
        body: `Bonjour Franck,

Vous avez 89 avis Google à 4,4/5 — c'est une réputation solide. Mais quand je tape "brasserie Toulouse" sur Google, vous n'apparaissez pas dans les trois premières annonces. "Le Père Louis" et deux autres brasseries avec deux fois moins d'avis que vous captent tout ce trafic.

Le problème : ils font de la pub Google, vous non. Ces clients-là auraient très bien pu choisir votre établissement.

On s'occupe de Google Ads pour des restaurants à Toulouse. Les résultats arrivent en 2-3 semaines.

Ça vaut le coup qu'on en parle ?

Thomas — Hdigiweb`,
        sentAt: '2025-04-21T09:45:00',
        openedAt: '2025-04-21T13:10:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm10',
        author: 'lead',
        subject: 'Re: Brasserie Le Capitole — vos concurrents captent vos clients',
        body: `Bonjour Thomas,

On travaille déjà avec quelqu'un pour notre communication. Donc là on n'a pas vraiment besoin d'un prestataire supplémentaire.

Franck`,
        sentAt: '2025-04-23T11:30:00',
      },
      {
        id: 'm11',
        author: 'agent',
        subject: 'Re: Brasserie Le Capitole',
        body: `Bonjour Franck,

Je comprends, et je ne veux pas vous compliquer la vie avec un interlocuteur de plus.

Juste une question directe : est-ce que votre prestataire actuel gère vos campagnes Google Ads ? Parce que si ce n'est pas le cas, vous laissez du chiffre d'affaires sur la table chaque semaine — et je peux vous montrer exactement combien en 10 minutes.

Si c'est déjà couvert, pas de souci, je ne vous recontacte pas.

Thomas — Hdigiweb`,
        sentAt: '2025-04-24T14:00:00',
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
    company: 'Menuiserie Carpentier',
    contact: 'Laurent Carpentier',
    date: '2025-05-02',
    time: '14:30',
    duration: 20,
    detectedFrom: 'Ok jeudi ça me va, vers 14h30 si c\'est possible.',
    confirmedByAgent: true,
    clientNotified: true,
    phone: '06 74 23 11 89',
  },
]

export const AGENT_CONFIG: AgentConfig = {
  persona: `Commercial senior B2B, spécialisé services digitaux pour PME/TPE. Connait parfaitement les problèmes de visibilité en ligne des petits business français. Direct, chiffres à l'appui, jamais agressif. Fait un audit rapide avant chaque prise de contact pour personnaliser au maximum. Représente Hdigiweb — agence web Toulouse.`,
  objective: `Générer des rendez-vous qualifiés pour Hdigiweb auprès de PME/TPE en Occitanie qui ont un problème de visibilité digitale : pas de site, site obsolète, mauvais SEO, peu d'avis Google, absence sur Google Ads. Chaque email doit citer un signal précis observé sur le business ciblé.`,
  tone: `Audit-based : chaque email cite un fait observé (score PageSpeed, position Google, nombre d'avis, présence concurrents). Ton direct, humain. Pas de jargon. 80-120 mots. Donne l'impression que l'agent a vraiment regardé leur business avant d'écrire.`,
  maxEmailsPerDay: 30,
  warmupEnabled: true,
  autoReplyEnabled: true,
  autoRdvEnabled: true,
  clientNotifEmail: 'contact@hdigiweb.com',
}

// Critères de ciblage pour sourcer des leads Hdigiweb
export const TARGETING_SIGNALS = [
  {
    signal: 'Pas de site web',
    description: 'Fiche GMB existante mais aucun site associé',
    services: ['Création site vitrine', 'SEO local'],
    priority: 'haute',
  },
  {
    signal: 'Site non mobile-friendly',
    description: 'Score PageSpeed mobile < 50/100',
    services: ['Refonte site', 'Optimisation performance'],
    priority: 'haute',
  },
  {
    signal: 'Mauvais positionnement SEO',
    description: 'Absent des 3 premiers résultats sur leur mot-clé principal',
    services: ['SEO', 'Google Ads'],
    priority: 'haute',
  },
  {
    signal: 'Peu d\'avis Google',
    description: 'Moins de 20 avis alors que les concurrents en ont 50+',
    services: ['Gestion fiche Google', 'Stratégie avis'],
    priority: 'moyenne',
  },
  {
    signal: 'Absence Google Ads',
    description: 'Concurrents visibles en annonces, eux non',
    services: ['Google Ads', 'Local Service Ads'],
    priority: 'haute',
  },
  {
    signal: 'GMB incomplète',
    description: 'Fiche Google sans photos, horaires ou description',
    services: ['Gestion fiche Google', 'Community management'],
    priority: 'moyenne',
  },
]
