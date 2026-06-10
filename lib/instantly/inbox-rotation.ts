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

async function getRotationIndex(): Promise<number> {
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    const [row] = await db.select().from(agent_config).where(eq(agent_config.key, ROTATION_KEY))
    return row ? parseInt(row.value, 10) || 0 : 0
  } catch (err) {
    console.warn('[inbox-rotation] Failed to read rotation index from DB:', err)
    return 0
  }
}

async function saveRotationIndex(index: number): Promise<void> {
  try {
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')
    await db
      .insert(agent_config)
      .values({ key: ROTATION_KEY, value: String(index), updated_by: 'inbox_rotation' })
      .onConflictDoUpdate({
        target: agent_config.key,
        set: { value: String(index), updated_at: new Date(), updated_by: 'inbox_rotation' },
      })
  } catch (err) {
    console.warn('[inbox-rotation] Failed to save rotation index to DB (non-blocking):', err)
  }
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

  const currentIndex = await getRotationIndex()
  const selected = inboxes[currentIndex % inboxes.length]
  const nextIndex = currentIndex + 1

  // Persist next index (non-blocking — failure doesn't stop sending)
  await saveRotationIndex(nextIndex)

  console.log(`[inbox-rotation] Selected inbox ${selected.email} (index ${currentIndex % inboxes.length} of ${inboxes.length})`)
  return selected
}
