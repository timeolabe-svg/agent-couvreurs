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

/**
 * NORMALISATION AVANT DÉTECTION — accents aplatis et caractères cassés restitués.
 *
 * ⚠️ ANGLE MORT SIGNALÉ PAR LA SESSION LABEGARIA LE 11/08/2026, VÉRIFIÉ ICI.
 * Les corps de mails arrivant par IMAP contiennent régulièrement des accents ABÎMÉS — l'octet
 * illisible devient U+FFFD (le losange « ? »). Constaté sur de vraies réponses : « l'?quipe »,
 * « ferm?e ». Or nos motifs s'écrivent `d[ée]sabonn`, `arr[êe]tez` : la classe accepte bien la
 * lettre nue, mais PAS U+FFFD. Donc « Merci de me d?sabonner » n'était pas détecté — et une
 * opposition manquée, c'est une relance envoyée à quelqu'un qui a demandé l'arrêt. C'est
 * exactement le motif de la plainte CNIL du 06/08.
 *
 * Trois traitements, dans cet ordre :
 *  1. apostrophes typographiques → apostrophe simple ;
 *  2. U+FFFD → « e » : le caractère perdu est presque toujours é/è/ê, le remplacer restitue le mot ;
 *  3. décomposition NFD + suppression des diacritiques.
 *
 * Sûr pour TOUS les motifs existants : ils s'écrivent déjà `[ée]`, `[êe]`, `[àa]`, `[ôo]` — des
 * classes qui contiennent la lettre nue. Aplatir les accents ne peut donc rien casser, seulement
 * élargir ce qui est reconnu.
 */
