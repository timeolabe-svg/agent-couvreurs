import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function mockReports() {
  return [
    {
      id: 'mock-1',
      period_start: new Date(Date.now() - 14 * 86400000).toISOString(),
      period_end: new Date(Date.now() - 7 * 86400000).toISOString(),
      emails_sent: 312,
      reply_rate: 8.2,
      rdv_count: 5,
      top_sectors: ['couvreur', 'plombier', 'electricien'],
      top_subject_patterns: ['Visibilité Google', 'Plus de devis'],
      recommendations: {
        summary: 'Bonne semaine avec un taux de réponse supérieur à la moyenne.',
        topInsights: [
          'Les couvreurs répondent 2x plus aux emails envoyés le mardi matin',
          'Les objets courts (<50 car.) performent mieux',
          'Les relances J+3 ont un meilleur taux d\'ouverture',
        ],
        recommendations: {
          sectors_to_prioritize: ['couvreur', 'plombier'],
          best_send_hours: [9, 10, 14],
          subject_patterns_to_use: ['Plus de devis sans pub', 'Visibilité locale'],
          prompt_adjustments: 'Mentionner le nom de la ville du prospect dès la première phrase.',
        },
        metrics: { reply_rate: 8.2, rdv_rate: 19.5, best_sector: 'couvreur', worst_sector: 'electricien' },
      },
      applied: false,
      created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
  ]
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ data: mockReports(), _demo: true })
  }

  try {
    const { db } = await import('@/lib/db')
    const { learning_reports } = await import('@/lib/db/schema')
    const { desc } = await import('drizzle-orm')

    const rows = await db
      .select()
      .from(learning_reports)
      .orderBy(desc(learning_reports.created_at))

    return NextResponse.json({ data: rows })
  } catch (err) {
    console.error('[learning/reports] GET error:', err)
    return NextResponse.json({ data: mockReports(), _demo: true, _error: String(err) })
  }
}
