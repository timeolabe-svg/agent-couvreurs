// SÉQUENCE OFFICIELLE HDIGIWEB — v6.0
// ⚠️ TEXTES FIGÉS, VALIDÉS PAR LE CLIENT (Gabin/Haris) ET PAR TIMÉO. Ne pas réécrire librement :
// seules les VARIABLES sont substituées (nom, métier, ville, boîte d'envoi) + le défaut audité au
// mail 1. L'IA ne régénère plus ces mails — elle réécrivait le pitch et inventait des chiffres.
//
// Offre réellement vendue : rendre l'artisan VISIBLE là où les gens cherchent, pour lui apporter
// des DEMANDES DE DEVIS et des CHANTIERS. Accompagnement continu, 1er mois offert.
// ⛔ Le mot "publicité" (et Google Ads/annonces) est banni : friction énorme côté artisan.
// ⛔ Un seul chiffre autorisé : "au grand minimum 30 à 35 000 € de CA de devis" (vraie donnée client).
// Style imposé : pas de tiret cadratin, pas de deux-points décoratifs, pas de gras, texte brut.

// Cadence validée : J+0 / J+2 / J+5 / J+8 / J+12 / J+16
export const SEQUENCE_DELAYS = [0, 2, 5, 8, 12, 16]
export const SEQUENCE_LENGTH = SEQUENCE_DELAYS.length

export interface SequenceVars {
  firstName?: string | null
  city?: string | null
  sector?: string | null
  fromEmail?: string | null
  fromName?: string | null
  /** Phrase du défaut RÉEL constaté sur son site/sa fiche (mail 1). Vide si l'audit n'a rien de sûr. */
  auditHook?: string | null
}

/** Construit la phrase d'ouverture concrète à partir de l'audit. Renvoie null si aucun défaut
 *  FIABLE : on n'invente jamais un défaut (incident 2L2P), le mail 1 marche très bien sans. */
export function auditHookSentence(level?: string | null, weaknesses?: string[] | null): string | null {
  const w = (weaknesses ?? []).map(x => (x || '').toLowerCase())
  const has = (s: string) => w.some(x => x.includes(s))
  if (!level || level === 'no-website') {
    return level === 'no-website'
      ? "Je n'ai pas trouvé de site à votre nom, donc quand quelqu'un vous cherche en ligne il ne tombe sur rien."
      : null
  }
  if (has('viewport') || has('mobile')) return "Depuis un téléphone, votre site s'affiche mal et oblige à zoomer pour lire."
  if (has('https') || has('sécuris')) return "Votre site s'affiche comme non sécurisé sur les navigateurs, ce qui fait hésiter les gens."
  if (has('lent')) return "Votre site met du temps à s'afficher, et beaucoup de visiteurs partent avant la fin du chargement."
  if (has('description') || has('fiche')) return "Votre fiche Google n'a pas de description, donc Google n'affiche presque rien sur vous."
  if (has('avis')) return "Votre fiche Google a peu d'avis récents, ce qui pèse dans le choix des gens."
  if (level === 'abandoned' || level === 'very-outdated') return "Votre site n'a pas l'air d'avoir bougé depuis un moment, et ça se voit côté visiteur."
  return null
}

/** Les 6 mails validés. `step` de 0 à 5. */
export function buildHdigiwebSequence(step: number, v: SequenceVars): { subject: string; body: string } {
  const metier = (v.sector && v.sector.trim() && v.sector !== 'inconnu') ? v.sector.trim() : 'artisan'
  const ville = (v.city && v.city.trim()) ? v.city.trim() : 'votre secteur'
  const nom = (v.firstName && v.firstName.trim() && !v.firstName.includes('@')) ? ` M. ${v.firstName.trim()}` : ''
  const hi = `Bonjour${nom},`
  const box = v.fromEmail || 'contact@hdigiweb.fr'
  const sig = `Bien à vous,\n\n${v.fromName || 'Gabin'}\nHdigiweb\n${box}`
  const objet = `Votre visibilité quand on cherche un ${metier} à ${ville}`
  const reponse = `Re: ${objet}`
  // Phrase d'audit uniquement si on a un défaut RÉEL, sinon on l'omet (jamais de défaut inventé).
  const hook = v.auditHook?.trim() ? ` ${v.auditHook.trim()}` : ''

  const mails: Array<{ subject: string; body: string }> = [
    {
      subject: objet,
      body: `${hi}

J'ai regardé votre présence sur Google.${hook}

Concrètement, ces personnes contactent souvent l'une des premières entreprises qu'elles voient. Aujourd'hui, ce sont surtout vos concurrents qui récupèrent ces demandes de devis.

C'est exactement ce qu'on aide à changer, vous rendre visible là où vos clients cherchent, pour vous apporter plus de demandes de devis, donc plus de chantiers.

Pour que vous jugiez par vous-même, le premier mois est offert.

Auriez-vous 5 minutes cette semaine ?

${sig}`,
    },
    {
      subject: reponse,
      body: `${hi}

En moyenne, on apporte à un artisan au grand minimum 30 à 35 000 € de CA de devis.

Est-ce que votre planning est déjà plein plusieurs semaines à l'avance, ou vous pouvez encore encaisser quelques chantiers de plus ?

Si vous avez de la place, je peux vous montrer comment les faire arriver. Le premier mois est offert, vous testez sans engagement.

${sig}`,
    },
    {
      subject: reponse,
      body: `${hi}

Beaucoup d'artisans me disent que le bouche-à-oreille leur suffit. Et c'est vrai, ça marche.

Le souci, c'est qu'on ne peut pas prévoir combien de chantiers il ramènera le mois prochain, un mois plein, le suivant plus creux.

L'idée est simplement de rendre votre activité plus régulière, avec des demandes de devis qui arrivent chaque semaine.

C'est pour ça que le premier mois est offert, vous voyez si ça vous apporte vraiment des chantiers avant de continuer.

${sig}`,
    },
    {
      subject: reponse,
      body: `${hi}

Vous vous demandez peut-être pourquoi on offre le premier mois.

C'est simple, on préfère que vous jugiez sur les résultats plutôt que sur un discours commercial. Si ça vous apporte des demandes de devis, vous continuez. Sinon, vous arrêtez, sans discussion.

On échange 5 minutes cette semaine ?

${sig}`,
    },
    {
      subject: reponse,
      body: `${hi}

Quand on enchaîne les chantiers, on n'a pas le temps de s'occuper de sa visibilité en ligne. C'est normal, et c'est justement notre métier.

On s'occupe de tout. Votre seul rôle, répondre aux demandes de devis qui arrivent.

Le premier mois est offert si vous voulez essayer.

${sig}`,
    },
    {
      subject: reponse,
      body: `${hi}

Je vous laisse tranquille après ce message.

Pour être clair sur ce qu'on fait, on vous apporte les chantiers, vous n'avez qu'à les signer. Le premier mois est offert, donc vous ne risquez rien à tester.

Si ça vous intéresse dans les prochaines semaines, répondez simplement à cet email, un créneau ou votre numéro, et je vous rappelle.

Au plaisir d'échanger,

${v.fromName || 'Gabin'}
Hdigiweb
${box}`,
    },
  ]

  return mails[Math.max(0, Math.min(step, mails.length - 1))]
}
