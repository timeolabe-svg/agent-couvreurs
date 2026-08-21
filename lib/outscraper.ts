/**
 * ACHAT AUTOMATIQUE DE LEADS CHEZ OUTSCRAPER — les garde-fous avant le robinet.
 *
 * Ce fichier ne contient volontairement AUCUNE logique de campagne : uniquement de quoi dépenser de
 * l'argent sans en perdre. La règle qui gouverne tout le reste, donnée par Timéo le 21/08 :
 * « tu dois détecter tout seul s'il y a des choses étranges, tu stoppes tout et tu m'envoies un
 * message ou un mail ».
 *
 * ⚠️ POURQUOI UN ARRÊT PERSISTANT EN BASE ET PAS SEULEMENT UNE VARIABLE D'ENVIRONNEMENT.
 * Quand le système détecte une anomalie, il doit pouvoir se couper LUI-MÊME, immédiatement, sans
 * attendre un redéploiement. Une variable d'environnement ne se change que depuis Vercel : le temps
 * de s'en rendre compte, les passages suivants auraient continué d'acheter. Le drapeau vit donc en
 * base, et le code le lit avant chaque commande.
 *
 * ⚠️ POURQUOI LE FILTRE MÉTIER EST FAIT PAR NOUS ET PAS PAR L'API.
 * L'interface d'Outscraper propose « correspondance exacte », mais la documentation publique de
 * l'API ne confirme pas le nom du paramètre correspondant. Parier sur un drapeau non vérifié, c'est
 * risquer de payer un fichier rempli d'hôtels et de restaurants — exactement ce qui est arrivé au
 * fichier « piscinistes ». On envoie donc la catégorie Google dans la requête ET on re-filtre les
 * fiches reçues sur la catégorie que Google renvoie pour chacune. Le second filtre est vérifiable ;
 * le premier ne l'est pas.
 */

export const OUTSCRAPER_BASE = 'https://api.outscraper.cloud'

/**
 * Prix indicatif au millier de fiches. Sert UNIQUEMENT à estimer une dépense avant de la faire,
 * jamais à afficher une facture : le montant réel est celui d'Outscraper.
 */
export const PRIX_POUR_MILLE_USD = Number(process.env.ACHAT_PRIX_POUR_MILLE_USD ?? 3)

/** Plafonds durs. Dépassés, on n'achète plus, même si le plan dit qu'il reste 5 000 villes. */
export const PLAFOND_JOUR_USD = Number(process.env.ACHAT_PLAFOND_JOUR_USD ?? 10)
export const PLAFOND_MOIS_USD = Number(process.env.ACHAT_PLAFOND_MOIS_USD ?? 100)

/**
 * Part de doublons au-delà de laquelle on considère qu'on repaie ce qu'on possède déjà.
 * Ce n'est pas une erreur visible : le fichier arrive, l'import se passe bien, et l'argent part.
 */
export const SEUIL_DOUBLON_PCT = Number(process.env.ACHAT_SEUIL_DOUBLON_PCT ?? 70)

/** Part de fiches hors métier au-delà de laquelle la requête elle-même est suspecte. */
export const SEUIL_HORS_METIER_PCT = Number(process.env.ACHAT_SEUIL_HORS_METIER_PCT ?? 40)

/** Nombre de fiches demandées par ville. Volontairement haut : Outscraper ne facture que ce qu'il trouve. */
export const LIMITE_PAR_VILLE = Number(process.env.ACHAT_LIMITE_PAR_VILLE ?? 500)

export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

