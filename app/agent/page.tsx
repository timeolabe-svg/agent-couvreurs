import { AGENT_CONFIG } from '@/data/demo'
import { Cpu, Shield, Clock, Mail, Bell, Bot, Flame, TrendingUp, CalendarRange } from 'lucide-react'

export default function AgentPage() {
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
            style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Actif 24h/7j
          </div>
        </div>
        <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Hdigiweb · Toulouse &amp; Occitanie</p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl space-y-4">

          {/* Persona & Objectif */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Bot size={13} style={{ color: 'var(--color-accent)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Identité de l'agent</p>
            </div>
            <div className="grid grid-cols-2 gap-px"
              style={{ background: 'var(--color-border)' }}>
              <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>PERSONA</p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text)' }}>{AGENT_CONFIG.persona}</p>
              </div>
              <div className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>OBJECTIF</p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text)' }}>{AGENT_CONFIG.objective}</p>
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
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text)' }}>{AGENT_CONFIG.tone}</p>
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
              {[
                {
                  icon: <Mail size={13} />,
                  label: 'Max emails / jour',
                  value: `${AGENT_CONFIG.maxEmailsPerDay} emails`,
                  desc: 'Limite quotidienne pour éviter le spam',
                  color: '#3b82f6',
                },
                {
                  icon: <Clock size={13} />,
                  label: 'Warmup domaine',
                  value: AGENT_CONFIG.warmupEnabled ? 'Activé' : 'Désactivé',
                  desc: 'Montée en charge progressive sur 4 semaines',
                  color: '#8b5cf6',
                },
                {
                  icon: <Bot size={13} />,
                  label: 'Réponse automatique',
                  value: AGENT_CONFIG.autoReplyEnabled ? 'Activée' : 'Désactivée',
                  desc: 'L\'agent répond aux emails reçus sous 30 min',
                  color: '#f59e0b',
                },
                {
                  icon: <Bell size={13} />,
                  label: 'Détection RDV auto',
                  value: AGENT_CONFIG.autoRdvEnabled ? 'Activée' : 'Désactivée',
                  desc: 'Détecte une date/heure dans les réponses et confirme le RDV',
                  color: '#22c55e',
                },
              ].map(p => (
                <div key={p.label} className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                  <div className="flex items-center gap-2 mb-2" style={{ color: p.color }}>{p.icon}</div>
                  <p className="text-[11px] mb-0.5" style={{ color: 'var(--color-muted)' }}>{p.label}</p>
                  <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{p.value}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>{p.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Warmup & deliverability */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Flame size={13} style={{ color: '#f59e0b' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Warmup & deliverability</p>
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#22c55e15', color: '#22c55e' }}>
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
                  { week: 'Semaine 2', vol: '15 / jour', pct: 43, color: '#f59e0b' },
                  { week: 'Semaine 3', vol: '25 / jour', pct: 71, color: '#3b82f6' },
                  { week: 'Semaine 4+', vol: '35 / jour', pct: 100, color: '#22c55e' },
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
                  { icon: <CalendarRange size={12} />, label: 'Plage horaire', value: '9h00 → 17h30', desc: 'Lun-Ven uniquement', color: '#3b82f6' },
                  { icon: <TrendingUp size={12} />,    label: 'Incrément quotidien', value: '+2 emails/jour', desc: 'Jusqu\'à 35 emails/jour', color: '#8b5cf6' },
                  { icon: <Clock size={12} />,         label: 'Espacement', value: '8 à 25 min', desc: 'Aléatoire entre chaque envoi', color: '#f59e0b' },
                ].map(p => (
                  <div key={p.label} className="rounded-lg px-3 py-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <div className="mb-2" style={{ color: p.color }}>{p.icon}</div>
                    <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{p.label}</p>
                    <p className="text-[12px] font-semibold mt-0.5" style={{ color: 'var(--color-text)' }}>{p.value}</p>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted-2)' }}>{p.desc}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg p-3 mt-4 flex gap-2.5"
                style={{ background: '#f59e0b08', border: '1px solid #f59e0b30' }}>
                <Flame size={13} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  <p className="font-semibold mb-0.5">Warmup automatisé inter-boîtes</p>
                  <p style={{ color: 'var(--color-muted)' }}>
                    Pendant les 4 semaines de warmup, vos boîtes échangent automatiquement des emails simulés entre elles (questions, réponses, marquage important) pour entraîner les filtres anti-spam à reconnaître votre activité comme légitime.
                  </p>
                </div>
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
            <div className="px-4 py-4 flex items-center justify-between" style={{ background: 'var(--color-surface)' }}>
              <div>
                <p className="text-[12px]" style={{ color: 'var(--color-text)' }}>{AGENT_CONFIG.clientNotifEmail}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                  Reçoit une notification par email à chaque RDV confirmé par l'agent
                </p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded"
                style={{ background: '#22c55e15', color: '#22c55e', border: '1px solid #22c55e30' }}>
                Actif
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
