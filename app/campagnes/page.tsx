'use client'

import { Plus } from 'lucide-react'

const SEQUENCE_STEPS = [
  { tag: 'J0',   label: 'Email initial',  desc: 'Accroche personnalisée selon le profil prospect' },
  { tag: 'J+2',  label: 'Relance 1',      desc: 'Courte, directe — ne pas répéter le premier message' },
  { tag: 'J+5',  label: 'Relance 2',      desc: 'Apporter un élément de valeur ou preuve sociale' },
  { tag: 'J+10', label: 'Relance finale', desc: 'Clôture propre, porte ouverte' },
]

export default function CampagnesPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="px-8 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium"
          style={{ background: 'var(--color-accent)', color: '#fff' }}
        >
          <Plus size={12} />
          Nouvelle campagne
        </button>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 max-w-4xl">
        {/* Sequence */}
        <div className="mb-8">
          <p className="text-xs font-medium mb-4" style={{ color: 'var(--color-muted)' }}>
            SEQUENCE AUTOMATIQUE
          </p>
          <div className="flex items-stretch gap-0">
            {SEQUENCE_STEPS.map((step, i) => (
              <div key={i} className="flex items-stretch gap-0 flex-1">
                <div
                  className="flex-1 rounded-lg p-4"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <span className="text-xs font-mono mb-2 block" style={{ color: 'var(--color-accent)' }}>
                    {step.tag}
                  </span>
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                    {step.label}
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                    {step.desc}
                  </p>
                </div>
                {i < SEQUENCE_STEPS.length - 1 && (
                  <div className="flex items-center px-2" style={{ color: 'var(--color-border)' }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Campaigns list */}
        <div>
          <p className="text-xs font-medium mb-4" style={{ color: 'var(--color-muted)' }}>
            CAMPAGNES
          </p>
          <div
            className="rounded-lg py-16 text-center"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
          >
            <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>
              Aucune campagne
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted-2)' }}>
              Creez une campagne pour commencer a envoyer des sequences
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
