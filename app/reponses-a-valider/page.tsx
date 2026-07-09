'use client'

import { useEffect, useState, useCallback } from 'react'
import { MessageSquare, RefreshCw, CheckCircle, X, Edit2, Building2, MapPin } from 'lucide-react'
import Link from 'next/link'

interface DraftItem {
  id: string
  body: string
  status: string
  created_at: string | null
  incomingReply: {
    id: string
    from_email: string
    subject: string | null
    body: string
    classification: string | null
    instantly_reply_id: string | null
  } | null
  contact: {
    id: string
    name: string | null
    company: string
    city: string | null
    email: string
    phone: string | null
  } | null
}

const CLASSIFICATION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  objection:   { bg: '#f9731610', color: '#f97316', label: 'Objection' },
  question:    { bg: '#eab30810', color: '#eab308', label: 'Question' },
  interest:    { bg: '#3b82f610', color: '#3b82f6', label: 'Intérêt' },
  rdv_request: { bg: '#10b98115', color: '#10b981', label: 'Demande RDV' },
  desinterest: { bg: '#6b728010', color: '#6b7280', label: 'Désintérêt' },
  other:       { bg: '#8b5cf610', color: '#8b5cf6', label: 'Autre' },
}

export default function ReponsesAValiderPage() {
  const [items, setItems] = useState<DraftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState<Record<string, string>>({})
  const [fading, setFading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reply-drafts')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { drafts: DraftItem[] }
      setItems(json.drafts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (draftId: string, payload: { body?: string; action: 'send' | 'reject' | 'update' }) => {
    const res = await fetch(`/api/reply-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const json = await res.json() as { error?: string }
      throw new Error(json.error ?? `HTTP ${res.status}`)
    }
  }

  const fadeOut = (draftId: string, then: () => Promise<void>) => {
    setFading((prev) => new Set(prev).add(draftId))
    setTimeout(async () => {
      try {
        await then()
      } catch (err) {
        console.error('[reponses-a-valider]', err)
      }
      setItems((prev) => prev.filter((item) => item.id !== draftId))
      setFading((prev) => {
        const next = new Set(prev)
        next.delete(draftId)
        return next
      })
    }, 300)
  }

  const handleSend = (draftId: string, currentBody: string) => {
    fadeOut(draftId, async () => {
      const body = editBody[draftId] ?? currentBody
      await patch(draftId, { body, action: 'send' })
    })
  }

  const handleReject = (draftId: string) => {
    fadeOut(draftId, async () => {
      await patch(draftId, { action: 'reject' })
    })
  }

  const handleEdit = (draftId: string, currentBody: string) => {
    if (editingId === draftId) {
      setEditingId(null)
    } else {
      setEditingId(draftId)
      setEditBody((prev) => ({ ...prev, [draftId]: prev[draftId] ?? currentBody }))
    }
  }

  const pending = items.length

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <MessageSquare size={14} style={{ color: 'var(--color-muted)' }} />
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Réponses à valider
          </h1>
          {pending > 0 && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444430' }}
            >
              {pending} en attente
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md transition-colors"
          style={{
            color: 'var(--color-muted)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Rafraîchir
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {error && (
          <div
            className="rounded-lg p-4 mb-4 text-[13px]"
            style={{ background: '#ef444410', border: '1px solid #ef444430', color: '#ef4444' }}
          >
            Erreur : {error}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-3"
            style={{ color: 'var(--color-muted)' }}
          >
            <CheckCircle size={32} style={{ color: '#10b981', opacity: 0.6 }} />
            <p className="text-[14px] font-medium" style={{ color: 'var(--color-text)' }}>
              Aucune réponse en attente ✓
            </p>
            <p className="text-[12px]">Tout est validé, rien à traiter pour l&apos;instant.</p>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-border)', borderTopColor: '#10b981' }}
            />
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-3xl">
          {items.map((item) => {
            const isFading = fading.has(item.id)
            const isEditing = editingId === item.id
            const cls = item.incomingReply?.classification ?? 'other'
            const clsStyle = CLASSIFICATION_STYLES[cls] ?? CLASSIFICATION_STYLES.other

            return (
              <div
                key={item.id}
                className="rounded-xl overflow-hidden transition-all duration-300"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  opacity: isFading ? 0 : 1,
                  transform: isFading ? 'translateY(-8px)' : 'translateY(0)',
                }}
              >
                {/* Card header */}
                <div
                  className="px-4 py-3 flex items-center gap-3"
                  style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
                >
                  <div className="flex-1 flex items-center gap-3 min-w-0">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    >
                      <Building2 size={12} style={{ color: 'var(--color-muted)' }} />
                    </div>
                    <div className="min-w-0">
                      {item.contact ? (
                        <Link
                          href={`/leads/${item.contact.id}`}
                          className="text-[13px] font-semibold leading-tight truncate hover:underline block"
                          style={{ color: 'var(--color-text)' }}
                        >
                          {item.contact.company}
                        </Link>
                      ) : (
                        <p className="text-[13px] font-semibold leading-tight truncate" style={{ color: 'var(--color-text)' }}>
                          {item.incomingReply?.from_email ?? '—'}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.contact?.name && (
                          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                            {item.contact.name}
                          </span>
                        )}
                        {item.contact?.city && (
                          <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                            <MapPin size={9} />
                            {item.contact.city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={{ background: clsStyle.bg, color: clsStyle.color, border: `1px solid ${clsStyle.color}30` }}
                  >
                    {clsStyle.label}
                  </span>
                </div>

                {/* Message reçu */}
                <div className="px-4 pt-3 pb-2">
                  <p className="text-[10px] font-semibold mb-1.5 uppercase tracking-wide" style={{ color: 'var(--color-muted-2)' }}>
                    Message reçu
                  </p>
                  <div
                    className="rounded-lg p-3 text-[12px] leading-relaxed"
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    {item.incomingReply?.subject && (
                      <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                        {item.incomingReply.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">
                      {(item.incomingReply?.body ?? '').substring(0, 600)}
                      {(item.incomingReply?.body ?? '').length > 600 ? '…' : ''}
                    </p>
                  </div>
                </div>

                {/* Réponse générée */}
                <div className="px-4 pt-2 pb-3">
                  <p className="text-[10px] font-semibold mb-1.5 uppercase tracking-wide" style={{ color: 'var(--color-muted-2)' }}>
                    Réponse générée par l&apos;agent
                  </p>
                  {isEditing ? (
                    <textarea
                      value={editBody[item.id] ?? item.body}
                      onChange={(e) => setEditBody((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      rows={8}
                      className="w-full text-[12px] rounded-lg p-3 resize-y leading-relaxed"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid #3b82f660',
                        color: 'var(--color-text)',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div
                      className="rounded-lg p-3 text-[12px] leading-relaxed whitespace-pre-wrap"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid #10b98130',
                        color: 'var(--color-text)',
                      }}
                    >
                      {editBody[item.id] ?? item.body}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  className="px-4 py-3 flex items-center gap-2"
                  style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
                >
                  <button
                    onClick={() => handleSend(item.id, item.body)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
                    style={{ background: '#10b98120', color: '#10b981', border: '1px solid #10b98140' }}
                  >
                    <CheckCircle size={12} />
                    Envoyer
                  </button>
                  <button
                    onClick={() => handleEdit(item.id, item.body)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
                    style={{
                      background: isEditing ? '#3b82f620' : 'transparent',
                      color: '#3b82f6',
                      border: '1px solid #3b82f640',
                    }}
                  >
                    <Edit2 size={12} />
                    {isEditing ? 'Terminer' : 'Modifier'}
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ml-auto"
                    style={{ background: '#ef444410', color: '#ef4444', border: '1px solid #ef444430' }}
                  >
                    <X size={12} />
                    Rejeter
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