export async function assurerTablesAchat(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS achat_commandes (
      id            BIGSERIAL PRIMARY KEY,
      request_id    TEXT UNIQUE,
      metier        TEXT NOT NULL,
      categorie     TEXT NOT NULL,
      villes        JSONB NOT NULL,
      statut        TEXT NOT NULL DEFAULT 'en_cours',
      fiches        INT  NOT NULL DEFAULT 0,
      nouveaux      INT  NOT NULL DEFAULT 0,
      doublons      INT  NOT NULL DEFAULT 0,
      hors_metier   INT  NOT NULL DEFAULT 0,
      cout_usd      NUMERIC(10,4) NOT NULL DEFAULT 0,
      anomalie      TEXT,
      simulation    BOOLEAN NOT NULL DEFAULT FALSE,
      lancee_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      terminee_le   TIMESTAMPTZ
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_achat_statut ON achat_commandes (statut)`
  await sql`CREATE INDEX IF NOT EXISTS idx_achat_lancee ON achat_commandes (lancee_le DESC)`
  await sql`
    CREATE TABLE IF NOT EXISTS achat_config (
      cle     TEXT PRIMARY KEY,
      valeur  TEXT NOT NULL,
      pose_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      motif   TEXT
    )
  `
}

/** Pose l'arrêt d'urgence. Toute dépense s'interrompt jusqu'à levée manuelle. */
export async function poserArret(sql: Sql, motif: string): Promise<void> {
  await sql`
    INSERT INTO achat_config (cle, valeur, motif) VALUES ('arret', '1', ${motif})
    ON CONFLICT (cle) DO UPDATE SET valeur = '1', motif = ${motif}, pose_le = NOW()
  `
}

export async function lireArret(sql: Sql): Promise<{ arrete: boolean; motif: string | null; depuis: string | null }> {
  const r = (await sql`SELECT valeur, motif, pose_le FROM achat_config WHERE cle = 'arret'`) as Array<{
    valeur: string; motif: string | null; pose_le: string
  }>
  if (!r[0] || r[0].valeur !== '1') return { arrete: false, motif: null, depuis: null }
  return { arrete: true, motif: r[0].motif, depuis: r[0].pose_le }
}

export async function depenses(sql: Sql): Promise<{ jour: number; mois: number }> {
  const r = (await sql`
    SELECT
      COALESCE(SUM(cout_usd) FILTER (WHERE lancee_le >= date_trunc('day',   NOW())), 0)::numeric AS jour,
      COALESCE(SUM(cout_usd) FILTER (WHERE lancee_le >= date_trunc('month', NOW())), 0)::numeric AS mois
    FROM achat_commandes WHERE simulation = FALSE
  `) as Array<{ jour: string; mois: string }>
  return { jour: Number(r[0]?.jour ?? 0), mois: Number(r[0]?.mois ?? 0) }
}

/**
 * LE FEU VERT. Six conditions, toutes bloquantes. La première qui tombe arrête tout.
 *
 * ⚠️ L'ordre compte : l'arrêt d'urgence et l'interrupteur passent AVANT les plafonds, pour qu'un
 * arrêt reste un arrêt même si le budget du jour est intact.
 */
export async function feuVert(
  sql: Sql,
  coutMaximumEstime: number,
): Promise<{ ok: true } | { ok: false; raison: string }> {
  const arret = await lireArret(sql)
  if (arret.arrete) return { ok: false, raison: `arrêt d'urgence posé le ${String(arret.depuis).slice(0, 16)} : ${arret.motif}` }

  if ((process.env.ACHAT_LEADS_ACTIF ?? '0') !== '1') {
    return { ok: false, raison: 'ACHAT_LEADS_ACTIF n\'est pas à 1 (interrupteur général, achat réel désactivé)' }
  }
  if (!process.env.OUTSCRAPER_API_KEY) {
    return { ok: false, raison: 'OUTSCRAPER_API_KEY manquante' }
  }

  // Une commande à la fois : deux jobs en parallèle peuvent acheter la même ville avant que le
  // premier ait écrit qu'il l'avait prise.
  const enCours = (await sql`
    SELECT id, request_id FROM achat_commandes WHERE statut = 'en_cours' AND simulation = FALSE LIMIT 1
  `) as Array<{ id: number; request_id: string }>
  if (enCours[0]) return { ok: false, raison: `commande ${enCours[0].request_id} déjà en cours (une seule à la fois)` }

  const d = await depenses(sql)
  if (d.jour + coutMaximumEstime > PLAFOND_JOUR_USD) {
    return { ok: false, raison: `plafond jour : ${d.jour.toFixed(2)} $ dépensés + ${coutMaximumEstime.toFixed(2)} $ estimés > ${PLAFOND_JOUR_USD} $` }
  }
  if (d.mois + coutMaximumEstime > PLAFOND_MOIS_USD) {
    return { ok: false, raison: `plafond mois : ${d.mois.toFixed(2)} $ dépensés + ${coutMaximumEstime.toFixed(2)} $ estimés > ${PLAFOND_MOIS_USD} $` }
  }
  return { ok: true }
}

export interface FicheOutscraper {
  place_id?: string
  name?: string
  site?: string
  phone?: string
  city?: string
  postal_code?: string
  rating?: number
  reviews?: number
  type?: string
  subtypes?: string
  category?: string
  [k: string]: unknown
}

/**
 * Lance le job et rend son identifiant, SANS attendre le résultat.
 *
 * ⚠️ POURQUOI ON N'ATTEND PAS. L'ordonnanceur coupe la requête à 30 secondes, quoi qu'en dise la
 * configuration Vercel. Un scraping de 4 villes prend plusieurs minutes : attendre le résultat dans
 * le même passage, c'est se faire couper APRÈS avoir payé et AVANT d'avoir importé le fichier. On
 * paierait pour des données qu'on n'aurait jamais. Le job est donc lancé ici, et récolté au passage
 * suivant, quand il est prêt.
 */
export async function lancerJob(requetes: string[], limiteParRequete: number): Promise<{ requestId: string }> {
  const url = new URL(`${OUTSCRAPER_BASE}/maps/search-v3`)
  for (const q of requetes) url.searchParams.append('query', q)
  url.searchParams.set('limit', String(limiteParRequete))
  url.searchParams.set('language', 'fr')
  url.searchParams.set('region', 'FR')
  url.searchParams.set('dropDuplicates', 'true')
  url.searchParams.set('async', 'true')

  const res = await fetch(url, {
    headers: { 'X-API-KEY': process.env.OUTSCRAPER_API_KEY ?? '' },
    signal: AbortSignal.timeout(20_000),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Outscraper HTTP ${res.status} : ${txt.slice(0, 200)}`)
  const j = JSON.parse(txt) as { id?: string; request_id?: string }
  const id = j.id ?? j.request_id
  if (!id) throw new Error(`Outscraper n'a pas rendu d'identifiant de job : ${txt.slice(0, 200)}`)
  return { requestId: id }
}

/**
 * Récolte un job. Rend `pret: false` tant qu'il tourne — ce n'est pas une erreur.
 */
export async function recolterJob(
  requestId: string,
): Promise<{ pret: false } | { pret: true; fiches: FicheOutscraper[] } | { pret: true; echec: string }> {
  const res = await fetch(`${OUTSCRAPER_BASE}/requests/${encodeURIComponent(requestId)}`, {
    headers: { 'X-API-KEY': process.env.OUTSCRAPER_API_KEY ?? '' },
    signal: AbortSignal.timeout(20_000),
  })
  const txt = await res.text()
  if (res.status === 202) return { pret: false }
  if (!res.ok) throw new Error(`Outscraper HTTP ${res.status} : ${txt.slice(0, 200)}`)

  const j = JSON.parse(txt) as { status?: string; data?: unknown }
  const statut = (j.status ?? '').toLowerCase()
  if (statut === 'pending' || statut === 'running' || statut === 'in progress') return { pret: false }
  if (statut && statut !== 'success' && statut !== 'finished') return { pret: true, echec: `job ${statut}` }

  // `data` arrive soit à plat, soit en tableau de tableaux (un par requête).
  const brut = Array.isArray(j.data) ? j.data : []
  const fiches = (brut.flat ? brut.flat() : brut) as FicheOutscraper[]
  return { pret: true, fiches: fiches.filter(f => f && typeof f === 'object') }
}

/**
 * LE FILTRE MÉTIER, FAIT CHEZ NOUS.
 *
 * Google range chaque fiche dans une catégorie principale (`type`) et des secondaires (`subtypes`).
 * On garde une fiche si la catégorie visée apparaît dans l'une ou l'autre. Une entreprise qui fait
 * couvreur ET zingueur reste légitime ; un hôtel qui remonte parce qu'il a une piscine, non.
 *
 * ⚠️ Ne jamais écrire le métier français en dur ici : c'est la catégorie Google (en anglais) qui
 * fait foi, parce que c'est elle qu'Outscraper renvoie.
 */
export function estDuMetier(f: FicheOutscraper, categorieGoogle: string): boolean {
  const cible = categorieGoogle.toLowerCase().trim()
  const champs = [f.type, f.category, f.subtypes]
    .filter(Boolean)
    .map(s => String(s).toLowerCase())
  if (champs.length === 0) return true // pas d'information : on ne jette pas, on laisse l'import trancher
  return champs.some(c => c.split(',').some(part => part.trim() === cible) || c.includes(cible))
}

/**
 * DÉTECTION D'ANOMALIES. Ce qui doit déclencher un arrêt, pas un avertissement noyé dans un journal.
 *
 * Chaque règle vient d'un incident réel ou d'une consigne explicite. Une anomalie non nulle veut
 * dire : on arrête d'acheter et on prévient Timéo.
 */
export function detecterAnomalies(args: {
  fiches: FicheOutscraper[]
  horsMetier: number
  doublons: number
  villesDemandees: number
}): string[] {
  const { fiches, horsMetier, doublons, villesDemandees } = args
  const anomalies: string[] = []
  const total = fiches.length

  // « Deux fiches identiques » — la formulation exacte de Timéo. Même identifiant Google deux fois
  // dans un même fichier n'est pas censé arriver : c'est le signe d'une requête dupliquée facturée
  // deux fois.
  const vus = new Set<string>()
  let placeIdDouble = 0
  for (const f of fiches) {
    const id = String(f.place_id ?? '')
    if (!id) continue
    if (vus.has(id)) placeIdDouble++
    else vus.add(id)
  }
  if (placeIdDouble > 0) anomalies.push(`${placeIdDouble} fiche(s) présentes deux fois dans le MÊME fichier (facturées deux fois)`)

  // Même entreprise sous deux identifiants : nom + téléphone identiques. Souvent une vraie fiche
  // dupliquée par Google, mais si la proportion grimpe, la requête est mal ciblée.
  const parNomTel = new Map<string, number>()
  for (const f of fiches) {
    const cle = `${String(f.name ?? '').toLowerCase().trim()}|${String(f.phone ?? '').replace(/\D/g, '')}`
    if (cle === '|') continue
    parNomTel.set(cle, (parNomTel.get(cle) ?? 0) + 1)
  }
  const jumelles = [...parNomTel.values()].filter(n => n > 1).length
  if (total > 0 && jumelles / total > 0.1) {
    anomalies.push(`${jumelles} entreprises apparaissent sous plusieurs fiches (${Math.round((jumelles / total) * 100)} % du fichier)`)
  }

  if (total > 0 && (horsMetier / total) * 100 > SEUIL_HORS_METIER_PCT) {
    anomalies.push(`${horsMetier}/${total} fiches hors métier (${Math.round((horsMetier / total) * 100)} %) : la requête ne cible pas la bonne catégorie`)
  }

  if (total > 0 && (doublons / total) * 100 > SEUIL_DOUBLON_PCT) {
    anomalies.push(`${doublons}/${total} fiches déjà en base (${Math.round((doublons / total) * 100)} %) : on repaie ce qu'on possède`)
  }

  // Un fichier anormalement gros pour le nombre de villes demandées veut dire que la recherche a
  // débordé sur une zone bien plus large que prévu — donc qu'on paie pour des villes non planifiées.
  if (villesDemandees > 0 && total > villesDemandees * LIMITE_PAR_VILLE) {
    anomalies.push(`${total} fiches pour ${villesDemandees} villes : au-delà de la limite demandée, la recherche a débordé`)
  }

  return anomalies
}
