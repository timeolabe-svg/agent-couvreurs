'use client'

import { useState } from 'react'
import { Pin, ChevronDown, Check, Zap, MapPin, Globe, Mail, Users } from 'lucide-react'

const METIERS = [
  { id: 'couvreur',      label: 'Couvreur',                pinned: true },
  { id: 'macon',         label: 'Maçon / Gros œuvre',      pinned: false },
  { id: 'plombier',      label: 'Plombier / Chauffagiste',  pinned: false },
  { id: 'electricien',   label: 'Électricien',              pinned: false },
  { id: 'menuisier',     label: 'Menuisier / Charpentier',  pinned: false },
  { id: 'peintre',       label: 'Peintre / Décorateur',     pinned: false },
  { id: 'carreleur',     label: 'Carreleur / Sol',          pinned: false },
  { id: 'platrier',      label: 'Plâtrier / Plaquiste',     pinned: false },
  { id: 'facadier',      label: 'Façadier / Ravalement',    pinned: false },
  { id: 'isolation',     label: 'Isolation / ITE',          pinned: false },
  { id: 'terrassement',  label: 'Terrassement / VRD',       pinned: false },
  { id: 'vitrier',       label: 'Vitrier / Miroitier',      pinned: false },
  { id: 'serrurier',     label: 'Serrurier / Métallier',    pinned: false },
  { id: 'cuisiniste',    label: 'Cuisiniste',               pinned: false },
  { id: 'clim',          label: 'Climatisation / Froid',    pinned: false },
  { id: 'piscine',       label: 'Pisciniste',               pinned: false },
  { id: 'demolition',    label: 'Démolition / Désamiantage',pinned: false },
  { id: 'ascenseur',     label: 'Ascensoriste',             pinned: false },
]

const VILLES_FRANCE = [
  'Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg',
  'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Saint-Étienne',
  'Le Havre', 'Toulon', 'Grenoble', 'Dijon', 'Angers', 'Nîmes', 'Brest',
  'Tours', 'Limoges', 'Amiens', 'Annecy', 'Perpignan', 'Metz', 'Besançon',
  'Orléans', 'Rouen', 'Mulhouse', 'Caen', 'Nancy', 'Avignon', 'Poitiers',
  'Calais', 'Pau', 'Dunkerque', 'Clermont-Ferrand', 'Aix-en-Provence',
  'Valenciennes', 'Cannes', 'Béziers', 'Colmar', 'Troyes', 'Lorient',
  'Bayonne', 'Chambéry', 'Quimper', 'La Rochelle', 'Angoulême', 'Chartres',
  'Niort', 'Laval', 'Belfort', 'Blois', 'Saint-Malo', 'Évreux', 'Ajaccio',
  'Aurillac', 'Bourg-en-Bresse', 'Châlons-en-Champagne', 'Carcassonne',
]

const EMAIL_VOLUMES = [25, 50, 100, 200, 500]
const RAYONS = [10, 20, 30, 50]

function estimateLeads(sector: string, zone: 'france' | 'ville', city: string, radius: number, volume: number) {
  const base = zone === 'france' ? 4200 : Math.round(radius * radius * 0.18)
  return Math.min(base, volume * 8)
}

