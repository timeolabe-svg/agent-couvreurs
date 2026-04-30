'use client'

import { use } from 'react'
import { notFound } from 'next/navigation'
import { DEMO_LEADS } from '@/data/demo'
import { EmailMessage, LeadStage } from '@/types'
import { formatTime, formatDate } from '@/lib/utils'
import { ArrowLeft, Globe, Phone, Mail, Star, Cpu, Calendar, ExternalLink } from 'lucide-react'
import Link from 'next/link'

const STAGE_LABEL: Record<LeadStage, string> = {
  prospected: 'Prospecté',
  contacted: 'Contacté',
  follow_up_1: 'Relance 1',
  follow_up_2: 'Relance 2',
  replied: 'Réponse reçue',
  rdv_booked: 'RDV confirmé',
  not_interested: 'Non intéressé',
}

const STAGE_COLOR: Record<LeadStage, string> = {
  prospected: '#737373',
  contacted: '#737373',
  follow_up_1: '#3b82f6',
  follow_up_2: '#8b5cf6',
  replied: '#f59e0b',
  rdv_booked: '#22c55e',
  not_interested: '#ef4444',
}

const STEP_LABEL: Record<string, string> = {
  initial: 'Email initial',
  follow_up_1: 'Relance J+2',
  follow_up_2: 'Relance J+5',
  follow_up_3: 'Relance J+10',
  reply: 'Réponse agent',
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const lead = DEMO_LEADS.find(l => l.id === id)
  if (!lead) notFound()

  const stageColor = STAGE_COLOR[lead.stage]

  return (
    <div className="flex h-full">
      {/* Thread */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div
          className="px-6 h-14 flex items-center gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <Link
            href="/leads"
            className="flex items-center gap-1.5 text-[12px] transition-colors"
            style={{ color: 'var(--color-muted)' }}
          >
            <ArrowLeft size={13} />
            Leads
          </Link>
          <span style={{ color: 'var(--color-border)' }}>/</span>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{lead.company}</span>
          <span
            className="text-[11px] px-2 py-0.5 rounded ml-1"
            style={{ background: `${stageColor}15`, color: stageColor }}
          >
            {STAGE_LABEL[lead.stage]}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {lead.thread.map((msg, i) => (
            <MessageBubble key={msg.id} msg={msg} firstName={lead.firstName} isLast={i === lead.thread.length - 1} />
          ))}

          {lead.rdvDate && (
            <div
              className="rounded-lg p-4 flex items-start gap-3"
              style={{ background: '#22c55e08', border: '1px solid #22c55e30' }}
            >
              <Calendar size={15} style={{ color: '#22c55e', marginTop: 1, flexShrink: 0 }} />
              <div>
                <p className="text-[12px] font-medium mb-0.5" style={{ color: '#22c55e' }}>
                  RDV detecte et confirme automatiquement
                </p>
                <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                  {new Date(lead.rdvDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} a 14h00
                  · Client notifie par email
                </p>
              </div>
            </div>
          )}

          {lead.nextScheduledAt && lead.stage !== 'rdv_booked' && (
            <div
              className="rounded-lg p-3 flex items-center gap-3"
              style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
            >
              <Cpu size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                Prochaine action prevue :{' '}
                <span style={{ color: 'var(--color-text)' }}>
                  {new Date(lead.nextScheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} a {formatTime(lead.nextScheduledAt)}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Info panel */}
      <div
        className="w-72 flex-shrink-0 overflow-y-auto"
        style={{ borderLeft: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="p-4">
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>INFORMATIONS</p>

          <div className="flex flex-col gap-3">
            <InfoRow icon={<Mail size={12} />} label="Email" value={lead.email} />
            {lead.phone && <InfoRow icon={<Phone size={12} />} label="Telephone" value={lead.phone} />}
            {lead.website && <InfoRow icon={<Globe size={12} />} label="Site web" value={lead.website} />}
            {lead.googleRating && (
              <InfoRow
                icon={<Star size={12} />}
                label="Google"
                value={`${lead.googleRating}/5 · ${lead.googleReviews} avis`}
              />
            )}
          </div>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>SPECIALITES</p>
            <div className="flex flex-wrap gap-1">
              {lead.specialty.map(s => (
                <span
                  key={s}
                  className="text-[11px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>CONTEXTE</p>
            <div className="flex flex-col gap-1.5">
              <ContextRow label="Site web" value={lead.hasWebsite ? 'Oui' : 'Non'} />
              <ContextRow label="Google Ads" value={lead.hasGoogleAds ? 'Actif' : 'Non'} />
              {lead.googleRating && <ContextRow label="Note Google" value={`${lead.googleRating}/5`} />}
            </div>
          </div>

          {lead.stage === 'rdv_booked' && lead.rdvDate && (
            <div
              className="mt-4 pt-4"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <p className="text-[11px] font-medium mb-2" style={{ color: '#22c55e' }}>RDV CONFIRME</p>
              <div
                className="rounded-lg p-3"
                style={{ background: '#22c55e08', border: '1px solid #22c55e30' }}
              >
                <p className="text-[12px] font-medium" style={{ color: '#22c55e' }}>
                  {new Date(lead.rdvDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>14h00 · 20 min</p>
                {lead.phone && (
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>{lead.phone}</p>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>SEQUENCE</p>
            <div className="flex flex-col gap-1">
              {lead.thread.filter(m => m.author === 'agent').map((m, i) => (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--color-accent)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {m.sequenceStep ? STEP_LABEL[m.sequenceStep] : `Message ${i + 1}`}
                  </span>
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                    {new Date(m.sentAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg, firstName, isLast }: { msg: EmailMessage; firstName: string; isLast: boolean }) {
  const isAgent = msg.author === 'agent'
  return (
    <div className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {isAgent && (
          <>
            <div
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
            >
              <Cpu size={10} style={{ color: 'var(--color-accent)' }} />
            </div>
            <span className="text-[11px] font-medium" style={{ color: 'var(--color-muted)' }}>Agent IA</span>
            {msg.isAiGenerated && msg.sequenceStep && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: '#3b82f615', color: '#3b82f6', border: '1px solid #3b82f630' }}
              >
                {STEP_LABEL[msg.sequenceStep] || msg.sequenceStep}
              </span>
            )}
          </>
        )}
        {!isAgent && (
          <>
            <span className="text-[11px] font-medium" style={{ color: 'var(--color-muted)' }}>{firstName}</span>
          </>
        )}
        <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
          {new Date(msg.sentAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} {formatTime(msg.sentAt)}
        </span>
        {msg.openedAt && isAgent && (
          <span className="text-[10px]" style={{ color: '#22c55e' }}>Lu</span>
        )}
      </div>

      <div
        className="rounded-lg px-4 py-3 max-w-xl"
        style={{
          background: isAgent ? 'var(--color-surface)' : 'var(--color-surface-2)',
          border: `1px solid ${isAgent ? 'var(--color-border)' : 'var(--color-border-2)'}`,
          borderLeft: isAgent ? `2px solid var(--color-accent)` : `1px solid var(--color-border-2)`,
        }}
      >
        {msg.subject && (
          <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
            {msg.subject}
          </p>
        )}
        <pre
          className="text-[13px] leading-relaxed whitespace-pre-wrap font-sans"
          style={{ color: 'var(--color-text)' }}
        >
          {msg.body}
        </pre>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span style={{ color: 'var(--color-muted)' }} className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{label}</p>
        <p className="text-[12px] break-all" style={{ color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  )
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  )
}
