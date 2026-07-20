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
    subject: 'Combien de devis Google vous manquez chaque semaine ?',
    body: `Bonjour {{FirstName}},

Sur {{City}}, les 3 premiers couvreurs sur Google captent environ 70% des demandes de devis locales. Les autres ne voient pas passer les contacts.

J'ai regardé rapidement votre positionnement, il y a clairement de la marge pour capter une part de ce trafic avant vos concurrents.

Ça vous dirait qu'on regarde ça ensemble cette semaine ? 20 minutes chrono.

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`,
    active: true,
  },
  {
    step: 1,
    delayDays: 3,
    label: 'Relance J+3',
    subject: '8 à 15 devis de plus par mois, testable sans risque',
    body: `Bonjour {{FirstName}},

Je reviens vers vous car la fenêtre sur {{City}} se réduit, un concurrent vient de commencer à travailler sa visibilité Google.

Les couvreurs qu'on accompagne génèrent en moyenne 8 à 15 demandes de devis supplémentaires par mois. Le premier mois est offert pour que vous puissiez mesurer l'impact sur votre zone sans rien risquer.

Disponible pour 20 minutes cette semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`,
    active: true,
  },
  {
    step: 2,
    delayDays: 7,
    label: 'Relance J+7',
    subject: 'Un couvreur sur votre secteur vient de passer devant vous',
    body: `Bonjour {{FirstName}},

Un couvreur sur {{City}} qu'on accompagne reçoit maintenant 3 à 4 appels entrants par semaine depuis Google. Il était au même point que vous il y a 6 semaines.

La différence : il est maintenant visible sur les recherches "couvreur {{City}}", "réparation toiture", "démoussage toiture". Vous n'y êtes pas encore.

On peut corriger ça rapidement. 20 minutes cette semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`,
    active: true,
  },
  {
    step: 3,
    delayDays: 14,
    label: 'Relance J+14',
    subject: 'Résultat concret : +11 devis en 30 jours',
    body: `Bonjour {{FirstName}},

Un couvreur à Nîmes, profil similaire au vôtre, a reçu 11 demandes de devis supplémentaires son premier mois avec nous. Chiffre toiture, rénovation, urgences.

Rien de magique : il capte maintenant les recherches que ses concurrents ignoraient.

Le premier mois est offert. Si les résultats ne sont pas là, vous ne payez rien.

Une demi-heure cette semaine pour voir si c'est reproductible sur votre zone ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`,
    active: true,
  },
  {
    step: 4,
    delayDays: 21,
    label: 'Dernière relance J+21',
    subject: 'Dernière nouvelle de ma part',
    body: `Bonjour {{FirstName}},

Je ne vais pas vous relancer après ça, je passe simplement à d'autres couvreurs sur votre secteur.

Si le timing n'était pas bon et que vous voulez voir ce qu'on peut faire pour votre visibilité Google avant que je commence avec quelqu'un d'autre sur {{City}}, répondez à cet email.

Sinon, bonne continuation.

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`,
    active: true,
  },
]

// ⚠️ REPLI NEUTRE, ADAPTÉ AU SECTEUR — à utiliser quand la génération IA échoue.
// Les templates EMAIL_SEQUENCE ci-dessus sont HARDCODÉS COUVREUR (toiture, démoussage, "+11 devis
// à Nîmes", "70%"...). Les envoyer à un pisciniste/terrassier/maçon = faux métier + chiffres
// inventés = faute grave. Ce repli n'emploie AUCUN chiffre fabriqué et adapte le vocabulaire au
// métier réel du lead (sector), tout en gardant l'offre "1er mois offert".
export function buildNeutralSequenceEmail(
  step: number,
  vars: { firstName?: string; city?: string; sector?: string; fromEmail?: string; fromName?: string },
): { subject: string; body: string } {
  const metier = (vars.sector && vars.sector.trim() && vars.sector !== 'inconnu') ? vars.sector.trim() : 'artisan'
  const ville = vars.city?.trim() || 'votre secteur'
  const hi = vars.firstName?.trim() ? `Bonjour ${vars.firstName.trim()},` : 'Bonjour,'
  const sig = `Bien à vous,\n\n${vars.fromName || 'Gabin'}\nHdigiweb\n${vars.fromEmail || 'contact@hdigiweb.fr'}\n---\nPour ne plus recevoir mes emails, répondez simplement "Stop".`
  const bodies: Record<number, { subject: string; body: string }> = {
    0: {
      subject: `Plus de demandes de devis pour votre activité de ${metier} ?`,
      body: `${hi}\n\nQuand un client cherche un ${metier} sur ${ville}, il passe presque toujours par Google, et ce sont souvent les mêmes entreprises qui ressortent en haut. Si vous n'en faites pas partie, ces demandes de devis partent ailleurs.\n\nC'est exactement ce qu'on aide à corriger. Le premier mois est offert, sans engagement, pour que vous jugiez sur les résultats avant de payer quoi que ce soit.\n\nÇa vous dirait d'en parler quelques minutes ?\n\n${sig}`,
    },
    1: {
      subject: `Être mieux visible sur "${metier} ${ville}"`,
      body: `${hi}\n\nJe reviens vers vous. L'idée est simple : vous rendre plus visible quand quelqu'un cherche un ${metier} sur ${ville}, pour capter les demandes de devis qui passent aujourd'hui à côté.\n\nLe premier mois est offert, vous ne payez que si ça vous convainc. Un créneau en début ou en fin de semaine pour en discuter ?\n\n${sig}`,
    },
    2: {
      subject: `Votre métier se voit sur le terrain, pas encore sur Google`,
      body: `${hi}\n\nBeaucoup d'artisans sont très bons sur le terrain mais peu visibles en ligne, du coup les demandes partent chez d'autres. C'est précisément ce sur quoi on travaille pour les ${metier}s.\n\nPremier mois offert pour tester sur ${ville}, sans engagement. Vous voulez qu'on en parle ?\n\n${sig}`,
    },
    3: {
      subject: `Dernier message`,
      body: `${hi}\n\nJe ne vais pas vous relancer davantage. Si vous voulez tester sans risque, le premier mois reste offert et sans engagement : vous ne payez que si les résultats vous conviennent.\n\nUn mot de votre part et on lance ça.\n\n${sig}`,
    },
  }
  return bodies[step] ?? bodies[0]
}

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
  fromEmail?: string
  fromName?: string
}): string {
  return template
    .replace(/{{FirstName}}/g, vars.firstName || 'Monsieur')
    .replace(/{{City}}/g, vars.city || 'votre secteur')
    .replace(/{{Company}}/g, vars.company || 'votre entreprise')
    .replace(/thomas@hdigiweb\.fr/g, vars.fromEmail || 'thomas@hdigiweb.fr')
    .replace(/Thomas Renard/g, vars.fromName || 'Thomas Renard')
}
