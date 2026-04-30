'use client'

import Link from 'next/link'
import { DEMO_LEADS } from '@/data/demo'
import { LeadStage } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'

const STAGE_LABEL: Record<LeadStage, string> = {
  prospected: 'Prospecté',
  contacted: 'Contacté',
  follow_up_1: 'Relance 1',
  follow_up_2: 'Relance 2',
  replied: 'Réponse reçue',
  rdv_booked: 'RDV confirmé',
  not_interested: 'Non intéressé',
}

const STAGE_COLOR: Record<LeadStage, { bg: string; text: string }> = {
  prospected:    { bg: '#52525215', text: '#737373' },
  contacted:     { bg: '#52525215', text: '#737373' },
  follow_up_1:   { bg: '#3b82f615', text: '#3b82f6' },
  follow_up_2:   { bg: '#8b5cf615', text: '#8b5cf6' },
  replied:       { bg: '#f59e0b15', text: '#f59e0b' },
  rdv_booked:    { bg: '#22c55e15', text: '#22c55e' },
  not_interested:{ bg: '#ef444415', text: '#ef4444' },
}

export default function LeadsPage() {
  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
          Leads
          <span className="ml-2 font-normal" style={{ color: 'var(--color-muted)' }}>{DEMO_LEADS.length}</span>
        </h1>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Entreprise', 'Contact', 'Ville', 'Spécialité', 'Statut', 'Messages', 'Dernière activité', ''].map(h => (
                <th
                  key={h}
                  className="px-5 py-3 text-left text-[11px] font-medium"
                  style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEMO_LEADS.map(lead => {
              const stageStyle = STAGE_COLOR[lead.stage]
              return (
                <tr
                  key={lead.id}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                  className="group"
                >
                  <td className="px-5 py-3">
                    <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>{lead.company}</p>
                    {lead.website && (
                      <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>{lead.website}</p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{lead.contact}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>{lead.email}</p>
                  </td>
                  <td className="px-5 py-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>{lead.city}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {lead.specialty.slice(0, 2).map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded"
                      style={{ background: stageStyle.bg, color: stageStyle.text }}
                    >
                      {STAGE_LABEL[lead.stage]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                    {lead.thread.length}
                  </td>
                  <td className="px-5 py-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                    {formatDistanceToNow(new Date(lead.lastActivityAt))}
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-[11px] px-2.5 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                    >
                      Ouvrir
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
