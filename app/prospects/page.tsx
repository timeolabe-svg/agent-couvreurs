'use client'

import { useState } from 'react'
import { DEMO_PROSPECTS } from '@/data/prospects'
import { Prospect, ProspectStatus, ProspectSegment } from '@/types'
import {
  Search, Filter, Globe, MapPin, Star,
  Phone, Mail, CheckCircle, Clock, AlertCircle,
  TrendingUp, Users, ExternalLink,
} from 'lucide-react'

const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'Nouveau',
  contacted: 'Contacté',
  replied: 'Réponse',
  interested: 'Intéressé',
  not_interested: 'Pas intéressé',
  rdv_booked: 'RDV réservé',
  later: 'Plus tard',
}

const STATUS_COLORS: Record<ProspectStatus, { bg: string; text: string }> = {
  new: { bg: '#6b6b8a20', text: '#6b6b8a' },
  contacted: { bg: '#6366f120', text: '#6366f1' },
  replied: { bg: '#f59e0b20', text: '#f59e0b' },
  interested: { bg: '#a855f720', text: '#a855f7' },
  not_interested: { bg: '#ef444420', text: '#ef4444' },
  rdv_booked: { bg: '#22c55e20', text: '#22c55e' },
  later: { bg: '#06b6d420', text: '#06b6d4' },
}

const SEGMENT_LABELS: Record<ProspectSegment, string> = {
  with_site: 'Avec site',
  without_site: 'Sans site',
  active_ads: 'Google Ads actif',
  passive: 'Passif',
}

const MATURITY_COLORS: Record<string, string> = {
  low: '#ef4444',
  medium: '#f59e0b',
  high: '#22c55e',
}

export default function ProspectsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProspectStatus | 'all'>('all')
  const [segmentFilter, setSegmentFilter] = useState<ProspectSegment | 'all'>('all')
  const [selected, setSelected] = useState<Prospect | null>(null)

  const filtered = DEMO_PROSPECTS.filter(p => {
    const matchSearch =
      p.company.toLowerCase().includes(search.toLowerCase()) ||
      p.city.toLowerCase().includes(search.toLowerCase()) ||
      p.specialty.some(s => s.toLowerCase().includes(search.toLowerCase()))
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    const matchSegment = segmentFilter === 'all' || p.segment === segmentFilter
    return matchSearch && matchStatus && matchSegment
  })

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              Prospects
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
              {filtered.length} couvreurs · France
            </p>
          </div>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-accent)' }}
          >
            + Importer prospects
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-48"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <Search size={14} style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              placeholder="Rechercher…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1"
              style={{ color: 'var(--color-text)' }}
            />
          </div>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ProspectStatus | 'all')}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          <select
            value={segmentFilter}
            onChange={e => setSegmentFilter(e.target.value as ProspectSegment | 'all')}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          >
            <option value="all">Tous les segments</option>
            {Object.entries(SEGMENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['Entreprise', 'Ville', 'Spécialité', 'Segment', 'Maturité', 'Statut', ''].map(h => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-xs font-medium"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const s = STATUS_COLORS[p.status]
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer transition-colors"
                    style={{
                      background: selected?.id === p.id ? 'var(--color-surface-2)' : i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = selected?.id === p.id ? 'var(--color-surface-2)' : i % 2 === 0 ? 'var(--color-bg)' : 'var(--color-surface)')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.hasWebsite ? <Globe size={12} style={{ color: 'var(--color-accent)' }} /> : <Globe size={12} style={{ color: 'var(--color-border)' }} />}
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{p.company}</span>
                      </div>
                      {p.contact && <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{p.contact}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--color-muted)' }}>
                        <MapPin size={11} />
                        {p.city}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.specialty.slice(0, 2).map(s => (
                          <span key={s} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {SEGMENT_LABELS[p.segment]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: MATURITY_COLORS[p.marketingMaturity] }} />
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {p.marketingMaturity === 'high' ? 'Élevée' : p.marketingMaturity === 'medium' ? 'Moyenne' : 'Faible'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: s.bg, color: s.text }}
                      >
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ExternalLink size={14} style={{ color: 'var(--color-muted)' }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Side panel */}
      {selected && (
        <div
          className="w-80 flex-shrink-0 border-l overflow-auto"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                  {selected.company}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {selected.city} ({selected.department})
                </p>
              </div>
              <button onClick={() => setSelected(null)} style={{ color: 'var(--color-muted)' }} className="text-lg leading-none">×</button>
            </div>

            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: STATUS_COLORS[selected.status].bg, color: STATUS_COLORS[selected.status].text }}
            >
              {STATUS_LABELS[selected.status]}
            </span>

            <div className="mt-4 flex flex-col gap-2.5">
              {selected.contact && (
                <Row icon={<Users size={13} />} label="Contact" value={selected.contact} />
              )}
              <Row icon={<Mail size={13} />} label="Email" value={selected.email} />
              {selected.phone && (
                <Row icon={<Phone size={13} />} label="Téléphone" value={selected.phone} />
              )}
              {selected.website && (
                <Row icon={<Globe size={13} />} label="Site web" value={selected.website} />
              )}
              {selected.googleRating && (
                <Row icon={<Star size={13} />} label="Google" value={`${selected.googleRating}/5 · ${selected.googleReviews} avis`} />
              )}
              <Row icon={<Users size={13} />} label="Taille" value={`${selected.employees_estimate} employés`} />
              <Row icon={<TrendingUp size={13} />} label="Google Ads" value={selected.hasGoogleAds ? 'Actif' : 'Non'} />
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Spécialités</p>
              <div className="flex flex-wrap gap-1">
                {selected.specialty.map(s => (
                  <span key={s} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <button
                className="w-full py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-accent)' }}
              >
                Générer un email
              </button>
              <button
                className="w-full py-2 rounded-lg text-sm transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                Voir l&apos;historique
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span style={{ color: 'var(--color-muted)' }} className="mt-0.5">{icon}</span>
      <div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  )
}
