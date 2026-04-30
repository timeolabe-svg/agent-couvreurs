import { Settings, Mail, Zap } from 'lucide-react'

const SEQUENCE = [
  { tag: 'J0',   label: 'Email initial',  desc: 'Personnalise selon profil — ville, specialite, presence digitale' },
  { tag: 'J+2',  label: 'Relance 1',      desc: 'Courte, contextualisee. Pas de copier-coller' },
  { tag: 'J+5',  label: 'Relance 2',      desc: 'Element de valeur ou preuve sociale' },
  { tag: 'J+10', label: 'Relance finale', desc: 'Cloture propre. Porte ouverte' },
]

export default function CampagnesPage() {
  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5 max-w-3xl">
        <div className="mb-6">
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>SEQUENCE EN COURS</p>
          <div
            className="rounded-lg p-4 flex items-start gap-3"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div>
              <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>
                Couvreurs France
              </p>
              <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                France entiere · 3 leads actifs · Agent actif
              </p>
            </div>
            <div
              className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded text-[11px] flex-shrink-0"
              style={{ background: '#22c55e15', color: '#22c55e' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Active
            </div>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>SEQUENCE AUTOMATIQUE</p>
          <div className="flex flex-col gap-px" style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
            {SEQUENCE.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3"
                style={{ background: 'var(--color-surface)' }}
              >
                <span
                  className="text-[11px] font-mono w-10 flex-shrink-0"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {s.tag}
                </span>
                <div className="flex-1">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{s.label}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{s.desc}</p>
                </div>
                <Zap size={12} style={{ color: 'var(--color-muted-2)', flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>CONFIGURATION ENVOI</p>
          <div
            className="rounded-lg p-4 flex flex-col gap-3"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            {[
              { label: 'Max emails / jour / boite', value: '25' },
              { label: 'Warmup actif', value: 'Oui' },
              { label: 'Rotation boites', value: 'A configurer' },
              { label: 'Domaine expediteur', value: 'A configurer' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{r.label}</span>
                <span className="text-[12px]" style={{ color: 'var(--color-text)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
