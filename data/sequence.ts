// Séquence email officielle Hdigiweb — v5.0
// Cible : couvreurs Occitanie
// Service : visibilité Google → plus de demandes de devis

export interface SequenceEmail {
  step: number
  delayDays: number  // J+0, J+3, J+7, J+14, J+21
  label: string
  subject: string
  body: string
  active: boolean
}

export const EMAIL_SEQUENCE: SequenceEmail[] = [
  {
    step: 0,
    delayDays: 0,
    label: 'Email initial',
    subject: 'Vous avez assez de demandes de devis en ce moment ?',
    body: `Bonjour {{FirstName}},

Sur {{City}}, la majorité des demandes de devis vont aux 3 premiers couvreurs visibles sur Google — les autres attendent le bouche-à-oreille.

Probablement que votre activité tourne déjà bien, mais si vous voulez un flux régulier de chantiers sans dépendre des recommandations, c'est réglable.

Quelques minutes pour voir ce qui serait possible sur votre secteur, en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
    active: true,
  },
  {
    step: 1,
    delayDays: 3,
    label: 'Relance J+3',
    subject: '1 mois offert pour tester sur {{City}}',
    body: `Bonjour {{FirstName}},

Je reviens vers vous rapidement.

Les couvreurs qu'on accompagne reçoivent en moyenne 8 à 15 demandes de devis supplémentaires par mois via Google — certains bien plus selon la zone.

Pour que vous puissiez vérifier si c'est reproductible chez vous, le premier mois est offert, sans engagement.

Quelques minutes cette semaine pour vous montrer ce que ça donnerait sur votre secteur, plutôt en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
    active: true,
  },
  {
    step: 2,
    delayDays: 7,
    label: 'Relance J+7',
    subject: 'Ce que font vos concurrents sur Google en ce moment',
    body: `Bonjour {{FirstName}},

Il me semble que vous n'avez pas encore eu le temps de regarder ça — je comprends, c'est rarement la priorité quand le planning est chargé.

Ce que j'observe sur {{City}} : 2 ou 3 couvreurs captent la grande majorité des recherches locales. Ceux qui ne sont pas positionnés ne voient pas les demandes passer.

On peut vérifier ensemble où vous en êtes et ce qu'il faudrait pour inverser ça.

20 minutes suffisent — en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
    active: true,
  },
  {
    step: 3,
    delayDays: 14,
    label: 'Relance J+14',
    subject: 'Un système complet pour plus de chantiers',
    body: `Bonjour {{FirstName}},

Concrètement, ce qu'on met en place : visibilité Google Maps, référencement sur les recherches locales clés (fuite toiture, rénovation, démoussage...), optimisation pour générer des appels entrants — le tout suivi et ajusté chaque mois.

Le premier mois est offert pour que vous puissiez mesurer l'impact sans rien risquer.

Souhaitez-vous une estimation sur votre zone, en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
    active: true,
  },
  {
    step: 4,
    delayDays: 21,
    label: 'Dernière relance J+21',
    subject: 'Je vous garde une place ?',
    body: `Bonjour {{FirstName}},

Dernière prise de contact de ma part.

On travaille actuellement avec quelques couvreurs sur {{City}} pour générer beaucoup plus de demandes de devis via Google chaque semaine.

Le premier mois étant offert, on limite le nombre de nouvelles intégrations pour ne pas saturer les mêmes zones.

Si vous voulez tester avant qu'on ferme les places, je peux vous intégrer cette semaine. Sinon je clos simplement le dossier.

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`,
    active: true,
  },
]

// Helpers
export function getSequenceStep(step: number): SequenceEmail | undefined {
  return EMAIL_SEQUENCE.find(s => s.step === step && s.active)
}

export function getNextStep(currentStep: number): SequenceEmail | undefined {
  return EMAIL_SEQUENCE.find(s => s.step === currentStep + 1 && s.active)
}

// Replace template variables with contact data
export function renderTemplate(template: string, vars: {
  firstName?: string
  city?: string
  company?: string
}): string {
  return template
    .replace(/{{FirstName}}/g, vars.firstName || 'Monsieur')
    .replace(/{{City}}/g, vars.city || 'votre secteur')
    .replace(/{{Company}}/g, vars.company || 'votre entreprise')
}
