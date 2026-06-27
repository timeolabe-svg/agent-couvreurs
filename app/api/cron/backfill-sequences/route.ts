import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Traite 5 contacts par run — lancé à chaque tick autopilot (1h)
// Regénère subject2/body2/.../subject4/body4 pour les leads Instantly qui n'ont que subject/body

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  }

  const { db } = await import('@/lib/db')
  const { contacts, email_queue } = await import('@/lib/db/schema')
  const { eq, and, isNull, sql } = await import('drizzle-orm')
  const { generateSequence } = await import('@/lib/email-generator')
  const { updateLeadVariables } = await import('@/lib/instantly/client')

  const campaignId = process.env.INSTANTLY_CAMPAIGN_ID ?? ''
  const inboxes = (process.env.INSTANTLY_INBOXES ?? '').split(',').filter(Boolean)
  const inboxNames = (process.env.INSTANTLY_INBOX_NAMES ?? '').split(',').filter(Boolean)
  const defaultInbox = inboxes[0] ?? 'gabin@hdigiweb-agence.com'
  const defaultName = inboxNames[0] ?? 'Gabin'

  // Contacts envoyés mais sans sequence_vars_filled (on utilise un champ notes dans le futur)
  // Pour l'instant : on prend les plus anciens contacts avec emails envoyés
  // et on les traite par batch de 5. On marque avec un flag dans agent_config pour savoir où on en est.
  const { agent_config } = await import('@/lib/db/schema')

  // Lire l'offset actuel
  const [offsetRow] = await db.select().from(agent_config).where(eq(agent_config.key, 'backfill_seq_offset'))
  const offset = parseInt(offsetRow?.value ?? '0', 10)

  // Récupérer 5 contacts avec emails envoyés à cet offset
  const rows = await db
    .select({
      contactId: contacts.id,
      email: contacts.email,
      company: contacts.company,
      city: contacts.city,
      sector: contacts.sector,
      website: contacts.website,
      name: contacts.name,
    })
    .from(contacts)
    .innerJoin(email_queue, and(
      eq(email_queue.contact_id, contacts.id),
      eq(email_queue.status, 'sent'),
    ))
    .groupBy(contacts.id)
    .orderBy(sql`MIN(${email_queue.sent_at}) ASC`)
    .limit(5)
    .offset(offset)

  if (rows.length === 0) {
    // Backfill terminé, reset l'offset
    await db.insert(agent_config).values({ key: 'backfill_seq_offset', value: '0', updated_by: 'backfill' })
      .onConflictDoUpdate({ target: agent_config.key, set: { value: '0', updated_by: 'backfill' } })
    return NextResponse.json({ done: true, message: 'Backfill terminé, offset remis à 0' })
  }

  let updated = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      // Construire un Lead compatible avec generateSequence
      const lead = {
        id: row.contactId,
        company: row.company,
        contact: row.name ?? '',
        firstName: row.name?.split(' ')[0] ?? '',
        email: row.email,
        city: row.city ?? '',
        website: row.website ?? undefined,
        hasWebsite: Boolean(row.website),
        hasGoogleAds: false,
        specialty: [row.sector ?? 'couvreur'],
        stage: 'contacted' as const,
        thread: [],
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        googleRating: undefined,
        googleReviews: undefined,
      }

      const emails = await generateSequence(lead, defaultInbox, defaultName)

      // On ne pousse que les variables step 2-4 (step 1 a déjà été envoyé)
      const vars: Record<string, string> = {}
      emails.slice(1).forEach((e, i) => {
        const suffix = String(i + 2)
        vars[`subject${suffix}`] = e.subject
        vars[`body${suffix}`] = e.body
      })

      await updateLeadVariables(campaignId, row.email, vars)
      updated++
      console.log(`[backfill-seq] Mis à jour : ${row.email}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${row.email}: ${msg}`)
      console.error('[backfill-seq] Erreur pour', row.email, err)
    }
  }

  // Avancer l'offset
  const newOffset = offset + rows.length
  await db.insert(agent_config).values({ key: 'backfill_seq_offset', value: String(newOffset), updated_by: 'backfill' })
    .onConflictDoUpdate({ target: agent_config.key, set: { value: String(newOffset), updated_by: 'backfill' } })

  return NextResponse.json({ updated, errors, nextOffset: newOffset, remaining: rows.length === 5 ? 'plus à traiter' : 'dernier batch' })
}
