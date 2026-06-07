import { Lead, RdvEvent, AgentConfig } from '@/types'

export const DEMO_LEADS: Lead[] = [
  // ── RDV CONFIRMÉS ─────────────────────────────────────────────────────────
  {
    id: 'l1',
    company: 'Toiture Carpentier',
    contact: 'Laurent Carpentier',
    firstName: 'Laurent',
    email: 'l.carpentier@gmail.com',
    phone: '06 74 23 11 89',
    city: 'Toulouse',
    googleRating: 4.3,
    googleReviews: 18,
    specialty: ['couverture', 'zinguerie', 'démoussage'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'rdv_booked',
    createdAt: '2026-04-25T08:00:00',
    lastActivityAt: '2026-04-29T15:10:00',
    rdvDate: '2026-05-04',
    rdvConfirmedAt: '2026-04-29T15:10:00',
    notes: 'Aucun site web. GMB existante, 18 avis, mais invisible sur les recherches couvreur Toulouse — absent en organique et Ads. Concurrent direct : Toitures Bonnard (43 avis, site complet).',
    thread: [
      {
        id: 'm1',
        author: 'agent',
        subject: 'La saison du démoussage qui arrive',
        body: `Bonjour Laurent,

Question directe : sur le démoussage et la rénovation toiture, vos clients particuliers vous trouvent surtout par recommandation, ou vous voyez aussi des particuliers vous contacter via internet ?

Je vous demande parce qu'on entre dans le pic saisonnier après l'hiver : recherches de couvreurs pour démoussage, réparations post-tempête et reprise de zinguerie en forte hausse sur Toulouse. La majorité des particuliers tape ces requêtes sur Google avant de demander un devis et compare plusieurs sites avant d'appeler.

Vos avis Google parlent d'eux-mêmes sur la qualité de votre travail, mais sans site vous n'apparaissez pas dans cette comparaison. C'est mécaniquement la majorité du marché des particuliers qui passe à côté.

Si le démoussage et la rénovation sont des axes à développer, j'ai un état des lieux des 6 couvreurs de Toulouse nord avec leur positionnement Google et leur volume de demandes web mensuelles.

Quelques minutes d'échange pour en parler, vous êtes plutôt dispo en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-25T09:10:00',
        openedAt: '2026-04-25T12:45:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm2',
        author: 'lead',
        subject: 'Re: La saison du démoussage qui arrive',
        body: `Bonjour Thomas,

C'est vrai que j'ai jamais eu de site, je tourne principalement au bouche à oreille et aux recommandations entre artisans. Mais là j'aimerais bien avoir plus de chantiers réguliers, surtout sur le démoussage.

C'est quoi exactement ce que vous proposez et quel budget ça représente ?`,
        sentAt: '2026-04-26T07:55:00',
      },
      {
        id: 'm3',
        author: 'agent',
        subject: 'Re: La saison du démoussage qui arrive',
        body: `Bonjour Laurent,

Concrètement, pour un couvreur qui démarre sur le digital, on construit un site avec une vraie galerie de chantiers (photos avant/après pour le démoussage et la rénovation toiture), une page par grande prestation, et un formulaire de demande de devis qui tombe directement sur votre mail.

Le budget se situe entre 1500 et 2500 € en création, avec un suivi mensuel léger pour le référencement local. Vous restez propriétaire du site.

Pour un couvreur dans votre situation, l'objectif est en général 4 à 8 demandes de devis qualifiées en plus chaque mois après deux à trois mois. Sur le ticket moyen démoussage ou réfection partielle, c'est rentabilisé en un ou deux chantiers.

Quelques minutes au téléphone pour qu'on rentre dans le détail, vous préférez en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-26T10:30:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
      {
        id: 'm4',
        author: 'lead',
        subject: 'Re: Toiture Carpentier',
        body: `Ok jeudi ça me va, vers 14h30 si c'est possible. Mon 06 c'est le 06 74 23 11 89.`,
        sentAt: '2026-04-29T15:08:00',
      },
      {
        id: 'm5',
        author: 'agent',
        subject: 'RDV lundi 4 mai 14h30 confirmé',
        body: `Parfait Laurent, c'est noté pour lundi 4 mai à 14h30. Je vous appelle au 06 74 23 11 89.

D'ici là je prépare deux choses pour qu'on aille direct au but pendant l'appel : un mapping des couvreurs de Toulouse nord avec leur positionnement Google et le volume de demandes web qu'ils captent, ainsi qu'un cas concret d'un couvreur d'Auch qu'on a accompagné l'an dernier (situation très proche de la vôtre).

Je vous envoie tout ça la veille pour que vous puissiez y jeter un œil avant l'appel.

Bien à vous, à lundi.

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-29T15:15:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  {
    id: 'l8',
    company: 'Toitures Vidal & Fils',
    contact: 'Sébastien Vidal',
    firstName: 'Sébastien',
    email: 'contact@toitures-vidal.fr',
    phone: '05 61 42 87 03',
    city: 'Tournefeuille',
    website: 'www.toitures-vidal.fr',
    googleRating: 4.8,
    googleReviews: 62,
    specialty: ['couverture neuve', 'rénovation toiture', 'isolation combles'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'rdv_booked',
    createdAt: '2026-04-26T08:00:00',
    lastActivityAt: '2026-04-29T11:30:00',
    rdvDate: '2026-05-06',
    rdvConfirmedAt: '2026-04-29T11:30:00',
    notes: 'Site existant mais 0 Google Ads. Concurrent SARL Toiture du Sud (Tournefeuille) en position 1 sur les recherches couvreur Tournefeuille via Ads. Sébastien a 4.8/5 — meilleure note du secteur mais invisible en annonces.',
    thread: [
      {
        id: 'm801',
        author: 'agent',
        subject: 'Vos avis vs la stratégie de SARL Toiture du Sud',
        body: `Bonjour Sébastien,

J'ai pris cinq minutes pour comparer vos avis Google avec ceux de SARL Toiture du Sud sur Tournefeuille. Les vôtres sont nettement plus qualitatifs : plus longs, plus précis sur la qualité de pose, le respect des délais et la propreté du chantier. Eux ont des avis plus courts et plus génériques.

Et pourtant, c'est SARL Toiture du Sud qui apparaît en premier dans les annonces Google quand quelqu'un cherche un couvreur sur Tournefeuille. Vous êtes en organique plus bas, parfois pas dans les premiers résultats du tout.

Vos clients existants vous trouvent par recommandation. Mais ceux qui découvrent juste leur problème de toiture tombent d'abord sur SARL Toiture du Sud, et une partie y va par défaut sans savoir que vous existez.

J'ai préparé une analyse des dépenses Google Ads de SARL Toiture du Sud et des 5 principales requêtes où ils se positionnent.

Quelques minutes pour vous la présenter, c'est mieux pour vous en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-14T09:30:00',
        openedAt: '2026-04-14T14:12:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm802',
        author: 'lead',
        subject: 'Re: Vos avis vs la stratégie de SARL Toiture du Sud',
        body: `Bonjour Thomas, oui ça m'intéresse. Je peux vendredi matin vers 10h ? Vous pouvez m'appeler au 05 61 42 87 03.`,
        sentAt: '2026-04-15T08:45:00',
      },
      {
        id: 'm803',
        author: 'agent',
        subject: 'RDV vendredi 10h confirmé',
        body: `Bonjour Sébastien,

Top, c'est noté pour vendredi à 10h. Je vous appelle au 05 61 42 87 03.

D'ici là je prépare l'analyse des dépenses Google Ads de SARL Toiture du Sud (les budgets pubs sont publics) et deux ou trois angles d'annonces qu'on testerait pour vous, basés directement sur les retours de vos clients dans les avis (qualité de pose, respect des délais, suivi de chantier).

Je vous envoie tout ça la veille pour qu'on aille à l'essentiel pendant l'appel.

Bien à vous, à vendredi.

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-18T11:30:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  // ── RÉPONSE REÇUE ─────────────────────────────────────────────────────────
  {
    id: 'l3',
    company: 'Couverture Capitole',
    contact: 'Franck Devaux',
    firstName: 'Franck',
    email: 'contact@couverture-capitole.fr',
    city: 'Toulouse',
    website: 'www.couverture-capitole.fr',
    googleRating: 4.4,
    googleReviews: 89,
    specialty: ['couverture', 'charpente', 'ravalement de façade'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'replied',
    createdAt: '2026-04-27T08:00:00',
    lastActivityAt: '2026-04-29T14:00:00',
    notes: '89 avis Google 4,4/5. 0 Google Ads sur les recherches B2B (syndics, copropriétés, marchés publics). Toitures Express capte le segment. Aucun travail spécifique sur le B2B.',
    thread: [
      {
        id: 'm9',
        author: 'agent',
        subject: 'Contrats syndics & copropriétés Toulouse',
        body: `Bonjour Franck,

Question directe : aujourd'hui, sur les contrats syndics, copropriétés et expertises sinistres, quelle part ça représente dans votre chiffre ?

Je vous demande parce que sur Toulouse, les recherches B2B (entretien toiture immeuble, expertise sinistre, marchés publics couverture) sont concentrées sur 4 ou 5 acteurs : trois grandes entreprises générales du BTP et deux gros couvreurs avec un service B2B dédié. Les couvreurs traditionnels sont quasi absents de ce segment, alors qu'ils sont souvent un format plus pertinent pour un syndic : interlocuteur unique, réactivité sur les urgences, ticket plus accessible.

J'ai listé les 4 acteurs qui captent ce segment, leur positionnement Google précis et le volume de demandes mensuelles que représente ce trafic.

Quelques minutes d'échange pour vous le présenter, c'est mieux pour vous en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-17T09:45:00',
        openedAt: '2026-04-17T13:10:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm10',
        author: 'lead',
        subject: 'Re: Contrats syndics & copropriétés Toulouse',
        body: `Bonjour Thomas,

On travaille déjà avec quelqu'un pour notre communication. Donc là on n'a pas vraiment besoin d'un prestataire supplémentaire.

Franck`,
        sentAt: '2026-04-19T11:30:00',
      },
      {
        id: 'm11',
        author: 'agent',
        subject: 'Re: votre prestataire actuel et le B2B',
        body: `Bonjour Franck,

Avant de vous laisser tranquille, une dernière question : votre prestataire actuel a-t-il un travail spécifique sur le B2B (contrats syndics, copropriétés, expertises sinistres assurance) ?

Beaucoup d'agences font très bien la communication grand public d'un couvreur mais n'investissent pas ce segment, qui demande des contenus, des références chantiers et une présence Google différents. C'est l'angle que je voulais évoquer.

Si c'est déjà couvert chez vous, parfait, je n'insiste pas. Sinon j'ai un mapping détaillé des 4 acteurs qui captent le B2B sur Toulouse avec leurs requêtes et volumes.

Quelques minutes au téléphone pour vous le présenter, vous êtes plutôt dispo en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-20T14:00:00',
        isAiGenerated: true,
        sequenceStep: 'reply',
      },
    ],
  },

  // ── RELANCE 2 ─────────────────────────────────────────────────────────────
  {
    id: 'l2',
    company: 'SARL Toiture Sublime',
    contact: 'Patrick Morin',
    firstName: 'Patrick',
    email: 'contact@toiture-sublime.fr',
    city: 'Toulouse',
    website: 'www.toiture-sublime-toulouse.fr',
    googleRating: 4.5,
    googleReviews: 34,
    specialty: ['couverture', 'étanchéité toit terrasse', 'démoussage'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'follow_up_2',
    createdAt: '2026-04-25T08:00:00',
    lastActivityAt: '2026-04-28T09:15:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Site de 2017, score PageSpeed mobile 34/100. Concurrent Toitures L\'Éclat (zone Lalande) : score 91/100, 128 avis Google. Manque à gagner estimé : 10 à 15 nouveaux chantiers par mois sur les urgences mobile.',
    thread: [
      {
        id: 'm6',
        author: 'agent',
        subject: 'Votre site et les urgences mobile',
        body: `Bonjour Patrick,

J'ai testé votre site sur mobile : il met une dizaine de secondes à se charger entièrement. Le standard Google aujourd'hui est sous les trois secondes, et passé six secondes la majorité des visiteurs ferme l'onglet avant que la page ne s'affiche.

Pour un couvreur avec votre réputation sur le démoussage et l'étanchéité, c'est un vrai problème. Quelqu'un qui découvre une fuite après un orage le soir est dans l'urgence : il tape "couvreur Toulouse" sur son téléphone, clique sur les premiers résultats. Si votre site ne s'ouvre pas, il appelle le suivant.

J'ai un audit technique qui détaille les 4 points qui bloquent votre site et estime précisément le nombre de visiteurs perdus chaque mois.

Quelques minutes pour vous le passer, plutôt en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-15T09:00:00',
        openedAt: '2026-04-15T19:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm7',
        author: 'agent',
        subject: 'Re: Votre site et les urgences mobile',
        body: `Patrick,

J'ajoute un élément à mon dernier message. Au-delà de la vitesse, j'ai remarqué que vos prestations (démoussage, étanchéité, reprise de zinguerie) sont toutes regroupées sur une seule page "Services". Toitures L'Éclat sur Lalande en a une dédiée par prestation, et c'est mécaniquement ce qui leur permet de ressortir en premier quand quelqu'un cherche une intervention précise sur Toulouse.

Votre savoir-faire mérite cette mise en valeur. Ce n'est pas une refonte, juste une réorganisation.

J'ai listé une dizaine d'optimisations dans le même esprit sur votre site, classées par impact estimé.

Quelques minutes au téléphone pour qu'on les regarde ensemble, ça vous arrange plutôt en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-18T09:00:00',
        openedAt: '2026-04-18T12:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
      {
        id: 'm8',
        author: 'agent',
        subject: 'Dernier message',
        body: `Patrick,

Dernier message, je n'insiste plus.

Si le timing n'est pas bon, je le comprends parfaitement. L'audit que j'avais préparé pour vous reste à votre disposition gratuitement : le détail technique de ce qui bloque votre site, la liste des optimisations à fort impact, et la cartographie des recherches que vous ne captez pas. Vous l'utilisez avec qui vous voulez, ou vous le mettez de côté.

Un mot suffit.

Bien à vous, et bonne continuation Patrick.

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-22T09:15:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_2',
      },
    ],
  },

  {
    id: 'l7',
    company: 'Couverture Renard',
    contact: 'Baptiste Renard',
    firstName: 'Baptiste',
    email: 'b.renard.couverture@gmail.com',
    city: 'Toulouse',
    googleRating: 4.9,
    googleReviews: 27,
    specialty: ['couverture', 'charpente', 'rénovation toiture'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'follow_up_1',
    createdAt: '2026-04-26T08:00:00',
    lastActivityAt: '2026-04-28T09:00:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Pas de site web. GMB avec 27 avis 4.9/5. Travaux.com et Habitatpresto sont les seuls canaux d\'acquisition visibles. Concurrent "Couverture Toulouse Centre" (12 avis seulement) a un site bien référencé et capte les recherches directes.',
    thread: [
      {
        id: 'm701',
        author: 'agent',
        subject: 'Votre dépendance aux plateformes',
        body: `Bonjour Baptiste,

Question franche : aujourd'hui, quelle part de vos nouveaux clients vient des plateformes de mise en relation type Travaux.com ou Habitatpresto, et quelle part vient d'une recherche directe sur Google ?

La majorité des couvreurs sans site sont à 90/10 en faveur des plateformes. Le souci, c'est qu'elles prennent une commission sur chaque lead (parfois jusqu'à 80 € le contact non qualifié), contrôlent votre image et peuvent demain choisir de mettre en avant un confrère qui paye plus pour leur référencement interne. Vos avis ne vous protègent pas si leurs règles changent.

Sur la recherche directe Google d'un couvreur sur le centre de Toulouse, c'est Couverture Toulouse Centre qui ressort en premier, pourtant avec moins d'avis que vous. Ils ont un site simple et bien construit qui leur ramène des clients sans intermédiaire.

J'ai un cas client similaire au vôtre détaillé sur 6 mois (situation de départ, actions mises en place, résultats chiffrés).

Quelques minutes pour vous montrer comment ils ont rééquilibré leur acquisition, vous préférez en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-20T09:30:00',
        openedAt: '2026-04-21T08:15:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm702',
        author: 'agent',
        subject: 'Un cas qui ressemble au vôtre',
        body: `Baptiste,

Je reviens avec un cas concret. Un couvreur qu'on a accompagné à Montpellier l'an dernier était dans une situation très similaire à la vôtre : excellente note Travaux.com, pas de site, environ 90% des nouveaux clients via les plateformes.

Six mois après, sa part plateforme avait été divisée par deux : non pas parce qu'il avait perdu de leads sur Travaux.com, mais parce qu'il en avait beaucoup plus en direct via Google. L'investissement initial s'est payé en deux mois. Au-delà, il a regagné le contrôle sur son flux et son image.

Je peux vous présenter le détail de ce qu'on a mis en place chez eux : les 5 actions concrètes, le calendrier de mise en œuvre, les chiffres mensuels d'évolution.

Quelques minutes au téléphone, plutôt cette semaine ou la suivante ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-23T09:00:00',
        isAiGenerated: true,
        sequenceStep: 'follow_up_1',
      },
    ],
  },

  // ── CONTACTÉ (email initial envoyé) ───────────────────────────────────────
  {
    id: 'l4',
    company: 'Couverture Roussel',
    contact: 'Marc Roussel',
    firstName: 'Marc',
    email: 'm.roussel.couverture@gmail.com',
    phone: '06 12 34 56 78',
    city: 'Toulouse',
    googleRating: 4.1,
    googleReviews: 9,
    specialty: ['couverture', 'urgence fuite toiture', 'démoussage'],
    hasGoogleAds: false,
    hasWebsite: false,
    stage: 'contacted',
    createdAt: '2026-04-28T08:00:00',
    lastActivityAt: '2026-04-28T09:05:00',
    nextScheduledAt: '2026-04-30T09:00:00',
    notes: 'Aucun site web, GMB avec seulement 9 avis. Concurrent Toiture Express en position 1 sur les urgences toiture (51 avis, site complet, Google Ads actifs). Marc rate les urgences post-tempête.',
    thread: [
      {
        id: 'm401',
        author: 'agent',
        subject: 'Les urgences toiture sur Toulouse',
        body: `Bonjour Marc,

Question rapide : sur les urgences toiture (fuite après orage, tuile envolée, infiltration), quelle part de vos appels vient de clients qui vous connaissent déjà, et quelle part vient de quelqu'un qui vous trouve sur Google ?

La question n'est pas anodine : les urgences toiture sont une des recherches les plus rentables sur Google pour les artisans du bâtiment. Ticket élevé, décision dans la minute, pas de mise en concurrence. Sur Toulouse, c'est Toiture Express qui capte la majorité de ce trafic. Leur site est basique mais il a un bouton "appel direct" en haut de page et un formulaire d'urgence.

Sans site, même quand vous êtes disponible un samedi soir après un orage, le client en panique ne sait pas que vous existez. Il appelle quelqu'un d'autre.

J'ai un comparatif des 4 couvreurs de Toulouse présents sur les recherches d'urgence avec leur stratégie web complète et le volume de demandes qu'ils captent.

Quelques minutes pour qu'on regarde ça ensemble, vous êtes plutôt dispo en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-25T09:05:00',
        openedAt: '2026-04-25T11:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
    ],
  },

  {
    id: 'l5',
    company: 'Toitures Horizon',
    contact: 'Stéphane Garnier',
    firstName: 'Stéphane',
    email: 'contact@toitures-horizon.fr',
    city: 'Blagnac',
    website: 'www.toitures-horizon.fr',
    googleRating: 4.2,
    googleReviews: 41,
    specialty: ['couverture', 'isolation combles', 'ITE toiture'],
    hasGoogleAds: false,
    hasWebsite: true,
    stage: 'contacted',
    createdAt: '2026-04-29T08:00:00',
    lastActivityAt: '2026-04-29T09:30:00',
    nextScheduledAt: '2026-05-01T09:00:00',
    notes: 'Site existant mais pas de Google Ads. Concurrents Toiture de la Paix et Couverture Occitanie en position 1 via Ads sur isolation combles Blagnac. Score PageSpeed 58/100. Forte saisonnalité MaPrimeRénov : pic de demandes avril-juillet.',
    thread: [
      {
        id: 'm501',
        author: 'agent',
        subject: 'La saison MaPrimeRénov qui démarre',
        body: `Bonjour Stéphane,

On entre dans la période la plus stratégique de l'année pour l'isolation des combles : avril à juillet, c'est le moment où les particuliers lancent leurs travaux MaPrimeRénov pour finaliser avant l'hiver suivant. C'est aussi 30% du chiffre annuel des couvreurs spécialisés en isolation.

J'ai regardé les recherches Google d'isolation combles à Blagnac en ce moment. Toiture de la Paix et Couverture Occitanie sont en première position sur les annonces payantes. Vous n'apparaissez ni en organique ni en payant.

Plus intéressant : pour l'ITE toiture, où votre catalogue est complet, il y a très peu de concurrents qui font des annonces. Un budget modeste vous mettrait en première position immédiatement, sur une recherche très rentable et éligible aux aides.

J'ai préparé un comparatif des dépenses publicitaires de vos 2 concurrents directs et un budget cible précis pour vous positionner sur l'isolation combles MaPrimeRénov en priorité.

Quelques minutes au téléphone pour qu'on regarde ça avant que la saison batte son plein, vous êtes plutôt dispo en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-25T09:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
    ],
  },

  // ── NON INTÉRESSÉ ────────────────────────────────────────────────────────
  {
    id: 'l6',
    company: 'Toitures des Carmes',
    contact: 'Antoine Lefebvre',
    firstName: 'Antoine',
    email: 'contact@toitures-carmes.fr',
    city: 'Toulouse',
    website: 'www.toitures-carmes.fr',
    googleRating: 4.6,
    googleReviews: 156,
    specialty: ['couverture', 'charpente', 'rénovation complète'],
    hasGoogleAds: true,
    hasWebsite: true,
    stage: 'not_interested',
    createdAt: '2026-04-27T08:00:00',
    lastActivityAt: '2026-04-27T16:00:00',
    notes: 'Déjà équipée : site récent, Google Ads actifs, fiche Google complète. Pas de besoin immédiat. À réactiver dans 6 mois si changement de prestataire — angle Local Service Ads intéressant.',
    thread: [
      {
        id: 'm601',
        author: 'agent',
        subject: 'Local Service Ads : un angle souvent oublié',
        body: `Bonjour Antoine,

Vous faites partie des très rares couvreurs de Toulouse à avoir vraiment investi le digital : site bien fait, fiche Google active, campagnes en place. C'est l'exception dans le secteur, donc pas de pitch sur ce que vous avez déjà.

L'angle qui revient souvent dans les couvreurs bien équipés comme vous, c'est les Local Service Ads de Google (le nouveau format avec badge "Garanti par Google"). Très peu de couvreurs sont positionnés dessus pour l'instant, c'est un placement premium en haut des résultats locaux qui devient le standard sur les recherches d'urgence et de devis. Le ROI moyen sur les artisans qui ont testé tourne entre 4 et 6 fois la dépense.

Si c'est un sujet à creuser pour le second semestre, j'ai 2 cas concrets de couvreurs (Bordeaux et Lyon) qui ont mis ça en place avec les chiffres précis : investissement, ROI sur 6 mois, retombées sur les chantiers signés.

Quelques minutes pour qu'on en parle, ça vous arrange en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
        sentAt: '2026-04-14T09:00:00',
        openedAt: '2026-04-14T10:30:00',
        isAiGenerated: true,
        sequenceStep: 'initial',
      },
      {
        id: 'm602',
        author: 'lead',
        subject: 'Re: Local Service Ads',
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
    company: 'Toiture Carpentier',
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
    company: 'Toitures Vidal & Fils',
    contact: 'Sébastien Vidal',
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
  persona: `Commercial senior B2B — représente Hdigiweb, agence web à Toulouse. Spécialisé services digitaux pour PME/TPE et artisans du bâtiment, principalement les couvreurs en Occitanie. Fait un audit digital rapide avant chaque prise de contact : position Google, score PageSpeed, nombre d'avis, présence concurrents. Cite toujours des faits précis et observés. Direct, chiffres à l'appui, jamais agressif. Objectif : générer un RDV, pas vendre au premier email.`,
  objective: `Générer des rendez-vous qualifiés pour Hdigiweb auprès de couvreurs et artisans du bâtiment en Occitanie qui ont un problème de visibilité digitale identifié. Chaque email cite un signal précis observé sur le business ciblé (score PageSpeed réel, nom du concurrent en position 1, volume de recherches locales, gap d'avis). Le prospect doit avoir l'impression qu'on a vraiment audité son business avant d'écrire.`,
  tone: `Audit-based : chaque email s'ouvre sur un fait observé ou une question forte, pas sur une présentation de service. Ton direct et humain. 100-160 mots. Pas de jargon, pas de "notre solution", pas de "j'espère que ce message vous trouve bien". Un seul CTA permission à la fin avec alternative début/fin de semaine.`,
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
    description: 'Score PageSpeed mobile < 50/100 — pénalisé par Google sur les urgences mobile',
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
    description: 'Absent des 3 premiers résultats sur les recherches couvreur locales',
    services: ['SEO local', 'Contenu optimisé'],
    priority: 'haute',
  },
  {
    signal: 'Peu d\'avis Google',
    description: 'Moins de 20 avis vs concurrents à 50+ — crédibilité faible sur les chantiers',
    services: ['Gestion fiche Google', 'Stratégie avis'],
    priority: 'moyenne',
  },
  {
    signal: 'GMB incomplète',
    description: 'Fiche sans photos chantiers, horaires ou description — conversion faible',
    services: ['Gestion fiche Google', 'Community management'],
    priority: 'moyenne',
  },
]
