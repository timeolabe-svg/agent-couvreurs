'use client'

import Link from 'next/link'
import { DEMO_LEADS } from '@/data/demo'
import { Lead, LeadStage } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'
import { AlertCircle, Clock, CheckCircle2, TrendingUp, Mail, MessageSquare, Calendar, XCircle } from 'lucide-react'

const STAGE_LABEL: Record<LeadStage, string> = {
  prospected:     'Prospecté',
  contacted:      'Email envoyé',
  follow_up_1:    'Relance 1',
  follow_up_2:    'Relance 2',
  replied:        'Réponse reçue',
  rdv_booked:     'RDV confirmé',
  not_interested: 'Non intéressé',
}

const STAGE_COLOR: Record<LeadStage, { bg: string; text: string }> = {
  prospected:     { bg: '#52525215', text: '#737373' },
  contacted:      { bg: '#3b82f615', text: '#3b82f6' },
  follow_up_1:    { bg: '#8b5cf615', text: '#8b5cf6' },
  follow_up_2:    { bg: '#f59e0b15', text: '#d97706' },
  replied:        { bg: '#f97316' + '18', text: '#f97316' },
  rdv_booked:     { bg: '#22c55e15', text: '#22c55e' },
  not_interested: { bg: '#ef444415', text: '#ef4444' },
}

export default function DashboardPage() {
  const total = DEMO_LEADS.length
  const active = DEMO_LEADS.filter(l => !['not_interested', 'rdv_booked'].includes(l.stage)).length
  const replied = DEMO_LEADS.filter(l => l.stage === 'replied').length
  const rdvs = DEMO_LEADS.filter(l => l.stage === 'rdv_booked').length
  const replyRate = Math.round((DEMO_LEADS.filter(l => l.stage !== 'prospected' && l.stage !== 'contacted' && l.stage !== 'not_interested').length / total) * 100)

  const byRecent = (a: Lead, b: Lead) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  const needsAction = DEMO_LEADS.filter(l => l.stage === 'replied').sort(byRecent)
  const inSequence  = DEMO_LEADS.filter(l => ['contacted', 'follow_up_1', 'follow_up_2'].includes(l.stage)).sort(byRecent)
  const closed      = DEMO_LEADS.filter(l => ['rdv_booked', 'not_interested'].includes(l.stage)).sort(byRecent)

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Suivi des leads</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            {total} leads
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
          Agent actif — dernière action il y a 4 min
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-4xl">

          {/* KPIs */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden mb-6"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            {[
              { label: 'Leads en cours',   value: String(active),    icon: <TrendingUp size={14} />,   color: '#3b82f6' },
              { label: 'Réponses reçues',  value: String(replied),   icon: <MessageSquare size={14} />,color: '#f97316' },
              { label: 'RDV confirmés',    value: String(rdvs),      icon: <Calendar size={14} />,     color: '#22c55e' },
              { label: 'Taux de réponse',  value: `${replyRate}%`,   icon: <Mail size={14} />,         color: '#8b5cf6' },
            ].map(s => (
              <div key={s.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="mb-2" style={{ color: s.color }}>{s.icon}</div>
                <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{s.value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Action requise */}
          {needsAction.length > 0 && (
            <Section
              icon={<AlertCircle size={13} style={{ color: '#f97316' }} />}
              title="Action requise"
              subtitle={`${needsAction.length} lead${needsAction.length > 1 ? 's ont' : ' a'} répondu — l'agent doit traiter`}
              leads={needsAction}
              accent="#f97316"
            />
          )}

          {/* En séquence */}
          <Section
            icon={<Clock size={13} style={{ color: 'var(--color-muted)' }} />}
            title="En séquence automatique"
            subtitle={`${inSequence.length} lead${inSequence.length > 1 ? 's' : ''} — l'agent envoie les relances`}
            leads={inSequence}
            accent="#3b82f6"
          />

          {/* Conclus */}
          <Section
            icon={<CheckCircle2 size={13} style={{ color: 'var(--color-muted)' }} />}
            title="Conclus / Fermés"
            subtitle={`${closed.length} lead${closed.length > 1 ? 's' : ''} ce mois`}
            leads={closed}
            accent="#22c55e"
          />

        </div>
      </div>
    </div>
  )
}

function Section({ icon, title, subtitle, leads, accent }: {
  icon: React.ReactNode
  title: string
  subtitle: string
  leads: Lead[]
  accent: string
}) {
  if (leads.length === 0) return null
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{title}</p>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {leads.map((lead, i) => (
          <LeadRow
            key={lead.id}
            lead={lead}
            accent={accent}
            isLast={i === leads.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function LeadRow({ lead, accent, isLast }: { lead: Lead; accent: string; isLast: boolean }) {
  const lastMsg = lead.thread[lead.thread.length - 1]
  const stageStyle = STAGE_COLOR[lead.stage]
  const lastLine = lastMsg?.body.split('\n').find(l => l.trim()) ?? ''

  return (
    <Link href={`/leads/${lead.id}`}>
      <div
        className="flex items-center gap-4 px-4 py-3 group cursor-pointer"
        style={{
          background: 'var(--color-surface)',
          borderBottom: isLast ? undefined : '1px solid var(--color-border)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface)')}
      >
        {/* Left accent */}
        <div className="w-0.5 h-10 rounded-full flex-shrink-0" style={{ background: accent }} />

        {/* Company + excerpt */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>{lead.company}</p>
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
              {lead.city} · {lead.specialty[0]}
            </span>
          </div>
          <p className="text-[11px] truncate" style={{ color: 'var(--color-muted-2)' }}>
            {lastMsg?.author === 'agent' ? 'Agent : ' : `${lead.firstName} : `}
            {lastLine}
          </p>
        </div>

        {/* Stage badge */}
        <span
          className="text-[11px] px-2 py-0.5 rounded flex-shrink-0"
          style={{ background: stageStyle.bg, color: stageStyle.text }}
        >
          {STAGE_LABEL[lead.stage]}
        </span>

        {/* Thread count */}
        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>
          {lead.thread.length} msg
        </span>

        {/* Next action or RDV */}
        {lead.rdvDate && lead.stage === 'rdv_booked' ? (
          <span className="text-[11px] flex-shrink-0" style={{ color: '#22c55e' }}>
            RDV {new Date(lead.rdvDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
        ) : lead.nextScheduledAt ? (
          <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>
            Prochain {new Date(lead.nextScheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
        ) : (
          <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>
            {formatDistanceToNow(new Date(lead.lastActivityAt))}
          </span>
        )}

        {/* Arrow */}
        <span className="text-[12px] flex-shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: 'var(--color-text)' }}>→</span>
      </div>
    </Link>
  )
}
