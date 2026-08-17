/**
 * ON N'AFFIRME PAS UN DÉFAUT QU'ON N'A PAS CONSTATÉ.
 *
 * ⚠️ INCIDENT DU 17/08, REPÉRÉ PAR TIMÉO. Le premier mail envoyé à MUMCULAR PVC disait :
 * « Depuis un téléphone, votre site s'affiche mal et oblige à zoomer pour lire. »
 * L'audit réel de mumcular.fr dit l'inverse : site MODERNE, score 88, balise viewport présente.
 * Ses vrais défauts étaient tout autres (pas de numéro cliquable, pas de formulaire de contact).
 *
 * D'où venait la phrase ? DU PROMPT LUI-MÊME. Le prompt système contient un exemple de bon style
 * qui décrit un site illisible sur mobile ; faute de défaut visible à exploiter, le modèle a recopié
 * l'exemple. La consigne « à imiter, PAS à recopier » n'a rien empêché — c'est la démonstration,
 * une fois de plus, qu'un prompt n'est pas un garde-fou. Le garde-fou, c'est du code qui relit.
 *
 * Ce que ça coûte : on écrit à un vrai professionnel, au nom du client, que son site est cassé
 * alors qu'il ne l'est pas. Il ouvre son site, voit qu'il s'affiche très bien, et comprend qu'on ne
 * l'a jamais regardé. Tout le reste du message perd sa crédibilité, y compris ce qui est vrai.
 */

/** Une affirmation qu'on ne peut écrire QUE si l'audit l'a constatée. */
interface Affirmation {
  /** Ce que le mail prétend. */
  nom: string
  /** Détecte l'affirmation dans le corps du mail. */
  motif: RegExp
  /** L'affirmation est légitime si UNE des faiblesses auditées contient un de ces fragments. */
  preuves: string[]
}

const AFFIRMATIONS: Affirmation[] = [
  {
    nom: 'site illisible sur mobile',
    motif: /(zoom|s'affiche mal|illisible|pas adapté|mal adapté|difficile à lire)[^.]{0,60}(téléphone|portable|mobile|smartphone)|(téléphone|portable|mobile|smartphone)[^.]{0,60}(zoom|s'affiche mal|illisible|pas adapté|mal adapté)/i,
    /**
     * ⚠️ PAS 'mobile' ICI. Premier jet de ce fichier : j'avais mis 'mobile' dans les preuves. Or la
     * faiblesse « pas de numéro cliquable (appel en 1 clic impossible depuis un mobile) » contient
     * ce mot — le garde-fou validait donc l'affirmation qu'il était censé bloquer, et mon test sur
     * le vrai mail de MUMCULAR ressortait « ok ». Une preuve doit désigner LE défaut, pas un mot qui
     * traîne dans la description d'un autre.
     */
    preuves: ['viewport', 'flash'],
  },
  {
    nom: 'site non sécurisé (HTTP)',
    motif: /non sécuris|pas en https|en http\b|cadenas/i,
    preuves: ['https', 'ssl'],
  },
  {
    nom: 'site lent',
    motif: /(site|page)[^.]{0,40}(lent|met du temps|rame|charge lentement)/i,
    preuves: ['jquery', 'lent', 'poids'],
  },
  {
    nom: 'site à l\'abandon / pas mis à jour',
    motif: /(pas (été )?(mis à jour|bougé|touché)|à l'abandon|abandonné|plus mis à jour|date de plusieurs années)/i,
    preuves: ['abandonn', 'copyright', 'obsol'],
  },
  {
    nom: 'texte de remplissage',
    motif: /lorem ipsum|faux texte|texte de remplissage/i,
    preuves: ['lorem'],
  },
  {
    nom: 'absence de site',
    motif: /(vous n'avez pas de site|aucun site|pas de site internet|introuvable sur (google|internet))/i,
    preuves: ['aucun site'],
  },
]

export interface ControleAffirmations {
  ok: boolean
  /** Affirmations présentes dans le mail mais absentes de l'audit. */
  inventions: string[]
}

/**
 * Relit un mail généré et signale toute affirmation sur le site du prospect que l'audit ne soutient
 * pas. `faiblesses` doit être la liste brute produite par l'audit (contacts.audit_weaknesses).
 *
 * ⚠️ Volontairement PERMISSIF sur ce qui n'est pas listé ici, et STRICT sur ce qui l'est : le but
 * n'est pas de juger le style, c'est d'empêcher qu'une affirmation vérifiable et fausse parte chez
 * un prospect. Une affirmation qu'on ne sait pas vérifier n'a pas sa place dans cette liste.
 */
export function verifierAffirmations(
  corps: string,
  faiblesses: string[] | null | undefined,
  aUnSite: boolean,
): ControleAffirmations {
  const w = (faiblesses ?? []).map(x => x.toLowerCase())
  const inventions: string[] = []

  for (const a of AFFIRMATIONS) {
    if (!a.motif.test(corps)) continue

    // Cas « absence de site » : la preuve n'est pas dans les faiblesses mais dans le fait qu'on
    // n'ait trouvé aucun site. L'inverse est une faute grave (dire à quelqu'un qui a un site
    // soigné qu'il n'existe pas en ligne).
    if (a.nom === 'absence de site') {
      if (aUnSite) inventions.push(a.nom)
      continue
    }

    const prouve = a.preuves.some(p => w.some(weakness => weakness.includes(p)))
    if (!prouve) inventions.push(a.nom)
  }

  return { ok: inventions.length === 0, inventions }
}
