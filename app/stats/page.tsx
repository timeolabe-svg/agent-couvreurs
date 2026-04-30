import { DEMO_LEADS } from '@/data/demo'
import { TrendingUp, Mail, MessageSquare, Calendar, Target, BarChart2 } from 'lucide-react'

// Données analytiques simulées — mois d'avril 2026
const WEEKLY_DATA = [
  { label: 'S1 (1-7)',  sent: 12, opened: 8,  replied: 2, rdv: 0 },
  { label: 'S2 (8-14)', sent: 18, opened: 13, replied: 3, rdv: 1 },
  { label: 'S3 (15-21)',sent: 22, opened: 16, replied: 4, rdv: 1 },
  { label: 'S4 (22-30)',sent: 16, opened: 11, replied: 3, rdv: 0 },
]

const SECTOR_DATA = [
  { sector: 'Artisanat / BTP',       sent: 14, replied: 4, rdv: 1, replyRate: 29 },
  { sector: 'Restauration / Food',   sent: 10, replied: 2, rdv: 0, replyRate: 20 },
  { sector: 'Beauté / Bien-être',    sent: 12, replied: 5, rdv: 2, replyRate: 42 },
  { sector: 'Santé / Para-médical',  sent: 8,  replied: 2, rdv: 0, replyRate: 25 },
  { sector: 'Auto / Mobilité',       sent: 6,  replied: 1, rdv: 0, replyRate: 17 },
  { sector: 'Commerce / Retail',     sent: 18, replied: 4, rdv: 1, replyRate: 22 },
]

const FUNNEL = [
  { label: 'Leads sourcés',      value: 68,  pct: 100 },
  { label: 'Emails envoyés',     value: 68,  pct: 100 },
  { label: 'Emails ouverts',     value: 48,  pct: 71 },
  { label: 'Réponses reçues',    value: 12,  pct: 18 },
  { label: 'RDV confirmés',      value: 2,   pct: 3 },
]

const BEST_ANGLES = [
  { angle: 'Cite concurrent en position 1 + écart avis',      replyRate: 38, sent: 24 },
  { angle: 'Score PageSpeed mobile précis (ex: 34/100)',      replyRate: 31, sent: 16 },
  { angle: 'Volume de recherches locales chiffré',            replyRate: 27, sent: 22 },
  { angle: 'Calcul manque à gagner hebdomadaire',             replyRate: 22, sent: 6 },
]

