/**
 * GARDE-FOU ANTI-INVENTION (déterministe, zéro IA).
 *
 * ⚠️ INCIDENT RÉEL 2026-07-31 — lesfuretsrenov@gmail.com a demandé « Vous avez un numéro pour plus
 * d'info ? ». L'agent a répondu, EN AUTOMATIQUE ET SANS VALIDATION :
 *     « mon numéro est le 06 12 34 56 78 »
 * Un numéro d'EXEMPLE, purement halluciné. Le prospect a reçu un faux numéro au nom du client.
 * Aucune règle du prompt n'interdisait d'inventer un numéro, et rien ne relisait le texte généré.
 *
 * Leçon : un prompt n'est PAS un garde-fou. Toute donnée factuelle sortante (téléphone, email,
 * lien, chiffre) doit être VÉRIFIÉE par du code contre une liste blanche de valeurs réelles.
 * Ce qui n'est pas vérifiable ne part pas tout seul : on bascule en validation humaine.
 *
 * Le module ne RÉÉCRIT jamais le texte (une réécriture automatique produirait des phrases
 * bancales du type « mon numéro est le . »). Il DÉTECTE et laisse l'appelant décider — en
 * pratique : forcer le brouillon en 'pending' (à valider) au lieu de 'scheduled'.
 */
import { getAgencyInfo } from '@/lib/agency-signature'

export interface InventionCheck {
  suspect: boolean
  motifs: string[]   // codes machine, ex. ['telephone_invente']
  details: string[]  // libellés lisibles pour l'alerte / l'UI
}

/** Réduit un numéro à ses chiffres, en normalisant +33 / 0033 → 0. */
function digitsOnly(s: string): string {
  let d = s.replace(/\D/g, '')
  if (d.startsWith('0033')) d = '0' + d.slice(4)
  else if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2)
  return d
}

/** Numéros FR : 0X XX XX XX XX (séparateurs libres) et +33 X XX XX XX XX. */
const RE_TEL = /(?:\+33|0033|\b0)\s?[1-9](?:[\s.\-]?\d{2}){4}\b/g
const RE_URL = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s,)]*)?/gi
const RE_MAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g

/** Domaines légitimes : ceux du client + les références neutres qu'on peut citer. */
const DOMAINES_OK = [
  'hdigiweb.fr', 'hdigiweb-agence.com', 'hdigiweb-digital.com', 'hdigiweb.com',
  'google.com', 'google.fr', 'maps.google.com', 'business.google.com',
]

/**
 * Chiffres autorisés. UN SEUL chiffre commercial est vrai (donnée client) :
 * « au grand minimum 30 à 35 000 € de CA de devis ». Tout autre chiffre accolé à
 * €/devis/clients/appels/% est une invention (règle Timéo : ne jamais inventer de stats).
 */
const RE_CHIFFRE_COMMERCIAL =
  /(\d[\d\s.,]{0,9})\s*(?:€|euros?|%|\s*(?:devis|clients?|chantiers?|appels?|demandes?|rendez-vous|rdv)\b)/gi
const CHIFFRES_AUTORISES = new Set(['30', '35', '30000', '35000', '3035000'])

/** Mots qui déclenchent un rejet chez l'artisan (règle client, cf. prompt). */
const MOTS_INTERDITS = [
  /\bpublicit[ée]s?\b/i, /\bpublicitaires?\b/i, /\bgoogle\s*ads?\b/i,
  /\bannonces?\s+(?:google|payantes?|sponsoris)/i, /\bcampagnes?\s+publicitaires?\b/i,
]

/**
 * Analyse un corps d'email SORTANT.
 *
 * @param body   le texte généré (avant envoi)
 * @param opts.prospectPhone numéro donné par le prospect lui-même : le citer est une autre faute
 *               (règle « ne jamais répéter son numéro ») mais ce n'est PAS une invention, on le
 *               signale sous un motif distinct.
 * @param opts.prospectSite site du prospect. ⚠️ INDISPENSABLE : l'agent ouvre presque toujours sur
 *               le défaut audité de SON site et le cite. Sans cette autorisation, on bloquerait
 *               en masse des réponses parfaitement légitimes (faux positif le plus probable).
 */
