import { AGENT_CONFIG, DEMO_LEADS, TARGETING_SIGNALS } from '@/data/demo'
import { Cpu, CheckCircle, Clock, Mail, Calendar, MessageSquare, Search } from 'lucide-react'

const QUEUE = [
  { company: 'Plomberie Roussel',      city: 'Toulouse',       action: 'Email initial',  signal: 'Pas de site web',           scheduledAt: '2025-04-29T09:00:00' },
  { company: 'Pharmacie Saint-Michel', city: 'Toulouse',       action: 'Email initial',  signal: 'GMB incomplète',            scheduledAt: '2025-04-29T09:15:00' },
  { company: 'Cabinet Comptable Faure',city: 'Colomiers',      action: 'Email initial',  signal: 'Absent Google Ads',         scheduledAt: '2025-04-29T09:30:00' },
  { company: 'Salon Sublime Coiffure', city: 'Toulouse',       action: 'Relance finale', signal: 'Site non mobile-friendly',  scheduledAt: '2025-04-30T09:00:00' },
  { company: 'Auto Ecole Horizon',     city: 'Blagnac',        action: 'Email initial',  signal: 'Peu d\'avis Google (6)',     scheduledAt: '2025-04-30T09:20:00' },
  { company: 'Institut Beaute Elisa',  city: 'Tournefeuille',  action: 'Email initial',  signal: 'Absent Google Ads',         scheduledAt: '2025-04-30T09:40:00' },
]

const RECENT_ACTIONS = [
  { text: 'RDV détecté et confirmé — Menuiserie Carpentier (Toulouse)', time: 'il y a 4h',  type: 'rdv' },
  { text: 'Réponse traitée — Brasserie Le Capitole (objection prestataire existant)', time: 'il y a 1j', type: 'reply' },
  { text: 'Relance J+5 envoyée — Salon Sublime Coiffure', time: 'il y a 1j', type: 'send' },
  { text: 'Relance J+2 envoyée — Salon Sublime Coiffure', time: 'il y a 3j', type: 'send' },
  { text: 'Emails initiaux envoyés — 3 nouveaux prospects Toulouse', time: 'il y a 4j', type: 'send' },
]

const ACTION_COLOR: Record<string, string> = {
  rdv:   '#22c55e',
  reply: '#3b82f6',
  send:  '#525252',
}

const PRIORITY_COLOR: Record<string, string> = {
  haute:  '#ef4444',
  moyenne:'#f59e0b',
}

export default function AgentPage() {
  const rdvCount = DEMO_LEADS.filter(l => l.stage === 'rdv_booked').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Agent IA</h1>
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
            style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Actif 24h/7j
          </div>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>
          Hdigiweb · Toulouse &amp; Occitanie
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-5xl">

          {/* KPIs */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden mb-6"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            {[
              { label: 'Emails envoyés',    value: '8',           icon: <Mail size={14} />,          color: '#3b82f6' },
              { label: 'Réponses traitées', value: '3',           icon: <MessageSquare size={14} />, color: '#f59e0b' },
              { label: 'RDV confirmés',     value: String(rdvCount), icon: <Calendar size={14} />,   color: '#22c55e' },
              { label: 'Dans la queue',     value: String(QUEUE.length), icon: <Clock size={14} />,  color: '#8b5cf6' },
            ].map(s => (
              <div key={s.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="mb-2" style={{ color: s.color }}>{s.icon}</div>
                <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{s.value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Queue */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <Clock size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>File d&apos;attente</p>
              </div>
              <div style={{ background: 'var(--color-surface)' }}>
                {QUEUE.map((item, i) => (
                  <div
                    key={i}
                    className="px-4 py-2.5 flex items-start justify-between gap-2"
                    style={{ borderBottom: i < QUEUE.length - 1 ? '1px solid var(--color-border)' : undefined }}
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{item.company}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                        {item.city} · {item.action}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                        Signal : {item.signal}
                      </p>
                    </div>
                    <p className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                      {new Date(item.scheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent actions */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <CheckCircle size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Actions récentes</p>
              </div>
              <div style={{ background: 'var(--color-surface)' }}>
                {RECENT_ACTIONS.map((a, i) => (
                  <div
                    key={i}
                    className="px-4 py-2.5 flex items-start gap-2.5"
                    style={{ borderBottom: i < RECENT_ACTIONS.length - 1 ? '1px solid var(--color-border)' : undefined }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: ACTION_COLOR[a.type] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px]" style={{ color: 'var(--color-text)' }}>{a.text}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{a.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Targeting signals */}
          <div className="rounded-lg overflow-hidden mb-6" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Search size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
                Critères de ciblage — signaux détectés automatiquement
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--color-border)' }}>
              {TARGETING_SIGNALS.map((s, i) => (
                <div key={i} className="px-4 py-3" style={{ background: 'var(--color-surface)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: `${PRIORITY_COLOR[s.priority]}15`, color: PRIORITY_COLOR[s.priority] }}
                    >
                      {s.priority}
                    </span>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{s.signal}</p>
                  </div>
                  <p className="text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>{s.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {s.services.map(svc => (
                      <span key={svc} className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: '#3b82f615', color: '#3b82f6', border: '1px solid #3b82f630' }}>
                        {svc}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent config */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Cpu size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Configuration agent</p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4" style={{ background: 'var(--color-surface)' }}>
              <ConfigField label="Persona"                 value={AGENT_CONFIG.persona} multiline />
              <ConfigField label="Objectif"                value={AGENT_CONFIG.objective} multiline />
              <ConfigField label="Ton & personnalisation"  value={AGENT_CONFIG.tone} multiline />
              <ConfigField label="Max emails / jour"       value={String(AGENT_CONFIG.maxEmailsPerDay)} />
              <ConfigField label="Réponse automatique"     value={AGENT_CONFIG.autoReplyEnabled ? 'Activée' : 'Désactivée'} />
              <ConfigField label="Détection RDV auto"      value={AGENT_CONFIG.autoRdvEnabled ? 'Activée' : 'Désactivée'} />
              <ConfigField label="Notification client"     value={AGENT_CONFIG.clientNotifEmail} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function ConfigField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className={`text-[12px] leading-relaxed ${multiline ? '' : 'truncate'}`} style={{ color: 'var(--color-text)' }}>
        {value}
      </p>
    </div>
  )
}
