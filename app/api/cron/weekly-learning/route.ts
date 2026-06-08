import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

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
      from: 'agent@hdigiweb.fr',
      to,
      subject,
      html,
    }),
  })
  if (!res.ok) {
    console.error('[weekly-learning] Resend error:', res.status, await res.text())
  }
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    const { count, gte, and, sql, desc } = await import('drizzle-orm')

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
        .where(and(sql`${email_queue.sent_at} >= ${weekAgo}`)),
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

    const anthropic = new Anthropic()
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `Tu es l'analyste IA de Hdigiweb. Tu analyses les performances de prospection cold email pour améliorer les résultats semaine après semaine.`,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const rawText = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in AI response')

    const report = JSON.parse(jsonMatch[0]) as {
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
    }

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
      const summaryHtml = `
        <h2>Rapport hebdomadaire — ${startStr} au ${endStr}</h2>
        <p>${report.summary}</p>
        <h3>Métriques</h3>
        <ul>
          <li>Emails envoyés: <strong>${sent}</strong></li>
          <li>Taux de réponse: <strong>${replyRate}%</strong></li>
          <li>RDV générés: <strong>${rdvCount}</strong></li>
        </ul>
        <h3>Top insights</h3>
        <ul>
          ${(Array.isArray(report.topInsights) ? report.topInsights : []).map((i) => `<li>${i}</li>`).join('')}
        </ul>
        <h3>Recommandations</h3>
        <p>Secteurs prioritaires: ${report.recommendations.sectors_to_prioritize.join(', ')}</p>
        <p>Créneaux optimaux: ${report.recommendations.best_send_hours.join('h, ')}h</p>
        <p>Ajustement prompt: <em>${report.recommendations.prompt_adjustments}</em></p>
      `
      await sendEmail(notifyEmail, `Rapport IA semaine du ${startStr}`, summaryHtml)
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
