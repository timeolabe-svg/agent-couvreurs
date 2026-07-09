import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[morning-digest] RESEND_API_KEY not set — skipping email')
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // RESEND_FROM_EMAIL must be set to a verified Resend domain
      // e.g. agent@hdigiweb.fr (requires DNS verification in resend.com)
      // Falls back to onboarding@resend.dev for testing
      from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
      to: to.split(',').map(s => s.trim()).filter(Boolean),
      subject,
      html,
    }),
  })
  if (!res.ok) {
    console.error('[morning-digest] Resend error:', res.status, await res.text())
  }
}

export async function GET(req: Request) {
  const cronAuth = checkCronAuth(req)
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status })

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })
  }

  try {
    const { db } = await import('@/lib/db')
    const { email_queue, incoming_replies, reply_drafts, rdv: rdvTable, contacts } =
      await import('@/lib/db/schema')
    const { count, gte, and, eq, sql } = await import('drizzle-orm')

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayEvening = new Date(todayStart.getTime() - 20 * 60 * 60 * 1000) // last 20 hours

    const [
      [{ emailsNight }],
      [{ newReplies }],
      [{ pendingDrafts }],
      todayRdvs,
    ] = await Promise.all([
      db
        .select({ emailsNight: count() })
        .from(email_queue)
        .where(
          and(
            eq(email_queue.status, 'sent'),
            gte(email_queue.sent_at, yesterdayEvening),
          ),
        ),
      db
        .select({ newReplies: count() })
        .from(incoming_replies)
        .where(gte(incoming_replies.created_at, yesterdayEvening)),
      db
        .select({ pendingDrafts: count() })
        .from(reply_drafts)
        .where(eq(reply_drafts.status, 'pending')),
      db
        .select({
          scheduled_at: rdvTable.scheduled_at,
          company: contacts.company,
        })
        .from(rdvTable)
        .leftJoin(contacts, sql`${rdvTable.contact_id} = ${contacts.id}`)
        .where(
          and(
            gte(rdvTable.scheduled_at, todayStart),
            sql`${rdvTable.scheduled_at} < ${new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)}`,
          ),
        )
        .orderBy(rdvTable.scheduled_at),
    ])

    // ── Warmup health from Instantly (optional) ────────────────────────────────
    let warmupIssues: string[] = []
    try {
      const { getWarmupStats } = await import('@/lib/instantly/client')
      const stats = await getWarmupStats()
      warmupIssues = stats
        .filter((s) => s.health_score < 70)
        .map((s) => `${s.email}: score ${s.health_score}`)
    } catch {
      // ignore
    }

    // ── Build HTML email ───────────────────────────────────────────────────────
    const rdvListHtml =
      todayRdvs.length === 0
        ? '<p style="color:#6b7280;font-style:italic">Aucun RDV aujourd\'hui</p>'
        : `<ul>${todayRdvs
            .map((r) => {
              const time = r.scheduled_at
                ? new Date(r.scheduled_at).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '?h'
              return `<li><strong>${time}</strong> — ${r.company ?? 'Prospect'}</li>`
            })
            .join('')}</ul>`

    const actionsHtml =
      pendingDrafts > 0
        ? `<p>📝 <strong>${pendingDrafts} draft${pendingDrafts > 1 ? 's' : ''} en attente</strong> de validation → <a href="${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://agent.hdigiweb.fr'}/reponses-a-valider" style="color:#3b82f6">Valider maintenant</a></p>`
        : `<p style="color:#10b981;font-weight:bold">Tout roule ✓ — Aucune action requise</p>`

    const warmupHtml =
      warmupIssues.length > 0
        ? `<h3 style="color:#f59e0b">⚠️ Alertes deliverability</h3><ul>${warmupIssues.map((i) => `<li>${i}</li>`).join('')}</ul>`
        : ''

    // Alerte critique : aucun email envoyé depuis 20h un jour de semaine → problème pipeline
    const dayOfWeek = now.getDay() // 0=dim, 6=sam
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
    const zeroSendAlertHtml = (emailsNight === 0 && isWeekday)
      ? `<div style="background:#fef2f2;border:2px solid #ef4444;border-radius:8px;padding:16px;margin:16px 0">
          <h3 style="color:#dc2626;margin:0 0 8px">🚨 ALERTE — Aucun email envoyé cette nuit</h3>
          <p style="margin:0;color:#7f1d1d">Le pipeline n'a envoyé aucun email depuis 20h en jour ouvré. Vérifier :<br>
          1. Cron autopilot actif sur cron-job.org ?<br>
          2. Logs Vercel → /api/cron/autopilot-tick<br>
          3. Quota Instantly non dépassé ?<br>
          4. Leads en attente en base (contacts audit_done + email_validated) ?</p>
        </div>`
      : ''

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Digest matinal Hdigiweb</title></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111">
  <h1 style="font-size:20px;margin-bottom:4px">🌅 Bonne journée, ${process.env.CLIENT_NAME ?? 'Thomas'} !</h1>
  <p style="color:#6b7280;margin-top:0">Digest du ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">

  <h2 style="font-size:15px">📊 Cette nuit</h2>
  <ul>
    <li><strong>${emailsNight}</strong> emails envoyés</li>
    <li><strong>${newReplies}</strong> nouvelle${newReplies > 1 ? 's' : ''} réponse${newReplies > 1 ? 's' : ''} (${pendingDrafts} à valider)</li>
  </ul>

  <h2 style="font-size:15px">📅 Agenda du jour</h2>
  ${rdvListHtml}

  <h2 style="font-size:15px">⚡ Actions requises</h2>
  ${actionsHtml}

  ${zeroSendAlertHtml}
  ${warmupHtml}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
  <p style="color:#9ca3af;font-size:12px">Hdigiweb Agent IA · Généré automatiquement à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
</body>
</html>`

    const notifyEmail = process.env.CLIENT_NOTIFY_EMAIL
    if (notifyEmail) {
      const subject = (emailsNight === 0 && isWeekday)
        ? `🚨 ALERTE — 0 email envoyé cette nuit · ${newReplies} réponses · ${todayRdvs.length} RDV`
        : `🌅 Digest matinal — ${emailsNight} emails · ${newReplies} réponses · ${todayRdvs.length} RDV`
      await sendEmail(notifyEmail, subject, html)
    }

    return NextResponse.json({
      emailsNight,
      newReplies,
      pendingDrafts,
      todayRdvs: todayRdvs.length,
      warmupIssues: warmupIssues.length,
      emailSent: !!notifyEmail,
    })
  } catch (err) {
    console.error('[morning-digest] error:', err)
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    )
  }
}