export default function CampagnesPage() {
  const [sector, setSector] = useState('couvreur')
  const [volume, setVolume] = useState(100)
  const [zone, setZone] = useState<'france' | 'ville'>('france')
  const [city, setCity] = useState('Toulouse')
  const [radius, setRadius] = useState(30)
  const [cityQuery, setCityQuery] = useState('Toulouse')
  const [showCityDropdown, setShowCityDropdown] = useState(false)
  const [launched, setLaunched] = useState(false)
  const [campaignName, setCampaignName] = useState('')

  const selectedMetier = METIERS.find(m => m.id === sector)
  const estimatedLeads = estimateLeads(sector, zone, city, radius, volume)
  const filteredCities = VILLES_FRANCE.filter(v => v.toLowerCase().startsWith(cityQuery.toLowerCase())).slice(0, 8)

  const activeCampaigns = [
    { name: 'Couvreurs — Toulouse & région', sector: 'Couvreur', zone: 'Toulouse +50 km', sent: 68, replied: 12, rdv: 2, status: 'active' },
  ]

  if (launched) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 h-14 flex items-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: '#22c55e15', border: '1px solid #22c55e30' }}>
              <Check size={20} style={{ color: '#22c55e' }} />
            </div>
            <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Campagne lancée</p>
            <p className="text-[12px] mb-1" style={{ color: 'var(--color-muted)' }}>
              {campaignName || `${selectedMetier?.label} — ${zone === 'france' ? 'France entière' : `${city} +${radius} km`}`}
            </p>
            <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
              {volume} emails · ~{estimatedLeads} leads ciblés · Agent démarre dans quelques minutes
            </p>
            <button
              className="mt-6 text-[12px] px-4 py-2 rounded"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
              onClick={() => setLaunched(false)}
            >
              Créer une autre campagne
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl space-y-5">

          {/* Campagnes actives */}
          <div>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>CAMPAGNES ACTIVES</p>
            {activeCampaigns.map((c, i) => (
              <div key={i} className="rounded-lg p-4 flex items-center justify-between"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div>
                  <p className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>{c.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {c.sent} envoyés · {c.replied} réponses · {c.rdv} RDV
                  </p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
                  style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  Active
                </div>
              </div>
            ))}
          </div>

          {/* Créer une campagne */}
          <div>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>NOUVELLE CAMPAGNE</p>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>

              {/* Nom de la campagne */}
              <div className="px-5 py-4" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-muted)' }}>NOM DE LA CAMPAGNE</p>
                <input
                  type="text"
                  placeholder="Ex : Couvreurs — Toulouse printemps 2026"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  className="w-full text-[12px] px-3 py-2 rounded outline-none"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              {/* Secteur */}
              <div className="px-5 py-4" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>
                  MÉTIER CIBLE — BÂTIMENT & TRAVAUX
                </p>
                <div className="flex flex-wrap gap-2">
                  {METIERS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSector(m.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] transition-all"
                      style={{
                        background: sector === m.id
                          ? (m.pinned ? '#f59e0b' : 'var(--color-accent)')
                          : 'var(--color-surface-2)',
                        color: sector === m.id ? '#fff' : 'var(--color-muted)',
                        border: sector === m.id
                          ? `1px solid ${m.pinned ? '#f59e0b' : 'var(--color-accent)'}`
                          : '1px solid var(--color-border)',
                        fontWeight: sector === m.id ? 500 : 400,
                      }}
                    >
                      {m.pinned && <Pin size={10} />}
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume */}
              <div className="px-5 py-4" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>
                  NOMBRE D'EMAILS À ENVOYER
                </p>
                <div className="flex gap-2">
                  {EMAIL_VOLUMES.map(v => (
                    <button
                      key={v}
                      onClick={() => setVolume(v)}
                      className="flex-1 py-2.5 rounded text-[13px] font-medium transition-all"
                      style={{
                        background: volume === v ? 'var(--color-accent)' : 'var(--color-surface-2)',
                        color: volume === v ? '#fff' : 'var(--color-muted)',
                        border: volume === v ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Zone géographique */}
              <div className="px-5 py-4" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-medium mb-3" style={{ color: 'var(--color-muted)' }}>ZONE GÉOGRAPHIQUE</p>
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={() => setZone('france')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded text-[12px] flex-1 transition-all"
                    style={{
                      background: zone === 'france' ? 'var(--color-accent)' : 'var(--color-surface-2)',
                      color: zone === 'france' ? '#fff' : 'var(--color-muted)',
                      border: zone === 'france' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                    }}
                  >
                    <Globe size={14} />
                    France entière
                  </button>
                  <button
                    onClick={() => setZone('ville')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded text-[12px] flex-1 transition-all"
                    style={{
                      background: zone === 'ville' ? 'var(--color-accent)' : 'var(--color-surface-2)',
                      color: zone === 'ville' ? '#fff' : 'var(--color-muted)',
                      border: zone === 'ville' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                    }}
                  >
                    <MapPin size={14} />
                    Ville spécifique
                  </button>
                </div>

                {zone === 'ville' && (
                  <div className="flex gap-3 mt-3">
                    {/* City autocomplete */}
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={cityQuery}
                        onChange={e => { setCityQuery(e.target.value); setShowCityDropdown(true) }}
                        onFocus={() => setShowCityDropdown(true)}
                        onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
                        placeholder="Rechercher une ville..."
                        className="w-full text-[12px] px-3 py-2 rounded outline-none"
                        style={{
                          background: 'var(--color-surface-2)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text)',
                        }}
                      />
                      {showCityDropdown && filteredCities.length > 0 && (
                        <div
                          className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-10"
                          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px #00000040' }}
                        >
                          {filteredCities.map(v => (
                            <button
                              key={v}
                              className="w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--color-surface-2)] transition-colors"
                              style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}
                              onMouseDown={() => { setCity(v); setCityQuery(v); setShowCityDropdown(false) }}
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Rayon */}
                    <div>
                      <p className="text-[10px] mb-1.5" style={{ color: 'var(--color-muted-2)' }}>Rayon</p>
                      <div className="flex gap-1.5">
                        {RAYONS.map(r => (
                          <button
                            key={r}
                            onClick={() => setRadius(r)}
                            className="px-2.5 py-1.5 rounded text-[11px] transition-all"
                            style={{
                              background: radius === r ? 'var(--color-accent)' : 'var(--color-surface-2)',
                              color: radius === r ? '#fff' : 'var(--color-muted)',
                              border: radius === r ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                            }}
                          >
                            {r} km
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Résumé + lancement */}
              <div className="px-5 py-4 flex items-center justify-between"
                style={{ background: 'var(--color-surface)' }}>
                <div>
                  <div className="flex items-center gap-4 text-[12px]">
                    <span className="flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                      <Mail size={12} />
                      <strong style={{ color: 'var(--color-text)' }}>{volume}</strong> emails
                    </span>
                    <span className="flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                      <Users size={12} />
                      ~<strong style={{ color: 'var(--color-text)' }}>{estimatedLeads}</strong> leads disponibles
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>
                      {selectedMetier?.label} · {zone === 'france' ? 'France entière' : `${city} +${radius} km`}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                    Envoi échelonné — l'agent gère les relances et les réponses automatiquement
                  </p>
                </div>
                <button
                  onClick={() => setLaunched(true)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded text-[13px] font-medium transition-all"
                  style={{ background: 'var(--color-accent)', color: '#fff', border: '1px solid var(--color-accent)' }}
                >
                  <Zap size={13} />
                  Lancer la campagne
                </button>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
