'use client'

import { useEffect, useState } from 'react'
import { Mail, MessageSquare, AlertTriangle, Calendar, BarChart2, BarChart3 } from 'lucide-react'

type Period = '7d' | '30d' | '90d' | 'all'

interface AnalyticsData {
  period: Period
  emailsSent: number
  replies: number
  replyRate: number
  optouts: number
  bounces: number
  rdvCount: number
  revenue: number
  conversionRate: number
  topCities: Array<{ city: string; sent: number; replies: number; replyRate: number; rdv: number; revenue: number }>
  dailyActivity: Array<{ date: string; sent: number; replies: number }>
  pipeline: { prospects: number; contacted: number; replied: number; rdv: number }
  bestCity: { city: string; replyRate: number; rdv: number } | null
  classificationBreakdown: Array<{ classification: string; count: number }>
  autoRepliesSent: number
  draftsValidated: number
  draftsPending: number
  _demo?: boolean
}

const MEDAL: Record<number, string> = { 0: '🏆', 1: '🥈', 2: '🥉' }

const PERIODS: { id: Period; label: string }[] = [
  { id: '7d', label: '7j' },
  { id: '30d', label: '30j' },
  { id: '90d', label: '90j' },
  { id: 'all', label: 'Tout' },
]

const PIPELINE_ITEMS: { key: keyof AnalyticsData['pipeline']; label: string; color: string }[] = [
  { key: 'prospects', label: 'Prospects', color: '#3b82f6' },
  { key: 'contacted', label: 'Contactés', color: '#3b82f6' },
  { key: 'replied', label: 'Réponses', color: '#f59e0b' },
  { key: 'rdv', label: 'RDV', color: '#10b981' },
]

const CLASSIFICATION_COLORS: Record<string, string> = {
  interest: '#10b981',
  question: '#3b82f6',
  objection: '#f59e0b',
  rdv_request: '#7c3aed',
  desinterest: '#6b6b80',
  oof: '#a78bfa',
  spam: '#ef4444',
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  interest: 'Intérêt',
  question: 'Question',
  objection: 'Objection',
  rdv_request: 'Demande RDV',
  desinterest: 'Désintérêt',
  oof: 'Absent du bureau',
  spam: 'Spam',
}