export function normalizeForDetection(text: string): string {
  return (text || '')
    .replace(/[’‘`´]/g, "'")
    .replace(/�/g, 'e')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Retire notre pied de page et tout ce qui suit un marqueur de citation, normalise les apostrophes. */
export function stripOurFooterAndQuotes(text: string): string {
  // ⚠️ INCIDENT 10/08/2026 — CE FILTRE LAISSAIT PASSER NOTRE PROPRE PIED DE PAGE.
  //
  // Le motif cherchait « vos coordonnées SONT publiques » alors que le bloc légal réellement
  // envoyé dit « vos coordonnées professionnelles PROVIENNENT DE SOURCES publiques […]
  // Conformément au RGPD […] ». Le texte n'était donc jamais coupé, et le mot « RGPD » de NOTRE
  // mention se retrouvait analysé comme si le prospect l'avait écrit.
  //
  // Conséquence mesurée : un prospect répondant « Oui je suis très intéressé, appelez-moi ! » —
  // en citant notre mail, ce que fait tout client mail par défaut — était détecté comme une
  // DEMANDE RGPD, donc blocklisté et sa séquence annulée. Le lead le plus chaud possible, tué par
  // notre propre signature. C'est le symétrique exact du bug des « Stop » ignorés : le même filtre
  // ratait les vraies demandes et en inventait de fausses.
  //
  // Règle : on coupe au PREMIER marqueur de citation rencontré, quel qu'il soit, et on liste les
  // phrases de nos pieds de page par leur DÉBUT (les formulations évoluent, les débuts moins).
  // La normalisation se fait ICI, en amont de tout : les marqueurs de citation (`a [ée]crit`,
  // `envoy[ée] :`) sont eux aussi aveugles aux accents cassés. Un mail cité dont le marqueur n'est
  // pas reconnu, c'est notre propre pied de page analysé comme s'il venait du prospect — le bug
  // du 10/08, qui blocklistait les leads les plus chauds.
  let t = normalizeForDetection(text)

  // 1) Toute ligne de citation « > … » : tout ce qui suit appartient à notre message.
  const ligneCitee = t.search(/^\s*>/m)
  if (ligneCitee > 0) t = t.slice(0, ligneCitee)

  // 2) Marqueurs de réponse des clients mail (accents tolérés : « a écrit » / « a ecrit »).
  for (const re of [
    /(?:^|\s)le\s[\s\S]{0,90}?\sa\s+[ée]crit\s*:/i,
    /(?:^|\s)on\s[\s\S]{0,90}?\swrote\s*:/i,
    /-{2,}\s*(message d'origine|original message)\s*-{2,}/i,
    /(?:^|\s)de\s*:[\s\S]{0,250}?envoy[ée]\s*:/i,
    /(?:^|\s)from\s*:[\s\S]{0,250}?sent\s*:/i,
    /envoy[ée]\s+de\s+mon\s+/i,
    /(?:^|\s)_{5,}/,
  ]) {
    const m = t.match(re)
    if (m && m.index !== undefined && m.index > 0) t = t.slice(0, m.index)
  }

  // 3) NOS pieds de page, repérés par leur début — c'est la partie qui avait dérivé.
  for (const re of [
    /pour ne plus recevoir mes emails/i,
    /vos coordonn[ée]es (professionnelles )?(sont|proviennent)/i,
    /conform[ée]ment au rgpd, vous pouvez/i,
    /pour ne plus [êe]tre contact[ée]/i,
  ]) {
    const i = t.search(re)
    if (i > 0) t = t.slice(0, i)
  }

  return t
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
export function blocLegalRgpd(lienDesabo?: string): string {
  const lignes = [
    '---',
    "Vos coordonnées professionnelles proviennent de sources publiques (votre site internet et votre fiche Google).",
    "Conformément au RGPD, vous pouvez demander leur suppression ou vous opposer à leur traitement",
    'en répondant simplement "Stop" à cet email.',
  ]
  // ⚠️ Le lien vient EN PLUS de « répondez Stop », jamais à la place. Répondre reste le geste le
  // plus naturel, et certaines messageries d'entreprise réécrivent ou neutralisent les liens.
  // Deux chemins valent mieux qu'un pour exercer un droit.
  if (lienDesabo) lignes.push('', `Se désabonner en un clic : ${lienDesabo}`)
  return lignes.join('\n')
}

/**
 * NÉGOCIATION COMMERCIALE — le prospect propose un AUTRE modèle de rémunération.
 *
 * ⚠️ CAS RÉEL (07/08/26) : « si vous montez un site qui fonctionne très bien, vous gérez tout, je
 * vous donne 20 % de mon bénéfice ». L'agent a répondu en engageant l'offre du client
 * (« accompagnement mensuel fixe », « premier mois offert »). Or accepter, refuser ou aménager un
 * modèle de rémunération n'est pas une tâche d'agent : c'est une décision de chef d'entreprise.
 *
 * Une réponse automatique ici ne risque pas d'être mal écrite — elle risque de FERMER une porte,
 * ou d'engager le client sur des conditions qu'il n'a pas validées. Dans les deux cas c'est
 * irrattrapable, alors qu'attendre 24 h ne coûte rien.
 *
 * Volontairement LARGE : un faux positif coûte une relecture, un faux négatif coûte un engagement
 * pris au nom de quelqu'un d'autre.
 */
export function isNegociationCommerciale(text: string): boolean {
  const t = stripOurFooterAndQuotes(text)
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/ /g, ' ')
  return [
    // Partage de revenu / commission proposé par le prospect.
    /\b\d{1,2}\s*%\s*(de\s+)?(mon|nos|notre|mes|le|du)\s*(benefice|benefices|marge|ca|chiffre|resultat|gain)/,
    /je\s+vous\s+(donne|reverse|laisse|verse)\b.{0,25}%/,
    /(commission|pourcentage|interessement|partage)\b.{0,30}(benefice|marge|ca|chiffre|resultat|vente)/,
    /au\s+(pourcentage|prorata)\b/,
    // Association / partenariat plutôt qu'une prestation payée.
    /\b(association|associer|partenariat|partenaire|co[- ]?fondateur|equity|parts?\s+de\s+(la\s+)?societe)\b.{0,40}(plutot|au lieu|a la place|contre)/,
    /\bon\s+s['\s]?associe\b/,
    // Troc / échange de services.
    /\b(echange|troc)\b.{0,30}(service|prestation|travaux|chantier)/,
    // Contre-proposition explicite sur le prix ou le modèle.
    // ⚠️ Motif ÉLARGI (test unitaire) : la première version exigeait « que » ou « qu' » entre le
    // verbe et « au résultat », donc « je paie uniquement au résultat » — la formulation la plus
    // courante — passait au travers. On accepte n'importe quel adverbe intercalé.
    /je\s+(ne\s+)?(paie|paye|paierai|payerai)\b.{0,25}au\s+resultat/,
    /pay(er|e|ez)\s+(uniquement|seulement|que|qu[' ]?)\b.{0,25}(au\s+resultat|si\s+(ca|cela)\s+marche)/,
    /votre\s+(tarif|prix|offre)\b.{0,30}(trop|revoir|negocier|baisser)/,
  ].some(re => re.test(t))
}

/**
 * ADRESSES VISÉES PAR UNE DEMANDE D'ARRÊT — extraites du TEXTE du message.
 *
 * ⚠️ INCIDENT 04-09/08/2026, découvert le 10/08. Un prospect écrit :
 *   « je vous remercie de SUPPRIMER contact@france-valley.com de toutes vos listes de diffusion »
 * …mais il l'écrit depuis SON adresse personnelle, guillaume.toussaint@france-valley.com.
 * Le code blocklistait l'expéditeur et annulait la file « du contact dont l'email = expéditeur » —
 * or ce contact n'existait pas. Résultat : l'adresse réellement démarchée
 * (contact@france-valley.com) n'a été ni bloquée ni purgée, et l'agent lui a envoyé DEUX relances
 * de plus, avec trois autres programmées. La personne avait pourtant écrit « Stop » en toutes
 * lettres, deux fois.
 *
 * Leçon : celui qui ÉCRIT n'est pas toujours celui qu'on DÉMARCHE. Une boîte générique
 * (contact@, info@, accueil@) est relevée par un humain qui répond avec son adresse nominative.
 * Un opt-out appliqué au seul expéditeur rate donc systématiquement ce cas — le plus courant en
 * B2B. On récupère toutes les adresses citées dans le message pour les traiter aussi.
 */
export function adressesCiteesDansLeMessage(text: string, domainesAExclure: string[] = []): string[] {
  const t = stripOurFooterAndQuotes(text || '')
  const brut = t.match(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g) ?? []
  const exclus = domainesAExclure.map(d => d.toLowerCase())
  const out = new Set<string>()
  for (const a of brut) {
    const mail = a.toLowerCase()
    const dom = mail.split('@')[1] ?? ''
    if (!dom) continue
    // Jamais nos propres adresses, ni les adresses techniques.
    if (exclus.some(d => dom === d || dom.endsWith('.' + d))) continue
    if (/mailer-daemon|postmaster|no[-.]?reply|do[-.]?not[-.]?reply/i.test(mail)) continue
    out.add(mail)
  }
  return [...out]
}

/** Domaines grand public : deux adresses n'y ont AUCUN lien entre elles (jamais de blocage par domaine). */
const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.fr', 'yahoo.com', 'hotmail.fr', 'hotmail.com',
  'outlook.fr', 'outlook.com', 'live.fr', 'msn.com', 'aol.com', 'orange.fr', 'wanadoo.fr',
  'free.fr', 'sfr.fr', 'neuf.fr', 'bbox.fr', 'laposte.net', 'icloud.com', 'me.com', 'gmx.fr',
])

/**
 * Le domaine d'une adresse professionnelle identifie l'ENTREPRISE : si quelqu'un de
 * @france-valley.com demande l'arrêt, le contact @france-valley.com qu'on démarche est visé.
 * Faux sur un domaine grand public (deux gmail n'ont rien à voir) → on refuse dans ce cas.
 */
export function domaineExploitable(email: string): string | null {
  const dom = (email || '').toLowerCase().split('@')[1] ?? ''
  if (!dom || FREEMAIL.has(dom)) return null
  return dom
}
