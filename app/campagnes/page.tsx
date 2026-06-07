'use client'

import { useState } from 'react'
import { Pin, Check, Zap, MapPin, Globe, Mail, Users, Plus, Pause, Play, Trash2, X, TrendingUp, Activity, Flame } from 'lucide-react'

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
  'Bayonne', 'Chambéry', 'La Rochelle', 'Carcassonne',
]

const RAYONS = [10, 20, 30, 50]

// Capacité globale quotidienne (calculée depuis les boîtes mails connectées)
const DAILY_CAPACITY = 334

type Campaign = {
  id: string
  name: string
  metier: string
  zone: 'france' | 'ville'
  city?: string
  radius?: number
  percentage: number
  status: 'active' | 'paused'
  sent: number
  replied: number
  rdv: number
}

export default function CampagnesPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([
    { id: '1', name: 'Couvreurs — Toulouse & région', metier: 'couvreur', zone: 'ville', city: 'Toulouse', radius: 50, percentage: 70, status: 'active', sent: 68, replied: 12, rdv: 2 },
    { id: '2', name: 'Électriciens — Bordeaux', metier: 'electricien', zone: 'ville', city: 'Bordeaux', radius: 30, percentage: 10, status: 'active', sent: 24, replied: 3, rdv: 0 },
    { id: '3', name: 'Maçons — France', metier: 'macon', zone: 'france', percentage: 5, status: 'paused', sent: 8, replied: 1, rdv: 0 },
  ])

  const [showAddForm, setShowAddForm] = useState(false)
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    metier: 'couvreur',
    zone: 'ville' as 'france' | 'ville',
    city: 'Toulouse',
    radius: 30,
    percentage: 10,
  })
  const [cityQuery, setCityQuery] = useState('Toulouse')
  const [showCityDropdown, setShowCityDropdown] = useState(false)

  const totalAllocated = campaigns.filter(c => c.status === 'active').reduce((sum, c) => sum + c.percentage, 0)
  const available = Math.max(0, 100 - totalAllocated)
  const monthlyCapacity = DAILY_CAPACITY * 22

  const filteredCities = VILLES_FRANCE.filter(v => v.toLowerCase().startsWith(cityQuery.toLowerCase())).slice(0, 8)

  const updatePercentage = (id: string, pct: number) => {
    setCampaigns(campaigns.map(c => c.id === id ? { ...c, percentage: Math.max(0, Math.min(100, pct)) } : c))
  }

  const toggleStatus = (id: string) => {
    setCampaigns(campaigns.map(c => c.id === id ? { ...c, status: c.status === 'active' ? 'paused' : 'active' } : c))
  }

  const removeCampaign = (id: string) => {
    setCampaigns(campaigns.filter(c => c.id !== id))
  }

  const addCampaign = () => {
    if (totalAllocated + newCampaign.percentage > 100) return
    const metier = METIERS.find(m => m.id === newCampaign.metier)
    const zoneLabel = newCampaign.zone === 'france' ? 'France' : `${newCampaign.city} +${newCampaign.radius}km`
    setCampaigns([...campaigns, {
      id: String(Date.now()),
      name: newCampaign.name || `${metier?.label} — ${zoneLabel}`,
      metier: newCampaign.metier,
      zone: newCampaign.zone,
      city: newCampaign.city,
      radius: newCampaign.radius,
      percentage: newCampaign.percentage,
      status: 'active',
      sent: 0,
      replied: 0,
      rdv: 0,
    }])
    setNewCampaign({ name: '', metier: 'couvreur', zone: 'ville', city: 'Toulouse', radius: 30, percentage: 10 })
    setShowAddForm(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Campagnes</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            {campaigns.filter(c => c.status === 'active').length} actives
          </span>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            disabled={available === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            <Plus size={13} />
            Nouvelle campagne
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-4xl space-y-5">

          {/* Capacité globale */}
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-[10px] font-medium mb-3 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Capacité d&apos;envoi globale (calculée depuis vos boîtes mails)
            </p>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <Stat label="Capacité / jour" value={String(DAILY_CAPACITY)} sub="emails maximum" color="#3b82f6" icon={<Activity size={14} />} />
              <Stat label="Capacité / mois" value={monthlyCapacity.toLocaleString('fr-FR')} sub="22 jours ouvrés" color="#22c55e" icon={<Flame size={14} />} />
              <Stat label="Allocation utilisée" value={`${totalAllocated}%`} sub={`${Math.round(DAILY_CAPACITY * totalAllocated / 100)} emails/jour`} color="#f97316" icon={<TrendingUp size={14} />} />
              <Stat label="Disponible" value={`${available}%`} sub={`${Math.round(DAILY_CAPACITY * available / 100)} emails/jour`} color="#8b5cf6" icon={<Mail size={14} />} />
            </div>

            {/* Visualisation barre */}
            <AllocationBar campaigns={campaigns} available={available} />
          </div>

          {/* Liste des campagnes */}
          <div>
            <p className="text-[10px] font-medium mb-3 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Vos campagnes
            </p>
            <div className="space-y-2">
              {campaigns.length === 0 && (
                <div
                  className="rounded-lg px-4 py-8 text-center"
                  style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
                >
                  <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                    Aucune campagne. Créez-en une pour répartir votre capacité d&apos;envoi quotidienne.
                  </p>
                </div>
              )}
              {campaigns.map(c => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  onUpdate={pct => updatePercentage(c.id, pct)}
                  onToggle={() => toggleStatus(c.id)}
                  onRemove={() => removeCampaign(c.id)}
                />
              ))}
            </div>
          </div>

          {/* Formulaire nouvelle campagne */}
          {showAddForm && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-accent)' }}
            >
              <div
                className="px-5 py-3 flex items-center justify-between"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
              >
                <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                  Nouvelle campagne
                </p>
                <button onClick={() => setShowAddForm(false)} className="p-1 hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
                  <X size={15} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4" style={{ background: 'var(--color-surface)' }}>
                {/* Nom */}
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide mb-1.5 block" style={{ color: 'var(--color-muted)' }}>
                    Nom de la campagne
                  </label>
                  <input
                    type="text"
                    placeholder="Ex : Couvreurs — Toulouse printemps 2026"
                    value={newCampaign.name}
                    onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })}
                    className="w-full text-[12px] px-3 py-2 rounded outline-none"
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                  />
                </div>

                {/* Métier */}
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide mb-2 block" style={{ color: 'var(--color-muted)' }}>
                    Métier cible
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {METIERS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setNewCampaign({ ...newCampaign, metier: m.id })}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] transition-all"
                        style={{
                          background: newCampaign.metier === m.id
                            ? (m.pinned ? '#f59e0b' : 'var(--color-accent)')
                            : 'var(--color-surface-2)',
                          color: newCampaign.metier === m.id ? '#fff' : 'var(--color-muted)',
                          border: newCampaign.metier === m.id
                            ? `1px solid ${m.pinned ? '#f59e0b' : 'var(--color-accent)'}`
                            : '1px solid var(--color-border)',
                          fontWeight: newCampaign.metier === m.id ? 500 : 400,
                        }}
                      >
                        {m.pinned && <Pin size={9} />}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pourcentage */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      Allocation de la capacité
                    </label>
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-text)' }}>
                      <strong>{newCampaign.percentage}%</strong> · {Math.round(DAILY_CAPACITY * newCampaign.percentage / 100)} emails/jour · {Math.round(monthlyCapacity * newCampaign.percentage / 100).toLocaleString('fr-FR')}/mois
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={Math.min(100, available + newCampaign.percentage)}
                    value={newCampaign.percentage}
                    onChange={e => setNewCampaign({ ...newCampaign, percentage: Number(e.target.value) })}
                    className="w-full"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                  <div className="flex items-center justify-between mt-1 text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                    <span>1%</span>
                    <span>Disponible : {available}%</span>
                    <span>{Math.min(100, available + newCampaign.percentage)}%</span>
                  </div>
                </div>

                {/* Zone */}
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide mb-2 block" style={{ color: 'var(--color-muted)' }}>
                    Zone géographique
                  </label>
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setNewCampaign({ ...newCampaign, zone: 'france' })}
                      className="flex items-center gap-2 px-3 py-2 rounded text-[12px] flex-1 transition-all"
                      style={{
                        background: newCampaign.zone === 'france' ? 'var(--color-accent)' : 'var(--color-surface-2)',
                        color: newCampaign.zone === 'france' ? '#fff' : 'var(--color-muted)',
                        border: newCampaign.zone === 'france' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      }}
                    >
                      <Globe size={13} />
                      France entière
                    </button>
                    <button
                      onClick={() => setNewCampaign({ ...newCampaign, zone: 'ville' })}
                      className="flex items-center gap-2 px-3 py-2 rounded text-[12px] flex-1 transition-all"
                      style={{
                        background: newCampaign.zone === 'ville' ? 'var(--color-accent)' : 'var(--color-surface-2)',
                        color: newCampaign.zone === 'ville' ? '#fff' : 'var(--color-muted)',
                        border: newCampaign.zone === 'ville' ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      }}
                    >
                      <MapPin size={13} />
                      Ville spécifique
                    </button>
                  </div>

                  {newCampaign.zone === 'ville' && (
                    <div className="flex gap-3">
                      <div className="flex-1 relative">
                        <input
                          type="text"
                          value={cityQuery}
                          onChange={e => { setCityQuery(e.target.value); setShowCityDropdown(true) }}
                          onFocus={() => setShowCityDropdown(true)}
                          onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
                          placeholder="Rechercher une ville..."
                          className="w-full text-[12px] px-3 py-2 rounded outline-none"
                          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
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
                                onMouseDown={() => { setNewCampaign({ ...newCampaign, city: v }); setCityQuery(v); setShowCityDropdown(false) }}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {RAYONS.map(r => (
                          <button
                            key={r}
                            onClick={() => setNewCampaign({ ...newCampaign, radius: r })}
                            className="px-2.5 py-2 rounded text-[11px] transition-all"
                            style={{
                              background: newCampaign.radius === r ? 'var(--color-accent)' : 'var(--color-surface-2)',
                              color: newCampaign.radius === r ? '#fff' : 'var(--color-muted)',
                              border: newCampaign.radius === r ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                            }}
                          >
                            {r} km
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className="px-5 py-3 flex items-center justify-between"
                style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}
              >
                <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                  L&apos;agent enverra automatiquement {Math.round(DAILY_CAPACITY * newCampaign.percentage / 100)} emails/jour pour cette campagne (9h-17h30, lun-ven).
                </p>
                <button
                  onClick={addCampaign}
                  disabled={!newCampaign.percentage || (totalAllocated + newCampaign.percentage > 100)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-[12px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--color-accent)', color: '#fff' }}
                >
                  <Zap size={12} />
                  Lancer la campagne
                </button>
              </div>
            </div>
          )}

          {/* Aide */}
          <div
            className="rounded-lg p-3 flex gap-2.5"
            style={{ background: '#3b82f608', border: '1px solid #3b82f630' }}
          >
            <Activity size={14} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
              <p className="font-semibold mb-0.5">Comment ça marche</p>
              <p style={{ color: 'var(--color-muted)' }}>
                Vous répartissez votre capacité d&apos;envoi quotidienne (calculée depuis vos boîtes mails) entre plusieurs campagnes en pourcentage. La capacité augmente au fil du warmup, donc les volumes par campagne suivent automatiquement. Total maximum : 100%.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5" style={{ color }}>{icon}</div>
      <p className="text-[18px] font-semibold leading-none" style={{ color: 'var(--color-text)' }}>{value}</p>
      <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>{sub}</p>
    </div>
  )
}

function AllocationBar({ campaigns, available }: { campaigns: Campaign[]; available: number }) {
  const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16']
  const active = campaigns.filter(c => c.status === 'active')
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
        {active.map((c, i) => (
          <div
            key={c.id}
            style={{ width: `${c.percentage}%`, background: COLORS[i % COLORS.length] }}
            title={`${c.name} : ${c.percentage}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
        {active.map((c, i) => {
          const metier = METIERS.find(m => m.id === c.metier)
          return (
            <div key={c.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-[11px]" style={{ color: 'var(--color-text)' }}>
                {metier?.label} <span style={{ color: 'var(--color-muted)' }}>· {c.percentage}%</span>
              </span>
            </div>
          )
        })}
        {available > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }} />
            <span className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
              Disponible · {available}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function CampaignRow({ campaign, onUpdate, onToggle, onRemove }: { campaign: Campaign; onUpdate: (pct: number) => void; onToggle: () => void; onRemove: () => void }) {
  const metier = METIERS.find(m => m.id === campaign.metier)
  const dailyEmails = Math.round(DAILY_CAPACITY * campaign.percentage / 100)
  const monthlyEmails = dailyEmails * 22

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-4 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{campaign.name}</p>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 flex-shrink-0"
              style={{
                background: campaign.status === 'active' ? '#22c55e15' : '#52525215',
                color: campaign.status === 'active' ? '#22c55e' : '#737373',
              }}
            >
              <span className={`w-1 h-1 rounded-full ${campaign.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
              {campaign.status === 'active' ? 'Active' : 'Pause'}
            </span>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {metier?.label} · {campaign.zone === 'france' ? 'France entière' : `${campaign.city} +${campaign.radius} km`} · {campaign.sent} envoyés · {campaign.replied} réponses · {campaign.rdv} RDV
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-[14px] font-semibold tabular-nums leading-none" style={{ color: 'var(--color-text)' }}>{campaign.percentage}%</p>
            <p className="text-[10px] tabular-nums" style={{ color: 'var(--color-muted-2)' }}>{dailyEmails}/j · {monthlyEmails.toLocaleString('fr-FR')}/mois</p>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-black/20 transition-colors"
            style={{ color: 'var(--color-muted)' }}
            title={campaign.status === 'paused' ? 'Reprendre' : 'Mettre en pause'}
          >
            {campaign.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-black/20 transition-colors"
            style={{ color: 'var(--color-muted-2)' }}
            title="Supprimer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Slider */}
      <div className="px-4 pb-3">
        <input
          type="range"
          min={0}
          max={100}
          value={campaign.percentage}
          onChange={e => onUpdate(Number(e.target.value))}
          className="w-full h-1"
          style={{ accentColor: 'var(--color-accent)' }}
        />
      </div>
    </div>
  )
}
