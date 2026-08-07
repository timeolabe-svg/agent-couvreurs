/**
 * INJECTION DES CONTACTS ORPHELINS — leçon 69/83.
 *
 * Un contact qualifié SANS aucune ligne email_queue est invisible pour tout le pipeline :
 * validate-emails ne sélectionne que les contacts ayant une ligne active, donc il n'est jamais
 * validé, donc jamais promu, donc jamais contacté — à vie, sans erreur ni log.
 * Vécu deux fois (273 puis 73 contacts bloqués) : d'où l'appel AUTOMATIQUE depuis autopilot-tick,
 * plutôt qu'un endpoint admin qu'il faut penser à déclencher.
 *
 * Crée un placeholder step-0 'pending' (jamais envoyé tel quel : send-campaign ne traite que
 * 'queued') → le contact entre dans la rotation de validation → autopilot le promeut ensuite
 * avec le vrai contenu de séquence.
 */
export async function enqueueOrphanContacts(limit = 60): Promise<{ inserted: number; parSecteur: Record<string, number> }> {
  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')
  const { getPausedSectors } = await import('@/lib/experiments')
  const g = (r: unknown) => (r as { rows?: unknown[] }).rows ?? (r as unknown[])

  const paused = await getPausedSectors()
  const camp = g(await db.execute(sql`SELECT id FROM campaigns WHERE status = 'active' LIMIT 1`)) as Array<{ id: string }>
  if (!camp[0]) return { inserted: 0, parSecteur: {} }

  // Secteurs en pause exclus : une pause ne doit jamais faire entrer de NOUVEAUX contacts.
  const pausedFilter = paused.length > 0
    ? sql`AND (c.sector IS NULL OR c.sector NOT IN (${sql.join(paused.map(s => sql`${s}`), sql`, `)}))`
    : sql``

  const orphans = g(await db.execute(sql`
    SELECT c.id, c.sector
    FROM contacts c
    WHERE COALESCE(c.google_reviews_count, 0) >= 20 AND c.email IS NOT NULL AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM blocklist b
        WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
           OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
      )
      ${pausedFilter}
    LIMIT ${limit}
  `)) as Array<{ id: string; sector: string | null }>

  let inserted = 0
  const parSecteur: Record<string, number> = {}
  for (const o of orphans) {
    try {
      await db.execute(sql`
        INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
        VALUES (${o.id}, ${camp[0].id}, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW())
      `)
      inserted++
      const k = o.sector ?? 'inconnu'
      parSecteur[k] = (parSecteur[k] ?? 0) + 1
    } catch { /* contrainte / course : on saute */ }
  }
  return { inserted, parSecteur }
}
