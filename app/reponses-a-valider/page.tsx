'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, RefreshCw, CheckCircle, X, Edit2, Building2, MapPin } from 'lucide-react'

interface ReplyDraft {
  reply: {
    id: string
    from_email: string
    subject: string | null
    body: string
    classification: string | null
    created_at: string | null
  }
  draft: {
    id: string
    body: string
    status: string
    created_at: string | null
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
  objection:    { bg: '#f9731610', color: '#f97316', label: 'Objection' },
  question:     { bg: '#3b82f610', color: '#3b82f6', label: 'Question' },
  interest:     { bg: '#22c55e10', color: '#22c55e', label: 'Intérêt' },
  rdv_request:  { bg: '#22c55e15', color: '#22c55e', label: 'Demande RDV' },
  desinterest:  { bg: '#6b728010', color: '#6b7280', label: 'Désintérêt' },
  other:        { bg: '#8b5cf610', color: '#8b5cf6', label: 'Autre' },
}

export default function ReponsesAValiderPage() {
  const [items, setItems] = useState<ReplyDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState<Record<string, string>>({})
  const [fading, setFading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/replies?status=pending&limit=50')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { data: ReplyDraft[] }
      const valid = (json.data ?? []).filter((item) => item.draft !== null)
      setItems(valid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const fadeOut = (draftId: string, then: () => Promise<void>) => {
    setFading((prev) => new Set(prev).add(draftId))
    setTimeout(async () => {
      await then()
      setItems((prev) => prev.filter((item) => item.draft?.id !== draftId))
      setFading((prev) => {
        const next = new Set(prev)
        next.delete(draftId)
        return next
      })
    }, 300)
  }

  const handleSend = (draftId: string) => {
    fadeOut(draftId, async () => {
      const body = editBody[draftId]
      if (body) {
        await fetch(`/api/replies/${draftId}/draft`, { method: 'PATCH', body: JSON.stringify({ body }), headers: { 'Content-Type': 'application/json' } })
      }
      await fetch(`/api/replies/${draftId}/send`, { method: 'POST' })
    })
  }

  const handleReject = (draftId: string) => {
    fadeOut(draftId, async () => {
      await fetch(`/api/replies/${draftId}/reject`, { method: 'POST' })
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
          <Bell size={14} style={{ color: 'var(--color-muted)' }} />
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Réponses à valider
          </h1>
          {pending > 0 && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
              style={{ background: '#ef444420', color: '#ef4444', border: '1px solid #ef444430' }}
            >
              {pending}
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
          Tout rafraîchir
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
            <CheckCircle size={32} style={{ color: '#22c55e', opacity: 0.6 }} />
            <p className="text-[14px] font-medium" style={{ color: 'var(--color-text)' }}>
              Tout est validé !
            </p>
            <p className="text-[12px]">Aucune réponse en attente de validation.</p>
          </div>
        )}

        {loading && items.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--color-border)', borderTopColor: '#22c55e' }}
            />
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-3xl">
          {items.map((item) => {
            if (!item.draft) return null
            const draftId = item.draft.id
            const isFading = fading.has(draftId)
            const isEditing = editingId === draftId
            const cls = item.reply.classification ?? 'other'
            const clsStyle = CLASSIFICATION_STYLES[cls] ?? CLASSIFICATION_STYLES.other

            return (
              <div
                key={draftId}
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
                      <p className="text-[13px] font-semibold leading-tight truncate" style={{ color: 'var(--color-text)' }}>
                        {item.contact?.company ?? item.reply.from_email}
                      </p>
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
                    <p className="font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                      {item.reply.subject ?? '(sans objet)'}
                    </p>
                    <p className="whitespace-pre-wrap">{item.reply.body.substring(0, 600)}{item.reply.body.length > 600 ? '…' : ''}</p>
                  </div>
                </div>

                {/* Réponse générée */}
                <div className="px-4 pt-2 pb-3">
                  <p className="text-[10px] font-semibold mb-1.5 uppercase tracking-wide" style={{ color: 'var(--color-muted-2)' }}>
                    Réponse générée par l&apos;agent
                  </p>
                  {isEditing ? (
                    <textarea
                      value={editBody[draftId] ?? item.draft.body}
                      onChange={(e) => setEditBody((prev) => ({ ...prev, [draftId]: e.target.value }))}
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
                        border: '1px solid #22c55e30',
                        color: 'var(--color-text)',
                      }}
                    >
                      {editBody[draftId] ?? item.draft.body}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  className="px-4 py-3 flex items-center gap-2"
                  style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}
                >
                  <button
                    onClick={() => handleSend(draftId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
                    style={{ background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
                  >
                    <CheckCircle size={12} />
                    Envoyer
                  </button>
                  <button
                    onClick={() => handleEdit(draftId, item.draft!.body)}
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
                    onClick={() => handleReject(draftId)}
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
