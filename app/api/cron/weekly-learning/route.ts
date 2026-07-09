import { NextResponse } from 'next/server'
import { generateText, extractJson } from '@/lib/ai'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[weekly-learning] RESEND_API_KEY not set — skipping email')
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
    console.error('[weekly-learning] Resend error:', res.status, await res.text())
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
    const {
      email_queue,
      incoming_replies,
      rdv: rdvTable,
      learning_reports,
      agent_config,
      contacts,
    } = await import('@/lib/db/schema')
    const { count, gte, and, eq, sql, desc } = await import('drizzle-orm')

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // ── Fetch week metrics ─────────────────────────────────────────────────────
    const [
      [{ sent }],
      [{ replies }],
      [{ rdvCount }],
    ] = await Promise.all([
      db
        .select({ sent: count() })
        .from(email_queue)
        .where(and(eq(email_queue.status, 'sent'), sql`${email_queue.sent_at} >= ${weekAgo}`)),
      db
        .select({ replies: count() })
        .from(incoming_replies)
        .where(gte(incoming_replies.created_at, weekAgo)),
      db
        .select({ rdvCount: count() })
        .from(rdvTable)
        .where(gte(rdvTable.created_at, weekAgo)),
    ])

    const replyRate = sent > 0 ? +((replies / sent) * 100).toFixed(1) : 0

    // Sector breakdown
    const sectorRows = await db
      .select({
        sector: contacts.sector,
        emails: count(email_queue.id),
      })
      .from(email_queue)
      .leftJoin(contacts, sql`${email_queue.contact_id} = ${contacts.id}`)
      .where(sql`${email_queue.sent_at} >= ${weekAgo}`)
      .groupBy(contacts.sector)
    const topSectors = sectorRows
      .filter((r) => r.sector)
      .sort((a, b) => b.emails - a.emails)
      .slice(0, 3)
      .map((r) => r.sector as string)

    // Subject breakdown — top subjects by step
    const subjectRows = await db
      .select({ subject: email_queue.subject, cnt: count() })
      .from(email_queue)
      .where(sql`${email_queue.sent_at} >= ${weekAgo}`)
      .groupBy(email_queue.subject)
      .orderBy(desc(count()))
      .limit(5)
    const topSubjects = subjectRows.map((r) => r.subject)

    // Send time breakdown
    const hourRows = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${email_queue.sent_at})`,
        cnt: count(),
      })
      .from(email_queue)
      .where(sql`${email_queue.sent_at} >= ${weekAgo}`)
      .groupBy(sql`EXTRACT(HOUR FROM ${email_queue.sent_at})`)
      .orderBy(desc(count()))
      .limit(3)
    const topHours = hourRows.map((r) => r.hour)

    // ── Build Claude prompt ────────────────────────────────────────────────────
    const startStr = weekAgo.toLocaleDateString('fr-FR')
    const endStr = now.toLocaleDateString('fr-FR')

    const userPrompt = `Données semaine du ${startStr} au ${endStr} :
- Emails envoyés: ${sent}
- Réponses reçues: ${replies} (${replyRate}%)
- RDV générés: ${rdvCount}
- Meilleurs secteurs: ${topSectors.join(', ') || 'N/A'}
- Meilleurs objets: ${topSubjects.slice(0, 3).join(' | ') || 'N/A'}
- Meilleurs créneaux: ${topHours.join('h, ')}h

