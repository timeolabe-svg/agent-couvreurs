'use client'

import { useState, useRef, useCallback } from 'react'
import { X, Upload, Search, Plus, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Tab = 'scraping' | 'csv' | 'manual'

const SECTORS = [
  { value: 'couvreur', label: 'Couvreur' },
  { value: 'plombier', label: 'Plombier' },
  { value: 'électricien', label: 'Électricien' },
  { value: 'charpentier', label: 'Charpentier' },
  { value: 'maçon', label: 'Maçon' },
  { value: 'peintre bâtiment', label: 'Peintre bâtiment' },
  { value: 'menuisier', label: 'Menuisier' },
  { value: 'carreleur', label: 'Carreleur' },
  { value: 'plaquiste', label: 'Plaquiste' },
  { value: 'chauffagiste', label: 'Chauffagiste' },
]

interface ImportResult {
  scraped?: number
  inserted: number
  skipped: number
  invalid?: number
  total?: number
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-[12px] font-medium transition-colors"
      style={{
        color: active ? 'var(--color-text)' : 'var(--color-muted)',
        borderBottom: active ? '2px solid var(--color-accent, #3b82f6)' : '2px solid transparent',
        background: 'transparent',
      }}
    >
      {children}
    </button>
  )
}

function StatusMessage({ result, error }: { result: ImportResult | null; error: string | null }) {
  if (error) {
    return (
      <div
        className="flex items-center gap-2 p-3 rounded text-[12px]"
        style={{ background: '#ef444415', color: '#ef4444', border: '1px solid #ef444430' }}
      >
        <AlertCircle size={13} />
        {error}
      </div>
    )
  }
  if (result) {
    return (
      <div
        className="flex items-center gap-2 p-3 rounded text-[12px]"
        style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}
      >
        <CheckCircle2 size={13} />
        <span>
          {result.scraped !== undefined && `${result.scraped} trouvés · `}
          {result.inserted} importés
          {result.skipped > 0 && ` · ${result.skipped} ignorés`}
          {result.invalid != null && result.invalid > 0 && ` · ${result.invalid} invalides`}
        </span>
      </div>
    )
  }
  return null
}

