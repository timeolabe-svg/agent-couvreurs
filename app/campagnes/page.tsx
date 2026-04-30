import { Zap } from 'lucide-react'

const SEQUENCE = [
  { tag: 'J0',   label: 'Email initial',  desc: 'Audit digital du prospect — cite un signal précis : pas de site, mauvais score mobile, absent sur Google Ads...' },
  { tag: 'J+2',  label: 'Relance 1',      desc: 'Chiffre concret : volume de recherches locales sur leur secteur, position des concurrents' },
  { tag: 'J+5',  label: 'Relance 2',      desc: 'Offre d\'audit gratuit ou preuve sociale sur un profil similaire (même secteur, même ville)' },
  { tag: 'J+10', label: 'Relance finale', desc: 'Clôture propre — porte ouverte pour plus tard' },
]

const SERVICES = [
  { label: 'Création site vitrine', angle: 'Vous n\'apparaissez pas sur Google — sans site, vous perdez des clients chaque jour' },
  { label: 'Refonte site', angle: 'Votre site met 9 secondes à charger sur mobile — Google vous pénalise dans les résultats' },
  { label: 'SEO local', angle: 'Vos concurrents sont en position 1 sur "votre-métier Toulouse" — vous êtes en page 2' },
  { label: 'Google Ads', angle: 'Les 3 premières annonces sur votre secteur sont vos concurrents — vous ne captez pas ce trafic' },
  { label: 'Fiche Google', angle: 'Votre fiche GMB est incomplète — vous perdez de la visibilité locale' },
  { label: 'Community management', angle: 'Vous avez 8 avis Google, votre concurrent en a 94' },
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

      <div className="flex-1 overflow-auto px-6 py-5 max-w-4xl">

        {/* Active campaign */}
        <div className="mb-6">
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>CAMPAGNE EN COURS</p>
          <div
            className="rounded-lg p-4 flex items-center justify-between"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div>
              <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>
                PME/TPE — Toulouse &amp; Occitanie
              </p>
              <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                Artisans · Commerces · Services · Restaurants · Professions libérales
              </p>
            </div>
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
              style={{ background: '#22c55e15', color: '#22c55e' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Active
            </div>
          </div>
        </div>

        {/* Email angles by service */}
        <div className="mb-6">
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>ANGLES PAR SERVICE HDIGIWEB</p>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {SERVICES.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-4 px-4 py-3"
                style={{
                  background: 'var(--color-surface)',
                  borderBottom: i < SERVICES.length - 1 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                <span
                  className="text-[11px] px-2 py-0.5 rounded flex-shrink-0 mt-0.5"
                  style={{ background: '#3b82f615', color: '#3b82f6', border: '1px solid #3b82f630' }}
                >
                  {s.label}
                </span>
                <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>{s.angle}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sequence */}
        <div>
          <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>SÉQUENCE AUTOMATIQUE</p>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--color-border)' }}
          >
            {SEQUENCE.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-4 px-4 py-3"
                style={{
                  background: 'var(--color-surface)',
                  borderBottom: i < SEQUENCE.length - 1 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                <span className="text-[11px] font-mono w-10 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }}>
                  {s.tag}
                </span>
                <div>
                  <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>{s.label}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{s.desc}</p>
                </div>
                <Zap size={12} className="ml-auto flex-shrink-0 mt-0.5" style={{ color: 'var(--color-muted-2)' }} />
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
