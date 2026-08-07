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

/** Bloc signature complet : prénom expéditeur, agence, boîte d'envoi, puis téléphone/site si renseignés. */
export function buildSignature(senderName: string, agencyNom: string, fromEmail: string, telephone?: string, site?: string): string {
  const lines = [senderName, agencyNom, fromEmail]
  if (telephone) lines.push(telephone)
  if (site) lines.push(site.replace(/^https?:\/\//, ''))
  return lines.join('\n')
}
