'use client'

import { useState } from 'react'
import { DEMO_PROSPECTS } from '@/data/prospects'
import { DEMO_GENERATED_EMAILS, DEMO_REPLIES } from '@/data/emails'
import { Prospect, GeneratedEmail } from '@/types'
import {
  Mail, Zap, Send, RefreshCw, Check,
  Eye, MessageSquare, Clock, ChevronDown,
} from 'lucide-react'

const EMAIL_TYPE_LABELS = {
  initial: 'Email initial',
  followup_1: 'Relance J+2',
  followup_2: 'Relance J+5',
  followup_3: 'Relance J+10',
}

const REPLY_LABELS = {
  interested: { label: 'Intéressé', color: '#22c55e' },
  not_interested: { label: 'Pas intéressé', color: '#ef4444' },
  later: { label: 'Plus tard', color: '#06b6d4' },
  info_request: { label: 'Demande info', color: '#f59e0b' },
}

export default function EmailsPage() {
  const [selectedProspect, setSelectedProspect] = useState<Prospect>(DEMO_PROSPECTS[0])
  const [emailType, setEmailType] = useState<'initial' | 'followup_1' | 'followup_2' | 'followup_3'>('initial')
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'replies'>('generate')

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    setSent(false)
    try {
      const res = await fetch('/api/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect: selectedProspect, type: emailType }),
      })
      if (!res.ok) throw new Error('Erreur génération')
      const data = await res.json()
      setGeneratedEmail(data)
    } catch (e) {
      setError('Clé API non configurée — voici un exemple statique')
      setGeneratedEmail({
        subject: `Plus de chantiers pour ${selectedProspect.company} ?`,
        body: `Bonjour${selectedProspect.contact ? ' ' + selectedProspect.contact.split(' ')[0] : ''},

J'ai vu que ${selectedProspect.company} est actif à ${selectedProspect.city}${selectedProspect.googleRating ? ` — ${selectedProspect.googleRating}/5 sur Google, c'est une bonne réputation` : ''}.

La question c'est : est-ce que le planning est aussi plein qu'il devrait l'être ?

On travaille avec des artisans couvreurs pour générer des demandes de chantiers en continu, sans dépendre du bouche-à-oreille ou des plateformes qui prennent leur commission.

Ça vous intéresse qu'on en parle 15 minutes ?

Thomas`,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSimulateSend = async () => {
    if (!generatedEmail) return
    setSent(true)
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Emails IA</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Génération et gestion des emails personnalisés
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg w-fit"
        style={{ background: 'var(--color-surface)' }}
      >
        {[
          { key: 'generate', label: 'Générateur IA' },
          { key: 'history', label: 'Historique' },
          { key: 'replies', label: 'Réponses' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className="px-4 py-1.5 rounded-md text-sm transition-all"
            style={{
              background: activeTab === tab.key ? 'var(--color-surface-2)' : 'transparent',
              color: activeTab === tab.key ? 'var(--color-text)' : 'var(--color-muted)',
              border: activeTab === tab.key ? '1px solid var(--color-border)' : '1px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Config panel */}
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h2 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <Zap size={15} style={{ color: 'var(--color-accent)' }} />
              Configuration
            </h2>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--color-muted)' }}>
                  Prospect cible
                </label>
                <select
                  value={selectedProspect.id}
                  onChange={e => setSelectedProspect(DEMO_PROSPECTS.find(p => p.id === e.target.value)!)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  {DEMO_PROSPECTS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.company} — {p.city}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs mb-1.5 block" style={{ color: 'var(--color-muted)' }}>
                  Type d&apos;email
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(EMAIL_TYPE_LABELS).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setEmailType(k as typeof emailType)}
                      className="px-3 py-2 rounded-lg text-xs transition-all text-left"
                      style={{
                        background: emailType === k ? 'var(--color-accent-glow)' : 'var(--color-surface-2)',
                        border: `1px solid ${emailType === k ? 'var(--color-accent-dim)' : 'var(--color-border)'}`,
                        color: emailType === k ? 'var(--color-accent)' : 'var(--color-muted)',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prospect info */}
              <div
                className="rounded-lg p-3"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
              >
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Contexte prospect
                </p>
                <div className="flex flex-col gap-1">
                  <InfoLine label="Ville" value={selectedProspect.city} />
                  <InfoLine label="Site web" value={selectedProspect.hasWebsite ? 'Oui' : 'Non'} />
                  <InfoLine label="Google Ads" value={selectedProspect.hasGoogleAds ? 'Actif' : 'Non'} />
                  {selectedProspect.googleRating && (
                    <InfoLine label="Note Google" value={`${selectedProspect.googleRating}/5 (${selectedProspect.googleReviews} avis)`} />
                  )}
                  <InfoLine label="Spécialités" value={selectedProspect.specialty.join(', ')} />
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80 flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: 'var(--color-accent)' }}
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                {loading ? 'Génération en cours…' : 'Générer avec l\'IA'}
              </button>
            </div>
          </div>

          {/* Email preview */}
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h2 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <Mail size={15} style={{ color: 'var(--color-accent)' }} />
              Aperçu email
            </h2>

            {error && (
              <div
                className="mb-3 px-3 py-2 rounded-lg text-xs"
                style={{ background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b40' }}
              >
                {error}
              </div>
            )}

            {!generatedEmail ? (
              <div
                className="flex flex-col items-center justify-center h-64 rounded-lg"
                style={{ background: 'var(--color-surface-2)', border: '1px dashed var(--color-border)' }}
              >
                <Mail size={32} style={{ color: 'var(--color-border)' }} className="mb-3" />
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  Sélectionnez un prospect et cliquez sur Générer
                </p>
              </div>
            ) : (
              <div>
                {/* Subject */}
                <div
                  className="px-3 py-2 rounded-lg mb-3"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                >
                  <p className="text-xs mb-0.5" style={{ color: 'var(--color-muted)' }}>Objet</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {generatedEmail.subject}
                  </p>
                </div>

                {/* Body */}
                <div
                  className="px-3 py-3 rounded-lg mb-4"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                >
                  <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Corps</p>
                  <pre
                    className="text-sm whitespace-pre-wrap font-sans leading-relaxed"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {generatedEmail.body}
                  </pre>
                </div>

                {/* Word count */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {generatedEmail.body.split(/\s+/).length} mots
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleGenerate}
                      className="p-1.5 rounded-lg"
                      style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
                      title="Regénérer"
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>

                {sent ? (
                  <div
                    className="flex items-center justify-center gap-2 py-2 rounded-lg text-sm"
                    style={{ background: '#22c55e20', color: '#22c55e' }}
                  >
                    <Check size={14} />
                    Email envoyé (simulation)
                  </div>
                ) : (
                  <button
                    onClick={handleSimulateSend}
                    className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-80 flex items-center justify-center gap-2"
                    style={{ background: '#22c55e' }}
                  >
                    <Send size={14} />
                    Simuler l&apos;envoi
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex flex-col gap-3">
          {DEMO_GENERATED_EMAILS.map(email => {
            const prospect = DEMO_PROSPECTS.find(p => p.id === email.prospectId)
            return (
              <div
                key={email.id}
                className="rounded-xl p-4"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {email.subject}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {prospect?.company} · {EMAIL_TYPE_LABELS[email.type]}
                    </p>
                  </div>
                  <EmailStatusBadge status={email.status} />
                </div>
                <div
                  className="mt-2 px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)' }}
                >
                  {email.body.split('\n')[2]}…
                </div>
                {email.status === 'replied' && (
                  <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: '#22c55e' }}>
                    <MessageSquare size={11} />
                    Réponse reçue
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'replies' && (
        <div className="flex flex-col gap-4">
          {DEMO_REPLIES.map(reply => {
            const prospect = DEMO_PROSPECTS.find(p => p.id === reply.prospectId)
            const cls = REPLY_LABELS[reply.classification]
            return (
              <div
                key={reply.id}
                className="rounded-xl p-5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {prospect?.company}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {prospect?.city}
                    </p>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: `${cls.color}20`, color: cls.color }}
                  >
                    {cls.label}
                  </span>
                </div>

                <div
                  className="px-3 py-2 rounded-lg mb-3 text-sm"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  &ldquo;{reply.content}&rdquo;
                </div>

                {reply.suggestedResponse && (
                  <div>
                    <p className="text-xs font-medium mb-1.5 flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
                      <Zap size={11} style={{ color: 'var(--color-accent)' }} />
                      Réponse suggérée par l&apos;IA
                    </p>
                    <div
                      className="px-3 py-2 rounded-lg text-xs"
                      style={{
                        background: 'var(--color-accent-glow)',
                        border: '1px solid var(--color-accent-dim)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <pre className="whitespace-pre-wrap font-sans">{reply.suggestedResponse}</pre>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                        style={{ background: 'var(--color-accent)' }}
                      >
                        Envoyer cette réponse
                      </button>
                      <button
                        className="px-3 py-1.5 rounded-lg text-xs"
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                      >
                        Modifier
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmailStatusBadge({ status }: { status: GeneratedEmail['status'] }) {
  const styles: Record<string, { bg: string; color: string; label: string; icon: React.ReactNode }> = {
    draft: { bg: '#6b6b8a20', color: '#6b6b8a', label: 'Brouillon', icon: <Clock size={11} /> },
    sent: { bg: '#6366f120', color: '#6366f1', label: 'Envoyé', icon: <Send size={11} /> },
    opened: { bg: '#f59e0b20', color: '#f59e0b', label: 'Ouvert', icon: <Eye size={11} /> },
    replied: { bg: '#22c55e20', color: '#22c55e', label: 'Réponse', icon: <MessageSquare size={11} /> },
  }
  const s = styles[status]
  return (
    <span
      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color }}
    >
      {s.icon}
      {s.label}
    </span>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  )
}
