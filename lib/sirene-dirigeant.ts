/**
 * RECHERCHE DU DIRIGEANT VIA SIRENE — gratuit (recherche-entreprises.api.gouv.fr).
 *
 * ⚠️ Ne PAS confondre avec `app/api/admin/sirene-prototype/route.ts` : ce prototype-là source de
 * NOUVELLES entreprises par département/NAF puis cherche un SITE puis un EMAIL — un pipeline
 * d'acquisition entièrement différent, isolé dans sa propre table. Ici, l'entreprise est déjà
 * connue (nom + ville, via `outscraper_leads`) : la seule question est « qui la dirige ? », pour
 * pouvoir la chercher sur LinkedIn par nom et prénom.
 *
 * ⚠️ VÉRIFIÉ EN DIRECT (03/09/2026) AVANT D'ÉCRIRE CE FICHIER, PAS SUPPOSÉ : une recherche par nom
 * seul ("Solidis") renvoie plusieurs entreprises homonymes dans des villes différentes. Le champ
 * `dirigeants` existe bien sur chaque résultat par défaut (pas besoin de paramètre `include`),
 * mais SEULEMENT en le croisant avec la ville peut-on savoir LEQUEL des homonymes est le bon.
 * Même discipline que sirene-prototype.ts : mieux vaut aucun résultat qu'un mauvais rattachement.
 */

interface DirigeantBrut {
  nom?: string
  prenoms?: string
  qualite?: string
  type_dirigeant?: string
}
interface ResultatBrut {
  nom_complet?: string
  siege?: { libelle_commune?: string }
  dirigeants?: DirigeantBrut[]
}

export interface DirigeantTrouve {
  firstName: string
  lastName: string
  qualite: string
  siren?: string
}

const normalise = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

// Ordre de préférence quand plusieurs dirigeants existent : celui qui dirige vraiment, jamais un
// commissaire aux comptes (un auditeur, jamais le patron) ni une personne morale (une société,
// pas un nom à chercher sur LinkedIn).
const QUALITE_PRIORITE = [/gérant/i, /président/i, /directeur général/i, /associé.*gérant/i]

function meilleurDirigeant(dirigeants: DirigeantBrut[]): DirigeantBrut | null {
  const physiques = dirigeants.filter(d => d.type_dirigeant === 'personne physique' && d.nom && d.prenoms)
  if (physiques.length === 0) return null
  for (const pattern of QUALITE_PRIORITE) {
    const m = physiques.find(d => pattern.test(d.qualite ?? ''))
    if (m) return m
  }
  return physiques[0] // aucune qualité prioritaire trouvée : le premier dirigeant physique reste mieux que rien
}

/**
 * Cherche le dirigeant d'une entreprise par nom + ville. Renvoie `null` sans avoir levé
 * d'exception si rien n'est trouvé ou si la correspondance est incertaine — cette fonction ne
 * doit JAMAIS faire échouer l'appelant, elle est un enrichissement, pas une étape bloquante.
 */
export async function chercherDirigeant(nomEntreprise: string, ville: string): Promise<DirigeantTrouve | null> {
  if (!nomEntreprise?.trim()) return null
  try {
    const q = encodeURIComponent(nomEntreprise.trim())
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${q}&per_page=10`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json().catch(() => null) as { results?: ResultatBrut[] } | null
    const villeCible = normalise(ville || '')

    // Sans ville connue, on ne devine pas parmi plusieurs homonymes : trop de faux positifs.
    if (!villeCible) return null

    const candidat = data?.results?.find(r => normalise(r.siege?.libelle_commune ?? '') === villeCible)
    if (!candidat?.dirigeants?.length) return null

    const d = meilleurDirigeant(candidat.dirigeants)
    if (!d?.nom || !d?.prenoms) return null

    return {
      firstName: capitaliser(d.prenoms.split(/[\s,]+/)[0]),
      lastName: capitaliser(d.nom),
      qualite: d.qualite ?? '',
    }
  } catch {
    return null // timeout, réseau, JSON invalide : jamais bloquant pour l'appelant
  }
}

function capitaliser(s: string): string {
  return s.trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}
