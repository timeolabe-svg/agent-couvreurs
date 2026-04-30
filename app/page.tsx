'use client'

import Link from 'next/link'
import { DEMO_LEADS } from '@/data/demo'
import { Lead, LeadStage } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'

const COLUMNS: { stage: LeadStage; label: string; color: string }[] = [
  { stage: 'contacted',      label: 'Contacte',      color: '#525252' },
  { stage: 'follow_up_1',    label: 'Relance 1',     color: '#3b82f6' },
  { stage: 'follow_up_2',    label: 'Relance 2',     color: '#8b5cf6' },
  { stage: 'replied',        label: 'Reponse',       color: '#f59e0b' },
  { stage: 'rdv_booked',     label: 'RDV confirme',  color: '#22c55e' },
  { stage: 'not_interested', label: 'Non interesse', color: '#ef4444' },
]

const STEP_LABEL: Record<string, string> = {
  initial:    'Email initial',
  follow_up_1:'Relance J+2',
  follow_up_2:'Relance J+5',
  follow_up_3:'Relance J+10',
  reply:      'Reponse IA',
}

export default function PipelinePage() {
  const byStage = (stage: LeadStage) => DEMO_LEADS.filter(l => l.stage === stage)

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Pipeline</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            {DEMO_LEADS.length} leads
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
          Agent actif — derniere action il y a 4 min
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full" style={{ minWidth: 'max-content' }}>
          {COLUMNS.map((col, ci) => {
            const leads = byStage(col.stage)
            return (
              <div
                key={col.stage}
                className="flex flex-col w-60 flex-shrink-0 h-full"
                style={{ borderRight: '1px solid var(--color-border)' }}
              >
                <div
                  className="px-4 py-2.5 flex items-center gap-2 flex-shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{col.label}</span>
                  <span className="ml-auto text-[11px]" style={{ color: 'var(--color-muted)' }}>{leads.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                  {leads.map(lead => (
                    <LeadCard key={lead.id} lead={lead} accentColor={col.color} />
                  ))}
                  {leads.length === 0 && (
                    <p className="text-[11px] text-center pt-8" style={{ color: 'var(--color-muted-2)' }}>—</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LeadCard({ lead, accentColor }: { lead: Lead; accentColor: string }) {
  const lastMsg = lead.thread[lead.thread.length - 1]

  return (
    <Link href={`/leads/${lead.id}`}>
      <div
        className="rounded-lg p-3 cursor-pointer"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-border-2)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
      >
        <p className="text-[12px] font-medium mb-0.5 leading-tight" style={{ color: 'var(--color-text)' }}>
          {lead.company}
        </p>
        <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
          {lead.city} · {lead.specialty[0]}
        </p>

        {lastMsg && (
          <p className="text-[11px] mb-2 line-clamp-2 leading-snug" style={{ color: 'var(--color-muted-2)' }}>
            {lastMsg.author === 'agent' ? 'Agent : ' : `${lead.firstName} : `}
            {lastMsg.body.split('\n').find(l => l.trim()) ?? ''}
          </p>
        )}

        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
            {formatDistanceToNow(new Date(lead.lastActivityAt))}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
            {lead.thread.length} msg
          </span>
        </div>

        {lead.rdvDate && lead.stage === 'rdv_booked' && (
          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[10px]" style={{ color: '#22c55e' }}>
              RDV {new Date(lead.rdvDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} a 14h
            </p>
          </div>
        )}
        {lead.nextScheduledAt && lead.stage !== 'rdv_booked' && (
          <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[10px]" style={{ color: accentColor }}>
              Prochaine : {new Date(lead.nextScheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}
