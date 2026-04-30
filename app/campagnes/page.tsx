'use client'

import { useState } from 'react'
import { DEMO_CAMPAIGNS } from '@/data/prospects'
import {
  Play, Pause, FileEdit, BarChart2,
  Users, Mail, TrendingUp, CalendarCheck, Zap,
} from 'lucide-react'

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#22c55e20', text: '#22c55e', label: 'Active' },
  paused: { bg: '#f59e0b20', text: '#f59e0b', label: 'En pause' },
  draft: { bg: '#6b6b8a20', text: '#6b6b8a', label: 'Brouillon' },
  completed: { bg: '#6366f120', text: '#6366f1', label: 'Terminée' },
}

const SEQUENCES = [
  { day: 'J0', label: 'Email initial', desc: 'Accroche personnalisée + valeur' },
  { day: 'J+2', label: 'Relance 1', desc: 'Courte, directe, sans copier-coller' },
  { day: 'J+5', label: 'Relance 2', desc: 'Preuve sociale ou élément de valeur' },
  { day: 'J+10', label: 'Relance 3 (fin)', desc: 'Clôture propre, porte ouverte' },
]

export default function CampagnesPage() {
  const [campaigns] = useState(DEMO_CAMPAIGNS)

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {campaigns.filter(c => c.status === 'active').length} actives · {campaigns.length} total
          </p>
        </div>
        <button
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-accent)' }}
        >
          + Nouvelle campagne
        </button>
      </div>

      {/* Sequence visualizer */}
      <div
        className="rounded-xl p-5 mb-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} style={{ color: 'var(--color-accent)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Séquence automatique
          </h2>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {SEQUENCES.map((s, i) => (
            <div key={i} className="flex items-center gap-3 flex-shrink-0">
              <div
                className="rounded-xl p-4 w-40"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <div
                  className="text-xs font-bold mb-1"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {s.day}
                </div>
                <div className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                  {s.label}
                </div>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {s.desc}
                </div>
              </div>
              {i < SEQUENCES.length - 1 && (
                <div className="text-lg" style={{ color: 'var(--color-border)' }}>→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Campaigns list */}
      <div className="flex flex-col gap-4">
        {campaigns.map(c => {
          const s = STATUS_STYLE[c.status]
          return (
            <div
              key={c.id}
              className="rounded-xl p-5"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                      {c.name}
                    </h3>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: s.bg, color: s.text }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {c.targetZone} · {c.niche}
                  </p>
                </div>
                <div className="flex gap-2">
                  {c.status === 'active' && (
                    <button
                      className="p-2 rounded-lg transition-opacity hover:opacity-70"
                      style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
                    >
                      <Pause size={14} />
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button
                      className="p-2 rounded-lg transition-opacity hover:opacity-70"
                      style={{ background: '#22c55e20', color: '#22c55e' }}
                    >
                      <Play size={14} />
                    </button>
                  )}
                  {c.status === 'draft' && (
                    <button
                      className="p-2 rounded-lg transition-opacity hover:opacity-70"
                      style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}
                    >
                      <Play size={14} />
                    </button>
                  )}
                  <button
                    className="p-2 rounded-lg transition-opacity hover:opacity-70"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
                  >
                    <FileEdit size={14} />
                  </button>
                </div>
              </div>

              {c.status !== 'draft' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric icon={<Users size={13} />} label="Prospects" value={c.prospectCount} color="var(--color-muted)" />
                  <Metric icon={<Mail size={13} />} label="Envoyés" value={c.emailsSent} color="#6366f1" />
                  <Metric icon={<TrendingUp size={13} />} label="Ouverture" value={`${c.openRate}%`} color="#f59e0b" />
                  <Metric icon={<CalendarCheck size={13} />} label="RDV" value={c.rdvCount} color="#22c55e" />
                </div>
              )}

              {c.status === 'draft' && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
                >
                  <FileEdit size={12} />
                  Campagne en préparation — configurez les prospects et lancez
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ background: 'var(--color-surface-2)' }}
    >
      <span style={{ color }}>{icon}</span>
      <div>
        <p className="text-xs font-bold" style={{ color }}>{value}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      </div>
    </div>
  )
}
