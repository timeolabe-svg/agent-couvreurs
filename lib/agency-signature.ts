// Signature d'agence — lit les VRAIS réglages de /parametres (Mon agence), au lieu du "Gabin /
// Hdigiweb / <email>" figé qui ne contenait ni téléphone ni site. Un lead avait signalé
// l'absence de signature complète dans les mails reçus : le champ existait dans l'UI mais n'était
// lu par AUCUN chemin d'envoi (cf. leçon 59 d'agent-cold-email-blueprint — un réglage UI qui ne
// pilote pas la vraie config).
import { db } from '@/lib/db'
import { agent_config } from '@/lib/db/schema'

export interface AgencyInfo {
  nom: string
  telephone?: string
  site?: string
}

let cache: { data: AgencyInfo; at: number } | null = null
const TTL_MS = 60_000 // évite une requête DB à chaque email d'un même run, sans jamais rester périmé longtemps

export async function getAgencyInfo(): Promise<AgencyInfo> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  try {
    const rows = await db.select().from(agent_config)
    const map: Record<string, string> = {}
    for (const r of rows) map[r.key] = r.value
    const data: AgencyInfo = {
      nom: map.agence_nom || 'Hdigiweb',
      telephone: map.agence_telephone || undefined,
      site: map.agence_site || undefined,
    }
    cache = { data, at: Date.now() }
    return data
  } catch {
    return { nom: 'Hdigiweb' }
  }
}

/**
 * Suites de chiffres qui n'existent pas comme vrais numéros : ce sont les exemples affichés dans
 * les formulaires. Elles ne doivent JAMAIS sortir, quelle que soit la façon dont elles sont
 * arrivées dans les réglages. Doublon volontaire avec lib/anti-invention.ts : les deux modules
 * doivent pouvoir se protéger seuls, sans dépendre l'un de l'autre.
 */
export function estNumeroExemple(tel: string | null | undefined): boolean {
  const d = (tel ?? '').replace(/\D/g, '').replace(/^0033/, '0').replace(/^33(?=\d{9}$)/, '0')
  return new Set([
    '0612345678', '0123456789', '0645454545', '0600000000', '0102030405',
    '0611111111', '0622222222', '0666666666', '0700000000', '0712345678',
  ]).has(d)
}

/** Bloc signature complet : prénom expéditeur, agence, boîte d'envoi, puis téléphone/site si renseignés. */
export function buildSignature(senderName: string, agencyNom: string, fromEmail: string, telephone?: string, site?: string): string {
  const lines = [senderName, agencyNom, fromEmail]
  // ⚠️ AUDIT 09/08 : le réglage `agence_telephone` contenait « 06 12 34 56 78 » — le numéro
  // d'exemple des formulaires, saisi comme remplissage et jamais corrigé. Il était donc collé en
  // signature de CHAQUE réponse, et le garde-fou anti-invention le validait puisqu'il le lisait
  // comme la source de vérité. Mieux vaut une signature SANS téléphone qu'une signature avec un
  // faux : un prospect qui appelle un inconnu, c'est le rendez-vous perdu et la crédibilité avec.
  if (telephone && !estNumeroExemple(telephone)) lines.push(telephone)
  if (site) lines.push(site.replace(/^https?:\/\//, ''))
  return lines.join('\n')
}
