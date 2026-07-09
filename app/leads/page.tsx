'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { DEMO_LEADS } from '@/data/demo'
import { LeadStage } from '@/types'
import { formatDistanceToNow } from '@/lib/utils'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'

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
  follow_up_1:   { bg: '#5f83ac15', text: '#5f83ac' },
  follow_up_2:   { bg: '#7d6fb015', text: '#7d6fb0' },
  replied:       { bg: '#c1965315', text: '#c19653' },
  rdv_booked:    { bg: '#5c9b8215', text: '#5c9b82' },
  not_interested:{ bg: '#ef444415', text: '#ef4444' },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = any

const PAGE_SIZE = 50

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // reset to page 1 on new search
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
    })
    if (debouncedSearch) params.set('search', debouncedSearch)

    fetch(`/api/leads?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        const fetched = data.leads ?? []
        setLeads(fetched.length > 0 ? fetched : (page === 1 && !debouncedSearch ? DEMO_LEADS : []))
        setTotal(data.total ?? (fetched.length > 0 ? fetched.length : (page === 1 && !debouncedSearch ? DEMO_LEADS.length : 0)))
      })
      .catch(() => {
        if (page === 1 && !debouncedSearch) {
          setLeads(DEMO_LEADS)
          setTotal(DEMO_LEADS.length)
        } else {
          setLeads([])
          setTotal(0)
        }
      })
      .finally(() => setLoading(false))
  }, [page, debouncedSearch])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
          Leads
          <span className="ml-2 font-normal" style={{ color: 'var(--color-muted)' }}>
            {loading ? '…' : total}
          </span>
        </h1>

        {/* Search input */}
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-2.5" style={{ color: 'var(--color-muted-2)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="pl-8 pr-3 py-1.5 rounded text-[12px] outline-none w-48"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-[13px]" style={{ color: 'var(--color-muted)' }}>Chargement…</span>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-[13px]" style={{ color: 'var(--color-muted)' }}>
              {debouncedSearch ? `Aucun résultat pour "${debouncedSearch}"` : "Aucun lead pour l'instant"}
            </span>
          </div>
        ) : (
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
              {leads.map((lead: Lead) => {
                const stageStyle = STAGE_COLOR[lead.stage as LeadStage] ?? { bg: '#52525215', text: '#737373' }
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
                        {(lead.specialty ?? []).slice(0, 2).map((s: string) => (
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
                        {STAGE_LABEL[lead.stage as LeadStage] ?? lead.stage}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                      {(lead.thread ?? []).length}
                    </td>
                    <td className="px-5 py-3 text-[12px]" style={{ color: 'var(--color-muted)' }}>
                      {lead.lastActivityAt ? formatDistanceToNow(new Date(lead.lastActivityAt)) : '—'}
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
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="px-6 py-3 flex items-center justify-between flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            Page {page} sur {totalPages} · {total} leads
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              <ChevronLeft size={13} />
              Précédent
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              Suivant
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
