/**
 * CONFORMITÉ RGPD — détection des demandes d'arrêt et d'exercice de droits.
 *
 * CONTEXTE (incident réel LabegarIA, août 2026) : un prospect a porté plainte à la CNIL.
 * L'audit du 06/08 a montré que 8 formulations sur 12 n'étaient PAS détectées par la seule
 * détection d'opt-out existante — dont les plus graves : « supprimez mes données »,
 * « je m'oppose au traitement », « je porte plainte à la CNIL ». Ces messages partaient donc au
 * classifieur IA, qui pouvait les traiter comme une simple objection commerciale et y RÉPONDRE
 * automatiquement. Un mail commercial en réponse à une demande d'effacement est exactement ce qui
 * transforme un mécontentement en plainte.
 *
 * Deux niveaux, volontairement distincts :
 *  - OPT-OUT simple ("stop", "désabonnez-moi") → on cesse d'écrire, blocklist. Fin.
 *  - DEMANDE RGPD (effacement, opposition, plainte CNIL, accusation de spam/harcèlement) →
 *    blocklist AUSSI, mais en plus : JAMAIS de réponse automatique (seul un humain répond, le
 *    RGPD impose une réponse sous 1 mois et un traitement documenté) + alerte immédiate.
 *
 * Les deux fonctions sont DÉTERMINISTES (jamais dépendantes de l'IA) et retirent d'abord notre
 * propre pied de page et les citations : sans ça, notre « répondez simplement "Stop" » cité dans
 * la réponse du prospect déclenche un faux opt-out sur un lead chaud (leçon 49).
 */

