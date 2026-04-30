import { Lead, RdvEvent, AgentConfig } from '@/types'

export const DEMO_LEADS: Lead[] = [
  // ── RDV CONFIRMÉS ─────────────────────────────────────────────────────────
  {
    id: 'l1',
    company: 'Menuiserie Carpentier',
    contact: 'Laurent Carpentier',
    firstName: 'Laurent',
    email: 'l.carpentier@gmail.com',
    phone: '06 74 23 11 89',
    city: 'Toulouse',
    googleRating: 4.3,
    googleReviews: 18,
    specialty: ['menuiserie', 'pose de fenêtres', 'dressing sur mesure'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'rdv_booked',
    createdAt: '2026-04-25T08:00:00',
    lastActivityAt: '2026-04-29T15:10:00',
    rdvDate: '2026-05-04',
    rdvConfirmedAt: '2026-04-29T15:10:00',
    notes: 'Aucun site web. GMB existante, 18 avis, mais invisible sur "menuisier Toulouse" — absent en organique et Ads. Concurrent direct : Menuiserie Bonnard (43 avis, site complet).',
    thread: [
      {
        id: 'm1',
        author: 'agent',
        subject: 'Menuiserie Carpentier invisible sur "menuisier Toulouse"',
        body: `Bonjour Laurent,

J'ai tapé "menuisier Toulouse nord" ce matin. Position 1 : Menuiserie Bonnard — 43 avis, site vitrine complet avec galerie photos et formulaire de devis. Position 2 : Atelier du Bois — 29 avis.

Vous n'apparaissez nulle part.

Pourtant votre fiche Google existe et vos 18 avis parlent d'eux-mêmes ("travail soigné", "délai respecté"). Le problème : sans site web, Google ne peut pas vous indexer correctement et vous perdez tous les clients qui cherchent un menuisier en ligne — soit la majorité depuis 2021.

"Menuisier Toulouse" génère environ 1 400 recherches par mois. Vous captez 0 de ce trafic.

15 minutes pour vous montrer ce que ça changerait concrètement ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-25T09:10:00',
        openedAt: '2026-04-25T12:45:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm2',
        author: 'lead',
        subject: 'Re: Menuiserie Carpentier invisible sur "menuisier Toulouse"',
        body: `Bonjour Thomas,

C'est vrai que j'ai jamais eu de site, je tourne principalement au bouche à oreille. Mais là j'aimerais bien avoir plus de clients réguliers.

C'est quoi exactement ce que vous proposez et quel budget ça représente ?`,
        sentAt: '2026-04-26T07:55:00',
      },
      {
        id: 'm3',
        author: 'agent',
        subject: 'Re: Menuiserie Carpentier invisible sur "menuisier Toulouse"',
        body: `Bonjour Laurent,

Concret : on crée un site professionnel avec vos réalisations, vos services, et un formulaire de devis — optimisé pour apparaître sur "menuisier Toulouse" et les variantes locales. On optimise aussi votre fiche Google pour que vous remontiez dans Google Maps.

Resultat typique pour un artisan : 3 à 8 demandes de devis supplémentaires par mois les 60 premiers jours.

Pour le budget, ça dépend de ce qu'on met en place — c'est justement pour ça que je préfère qu'on en parle 15 minutes plutôt que de vous envoyer un tarif qui ne correspond pas à votre situation.

Vous êtes disponible jeudi ou vendredi ?

Thomas`,
        sentAt: '2026-04-26T10:30:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
      {
        id: 'm4',
        author: 'lead',
        subject: 'Re: Menuiserie Carpentier',
        body: `Ok jeudi ça me va, vers 14h30 si c'est possible. Mon 06 c'est le 06 74 23 11 89.`,
        sentAt: '2026-04-29T15:08:00',
      },
      {
        id: 'm5',
        author: 'agent',
        subject: 'RDV confirmé — Lundi 4 mai à 14h30',
        body: `Parfait Laurent,

Je vous appelle lundi 4 mai à 14h30 au 06 74 23 11 89.

Je prépare un audit complet de votre visibilité Google d'ici là — positionnement de vos concurrents, volume de recherches sur votre zone, ce que ça représente en CA potentiel — pour qu'on aille droit au but.

À lundi,
Thomas — Hdigiweb`,
        sentAt: '2026-04-29T15:15:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  {
    id: 'l8',
    company: 'Institut Beauté Éléonore',
    contact: 'Éléonore Vidal',
    firstName: 'Éléonore',
    email: 'contact@institut-eleonore.fr',
    phone: '05 61 42 87 03',
    city: 'Tournefeuille',
    website: 'www.institut-eleonore.fr',
    googleRating: 4.8,
    googleReviews: 62,
    specialty: ['soins du visage', 'épilation', 'manucure'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'rdv_booked',
    createdAt: '2026-04-26T08:00:00',
    lastActivityAt: '2026-04-29T11:30:00',
    rdvDate: '2026-05-06',
    rdvConfirmedAt: '2026-04-29T11:30:00',
    notes: 'Site existant mais 0 Google Ads. Concurrent "Institut Zen" (Tournefeuille) en position 1 sur "institut beauté Tournefeuille" via Ads. Éléonore a 4.8/5 — meilleure note du secteur mais invisible en annonces.',
    thread: [
      {
        id: 'm801',
        author: 'agent',
        subject: '"Institut beauté Tournefeuille" — vous êtes derrière Institut Zen',
        body: `Bonjour Éléonore,

J'ai cherché "institut beauté Tournefeuille" sur Google. Première annonce : Institut Zen. Juste en dessous : Cœur de Soins. Vous n'apparaissez dans aucune annonce.

Ce qui me frappe : vous avez 4,8/5 avec 62 avis — la meilleure note du secteur sur Tournefeuille. Institut Zen en a 31. Mais il capte quand même tout le trafic payant parce qu'il fait de la pub Google, vous non.

Chaque semaine que vous n'êtes pas en annonces, ce sont des clientes qui vont chez eux alors qu'elles auraient largement préféré votre établissement.

Ça vaut le coup qu'on en parle 15 minutes ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-14T09:30:00',
        openedAt: '2026-04-14T14:12:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm802',
        author: 'lead',
        subject: 'Re: "Institut beauté Tournefeuille"',
        body: `Bonjour Thomas, oui ça m'intéresse. Je peux vendredi matin vers 10h ? Vous pouvez m'appeler au 05 61 42 87 03.`,
        sentAt: '2026-04-15T08:45:00',
      },
      {
        id: 'm803',
        author: 'agent',
        subject: 'RDV confirmé — Lundi 28 avril à 10h00',
        body: `Bonjour Éléonore,

Je vous appelle lundi 28 avril à 10h au 05 61 42 87 03.

Je prépare un audit Google Ads de votre secteur d'ici là — volume de recherches sur "institut beauté Tournefeuille" et variantes, budget estimé pour être en position 1, retour sur investissement projeté.

À lundi,
Thomas — Hdigiweb`,
        sentAt: '2026-04-18T11:30:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  // ── RÉPONSE REÇUE ─────────────────────────────────────────────────────────
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
    createdAt: '2026-04-27T08:00:00',
    lastActivityAt: '2026-04-29T14:00:00',
    notes: '89 avis Google 4,4/5. 0 Google Ads sur "brasserie Toulouse". "Le Père Louis" capte tout le trafic payant sur ce mot-clé. Site mobile OK mais SEO faible (pas de balises H1 propres, temps de chargement 5,2s).',
    thread: [
      {
        id: 'm9',
        author: 'agent',
        subject: 'Brasserie Toulouse — Le Père Louis capte vos clients',
        body: `Bonjour Franck,

J'ai tapé "brasserie Toulouse centre" sur Google. Les 3 premières annonces : Le Père Louis, Brasserie du Grand Rond, Chez Émile. Vous n'en faites pas partie — et pourtant vous avez 89 avis à 4,4/5, contre 67 pour Le Père Louis.

Chaque semaine, des clients potentiels qui tapent "brasserie Toulouse" cliquent sur ces annonces avant même d'avoir eu la chance de vous voir.

"Brasserie Toulouse" et ses variantes génèrent environ 2 200 recherches par mois. Sans Google Ads, vous ne captez aucun de ce trafic payant.

Ça mérite 10 minutes d'échange, non ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-17T09:45:00',
        openedAt: '2026-04-17T13:10:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm10',
        author: 'lead',
        subject: 'Re: Brasserie Toulouse',
        body: `Bonjour Thomas,

On travaille déjà avec quelqu'un pour notre communication. Donc là on n'a pas vraiment besoin d'un prestataire supplémentaire.

Franck`,
        sentAt: '2026-04-19T11:30:00',
      },
      {
        id: 'm11',
        author: 'agent',
        subject: 'Re: Brasserie Le Capitole',
        body: `Bonjour Franck,

Je comprends, et je ne veux pas rajouter un interlocuteur de plus si tout est couvert.

Juste une question directe : est-ce que votre prestataire actuel gère vos campagnes Google Ads ? Parce que sur "brasserie Toulouse", Le Père Louis est en position 1 en annonces payantes et vous n'y apparaissez pas — si ce n'est pas couvert, vous laissez entre 15 et 30 clients par semaine aller chez un concurrent.

Si c'est déjà géré, aucun problème — je ne vous recontacte pas.

Thomas — Hdigiweb`,
        sentAt: '2026-04-20T14:00:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  // ── RELANCE 2 ─────────────────────────────────────────────────────────────
  {
    id: 'l2',
    company: 'Salon Sublime Coiffure',
    contact: 'Isabelle Morin',
    firstName: 'Isabelle',
    email: 'salonsublime.toulouse@gmail.com',
    city: 'Toulouse',
    website: 'www.salon-sublime-toulouse.fr',
    googleRating: 4.5,
    googleReviews: 34,
    specialty: ['coiffure', 'coloration', 'soins capillaires'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'follow_up_2',
    createdAt: '2026-04-25T08:00:00',
    lastActivityAt: '2026-04-28T09:15:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Site de 2017, score PageSpeed mobile 34/100. Concurrent Salon L\'Éclat (rue Alsace-Lorraine) : score 91/100, 128 avis Google. Manque à gagner estimé : 8-12 nouveaux clients/mois.',
    thread: [
      {
        id: 'm6',
        author: 'agent',
        subject: 'Salon Sublime — votre site charge en 11s sur mobile',
        body: `Bonjour Isabelle,

J'ai testé salon-sublime-toulouse.fr sur iPhone en 4G. Il charge en 11 secondes — c'est 5 fois trop lent selon les standards Google. Votre score PageSpeed mobile est à 34/100.

Le Salon L'Éclat (Alsace-Lorraine) charge en 2,3 secondes — score 91/100. C'est lui qui capte les 1 400 recherches mensuelles sur "salon coiffure Toulouse centre".

Vous avez 4,5/5 avec 34 avis — mieux que lui. Mais Google positionne les sites rapides en priorité, pas les meilleurs. Résultat : des clientes qui auraient choisi votre salon finissent chez eux.

Disponible pour un échange rapide cette semaine ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-15T09:00:00',
        openedAt: '2026-04-15T19:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm7',
        author: 'agent',
        subject: 'Salon Sublime — 1 400 recherches par mois, 0 pour vous',
        body: `Isabelle,

Je reviens rapidement.

J'ai regardé les données de recherche cette semaine : "salon coiffure Toulouse" génère 1 400 requêtes par mois. "Coiffeur Toulouse centre" : 890 de plus. Le Salon L'Éclat capte une large partie grâce à son site rapide et sa fiche Google complète.

Vous avez les avis pour être en tête de ces résultats. Il manque la vitrine technique qui va avec.

15 minutes cette semaine ?

Thomas`,
        sentAt: '2026-04-18T09:00:00',
        openedAt: '2026-04-18T12:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
      {
        id: 'm8',
        author: 'agent',
        subject: 'Salon Sublime — audit offert, dernière relance',
        body: `Isabelle,

C'est mon dernier message, je ne veux pas vous relancer indéfiniment.

Si le timing n'est pas bon, je comprends tout à fait. Si ça change, n'hésitez pas.

Une dernière chose : j'ai préparé un audit complet de votre visibilité (score détaillé, positionnement concurrent, estimation du manque à gagner mensuel). Si vous voulez le récupérer gratuitement, un mot suffit — aucune obligation derrière.

Thomas — Hdigiweb`,
        sentAt: '2026-04-22T09:15:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_2',
      },
    ],
  },

  {
    id: 'l7',
    company: 'Cabinet Ostéopathie Renard',
    contact: 'Baptiste Renard',
    firstName: 'Baptiste',
    email: 'b.renard.osteo@gmail.com',
    city: 'Toulouse',
    googleRating: 4.9,
    googleReviews: 27,
    specialty: ['ostéopathie', 'kinésithérapie', 'santé'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'follow_up_1',
    createdAt: '2026-04-26T08:00:00',
    lastActivityAt: '2026-04-28T09:00:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Pas de site web. GMB avec 27 avis 4.9/5. Doctolib seul canal d\'acquisition visible. Concurrent "Ostéo Toulouse Centre" (12 avis seulement) a un site bien référencé et capte les recherches directes.',
    thread: [
      {
        id: 'm701',
        author: 'agent',
        subject: '"Ostéopathe Toulouse" — vous n\'apparaissez pas',
        body: `Bonjour Baptiste,

J'ai cherché "ostéopathe Toulouse Capitole" sur Google. Résultats organiques : 3 cabinets avec des sites complets, dont Ostéo Toulouse Centre — 12 avis seulement, mais un site bien référencé qui lui ramène des patients régulièrement.

Vous avez 27 avis à 4,9/5. C'est la note la plus élevée de votre zone — mais sans site web, Google ne peut pas vous faire remonter en résultats organiques. Doctolib vous donne de la visibilité, mais vous ne maîtrisez pas ce canal et vous payez pour chaque nouveau patient.

Un site vous permettrait de capter ces recherches directement, sans intermédiaire.

Vous avez 15 minutes cette semaine ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-20T09:30:00',
        openedAt: '2026-04-21T08:15:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm702',
        author: 'agent',
        subject: 'Ostéopathie Renard — relance rapide',
        body: `Baptiste,

Je reviens brièvement.

"Ostéopathe Toulouse" génère environ 800 recherches par mois — des patients qui cherchent activement un praticien. Avec votre note de 4,9/5, un site optimisé vous placerait en bonne position sur ces recherches.

Vous seriez disponible 15 minutes cette semaine ou la suivante ?

Thomas`,
        sentAt: '2026-04-23T09:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
    ],
  },

  // ── CONTACTÉ (email initial envoyé) ───────────────────────────────────────
  {
    id: 'l4',
    company: 'Plomberie Roussel',
    contact: 'Marc Roussel',
    firstName: 'Marc',
    email: 'm.roussel.plomberie@gmail.com',
    phone: '06 12 34 56 78',
    city: 'Toulouse',
    googleRating: 4.1,
    googleReviews: 9,
    specialty: ['plomberie', 'chauffage', 'dépannage'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'contacted',
    createdAt: '2026-04-28T08:00:00',
    lastActivityAt: '2026-04-28T09:05:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Aucun site web, GMB avec seulement 9 avis. "Plombier Toulouse urgence" : concurrent Plomberie Express en position 1 (51 avis, site complet, Google Ads actifs).',
    thread: [
      {
        id: 'm401',
        author: 'agent',
        subject: '"Plombier Toulouse urgence" — vous n\'apparaissez pas',
        body: `Bonjour Marc,

J'ai tapé "plombier Toulouse urgence" — la requête la plus rentable dans votre secteur, environ 1 800 recherches par mois.

Position 1 en annonce : Plomberie Express (51 avis, site complet avec formulaire urgence 24h). Position 1 en organique : même profil. Vous n'apparaissez nulle part.

Vos 9 avis Google existent, mais sans site web, Google ne peut pas vous proposer aux clients qui cherchent un plombier maintenant. Chaque appel d'urgence qui ne vous arrive pas, c'est 200 à 600 € qui vont chez un concurrent.

15 minutes pour vous montrer ce qui est faisable rapidement ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-25T09:05:00',
        openedAt: '2026-04-25T11:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
    ],
  },

  {
    id: 'l5',
    company: 'Auto École Horizon',
    contact: 'Stéphane Garnier',
    firstName: 'Stéphane',
    email: 'contact@autoecole-horizon.fr',
    city: 'Blagnac',
    website: 'www.autoecole-horizon.fr',
    googleRating: 4.2,
    googleReviews: 41,
    specialty: ['auto-école', 'permis B', 'permis moto'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'contacted',
    createdAt: '2026-04-29T08:00:00',
    lastActivityAt: '2026-04-29T09:30:00',
    nextScheduledAt: '2026-05-01T09:00:00',
    notes: 'Site existant mais pas de Google Ads. "Auto école Blagnac" : concurrent Auto École de la Paix en position 1 via Ads. Score PageSpeed 58/100. Forte saisonnalité : pic de demandes avril-juillet.',
    thread: [
      {
        id: 'm501',
        author: 'agent',
        subject: 'Auto École Horizon — vos concurrents captent vos inscriptions',
        body: `Bonjour Stéphane,

J'ai recherché "auto école Blagnac" ce matin. Les 2 premières annonces : Auto École de la Paix et Centre de Conduite Occitanie. Auto École Horizon n'apparaît pas en annonces.

On est en plein pic de saison — avril à juillet, c'est quand les familles inscrivent leurs enfants pour le permis. "Auto école Blagnac" génère environ 320 recherches par mois en ce moment, contre 180 en hiver. Ne pas être en position 1 pendant cette période, c'est laisser les inscriptions les plus faciles à vos concurrents.

Vous avez 41 avis à 4,2/5 — vous méritez d'être en tête.

10 minutes pour en parler ?

Thomas — Hdigiweb`,
        sentAt: '2026-04-25T09:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
    ],
  },

  // ── NON INTÉRESSÉ ────────────────────────────────────────────────────────
  {
    id: 'l6',
    company: 'Pharmacie des Carmes',
    contact: 'Dr. Anne Lefebvre',
    firstName: 'Anne',
    email: 'pharmacie.descarmes@gmail.com',
    city: 'Toulouse',
    website: 'www.pharmacie-descarmes.fr',
    googleRating: 4.6,
    googleReviews: 156,
    specialty: ['pharmacie', 'parapharmacie', 'conseil santé'],
    hasGoogleAds: true,
    hasWebsite: true,
    stage: 'not_interested',
    createdAt: '2026-04-27T08:00:00',
    lastActivityAt: '2026-04-27T16:00:00',
    notes: 'Déjà équipée : site récent, Google Ads actifs, fiche Google complète. Pas de besoin immédiat. À réactiver dans 6 mois si changement de prestataire.',
    thread: [
      {
        id: 'm601',
        author: 'agent',
        subject: 'Pharmacie des Carmes — fiche Google et avis',
        body: `Bonjour,

J'ai regardé votre présence digitale — vous avez un très bon score Google (4,6/5 avec 156 avis), c'est remarquable pour une pharmacie.

Je voulais voir si vous aviez des projets côté référencement ou Google Ads pour renforcer encore votre visibilité locale.

Thomas — Hdigiweb`,
        sentAt: '2026-04-14T09:00:00',
        openedAt: '2026-04-14T10:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm602',
        author: 'lead',
        subject: 'Re: Pharmacie des Carmes',
        body: `Bonjour, on a déjà tout ce qu'il faut côté digital, merci quand même.`,
        sentAt: '2026-04-17T16:00:00',
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
    date: '2026-05-04',
    time: '14:30',
    duration: 20,
    detectedFrom: 'Ok jeudi ça me va, vers 14h30 si c\'est possible.',
    confirmedByAgent: true,
    clientNotified: true,
    phone: '06 74 23 11 89',
  },
  {
    id: 'rdv2',
    leadId: 'l8',
    company: 'Institut Beauté Éléonore',
    contact: 'Éléonore Vidal',
    date: '2026-05-06',
    time: '10:00',
    duration: 20,
    detectedFrom: 'Je peux vendredi matin vers 10h ?',
    confirmedByAgent: true,
    clientNotified: true,
    phone: '05 61 42 87 03',
  },
]

export const AGENT_CONFIG: AgentConfig = {
  persona: `Commercial senior B2B — représente Hdigiweb, agence web à Toulouse. Spécialisé services digitaux pour PME/TPE françaises. Fait un audit digital rapide avant chaque prise de contact : position Google, score PageSpeed, nombre d'avis, présence concurrents. Cite toujours des faits précis et observés. Direct, chiffres à l'appui, jamais agressif. Objectif : générer un RDV, pas vendre au premier email.`,
  objective: `Générer des rendez-vous qualifiés pour Hdigiweb auprès de PME/TPE en Occitanie qui ont un problème de visibilité digitale identifié. Chaque email cite un signal précis observé sur le business ciblé (score PageSpeed réel, nom du concurrent en position 1, volume de recherches locales, gap d'avis). Le prospect doit avoir l'impression qu'on a vraiment audité son business avant d'écrire.`,
  tone: `Audit-based : chaque email s'ouvre sur un fait observé, pas sur une présentation de service. Ton direct et humain. 80-120 mots max. Pas de jargon, pas de "notre solution", pas de "j'espère que ce message vous trouve bien". Un seul CTA léger à la fin — jamais agressif. Signature : "Thomas — Hdigiweb".`,
  maxEmailsPerDay: 40,
  warmupEnabled: true,
  autoReplyEnabled: true,
  autoRdvEnabled: true,
  clientNotifEmail: 'contact@hdigiweb.com',
}

export const TARGETING_SIGNALS = [
  {
    signal: 'Pas de site web',
    description: 'Fiche GMB existante mais aucun site associé — invisible en organique',
    services: ['Création site vitrine', 'SEO local'],
    priority: 'haute',
  },
  {
    signal: 'Site non mobile-friendly',
    description: 'Score PageSpeed mobile < 50/100 — pénalisé par Google',
    services: ['Refonte site', 'Optimisation performance'],
    priority: 'haute',
  },
  {
    signal: 'Absent Google Ads',
    description: 'Concurrents visibles en annonces, eux non — trafic payant 100% perdu',
    services: ['Google Ads', 'Local Service Ads'],
    priority: 'haute',
  },
  {
    signal: 'Mauvais positionnement SEO',
    description: 'Absent des 3 premiers résultats sur leur mot-clé principal',
    services: ['SEO local', 'Contenu optimisé'],
    priority: 'haute',
  },
  {
    signal: 'Peu d\'avis Google',
    description: 'Moins de 20 avis vs concurrents à 50+ — crédibilité faible',
    services: ['Gestion fiche Google', 'Stratégie avis'],
    priority: 'moyenne',
  },
  {
    signal: 'GMB incomplète',
    description: 'Fiche sans photos, horaires ou description — conversion faible',
    services: ['Gestion fiche Google', 'Community management'],
    priority: 'moyenne',
  },
]
