import { AGENT_CONFIG, DEMO_LEADS } from '@/data/demo'
import { Cpu, CheckCircle, Clock, Mail, Calendar, MessageSquare } from 'lucide-react'

const QUEUE = [
  { company: 'Normandie Couverture', city: 'Rouen',    action: 'Email initial',  scheduledAt: '2025-04-29T09:00:00' },
  { company: 'Toiture Grand Est',    city: 'Mulhouse', action: 'Email initial',  scheduledAt: '2025-04-29T09:12:00' },
  { company: 'Couverture Girard',    city: 'Dijon',    action: 'Email initial',  scheduledAt: '2025-04-29T09:24:00' },
  { company: 'Bernard Couverture',   city: 'Bordeaux', action: 'Relance finale', scheduledAt: '2025-04-30T09:00:00' },
  { company: 'Chauvin Toitures',     city: 'Orleans',  action: 'Email initial',  scheduledAt: '2025-04-30T09:15:00' },
]

const RECENT_ACTIONS = [
  { text: 'RDV detecte et confirme — Couverture Martineau', time: 'il y a 6h',  type: 'rdv' },
  { text: 'Reponse envoyee — Toiture Durand (clôture propre)', time: 'il y a 1j', type: 'reply' },
  { text: 'Relance J+5 envoyee — Bernard Couverture',       time: 'il y a 1j', type: 'send' },
  { text: 'Relance J+2 envoyee — Bernard Couverture',       time: 'il y a 3j', type: 'send' },
  { text: 'Email initial — 3 nouveaux prospects',           time: 'il y a 3j', type: 'send' },
]

const ACTION_COLOR: Record<string, string> = {
  rdv:   '#22c55e',
  reply: '#3b82f6',
  send:  '#525252',
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
            Actif — 24h/7j
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-4xl">
          {/* Stats bar */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden mb-6"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            {[
              { label: 'Emails envoyes', value: '5', icon: <Mail size={14} />, color: '#3b82f6' },
              { label: 'Reponses traitees', value: '3', icon: <MessageSquare size={14} />, color: '#f59e0b' },
              { label: 'RDV confirmes', value: String(rdvCount), icon: <Calendar size={14} />, color: '#22c55e' },
              { label: 'Dans la queue', value: String(QUEUE.length), icon: <Clock size={14} />, color: '#8b5cf6' },
            ].map(s => (
              <div key={s.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                <div className="flex items-center gap-2 mb-2" style={{ color: s.color }}>{s.icon}</div>
                <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{s.value}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Queue */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
              >
                <Clock size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>File d&apos;attente</p>
              </div>
              <div style={{ background: 'var(--color-surface)' }}>
                {QUEUE.map((item, i) => (
                  <div
                    key={i}
                    className="px-4 py-2.5 flex items-center justify-between"
                    style={{ borderBottom: i < QUEUE.length - 1 ? '1px solid var(--color-border)' : undefined }}
                  >
                    <div>
                      <p className="text-[12px]" style={{ color: 'var(--color-text)' }}>{item.company}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{item.city} · {item.action}</p>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                      {new Date(item.scheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent actions */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
              >
                <CheckCircle size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Actions recentes</p>
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

          {/* Agent config */}
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
            >
              <Cpu size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Configuration agent</p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4" style={{ background: 'var(--color-surface)' }}>
              <ConfigField label="Persona" value={AGENT_CONFIG.persona} multiline />
              <ConfigField label="Objectif" value={AGENT_CONFIG.objective} multiline />
              <ConfigField label="Ton" value={AGENT_CONFIG.tone} />
              <ConfigField label="Max emails/jour" value={String(AGENT_CONFIG.maxEmailsPerDay)} />
              <ConfigField label="Réponse automatique" value={AGENT_CONFIG.autoReplyEnabled ? 'Activée' : 'Désactivée'} />
              <ConfigField label="Détection RDV auto" value={AGENT_CONFIG.autoRdvEnabled ? 'Activée' : 'Désactivée'} />
              <ConfigField label="Notification client" value={AGENT_CONFIG.clientNotifEmail} />
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
      <p
        className={`text-[12px] leading-relaxed ${multiline ? '' : 'truncate'}`}
        style={{ color: 'var(--color-text)' }}
      >
        {value}
      </p>
    </div>
  )
}