/** Retire notre pied de page et tout ce qui suit un marqueur de citation, normalise les apostrophes. */
export function stripOurFooterAndQuotes(text: string): string {
  return (text || '')
    .replace(/[’‘`´]/g, "'")
    .split(/pour ne plus recevoir mes emails/i)[0]
    .split(/vos coordonn[ée]es sont publiques/i)[0]
    .split(/envoy[ée]\s+de\s+mon\s+/i)[0]
    .split(/>\s*le\s/i)[0]
    .split(/^\s*le\s.{0,40}\s+a\s+écrit\s*:/im)[0]
}

/** Opt-out simple : le prospect ne veut plus être contacté. */
export function isExplicitOptOut(text: string): boolean {
  const t = stripOurFooterAndQuotes(text).trim().toLowerCase()
  if (/^stop\b/.test(t)) return true
  if (/^\s*(arr[êe]tez|arr[êe]te)\s*[.!]*\s*$/.test(t)) return true
  return new RegExp(
    [
      'd[ée]sabonn', 'd[ée]sinscri', 'unsubscribe',
      "ne plus (me |nous )?(recevoir|contacter|[ée]crire|solliciter|envoyer)",
      "ne plus recevoir (vos|de|d'|ces)?\\s*(mail|e-?mail|message|sollicit)",
      "retir(ez|er)[- ]?(moi|nous|mon|notre)?.{0,20}(liste|mailing|base|diffusion|fichier|adresse|coordonn)",
      "enlev(ez|er)[- ]?(moi|nous|mon|notre)?.{0,20}(liste|mailing|base|diffusion|fichier|adresse)",
      "arr[êe]tez de (m'|nous |me )?([ée]crire|envoyer|contacter|solliciter|spammer)",
      "plus de (mail|message|sollicit)",
      "cessez de (m'|nous |me )?([ée]crire|envoyer|contacter|solliciter)",
      "je ne souhaite plus",
      "merci de (ne plus|cesser|arr[êe]ter)",
    ].join('|'), 'i').test(t)
}

/**
 * DEMANDE RGPD / plainte : exercice d'un droit ou signalement.
 * Déclenche un traitement RENFORCÉ (aucune réponse automatique, alerte humaine immédiate).
 */
export function isRgpdRequestOrComplaint(text: string): { match: boolean; motif: string | null } {
  const t = stripOurFooterAndQuotes(text).trim().toLowerCase()
  const regles: Array<[string, RegExp]> = [
    ['effacement_donnees', /supprim(ez|er| e)?.{0,25}(donn[ée]es|coordonn[ée]es|information|adresse|fichier|compte)|effac(ez|er).{0,25}(donn[ée]es|coordonn[ée]es|moi|mon adresse|fichier)|droit [àa] l'?oubli|droit [àa] l'?effacement/],
    // ⚠️ `['\s]?` et non `'?` : beaucoup de claviers/mobiles produisent "je m oppose" (espace au
    // lieu de l'apostrophe), et une demande d'opposition ratée est précisément ce qui déclenche
    // une plainte. Même tolérance sur "droit d opposition".
    ['opposition', /je m['\s]?oppose|droit d['\s]?opposition|opposition au traitement|retir(e|ez) mon consentement/],
    ['plainte_cnil', /cnil|autorit[ée] de (contr[ôo]le|protection)|porter? plainte|d[ée]p[ôo]t de plainte|je porte plainte/],
    ['rgpd_explicite', /\brgpd\b|\bgdpr\b|r[èe]glement g[ée]n[ée]ral sur la protection|article 1[74]/],
    ['accusation_spam', /c'?est du spam|vos? (mails?|messages?) sont du spam|spam(mer|ming)|pourriel/],
    ['harcelement', /harc[èe]l|harass|intrusi(f|ve)|abusi(f|ve)/],
    ['menace_juridique', /avocat|poursuit(e|es)? judiciaire|mise en demeure|action en justice|tribunal/],
    ['acces_donnees', /d'?o[ùu] (venez|tenez)[- ]?vous mon|comment avez[- ]?vous (eu|obtenu) (mon|mes)|quelle est (la|votre) source/],
  ]
  for (const [motif, re] of regles) if (re.test(t)) return { match: true, motif }
  return { match: false, motif: null }
}

/**
 * MÉCONTENTEMENT SUR LA PRESSION D'ENVOI — plus faible qu'un opt-out, mais c'est LE signal qui
 * précède le signalement (leçon 106).
 *
 * ⚠️ CAS RÉEL (Hdigiweb, 27/07/26) : « La première façon de faire gagner du temps aux artisans
 * serait de ne pas leur écrire trois mails sur le même sujet en quelques heures, vous ne
 * croyez pas ? ». Ce n'est ni un "stop", ni une demande RGPD : le contact n'a donc PAS été
 * blocklisté. Sa séquence a bien été annulée (il avait répondu), mais une **relance de
 * conversation lui est repartie ensuite** — exactement le comportement qui transforme un agacé
 * en plaignant. Se plaindre du NOMBRE de mails et devoir en plus écrire "stop" pour être
 * tranquille, c'est indéfendable.
 *
 * Politique retenue : on répond une dernière fois (poliment, c'est une objection légitime), mais
 * on n'ENGAGE plus rien — aucune relance de séquence, aucune relance de conversation. On ne
 * blockliste pas non plus : le contact n'a pas demandé à ne plus jamais être contacté, et un
 * blocage silencieux effacerait un lead qui reste commercialement ouvert.
 */
export function isPressionSignalee(text: string): boolean {
  const t = stripOurFooterAndQuotes(text).trim().toLowerCase()
  return [
    // Quantité de mails citée explicitement (chiffres ET lettres : "3 mails", "trois mails").
    /\b(\d+|deux|trois|quatre|cinq|plusieurs|autant de)\s+(e-?)?mails?\b/,
    /\b(\d+|deux|trois|quatre|cinq|plusieurs)\s+(messages?|relances?|fois)\b/,
    // Reproche direct sur la fréquence / l'insistance.
    /trop de (mails?|messages?|relances?|sollicitations?)/,
    /arr[êe]tez de (m'|nous )?(envoyer|[ée]crire|relancer|solliciter)/,
    /vous (m'|nous )?(avez )?(d[ée]j[àa] )?(re)?[ée]criv?(ez|é)|cessez de/,
    /votre insistance|vous insistez|[àa] quel rythme|combien de (mails?|fois)/,
    /(m'|nous )?(en)?voyer (le )?m[êe]me (mail|message)|le m[êe]me sujet/,
  ].some(re => re.test(t))
}

/**
 * Bloc légal ajouté à CHAQUE mail de prospection (art. 13/14 RGPD : la personne doit savoir d'où
 * viennent ses données, qui traite, et comment s'y opposer — surtout quand les données n'ont PAS
 * été collectées auprès d'elle, ce qui est le cas d'un scraping de sources publiques).
 * Ne PAS supprimer : c'est ce bloc qui rend la prospection défendable en cas de contrôle.
 */
export function blocLegalRgpd(): string {
  return [
    '---',
    "Vos coordonnées professionnelles proviennent de sources publiques (votre site internet et votre fiche Google).",
    "Conformément au RGPD, vous pouvez demander leur suppression ou vous opposer à leur traitement",
    'en répondant simplement "Stop" à cet email.',
  ].join('\n')
}
