import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * IMPORT D'UN FICHIER DE LEADS (Excel ou CSV) — analyse d'abord, import ensuite.
 *
 * ⚠️ Pourquoi ce chemin n'existait pas : le bouton « Importer » de la page Prospects renvoyait sur
 * /leads, qui n'a aucun champ fichier. L'endpoint d'import existait, rien ne l'appelait. Timéo
 * devait donc passer par quelqu'un pour charger ses leads — sur l'opération la plus banale du
 * métier.
 *
 * DEUX TEMPS, VOLONTAIREMENT SÉPARÉS :
 *   POST (défaut)        → ANALYSE seule. Rien n'est écrit. On répond : combien de lignes, quelles
 *                          colonnes reconnues, combien passent le seuil d'avis, combien sont déjà
 *                          en base, combien de concurrents. C'est le chiffre AVANT décision.
 *   POST ?importer=1     → charge réellement dans le tampon outscraper_leads.
 *
 * Analyser avant d'écrire n'est pas une politesse : un import de 1 000 lignes engage des envois
 * réels à des entreprises réelles. On regarde ce qu'on a avant, pas après.
 */

/** Noms de colonnes acceptés — les exports Google Maps / Outscraper varient beaucoup. */
const ALIAS: Record<string, string[]> = {
  name: ['name', 'nom', 'company', 'entreprise', 'societe', 'société', 'business', 'title', 'raison sociale'],
  site: ['site', 'website', 'site web', 'url', 'web', 'site internet', 'domain'],
  phone: ['phone', 'telephone', 'téléphone', 'tel', 'tél', 'mobile', 'phone_1', 'numero'],
  city: ['city', 'ville', 'commune', 'locality', 'localite'],
  postal_code: ['postal_code', 'code postal', 'cp', 'zip', 'postcode'],
  reviews: ['reviews', 'avis', 'nb avis', 'nombre avis', 'reviews_count', 'user_ratings_total', 'nombre d\'avis'],
  rating: ['rating', 'note', 'score', 'etoiles', 'étoiles', 'stars'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'email_1'],
  // ⚠️ PAS d'alias `id` : un export quelconque numérote souvent ses lignes 1, 2, 3… et cette
  // colonne deviendrait la clé primaire. Un second fichier renuméroté à partir de 1 serait alors
  // AVALÉ EN ENTIER par le `ON CONFLICT DO NOTHING` — zéro ligne importée, aucune erreur.
  place_id: ['place_id', 'placeid', 'google_id'],
  // ⚠️ Les trois colonnes suivantes ne servaient à RIEN avant le 11/08 — elles n'étaient même pas
  // lues. Elles portent pourtant deux filtres indispensables (cf. plus bas) : le métier réel de
  // l'entreprise et le fait qu'elle soit encore ouverte.
  category: ['category', 'categorie', 'catégorie', 'type', 'activite', 'activité'],
  subtypes: ['subtypes', 'sous-types', 'sous types', 'types', 'categories', 'catégories'],
  business_status: ['business_status', 'statut', 'status', 'etat', 'état'],
  // La requête d'origine (« pisciniste, 06001 CEDEX 1, Nice, … ») : dernier recours pour connaître
  // le métier quand Google laisse la catégorie vide.
  query: ['query', 'requete', 'requête', 'search', 'recherche', 'keyword'],
}

/**
 * ENTREPRISES HORS MÉTIER — le filtre qui manquait, et il manquait beaucoup.
 *
 * ⚠️ MESURE DU 11/08/2026 sur un export réel de 3 000 fiches (« pisciniste » + « terrassier »).
 * Sur les 1 236 fiches que l'import considérait comme exploitables, **499 n'étaient pas des
 * entreprises du bâtiment** : 58 hôtels, 74 « attractions », 35 piscines municipales, 34
 * restaurants, 32 spas, 24 clubs de sport, des kinés, des agences de voyage, un opticien.
 *
 * La raison est structurelle, pas accidentelle : Google Maps répond à « pisciniste » par tout ce
 * qui a un rapport avec une piscine — donc les lieux qui EN POSSÈDENT une, pas seulement ceux qui
 * en CONSTRUISENT. Aucun réglage d'Outscraper ne corrige ça ; ça se filtre à l'import.
 *
 * Deux fiches sur cinq partaient donc en prospection « refonte de site pour artisan » vers des
 * hôtels et des salles de sport. Ce n'est pas seulement du budget perdu : c'est un mail hors sujet
 * envoyé au nom du client, qui abîme sa réputation d'expéditeur autant que la sienne.
 *
 * On procède par EXCLUSION et non par liste blanche, volontairement : un artisan peut être rangé
 * par Google sous un libellé inattendu (« Travaux généraux », « Entrepreneur », vide…), et une
 * liste blanche l'écarterait en silence. Mieux vaut laisser passer une brasserie que jeter un
 * maçon — le premier cas se voit, le second jamais.
 */
