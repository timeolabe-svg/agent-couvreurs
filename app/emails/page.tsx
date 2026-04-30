'use client'

import { useState } from 'react'
import { RefreshCw, Send, Check, ChevronDown } from 'lucide-react'

const EMAIL_TYPES = [
  { value: 'initial',    label: 'Email initial' },
  { value: 'followup_1', label: 'Relance J+2' },
  { value: 'followup_2', label: 'Relance J+5' },
  { value: 'followup_3', label: 'Relance finale J+10' },
]

const TABS = ['Generateur', 'Historique', 'Reponses']

type Tab = typeof TABS[number]

export default function EmailsPage() {
  const [tab, setTab] = useState<Tab>('Generateur')
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')
  const [contact, setContact] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [hasWebsite, setHasWebsite] = useState(false)
  const [hasAds, setHasAds] = useState(false)
  const [emailType, setEmailType] = useState('initial')
  const [generated, setGenerated] = useState<{ subject: string; body: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!company || !city) return
    setLoading(true)
    setError(null)
    setSent(false)
    try {
      const prospect = {
        id: 'manual',
        company, city, email: '', department: '',
        contact: contact || undefined,
        specialty: specialty ? [specialty] : [],
        employees_estimate: '3-10' as const,
        hasGoogleAds: hasAds,
        hasWebsite,
        marketingMaturity: 'medium' as const,
        segment: hasAds ? 'active_ads' as const : hasWebsite ? 'with_site' as const : 'without_site' as const,
        status: 'new' as const,
        createdAt: new Date().toISOString(),
      }
      const res = await fetch('/api/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect, type: emailType }),
      })
      if (!res.ok) throw new Error('API error')
      setGenerated(await res.json())
    } catch {
      setError('Verifiez que la cle ANTHROPIC_API_KEY est configuree sur Vercel.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 h-14 flex items-center gap-6 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Emails IA</h1>
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1 rounded text-xs transition-colors"
              style={{
                color: tab === t ? 'var(--color-text)' : 'var(--color-muted)',
                background: tab === t ? 'var(--color-surface-2)' : 'transparent',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === 'Generateur' && (
          <div className="grid grid-cols-2 gap-6 max-w-4xl">
            {/* Inputs */}
            <div className="flex flex-col gap-4">
              <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>INFORMATIONS PROSPECT</p>

              <Field label="Nom de l'entreprise *">
                <input
                  type="text" placeholder="ex: Couverture Dupont"
                  value={company} onChange={e => setCompany(e.target.value)}
                  className="w-full px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Ville *">
                <input
                  type="text" placeholder="ex: Lyon"
                  value={city} onChange={e => setCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Prenom du contact">
                <input
                  type="text" placeholder="ex: Marc"
                  value={contact} onChange={e => setContact(e.target.value)}
                  className="w-full px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Specialite">
                <input
                  type="text" placeholder="ex: ardoise, zinc, renovation..."
                  value={specialty} onChange={e => setSpecialty(e.target.value)}
                  className="w-full px-3 py-2 text-sm"
                />
              </Field>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                  <input type="checkbox" checked={hasWebsite} onChange={e => setHasWebsite(e.target.checked)}
                    className="w-3.5 h-3.5" />
                  A un site web
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                  <input type="checkbox" checked={hasAds} onChange={e => setHasAds(e.target.checked)}
                    className="w-3.5 h-3.5" />
                  Google Ads actif
                </label>
              </div>

              <Field label="Type d'email">
                <select
                  value={emailType} onChange={e => setEmailType(e.target.value)}
                  className="w-full px-3 py-2 text-sm"
                >
                  {EMAIL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>

              <button
                onClick={handleGenerate}
                disabled={loading || !company || !city}
                className="w-full py-2 rounded-md text-sm font-medium text-white flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--color-accent)' }}
              >
                {loading ? <RefreshCw size={13} className="animate-spin" /> : null}
                {loading ? 'Generation...' : 'Generer l\'email'}
              </button>
            </div>

            {/* Preview */}
            <div>
              <p className="text-xs font-medium mb-4" style={{ color: 'var(--color-muted)' }}>APERCU</p>

              {error && (
                <div className="mb-3 px-3 py-2 rounded-md text-xs"
                  style={{ background: '#ef444410', color: '#ef4444', border: '1px solid #ef444430' }}>
                  {error}
                </div>
              )}

              {!generated ? (
                <div className="rounded-lg flex items-center justify-center h-64"
                  style={{ border: '1px dashed var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-sm" style={{ color: 'var(--color-muted-2)' }}>
                    Remplissez le formulaire et generez
                  </p>
                </div>
              ) : (
                <div className="rounded-lg overflow-hidden"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <p className="text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>Objet</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {generated.subject}
                    </p>
                  </div>
                  <div className="px-4 py-4">
                    <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Corps</p>
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed"
                      style={{ color: 'var(--color-text)' }}>
                      {generated.body}
                    </pre>
                  </div>
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{ borderTop: '1px solid var(--color-border)' }}>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {generated.body.split(/\s+/).filter(Boolean).length} mots
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={handleGenerate}
                        className="px-3 py-1.5 rounded text-xs flex items-center gap-1.5"
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                      >
                        <RefreshCw size={11} />
                        Regenerer
                      </button>
                      {sent ? (
                        <span className="px-3 py-1.5 rounded text-xs flex items-center gap-1.5"
                          style={{ background: '#22c55e15', color: '#22c55e' }}>
                          <Check size={11} />
                          Simule
                        </span>
                      ) : (
                        <button
                          onClick={() => setSent(true)}
                          className="px-3 py-1.5 rounded text-xs flex items-center gap-1.5"
                          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                        >
                          <Send size={11} />
                          Simuler l&apos;envoi
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'Historique' && (
          <div className="max-w-3xl">
            <EmptyState text="Aucun email envoye pour le moment" />
          </div>
        )}

        {tab === 'Reponses' && (
          <div className="max-w-3xl">
            <EmptyState text="Aucune reponse recue pour le moment" />
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs block mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg py-16 text-center"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{text}</p>
    </div>
  )
}
