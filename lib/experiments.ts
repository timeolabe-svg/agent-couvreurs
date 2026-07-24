// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR D'AUTO-APPRENTISSAGE — leviers "data-driven" que l'agent actionne seul.
//
// Principe : tous les réglages testés (variantes de messages, priorités secteurs
// et zones) sont stockés en BASE (agent_config, en JSON). Le générateur / le
// scraper les LISENT en direct. Le cron mensuel les RÉÉCRIT selon les résultats.
// → l'agent s'améliore tout seul, sans intervention humaine ni de code.
// ─────────────────────────────────────────────────────────────────────────────

// Variantes d'ANGLE d'ouverture des emails. L'email ouvre toujours sur le défaut
// AUDITÉ du site — la variante ne change que la FAÇON de l'amener. On teste laquelle
// fait le plus répondre / caler des RDV.
export interface MessageVariant { id: string; label: string; instruction: string }

export const MESSAGE_VARIANTS: MessageVariant[] = [
  {
    id: 'question',
    label: 'Question directe',
    instruction: "Ouvre par une QUESTION directe et concrète sur sa situation (ex : \"Question rapide : quelle part de vos clients vous trouve via Google ?\"), puis enchaîne sur le défaut audité de son site.",
  },
  {
    id: 'observation',
    label: 'Observation du site',
    instruction: "Ouvre en RACONTANT ce que tu as vu toi-même sur son site (le défaut audité), comme une observation perso (ex : \"J'ai regardé votre site sur mon téléphone...\").",
  },
  {
    id: 'test',
    label: 'Invitation à tester',
    instruction: "Ouvre en l'invitant à FAIRE UN TEST simple qui révèle le problème (ex : \"Petit test : tapez 'votre métier + votre ville' sur Google\"), puis relie au défaut audité.",
  },
  {
    id: 'consequence',
    label: 'Conséquence d\'abord',
    instruction: "Ouvre par la CONSÉQUENCE concrète (des clients qui cherchent son métier et tombent sur d'autres entreprises), puis explique le défaut audité qui en est la cause.",
  },
]

export const VARIANT_IDS = MESSAGE_VARIANTS.map(v => v.id)

// Clés agent_config où sont stockées les pondérations (JSON : { valeur: poids }).
export const WEIGHTS_KEYS = {
  variant: 'exp_variant_weights',
  sector: 'exp_sector_weights',
  region: 'exp_region_weights',
} as const

// Poids plancher : chaque valeur garde un minimum de poids → l'agent continue
// TOUJOURS d'explorer un peu chaque option (marathon), jamais d'abandon total.
export const MIN_WEIGHT = 0.08

// Tire une valeur au hasard, pondérée par les poids (avec plancher d'exploration).
export function weightedPick<T extends string>(keys: readonly T[], weights: Record<string, number>): T {
  if (keys.length === 0) throw new Error('weightedPick: aucune clé')
  const entries = keys.map(k => [k, Math.max(weights[k] ?? 1, MIN_WEIGHT)] as const)
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [k, w] of entries) {
    r -= w
    if (r <= 0) return k
  }
  return keys[keys.length - 1]
}

// Lit une map de poids depuis agent_config (JSON). Renvoie {} si absente/invalide.
export async function getWeights(key: string): Promise<Record<string, number>> {
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const [row] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, key)).limit(1)
    if (!row?.value) return {}
    const parsed = JSON.parse(row.value)
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, number> : {}
  } catch {
    return {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE DE SECTEUR — distinct du poids d'exploration.
//
// weightedPick garde volontairement un PLANCHER (MIN_WEIGHT) sur chaque secteur : mettre le
// poids d'un secteur à 0 ne l'exclut donc jamais complètement, il continue d'être tiré de temps
// en temps ("jamais d'abandon total", voulu pour l'exploration normale). C'est le comportement
// souhaité tant qu'on VEUT explorer un secteur en continu, mais pas quand le client demande
// explicitement d'arrêter tout nouveau contact sur un secteur ("mets en pause les couvreurs").
// D'où une liste d'EXCLUSION séparée, à vérifier AVANT weightedPick (retire le secteur du tirage
// plutôt que de le sous-pondérer) : c'est la seule façon de garantir zéro nouveau contact.
// ⚠️ Un secteur en pause n'affecte QUE les NOUVEAUX contacts (scraping) et les envois du step 0
// (premier contact) : les relances déjà engagées (steps ≥ 1) et les réponses des prospects
// continuent normalement — l'invariant "zéro lead perdu" n'a pas de raison de s'arrêter parce
// qu'on ne démarche plus de nouveaux prospects du secteur.
const SECTOR_PAUSED_KEY = 'sector_paused'

export async function getPausedSectors(): Promise<string[]> {
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const [row] = await db.select({ value: agent_config.value }).from(agent_config).where(eq(agent_config.key, SECTOR_PAUSED_KEY)).limit(1)
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export async function setPausedSectors(sectors: string[], updatedBy = 'admin'): Promise<void> {
  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')
  const value = JSON.stringify(sectors)
  await db.insert(agent_config)
    .values({ key: SECTOR_PAUSED_KEY, value, updated_by: updatedBy })
    .onConflictDoUpdate({ target: agent_config.key, set: { value, updated_by: updatedBy, updated_at: new Date() } })
}

// Écrit une map de poids dans agent_config (JSON). Utilisé par le cron mensuel.
export async function setWeights(key: string, weights: Record<string, number>, updatedBy = 'self_learning'): Promise<void> {
  const { db } = await import('@/lib/db')
  const { agent_config } = await import('@/lib/db/schema')
  const value = JSON.stringify(weights)
  await db.insert(agent_config)
    .values({ key, value, updated_by: updatedBy })
    .onConflictDoUpdate({ target: agent_config.key, set: { value, updated_by: updatedBy, updated_at: new Date() } })
}
