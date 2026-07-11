'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Calendar, Phone, Mail, Plus, X, ChevronLeft, ChevronRight,
  MapPin, Globe, Clock, List as ListIcon, CalendarDays, MessageSquare,
} from 'lucide-react'
import Link from 'next/link'

const MONTH_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

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

type RdvState = 'attente' | 'confirme' | 'realise'
type Filter = 'avenir' | 'passe'
type ViewMode = 'list' | 'calendar'

const STATE_META: Record<RdvState, { label: string; color: string }> = {
  attente: { label: 'En attente', color: '#c19653' },
  confirme: { label: 'Confirmé', color: '#5c9b82' },
  realise: { label: 'Réalisé', color: '#5f83ac' },
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getRdvCompany(r: RdvItem) { return r.contact?.company ?? r.company ?? 'Inconnu' }
function getRdvPhone(r: RdvItem) { return r.contact?.phone ?? r.phone ?? null }

// Statut dérivé AUTOMATIQUEMENT par l'heure :
//  - RDV à venir            → "En attente" (le rendez-vous n'a pas encore eu lieu)
//  - une fois l'heure passée → "Réalisé" (bascule toute seule)
// "Confirmé" est réservé à une confirmation manuelle éventuelle (statut 'signed' en base).
function rdvState(r: RdvItem, now: Date): RdvState {
  const past = new Date(r.scheduled_at).getTime() < now.getTime()
  if (past) return 'realise'
  if (r.status === 'signed') return 'confirme'
  return 'attente'
}

// Grille mensuelle Lun→Dim (6 semaines = 42 cases, débords des mois voisins inclus).
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const weekday = (first.getDay() + 6) % 7 // Lun=0 … Dim=6
  const start = new Date(first)
  start.setDate(first.getDate() - weekday)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

export default function AgendaPage() {
  const [rdvs, setRdvs] = useState<RdvItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('list')
  const [filter, setFilter] = useState<Filter>('avenir')
  const [calMonth, setCalMonth] = useState<Date | null>(null)

  const [showNewRdv, setShowNewRdv] = useState(false)
  const [form, setForm] = useState({ contactId: '', scheduledAt: '', durationMin: '30', notes: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [contactSearch, setContactSearch] = useState('')
  const [contactSuggestions, setContactSuggestions] = useState<Array<{ id: string; name: string | null; company: string; city: string | null }>>([])
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string | null; company: string } | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const contactInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => { setCalMonth(new Date()) }, [])

  // Tick chaque minute → recalcule les statuts (un RDV dont l'heure vient de
  // passer bascule tout seul en "Réalisé" sans recharger la page).
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
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

  useEffect(() => { void loadRdvs() }, [loadRdvs])

  useEffect(() => {
    if (contactSearch.length < 2) { setContactSuggestions([]); return }
    const timer = setTimeout(() => {
      fetch(`/api/leads?search=${encodeURIComponent(contactSearch)}&limit=8`)
        .then(r => r.json())
        .then((data: { leads?: Array<{ id: string; name: string | null; company: string; city: string | null }> }) => {
          setContactSuggestions(data.leads ?? []); setShowSuggestions(true)
        })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
  }, [contactSearch])

  const handleCreate = async () => {
    if (!form.contactId || !form.scheduledAt) { setCreateError('Contact et date/heure requis'); return }
    setCreating(true); setCreateError(null)
    try {
      const res = await fetch('/api/rdv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: form.contactId, scheduledAt: form.scheduledAt, durationMin: parseInt(form.durationMin, 10) || 30, notes: form.notes || undefined, meetLink: true }),
      })
      if (!res.ok) { const err = await res.json() as { error: string }; throw new Error(err.error ?? `HTTP ${res.status}`) }
      setShowNewRdv(false); setForm({ contactId: '', scheduledAt: '', durationMin: '30', notes: '' })
      setContactSearch(''); setSelectedContact(null); setContactSuggestions([])
      await loadRdvs()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally { setCreating(false) }
  }

  const now = new Date()
  const withState = rdvs.map(r => ({ r, state: rdvState(r, now) }))
  const isUpcoming = (r: RdvItem) => new Date(r.scheduled_at).getTime() >= now.getTime()
  const counts = {
    avenir: rdvs.filter(isUpcoming).length,
    passe: rdvs.filter(r => !isUpcoming(r)).length,
    attente: withState.filter(x => x.state === 'attente').length,
    confirme: withState.filter(x => x.state === 'confirme').length,
    realise: withState.filter(x => x.state === 'realise').length,
    ceMois: rdvs.filter(r => { const d = new Date(r.scheduled_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() }).length,
  }

  // À venir = tri croissant (le plus proche d'abord) ; Passé = tri décroissant (le plus récent d'abord).
  const listRdvs = withState
    .filter(x => (filter === 'avenir') === isUpcoming(x.r))
    .sort((a, b) => {
      const ta = new Date(a.r.scheduled_at).getTime(), tb = new Date(b.r.scheduled_at).getTime()
      return filter === 'avenir' ? ta - tb : tb - ta
    })

  const grid = calMonth ? monthGrid(calMonth) : []
  const monthLabel = calMonth ? calMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : ''

  const closeNew = () => { setShowNewRdv(false); setContactSearch(''); setSelectedContact(null); setContactSuggestions([]) }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 pb-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ color: 'var(--color-text)' }}>Agenda</h1>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Gérez vos rendez-vous</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              {([['list', 'Liste', ListIcon], ['calendar', 'Calendrier', CalendarDays]] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md font-medium transition-colors"
                  style={view === v
                    ? { background: 'var(--color-surface)', color: 'var(--color-text)', boxShadow: '0 1px 2px rgba(0,0,0,.15)' }
                    : { background: 'transparent', color: 'var(--color-muted)' }}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowNewRdv(true)}
              className="flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-md font-medium"
              style={{ background: '#5c9b82', color: '#fff' }}
            >
              <Plus size={13} /> Nouveau RDV
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-5 flex flex-col gap-4">
        {/* ─── VUE LISTE ─── */}
        {view === 'list' && (
          <div className="rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 pt-4 pb-3">
              <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>Prochains rendez-vous</p>
              <div className="flex items-center gap-1 text-[12px]">
                {([['avenir', 'À venir'], ['passe', 'Passé']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className="px-3 py-1 rounded-md transition-colors"
                    style={filter === key
                      ? { background: '#5c9b8218', color: '#5c9b82', fontWeight: 600 }
                      : { color: 'var(--color-muted)' }}
                  >
                    {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)' }}>
              {loading && (
                <div className="flex items-center gap-2 px-4 py-6">
                  <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--color-border)', borderTopColor: '#5c9b82' }} />
                  <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Chargement…</span>
                </div>
              )}
              {!loading && listRdvs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <Calendar size={30} style={{ color: 'var(--color-muted-2)' }} />
                  <p className="text-[14px] font-medium mt-3" style={{ color: 'var(--color-text)' }}>Aucun rendez-vous</p>
                  <p className="text-[12px] mt-1" style={{ color: 'var(--color-muted)' }}>Les RDV calés par l&apos;agent apparaîtront ici.</p>
                </div>
              )}

              <div className="flex flex-col">
                {listRdvs.map(({ r, state }, idx) => {
                  const d = new Date(r.scheduled_at)
                  const company = getRdvCompany(r)
                  const phone = getRdvPhone(r)
                  const contactName = r.contact?.name ?? r.contact_name ?? ''
                  const city = r.contact?.city ?? ''
                  const email = r.contact?.email ?? ''
                  const sm = STATE_META[state]
                  return (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 px-4 py-3.5"
                      style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)' }}
                    >
                      {/* Date block */}
                      <div className="flex flex-col items-center justify-center rounded-lg flex-shrink-0"
                        style={{ width: 52, padding: '8px 0', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                        <span className="text-[10px] uppercase" style={{ color: sm.color }}>{d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
                        <span className="text-[19px] font-bold leading-none my-0.5" style={{ color: 'var(--color-text)' }}>{d.getDate()}</span>
                        <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>

                      {/* Main */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{company}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: sm.color + '1f', color: sm.color }}>{sm.label}</span>
                          {contactName && <span className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>· {contactName}</span>}
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          {d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à {d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {r.duration_min ?? 30} min
                        </p>

                        {/* Coordonnées */}
                        <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap text-[11px]" style={{ color: 'var(--color-muted)' }}>
                          {phone && <a href={`tel:${phone}`} className="flex items-center gap-1" style={{ color: 'var(--color-text)' }}><Phone size={11} />{phone}</a>}
                          {email && <span className="flex items-center gap-1"><Mail size={11} />{email}</span>}
                          {city && <span className="flex items-center gap-1"><MapPin size={11} />{city}</span>}
                        </div>

                        {/* Notes / contexte */}
                        {r.notes && (
                          <p className="text-[11px] italic mt-1.5 px-2 py-1 rounded" style={{ color: 'var(--color-muted)', background: 'var(--color-surface-2)' }}>
                            &ldquo;{r.notes.substring(0, 140)}{r.notes.length > 140 ? '…' : ''}&rdquo;
                          </p>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className="flex items-center gap-1 text-[10px]" style={{ color: '#5c9b82' }}><Mail size={10} /> Client notifié</span>
                          {r.google_meet_link && (
                            <a href={r.google_meet_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px]" style={{ color: '#5f83ac' }}>Meet →</a>
                          )}
                          {r.contact_id && (
                            <button onClick={() => void openDetails(r.contact_id!, company)} className="flex items-center gap-1 text-[11px] font-medium" style={{ color: '#8f7bb5' }}>
                              <MessageSquare size={11} /> Conversation + fiche →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── VUE CALENDRIER ─── */}
        {view === 'calendar' && calMonth && (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                className="p-1.5 rounded-md" style={{ color: 'var(--color-muted)' }} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
              <p className="text-[15px] font-semibold capitalize" style={{ color: 'var(--color-text)' }}>{monthLabel}</p>
              <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                className="p-1.5 rounded-md" style={{ color: 'var(--color-muted)' }} aria-label="Mois suivant"><ChevronRight size={18} /></button>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {MONTH_DAYS.map(dn => (
                <div key={dn} className="text-center py-2 text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>{dn}</div>
              ))}
              {grid.map((d, i) => {
                const inMonth = d.getMonth() === calMonth.getMonth()
                const today = isSameDay(d, now)
                const dayRdvs = withState.filter(x => isSameDay(new Date(x.r.scheduled_at), d))
                return (
                  <div key={i} className="min-h-[86px] p-1.5 flex flex-col gap-1"
                    style={{ borderRight: (i % 7 !== 6) ? '1px solid var(--color-border)' : 'none', borderBottom: '1px solid var(--color-border)', background: today ? 'rgba(125,111,176,0.06)' : 'transparent', opacity: inMonth ? 1 : 0.4 }}>
                    <span className="text-[11px] self-end inline-flex items-center justify-center"
                      style={today ? { color: '#fff', background: '#7d6fb0', width: 20, height: 20, borderRadius: '50%', fontWeight: 600 } : { color: 'var(--color-muted)' }}>{d.getDate()}</span>
                    {dayRdvs.slice(0, 3).map(({ r, state }) => {
                      const sm = STATE_META[state]
                      return (
                        <button key={r.id} onClick={() => r.contact_id && void openDetails(r.contact_id, getRdvCompany(r))}
                          className="text-left rounded px-1.5 py-0.5 truncate text-[10px]"
                          style={{ background: sm.color + '22', color: sm.color, borderLeft: `2px solid ${sm.color}` }}>
                          {new Date(r.scheduled_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} {getRdvCompany(r)}
                        </button>
                      )
                    })}
                    {dayRdvs.length > 3 && <span className="text-[9px]" style={{ color: 'var(--color-muted-2)' }}>+{dayRdvs.length - 3}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ─── CARTES STATS ─── */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          {([
            { label: 'Ce mois', value: counts.ceMois, color: '#5f83ac' },
            { label: 'En attente', value: counts.attente, color: '#c19653' },
            { label: 'Confirmés', value: counts.confirme, color: '#5c9b82' },
            { label: 'Réalisés', value: counts.realise, color: '#8f7bb5' },
          ]).map(s => (
            <div key={s.label} className="rounded-xl p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: `2px solid ${s.color}` }}>
              <div className="text-[26px] font-bold" style={{ color: 'var(--color-text)' }}>{s.value}</div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Modal Nouveau RDV ─── */}
      {showNewRdv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeNew() }}>
          <div className="rounded-xl w-full max-w-md p-6" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>Nouveau RDV</h2>
              <button onClick={closeNew}><X size={16} style={{ color: 'var(--color-muted)' }} /></button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="relative">
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Contact *</label>
                <input ref={contactInputRef}
                  value={selectedContact ? `${selectedContact.name ?? selectedContact.company} — ${selectedContact.company}` : contactSearch}
                  onChange={(e) => { setSelectedContact(null); setForm((f) => ({ ...f, contactId: '' })); setContactSearch(e.target.value); setShowSuggestions(true) }}
                  onFocus={() => { if (contactSuggestions.length > 0) setShowSuggestions(true) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Rechercher par nom ou entreprise…"
                  className="w-full text-[12px] px-3 py-2 rounded-md"
                  style={{ background: 'var(--color-surface-2)', border: `1px solid ${form.contactId ? '#5c9b8260' : 'var(--color-border)'}`, color: 'var(--color-text)', outline: 'none' }} />
                {showSuggestions && contactSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 rounded-md overflow-hidden" style={{ top: '100%', marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
                    {contactSuggestions.map((c) => (
                      <button key={c.id} type="button"
                        onMouseDown={() => { setSelectedContact(c); setForm((f) => ({ ...f, contactId: c.id })); setContactSearch(''); setShowSuggestions(false) }}
                        className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-black/20"
                        style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>
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
                <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  className="w-full text-[12px] px-3 py-2 rounded-md" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Durée (min)</label>
                <input type="number" value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} min="15" step="15"
                  className="w-full text-[12px] px-3 py-2 rounded-md" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--color-muted)' }}>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3}
                  className="w-full text-[12px] px-3 py-2 rounded-md resize-none" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }} />
              </div>
              {createError && <p className="text-[12px]" style={{ color: '#ef4444' }}>{createError}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => void handleCreate()} disabled={creating} className="flex-1 py-2 rounded-md text-[13px] font-semibold" style={{ background: '#5c9b82', color: '#fff', opacity: creating ? 0.6 : 1 }}>
                  {creating ? 'Création…' : 'Créer le RDV'}
                </button>
                <button onClick={closeNew} className="px-4 py-2 rounded-md text-[13px]" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal Détails enrichis ─── */}
      {detailsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setDetailsOpen(false) }}>
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
                    {detailsData.contact?.phone && <span className="flex items-center gap-1"><Phone size={11} /> {detailsData.contact.phone}</span>}
                    {detailsData.contact?.city && <span className="flex items-center gap-1"><MapPin size={11} /> {detailsData.contact.city}</span>}
                    {detailsData.contact?.website && <a href={detailsData.contact.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1" style={{ color: '#5f83ac' }}><Globe size={11} /> site</a>}
                    {detailsData.contact?.googleRating != null && <span className="flex items-center gap-1"><Clock size={11} /> {detailsData.contact.googleRating} ({detailsData.contact.googleReviews ?? 0} avis)</span>}
                  </div>
                </div>
                {(detailsData.contact?.auditWeaknesses?.length ?? 0) > 0 && (
                  <div className="rounded-lg p-3" style={{ background: 'rgba(193,150,83,0.06)', border: '1px solid rgba(193,150,83,0.2)' }}>
                    <div className="flex items-center flex-wrap gap-2 mb-2">
                      <p className="text-[11px] font-semibold" style={{ color: '#c19653' }}>AUDIT DU SITE — LEVIERS À VENDRE</p>
                      {typeof detailsData.contact?.auditScore === 'number' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(193,150,83,0.15)', color: '#c19653' }}>{detailsData.contact.auditScore}/100</span>
                      )}
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {detailsData.contact!.auditWeaknesses!.slice(0, 10).map((w, i) => (
                        <li key={i} className="flex gap-2 text-[12px]" style={{ color: 'var(--color-text)' }}>
                          <span style={{ color: '#c19653', flexShrink: 0 }}>•</span><span>{w}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] mt-2.5" style={{ color: 'var(--color-muted)' }}>Autant de leviers concrets que Hdigiweb peut activer pour lui apporter plus de devis.</p>
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
                      <div key={i} className="rounded-lg p-2.5 text-[12px]"
                        style={{ background: m.role === 'nous' ? '#5f83ac10' : 'var(--color-surface-2)', border: `1px solid ${m.role === 'nous' ? '#5f83ac30' : 'var(--color-border)'}`, alignSelf: m.role === 'nous' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
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
