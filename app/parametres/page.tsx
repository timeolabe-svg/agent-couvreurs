'use client'

import { useState, useEffect } from 'react'
import {
  Building2,
  Mail,
  RotateCcw,
  CalendarClock,
  FlaskConical,
  Save,
  Image as ImageIcon,
  Phone,
  Globe,
  Link2,
  MapPin,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Check,
  Briefcase,
  Handshake,
  Smile,
  ShieldCheck,
  ShieldAlert,
  Server,
  Activity,
  Pause,
  Play,
  X,
  AlertCircle,
  Copy,
  Flame,
} from 'lucide-react'

type Tab = 'agence' | 'email' | 'sequence' | 'rdv' | 'mode'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'agence',   label: 'Mon agence',         icon: Building2 },
  { id: 'email',    label: 'Configuration Email', icon: Mail },
  { id: 'sequence', label: 'Séquence de relance', icon: RotateCcw },
  { id: 'rdv',      label: 'Prise de RDV',        icon: CalendarClock },
  { id: 'mode',     label: 'Mode Test / Prod',    icon: FlaskConical },
]

export default function ParametresPage() {
  const [tab, setTab] = useState<Tab>('agence')
  const [saved, setSaved] = useState(false)
  const [saveSignal, setSaveSignal] = useState(0)

  const handleSave = () => {
    setSaveSignal(s => s + 1)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Paramètres</h1>
          <span
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            Configuration agent
          </span>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90"
          style={{ background: saved ? '#22c55e' : 'var(--color-accent)', color: '#fff' }}
        >
          {saved ? <><Check size={13} /> Enregistré</> : <><Save size={13} /> Sauvegarder</>}
        </button>
      </div>

      {/* Tabs */}
      <div
        className="px-6 flex items-center gap-1 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-2 px-3 py-2.5 text-[12px] transition-colors relative"
              style={{
                color: active ? 'var(--color-accent)' : 'var(--color-muted)',
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon size={13} />
              {label}
              {active && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5"
                  style={{ background: 'var(--color-accent)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl">
          {tab === 'agence' && <AgenceTab saveSignal={saveSignal} />}
          {tab === 'email' && <EmailTab />}
          {tab === 'sequence' && <SequenceTab />}
          {tab === 'rdv' && <RdvTab />}
          {tab === 'mode' && <ModeTab saveSignal={saveSignal} />}
        </div>
      </div>
    </div>
  )
}

// ─── TAB : MON AGENCE ─────────────────────────────────────────────────────
function AgenceTab({ saveSignal }: { saveSignal: number }) {
  const [agence, setAgence] = useState({
    nom: 'Hdigiweb',
    telephone: '06 12 34 56 78',
    email: 'thomas@hdigiweb.fr',
    site: 'https://hdigiweb.fr',
    linkedin: '',
    adresse: '12 rue de Metz, 31000 Toulouse',
  })

  // Load settings from API on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const s = data.settings ?? {}
        setAgence(prev => ({
          nom: s.agence_nom ?? prev.nom,
          telephone: s.agence_telephone ?? prev.telephone,
          email: s.agence_email ?? prev.email,
          site: s.agence_site ?? prev.site,
          linkedin: s.agence_linkedin ?? prev.linkedin,
          adresse: s.agence_adresse ?? prev.adresse,
        }))
      })
      .catch(() => {})
  }, [])

  // Watch saveSignal to persist
  useEffect(() => {
    if (saveSignal === 0) return
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { key: 'agence_nom', value: agence.nom },
        { key: 'agence_telephone', value: agence.telephone },
        { key: 'agence_email', value: agence.email },
        { key: 'agence_site', value: agence.site },
        { key: 'agence_linkedin', value: agence.linkedin },
        { key: 'agence_adresse', value: agence.adresse },
      ]),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignal])

  return (
    <div className="space-y-5">
      <SectionTitle title="Logo de l'agence" />
      <div className="flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
        >
          <ImageIcon size={20} style={{ color: 'var(--color-muted)' }} />
        </div>
        <button
          className="flex items-center gap-2 px-3 py-2 rounded text-[12px] transition-colors hover:opacity-80"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          <ImageIcon size={13} />
          Choisir une image
        </button>
        <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
          PNG, JPG ou SVG · max 500 Ko
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Nom de l'agence" value={agence.nom} onChange={v => setAgence({ ...agence, nom: v })} />
        <Field label="Téléphone" value={agence.telephone} onChange={v => setAgence({ ...agence, telephone: v })} icon={<Phone size={12} />} />
        <Field label="Email de contact" value={agence.email} onChange={v => setAgence({ ...agence, email: v })} type="email" icon={<Mail size={12} />} />
        <Field label="Site web" value={agence.site} onChange={v => setAgence({ ...agence, site: v })} icon={<Globe size={12} />} />
      </div>
      <Field label="LinkedIn" value={agence.linkedin} onChange={v => setAgence({ ...agence, linkedin: v })} placeholder="https://www.linkedin.com/in/votre-profil" icon={<Link2 size={12} />} />
      <Field label="Adresse" value={agence.adresse} onChange={v => setAgence({ ...agence, adresse: v })} icon={<MapPin size={12} />} />

      <div
        className="rounded-lg p-4 mt-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <p className="text-[10px] font-medium mb-3 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Aperçu de la signature
        </p>
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-accent)' }}
          >
            <span className="text-[14px] font-bold text-white">H</span>
          </div>
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
            <p className="font-semibold">{agence.nom}</p>
            {agence.telephone && (
              <p className="flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--color-muted)' }}>
                <Phone size={10} style={{ color: '#ef4444' }} />
                {agence.telephone}
              </p>
            )}
            {agence.email && (
              <p className="flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                <Mail size={10} style={{ color: 'var(--color-accent)' }} />
                {agence.email}
              </p>
            )}
            {agence.site && (
              <p className="flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                <Globe size={10} style={{ color: 'var(--color-muted)' }} />
                {agence.site}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── TAB : CONFIGURATION EMAIL ────────────────────────────────────────────
type Inbox = {
  id: string
  email: string
  status: 'warmup' | 'active' | 'paused'
  dailySent: number
  dailyLimit: number
  health: number // 0-100
  warmupDay?: number
}

type Domain = {
  domain: string
  spf: boolean
  dkim: boolean
  dmarc: boolean
  inboxCount: number
}

function EmailTab() {
  const [inboxes, setInboxes] = useState<Inbox[]>([
    { id: '1', email: 'thomas@hdigiweb-conseil.fr',  status: 'active',  dailySent: 32, dailyLimit: 35, health: 94 },
    { id: '2', email: 'contact@hdigiweb-conseil.fr', status: 'active',  dailySent: 28, dailyLimit: 35, health: 91 },
    { id: '3', email: 'audit@hdigiweb-conseil.fr',   status: 'active',  dailySent: 30, dailyLimit: 35, health: 89 },
    { id: '4', email: 'thomas@hdigiweb-pro.fr',      status: 'active',  dailySent: 33, dailyLimit: 35, health: 96 },
    { id: '5', email: 'contact@hdigiweb-pro.fr',     status: 'warmup',  dailySent: 12, dailyLimit: 15, health: 78, warmupDay: 12 },
    { id: '6', email: 'audit@hdigiweb-pro.fr',       status: 'warmup',  dailySent: 8,  dailyLimit: 10, health: 72, warmupDay: 8 },
    { id: '7', email: 'thomas@go-hdigiweb.fr',       status: 'paused',  dailySent: 0,  dailyLimit: 35, health: 65 },
  ])

  const [showAddModal, setShowAddModal] = useState(false)
  const [showDnsModal, setShowDnsModal] = useState<string | null>(null)

  const domains: Domain[] = (() => {
    const map: Record<string, Domain> = {}
    inboxes.forEach(i => {
      const dom = i.email.split('@')[1]
      if (!map[dom]) {
        map[dom] = { domain: dom, spf: true, dkim: true, dmarc: dom !== 'go-hdigiweb.fr', inboxCount: 0 }
      }
      map[dom].inboxCount++
    })
    return Object.values(map)
  })()

  const totalDaily = inboxes.filter(i => i.status !== 'paused').reduce((sum, i) => sum + i.dailyLimit, 0)
  const monthlyCapacity = totalDaily * 22 // 22 jours ouvrés

  const removeInbox = (id: string) => {
    setInboxes(inboxes.filter(i => i.id !== id))
  }

  const toggleInboxStatus = (id: string) => {
    setInboxes(inboxes.map(i => i.id === id ? { ...i, status: i.status === 'paused' ? 'active' : 'paused' } : i))
  }

  return (
    <div className="space-y-6">
      {/* Capacité d'envoi */}
      <div
        className="rounded-lg p-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <p className="text-[10px] font-medium mb-3 uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Capacité d&apos;envoi globale
        </p>
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Boîtes connectées" value={String(inboxes.length)} sub={`${inboxes.filter(i => i.status === 'active').length} actives`} color="#3b82f6" icon={<Mail size={14} />} />
          <Stat label="Domaines" value={String(domains.length)} sub={`${domains.filter(d => d.spf && d.dkim && d.dmarc).length} bien configurés`} color="#8b5cf6" icon={<Globe size={14} />} />
          <Stat label="Volume / jour" value={String(totalDaily)} sub="emails maximum" color="#f97316" icon={<Activity size={14} />} />
          <Stat label="Volume / mois" value={monthlyCapacity.toLocaleString('fr-FR')} sub="22 jours ouvrés" color="#22c55e" icon={<Flame size={14} />} />
        </div>
      </div>

      {/* Boîtes mails connectées */}
      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <SectionTitle title="Boîtes mails connectées" />
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
              Limite recommandée : 35 emails/jour par boîte. Au-delà, risque de spam.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            <Plus size={13} />
            Ajouter une boîte
          </button>
        </div>

        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div
            className="grid grid-cols-[1fr_110px_140px_120px_70px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wide"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}
          >
            <div>Email</div>
            <div>Statut</div>
            <div>Volume jour</div>
            <div>Santé</div>
            <div className="text-right">Actions</div>
          </div>

          {inboxes.map((inbox, i) => (
            <div
              key={inbox.id}
              className="grid grid-cols-[1fr_110px_140px_120px_70px] gap-3 px-4 py-3 items-center"
              style={{
                background: 'var(--color-surface)',
                borderBottom: i === inboxes.length - 1 ? undefined : '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Mail size={13} style={{ color: 'var(--color-muted-2)' }} />
                <span className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{inbox.email}</span>
              </div>

              <StatusBadge status={inbox.status} warmupDay={inbox.warmupDay} />

              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(inbox.dailySent / inbox.dailyLimit) * 100}%`,
                      background: inbox.dailySent / inbox.dailyLimit > 0.9 ? '#f97316' : '#3b82f6',
                    }}
                  />
                </div>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-muted)' }}>
                  {inbox.dailySent}/{inbox.dailyLimit}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background:
                      inbox.health >= 90 ? '#22c55e' :
                      inbox.health >= 75 ? '#f59e0b' :
                      '#ef4444',
                  }}
                />
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-text)' }}>
                  {inbox.health}/100
                </span>
              </div>

              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => toggleInboxStatus(inbox.id)}
                  className="p-1.5 rounded hover:bg-black/20 transition-colors"
                  style={{ color: 'var(--color-muted)' }}
                  title={inbox.status === 'paused' ? 'Reprendre' : 'Mettre en pause'}
                >
                  {inbox.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}
                </button>
                <button
                  onClick={() => removeInbox(inbox.id)}
                  className="p-1.5 rounded hover:bg-black/20 transition-colors"
                  style={{ color: 'var(--color-muted-2)' }}
                  title="Supprimer"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Domaines & DNS */}
      <div>
        <div className="mb-3">
          <SectionTitle title="Domaines & configuration DNS" />
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
            SPF, DKIM et DMARC sont obligatoires pour ne pas finir en spam.
          </p>
        </div>

        <div className="space-y-2">
          {domains.map(d => (
            <div
              key={d.domain}
              className="rounded-lg px-4 py-3 flex items-center gap-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <Server size={14} style={{ color: 'var(--color-muted-2)' }} />
              <div className="flex-1">
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{d.domain}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{d.inboxCount} boîte{d.inboxCount > 1 ? 's' : ''} connectée{d.inboxCount > 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <DnsBadge label="SPF" ok={d.spf} />
                <DnsBadge label="DKIM" ok={d.dkim} />
                <DnsBadge label="DMARC" ok={d.dmarc} />
              </div>
              <button
                onClick={() => setShowDnsModal(d.domain)}
                className="text-[11px] px-2.5 py-1 rounded transition-colors hover:opacity-80"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                Voir les records
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Conseils */}
      <div
        className="rounded-lg p-4 flex gap-3"
        style={{ background: '#3b82f608', border: '1px solid #3b82f630' }}
      >
        <AlertCircle size={16} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
          <p className="font-semibold mb-1">Pour envoyer 10 000 emails/mois sans finir en spam :</p>
          <p style={{ color: 'var(--color-muted)' }}>
            Acheter 5 domaines secondaires (jamais le domaine principal), créer 3 boîtes par domaine, configurer SPF/DKIM/DMARC sur chacun, lancer 3-4 semaines de warmup avant d&apos;envoyer du volume. Cela permet d&apos;atteindre une capacité de ~11 500 emails/mois en toute sécurité.
          </p>
        </div>
      </div>

      {showAddModal && <AddInboxModal onClose={() => setShowAddModal(false)} onAdd={(inbox) => {
        setInboxes([...inboxes, { ...inbox, id: String(Date.now()), status: 'warmup', dailySent: 0, dailyLimit: 5, health: 50, warmupDay: 1 }])
        setShowAddModal(false)
      }} />}

      {showDnsModal && <DnsModal domain={showDnsModal} onClose={() => setShowDnsModal(null)} />}
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

function StatusBadge({ status, warmupDay }: { status: Inbox['status']; warmupDay?: number }) {
  const config = {
    active:  { label: 'Actif',                      bg: '#22c55e15', color: '#22c55e' },
    warmup:  { label: `Warmup J${warmupDay ?? ''}`, bg: '#f59e0b15', color: '#f59e0b' },
    paused:  { label: 'Pause',                      bg: '#52525215', color: '#737373' },
  }[status]
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1"
      style={{ background: config.bg, color: config.color }}
    >
      {status === 'warmup' && <Flame size={9} />}
      {status === 'active' && <span className="w-1 h-1 rounded-full" style={{ background: config.color }} />}
      {status === 'paused' && <Pause size={9} />}
      {config.label}
    </span>
  )
}

function DnsBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
      style={{
        background: ok ? '#22c55e15' : '#ef444415',
        color: ok ? '#22c55e' : '#ef4444',
      }}
    >
      {ok ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
      {label}
    </span>
  )
}

function AddInboxModal({ onClose, onAdd }: { onClose: () => void; onAdd: (i: Omit<Inbox, 'id' | 'status' | 'dailySent' | 'dailyLimit' | 'health'>) => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const [data, setData] = useState({
    email: '',
    preset: '',
    host: '',
    port: '587',
    user: '',
    password: '',
    ssl: false,
  })

  const PRESETS: Record<string, { host: string; port: string }> = {
    gmail:    { host: 'smtp.gmail.com',     port: '587' },
    ionos:    { host: 'smtp.ionos.fr',      port: '587' },
    ovh:      { host: 'ssl0.ovh.net',       port: '465' },
    outlook:  { host: 'smtp.office365.com', port: '587' },
    yahoo:    { host: 'smtp.mail.yahoo.com',port: '587' },
  }

  const applyPreset = (key: string) => {
    if (PRESETS[key]) {
      setData({ ...data, preset: key, host: PRESETS[key].host, port: PRESETS[key].port })
    } else {
      setData({ ...data, preset: '' })
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg max-w-lg w-full max-h-[90vh] overflow-auto"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="px-5 py-3.5 flex items-center justify-between sticky top-0 z-10"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Ajouter une boîte mail</h2>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <Field label="Adresse email complète" value={data.email} onChange={v => setData({ ...data, email: v })} placeholder="thomas@hdigiweb-conseil.fr" type="email" />

          <div>
            <label className="block text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Pré-configuration rapide
            </label>
            <select
              value={data.preset}
              onChange={e => applyPreset(e.target.value)}
              className="w-full px-3 py-2 rounded text-[12px] outline-none"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            >
              <option value="">— Choisir votre hébergeur —</option>
              <option value="gmail">Gmail</option>
              <option value="ionos">IONOS (1&1)</option>
              <option value="ovh">OVH</option>
              <option value="outlook">Outlook / Office 365</option>
              <option value="yahoo">Yahoo</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hôte SMTP" value={data.host} onChange={v => setData({ ...data, host: v })} />
            <Field label="Port" value={data.port} onChange={v => setData({ ...data, port: v })} />
          </div>

          <Field label="Utilisateur SMTP" value={data.user} onChange={v => setData({ ...data, user: v })} placeholder="Souvent identique à l'email" />

          <div>
            <label className="block text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Mot de passe
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={data.password}
                onChange={e => setData({ ...data, password: e.target.value })}
                className="w-full px-3 py-2 pr-9 rounded text-[12px] outline-none"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <button onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--color-muted)' }}>
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={data.ssl}
              onChange={e => setData({ ...data, ssl: e.target.checked })}
              className="w-4 h-4 cursor-pointer"
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span className="text-[11px]" style={{ color: 'var(--color-text)' }}>
              Connexion sécurisée (SSL/TLS)
            </span>
          </label>

          <div
            className="rounded-lg p-3"
            style={{ background: '#f59e0b08', border: '1px solid #f59e0b30' }}
          >
            <p className="text-[11px] font-semibold mb-1" style={{ color: '#f59e0b' }}>
              Warmup automatique activé
            </p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Cette nouvelle boîte démarrera à 5 emails/jour et augmentera progressivement sur 4 semaines avant d&apos;atteindre les 35 emails/jour.
            </p>
          </div>
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2"
          style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12px] transition-colors"
            style={{ color: 'var(--color-muted)' }}
          >
            Annuler
          </button>
          <button
            onClick={() => onAdd({ email: data.email })}
            disabled={!data.email}
            className="px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            Connecter et démarrer le warmup
          </button>
        </div>
      </div>
    </div>
  )
}

function DnsModal({ domain, onClose }: { domain: string; onClose: () => void }) {
  const records = [
    {
      type: 'TXT (SPF)',
      host: '@',
      value: `v=spf1 include:_spf.google.com include:smtp.${domain.split('.').slice(-2).join('.')} ~all`,
      desc: 'Autorise les serveurs à envoyer pour ton domaine.',
    },
    {
      type: 'TXT (DKIM)',
      host: 'default._domainkey',
      value: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEB...',
      desc: 'Signe cryptographiquement chaque email envoyé.',
    },
    {
      type: 'TXT (DMARC)',
      host: '_dmarc',
      value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}; pct=100`,
      desc: 'Politique appliquée si SPF ou DKIM échoue.',
    },
  ]

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="px-5 py-3.5 flex items-center justify-between sticky top-0 z-10"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Records DNS pour {domain}</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>À ajouter chez votre registrar (OVH, Cloudflare, etc.)</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {records.map((r, i) => (
            <div
              key={i}
              className="rounded-lg p-3"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--color-accent)' }}>{r.type}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(r.value)}
                  className="text-[10px] px-2 py-0.5 rounded inline-flex items-center gap-1 hover:opacity-80"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                >
                  <Copy size={9} />
                  Copier
                </button>
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2 text-[11px]">
                <span style={{ color: 'var(--color-muted-2)' }}>Hôte :</span>
                <code className="font-mono" style={{ color: 'var(--color-text)' }}>{r.host}</code>
                <span style={{ color: 'var(--color-muted-2)' }}>Valeur :</span>
                <code className="font-mono break-all" style={{ color: 'var(--color-text)' }}>{r.value}</code>
              </div>
              <p className="text-[10px] mt-2" style={{ color: 'var(--color-muted-2)' }}>{r.desc}</p>
            </div>
          ))}
        </div>

        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}
        >
          <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
            La propagation DNS peut prendre jusqu&apos;à 48h.
          </p>
          <button
            onClick={() => window.open('https://mxtoolbox.com/', '_blank')}
            className="px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            Vérifier les records
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB : SÉQUENCE DE RELANCE ────────────────────────────────────────────
// NOTE: Template changes here are UI-only. To persist templates permanently,
// they must be updated in code and redeployed. Dynamic template storage
// via DB is not implemented for email sequence bodies.
type Step = { id: string; jour: number; label: string; objet: string; body: string; actif: boolean }

function SequenceTab() {
  const [steps, setSteps] = useState<Step[]>([
    {
      id: 's1', jour: 0, label: 'Email initial', actif: true,
      objet: 'Vous avez assez de demandes de devis en ce moment ?',
      body: `Bonjour {{FirstName}},\n\nSur {{City}}, la majorité des demandes de devis vont aux 3 premiers couvreurs visibles sur Google — les autres attendent le bouche-à-oreille.\n\nProbablement que votre activité tourne déjà bien, mais si vous voulez un flux régulier de chantiers sans dépendre des recommandations, c'est réglable.\n\nQuelques minutes pour voir ce qui serait possible sur votre secteur, en début ou en fin de semaine ?\n\nBien à vous,\n\nThomas Renard\nHdigiweb\nthomas@hdigiweb.fr`,
    },
    {
      id: 's2', jour: 3, label: 'Relance J+3', actif: true,
      objet: '1 mois offert pour tester sur {{City}}',
      body: `Bonjour {{FirstName}},\n\nJe reviens vers vous rapidement.\n\nLes couvreurs qu'on accompagne reçoivent en moyenne 8 à 15 demandes de devis supplémentaires par mois via Google — certains bien plus selon la zone.\n\nPour que vous puissiez vérifier si c'est reproductible chez vous, le premier mois est offert, sans engagement.\n\nQuelques minutes cette semaine pour vous montrer ce que ça donnerait sur votre secteur, plutôt en début ou en fin de semaine ?\n\nBien à vous,\n\nThomas Renard\nHdigiweb\nthomas@hdigiweb.fr`,
    },
    {
      id: 's3', jour: 7, label: 'Relance J+7', actif: true,
      objet: 'Ce que font vos concurrents sur Google en ce moment',
      body: `Bonjour {{FirstName}},\n\nIl me semble que vous n'avez pas encore eu le temps de regarder ça — je comprends, c'est rarement la priorité quand le planning est chargé.\n\nCe que j'observe sur {{City}} : 2 ou 3 couvreurs captent la grande majorité des recherches locales. Ceux qui ne sont pas positionnés ne voient pas les demandes passer.\n\nOn peut vérifier ensemble où vous en êtes et ce qu'il faudrait pour inverser ça.\n\n20 minutes suffisent — en début ou en fin de semaine ?\n\nBien à vous,\n\nThomas Renard\nHdigiweb\nthomas@hdigiweb.fr`,
    },
    {
      id: 's4', jour: 14, label: 'Relance J+14', actif: true,
      objet: 'Un système complet pour plus de chantiers',
      body: `Bonjour {{FirstName}},\n\nConcrètement, ce qu'on met en place : visibilité Google Maps, référencement sur les recherches locales clés (fuite toiture, rénovation, démoussage...), optimisation pour générer des appels entrants — le tout suivi et ajusté chaque mois.\n\nLe premier mois est offert pour que vous puissiez mesurer l'impact sans rien risquer.\n\nSouhaitez-vous une estimation sur votre zone, en début ou en fin de semaine ?\n\nBien à vous,\n\nThomas Renard\nHdigiweb\nthomas@hdigiweb.fr`,
    },
    {
      id: 's5', jour: 21, label: 'Dernière relance J+21', actif: true,
      objet: 'Je vous garde une place ?',
      body: `Bonjour {{FirstName}},\n\nDernière prise de contact de ma part.\n\nOn travaille actuellement avec quelques couvreurs sur {{City}} pour générer beaucoup plus de demandes de devis via Google chaque semaine.\n\nLe premier mois étant offert, on limite le nombre de nouvelles intégrations pour ne pas saturer les mêmes zones.\n\nSi vous voulez tester avant qu'on ferme les places, je peux vous intégrer cette semaine. Sinon je clos simplement le dossier.\n\nBien à vous,\n\nThomas Renard\nHdigiweb\nthomas@hdigiweb.fr`,
    },
  ])

  const updateStep = (id: string, patch: Partial<Step>) => {
    setSteps(steps.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  const addStep = () => {
    const lastJour = steps[steps.length - 1]?.jour ?? 0
    setSteps([...steps, {
      id: `s${Date.now()}`,
      jour: lastJour + 5,
      label: `Relance ${steps.length}`,
      objet: '',
      body: '',
      actif: true,
    }])
  }

  const removeStep = (id: string) => {
    setSteps(steps.filter(s => s.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <SectionTitle title="Séquence de relance" />
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
            Configurez les étapes de votre campagne automatique.
          </p>
        </div>
        <button
          onClick={addStep}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] transition-colors hover:opacity-80"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          <Plus size={12} />
          Ajouter une étape
        </button>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className="rounded-lg overflow-hidden"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div
              className="px-4 py-3 flex items-center justify-between"
              style={{ background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold"
                  style={{ background: 'var(--color-accent)', color: '#fff' }}
                >
                  {i + 1}
                </div>
                <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                  J+{step.jour}
                </span>
                <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
                  {step.label}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={step.actif}
                    onChange={e => updateStep(step.id, { actif: e.target.checked })}
                    className="w-3.5 h-3.5 cursor-pointer"
                    style={{ accentColor: '#22c55e' }}
                  />
                  <span className="text-[11px]" style={{ color: step.actif ? '#22c55e' : 'var(--color-muted-2)' }}>
                    {step.actif ? 'Actif' : 'Inactif'}
                  </span>
                </label>
                {steps.length > 1 && (
                  <button
                    onClick={() => removeStep(step.id)}
                    className="p-1 rounded hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-muted-2)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-[100px_1fr] gap-3">
                <div>
                  <label className="block text-[10px] mb-1" style={{ color: 'var(--color-muted)' }}>
                    Jour d&apos;envoi
                  </label>
                  <input
                    type="number"
                    value={step.jour}
                    onChange={e => updateStep(step.id, { jour: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded text-[12px] outline-none"
                    style={{
                      background: 'var(--color-surface-2)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] mb-1" style={{ color: 'var(--color-muted)' }}>
                    Objet de l&apos;email
                  </label>
                  <input
                    value={step.objet}
                    onChange={e => updateStep(step.id, { objet: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded text-[12px] outline-none"
                    style={{
                      background: 'var(--color-surface-2)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: 'var(--color-muted)' }}>
                  Corps de l&apos;email
                </label>
                <textarea
                  value={step.body}
                  onChange={e => updateStep(step.id, { body: e.target.value })}
                  rows={8}
                  className="w-full px-2.5 py-1.5 rounded text-[12px] outline-none resize-y font-mono leading-relaxed"
                  style={{
                    background: 'var(--color-surface-2)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-border)',
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="rounded-lg p-3 mt-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          Variables disponibles dans l&apos;objet : <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-accent)' }}>{'{{FirstName}}'}</code>{' '}
          <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-accent)' }}>{'{{City}}'}</code>{' '}
          <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-accent)' }}>{'{{Company}}'}</code>
        </p>
      </div>
    </div>
  )
}

// ─── TAB : PRISE DE RDV ───────────────────────────────────────────────────
function RdvTab() {
  const [rdv, setRdv] = useState({
    enabled: true,
    slug: 'hdigiweb',
    duree: 30,
    jours: ['lun', 'mar', 'mer', 'jeu', 'ven'] as string[],
    heureDebut: 9,
    heureFin: 18,
    pause: 15,
    titre: 'Réservez un créneau',
    description: 'Choisissez un créneau pour discuter de votre visibilité digitale.',
  })

  const JOURS = [
    { id: 'dim', label: 'Dim' },
    { id: 'lun', label: 'Lun' },
    { id: 'mar', label: 'Mar' },
    { id: 'mer', label: 'Mer' },
    { id: 'jeu', label: 'Jeu' },
    { id: 'ven', label: 'Ven' },
    { id: 'sam', label: 'Sam' },
  ]

  const toggleJour = (id: string) => {
    setRdv({
      ...rdv,
      jours: rdv.jours.includes(id) ? rdv.jours.filter(j => j !== id) : [...rdv.jours, id],
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle title="Prise de rendez-vous" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={rdv.enabled}
            onChange={e => setRdv({ ...rdv, enabled: e.target.checked })}
            className="w-4 h-4 cursor-pointer"
            style={{ accentColor: '#22c55e' }}
          />
          <span className="text-[11px]" style={{ color: rdv.enabled ? '#22c55e' : 'var(--color-muted)' }}>
            {rdv.enabled ? 'Activé' : 'Désactivé'}
          </span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
            URL publique
          </label>
          <div className="flex">
            <span
              className="px-2.5 py-2 rounded-l text-[12px] flex items-center"
              style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRight: 'none' }}
            >
              /booking/
            </span>
            <input
              value={rdv.slug}
              onChange={e => setRdv({ ...rdv, slug: e.target.value })}
              className="flex-1 px-2.5 py-2 rounded-r text-[12px] outline-none"
              style={{
                background: 'var(--color-surface-2)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>
        </div>
        <Field
          label="Durée du RDV (min)"
          value={String(rdv.duree)}
          onChange={v => setRdv({ ...rdv, duree: Number(v) || 30 })}
          type="number"
        />
      </div>

      <div>
        <label className="block text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
          Jours disponibles
        </label>
        <div className="flex gap-1.5">
          {JOURS.map(j => {
            const active = rdv.jours.includes(j.id)
            return (
              <button
                key={j.id}
                onClick={() => toggleJour(j.id)}
                className="w-12 h-12 rounded-lg text-[12px] font-medium transition-all"
                style={{
                  background: active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  color: active ? '#fff' : 'var(--color-muted)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {j.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Heure de début"
          value={String(rdv.heureDebut)}
          onChange={v => setRdv({ ...rdv, heureDebut: Number(v) || 9 })}
          type="number"
        />
        <Field
          label="Heure de fin"
          value={String(rdv.heureFin)}
          onChange={v => setRdv({ ...rdv, heureFin: Number(v) || 18 })}
          type="number"
        />
      </div>

      <Field
        label="Pause entre RDV (min)"
        value={String(rdv.pause)}
        onChange={v => setRdv({ ...rdv, pause: Number(v) || 15 })}
        type="number"
      />

      <Field
        label="Titre de la page"
        value={rdv.titre}
        onChange={v => setRdv({ ...rdv, titre: v })}
      />

      <div>
        <label className="block text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Description
        </label>
        <textarea
          value={rdv.description}
          onChange={e => setRdv({ ...rdv, description: e.target.value })}
          rows={3}
          className="w-full px-3 py-2 rounded text-[12px] outline-none resize-none"
          style={{
            background: 'var(--color-surface-2)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>

      {rdv.enabled && (
        <div
          className="rounded-lg p-3 flex items-center gap-2"
          style={{ background: '#22c55e15', border: '1px solid #22c55e30' }}
        >
          <Check size={13} style={{ color: '#22c55e' }} />
          <p className="text-[11px]" style={{ color: 'var(--color-text)' }}>
            Page publique : <span style={{ color: '#22c55e' }}>https://hdigiweb.app/booking/{rdv.slug}</span>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── TAB : MODE TEST / PROD ───────────────────────────────────────────────
function ModeTab({ saveSignal }: { saveSignal: number }) {
  const [mode, setMode] = useState<'test' | 'prod'>('prod')
  const [ton, setTon] = useState<'pro' | 'neutre' | 'decontracte'>('neutre')

  // Load settings from API on mount
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const s = data.settings ?? {}
        if (s.mode === 'test' || s.mode === 'prod') setMode(s.mode)
        if (s.ton === 'pro' || s.ton === 'neutre' || s.ton === 'decontracte') setTon(s.ton)
      })
      .catch(() => {})
  }, [])

  // Watch saveSignal to persist
  useEffect(() => {
    if (saveSignal === 0) return
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { key: 'mode', value: mode },
        { key: 'ton', value: ton },
      ]),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSignal])

  const MODES = [
    {
      id: 'test' as const,
      icon: FlaskConical,
      title: 'Mode Test',
      desc: 'Les emails sont envoyés à votre adresse de test. Aucun prospect réel ne sera contacté.',
    },
    {
      id: 'prod' as const,
      icon: RotateCcw,
      title: 'Mode Production',
      desc: 'Les emails sont envoyés aux vrais prospects. Les automatisations sont actives.',
    },
  ]

  const TONS = [
    {
      id: 'pro' as const,
      icon: Briefcase,
      title: 'Professionnel',
      desc: 'Vouvoiement, formulations soignées. Idéal pour professions libérales, cabinets.',
      example: '"Seriez-vous disponible pour un échange de quelques minutes ?"',
    },
    {
      id: 'neutre' as const,
      icon: Handshake,
      title: 'Neutre',
      desc: "Équilibre entre pro et accessible. Convient à la majorité des secteurs.",
      example: '"Quelques minutes pour qu\'on en parle, en début ou en fin de semaine ?"',
    },
    {
      id: 'decontracte' as const,
      icon: Smile,
      title: 'Décontracté',
      desc: 'Tutoiement possible, ton direct. Idéal pour commerces, restaurants, artisans.',
      example: '"On se fait un call de quelques minutes ?"',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle title="Mode de fonctionnement" />
        <div className="grid grid-cols-2 gap-3 mt-3">
          {MODES.map(m => {
            const active = mode === m.id
            const Icon = m.icon
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="rounded-lg p-4 text-left transition-all relative"
                style={{
                  background: active ? 'var(--color-accent)' + '08' : 'var(--color-surface)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {active && (
                  <div className="absolute top-3 right-3">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: '#22c55e' }}
                    >
                      <Check size={11} color="#fff" />
                    </div>
                  </div>
                )}
                <Icon size={18} style={{ color: active ? 'var(--color-accent)' : 'var(--color-muted)' }} />
                <p className="text-[13px] font-semibold mt-3" style={{ color: 'var(--color-text)' }}>
                  {m.title}
                </p>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  {m.desc}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <SectionTitle title="Ton des emails" />
        <div className="grid grid-cols-3 gap-3 mt-3">
          {TONS.map(t => {
            const active = ton === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTon(t.id)}
                className="rounded-lg p-4 text-left transition-all relative"
                style={{
                  background: active ? 'var(--color-accent)' + '08' : 'var(--color-surface)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {active && (
                  <div className="absolute top-3 right-3">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: '#22c55e' }}
                    >
                      <Check size={11} color="#fff" />
                    </div>
                  </div>
                )}
                <Icon size={18} style={{ color: active ? 'var(--color-accent)' : 'var(--color-muted)' }} />
                <p className="text-[13px] font-semibold mt-3" style={{ color: 'var(--color-text)' }}>
                  {t.title}
                </p>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  {t.desc}
                </p>
                <p className="text-[11px] italic mt-3" style={{ color: 'var(--color-accent)' }}>
                  {t.example}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────
function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>
      {title}
    </h2>
  )
}

function Field({
  label, value, onChange, type = 'text', placeholder, icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  icon?: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted-2)' }}>
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${icon ? 'pl-8' : 'pl-3'} pr-3 py-2 rounded text-[12px] outline-none transition-colors focus:opacity-90`}
          style={{
            background: 'var(--color-surface-2)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>
    </div>
  )
}