export default function StatsPage() {
  const totalSent   = WEEKLY_DATA.reduce((s, w) => s + w.sent, 0)
  const totalOpened = WEEKLY_DATA.reduce((s, w) => s + w.opened, 0)
  const totalReplied= WEEKLY_DATA.reduce((s, w) => s + w.replied, 0)
  const totalRdv    = DEMO_LEADS.filter(l => l.stage === 'rdv_booked').length
  const openRate    = Math.round((totalOpened / totalSent) * 100)
  const replyRate   = Math.round((totalReplied / totalSent) * 100)

  const maxSent = Math.max(...WEEKLY_DATA.map(w => w.sent))

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Analytique</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            Avril 2026
          </span>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Campagne : PME/TPE — Toulouse &amp; Occitanie</p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-5xl">

          {/* KPIs */}
          <div
            className="grid grid-cols-5 gap-px rounded-lg overflow-hidden mb-6"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            {[
              { label: 'Emails envoyés',   value: String(totalSent),    color: '#3b82f6', icon: <Mail size={13} /> },
              { label: 'Taux d\'ouverture', value: `${openRate}%`,       color: '#8b5cf6', icon: <TrendingUp size={13} /> },
              { label: 'Taux de réponse',  value: `${replyRate}%`,       color: '#f59e0b', icon: <MessageSquare size={13} /> },
              { label: 'RDV confirmés',    value: String(totalRdv),      color: '#22c55e', icon: <Calendar size={13} /> },
              { label: 'Coût par RDV',     value: '~0 €',                color: '#f97316', icon: <Target size={13} /> },
            ].map(k => (
              <div key={k.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-1.5 mb-2" style={{ color: k.color }}>{k.icon}</div>
                <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{k.value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{k.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">

            {/* Weekly bar chart */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <BarChart2 size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Volume hebdomadaire</p>
              </div>
              <div className="p-4" style={{ background: 'var(--color-surface)' }}>
                {WEEKLY_DATA.map(w => (
                  <div key={w.label} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{w.label}</span>
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                        <span>{w.opened} ouverts</span>
                        <span style={{ color: '#f59e0b' }}>{w.replied} rép.</span>
                        {w.rdv > 0 && <span style={{ color: '#22c55e' }}>{w.rdv} RDV</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5 h-5">
                      {/* Envoyés */}
                      <div
                        className="rounded-sm transition-all"
                        style={{
                          width: `${(w.sent / maxSent) * 100}%`,
                          background: '#3b82f620',
                          border: '1px solid #3b82f630',
                          position: 'relative',
                        }}
                      >
                        <div
                          className="h-full rounded-sm"
                          style={{ width: `${(w.opened / w.sent) * 100}%`, background: '#3b82f6' }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{w.sent} envoyés</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>·</span>
                      <span className="text-[10px]" style={{ color: '#3b82f6' }}>{Math.round(w.opened/w.sent*100)}% ouverture</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Conversion funnel */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <Target size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Entonnoir de conversion</p>
              </div>
              <div className="p-4" style={{ background: 'var(--color-surface)' }}>
                {FUNNEL.map((f, i) => (
                  <div key={f.label} className="mb-3 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px]" style={{ color: i === FUNNEL.length - 1 ? '#22c55e' : 'var(--color-muted)' }}>
                        {f.label}
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                        {f.value}
                        <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-muted-2)' }}>({f.pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${f.pct}%`,
                          background: i === FUNNEL.length - 1 ? '#22c55e'
                            : i === FUNNEL.length - 2 ? '#f59e0b'
                            : '#3b82f6',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Performance par secteur */}
          <div className="rounded-lg overflow-hidden mb-4" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <TrendingUp size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Performance par secteur</p>
            </div>
            <div style={{ background: 'var(--color-surface)' }}>
              <div
                className="grid px-4 py-2 text-[11px]"
                style={{ gridTemplateColumns: '1fr 80px 80px 80px 120px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}
              >
                <span>Secteur</span>
                <span className="text-right">Envoyés</span>
                <span className="text-right">Réponses</span>
                <span className="text-right">RDV</span>
                <span className="text-right">Taux réponse</span>
              </div>
              {SECTOR_DATA.sort((a, b) => b.replyRate - a.replyRate).map((s, i) => (
                <div
                  key={s.sector}
                  className="grid px-4 py-2.5 items-center"
                  style={{
                    gridTemplateColumns: '1fr 80px 80px 80px 120px',
                    borderBottom: i < SECTOR_DATA.length - 1 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <span className="text-[12px]" style={{ color: 'var(--color-text)' }}>{s.sector}</span>
                  <span className="text-[12px] text-right" style={{ color: 'var(--color-muted)' }}>{s.sent}</span>
                  <span className="text-[12px] text-right" style={{ color: 'var(--color-muted)' }}>{s.replied}</span>
                  <span className="text-[12px] text-right" style={{ color: s.rdv > 0 ? '#22c55e' : 'var(--color-muted)' }}>{s.rdv}</span>
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.replyRate}%`,
                          background: s.replyRate >= 35 ? '#22c55e' : s.replyRate >= 25 ? '#f59e0b' : '#3b82f6',
                        }}
                      />
                    </div>
                    <span
                      className="text-[11px] w-8 text-right"
                      style={{ color: s.replyRate >= 35 ? '#22c55e' : s.replyRate >= 25 ? '#f59e0b' : 'var(--color-muted)' }}
                    >
                      {s.replyRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Meilleurs angles */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <MessageSquare size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Angles d&apos;accroche — performance comparative</p>
            </div>
            <div style={{ background: 'var(--color-surface)' }}>
              {BEST_ANGLES.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3"
                  style={{ borderBottom: i < BEST_ANGLES.length - 1 ? '1px solid var(--color-border)' : undefined }}
                >
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded flex-shrink-0 font-medium w-8 text-center"
                    style={{ background: '#22c55e15', color: '#22c55e' }}
                  >
                    #{i + 1}
                  </span>
                  <p className="text-[12px] flex-1" style={{ color: 'var(--color-text)' }}>{a.angle}</p>
                  <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>{a.sent} envois</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-20 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${a.replyRate}%`, background: '#22c55e' }}
                      />
                    </div>
                    <span className="text-[11px] font-medium" style={{ color: '#22c55e' }}>{a.replyRate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
