'use client'

import { useEffect, useState } from 'react'
import { AGENT_CONFIG } from '@/data/demo'
import { Cpu, Shield, Clock, Mail, Bell, Bot, Flame, TrendingUp, CalendarRange, Save, Check } from 'lucide-react'

interface AgentSettings {
  persona: string
  objective: string
  tone: string
  maxEmailsPerDay: number
  warmupEnabled: boolean
  autoReplyEnabled: boolean
  autoRdvEnabled: boolean
  clientNotifEmail: string
}

export default function AgentPage() {
  const [config, setConfig] = useState<AgentSettings>({
    persona: AGENT_CONFIG.persona,
    objective: AGENT_CONFIG.objective,
    tone: AGENT_CONFIG.tone,
    maxEmailsPerDay: AGENT_CONFIG.maxEmailsPerDay,
    warmupEnabled: AGENT_CONFIG.warmupEnabled,
    autoReplyEnabled: AGENT_CONFIG.autoReplyEnabled,
    autoRdvEnabled: AGENT_CONFIG.autoRdvEnabled,
    clientNotifEmail: AGENT_CONFIG.clientNotifEmail,
  })
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        const s = data.settings ?? {}
        setConfig(prev => ({
          persona: s.persona ?? prev.persona,
          objective: s.objective ?? prev.objective,
          tone: s.tone_desc ?? prev.tone,
          maxEmailsPerDay: s.max_emails_per_day ? Number(s.max_emails_per_day) : prev.maxEmailsPerDay,
          warmupEnabled: s.warmup_enabled !== undefined ? s.warmup_enabled === 'true' : prev.warmupEnabled,
          autoReplyEnabled: s.auto_reply_enabled !== undefined ? s.auto_reply_enabled === 'true' : prev.autoReplyEnabled,
          autoRdvEnabled: s.auto_rdv_enabled !== undefined ? s.auto_rdv_enabled === 'true' : prev.autoRdvEnabled,
          clientNotifEmail: s.client_notif_email ?? prev.clientNotifEmail,
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = () => {
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { key: 'persona', value: config.persona },
        { key: 'objective', value: config.objective },
        { key: 'tone_desc', value: config.tone },
        { key: 'max_emails_per_day', value: String(config.maxEmailsPerDay) },
        { key: 'warmup_enabled', value: String(config.warmupEnabled) },
        { key: 'auto_reply_enabled', value: String(config.autoReplyEnabled) },
        { key: 'auto_rdv_enabled', value: String(config.autoRdvEnabled) },
        { key: 'client_notif_email', value: config.clientNotifEmail },
      ]),
    }).catch(() => {})
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
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Agent IA — Configuration</h1>
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
            style={{ background: '#5c9b8215', color: '#5c9b82', border: '1px solid #5c9b8230' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Actif 24h/7j
          </div>
          {loading && <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>Chargement…</span>}
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Hdigiweb · Toulouse &amp; Occitanie</p>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity hover:opacity-90"
            style={{ background: saved ? '#5c9b82' : 'var(--color-accent)', color: '#fff' }}
          >
            {saved ? <><Check size={13} /> Enregistré</> : <><Save size={13} /> Sauvegarder</>}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl space-y-4">

          {/* Persona & Objectif */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Bot size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Identité de l&apos;agent</p>
            </div>
            <div className="grid grid-cols-2 gap-px"
              style={{ background: 'var(--color-border)' }}>
              <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>PERSONA</p>
                <textarea
                  value={config.persona}
                  onChange={e => setConfig(c => ({ ...c, persona: e.target.value }))}
                  rows={4}
                  className="w-full text-[12px] leading-relaxed px-2 py-1.5 rounded outline-none resize-y"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
              </div>
              <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>OBJECTIF</p>
                <textarea
                  value={config.objective}
                  onChange={e => setConfig(c => ({ ...c, objective: e.target.value }))}
                  rows={4}
                  className="w-full text-[12px] leading-relaxed px-2 py-1.5 rounded outline-none resize-y"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
              </div>
            </div>
          </div>

          {/* Ton */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Cpu size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Style de rédaction</p>
            </div>
            <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
              <textarea
                value={config.tone}
                onChange={e => setConfig(c => ({ ...c, tone: e.target.value }))}
                rows={3}
                className="w-full text-[12px] leading-relaxed px-2 py-1.5 rounded outline-none resize-y"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
            </div>
          </div>

          {/* Paramètres */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Shield size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Paramètres de sécurité</p>
            </div>
            <div className="grid grid-cols-2 gap-px"
              style={{ background: 'var(--color-border)' }}>
              <div key="max-emails" className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#5f83ac' }}><Mail size={13} /></div>
                <p className="text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>Max emails / jour</p>
                <input
                  type="number"
                  value={config.maxEmailsPerDay}
                  onChange={e => setConfig(c => ({ ...c, maxEmailsPerDay: Number(e.target.value) }))}
                  className="text-[14px] font-semibold w-24 px-2 py-1 rounded outline-none"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted-2)' }}>Limite quotidienne pour éviter le spam</p>
              </div>
              <div key="warmup" className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#7d6fb0' }}><Clock size={13} /></div>
                <p className="text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>Warmup domaine</p>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={config.warmupEnabled}
                    onChange={e => setConfig(c => ({ ...c, warmupEnabled: e.target.checked }))}
                    className="w-4 h-4 cursor-pointer"
                    style={{ accentColor: '#7d6fb0' }}
                  />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {config.warmupEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted-2)' }}>Montée en charge progressive sur 4 semaines</p>
              </div>
              <div key="auto-reply" className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#c19653' }}><Bot size={13} /></div>
                <p className="text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>Réponse automatique</p>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={config.autoReplyEnabled}
                    onChange={e => setConfig(c => ({ ...c, autoReplyEnabled: e.target.checked }))}
                    className="w-4 h-4 cursor-pointer"
                    style={{ accentColor: '#c19653' }}
                  />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {config.autoReplyEnabled ? 'Activée' : 'Désactivée'}
                  </span>
                </label>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted-2)' }}>L&apos;agent répond aux emails reçus sous 30 min</p>
              </div>
              <div key="auto-rdv" className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: '#5c9b82' }}><Bell size={13} /></div>
                <p className="text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>Détection RDV auto</p>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={config.autoRdvEnabled}
                    onChange={e => setConfig(c => ({ ...c, autoRdvEnabled: e.target.checked }))}
                    className="w-4 h-4 cursor-pointer"
                    style={{ accentColor: '#5c9b82' }}
                  />
                  <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {config.autoRdvEnabled ? 'Activée' : 'Désactivée'}
                  </span>
                </label>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted-2)' }}>Détecte une date/heure dans les réponses et confirme le RDV</p>
              </div>
            </div>
          </div>

          {/* Warmup & deliverability */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Flame size={13} style={{ color: '#c19653' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Warmup & deliverability</p>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#5c9b8215', color: '#5c9b82' }}>
                Activé
              </span>
            </div>

            <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
              <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--color-text)' }}>
                Chaque nouvelle boîte mail démarre en douceur pour habituer Google et Outlook à reconnaître vos envois comme légitimes. Sans warmup, vos emails finissent en spam dès la première campagne.
              </p>

              <div className="grid grid-cols-4 gap-px rounded-lg overflow-hidden mb-4"
                style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}>
                {[
                  { week: 'Semaine 1', vol: '5 / jour',  pct: 14,  color: '#ef4444' },
                  { week: 'Semaine 2', vol: '15 / jour', pct: 43, color: '#c19653' },
                  { week: 'Semaine 3', vol: '25 / jour', pct: 71, color: '#5f83ac' },
                  { week: 'Semaine 4+', vol: '35 / jour', pct: 100, color: '#5c9b82' },
                ].map(s => (
                  <div key={s.week} className="px-3 py-3" style={{ background: 'var(--color-surface-2)' }}>
                    <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{s.week}</p>
                    <p className="text-[14px] font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{s.vol}</p>
                    <div className="h-1 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
                      <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: <CalendarRange size={12} />, label: 'Plage horaire', value: '9h00 → 17h30', desc: 'Lun-Ven uniquement', color: '#5f83ac' },
                  { icon: <TrendingUp size={12} />,    label: 'Incrément quotidien', value: '+2 emails/jour', desc: "Jusqu'à 35 emails/jour", color: '#7d6fb0' },
                  { icon: <Clock size={12} />,         label: 'Espacement', value: '8 à 25 min', desc: 'Aléatoire entre chaque envoi', color: '#c19653' },
                ].map(p => (
                  <div key={p.label} className="rounded-lg px-3 py-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <div className="mb-2" style={{ color: p.color }}>{p.icon}</div>
                    <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{p.label}</p>
                    <p className="text-[12px] font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{p.value}</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted-2)' }}>{p.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Notification client */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Bell size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Notification client</p>
            </div>
            <div className="px-4 py-4 flex items-center justify-between gap-4" style={{ background: 'var(--color-surface)' }}>
              <input
                type="email"
                value={config.clientNotifEmail}
                onChange={e => setConfig(c => ({ ...c, clientNotifEmail: e.target.value }))}
                className="flex-1 text-[12px] px-3 py-2 rounded outline-none"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <div>
                <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>
                  Reçoit une notification par email à chaque RDV confirmé par l&apos;agent
                </p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded flex-shrink-0"
                style={{ background: '#5c9b8215', color: '#5c9b82', border: '1px solid #5c9b8230' }}>
                Actif
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