Génère un rapport JSON structuré avec :
{
  "summary": "résumé en 2 phrases",
  "topInsights": ["insight 1", "insight 2", "insight 3"],
  "recommendations": {
    "sectors_to_prioritize": ["secteur1", "secteur2"],
    "best_send_hours": [9, 10, 14],
    "subject_patterns_to_use": ["pattern1", "pattern2"],
    "prompt_adjustments": "instruction précise pour améliorer le prompt de génération d'emails"
  },
  "metrics": {
    "reply_rate": ${replyRate},
    "rdv_rate": ${replies > 0 ? +((rdvCount / replies) * 100).toFixed(1) : 0},
    "best_sector": "${topSectors[0] ?? 'N/A'}",
    "worst_sector": "${topSectors[topSectors.length - 1] ?? 'N/A'}"
  }
}`

    const rawText = await generateText({
      system: `Tu es l'analyste IA de Hdigiweb. Tu analyses les performances de prospection cold email pour améliorer les résultats semaine après semaine.`,
      prompt: userPrompt,
      maxTokens: 1024,
      temperature: 0.5,
    })

    const report = extractJson<{
      summary: string
      topInsights: string[]
      recommendations: {
        sectors_to_prioritize: string[]
        best_send_hours: number[]
        subject_patterns_to_use: string[]
        prompt_adjustments: string
      }
      metrics: {
        reply_rate: number
        rdv_rate: number
        best_sector: string
        worst_sector: string
      }
    }>(rawText)

    // ── Insert learning_report ─────────────────────────────────────────────────
    const [inserted] = await db
      .insert(learning_reports)
      .values({
        period_start: weekAgo,
        period_end: now,
        emails_sent: sent,
        reply_rate: replyRate,
        rdv_count: rdvCount,
        top_sectors: topSectors,
        top_subject_patterns: topSubjects,
        recommendations: report as unknown as Record<string, unknown>,
        applied: false,
      })
      .returning({ id: learning_reports.id })

    // ── Update agent_config if prompt_adjustments set ─────────────────────────
    if (report.recommendations?.prompt_adjustments) {
      await db
        .insert(agent_config)
        .values({
          key: 'system_prompt_addon',
          value: report.recommendations.prompt_adjustments,
          updated_by: 'auto_learning',
        })
        .onConflictDoUpdate({
          target: agent_config.key,
          set: {
            value: report.recommendations.prompt_adjustments,
            updated_by: 'auto_learning',
            updated_at: now,
          },
        })
    }

    // ── Send summary email ─────────────────────────────────────────────────────
    const notifyEmail = process.env.CLIENT_NOTIFY_EMAIL
    if (notifyEmail) {
      const insightsHtml = (Array.isArray(report.topInsights) ? report.topInsights : [])
        .map((i) => `<li style="margin-bottom:6px">${i}</li>`)
        .join('')
      const subjectPatternsHtml = (report.recommendations.subject_patterns_to_use ?? [])
        .map((p) => `<li style="margin-bottom:4px"><code style="background:#1e2130;padding:2px 6px;border-radius:3px;font-size:12px">${p}</code></li>`)
        .join('')

      const summaryHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0f1117;color:#e1e4e8;margin:0;padding:24px">
  <div style="max-width:640px;margin:0 auto">

    <div style="background:linear-gradient(135deg,#1a1d27,#16213e);border-radius:10px 10px 0 0;padding:24px 28px">
      <p style="margin:0 0 4px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em">RAPPORT HEBDOMADAIRE — IA AGENT</p>
      <h1 style="margin:0;font-size:20px;font-weight:700;color:#e1e4e8">${startStr} → ${endStr}</h1>
      <p style="margin:8px 0 0;font-size:13px;color:#8b949e;line-height:1.5">${report.summary}</p>
    </div>

    <div style="background:#1a1d27;padding:24px 28px;border-left:1px solid #30363d;border-right:1px solid #30363d">

      <!-- Métriques clés -->
      <p style="margin:0 0 12px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em">PERFORMANCES DE LA SEMAINE</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td width="25%" style="padding:12px;background:#161b22;border:1px solid #30363d;border-radius:6px 0 0 6px;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:700;color:#5f83ac">${sent}</p>
            <p style="margin:4px 0 0;font-size:10px;color:#8b949e">Emails envoyés</p>
          </td>
          <td width="25%" style="padding:12px;background:#161b22;border-top:1px solid #30363d;border-bottom:1px solid #30363d;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:700;color:${replyRate >= 5 ? '#5c9b82' : replyRate >= 2 ? '#c19653' : '#ef4444'}">${replyRate}%</p>
            <p style="margin:4px 0 0;font-size:10px;color:#8b949e">Taux de réponse</p>
          </td>
          <td width="25%" style="padding:12px;background:#161b22;border-top:1px solid #30363d;border-bottom:1px solid #30363d;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:700;color:#8f7bb5">${replies}</p>
            <p style="margin:4px 0 0;font-size:10px;color:#8b949e">Réponses reçues</p>
          </td>
          <td width="25%" style="padding:12px;background:#161b22;border:1px solid #30363d;border-radius:0 6px 6px 0;text-align:center">
            <p style="margin:0;font-size:22px;font-weight:700;color:#5c9b82">${rdvCount}</p>
            <p style="margin:4px 0 0;font-size:10px;color:#8b949e">RDV obtenus</p>
          </td>
        </tr>
      </table>

      <!-- Ce que l'IA a appris -->
      <p style="margin:0 0 12px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em">CE QUE L'IA A DÉTECTÉ CETTE SEMAINE</p>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:24px">
        <ul style="margin:0;padding-left:20px;color:#c9d1d9;font-size:13px;line-height:1.7">
          ${insightsHtml}
        </ul>
      </div>

      <!-- Ajustements IA -->
      <p style="margin:0 0 12px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em">AJUSTEMENTS APPLIQUÉS PAR L'IA</p>
      <div style="background:#161b22;border-left:3px solid #5c9b82;border-radius:0 6px 6px 0;padding:14px 16px;margin-bottom:24px">
        <p style="margin:0;font-size:13px;color:#c9d1d9;line-height:1.6;font-style:italic">${report.recommendations.prompt_adjustments}</p>
      </div>

      <!-- Recommandations pour la semaine -->
      <p style="margin:0 0 12px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em">RECOMMANDATIONS POUR LA SEMAINE SUIVANTE</p>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;margin-bottom:24px">
        <p style="margin:0 0 8px;font-size:12px;color:#e1e4e8"><strong>Secteurs à prioriser :</strong> ${report.recommendations.sectors_to_prioritize.join(', ') || 'N/A'}</p>
        <p style="margin:0 0 8px;font-size:12px;color:#e1e4e8"><strong>Créneaux optimaux :</strong> ${report.recommendations.best_send_hours.join('h, ')}h</p>
        ${subjectPatternsHtml ? `<p style="margin:0 0 8px;font-size:12px;color:#e1e4e8"><strong>Objets performants :</strong></p><ul style="margin:0;padding-left:20px">${subjectPatternsHtml}</ul>` : ''}
      </div>

    </div>

    <div style="background:#161b22;border-radius:0 0 10px 10px;border:1px solid #30363d;border-top:none;padding:16px 28px;text-align:center">
      <p style="margin:0;font-size:11px;color:#8b949e">Rapport généré automatiquement par l'agent IA · Hdigiweb</p>
    </div>

  </div>
</body>
</html>`
      await sendEmail(notifyEmail, `📊 Rapport IA semaine du ${startStr} — ${sent} emails · ${replyRate}% réponses · ${rdvCount} RDV`, summaryHtml)
    }

    return NextResponse.json({
      report_id: inserted.id,
      metrics: report.metrics,
    })
  } catch (err) {
    console.error('[weekly-learning] error:', err)
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    )
  }
}
