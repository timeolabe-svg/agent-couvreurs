import { GeneratedEmail } from '@/types'

export const DEMO_GENERATED_EMAILS: GeneratedEmail[] = [
  {
    id: 'e1',
    prospectId: 'p1',
    subject: 'Plus de chantiers pour Couverture Martineau ?',
    body: `Bonjour Sébastien,

J'ai vu que Couverture Martineau est bien positionné sur Lyon — 47 avis Google et une bonne note. Ça se voit que le boulot est sérieux.

La question c'est : est-ce que le planning est aussi plein qu'il devrait l'être ?

On travaille avec des artisans couvreurs pour générer des demandes de chantiers en continu, sans dépendre du bouche-à-oreille ou des plateformes qui prennent leur commission.

Ça vous intéresse qu'on en parle 15 minutes ?

Cordialement,
Thomas`,
    type: 'initial',
    generatedAt: '2024-01-18T09:00:00',
    sentAt: '2024-01-18T09:15:00',
    openedAt: '2024-01-18T14:32:00',
    status: 'opened',
  },
  {
    id: 'e2',
    prospectId: 'p4',
    subject: 'Remplir le planning de Bernard Couverture',
    body: `Bonjour Thierry,

Je vois que vous êtes actif sur Google Ads à Bordeaux — bonne démarche. La question c'est si ça rapporte assez par rapport à ce que vous investissez.

Bernard Couverture a clairement la capacité de gérer plus de volume (10 à 20 personnes, c'est pas rien). Mais générer des leads qualifiés en continu, c'est souvent le point de blocage.

On a mis en place un système pour des couvreurs dans votre situation — demandes entrants, pas de commission par chantier.

Disponible pour un appel rapide cette semaine ?

Thomas`,
    type: 'initial',
    generatedAt: '2024-01-17T10:00:00',
    sentAt: '2024-01-17T10:20:00',
    openedAt: '2024-01-17T16:45:00',
    repliedAt: '2024-01-18T08:30:00',
    status: 'replied',
  },
  {
    id: 'e3',
    prospectId: 'p3',
    subject: 'Artisan Lefevre — trouver des chantiers à Toulouse',
    body: `Bonjour Michel,

Artisan couvreur à Toulouse, spécialisé zinc — il y a clairement de la demande dans la région mais c'est pas toujours simple de la capter sans site ni présence en ligne.

Je travaille avec des artisans couvreurs pour changer ça : générer des demandes directement, sans passer par des agrégateurs qui gèrent mal la qualité des leads.

Ça vaudrait le coup qu'on se parle 10 minutes ?

Cordialement,
Thomas`,
    type: 'initial',
    generatedAt: '2024-01-20T09:00:00',
    status: 'draft',
  },
  {
    id: 'e4',
    prospectId: 'p6',
    subject: 'Pro Couverture Alsace — on peut vous envoyer des chantiers',
    body: `Bonjour Frédéric,

Pro Couverture Alsace est manifestement une référence dans la région — 84 avis et une note proche de 5. Vous devez probablement pas manquer de travail, mais est-ce que le flux entrant est assez prévisible ?

Ce qu'on propose : un système de génération de demandes entrantes, calibré pour votre zone et vos spécialités, sans commission sur chantier.

Je serais curieux de savoir si c'est un sujet pour vous en ce moment.

Thomas`,
    type: 'initial',
    generatedAt: '2024-01-20T11:00:00',
    sentAt: '2024-01-20T11:30:00',
    openedAt: '2024-01-20T15:20:00',
    repliedAt: '2024-01-21T09:00:00',
    status: 'replied',
  },
  {
    id: 'e5',
    prospectId: 'p1',
    subject: 'Re: Couverture Martineau',
    body: `Bonjour Sébastien,

Je reviens vers vous rapidement — je voulais savoir si mon message de jeudi a retenu votre attention.

Si le timing n'est pas bon, pas de souci, dites-le moi. Sinon, je peux vous partager quelques exemples concrets de résultats chez des couvreurs en région Rhône-Alpes.

Thomas`,
    type: 'followup_1',
    generatedAt: '2024-01-20T09:00:00',
    sentAt: '2024-01-20T09:10:00',
    status: 'sent',
  },
]

export const DEMO_REPLIES = [
  {
    id: 'r1',
    prospectId: 'p4',
    emailId: 'e2',
    content: "Bonjour, effectivement on cherche à améliorer notre acquisition. Pouvez-vous m'en dire plus sur votre approche ? On a déjà testé des solutions similaires sans grand succès.",
    classification: 'interested' as const,
    suggestedResponse: `Bonjour Thierry,

Merci pour votre retour. Vous avez raison d'être prudent, il y a beaucoup de promesses dans ce domaine.

Ce qui nous différencie : on ne vend pas des leads en gros, on construit une acquisition sur-mesure pour votre zone et vos spécialités. Pas de commission par chantier signé.

Je vous propose un appel de 20 minutes jeudi ou vendredi — je vous montre concrètement comment ça fonctionne pour des couvreurs similaires à Bernard Couverture.

Quel créneau vous convient ?`,
    receivedAt: '2024-01-18T08:30:00',
  },
  {
    id: 'r2',
    prospectId: 'p6',
    emailId: 'e4',
    content: "Oui ça m'intéresse, on a justement des créneaux disponibles pour du nouveau travail. Appelez-moi au 06 67 89 01 23",
    classification: 'interested' as const,
    suggestedResponse: `Bonjour Frédéric,

Parfait, je vous appelle demain entre 9h et 11h — ça vous convient ?

À très vite,
Thomas`,
    receivedAt: '2024-01-21T09:00:00',
  },
  {
    id: 'r3',
    prospectId: 'p9',
    emailId: 'e3',
    content: "Non merci, pas intéressé. Merci de ne plus me contacter.",
    classification: 'not_interested' as const,
    suggestedResponse: `Bonjour Denis,

Bien reçu, je respecte votre décision.

N'hésitez pas si votre situation change.

Cordialement,
Thomas`,
    receivedAt: '2024-01-19T14:00:00',
  },
]
