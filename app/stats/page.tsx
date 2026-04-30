import { DEMO_LEADS, DEMO_RDV } from '@/data/demo'
import { Lead } from '@/types'
import { Mail, MessageSquare, Calendar, Clock, TrendingUp, Target, CheckCircle2, XCircle, AlertCircle, BarChart2, Zap } from 'lucide-react'

// ─── Calcul réel depuis les données leads ─────────────────────────────────────

function computeStats(leads: Lead[]) {
  const allAgentMessages = leads.flatMap(l => l.thread.filter(m => m.author === 'agent'))
  const allLeadMessages  = leads.flatMap(l => l.thread.filter(m => m.author === 'lead'))
  const openedMessages   = allAgentMessages.filter(m => m.openedAt)

  const sentTotal    = allAgentMessages.length
  const openedTotal  = openedMessages.length
  const repliedLeads = leads.filter(l => l.thread.some(m => m.author === 'lead'))
  const rdvLeads     = leads.filter(l => l.stage === 'rdv_booked')
  const notInterested= leads.filter(l => l.stage === 'not_interested')
  const inSequence   = leads.filter(l => ['contacted', 'follow_up_1', 'follow_up_2'].includes(l.stage))
  const needsAction  = leads.filter(l => l.stage === 'replied')

  const openRate    = sentTotal  ? Math.round((openedTotal / sentTotal) * 100) : 0
  const replyRate   = leads.length ? Math.round((repliedLeads.length / leads.length) * 100) : 0
  const rdvRate     = repliedLeads.length ? Math.round((rdvLeads.length / repliedLeads.length) * 100) : 0

  // Séquence breakdown
  const initialSent   = allAgentMessages.filter(m => m.sequenceStep === 'initial').length
  const followup1Sent = allAgentMessages.filter(m => m.sequenceStep === 'follow_up_1').length
  const followup2Sent = allAgentMessages.filter(m => m.sequenceStep === 'follow_up_2').length
  const replySent     = allAgentMessages.filter(m => m.sequenceStep === 'reply').length

  // Par semaine (depuis les timestamps réels)
  const byWeek: Record<string, { sent: number; opened: number; replies: number }> = {}
  for (const lead of leads) {
    for (const msg of lead.thread) {
      const d = new Date(msg.sentAt)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay() + 1)
      const key = weekStart.toISOString().slice(0, 10)
      if (!byWeek[key]) byWeek[key] = { sent: 0, opened: 0, replies: 0 }
      if (msg.author === 'agent') {
        byWeek[key].sent++
        if (msg.openedAt) byWeek[key].opened++
      } else {
        byWeek[key].replies++
      }
    }
  }
  const weeklyData = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      label: `Sem. ${new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`,
      ...v,
    }))

  // Par secteur (depuis specialty[0] réel)
  const bySector: Record<string, { sent: number; replied: number; rdv: number }> = {}
  for (const lead of leads) {
    const sector = lead.specialty[0] ?? 'autre'
    if (!bySector[sector]) bySector[sector] = { sent: 0, replied: 0, rdv: 0 }
    bySector[sector].sent += lead.thread.filter(m => m.author === 'agent').length
    if (lead.thread.some(m => m.author === 'lead')) bySector[sector].replied++
    if (lead.stage === 'rdv_booked') bySector[sector].rdv++
  }
  const sectorData = Object.entries(bySector)
    .map(([sector, v]) => ({
      sector,
      ...v,
      replyRate: v.sent ? Math.round((v.replied / v.sent) * 100) : 0,
    }))
    .sort((a, b) => b.replyRate - a.replyRate)

  // Par type email
  const initialOpened  = allAgentMessages.filter(m => m.sequenceStep === 'initial' && m.openedAt).length
  const initialOpenRate = initialSent ? Math.round((initialOpened / initialSent) * 100) : 0
  const fu1Opened = allAgentMessages.filter(m => m.sequenceStep === 'follow_up_1' && m.openedAt).length
  const fu1OpenRate = followup1Sent ? Math.round((fu1Opened / followup1Sent) * 100) : 0

  return {
    sentTotal, openedTotal, repliedLeads, rdvLeads, notInterested, inSequence, needsAction,
    openRate, replyRate, rdvRate, allLeadMessages,
    initialSent, followup1Sent, followup2Sent, replySent,
    initialOpenRate, fu1OpenRate,
    weeklyData, sectorData,
  }
}