function formatDate(dateStr: string): string {
  const [, m, day] = dateStr.split('-')
  return `${day}/${m}`
}

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/stats/analytics?period=${period}`)
      .then(r => r.json())
      .then(d => setData(d as AnalyticsData))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const d = data
  const totalReplies = d?.replies ?? 0
  const classBreakdown = d?.classificationBreakdown ?? []

  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0f' }}>
      {/* SECTION 1 — Header */}
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid #1e1e2e' }}
      >
        <div>
          <h1 className="text-[20px] font-bold" style={{ color: '#e8e8f0', letterSpacing: '-0.03em' }}>
            Analytics
          </h1>
          <p className="text-[12px]" style={{ color: '#6b6b80' }}>
            Performance de votre campagne couvreurs Occitanie
          </p>
        </div>

        <div
          className="flex items-center gap-1 p-1 rounded-lg"
          style={{ background: '#1a1a24', border: '1px solid #1e1e2e' }}
        >
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
              style={{
                background: period === p.id ? '#7c3aed' : '#111118',
                color: period === p.id ? '#ffffff' : '#6b6b80',
                border: period === p.id ? 'none' : '1px solid #1e1e2e',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="max-w-6xl space-y-4">
          {loading && (
            <p className="text-[12px]" style={{ color: '#6b6b80' }}>Chargement…</p>
          )}

          {/* SECTION 2 — 4 KPI Cards */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard
              icon={Mail}
              iconColor="#7c3aed"
              label="EMAILS ENVOYÉS"
              value={(d?.emailsSent ?? 0).toLocaleString('fr-FR')}
              sub="+0% vs période préc."
              subColor="#10b981"
            />
            <KpiCard
              icon={MessageSquare}
              iconColor="#10b981"
              label="RÉPONSES"
              value={String(d?.replies ?? 0)}
              sub={`${d?.replyRate ?? 0}% taux de réponse`}
              subColor="#6b6b80"
            />
            <KpiCard
              icon={AlertTriangle}
              iconColor="#f59e0b"
              label="OPT-OUT & BOUNCES"
              value={String((d?.optouts ?? 0) + (d?.bounces ?? 0))}
              sub={`${d?.emailsSent ? (((d.optouts + d.bounces) / d.emailsSent) * 100).toFixed(1) : 0}% du total`}
              subColor="#6b6b80"
            />
            <KpiCard
              icon={Calendar}
              iconColor="#ec4899"
              label="RDV GÉNÉRÉS"
              value={String(d?.rdvCount ?? 0)}
              sub={`${d?.conversionRate ?? 0}% taux de conversion`}
              subColor="#6b6b80"
            />
          </div>

          {/* SECTION 3 — Auto-insight banner */}
          <div
            className="rounded-lg text-[13px]"
            style={{
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: '8px',
              padding: '12px 16px',
            }}
          >
            {d?.bestCity ? (
              <span style={{ color: '#e8e8f0' }}>
                🎯 Meilleure ville ce mois :{' '}
                <strong style={{ color: '#10b981' }}>{d.bestCity.city}</strong> avec{' '}
                <strong style={{ color: '#10b981' }}>{d.bestCity.replyRate}%</strong> de taux de réponse et{' '}
                <strong style={{ color: '#10b981' }}>{d.bestCity.rdv} RDV</strong> générés
              </span>
            ) : (
              <span style={{ color: '#6b6b80' }}>Pas encore assez de données pour générer un insight.</span>
            )}
          </div>

          {/* SECTION 4 — 2-column grid */}
          <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {/* LEFT — Performance par ville */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e2e' }}>
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
              >
                <BarChart2 size={14} style={{ color: '#7c3aed' }} />
                <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Performance par ville</p>
              </div>
              <div style={{ background: '#111118' }}>
                {/* Table header */}
                <div
                  className="grid text-[10px] uppercase tracking-wider"
                  style={{
                    color: '#6b6b80',
                    borderBottom: '1px solid #1e1e2e',
                    padding: '8px 12px',
                    gridTemplateColumns: '1fr 60px 60px 55px 40px 80px',
                  }}
                >
                  <div>Ville</div>
                  <div className="text-right">Envoyés</div>
                  <div className="text-right">Réponses</div>
                  <div className="text-right">Taux</div>
                  <div className="text-right">RDV</div>
                  <div className="text-right">Revenus</div>
                </div>
                {(d?.topCities ?? []).length === 0 ? (
                  <p className="text-[12px] px-4 py-6 text-center" style={{ color: '#4a4a5a' }}>
                    Aucune donnée disponible
                  </p>
                ) : (
                  (d?.topCities ?? [])
                    .slice()
                    .sort((a, b) => b.replyRate - a.replyRate)
                    .map((city, i) => (
                      <div
                        key={city.city}
                        className="grid items-center"
                        style={{
                          gridTemplateColumns: '1fr 60px 60px 55px 40px 80px',
                          borderBottom: '1px solid #1e1e2e',
                          padding: '10px 12px',
                          cursor: 'default',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px]">{MEDAL[i] ?? ''}</span>
                          <span className="text-[12px]" style={{ color: '#e8e8f0' }}>{city.city}</span>
                        </div>
                        <div className="text-right text-[12px]" style={{ color: '#6b6b80' }}>{city.sent}</div>
                        <div className="text-right text-[12px]" style={{ color: '#6b6b80' }}>{city.replies}</div>
                        <div
                          className="text-right text-[12px] font-medium"
                          style={{
                            color: city.replyRate > 5 ? '#10b981' : city.replyRate > 2 ? '#f59e0b' : '#6b6b80',
                          }}
                        >
                          {city.replyRate}%
                        </div>
                        <div className="text-right text-[12px]" style={{ color: '#10b981' }}>{city.rdv}</div>
                        <div className="text-right text-[12px] font-bold" style={{ color: '#a78bfa' }}>
                          {city.rdv * 50} €
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* RIGHT — Pipeline */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e2e' }}>
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
              >
                <span className="text-[14px]">🎯</span>
                <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Répartition du pipeline</p>
              </div>
              <div className="px-4 py-4 space-y-4" style={{ background: '#111118' }}>
                {PIPELINE_ITEMS.map(({ key, label, color }) => {
                  const val = d?.pipeline?.[key] ?? 0
                  const total = d?.pipeline?.prospects ?? 1
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px]" style={{ color: '#e8e8f0' }}>{label}</span>
                        <span className="text-[12px]" style={{ color: '#6b6b80' }}>
                          {val.toLocaleString('fr-FR')} · {pct}%
                        </span>
                      </div>
                      <div className="w-full rounded-sm" style={{ height: '6px', background: '#1a1a24' }}>
                        <div
                          className="h-full rounded-sm transition-all"
                          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                        />
                      </div>
                    </div>
                  )
                })}
                {/* Clients signés */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px]" style={{ color: '#e8e8f0' }}>Clients signés</span>
                    <span className="text-[12px]" style={{ color: '#6b6b80' }}>0 · 0%</span>
                  </div>
                  <div className="w-full rounded-sm" style={{ height: '6px', background: '#1a1a24' }}>
                    <div className="h-full rounded-sm" style={{ width: '0%', background: '#7c3aed' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 5 — Activity bar chart */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e2e' }}>
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
            >
              <BarChart3 size={14} style={{ color: '#7c3aed' }} />
              <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>
                Activité — 30 derniers jours
              </p>
            </div>
            <div className="px-4 pt-4 pb-2" style={{ background: '#111118' }}>
              <DailyActivityChart data={d?.dailyActivity ?? []} />
            </div>
          </div>

          {/* SECTION 6 — Détail des réponses */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e2e' }}>
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
            >
              <MessageSquare size={14} style={{ color: '#7c3aed' }} />
              <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Détail des réponses</p>
            </div>
            <div
              className="grid gap-6 p-4"
              style={{ background: '#111118', gridTemplateColumns: '1fr 1fr' }}
            >
              {/* LEFT — Classification breakdown */}
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider mb-3" style={{ color: '#6b6b80' }}>
                  Répartition des classifications
                </p>
                {classBreakdown.length === 0 ? (
                  <p className="text-[12px]" style={{ color: '#4a4a5a' }}>Aucune donnée disponible</p>
                ) : (
                  classBreakdown.map(item => {
                    const pct = totalReplies > 0 ? Math.round((item.count / totalReplies) * 100) : 0
                    const color = CLASSIFICATION_COLORS[item.classification] ?? '#6b6b80'
                    const label = CLASSIFICATION_LABELS[item.classification] ?? item.classification
                    return (
                      <div key={item.classification} className="flex items-center gap-2">
                        <div
                          className="flex-shrink-0"
                          style={{ width: '10px', height: '10px', background: color, borderRadius: '2px' }}
                        />
                        <span className="flex-1 text-[12px]" style={{ color: '#e8e8f0' }}>{label}</span>
                        <span className="text-[12px] font-medium" style={{ color: '#e8e8f0' }}>{item.count}</span>
                        <span className="text-[11px] w-8 text-right" style={{ color: '#6b6b80' }}>{pct}%</span>
                      </div>
                    )
                  })
                )}
              </div>

              {/* RIGHT — Stats */}
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-wider mb-3" style={{ color: '#6b6b80' }}>
                  Statistiques de traitement
                </p>
                <StatRow label="Réponses auto-envoyées" value={String(d?.autoRepliesSent ?? 0)} />
                <StatRow label="Drafts validés par le client" value={String(d?.draftsValidated ?? 0)} />
                <StatRow label="Drafts en attente" value={String(d?.draftsPending ?? 0)} />
                <StatRow
                  label="Taux conversion réponse → RDV"
                  value={
                    totalReplies > 0
                      ? `${((d?.rdvCount ?? 0) / totalReplies * 100).toFixed(1)}%`
                      : '0%'
                  }
                  highlight
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
  subColor,
}: {
  icon: React.ElementType
  iconColor: string
  label: string
  value: string
  sub: string
  subColor?: string
}) {
  return (
    <div className="rounded-lg p-4" style={{ background: '#111118', border: '1px solid #1e1e2e' }}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
        style={{ background: iconColor + '22' }}
      >
        <Icon size={15} style={{ color: iconColor }} />
      </div>
      <p className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: '#6b6b80' }}>
        {label}
      </p>
      <p className="text-[24px] font-bold leading-none" style={{ color: '#e8e8f0', letterSpacing: '-0.03em' }}>
        {value}
      </p>
      <p className="text-[11px] mt-1.5" style={{ color: subColor ?? '#6b6b80' }}>
        {sub}
      </p>
    </div>
  )
}

// ─── Stat Row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderBottom: '1px solid #1e1e2e' }}
    >
      <span className="text-[12px]" style={{ color: '#6b6b80' }}>{label}</span>
      <span
        className="text-[13px] font-semibold"
        style={{ color: highlight ? '#7c3aed' : '#e8e8f0' }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── 30-day Activity Chart ────────────────────────────────────────────────────

function DailyActivityChart({ data }: { data: Array<{ date: string; sent: number; replies: number }> }) {
  if (data.length === 0) {
    return <p className="text-[12px] py-4 text-center" style={{ color: '#4a4a5a' }}>Aucune donnée</p>
  }
  const max = Math.max(...data.map(d => d.sent), 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', height: '120px', gap: '4px' }}>
        {data.map((d, i) => {
          const isToday = i === data.length - 1
          const heightPct = Math.max((d.sent / max) * 100, 3)
          return (
            <div
              key={d.date}
              style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end' }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${heightPct}%`,
                  background: isToday ? '#7c3aed' : '#1a1a24',
                  borderRadius: '3px 3px 0 0',
                }}
                title={`${formatDate(d.date)}: ${d.sent} envoyés, ${d.replies} réponses`}
              />
            </div>
          )
        })}
      </div>
      {/* Day labels every 5 bars */}
      <div style={{ display: 'flex', marginTop: '6px', gap: '4px' }}>
        {data.map((d, i) => (
          <div key={d.date} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
            {i % 5 === 0 ? (
              <span style={{ fontSize: '8px', color: '#3d3d50' }}>{formatDate(d.date)}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
