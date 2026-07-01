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

  const esc = (s: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const blocks: string[] = []
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
      preview.push({ entreprise: c.company, emails })
      const labels = ['Email 1 (J+0)', 'Relance 1 (J+3)', 'Relance 2 (J+7)', 'Relance 3 (J+14)']
      const emailsHtml = emails.map((e, i) => `
        <div style="border:1px solid #ddd;border-radius:8px;margin:10px 0;padding:12px">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">${labels[i] ?? 'Email'} · ${e.body.split(/\s+/).length} mots</div>
          <div style="font-weight:600;margin:6px 0">Objet : ${esc(e.subject)}</div>
          <div style="white-space:pre-wrap;font-family:system-ui;line-height:1.5">${esc(e.body)}</div>
        </div>`).join('')
      blocks.push(`
        <section style="margin:24px 0;padding:16px;background:#fafafa;border-radius:10px">
          <h2 style="margin:0 0 4px">${esc(c.company)}</h2>
          <div style="color:#666;font-size:13px">${esc(c.sector ?? '')} · ${esc(c.city ?? '')} · site: ${esc(c.website ?? 'aucun')}</div>
          <div style="color:#666;font-size:13px;margin:4px 0 8px">Audit : <b>${esc(c.audit_level ?? '')}</b> — défauts : ${esc((c.audit_weaknesses ?? []).join(' · ') || 'aucun')}</div>
          ${emailsHtml}
        </section>`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      preview.push({ entreprise: c.company, erreur: msg })
      blocks.push(`<section style="color:#c00">${esc(c.company)} : erreur ${esc(msg)}</section>`)
    }
  }

  const html = `<!doctype html><meta charset="utf-8"><title>Preview emails</title>
    <div style="max-width:720px;margin:24px auto;font-family:system-ui;padding:0 16px">
      <h1>Prévisualisation des emails générés</h1>
      <p style="color:#666">Sur de vrais contacts audités. Rien n'est envoyé. Rafraîchis pour d'autres exemples.</p>
      ${blocks.join('')}
    </div>`

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
