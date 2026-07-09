'use client'

import { useEffect, useState, useCallback } from 'react'
import { Brain, TrendingUp, TrendingDown, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LearningReport {
  id: string
  period_start: string
  period_end: string
  emails_sent: number | null
  reply_rate: number | null
  rdv_count: number | null
  top_sectors: string[] | null
  top_subject_patterns: string[] | null
  recommendations: {
    summary?: string
    topInsights?: string[]
    recommendations?: {
      sectors_to_prioritize?: string[]
      best_send_hours?: number[]
      subject_patterns_to_use?: string[]
      prompt_adjustments?: string
    }
    metrics?: {
      reply_rate?: number
      rdv_rate?: number
      best_sector?: string
      worst_sector?: string
    }
  } | null
  applied: boolean | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPeriod(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const e = new Date(end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  return `Semaine du ${s} au ${e}`
}

// ─── Report Card ──────────────────────────────────────────────────────────────

function ReportCard({
  report,
  onApply,
  applying,
}: {
  report: LearningReport
  onApply: (id: string) => void
  applying: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const recs = report.recommendations
  const metrics = recs?.metrics
  const insights = recs?.topInsights ?? []
  const inner = recs?.recommendations

  return (
    <div
      className="rounded-lg overflow-hidden mb-3"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {/* Header */}
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
        style={{ background: 'var(--color-surface)', borderBottom: expanded ? '1px solid var(--color-border)' : undefined }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
            {formatPeriod(report.period_start, report.period_end)}
          </p>
          {recs?.summary && (
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
              {recs.summary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex gap-3 text-[11px]">
            <span style={{ color: '#3b82f6' }}>
              {report.emails_sent ?? 0} emails
            </span>
            <span style={{ color: report.reply_rate && report.reply_rate >= 5 ? '#10b981' : '#f59e0b' }}>
              {report.reply_rate?.toFixed(1) ?? 0}% réponse
            </span>
            <span style={{ color: '#8b5cf6' }}>
              {report.rdv_count ?? 0} RDV
            </span>
          </div>
          {report.applied ? (
            <span
              className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1"
              style={{ background: '#10b98115', color: '#10b981', border: '1px solid #10b98130' }}
            >
              <CheckCircle2 size={10} />
              Appliqué
            </span>
          ) : null}
          <ChevronRight
            size={14}
            style={{
              color: 'var(--color-muted)',
              transform: expanded ? 'rotate(90deg)' : undefined,
              transition: 'transform 0.2s',
            }}
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-4 space-y-4" style={{ background: 'var(--color-surface)' }}>
          {/* Metrics */}
          {metrics && (
            <div
              className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
              style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
            >
              {[
                { label: 'Taux réponse', value: `${metrics.reply_rate?.toFixed(1) ?? 0}%`, color: '#3b82f6' },
                { label: 'Taux RDV', value: `${metrics.rdv_rate?.toFixed(1) ?? 0}%`, color: '#10b981' },
                { label: 'Meilleur secteur', value: metrics.best_sector ?? '—', color: '#8b5cf6' },
                { label: 'Moins bon secteur', value: metrics.worst_sector ?? '—', color: '#ef4444' },
              ].map((m) => (
                <div key={m.label} className="px-3 py-3" style={{ background: 'var(--color-surface-2)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{m.label}</p>
                  <p className="text-[14px] font-semibold mt-0.5 capitalize" style={{ color: m.color }}>
                    {m.value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Top insights */}
          {insights.length > 0 && (
            <div>
              <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                TOP INSIGHTS
              </p>
              <ul className="space-y-1">
                {insights.map((insight, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: '#f59e0b' }}>→</span>
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {inner && (
            <div
              className="rounded-lg p-3"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
            >
              <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                RECOMMANDATIONS
              </p>
              <div className="space-y-2 text-[12px]">
                {inner.sectors_to_prioritize?.length ? (
                  <p style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Secteurs prioritaires : </span>
                    {inner.sectors_to_prioritize.join(', ')}
                  </p>
                ) : null}
                {inner.best_send_hours?.length ? (
                  <p style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Créneaux optimaux : </span>
                    {inner.best_send_hours.join('h, ')}h
                  </p>
                ) : null}
                {inner.subject_patterns_to_use?.length ? (
                  <p style={{ color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Patterns objet : </span>
                    {inner.subject_patterns_to_use.join(' · ')}
                  </p>
                ) : null}
                {inner.prompt_adjustments ? (
                  <div
                    className="rounded p-2 mt-2 text-[11px]"
                    style={{ background: '#3b82f608', border: '1px solid #3b82f620', color: 'var(--color-text)' }}
                  >
                    <span style={{ color: '#3b82f6', fontWeight: 500 }}>Ajustement prompt : </span>
                    {inner.prompt_adjustments}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Apply button */}
          {!report.applied && (
            <button
              onClick={() => onApply(report.id)}
              disabled={applying}
              className="flex items-center gap-2 px-4 py-2 rounded text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: '#3b82f6', color: '#fff' }}
            >
              {applying ? <RefreshCw size={12} className="animate-spin" /> : null}
              Appliquer les recommandations
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LearningPage() {
  const [reports, setReports] = useState<LearningReport[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [isDemo, setIsDemo] = useState(false)

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/learning/reports')
      if (!res.ok) return
      const json = (await res.json()) as { data: LearningReport[]; _demo?: boolean }
      setReports(json.data ?? [])
      setIsDemo(!!json._demo)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchReports()
  }, [fetchReports])

  const handleApply = async (id: string) => {
    setApplying(id)
    try {
      const res = await fetch(`/api/learning/reports/${id}`, { method: 'PATCH' })
      if (res.ok) {
        setReports((prev) =>
          prev.map((r) => (r.id === id ? { ...r, applied: true } : r)),
        )
      }
    } catch {
      // ignore
    } finally {
      setApplying(null)
    }
  }

  const latestReport = reports[0]
  const avgReplyRate =
    reports.length > 0
      ? reports.reduce((s, r) => s + (r.reply_rate ?? 0), 0) / reports.length
      : null

  // Trend: compare latest to previous
  const trend =
    reports.length >= 2
      ? (reports[0].reply_rate ?? 0) - (reports[1].reply_rate ?? 0)
      : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Auto-Learning — Rapports hebdomadaires
          </h1>
          {isDemo && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: '#f59e0b15', color: '#d97706', border: '1px solid #f59e0b30' }}
            >
              Démo
            </span>
          )}
        </div>
        {latestReport && (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            Dernier rapport : {new Date(latestReport.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl">

          {/* Performance widget */}
          {avgReplyRate !== null && (
            <div
              className="rounded-lg overflow-hidden mb-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="px-4 py-4 flex items-center gap-4" style={{ background: 'var(--color-surface)' }}>
                <Brain size={16} style={{ color: '#3b82f6', flexShrink: 0 }} />
                <div className="flex-1">
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    PERFORMANCE AGENT (MOYENNE {reports.length} SEMAINE{reports.length > 1 ? 'S' : ''})
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[24px] font-semibold" style={{ color: '#3b82f6' }}>
                      {avgReplyRate.toFixed(1)}%
                    </p>
                    {trend !== null && (
                      <span
                        className="flex items-center gap-0.5 text-[12px]"
                        style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}
                      >
                        {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                    taux de réponse moyen
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#10b981' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                  Agent actif
                </div>
              </div>
            </div>
          )}

          {/* Reports list */}
          {loading ? (
            <p className="text-[12px] py-8 text-center" style={{ color: 'var(--color-muted-2)' }}>
              Chargement…
            </p>
          ) : reports.length === 0 ? (
            <div
              className="rounded-lg p-8 text-center"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
            >
              <Brain size={24} style={{ color: 'var(--color-muted)', margin: '0 auto 12px' }} />
              <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
                Aucun rapport généré
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted-2)' }}>
                Le premier rapport sera généré automatiquement dimanche à 20h
              </p>
            </div>
          ) : (
            reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onApply={handleApply}
                applying={applying === report.id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