const HORS_METIER = new RegExp([
  // Hébergement, restauration, loisirs — le gros du bruit d'une requête « pisciniste »
  'hotel|hôtel|restaurant|brasserie|traiteur|attraction|\\bbars?\\b|discoth|salle de concert|salle de spectacle',
  'camping|parc de loisirs|bowling|cinema|cinéma|casino|karting|paintball',
  // Bien-être, sport, santé — l'autre moitié du bruit
  '\\bspa\\b|hammam|sauna|massage|bronzage|institut de beaut|coiffure|onglerie|tatouage',
  'fitness|\\bgym\\b|salle de sport|club de sport|complexe sportif|aquabike|articles de sports',
  'natation|plongee|plongée|tennis|golf|equitation|équitation|\\bjudo\\b|\\bdanse\\b',
  'kinesitherapeute|kinésithérapeute|osteopathe|ostéopathe|chirurgien|medecin|médecin|dentiste|veterinaire|vétérinaire',
  'bien-etre|bien-être|centre de r[eé][eé]ducation|clinique|laboratoire|pharmacie|opticien|audioprothes',
  // Bassins qui ne sont pas des chantiers : municipaux, hôteliers, parcs
  'aquatique|piscine couverte|piscine ext[eé]rieure|centre aquatique|parc aquatique',
  // Commerce de détail et enseignes — Castorama, Bricorama, Truffaut, GiFi sont passés par là
  'do-it-yourself|bricolage|jardinerie|animalerie|ameublement|d[eé]coration|electromenager|électroménager',
  'supermarch|hypermarch|epicerie|épicerie|boulangerie|boucherie|primeur|caviste|tabac|presse',
  'vetements|vêtements|chaussures|lingerie|bijouterie|horlogerie|librairie|jouets|cartes de collection',
  'magasin discount|grand magasin|centre commercial|station-service|concession|garage automobile',
  // Services, institutions, formation — rien à vendre pour une agence web d'artisans
  'agence de voyage|agence immobili|maisons de vacances|vacation rental|location de maisons|\\bposte\\b',
  'coll[eè]ge|lyc[eé]e|universit|[eé]cole|formation|auto-[eé]cole|cr[eè]che|garderie',
  'mairie|administration publique|prefecture|préfecture|tribunal|commissariat|caserne|hopital|hôpital',
  'centre culturel|mus[eé]e|biblioth[eè]que|th[eé][aâ]tre|[eé]glise|temple|synagogue|mosqu',
  'cabinet de recrutement|cabinet comptable|avocat|notaire|assurance|banque|mutuelle',
  'fabricant de|grossiste',
  // ⚠️ Google rend parfois la catégorie dans une AUTRE LANGUE que le pays interrogé (« Do-it-
  // yourself shop », « Negozio di forniture », « Real estate agency ») — un filtre uniquement
  // francophone laisse donc passer une queue entière de fiches hors sujet.
  'real estate|travel agency|sports club|art gallery|bed & breakfast|guest house|tourist',
  'grocery|clothing store|book store|beauty salon|hair salon|night club|fitness center',
  // Lieux et structures qui ne sont pas des entreprises artisanales
  'parc citadin|parc des expositions|espace [eé]v[eé]nementiel|organisateur d [eé]v[eé]nements',
  'coworking|maison d h[oô]tes|appartement de vacances|complexe d appartements|galerie d art',
  'prestataire de mariage|agence de visites|bureau de s[eé]curit[eé] sociale|administration',
  '\\bjardin\\b|club de |atelier de couture|magasin d articles de f[eê]te|appareils auditifs',
].join('|'), 'i')

