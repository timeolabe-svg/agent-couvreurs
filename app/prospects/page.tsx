'use client'

import { useState } from 'react'
import { Search, Upload, ChevronDown } from 'lucide-react'

const STATUS_OPTIONS = ['Tous', 'Nouveau', 'Contacté', 'Réponse', 'Intéressé', 'RDV réservé', 'Plus tard', 'Pas intéressé']
const SEGMENT_OPTIONS = ['Tous les segments', 'Avec site', 'Sans site', 'Google Ads actif', 'Passif']

export default function ProspectsPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Tous')
  const [segment, setSegment] = useState('Tous les segments')

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Prospects</h1>
        </div>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        >
          <Upload size={12} />
          Importer
        </button>
      </div>

      <div className="px-8 py-3 flex gap-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 flex-1 max-w-xs px-3 py-1.5 rounded-md text-sm"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <Search size={13} style={{ color: 'var(--color-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: 'var(--color-text)' }}
          />
        </div>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-1.5 text-xs"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
        >
          {STATUS_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>

        <select
          value={segment}
          onChange={e => setSegment(e.target.value)}
          className="px-3 py-1.5 text-xs"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
        >
          {SEGMENT_OPTIONS.map(o => <option key={o}>{o}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Entreprise', 'Ville', 'Segment', 'Maturité', 'Statut', 'Dernière action'].map(h => (
                <th key={h} className="px-8 py-3 text-left text-xs font-medium"
                  style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className="px-8 py-16 text-center">
                <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>
                  Aucun prospect importé
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted-2)' }}>
                  Utilisez le bouton Importer pour ajouter des prospects couvreurs
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