// ── Tab: Google Places Scraping ───────────────────────────────────────────────
function ScrapingTab({ onImported }: { onImported?: (count: number) => void }) {
  const [sector, setSector] = useState('couvreur')
  const [city, setCity] = useState('')
  const [radius, setRadius] = useState(20)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleScrape() {
    if (!city.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const resp = await fetch('/api/leads/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, city: city.trim(), radius: radius * 1000 }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Scraping failed')
      setResult({ scraped: data.scraped, inserted: data.inserted, skipped: data.skipped })
      if (data.inserted > 0) onImported?.(data.inserted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Secteur</label>
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          className="w-full px-3 py-2 rounded text-[13px]"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          {SECTORS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Ville</label>
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="ex: Toulouse"
          className="w-full px-3 py-2 rounded text-[13px]"
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
          onKeyDown={e => e.key === 'Enter' && handleScrape()}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] flex items-center justify-between" style={{ color: 'var(--color-muted)' }}>
          <span>Rayon</span>
          <span>{radius} km</span>
        </label>
        <input
          type="range"
          min={5}
          max={50}
          step={5}
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          className="w-full"
          style={{ accentColor: '#3b82f6' }}
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
          <span>5 km</span>
          <span>50 km</span>
        </div>
      </div>

      <StatusMessage result={result} error={error} />

      <button
        onClick={handleScrape}
        disabled={loading || !city.trim()}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded text-[13px] font-medium transition-opacity disabled:opacity-50"
        style={{ background: '#3b82f6', color: '#fff' }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        {loading ? 'Scraping en cours…' : 'Scraper'}
      </button>
    </div>
  )
}

// ── Tab: CSV Import ────────────────────────────────────────────────────────────
function CsvTab({ onImported }: { onImported?: (count: number) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string[][]>([])
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function parsePreview(f: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = (e.target?.result as string) ?? ''
      const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 4)
      const rows = lines.map(l => l.split(/[,;]/).map(cell => cell.replace(/^"|"$/g, '').trim()))
      setPreview(rows)
    }
    reader.readAsText(f)
  }

  function handleFileChange(f: File | null) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    parsePreview(f)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) handleFileChange(f)
    else setError('Veuillez déposer un fichier .csv')
  }, [])

  async function handleImport() {
    if (!file) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/api/leads/import', { method: 'POST', body: form })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Import failed')
      setResult({ inserted: data.inserted, skipped: data.skipped, invalid: data.invalid, total: data.total })
      if (data.inserted > 0) onImported?.(data.inserted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 p-8 rounded cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${dragging ? '#3b82f6' : 'var(--color-border)'}`,
          background: dragging ? '#3b82f610' : 'var(--color-surface-2)',
        }}
      >
        <Upload size={20} style={{ color: 'var(--color-muted)' }} />
        <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
          {file ? file.name : 'Glissez un .csv ou cliquez pour parcourir'}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
          Colonnes : email, nom, entreprise, tel, ville, secteur, site
        </p>
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
      </div>

      {preview.length > 0 && (
        <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full text-[11px]">
            {preview.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri === 0 ? 'var(--color-surface-2)' : 'var(--color-surface)',
                  borderBottom: ri < preview.length - 1 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                {row.slice(0, 6).map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-1.5 truncate max-w-[120px]"
                    style={{
                      color: ri === 0 ? 'var(--color-muted)' : 'var(--color-text)',
                      fontWeight: ri === 0 ? 500 : 400,
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </table>
        </div>
      )}

      <StatusMessage result={result} error={error} />

      <button
        onClick={handleImport}
        disabled={loading || !file}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded text-[13px] font-medium transition-opacity disabled:opacity-50"
        style={{ background: '#3b82f6', color: '#fff' }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {loading ? 'Importation…' : 'Importer'}
      </button>
    </div>
  )
}

// ── Tab: Manual entry ─────────────────────────────────────────────────────────
function ManualTab({ onImported }: { onImported?: (count: number) => void }) {
  const [form, setForm] = useState({
    email: '',
    name: '',
    company: '',
    phone: '',
    city: '',
    sector: '',
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleAdd() {
    if (!form.email.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const resp = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Ajout échoué')
      setResult({ inserted: 1, skipped: 0 })
      onImported?.(1)
      setForm({ email: '', name: '', company: '', phone: '', city: '', sector: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'email', label: 'Email *', placeholder: 'contact@entreprise.fr', type: 'email' },
          { key: 'name', label: 'Nom contact', placeholder: 'Jean Dupont', type: 'text' },
          { key: 'company', label: 'Entreprise', placeholder: 'SARL Toiture Dupont', type: 'text' },
          { key: 'phone', label: 'Téléphone', placeholder: '06 12 34 56 78', type: 'tel' },
          { key: 'city', label: 'Ville', placeholder: 'Toulouse', type: 'text' },
        ].map(({ key, label, placeholder, type }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</label>
            <input
              type={type}
              value={form[key as keyof typeof form]}
              onChange={update(key as keyof typeof form)}
              placeholder={placeholder}
              className="w-full px-3 py-2 rounded text-[13px]"
              style={inputStyle}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <label className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Secteur</label>
          <select
            value={form.sector}
            onChange={update('sector')}
            className="w-full px-3 py-2 rounded text-[13px]"
            style={inputStyle}
          >
            <option value="">— choisir —</option>
            {SECTORS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <StatusMessage result={result} error={error} />

      <button
        onClick={handleAdd}
        disabled={loading || !form.email.trim()}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded text-[13px] font-medium transition-opacity disabled:opacity-50"
        style={{ background: '#3b82f6', color: '#fff' }}
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {loading ? 'Ajout en cours…' : 'Ajouter'}
      </button>
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function LeadImportModal({
  isOpen,
  onClose,
  onImported,
}: {
  isOpen: boolean
  onClose: () => void
  onImported?: (count: number) => void
}) {
  const [tab, setTab] = useState<Tab>('scraping')

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Importer des leads
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <TabButton active={tab === 'scraping'} onClick={() => setTab('scraping')}>
            Google Places
          </TabButton>
          <TabButton active={tab === 'csv'} onClick={() => setTab('csv')}>
            Import CSV
          </TabButton>
          <TabButton active={tab === 'manual'} onClick={() => setTab('manual')}>
            Ajout manuel
          </TabButton>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {tab === 'scraping' && <ScrapingTab onImported={onImported} />}
          {tab === 'csv' && <CsvTab onImported={onImported} />}
          {tab === 'manual' && <ManualTab onImported={onImported} />}
        </div>
      </div>
    </div>
  )
}