/**
 * PLAFOND D'AVIS — le filtre qui attrape ce qu'aucune catégorie ne trahit.
 *
 * ⚠️ Après avoir posé le filtre métier, l'agent a quand même importé « La Cigale » (salle de
 * concert, 6 622 avis), « Castorama » (5 782), « La Poste » (2 556) et « Paradis Latin » (2 154,
 * catégorie VIDE — donc invisible à tout filtre de libellé).
 *
 * Le point commun n'est pas le métier, c'est la TAILLE. Un artisan pisciniste ou terrassier avec
 * 600 avis Google n'existe pas : au-delà, on a affaire à une enseigne, une franchise ou un lieu
 * public. Et c'est justement le signal le plus fiable, parce qu'il ne dépend pas d'un libellé que
 * Google peut laisser vide ou écrire en anglais (« Do-it-yourself shop »).
 *
 * On perd au passage une vingtaine de gros indépendants réels (Cash Pools, Waterair). Perte
 * assumée : à ce niveau de notoriété ils ont déjà une agence, ce sont les prospects les moins
 * susceptibles de signer — alors qu'un mail « refonte de votre site » envoyé à La Poste au nom du
 * client, ça, ça se paie en crédibilité.
 */
const PLAFOND_AVIS = 600

/**
 * Certaines catégories ne sont hors sujet que lorsqu'elles sont SEULES. « Piscine » tout court, chez
 * Google, désigne un bassin — la piscine municipale, celle d'un camping — alors que « Société de
 * construction de piscine » désigne bien un installateur. Un simple test de sous-chaîne écarterait
 * les deux ou n'écarterait ni l'un ni l'autre : il faut comparer la catégorie ENTIÈRE.
 */
const CATEGORIE_SEULE_KO = new Set([
  'piscine', 'club', 'magasin', 'boutique', 'association ou organisation', 'siege social',
  'entreprise', 'societe', 'service', 'attractions', 'point d interet', 'batiment',
])

/**
 * Google marque les fiches fermées. On ne les écartait pas : 127 fermetures définitives et 54
 * fermetures temporaires dans le même export. Écrire à une entreprise fermée, c'est un mail qui
 * rebondit — et le taux de rebond dégrade la réputation des boîtes d'envoi.
 */
/**
 * MÉTIER NORMALISÉ — ce qui sera écrit dans `contacts.sector`, donc ce qui décidera du vocabulaire
 * du mail envoyé au prospect. On le déduit de la catégorie Google, et à défaut de la requête
 * d'origine (colonne `query` d'Outscraper : « pisciniste, 06001 CEDEX 1, Nice… »).
 *
 * Le repli n'est pas « terrassier » mais « artisan du bâtiment » : un métier faux est pire qu'un
 * métier générique, parce qu'il produit un mail confiant et à côté de la plaque.
 */
function deduireMetier(categorie: string, requete: string): string {
  const t = sansAccents(`${categorie} ${requete}`)
  if (/piscine|pisciniste|swimming pool/.test(t)) return 'pisciniste'
  if (/terrassement|terrassier|excavat/.test(t)) return 'terrassier'
  if (/travaux publics|\bvrd\b|voirie/.test(t)) return 'entreprise de travaux publics'
  if (/paysagiste|paysager|jardinier|elagage/.test(t)) return 'paysagiste'
  if (/assainissement|eaux usees|saneamiento/.test(t)) return 'entreprise d assainissement'
  if (/plombier|plumber|chauffagiste|heating/.test(t)) return 'plombier'
  if (/macon|maconnerie|beton/.test(t)) return 'maçon'
  if (/couvreur|toiture|charpent/.test(t)) return 'couvreur'
  if (/menuisier|menuiserie/.test(t)) return 'menuisier'
  if (/carrelage|carreleur/.test(t)) return 'carreleur'
  if (/demolition|forage|pavage/.test(t)) return 'entreprise de terrassement'
  return 'artisan du bâtiment'
}

function estFermee(statut: string): boolean {
  const s = String(statut ?? '').trim().toUpperCase()
  return s.startsWith('CLOSED')
}

/**
 * On compare SANS accents ni apostrophes : un export écrit aussi bien « Nombre d'avis » que
 * « nombre d avis » ou « NOMBRE D'AVIS ». Une colonne ratée, c'est une donnée perdue en silence —
 * et le téléphone d'un fichier français a justement échoué au premier test.
 */
