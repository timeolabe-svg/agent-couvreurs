'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Calendar, Phone, CheckCircle, Mail, Plus, X } from 'lucide-react'
import Link from 'next/link'

const START_HOUR = 8
const END_HOUR = 19
const ROW_H = 52 // px par heure
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR)
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

interface RdvDetails {
  contact?: { company: string; name: string | null; city: string | null; phone: string | null; email: string; website: string | null; sector: string | null; googleRating: number | null; googleReviews: number | null; auditWeaknesses?: string[]; auditScore?: number | null; auditLevel?: string | null }
  conversation?: Array<{ role: 'nous' | 'prospect'; body: string; date: string }>
  summary?: string
  companyDescription?: string
  error?: string
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

  // Contact autocomplete state
  const [contactSearch, setContactSearch] = useState('')
  const [contactSuggestions, setContactSuggestions] = useState<Array<{ id: string; name: string | null; company: string; city: string | null }>>([])
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string | null; company: string } | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const contactInputRef = useRef<HTMLInputElement>(null)

  // Détails RDV enrichis (conversation + résumé IA + fiche entreprise)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsData, setDetailsData] = useState<RdvDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsCompany, setDetailsCompany] = useState('')
  const [detailsContactId, setDetailsContactId] = useState('')

  const openDetails = useCallback(async (contactId: string, company: string) => {
    setDetailsOpen(true); setDetailsData(null); setDetailsLoading(true); setDetailsCompany(company); setDetailsContactId(contactId)
    try {
      const res = await fetch(`/api/agenda/details?contactId=${encodeURIComponent(contactId)}`)
      setDetailsData(await res.json() as RdvDetails)
    } catch { /* ignore */ } finally {
      setDetailsLoading(false)
    }
  }, [])

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

  // Debounced contact search
  useEffect(() => {
    if (contactSearch.length < 2) {
      setContactSuggestions([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/leads?search=${encodeURIComponent(contactSearch)}&limit=8`)
        .then(r => r.json())
        .then((data: { leads?: Array<{ id: string; name: string | null; company: string; city: string | null }> }) => {
          setContactSuggestions(data.leads ?? [])
          setShowSuggestions(true)
        })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [contactSearch])

  const handleCreate = async () => {
    if (!form.contactId || !form.scheduledAt) {
      setCreateError('Contact et date/heure requis')
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
      setContactSearch('')
      setSelectedContact(null)
      setContactSuggestions([])
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
            style={{ background: '#5c9b8215', color: '#5c9b82', border: '1px solid #5c9b8230' }}
          >
            {loading ? '…' : rdvs.length} RDV ce mois
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{weekLabel}</p>
          <button
            onClick={() => setShowNewRdv(true)}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md font-medium"
            style={{ background: '#5c9b8220', color: '#5c9b82', border: '1px solid #5c9b8240' }}
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
          onClick={(e) => { if (e.target === e.currentTarget) { setShowNewRdv(false); setContactSearch(''); setSelectedContact(null); setContactSuggestions([]) } }}
        >
          <div
            className="rounded-xl w-full max-w-md p-6"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>Nouveau RDV</h2>
              <button onClick={() => { setShowNewRdv(false); setContactSearch(''); setSelectedContact(null); setContactSuggestions([]) }}><X size={16} style={{ color: 'var(--color-muted)' }} /></button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="relative">
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Contact *</label>
                <input
                  ref={contactInputRef}
                  value={selectedContact ? `${selectedContact.name ?? selectedContact.company} — ${selectedContact.company}` : contactSearch}
                  onChange={(e) => {
                    setSelectedContact(null)
                    setForm((f) => ({ ...f, contactId: '' }))
                    setContactSearch(e.target.value)
                    setShowSuggestions(true)
                  }}
                  onFocus={() => { if (contactSuggestions.length > 0) setShowSuggestions(true) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Rechercher par nom ou entreprise…"
                  className="w-full text-[12px] px-3 py-2 rounded-md"
                  style={{ background: 'var(--color-surface-2)', border: `1px solid ${form.contactId ? '#5c9b8260' : 'var(--color-border)'}`, color: 'var(--color-text)', outline: 'none' }}
                />
                {showSuggestions && contactSuggestions.length > 0 && (
                  <div
                    className="absolute left-0 right-0 z-50 rounded-md overflow-hidden"
                    style={{ top: '100%', marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                  >
                    {contactSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setSelectedContact(c)
                          setForm((f) => ({ ...f, contactId: c.id }))
                          setContactSearch('')
                          setShowSuggestions(false)
                        }}
                        className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-black/20"
                        style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}
                      >
                        <span className="font-medium">{c.company}</span>
                        {c.name && <span style={{ color: 'var(--color-muted)' }}> · {c.name}</span>}
                        {c.city && <span style={{ color: 'var(--color-muted-2)' }}> — {c.city}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {contactSearch.length >= 2 && contactSuggestions.length === 0 && (
                  <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>Aucun contact trouvé</p>
                )}
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
                  style={{ background: '#5c9b82', color: '#fff', opacity: creating ? 0.6 : 1 }}
                >
                  {creating ? 'Création…' : 'Créer le RDV'}
                </button>
                <button
                  onClick={() => { setShowNewRdv(false); setContactSearch(''); setSelectedContact(null); setContactSuggestions([]) }}
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

      <div className="flex-1 overflow-auto p-4">
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
        >
          {/* Day headers */}
          <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="w-12 flex-shrink-0" />
            {weekDays.map((d, i) => {
              const hasRdv = thisWeekRdvs.some((r) => isSameDay(new Date(r.scheduled_at), d))
              const today = isSameDay(d, new Date())
              return (
                <div
                  key={i}
                  className="flex-1 px-2 py-2.5 text-center"
                  style={{ borderLeft: '1px solid var(--color-border)', background: today ? 'rgba(125,111,176,0.07)' : 'transparent' }}
                >
                  <p className="text-[10px] uppercase tracking-wide" style={{ color: today ? '#a99cc9' : 'var(--color-muted)' }}>{DAYS[i]}</p>
                  <div className="flex items-center justify-center gap-1.5 mt-0.5">
                    <span
                      className="text-[13px] font-semibold inline-flex items-center justify-center"
                      style={ today
                        ? { color: '#fff', background: '#7d6fb0', width: 22, height: 22, borderRadius: '50%' }
                        : { color: 'var(--color-text)' } }
                    >
                      {d.getDate()}
                    </span>
                    {hasRdv && !today && (
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#5c9b82' }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time slots */}
          <div className="flex">
            <div className="w-12 flex-shrink-0">
              {HOURS.map(h => (
                <div
                  key={h}
                  className="flex items-start justify-end pr-2"
                  style={{ height: ROW_H, transform: 'translateY(-6px)' }}
                >
                  <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{h}h</span>
                </div>
              ))}
            </div>

            {weekDays.map((d, di) => {
              const dayRdvs = thisWeekRdvs.filter((r) => isSameDay(new Date(r.scheduled_at), d))
              const today = isSameDay(d, new Date())
              const now = new Date()
              const nowOffset = today && now.getHours() >= START_HOUR && now.getHours() < END_HOUR
                ? ((now.getHours() - START_HOUR) * ROW_H) + (now.getMinutes() / 60 * ROW_H)
                : null
              return (
                <div
                  key={di}
                  className="flex-1 relative"
                  style={{ borderLeft: '1px solid var(--color-border)', background: today ? 'rgba(125,111,176,0.04)' : 'transparent' }}
                >
                  {HOURS.map(h => (
                    <div
                      key={h}
                      style={{ height: ROW_H, borderBottom: '1px solid var(--color-border)' }}
                    />
                  ))}

                  {/* Ligne "maintenant" */}
                  {nowOffset != null && (
                    <div className="absolute left-0 right-0 flex items-center" style={{ top: nowOffset }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#c07575', marginLeft: -3 }} />
                      <div className="flex-1 h-px" style={{ background: '#c07575' }} />
                    </div>
                  )}

                  {dayRdvs.map(r => {
                    const dt = new Date(r.scheduled_at)
                    const hh = dt.getHours()
                    const mm = dt.getMinutes()
                    const topOffset = ((hh - START_HOUR) * ROW_H) + (mm / 60 * ROW_H)
                    const dur = r.duration_min ?? 30
                    const heightPx = (dur / 60) * ROW_H
                    const company = getRdvCompany(r)
                    const timeStr = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                    const contactName = r.contact?.name ?? r.contact_name ?? ''

                    return (
                      <Link key={r.id} href={r.contact_id ? `/leads/${r.contact_id}` : r.leadId ? `/leads/${r.leadId}` : '#'}>
                        <div
                          className="absolute rounded-md px-2 py-1 cursor-pointer overflow-hidden transition-colors"
                          style={{
                            top: topOffset + 1,
                            left: 3,
                            right: 3,
                            minHeight: Math.max(heightPx, 40),
                            background: 'rgba(92,155,130,0.14)',
                            borderLeft: '3px solid #5c9b82',
                          }}
                        >
                          <p className="text-[11px] font-semibold leading-tight truncate" style={{ color: 'var(--color-text)' }}>
                            {company}
                          </p>
                          <p className="text-[10px] leading-tight truncate" style={{ color: '#5c9b82' }}>
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
            <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: '#5c9b82' }} />
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
                  style={{ background: '#5c9b8215', border: '1px solid #5c9b8230' }}
                >
                  <Calendar size={13} style={{ color: '#5c9b82' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                      {company}
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
                      style={{ background: '#5c9b8215', color: '#5c9b82' }}>
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
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: '#5c9b82' }}>
                      <Mail size={10} />
                      Client notifié
                    </span>
                    {r.google_meet_link && (
                      <a
                        href={r.google_meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px]"
                        style={{ color: '#5f83ac' }}
                      >
                        Meet →
                      </a>
                    )}
                    {r.contact_id && (
                      <button
                        onClick={() => void openDetails(r.contact_id!, company)}
                        className="flex items-center gap-1 text-[10px] font-medium"
                        style={{ color: '#8f7bb5' }}
                      >
                        Conversation + fiche →
                      </button>
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

      {/* Détails RDV enrichis : fiche entreprise + résumé IA + conversation */}
      {detailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setDetailsOpen(false) }}
        >
          <div className="rounded-xl w-full max-w-2xl max-h-[85vh] overflow-auto p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>{detailsCompany}</h2>
              <div className="flex items-center gap-3">
                <Link href={`/conversations?contact=${detailsContactId}`} className="text-[11px]" style={{ color: '#5f83ac' }}>Ouvrir la conversation →</Link>
                <button onClick={() => setDetailsOpen(false)}><X size={16} style={{ color: 'var(--color-muted)' }} /></button>
              </div>
            </div>

            {detailsLoading && (
              <div className="flex items-center gap-2 py-4">
                <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: '#8f7bb5' }} />
                <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Chargement (résumé IA en cours)…</span>
              </div>
            )}

            {!detailsLoading && detailsData && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: '#8f7bb5' }}>QUI EST CETTE ENTREPRISE</p>
                  <p className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{detailsData.companyDescription || '—'}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {detailsData.contact?.phone && <span>📞 {detailsData.contact.phone}</span>}
                    {detailsData.contact?.city && <span>📍 {detailsData.contact.city}</span>}
                    {detailsData.contact?.website && <a href={detailsData.contact.website} target="_blank" rel="noopener noreferrer" style={{ color: '#5f83ac' }}>🌐 site</a>}
                    {detailsData.contact?.googleRating != null && <span>⭐ {detailsData.contact.googleRating} ({detailsData.contact.googleReviews ?? 0} avis)</span>}
                  </div>
                </div>

                {(detailsData.contact?.auditWeaknesses?.length ?? 0) > 0 && (
                  <div className="rounded-lg p-3" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div className="flex items-center flex-wrap gap-2 mb-2">
                      <p className="text-[11px] font-semibold" style={{ color: '#c19653' }}>AUDIT DU SITE — LEVIERS À VENDRE</p>
                      {typeof detailsData.contact?.auditScore === 'number' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(245,158,11,0.15)', color: '#c19653' }}>
                          {detailsData.contact.auditScore}/100
                        </span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {detailsData.contact!.auditWeaknesses!.slice(0, 10).map((w, i) => (
                        <li key={i} className="flex gap-2 text-[12px]" style={{ color: 'var(--color-text)' }}>
                          <span style={{ color: '#c19653', flexShrink: 0 }}>•</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] mt-2.5" style={{ color: 'var(--color-muted)' }}>
                      Autant de leviers concrets que Hdigiweb peut activer pour lui apporter plus de devis.
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: '#5c9b82' }}>RÉSUMÉ DE L&apos;ÉCHANGE</p>
                  <p className="text-[12px] whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{detailsData.summary || '—'}</p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>CONVERSATION</p>
                  <div className="flex flex-col gap-2">
                    {(detailsData.conversation ?? []).map((m, i) => (
                      <div
                        key={i}
                        className="rounded-lg p-2.5 text-[12px]"
                        style={{
                          background: m.role === 'nous' ? '#5f83ac10' : 'var(--color-surface-2)',
                          border: `1px solid ${m.role === 'nous' ? '#5f83ac30' : 'var(--color-border)'}`,
                          alignSelf: m.role === 'nous' ? 'flex-end' : 'flex-start',
                          maxWidth: '88%',
                        }}
                      >
                        <p className="text-[10px] mb-1" style={{ color: 'var(--color-muted-2)' }}>{m.role === 'nous' ? 'Nous' : detailsCompany} · {m.date}</p>
                        <p className="whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{m.body}</p>
                      </div>
                    ))}
                    {(detailsData.conversation ?? []).length === 0 && (
                      <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Aucun message enregistré.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
