'use client'

import { useEffect, useState } from 'react'
import { Phone, Globe, MapPin, RefreshCw, Cpu, Mail, Inbox } from 'lucide-react'

interface ConvMessage {
  role: 'sent' | 'received' | 'agent'
  subject?: string
  body: string
  date: string
  status?: string
  classification?: string
}
interface Conversation {
  key: string
  contactId: string | null
  company: string
  email: string
  city: string
  phone: string | null
  website: string | null
  classification: string | null
  messages: ConvMessage[]
  lastDate: string
}

const CLASS_LABEL: Record<string, { label: string; color: string }> = {
  interest: { label: 'Intéressé', color: '#22c55e' },
  rdv_request: { label: 'RDV', color: '#22c55e' },
  question: { label: 'Question', color: '#3b82f6' },
  objection: { label: 'Objection', color: '#f59e0b' },
  desinterest: { label: 'Pas intéressé', color: '#ef4444' },
  oof: { label: 'Auto/Absence', color: '#6b7280' },
  spam: { label: 'Spam', color: '#6b7280' },
  other: { label: 'Autre', color: '#8b5cf6' },
}

function fmt(d: string): string {
  if (!d) return ''
  const date = new Date(d)
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ConversationsPage() {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/conversations')
      const json = await res.json() as { conversations: Conversation[] }
      setConvs(json.conversations ?? [])
      if (!selected && json.conversations?.length) setSelected(json.conversations[0].key)
    } catch { /* ignore */ }
    setLoading(false)
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const current = convs.find(c => c.key === selected) ?? null

  return (
    <div className="flex h-full" style={{ color: 'var(--color-text)' }}>
      {/* Liste des conversations */}
      <div className="w-80 flex-shrink-0 flex flex-col h-full" style={{ borderRight: '1px solid var(--color-border)' }}>
        <div className="h-14 px-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Inbox size={16} />
            <span className="font-semibold text-sm">Messagerie</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
              {convs.length}
            </span>
          </div>
          <button onClick={() => void load()} className="p-1.5 rounded hover:bg-white/5" title="Rafraîchir">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convs.length === 0 && !loading && (
            <p className="text-[13px] p-4" style={{ color: 'var(--color-muted)' }}>Aucune conversation pour le moment.</p>
          )}
          {convs.map(c => {
            const cls = c.classification ? CLASS_LABEL[c.classification] : null
            const last = c.messages[c.messages.length - 1]
            const active = c.key === selected
            return (
              <button
                key={c.key}
                onClick={() => setSelected(c.key)}
                className="w-full text-left px-4 py-3 flex flex-col gap-1"
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: active ? 'var(--color-surface-2)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium truncate">{c.company}</span>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-muted-2)' }}>{fmt(c.lastDate)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {cls && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: cls.color + '22', color: cls.color }}>
                      {cls.label}
                    </span>
                  )}
                  <span className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>
                    {last?.role === 'agent' ? '↩ ' : last?.role === 'received' ? '← ' : '→ '}
                    {last?.body?.slice(0, 50)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Fil de la conversation */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {!current ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
            <p className="text-sm">Sélectionne une conversation</p>
          </div>
        ) : (
          <>
            <div className="h-auto px-6 py-3 flex flex-col gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="font-semibold text-[15px]">{current.company}</span>
              <div className="flex items-center gap-4 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                <span className="flex items-center gap-1"><Mail size={12} />{current.email}</span>
                {current.city && <span className="flex items-center gap-1"><MapPin size={12} />{current.city}</span>}
                {current.phone && (
                  <a href={`tel:${current.phone}`} className="flex items-center gap-1 font-medium" style={{ color: '#22c55e' }}>
                    <Phone size={12} />{current.phone}
                  </a>
                )}
                {current.website && (
                  <a href={current.website.startsWith('http') ? current.website : `https://${current.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                    <Globe size={12} />site
                  </a>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
              {current.messages.map((m, i) => {
                const isOut = m.role === 'sent' || m.role === 'agent'
                return (
                  <div key={i} className="flex flex-col" style={{ alignItems: isOut ? 'flex-end' : 'flex-start' }}>
                    <div className="flex items-center gap-2 mb-1">
                      {m.role === 'agent' && <Cpu size={11} style={{ color: 'var(--color-accent)' }} />}
                      <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                        {m.role === 'sent' ? 'Email envoyé' : m.role === 'agent' ? `Réponse agent${m.status ? ' · ' + m.status : ''}` : 'Reçu'} · {fmt(m.date)}
                      </span>
                    </div>
                    <div
                      className="max-w-[80%] rounded-lg px-3 py-2 text-[13px] whitespace-pre-wrap leading-relaxed"
                      style={{
                        background: m.role === 'received' ? 'var(--color-surface-2)' : m.role === 'agent' ? 'var(--color-accent)' + '18' : 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderLeft: m.role === 'agent' ? '2px solid var(--color-accent)' : undefined,
                      }}
                    >
                      {m.subject && <div className="font-semibold mb-1 text-[12px]" style={{ color: 'var(--color-muted)' }}>{m.subject}</div>}
                      {m.body}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
