'use client'

import { useEffect, useState, useCallback } from 'react'
import { Calendar, Phone, CheckCircle, Mail, Plus, X } from 'lucide-react'
import Link from 'next/link'

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8)
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven']

interface RdvContact {
  id: string
  name: string | null
  company: string
  city: string | null
  phone: string | null
  email: string
}

interface RdvItem {
  id: string
  contact_id: string | null
  scheduled_at: string
  duration_min: number | null
  status: string | null
  google_event_id: string | null
  google_meet_link: string | null
  notes: string | null
  created_at: string | null
  contact: RdvContact | null
  // demo fields
  leadId?: string
  company?: string
  contact_name?: string
  phone?: string
  detectedFrom?: string
}

function getCurrentWeekDays() {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMon)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function getRdvCompany(r: RdvItem) {
  return r.contact?.company ?? r.company ?? 'Inconnu'
}

function getRdvPhone(r: RdvItem) {
  return r.contact?.phone ?? r.phone ?? null
}

export default function AgendaPage() {
  const [rdvs, setRdvs] = useState<RdvItem[]>([])
  const [loading, setLoading] = useState(true)
  const [weekDays, setWeekDays] = useState<Date[]>([])
  const [showNewRdv, setShowNewRdv] = useState(false)
  const [form, setForm] = useState({ contactId: '', scheduledAt: '', durationMin: '30', notes: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    setWeekDays(getCurrentWeekDays())
  }, [])

  const loadRdvs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/rdv')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as { rdvs: RdvItem[] }
      setRdvs(json.rdvs ?? [])
    } catch (err) {
      console.error('[agenda] load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRdvs()
  }, [loadRdvs])

  const handleCreate = async () => {
    if (!form.contactId || !form.scheduledAt) {
      setCreateError('Contact ID et date/heure requis')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/rdv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: form.contactId,
          scheduledAt: form.scheduledAt,
          durationMin: parseInt(form.durationMin, 10) || 30,
          notes: form.notes || undefined,
          meetLink: true,
        }),
      })
      if (!res.ok) {
        const err = await res.json() as { error: string }
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      setShowNewRdv(false)
      setForm({ contactId: '', scheduledAt: '', durationMin: '30', notes: '' })
      await loadRdvs()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setCreating(false)
    }
  }

  const thisWeekRdvs = rdvs.filter((r) => {
    const d = new Date(r.scheduled_at)
    return weekDays.length > 0 && d >= weekDays[0] && d <= new Date(weekDays[4].getTime() + 86400000)
  })

  const weekLabel = weekDays.length > 0
    ? `Semaine du ${weekDays[0].getDate()} ${weekDays[0].toLocaleDateString('fr-FR', { month: 'long' })} — ${weekDays[4].getDate()} ${weekDays[4].toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
    : ''

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Agenda</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}
          >
            {loading ? '…' : rdvs.length} RDV ce mois
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{weekLabel}</p>
          <button
            onClick={() => setShowNewRdv(true)}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md font-medium"
            style={{ background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}
          >
            <Plus size={12} />
            Nouveau RDV
          </button>
        </div>
      </div>

      {/* New RDV modal */}
      {showNewRdv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewRdv(false) }}
        >
          <div
            className="rounded-xl w-full max-w-md p-6"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>Nouveau RDV</h2>
              <button onClick={() => setShowNewRdv(false)}><X size={16} style={{ color: 'var(--color-muted)' }} /></button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Contact ID *</label>
                <input
                  value={form.contactId}
                  onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
                  placeholder="UUID du contact"
                  className="w-full text-[12px] px-3 py-2 rounded-md"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Date et heure *</label>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full text-[12px] px-3 py-2 rounded-md"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Durée (min)</label>
                <input
                  type="number"
                  value={form.durationMin}
                  onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
                  min="15"
                  step="15"
                  className="w-full text-[12px] px-3 py-2 rounded-md"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full text-[12px] px-3 py-2 rounded-md resize-none"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }}
                />
              </div>
              {createError && (
                <p className="text-[12px]" style={{ color: '#ef4444' }}>{createError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void handleCreate()}
                  disabled={creating}
                  className="flex-1 py-2 rounded-md text-[13px] font-semibold"
                  style={{ background: '#22c55e', color: '#fff', opacity: creating ? 0.6 : 1 }}
                >
                  {creating ? 'Création…' : 'Créer le RDV'}
                </button>
                <button
                  onClick={() => setShowNewRdv(false)}
                  className="px-4 py-2 rounded-md text-[13px]"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex flex-col flex-1">
          {/* Day headers */}
          <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="w-14 flex-shrink-0" />
            {weekDays.map((d, i) => {
              const hasRdv = thisWeekRdvs.some((r) => isSameDay(new Date(r.scheduled_at), d))
              return (
                <div
                  key={i}
                  className="flex-1 px-3 py-2 text-center"
                  style={{ borderLeft: '1px solid var(--color-border)' }}
                >
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{DAYS[i]}</p>
                  <p className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
                    {d.getDate()}
                  </p>
                  {hasRdv && (
                    <div className="w-1.5 h-1.5 rounded-full mx-auto mt-0.5" style={{ background: '#22c55e' }} />
                  )}
                </div>
              )
            })}
          </div>

          {/* Time slots */}
          <div className="flex flex-1 overflow-auto">
            <div className="w-14 flex-shrink-0">
              {HOURS.map(h => (
                <div
                  key={h}
                  className="h-14 flex items-start justify-end pr-2 pt-1"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{h}h</span>
                </div>
              ))}
            </div>

            {weekDays.map((d, di) => {
              const dayRdvs = thisWeekRdvs.filter((r) => isSameDay(new Date(r.scheduled_at), d))
              return (
                <div
                  key={di}
                  className="flex-1 relative"
                  style={{ borderLeft: '1px solid var(--color-border)' }}
                >
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="h-14"
                      style={{ borderBottom: '1px solid var(--color-border)' }}
                    />
                  ))}

                  {dayRdvs.map(r => {
                    const dt = new Date(r.scheduled_at)
                    const hh = dt.getHours()
                    const mm = dt.getMinutes()
                    const topOffset = ((hh - 8) * 56) + (mm / 60 * 56)
                    const dur = r.duration_min ?? 30
                    const heightPx = (dur / 60) * 56
                    const company = getRdvCompany(r)
                    const timeStr = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    const contactName = r.contact?.name ?? r.contact_name ?? ''

                    return (
                      <Link key={r.id} href={r.leadId ? `/leads/${r.leadId}` : '#'}>
                        <div
                          className="absolute left-1 right-1 rounded-md px-2 py-1.5 cursor-pointer"
                          style={{
                            top: topOffset,
                            height: Math.max(heightPx, 44),
                            background: '#22c55e15',
                            border: '1px solid #22c55e40',
                          }}
                        >
                          <p className="text-[11px] font-medium leading-tight" style={{ color: '#22c55e' }}>
                            {company}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                            {timeStr}{contactName ? ` · ${contactName}` : ''}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* RDV cards */}
      <div
        className="flex-shrink-0 p-4"
        style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
      >
        <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>
          RDV CETTE SEMAINE — {thisWeekRdvs.length} confirmés
        </p>
        {loading && (
          <div className="flex items-center gap-2 py-2">
            <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: '#22c55e' }} />
            <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Chargement…</span>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {thisWeekRdvs.map(r => {
            const rdvDate = new Date(r.scheduled_at)
            const phone = getRdvPhone(r)
            const company = getRdvCompany(r)
            const contactName = r.contact?.name ?? r.contact_name ?? ''
            const timeStr = rdvDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            return (
              <div
                key={r.id}
                className="rounded-lg p-3 flex items-start gap-3"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: '#22c55e15', border: '1px solid #22c55e30' }}
                >
                  <Calendar size={13} style={{ color: '#22c55e' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                      {company}
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: '#22c55e15', color: '#22c55e' }}>
                      <CheckCircle size={9} />
                      Confirmé
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {rdvDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {timeStr} · {r.duration_min ?? 30} min
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {phone && (
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-muted)' }}>
                        <Phone size={10} />
                        {phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: '#22c55e' }}>
                      <Mail size={10} />
                      Client notifié
                    </span>
                    {r.google_meet_link && (
                      <a
                        href={r.google_meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px]"
                        style={{ color: '#3b82f6' }}
                      >
                        Meet →
                      </a>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {contactName && (
                    <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{contactName}</p>
                  )}
                  {r.notes && (
                    <p className="text-[10px] italic max-w-40 text-right mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                      &ldquo;{r.notes.substring(0, 60)}{r.notes.length > 60 ? '…' : ''}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            )
          })}
          {!loading && thisWeekRdvs.length === 0 && (
            <p className="text-[12px] py-2" style={{ color: 'var(--color-muted)' }}>Aucun RDV cette semaine.</p>
          )}
        </div>
      </div>
    </div>
  )
}