function sansAccents(s: string): string {
  return String(s ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/['’.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normaliserEntete(h: string): string | null {
  const n = sansAccents(h)
  for (const [champ, alias] of Object.entries(ALIAS)) {
    if (alias.some(a => sansAccents(a) === n)) return champ
  }
  return null
}

function estConcurrent(texte: string): boolean {
  const t = (texte || '').toLowerCase()
  return /\b(agence|studio|agency)\b[^.]{0,30}\b(com|communication|marketing|pub|publicit[ée]|digital|cr[ée]a|web|seo|sea|r[ée]f[ée]rencement|design|prospection|commerciale?)\b/.test(t)
      || /\b(web\s?agency|webdesign|cr[ée]ation\s+de\s+sites?|refonte\s+de\s+sites?|d[ée]veloppement\s+web|community\s+manager|g[ée]n[ée]ration\s+de\s+leads?)\b/.test(t)
}

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const form = await req.formData().catch(() => null)
  const fichier = form?.get('fichier')
  if (!fichier || typeof fichier === 'string') {
    return NextResponse.json({ error: 'aucun fichier reçu (champ "fichier")' }, { status: 400 })
  }

  const buf = Buffer.from(await (fichier as File).arrayBuffer())
  let lignes: Record<string, unknown>[] = []
  try {
    // ⚠️ codepage 65001 (UTF-8) OBLIGATOIRE : sans lui, un CSV francais est lu en ANSI et l entete
    // "Telephone" arrive en "TÃ©lÃ©phone" — la colonne devient invisible. Teste : la colonne
    // telephone d un export FR standard n etait PAS reconnue.
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 })
    const feuille = wb.Sheets[wb.SheetNames[0]]
    lignes = XLSX.utils.sheet_to_json(feuille, { defval: '' })
  } catch (e) {
    return NextResponse.json({ error: 'fichier illisible : ' + String(e).slice(0, 150) }, { status: 400 })
  }
  if (lignes.length === 0) return NextResponse.json({ error: 'fichier vide' }, { status: 400 })

  // Correspondance des colonnes, et surtout : ce qu'on N'A PAS reconnu (le plus utile à afficher).
  const entetes = Object.keys(lignes[0])
  const mapping: Record<string, string> = {}
  const nonReconnues: string[] = []
  for (const h of entetes) {
    const champ = normaliserEntete(h)
    if (champ && !mapping[champ]) mapping[champ] = h
    else if (!champ) nonReconnues.push(h)
  }
  if (!mapping.name) {
    return NextResponse.json({
      error: 'colonne du NOM d\'entreprise introuvable — impossible d\'importer',
      entetes_trouvees: entetes,
      noms_acceptes: ALIAS.name,
    }, { status: 400 })
  }

  const val = (l: Record<string, unknown>, champ: string): string => {
    const col = mapping[champ]
    return col ? String(l[col] ?? '').trim() : ''
  }
  const nombre = (s: string): number => {
    const n = parseInt(String(s).replace(/[^\d]/g, ''), 10)
    return Number.isFinite(n) ? n : 0
  }

  const SEUIL_AVIS = 20
  const { sql } = await import('@/lib/db')

  // Ce qui est DÉJÀ en base : on ne veut pas annoncer comme neuf ce qu'on connaît déjà.
  const sitesConnus = new Set(
    ((await sql`SELECT LOWER(site) AS site FROM outscraper_leads WHERE site IS NOT NULL`) as Array<{ site: string }>)
      .map(r => r.site),
  )
  const nomsConnus = new Set(
    ((await sql`SELECT LOWER(company) AS c FROM contacts`) as Array<{ c: string }>).map(r => r.c),
  )
  /**
   * ⚠️ LE SITE N'EST PAS L'IDENTITÉ D'UN PROSPECT — SON ADRESSE L'EST.
   *
   * Mesuré sur un fichier de 871 fiches (14/08) : 264 étaient écartées comme « déjà en base » sur
   * 40 villes pourtant neuves. La cause est le réseau de franchise — dix agences « Piscines de
   * France » partagent un seul site national, donc neuf étaient jetées.
   *
   * Le tri par site a souvent raison : 237 lignes de ce fichier partagent réellement UNE SEULE
   * boîte mail (`irri77mea@irripiscine.fr` revient 31 fois). Les contacter séparément enverrait
   * 31 messages à la même personne.
   *
   * Mais il a tort quand l'agence possède sa PROPRE adresse tout en affichant le site du réseau :
   * c'est une entreprise distincte, un interlocuteur distinct, et on la jetait.
   *
   * Règle : quand le fichier fournit un email, c'est LUI qui décide. Site et nom ne servent de
   * repère que faute de mieux.
   */
  const emailsConnus = new Set(
    ((await sql`
      SELECT LOWER(email) AS e FROM contacts WHERE email IS NOT NULL
      UNION SELECT LOWER(email) FROM outscraper_leads WHERE email IS NOT NULL
    `) as Array<{ e: string }>).map(r => r.e),
  )

  let sansNom = 0, concurrents = 0, dejaConnus = 0, sousSeuil = 0, sansSite = 0, exploitables = 0
  let fermees = 0, horsMetier = 0, enseignes = 0
  const exemplesHorsMetier: string[] = []
  const exemplesEnseignes: string[] = []
  const aCharger: Array<Record<string, unknown>> = []

  /**
   * ⚠️ ON NE JETTE PLUS RIEN — on classe.
   *
   * Jusqu'ici, tout ce qui ne passait pas les filtres était simplement COMPTÉ puis abandonné : sur
   * un fichier de 288 lignes, 165 disparaissaient. Or elles ont été payées, et surtout la plus
   * grosse part (129 lignes) l'était pour « moins de 20 avis » — un critère TEMPORAIRE. Ce sont
   * précisément les fiches que le réveil automatique doit rattraper quand elles franchissent le
   * seuil… mais elles n'étaient jamais entrées en base, donc il n'y avait rien à réveiller.
   *
   * Désormais chaque ligne est écrite avec un STATUT qui dit pourquoi elle n'est pas démarchée.
   * Seul `new` alimente la prospection ; les autres dorment et restent consultables. Garder coûte
   * quelques octets, rejeter coûte une donnée achetée.
   */
  const enregistrer = (l: Record<string, unknown>, nom: string, avis: number, statut: string) => {
    const site = val(l, 'site')
    const categorie = val(l, 'category')
    aCharger.push({
      place_id: val(l, 'place_id') || `imp-${Buffer.from(nom + site).toString('base64').slice(0, 40)}`,
      name: nom, site, phone: val(l, 'phone'), city: val(l, 'city'),
      postal_code: val(l, 'postal_code'), rating: parseFloat(val(l, 'rating')) || null, reviews: avis,
      category: categorie || null, sector: deduireMetier(categorie, val(l, 'query')),
      email: val(l, 'email') || null,
      statut,
    })
  }

  for (const l of lignes) {
    const nom = val(l, 'name')
    // Sans nom, la fiche n'est identifiable par rien : c'est la seule qu'on abandonne vraiment.
    if (!nom) { sansNom++; continue }
    const avisLigne = nombre(val(l, 'reviews'))
    // ⚠️ Le test portait sur le NOM seul : « Linkeo » ne dit rien, sa CATÉGORIE dit « Agence de
    // marketing ». Un concurrent direct entrait donc dans la file d'envoi du client.
    if (estConcurrent(nom) || estConcurrent(val(l, 'category'))) {
      concurrents++; enregistrer(l, nom, avisLigne, 'concurrent'); continue
    }
    if (estFermee(val(l, 'business_status'))) {
      fermees++; enregistrer(l, nom, avisLigne, 'ferme'); continue
    }
    // Le métier se lit sur la catégorie ET les sous-types : Google range parfois l'activité
    // réelle dans le second seulement.
    // ⚠️ ON NE TESTE QUE LA CATÉGORIE PRINCIPALE. Croiser aussi les `subtypes` paraissait plus sûr —
    // c'est l'inverse. Un vrai pisciniste porte couramment « Spa », « Hot tub store » ou « Garden
    // furniture shop » dans ses sous-types : le premier essai écartait « Magiline Rueil-Malmaison »
    // et « Piscines Ibiza Cergy », deux cibles parfaites, sur la présence du mot « Spa ». Les
    // sous-types sont un sac d'étiquettes voisines, pas une déclaration d'activité.
    // On ne s'en sert qu'en dernier recours, quand la catégorie est vide.
    const categorie = val(l, 'category')
    const metier = categorie || val(l, 'subtypes')
    if (HORS_METIER.test(metier) || CATEGORIE_SEULE_KO.has(sansAccents(categorie))) {
      horsMetier++
      if (exemplesHorsMetier.length < 8) exemplesHorsMetier.push(`${nom} — ${val(l, 'category')}`)
      // Conservées : ce sont de mauvaises cibles pour Hdigiweb, pas pour tout le monde. C'est ce
      // vivier qu'exporte /api/admin/export-vers-labegaria.
      enregistrer(l, nom, avisLigne, 'hors_metier')
      continue
    }
    const site = val(l, 'site')
    const avis = nombre(val(l, 'reviews'))
    if (avis > PLAFOND_AVIS) {
      enseignes++
      if (exemplesEnseignes.length < 8) exemplesEnseignes.push(`${nom} — ${avis} avis`)
      enregistrer(l, nom, avis, 'enseigne')
      continue
    }
    /**
     * ⚠️ ON NE SAUTE PLUS LES FICHES DÉJÀ CONNUES — on les fait passer par l'écriture.
     *
     * Elles étaient écartées ici, avant la requête d'insertion. Conséquence : le nombre d'avis
     * qu'on venait d'acheter dans le nouveau fichier n'atteignait JAMAIS la base, et les 400 fiches
     * dormant en `skipped_lowreviews` ne pouvaient pas se réveiller — le rafraîchissement posé sur
     * le `ON CONFLICT` n'aurait servi à rien.
     *
     * Elles ne comptent pas comme exploitables (ce ne sont pas de nouveaux prospects), mais elles
     * traversent l'écriture pour que leurs avis soient remis à jour gratuitement.
     */
    /**
     * L'ADRESSE PRIME SUR LE SITE. Trois cas, dans cet ordre :
     *  1. le fichier donne un email DÉJÀ connu → doublon certain, on écarte ;
     *  2. le fichier donne un email INCONNU → prospect distinct, on garde MÊME si le site ou le
     *     nom ressemblent à quelque chose de connu (cas des agences de réseau) ;
     *  3. pas d'email → on retombe sur l'ancien repère site/nom, faute de mieux.
     */
    const mailFichier = val(l, 'email').toLowerCase()
    const doublonCertain = mailFichier && emailsConnus.has(mailFichier)
    const doublonProbable = !mailFichier
      && (sitesConnus.has(site.toLowerCase()) || nomsConnus.has(nom.toLowerCase()))
    if (doublonCertain || doublonProbable) {
      dejaConnus++
      enregistrer(l, nom, avis, 'deja_en_base')
      continue
    }
    // Un même fichier peut lister 31 agences derrière une seule boîte mail : on ne garde que la
    // première, sinon on créerait 31 prospects qui écrivent tous à la même personne.
    if (mailFichier) emailsConnus.add(mailFichier)
    // ⚠️ LE STATUT LE PLUS IMPORTANT DE TOUS. « Moins de 20 avis » est un critère TEMPORAIRE : ces
    // fiches franchiront le seuil un jour, et le rafraîchissement les remettra seules en 'new'.
    // Les jeter revenait à racheter plus tard, au prix fort, ce qu'on avait déjà payé.
    if (avis < SEUIL_AVIS) { sousSeuil++; enregistrer(l, nom, avis, 'skipped_lowreviews'); continue }
    /**
     * ⚠️ On jetait toute fiche sans site — y compris celles qui portaient DÉJÀ une adresse email
     * dans le fichier, et l'email reconnu n'était de toute façon jamais enregistré. Un export
     * enrichi (ou une base rachetée) dont l'email EST la colonne utile n'importait donc rien.
     * Le site ne sert qu'à TROUVER l'email ; l'avoir déjà rend le site superflu.
     */
    const email = val(l, 'email')
    if (!site && !email) { sansSite++; enregistrer(l, nom, avis, 'no_website'); continue }
    exploitables++
    enregistrer(l, nom, avis, 'new')
  }

  const analyse = {
    lignes_dans_le_fichier: lignes.length,
    colonnes_reconnues: mapping,
    colonnes_ignorees: nonReconnues,
    ecartes: {
      sans_nom: sansNom,
      concurrents: concurrents,
      fermees_definitivement: fermees,
      hors_metier: horsMetier,
      enseignes_trop_grosses: enseignes,
      deja_en_base: dejaConnus,
      moins_de_20_avis: sousSeuil,
      sans_site_web: sansSite,
    },
    exemples_hors_metier: exemplesHorsMetier,
    exemples_enseignes: exemplesEnseignes,
    EXPLOITABLES: exploitables,
    taux: lignes.length ? Math.round((exploitables / lignes.length) * 100) + '%' : '0%',
  }

  if (req.nextUrl.searchParams.get('importer') !== '1') {
    return NextResponse.json({ ok: true, mode: 'analyse', ...analyse, apercu: aCharger.slice(0, 5) })
  }

  /**
   * ⚠️ UN ALLER-RETOUR PAR LIGNE NE PASSE PAS L'ÉCHELLE — mesuré, pas supposé : l'import réel de
   * 631 lignes a pris 60,4 s, soit très exactement le `maxDuration` de cette route. Le fichier
   * décrit dans les commentaires en fait 3 000 : la fonction aurait été tuée en pleine boucle,
   * sans résumé, sans point de reprise, et avec une partie des lignes déjà écrites — l'utilisateur
   * ne saurait ni combien ont été chargées, ni s'il peut relancer sans doubler.
   *
   * On insère par paquets, avec un budget de temps. Ce qui n'a pas été chargé est ANNONCÉ : un
   * import tronqué qui se présente comme complet est exactement le genre d'écran qui ment.
   */
  const started = Date.now()
  const BUDGET_MS = 45_000
  const PAQUET = 50
  let charges = 0
  let rafraichies = 0
  let reveilles = 0
  let traitees = 0

  for (let i = 0; i < aCharger.length; i += PAQUET) {
    if (Date.now() - started > BUDGET_MS) break
    const lot = aCharger.slice(i, i + PAQUET)
    const res = (await sql`
      INSERT INTO outscraper_leads (place_id, name, site, phone, city, postal_code, rating, reviews, category, sector, email, status)
      SELECT x.place_id, x.name, x.site, NULLIF(x.phone, ''), NULLIF(x.city, ''), NULLIF(x.postal_code, ''),
             NULLIF(x.rating, '')::real, x.reviews::int, NULLIF(x.category, ''), x.sector,
             NULLIF(x.email, ''), x.statut
      FROM jsonb_to_recordset(${JSON.stringify(lot.map(r => ({
        place_id: r.place_id, name: r.name, site: r.site, phone: r.phone ?? '', city: r.city ?? '',
        postal_code: r.postal_code ?? '', rating: r.rating === null ? '' : String(r.rating),
        reviews: String(r.reviews), category: r.category ?? '', sector: r.sector, email: r.email ?? '',
        statut: r.statut ?? 'new',
      })))}::jsonb)
        AS x(place_id text, name text, site text, phone text, city text, postal_code text,
             rating text, reviews text, category text, sector text, email text, statut text)
      -- DO NOTHING jetait une information qu'on venait de payer : 400 fiches dorment en
      -- skipped_lowreviews, ecartees pour moins de 20 avis le jour de leur import. Ce critere est
      -- temporaire par nature. Les repecher via Google Places coute ~2,40 EUR par contact ; or un
      -- nouveau fichier achete sur la meme zone porte deja leur nombre d avis a jour. On l avait
      -- sous les yeux et on le jetait. Cout marginal du rattrapage : zero.
      -- On ne reveille QUE skipped_lowreviews : importe / no_email / hors_metier / blockliste
      -- traduisent une decision deja prise ou une opposition, les rejouer serait une faute.
      ON CONFLICT (place_id) DO UPDATE SET
        reviews = EXCLUDED.reviews,
        rating  = COALESCE(EXCLUDED.rating, outscraper_leads.rating),
        email   = COALESCE(outscraper_leads.email, EXCLUDED.email),
        status  = CASE
          WHEN outscraper_leads.status = 'skipped_lowreviews' AND EXCLUDED.reviews >= ${SEUIL_AVIS}
            THEN 'new'
          -- Une fiche classee doublon par l ANCIENNE regle (identite = le site) peut etre jugee
          -- distincte par la NOUVELLE (identite = l adresse mail). Une decision fraiche corrige une
          -- decision perimee : sinon les prospects ecartes a tort le restent pour toujours, et
          -- corriger la regle n aurait servi qu aux fichiers futurs.
          WHEN outscraper_leads.status = 'deja_en_base' AND EXCLUDED.status = 'new'
            THEN 'new'
          ELSE outscraper_leads.status
        END
      -- xmax = 0 distingue une INSERTION d une MISE A JOUR. Sans ca, depuis le passage a
      -- DO UPDATE, chaque fiche rafraichie serait comptee comme chargee : le rapport annoncerait
      -- 288 nouveaux leads la ou il n y en a que 91. Un compteur qui gonfle avec les doublons est
      -- exactement le genre d ecran qui ment.
      RETURNING place_id, (xmax = 0) AS insere, status
    `) as Array<{ place_id: string; insere: boolean; status: string }>
    charges += res.filter(r => r.insere).length
    rafraichies += res.filter(r => !r.insere).length
    reveilles += res.filter(r => !r.insere && r.status === 'new').length
    traitees += lot.length
  }

  /**
   * MÉMOIRE DE COUVERTURE — on note quelles combinaisons métier × ville ont été ACHETÉES.
   *
   * ⚠️ Outscraper ne se souvient pas de ce qu'il a livré : relancer « pisciniste + Marseille »
   * rend les mêmes entreprises et les REFACTURE. Notre import jette bien les doublons (clé
   * `place_id`), donc l'argent partirait sans que rien ne le signale — le pire des cas : une
   * dépense invisible.
   *
   * On enregistre TOUTES les lignes du fichier, pas seulement celles qui passent les filtres :
   * la ville a été ratissée et payée même si aucune de ses fiches n'était exploitable. La
   * racheter serait exactement la même erreur.
   */
  const couverture = new Map<string, { categorie: string; ville: string; fiches: number }>()
  for (const l of lignes) {
    const q = val(l, 'query')
    if (!q) continue
    /**
     * ⚠️ DEUX FORMATS DE REQUÊTE, SELON LE MODE CHOISI CHEZ OUTSCRAPER.
     *   liste déroulante   → « pisciniste, 06001 CEDEX 1, Nice, Provence-Alpes-Côte d'Azur, FR »
     *   emplacements libres → « swimming pool contractor, Rennes »
     *
     * Ma première version prenait l'avant-avant-dernier champ. Sur le format court elle sortait de
     * la liste et n'enregistrait RIEN : la couverture serait restée vide pour toutes les commandes
     * passées en mode personnalisé — sans erreur, sans trace, et Timéo aurait racheté les mêmes
     * villes en croyant l'outil à jour. Une mémoire silencieusement vide est pire qu'une absence
     * de mémoire : on lui fait confiance.
     *
     * On raisonne donc par élimination plutôt que par position : on retire le code pays et tout ce
     * qui porte des chiffres (code postal, CEDEX), et la ville est le premier champ qui reste.
     */
    const p = q.split(',').map(s => s.trim()).filter(Boolean)
    if (p.length < 2) continue
    const categorie = p[0].toLowerCase()
    const reste = p.slice(1)
      .filter(s => !/^[A-Z]{2}$/.test(s))   // code pays
      .filter(s => !/\d/.test(s))            // code postal / CEDEX
    const ville = reste[0]
    if (!ville) continue
    const k = `${categorie}|${ville.toLowerCase()}`
    const e = couverture.get(k) ?? { categorie, ville, fiches: 0 }
    e.fiches++
    couverture.set(k, e)
  }
  for (const c of couverture.values()) {
    await sql`
      INSERT INTO scrape_couverture (categorie, ville, fiches)
      VALUES (${c.categorie}, ${c.ville}, ${c.fiches})
      -- ⚠️ GREATEST et non une ADDITION. Le cumul paraissait logique — il comptait en realite les
      -- REIMPORTS : rejouer le meme fichier doublait le total, et j ai annonce 1354 fiches sur
      -- Paris la ou il y en avait 677. Un compteur qui grandit quand on relit la meme donnee ne
      -- mesure pas la donnee, il mesure mes manipulations.
      -- GREATEST est stable : reimporter ne change rien, et une nouvelle commande plus fournie sur
      -- la meme ville met bien le chiffre a jour.
      ON CONFLICT (categorie, ville) DO UPDATE
        SET fiches = GREATEST(scrape_couverture.fiches, EXCLUDED.fiches), importe_le = NOW()
    `.catch(() => { /* la trace ne doit jamais faire échouer un import */ })
  }

  const restants = aCharger.length - traitees

  return NextResponse.json({
    ok: restants === 0,
    mode: restants === 0 ? 'importé' : 'importé PARTIELLEMENT',
    ...analyse,
    charges_en_base: charges,
    fiches_rafraichies: rafraichies,
    // Fiches qui dormaient sous le seuil d'avis et qui viennent de le franchir : elles repartent
    // en prospection sans qu'on ait rien payé de plus.
    reveillees_seuil_atteint: reveilles,
    lignes_traitees: traitees,
    // Jamais tronquer en silence : sans ce chiffre, un import à moitié fait se lit comme un succès.
    non_traitees_faute_de_temps: restants,
    reprise: restants > 0
      ? 'Redépose le MÊME fichier : les lignes déjà chargées sont ignorées (clé Google unique), seules les restantes seront ajoutées.'
      : null,
    suite: 'GET /api/admin/import-outscraper?process=1&batch=10 — scrape l\'email sur leur site puis met en file.',
  })
}

export const POST = wrapCron('import-fichier', handler)