export default function StatsPage() {
  const s = computeStats(DEMO_LEADS)
  const maxWeeklySent = Math.max(...s.weeklyData.map(w => w.sent), 1)

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Analytique</h1>
          <span className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            Temps réel
          </span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: '#22c55e' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            Données live
          </span>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Campagne : PME/TPE — Toulouse &amp; Occitanie</p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-5xl space-y-4">

          {/* Row 1 — KPIs principaux */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            <Kpi icon={<Mail size={13}/>}          label="Emails envoyés"    value={String(s.sentTotal)}              color="#3b82f6" />
            <Kpi icon={<TrendingUp size={13}/>}    label="Taux d'ouverture"  value={`${s.openRate}%`}                  color="#8b5cf6" sub={`${s.openedTotal} ouverts`} />
            <Kpi icon={<MessageSquare size={13}/>} label="Taux de réponse"   value={`${s.replyRate}%`}                  color="#f59e0b" sub={`${s.repliedLeads.length} leads ont répondu`} />
            <Kpi icon={<Calendar size={13}/>}      label="RDV confirmés"     value={String(s.rdvLeads.length)}          color="#22c55e" sub={`${s.rdvRate}% des leads qui ont répondu`} />
          </div>

          {/* Row 2 — KPIs secondaires */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            <Kpi icon={<Clock size={13}/>}         label="En attente réponse"  value={String(s.inSequence.length)}       color="#3b82f6" sub="leads en séquence active" />
            <Kpi icon={<AlertCircle size={13}/>}   label="Action requise"      value={String(s.needsAction.length)}      color="#f97316" sub="réponses à traiter" />
            <Kpi icon={<XCircle size={13}/>}       label="Non intéressés"      value={String(s.notInterested.length)}    color="#ef4444" sub={`${DEMO_LEADS.length} leads total`} />
            <Kpi icon={<Target size={13}/>}        label="Coût par RDV"        value="0 €"                               color="#22c55e" sub="Anthropic API seulement" />
          </div>

          <div className="grid grid-cols-2 gap-4">

            {/* Volume hebdomadaire réel */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <BarChart2 size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Volume par semaine</p>
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>depuis messages réels</span>
              </div>
              <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
                {s.weeklyData.map(w => (
                  <div key={w.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{w.label}</span>
                      <div className="flex gap-3 text-[11px]">
                        <span style={{ color: 'var(--color-muted-2)' }}>{w.opened}/{w.sent} ouverts</span>
                        {w.replies > 0 && <span style={{ color: '#f59e0b' }}>{w.replies} rép.</span>}
                      </div>
                    </div>
                    <div className="flex h-4 gap-0.5">
                      <div className="rounded-sm relative flex-shrink-0"
                        style={{ width: `${(w.sent / maxWeeklySent) * 100}%`, minWidth: 4, background: '#3b82f620', border: '1px solid #3b82f630' }}>
                        <div className="h-full rounded-sm"
                          style={{ width: `${w.sent ? (w.opened / w.sent) * 100 : 0}%`, background: '#3b82f6' }} />
                      </div>
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: '#3b82f6' }}>
                      {w.sent} envoyés · {w.sent ? Math.round(w.opened/w.sent*100) : 0}% ouverture
                    </p>
                  </div>
                ))}
                {s.weeklyData.length === 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>Aucune donnée</p>
                )}
              </div>
            </div>

            {/* Entonnoir réel */}
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-4 py-3 flex items-center gap-2"
                style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                <Target size={13} style={{ color: 'var(--color-muted)' }} />
                <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Entonnoir de conversion</p>
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>calculé en temps réel</span>
              </div>
              <div className="p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
                {[
                  { label: 'Leads contactés',     value: DEMO_LEADS.length,            color: '#3b82f6' },
                  { label: 'Emails envoyés',       value: s.sentTotal,                  color: '#3b82f6' },
                  { label: 'Emails ouverts',       value: s.openedTotal,                color: '#8b5cf6' },
                  { label: 'Leads ont répondu',    value: s.repliedLeads.length,        color: '#f59e0b' },
                  { label: 'RDV confirmés',        value: s.rdvLeads.length,            color: '#22c55e' },
                ].map((f, i, arr) => {
                  const pct = arr[0].value > 0 ? Math.round((f.value / arr[0].value) * 100) : 0
                  return (
                    <div key={f.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px]" style={{ color: i === arr.length - 1 ? '#22c55e' : 'var(--color-muted)' }}>
                          {f.label}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text)' }}>
                          {f.value}
                          <span className="text-[10px] font-normal ml-1" style={{ color: 'var(--color-muted-2)' }}>({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: f.color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Performance par étape de séquence */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <Zap size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Performance par étape de séquence</p>
            </div>
            <div className="grid grid-cols-4 gap-px"
              style={{ background: 'var(--color-border)' }}>
              {[
                { label: 'Email initial J0',    sent: s.initialSent,   openRate: s.initialOpenRate, color: '#3b82f6' },
                { label: 'Relance J+2',          sent: s.followup1Sent, openRate: s.fu1OpenRate,     color: '#8b5cf6' },
                { label: 'Relance J+5',          sent: s.followup2Sent, openRate: 0,                color: '#f59e0b' },
                { label: 'Réponse IA',           sent: s.replySent,     openRate: 0,                color: '#22c55e' },
              ].map(step => (
                <div key={step.label} className="px-4 py-4" style={{ background: 'var(--color-surface)' }}>
                  <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>{step.label}</p>
                  <p className="text-2xl font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>{step.sent}</p>
                  <p className="text-[10px] mb-2" style={{ color: 'var(--color-muted-2)' }}>envoyés</p>
                  {step.openRate > 0 && (
                    <div>
                      <div className="h-1 rounded-full mb-0.5" style={{ background: 'var(--color-border)' }}>
                        <div className="h-full rounded-full" style={{ width: `${step.openRate}%`, background: step.color }} />
                      </div>
                      <p className="text-[10px]" style={{ color: step.color }}>{step.openRate}% ouverture</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Performance par secteur réel */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <TrendingUp size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Performance par secteur</p>
              <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>basé sur specialty des leads</span>
            </div>
            <div style={{ background: 'var(--color-surface)' }}>
              <div className="grid px-4 py-2 text-[11px]"
                style={{ gridTemplateColumns: '1fr 70px 80px 60px 110px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
                <span>Secteur</span>
                <span className="text-right">Emails</span>
                <span className="text-right">Réponses</span>
                <span className="text-right">RDV</span>
                <span className="text-right">Taux réponse</span>
              </div>
              {s.sectorData.map((row, i) => (
                <div key={row.sector} className="grid px-4 py-2.5 items-center"
                  style={{
                    gridTemplateColumns: '1fr 70px 80px 60px 110px',
                    borderBottom: i < s.sectorData.length - 1 ? '1px solid var(--color-border)' : undefined,
                  }}>
                  <span className="text-[12px] capitalize" style={{ color: 'var(--color-text)' }}>{row.sector}</span>
                  <span className="text-[12px] text-right" style={{ color: 'var(--color-muted)' }}>{row.sent}</span>
                  <span className="text-[12px] text-right" style={{ color: row.replied > 0 ? '#f59e0b' : 'var(--color-muted)' }}>{row.replied}</span>
                  <span className="text-[12px] text-right" style={{ color: row.rdv > 0 ? '#22c55e' : 'var(--color-muted)' }}>{row.rdv}</span>
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-14 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${Math.min(row.replyRate, 100)}%`, background: row.replyRate >= 50 ? '#22c55e' : row.replyRate >= 25 ? '#f59e0b' : '#3b82f6' }} />
                    </div>
                    <span className="text-[11px] w-8 text-right font-medium"
                      style={{ color: row.replyRate >= 50 ? '#22c55e' : row.replyRate >= 25 ? '#f59e0b' : 'var(--color-muted)' }}>
                      {row.replyRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Détail leads — tableau complet */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
              <CheckCircle2 size={13} style={{ color: 'var(--color-muted)' }} />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Détail par lead</p>
            </div>
            <div style={{ background: 'var(--color-surface)' }}>
              <div className="grid px-4 py-2 text-[11px]"
                style={{ gridTemplateColumns: '1fr 80px 60px 60px 60px 100px', color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
                <span>Entreprise</span>
                <span>Secteur</span>
                <span className="text-right">Envoyés</span>
                <span className="text-right">Ouverts</span>
                <span className="text-right">Rép.</span>
                <span className="text-right">Statut</span>
              </div>
              {DEMO_LEADS.map((lead, i) => {
                const agentMsgs = lead.thread.filter(m => m.author === 'agent')
                const opened    = agentMsgs.filter(m => m.openedAt).length
                const replies   = lead.thread.filter(m => m.author === 'lead').length
                const STAGE_COLOR: Record<string, string> = {
                  contacted: '#3b82f6', follow_up_1: '#8b5cf6', follow_up_2: '#d97706',
                  replied: '#f97316', rdv_booked: '#22c55e', not_interested: '#ef4444', prospected: '#737373',
                }
                const STAGE_LABEL: Record<string, string> = {
                  contacted: 'Email envoyé', follow_up_1: 'Relance 1', follow_up_2: 'Relance 2',
                  replied: 'Réponse reçue', rdv_booked: 'RDV confirmé', not_interested: 'Non intéressé', prospected: 'Prospecté',
                }
                return (
                  <div key={lead.id} className="grid px-4 py-2.5 items-center"
                    style={{
                      gridTemplateColumns: '1fr 80px 60px 60px 60px 100px',
                      borderBottom: i < DEMO_LEADS.length - 1 ? '1px solid var(--color-border)' : undefined,
                    }}>
                    <div>
                      <p className="text-[12px]" style={{ color: 'var(--color-text)' }}>{lead.company}</p>
                      <p className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>{lead.city}</p>
                    </div>
                    <span className="text-[11px] capitalize" style={{ color: 'var(--color-muted)' }}>{lead.specialty[0]}</span>
                    <span className="text-[12px] text-right" style={{ color: 'var(--color-muted)' }}>{agentMsgs.length}</span>
                    <span className="text-[12px] text-right" style={{ color: opened > 0 ? '#8b5cf6' : 'var(--color-muted-2)' }}>{opened}</span>
                    <span className="text-[12px] text-right" style={{ color: replies > 0 ? '#f59e0b' : 'var(--color-muted-2)' }}>{replies}</span>
                    <span className="text-[11px] text-right font-medium"
                      style={{ color: STAGE_COLOR[lead.stage] ?? 'var(--color-muted)' }}>
                      {STAGE_LABEL[lead.stage] ?? lead.stage}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value, color, sub }: { icon: React.ReactNode; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
      <div className="mb-2" style={{ color }}>{icon}</div>
      <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>{sub}</p>}
    </div>
  )
}
