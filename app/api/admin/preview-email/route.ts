import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// PRÉVISUALISATION — génère les emails avec le prompt actuel sur de VRAIS contacts
// audités, sans rien envoyer ni écrire en base. Sert à valider le style avant que
// ça parte aux prospects. Protégé par le middleware (session dashboard requise).
// Usage : ouvrir /api/admin/preview-email dans le navigateur (connecté).
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  const { db } = await import('@/lib/db')
  const { contacts } = await import('@/lib/db/schema')
  const { eq, sql } = await import('drizzle-orm')
  const { generateSequence } = await import('@/lib/email-generator')

  // 3 contacts audités au hasard (variété de défauts).
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.audit_done, true))
    .orderBy(sql`random()`)
    .limit(3)

  if (rows.length === 0) {
    return NextResponse.json({ message: 'Aucun contact audité pour le moment — attends que le cron audit-sites tourne un peu.' })
  }

  const inbox = (process.env.INSTANTLY_INBOXES ?? 'gabin@hdigiweb-agence.com').split(',')[0].trim()
  const inboxName = (process.env.INSTANTLY_INBOX_NAMES ?? 'Gabin').split(',')[0].trim()

  const preview = []
  for (const c of rows) {
    const lead = {
      id: c.id,
      company: c.company,
      contact: c.name ?? '',
      firstName: c.name?.split(' ')[0] ?? '',
      email: c.email,
      phone: c.phone ?? undefined,
      city: c.city ?? '',
      website: c.website ?? undefined,
      googleRating: c.google_rating ?? undefined,
      googleReviews: c.google_reviews_count ?? undefined,
      specialty: c.sector ? [c.sector] : ['artisan du bâtiment'],
      hasGoogleAds: false,
      hasWebsite: Boolean(c.website),
      auditScore: c.audit_score ?? undefined,
      auditLevel: c.audit_level ?? undefined,
      auditWeaknesses: c.audit_weaknesses ?? undefined,
      auditCms: c.audit_cms ?? undefined,
      stage: 'contacted' as const,
      thread: [],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    }
    try {
      const emails = await generateSequence(lead, inbox, inboxName)
      preview.push({
        entreprise: c.company,
        metier: c.sector,
        ville: c.city,
        site: c.website,
        audit_niveau: c.audit_level,
        audit_defauts: c.audit_weaknesses,
        emails,
      })
    } catch (err) {
      preview.push({ entreprise: c.company, erreur: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ preview }, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}
