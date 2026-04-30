'use client'

import { useEffect } from 'react'
import { DEMO_PROSPECTS, DEMO_CAMPAIGNS } from '@/data/prospects'
import { DEMO_GENERATED_EMAILS, DEMO_REPLIES } from '@/data/emails'
import {
  Users, Mail, CalendarCheck, TrendingUp,
  Target, Clock, Zap, ArrowUpRight,
} from 'lucide-react'

const stats = [
  {
    label: 'Prospects total',
    value: DEMO_PROSPECTS.length,
    sub: '+8 cette semaine',
    icon: Users,
    color: '#6366f1',
  },
  {
    label: 'Emails envoyés',
    value: 102,
    sub: '34 cette semaine',
    icon: Mail,
    color: '#22c55e',
  },
  {
    label: 'Taux d\'ouverture',
    value: '61%',
    sub: '↑ +4% vs mois dernier',
    icon: TrendingUp,
    color: '#f59e0b',
  },
  {
    label: 'Taux de réponse',
    value: '19%',
    sub: '↑ +2% vs mois dernier',
    icon: Target,
    color: '#a855f7',
  },
  {
    label: 'RDV générés',
    value: 6,
    sub: '3 ce mois',
    icon: CalendarCheck,
    color: '#06b6d4',
  },
  {
    label: 'Séquences actives',
    value: 3,
    sub: '47 prospects en cours',
    icon: Zap,
    color: '#f43f5e',
  },
]

const recentActivity = [
  { text: 'Bernard Couverture (Bordeaux) a répondu', time: 'il y a 2h', type: 'reply' },
  { text: 'Pro Couverture Alsace — RDV confirmé', time: 'il y a 4h', type: 'rdv' },
  { text: '8 emails envoyés — Campagne Sud-Ouest', time: 'il y a 5h', type: 'send' },
  { text: 'Couverture Atlantique — RDV réservé', time: 'hier', type: 'rdv' },
  { text: 'Normandie Couverture a répondu (intéressé)', time: 'hier', type: 'reply' },
  { text: 'Nouvelle campagne créée — Grand Est', time: 'il y a 2j', type: 'campaign' },
]

const activityColors: Record<string, string> = {
  reply: '#6366f1',
  rdv: '#22c55e',
  send: '#f59e0b',
  campaign: '#a855f7',
}

const interested = DEMO_PROSPECTS.filter(p => p.status === 'interested' || p.status === 'rdv_booked')

export default function Dashboard() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
          Dashboard
        </h1>
        <p style={{ color: 'var(--color-muted)' }} className="text-sm mt-1">
          Agent Couvreurs — Selquia · Mode démo
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-3">
        {stats.map(({ label, value, sub, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl p-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: `${color}20` }}
              >
                <Icon size={18} style={{ color }} />
              </div>
            </div>
            <div className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
              {value}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {label}
            </div>
            <div className="text-xs mt-1" style={{ color }}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Activity feed */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <h2 className="font-semibold text-sm mb-4" style={{ color: 'var(--color-text)' }}>
            Activité récente
          </h2>
          <div className="flex flex-col gap-3">
            {recentActivity.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: activityColors[item.type] }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {item.text}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {item.time}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hot leads */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
              Leads chauds
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}
            >
              {interested.length} actifs
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {interested.map(p => (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {p.company}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {p.city} · {p.specialty[0]}
                  </p>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: p.status === 'rdv_booked' ? '#22c55e20' : 'var(--color-accent-glow)',
                    color: p.status === 'rdv_booked' ? '#22c55e' : 'var(--color-accent)',
                  }}
                >
                  {p.status === 'rdv_booked' ? 'RDV réservé' : 'Intéressé'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline bar */}
      <div
        className="mt-6 rounded-xl p-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <h2 className="font-semibold text-sm mb-4" style={{ color: 'var(--color-text)' }}>
          Pipeline prospects
        </h2>
        <div className="flex gap-3 flex-wrap">
          {[
            { label: 'Nouveaux', count: DEMO_PROSPECTS.filter(p => p.status === 'new').length, color: '#6b6b8a' },
            { label: 'Contactés', count: DEMO_PROSPECTS.filter(p => p.status === 'contacted').length, color: '#6366f1' },
            { label: 'Réponse reçue', count: DEMO_PROSPECTS.filter(p => p.status === 'replied').length, color: '#f59e0b' },
            { label: 'Intéressés', count: DEMO_PROSPECTS.filter(p => p.status === 'interested').length, color: '#a855f7' },
            { label: 'RDV réservé', count: DEMO_PROSPECTS.filter(p => p.status === 'rdv_booked').length, color: '#22c55e' },
            { label: 'Plus tard', count: DEMO_PROSPECTS.filter(p => p.status === 'later').length, color: '#06b6d4' },
            { label: 'Pas intéressé', count: DEMO_PROSPECTS.filter(p => p.status === 'not_interested').length, color: '#ef4444' },
          ].map(({ label, count, color }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
            >
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
              <span className="text-xs font-bold" style={{ color }}>{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