export async function detectInventedFacts(
  body: string,
  opts: { prospectPhone?: string | null; prospectSite?: string | null } = {}
): Promise<InventionCheck> {
  const motifs: string[] = []
  const details: string[] = []
  const texte = body || ''

  // Valeurs RÉELLES autorisées (réglages « Mon agence »). Si le téléphone n'est pas renseigné,
  // AUCUN numéro n'est légitime : l'agent n'a pas de numéro à donner, point.
  let telOk = ''
  let siteOk = ''
  try {
    const a = await getAgencyInfo()
    telOk = digitsOnly(a.telephone ?? '')
    siteOk = (a.site ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()
  } catch { /* pas de réglage lisible → on reste strict */ }

  const telProspect = digitsOnly(opts.prospectPhone ?? '')
  const siteProspect = (opts.prospectSite ?? '')
    .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()

  // 1) TÉLÉPHONES — le cas de l'incident.
  for (const m of texte.match(RE_TEL) ?? []) {
    const d = digitsOnly(m)
    if (d.length !== 10) continue
    if (telOk && d === telOk) continue                       // le vrai numéro de l'agence : OK
    if (telProspect && d === telProspect) {
      motifs.push('numero_prospect_repete')
      details.push(`Répète le numéro du prospect (${m}) — interdit par la règle appels.`)
      continue
    }
    motifs.push('telephone_invente')
    details.push(
      telOk
        ? `Numéro ${m} différent du numéro réel de l'agence.`
        : `Numéro ${m} alors qu'AUCUN téléphone n'est renseigné dans les réglages agence : il est forcément inventé.`
    )
  }

  // 2) LIENS — un lien halluciné envoie le prospect nulle part (ou pire, chez quelqu'un d'autre).
  for (const m of texte.matchAll(RE_URL)) {
    const dom = (m[1] || '').toLowerCase().replace(/^www\./, '')
    if (!dom.includes('.')) continue
    if (/\.(?:jpg|png|pdf|docx?)$/i.test(dom)) continue
    if (DOMAINES_OK.includes(dom) || (siteOk && dom === siteOk)) continue
    if (siteProspect && (dom === siteProspect || dom.endsWith('.' + siteProspect))) continue
    if (dom.endsWith('hdigiweb.fr') || /(^|\.)hdigiweb-/.test(dom)) continue
    motifs.push('lien_invente')
    details.push(`Lien vers un domaine non autorisé : ${dom}`)
  }

  // 3) ADRESSES EMAIL — seule une boîte du client peut apparaître (signature comprise).
  for (const m of texte.match(RE_MAIL) ?? []) {
    const dom = m.split('@')[1]?.toLowerCase() ?? ''
    if (dom.includes('hdigiweb')) continue
    if (siteOk && dom === siteOk) continue
    motifs.push('email_invente')
    details.push(`Adresse email non reconnue dans un mail sortant : ${m}`)
  }

  // 4) CHIFFRES COMMERCIAUX — règle « ne jamais inventer de stats ».
  for (const m of texte.matchAll(RE_CHIFFRE_COMMERCIAL)) {
    const brut = (m[1] || '').replace(/[\s.,]/g, '')
    if (!brut) continue
    if (CHIFFRES_AUTORISES.has(brut)) continue
    if (brut.length <= 2 && Number(brut) <= 15) continue // « 10 minutes », « 2 devis » d'un exemple neutre
    motifs.push('chiffre_invente')
    details.push(`Chiffre commercial non autorisé : "${m[0].trim()}" (seul "30 à 35 000 € de CA de devis" est une vraie donnée).`)
  }

  // 5) MOTS INTERDITS — friction immédiate chez l'artisan.
  for (const re of MOTS_INTERDITS) {
    const hit = texte.match(re)
    if (hit) { motifs.push('mot_interdit'); details.push(`Mot interdit employé : "${hit[0]}"`) }
  }

  const uniq = [...new Set(motifs)]
  return { suspect: uniq.length > 0, motifs: uniq, details: [...new Set(details)] }
}
