'use client'

import { useEffect, useState } from 'react'
import { Mail, MessageSquare, Calendar, Clock, TrendingUp, Target, CheckCircle2, XCircle, AlertCircle, BarChart2, Zap } from 'lucide-react'

interface DashboardSummary {
  totalEmailsSent: number
  totalReplies: number
  totalRdv: number
  totalSigned: number
  emailsSentToday: number
  repliesToday: number
  rdvToday: number
  draftsAwaitingValidation: number
  replyRate: number
  rdvRate: number
  pipeline: {
    prospects: number
    contacted: number
    replied: number
    rdv: number
    signed: number
  }
  _demo?: boolean
}

export default function StatsPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/summary')
      .then(r => r.json())
      .then(data => setSummary(data as DashboardSummary))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const s = summary

  const sentTotal = s?.totalEmailsSent ?? 0
  const repliedTotal = s?.totalReplies ?? 0
  const rdvTotal = s?.totalRdv ?? 0
  const openRate = 0 // not tracked in summary API
  const replyRate = s?.replyRate ?? 0
  const rdvRate = s?.rdvRate ?? 0
  const prospects = s?.pipeline?.prospects ?? 0
  const draftsAwaitingValidation = s?.draftsAwaitingValidation ?? 0

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Analytique</h1>
          <span className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            Temps réel
          </span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: '#22c55e' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            {s?._demo ? 'Données démo' : 'Données live'}
          </span>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {loading ? 'Chargement…' : 'Campagne : PME/TPE — Tous secteurs'}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-5xl space-y-4">

          {/* Row 1 — KPIs principaux */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            <Kpi icon={<Mail size={13}/>}          label="Emails envoyés"    value={String(sentTotal)}              color="#3b82f6" />
            <Kpi icon={<TrendingUp size={13}/>}    label="Taux d'ouverture"  value={`${openRate}%`}                  color="#8b5cf6" sub="Non mesuré (Instantly)" />
            <Kpi icon={<MessageSquare size={13}/>} label="Taux de réponse"   value={`${replyRate}%`}                  color="#f59e0b" sub={`${repliedTotal} leads ont répondu`} />
            <Kpi icon={<Calendar size={13}/>}      label="RDV confirmés"     value={String(rdvTotal)}          color="#22c55e" sub={`${rdvRate}% des leads qui ont répondu`} />
          </div>

          {/* Row 2 — KPIs secondaires */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            <Kpi icon={<Clock size={13}/>}         label="Prospects DB"        value={String(prospects)}       color="#3b82f6" sub="contacts en base" />
            <Kpi icon={<AlertCircle size={13}/>}   label="Drafts en attente"      value={String(draftsAwaitingValidation)}      color="#f97316" sub="réponses à valider" />
            <Kpi icon={<XCircle size={13}/>}       label="Clients signés"      value={String(s?.totalSigned ?? 0)}    color="#22c55e" sub="RDV convertis" />
            <Kpi icon={<Target size={13}/>}        label="Coût par RDV"        value="0 €"                               color="#22c55e" sub="Anthropic API seulement" />
          </div>

          {/* Entonnoir réel */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <Target size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Entonnoir de conversion</p>
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>calculé en temps réel</span>
              </div>
              <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
                {[
                  { label: 'Prospects en base',    value: prospects,           color: '#3b82f6' },
                  { label: 'Emails envoyés',         value: sentTotal,           color: '#3b82f6' },
                  { label: 'Leads ont répondu',      value: repliedTotal,        color: '#f59e0b' },
                  { label: 'RDV confirmés',          value: rdvTotal,            color: '#22c55e' },
                  { label: 'Clients signés',         value: s?.totalSigned ?? 0, color: '#8b5cf6' },
                ].map((f, i, arr) => {
                  const base = arr[0].value > 0 ? arr[0].value : 1
                  const pct = Math.round((f.value / base) * 100)
                  return (
                    <div key={f.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px]" style={{ color: i === arr.length - 1 ? '#8b5cf6' : 'var(--color-muted)' }}>
                          {f.label}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                          {f.value}
                          <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-muted-2)' }}>({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: f.color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Statistiques du jour */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <BarChart2 size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Activité du jour</p>
              </div>
              <div className="p-4 space-y-4" style={{ background: 'var(--color-surface)' }}>
                {[
                  { label: "Emails envoyés aujourd'hui", value: s?.emailsSentToday ?? 0, color: '#3b82f6' },
                  { label: "Réponses aujourd'hui",       value: s?.repliesToday ?? 0,    color: '#f59e0b' },
                  { label: "RDV aujourd'hui",            value: s?.rdvToday ?? 0,        color: '#22c55e' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{item.label}</span>
                    <span className="text-[18px] font-semibold tabular-nums" style={{ color: item.color }}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Performance par étape de séquence */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Zap size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Récapitulatif global</p>
            </div>
            <div className="grid grid-cols-4 gap-px"
              style={{ background: 'var(--color-border)' }}>
              {[
                { label: 'Total envoyés',    value: sentTotal,               color: '#3b82f6' },
                { label: 'Total réponses',   value: repliedTotal,            color: '#f59e0b' },
                { label: 'Total RDV',        value: rdvTotal,                color: '#22c55e' },
                { label: 'Total signés',     value: s?.totalSigned ?? 0,    color: '#8b5cf6' },
              ].map(step => (
                <div key={step.label} className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>{step.label}</p>
                  <p className="text-2xl font-semibold mb-0.5" style={{ color: step.color }}>{step.value}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value, color, sub }: { icon: React.ReactNode; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="mb-2" style={{ color }}>{icon}</div>
      <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>{sub}</p>}
    </div>
  )
}
