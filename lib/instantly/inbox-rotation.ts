// lib/instantly/inbox-rotation.ts
// Picks the next sending inbox using round-robin, persisted in agent_config

export interface InboxAccount {
  email: string
  senderName: string
}

const ROTATION_KEY = 'inbox_rotation_index'
const FALLBACK_EMAIL = 'thomas@hdigiweb.fr'
const FALLBACK_NAME = 'Thomas Renard'

async function getInboxesFromInstantly(): Promise<InboxAccount[]> {
  try {
    const { getInstantlyAccounts } = await import('./client')
    const accounts = await getInstantlyAccounts()
    if (!accounts || accounts.length === 0) return []

    // Parse sender names from env var (comma-separated, order matches Instantly accounts)
    const namesEnv = process.env.INSTANTLY_INBOX_NAMES
    const names = namesEnv ? namesEnv.split(',').map(n => n.trim()) : []

    return accounts.map((acc, i) => ({
      email: acc.email,
      senderName: names[i] || FALLBACK_NAME,
    }))
  } catch (err) {
    console.warn('[inbox-rotation] Failed to fetch Instantly accounts:', err)
    return []
  }
}

function getInboxesFromEnv(): InboxAccount[] {
  const emailsEnv = process.env.INSTANTLY_INBOXES
  if (!emailsEnv) return [{ email: FALLBACK_EMAIL, senderName: FALLBACK_NAME }]

  const emails = emailsEnv.split(',').map(e => e.trim()).filter(Boolean)
  const namesEnv = process.env.INSTANTLY_INBOX_NAMES
  const names = namesEnv ? namesEnv.split(',').map(n => n.trim()) : []

  return emails.map((email, i) => ({
    email,
    senderName: names[i] || FALLBACK_NAME,
  }))
}

/** Nom d'expéditeur associé à une boîte (via INSTANTLY_INBOXES/INSTANTLY_INBOX_NAMES).
 *  Sert au moteur d'envoi maison pour que l'enveloppe "From" colle à la signature du corps. */
export function getInboxSenderName(email: string): string {
  const inboxes = getInboxesFromEnv()
  const found = inboxes.find(i => i.email.toLowerCase() === email.toLowerCase())
  return found?.senderName ?? FALLBACK_NAME
}

// Incrément ATOMIQUE du compteur de rotation (anti-race) : un seul UPDATE ... RETURNING.
// CRITIQUE : getNextInbox est appelé en PARALLÈLE (Promise.all) → l'ancienne version
// lecture-puis-écriture donnait la MÊME boîte à plusieurs leads dans un même tick.
// Ici Postgres verrouille la ligne par appel → chaque appel reçoit un index distinct.
async function nextRotationValue(): Promise<number> {
  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const res = await db.execute(sql`
    INSERT INTO agent_config (key, value, updated_by)
    VALUES (${ROTATION_KEY}, '1', 'inbox_rotation')
    ON CONFLICT (key) DO UPDATE
      SET value = (COALESCE(NULLIF(agent_config.value, '')::int, 0) + 1)::text,
          updated_at = now(),
          updated_by = 'inbox_rotation'
    RETURNING value
  `)
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows?: Array<{ value?: string }> }).rows) ?? []
  return parseInt(rows[0]?.value ?? '1', 10) || 1
}

export async function getNextInbox(): Promise<InboxAccount> {
  // PRIORITÉ à la liste explicite INSTANTLY_INBOXES (les boîtes hdigiweb autorisées).
  // Sans elle, on ne veut PAS récupérer tout le workspace Instantly (qui contient
  // aussi des comptes LabegarIA). On ne tombe sur l'API que si l'env n'est pas défini.
  let inboxes: InboxAccount[]
  if (process.env.INSTANTLY_INBOXES) {
    inboxes = getInboxesFromEnv()
  } else {
    inboxes = await getInboxesFromInstantly()
    if (inboxes.length === 0) inboxes = getInboxesFromEnv()
  }
  const len = inboxes.length || 1

  let idx = 0
  try {
    const newVal = await nextRotationValue()
    idx = (newVal - 1) % len  // newVal=1 au 1er appel → index 0
  } catch (err) {
    console.warn('[inbox-rotation] Compteur atomique indisponible, fallback index 0:', err)
  }

  const selected = inboxes[idx]
  console.log(`[inbox-rotation] Selected inbox ${selected.email} (index ${idx} of ${len})`)
  return selected
}
