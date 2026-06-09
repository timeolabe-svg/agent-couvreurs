'use client'

import { useEffect, useState } from 'react'
import { Mail, MessageSquare, AlertTriangle, Calendar } from 'lucide-react'

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
  _demo?: boolean
}

const MEDAL: Record<number, string> = { 0: '🏆', 1: '🥈', 2: '🥉' }

const PERIODS: { id: Period; label: string }[] = [
  { id: '7d', label: '7j' },
  { id: '30d', label: '30j' },
  { id: '90d', label: '90j' },
  { id: 'all', label: 'Tout' },
]

const PIPELINE_LABELS: { key: keyof AnalyticsData['pipeline']; label: string; color: string }[] = [
  { key: 'prospects', label: 'Prospects', color: '#6b6b80' },
  { key: 'contacted', label: 'Contactés', color: '#3b82f6' },
  { key: 'replied', label: 'Ont répondu', color: '#f59e0b' },
  { key: 'rdv', label: 'RDV', color: '#10b981' },
]

function formatEuro(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
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

  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0f' }}>
      {/* Header */}
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

        {/* Period selector */}
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
                background: period === p.id ? '#7c3aed' : 'transparent',
                color: period === p.id ? '#fff' : '#6b6b80',
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

          {/* KPI Grid — 4 cards */}
          <div className="grid grid-cols-4 gap-3">
            <KpiCard
              icon={Mail}
              label="Emails envoyés"
              value={(d?.emailsSent ?? 0).toLocaleString('fr-FR')}
              sub={`+0% vs période préc.`}
              iconBg="#3b82f6"
            />
            <KpiCard
              icon={MessageSquare}
              label="Réponses"
              value={String(d?.replies ?? 0)}
              sub={`${d?.replyRate ?? 0}% taux de réponse`}
              iconBg="#7c3aed"
            />
            <KpiCard
              icon={AlertTriangle}
              label="Opt-out & Bounces"
              value={String((d?.optouts ?? 0) + (d?.bounces ?? 0))}
              sub={`${d?.emailsSent ? (((d.optouts + d.bounces) / d.emailsSent) * 100).toFixed(1) : 0}% du total`}
              iconBg="#f59e0b"
            />
            <KpiCard
              icon={Calendar}
              label="RDV générés"
              value={String(d?.rdvCount ?? 0)}
              sub={`${d?.conversionRate ?? 0}% taux de conversion`}
              iconBg="#ec4899"
            />
          </div>

          {/* Auto-insight banner */}
          {d?.bestCity && (
            <div
              className="rounded-lg px-4 py-3 text-[13px]"
              style={{ background: '#10b98112', border: '1px solid #10b98130' }}
            >
              <span style={{ color: '#10b981' }}>
                🎯 Meilleure ville ce mois : <strong>{d.bestCity.city}</strong> avec{' '}
                <strong>{d.bestCity.replyRate}%</strong> de taux de réponse et{' '}
                <strong>{d.bestCity.rdv}</strong> RDV générés
              </span>
            </div>
          )}

          {/* 2-column grid */}
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 300px' }}>
            {/* LEFT — Performance par ville */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid #1e1e2e' }}
            >
              <div
                className="px-4 py-3"
                style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
              >
                <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Performance par ville</p>
              </div>
              <div style={{ background: '#111118' }}>
                {/* Table header */}
                <div
                  className="grid px-4 py-2 text-[10px] uppercase tracking-wider"
                  style={{
                    color: '#6b6b80',
                    borderBottom: '1px solid #1e1e2e',
                    gridTemplateColumns: '1fr 70px 70px 60px 50px 90px',
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
                    Aucune donnée
                  </p>
                ) : (d?.topCities ?? []).map((city, i) => (
                  <div
                    key={city.city}
                    className="grid px-4 py-3 items-center"
                    style={{
                      gridTemplateColumns: '1fr 70px 70px 60px 50px 90px',
                      borderBottom: '1px solid #1e1e2e',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>{MEDAL[i] ?? ''}</span>
                      <span className="text-[12px]" style={{ color: '#e8e8f0' }}>{city.city}</span>
                    </div>
                    <div className="text-right text-[12px]" style={{ color: '#6b6b80' }}>{city.sent}</div>
                    <div className="text-right text-[12px]" style={{ color: '#6b6b80' }}>{city.replies}</div>
                    <div className="text-right text-[12px]" style={{ color: '#f59e0b' }}>{city.replyRate}%</div>
                    <div className="text-right text-[12px]" style={{ color: '#10b981' }}>{city.rdv}</div>
                    <div className="text-right text-[12px] font-semibold" style={{ color: '#a78bfa' }}>
                      {formatEuro(city.revenue)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT — Top statuts pipeline */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid #1e1e2e' }}
            >
              <div
                className="px-4 py-3"
                style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
              >
                <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Pipeline</p>
              </div>
              <div className="px-4 py-4 space-y-3" style={{ background: '#111118' }}>
                {PIPELINE_LABELS.map(({ key, label, color }) => {
                  const val = d?.pipeline?.[key] ?? 0
                  const total = d?.pipeline?.prospects ?? 1
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-[12px]" style={{ color: '#e8e8f0' }}>{label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[12px] font-semibold" style={{ color: '#e8e8f0' }}>{val}</span>
                          <span className="text-[11px] ml-1" style={{ color: '#4a4a5a' }}>({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: '#1a1a24' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Activity 30 days bar chart */}
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid #1e1e2e' }}
          >
            <div
              className="px-4 py-3"
              style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
            >
              <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Activité 30 derniers jours</p>
            </div>
            <div className="px-4 py-4" style={{ background: '#111118' }}>
              <DailyActivityChart data={d?.dailyActivity ?? []} />
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
  label,
  value,
  sub,
  iconBg,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub: string
  iconBg: string
}) {
  return (
    <div className="rounded-lg p-4" style={{ background: '#111118', border: '1px solid #1e1e2e' }}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center mb-3"
        style={{ background: iconBg + '22' }}
      >
        <Icon size={15} style={{ color: iconBg }} />
      </div>
      <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#6b6b80' }}>{label}</p>
      <p className="text-[24px] font-bold mt-0.5 leading-none" style={{ color: '#e8e8f0', letterSpacing: '-0.03em' }}>{value}</p>
      <p className="text-[11px] mt-1" style={{ color: '#6b6b80' }}>{sub}</p>
    </div>
  )
}

// ─── 30-day Activity Chart ────────────────────────────────────────────────────

function DailyActivityChart({ data }: { data: Array<{ date: string; sent: number; replies: number }> }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.sent), 1)
  return (
    <div className="flex items-end gap-0.5 h-[100px]">
      {data.map((d, i) => {
        const isToday = i === data.length - 1
        const pct = (d.sent / max) * 100
        return (
          <div key={d.date} className="flex flex-col items-center flex-1" title={`${d.date}: ${d.sent} envoyés`}>
            <div
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(pct * 0.9, 4)}px`,
                background: isToday ? '#7c3aed' : '#1a1a24',
                border: `1px solid ${isToday ? '#7c3aed' : '#1e1e2e'}`,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
