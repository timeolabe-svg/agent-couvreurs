'use client'

import { DEMO_CAMPAIGNS } from '@/data/prospects'

const WEEKLY_DATA = [
  { day: 'Lun', sent: 18, opened: 11, replied: 3 },
  { day: 'Mar', sent: 22, opened: 15, replied: 4 },
  { day: 'Mer', sent: 15, opened: 9, replied: 2 },
  { day: 'Jeu', sent: 26, opened: 17, replied: 5 },
  { day: 'Ven', sent: 21, opened: 13, replied: 3 },
  { day: 'Sam', sent: 0, opened: 0, replied: 0 },
  { day: 'Dim', sent: 0, opened: 0, replied: 0 },
]

const maxSent = Math.max(...WEEKLY_DATA.map(d => d.sent))

const CONVERSION_FUNNEL = [
  { label: 'Prospects identifiés', count: 30, color: '#6b6b8a' },
  { label: 'Emails envoyés', count: 102, color: '#6366f1' },
  { label: 'Emails ouverts', count: 62, color: '#f59e0b' },
  { label: 'Réponses reçues', count: 19, color: '#a855f7' },
  { label: 'Intéressés', count: 8, color: '#06b6d4' },
  { label: 'RDV réservés', count: 6, color: '#22c55e' },
]

const maxFunnel = CONVERSION_FUNNEL[1].count

export default function StatsPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Stats</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Performances de l&apos;agent — 30 derniers jours
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        {[
          { label: 'Taux d\'ouverture', value: '61%', sub: 'Industrie: ~25%', up: true },
          { label: 'Taux de réponse', value: '19%', sub: 'Industrie: ~8%', up: true },
          { label: 'Taux de clic RDV', value: '6%', sub: 'Industrie: ~2%', up: true },
          { label: 'Coût par RDV', value: '~18€', sub: 'Google Ads: ~85€', up: true },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="rounded-xl p-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
              {kpi.value}
            </p>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{kpi.label}</p>
            <p className="text-xs" style={{ color: '#22c55e' }}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
        {/* Bar chart */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="font-semibold text-sm mb-5" style={{ color: 'var(--color-text)' }}>
            Activité cette semaine
          </h2>
          <div className="flex items-end gap-3 h-40">
            {WEEKLY_DATA.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col-reverse gap-0.5">
                  {/* Bars */}
                  <div
                    className="w-full rounded-sm transition-all"
                    style={{
                      height: `${(d.sent / maxSent) * 100}px`,
                      background: 'var(--color-accent)',
                      opacity: 0.7,
                      minHeight: d.sent > 0 ? '4px' : '0',
                    }}
                  />
                </div>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{d.day}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3">
            <LegendDot color="var(--color-accent)" label="Emails envoyés" />
          </div>
        </div>

        {/* Funnel */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="font-semibold text-sm mb-5" style={{ color: 'var(--color-text)' }}>
            Entonnoir de conversion
          </h2>
          <div className="flex flex-col gap-2.5">
            {CONVERSION_FUNNEL.map(item => (
              <div key={item.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{item.label}</span>
                  <span className="text-xs font-bold" style={{ color: item.color }}>{item.count}</span>
                </div>
                <div
                  className="h-2 rounded-full overflow-hidden"
                  style={{ background: 'var(--color-surface-2)' }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(item.count / maxFunnel) * 100}%`,
                      background: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Campaign comparison */}
      <div
        className="rounded-xl p-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <h2 className="font-semibold text-sm mb-4" style={{ color: 'var(--color-text)' }}>
          Comparaison des campagnes
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Campagne', 'Envoyés', 'Ouverture', 'Réponse', 'RDV', 'Performance'].map(h => (
                  <th
                    key={h}
                    className="text-left pb-3 text-xs font-medium"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEMO_CAMPAIGNS.filter(c => c.status !== 'draft').map(c => (
                <tr
                  key={c.id}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <td className="py-3">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.targetZone}</p>
                  </td>
                  <td className="py-3 text-sm" style={{ color: 'var(--color-text)' }}>{c.emailsSent}</td>
                  <td className="py-3">
                    <span className="text-sm" style={{ color: c.openRate >= 55 ? '#22c55e' : '#f59e0b' }}>
                      {c.openRate}%
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="text-sm" style={{ color: c.replyRate >= 18 ? '#22c55e' : '#f59e0b' }}>
                      {c.replyRate}%
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="text-sm font-bold" style={{ color: '#22c55e' }}>{c.rdvCount}</span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="flex-1 h-1.5 rounded-full"
                        style={{ background: 'var(--color-surface-2)', maxWidth: '80px' }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(c.replyRate * 4, 100)}%`,
                            background: c.replyRate >= 18 ? '#22c55e' : '#f59e0b',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
    </div>
  )
}
