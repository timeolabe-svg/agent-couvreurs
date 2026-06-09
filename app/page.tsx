'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users, Calendar, Mail, TrendingUp, Euro, Zap,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardSummary {
  totalEmailsSent: number
  totalReplies: number
  totalRdv: number
  totalSigned: number
  emailsSentToday: number
  repliesToday: number
  rdvToday: number
  rdvThisWeek: number
  rdvThisMonth: number
  draftsAwaitingValidation: number
  replyRate: number
  rdvRate: number
  recentEvents: DashboardEvent[]
  pendingDrafts: PendingDraft[]
  upcomingRdvs: UpcomingRdv[]
  dailyActivity: DailyActivity[]
  activeCampaigns: number
  totalCampaigns: number
  lastTickMinutesAgo: number | null
  revenue_this_month: number
  pipeline: {
    prospects: number
    contacted: number
    replied: number
    rdv: number
    signed: number
  }
  _demo?: boolean
}

interface DashboardEvent {
  id: string
  type: string
  data: Record<string, unknown>
  created_at: string
}

interface PendingDraft {
  id: string
  company: string
  classification: string
  created_at: string
}

interface UpcomingRdv {
  id: string
  company: string
  scheduled_at: string
}

interface DailyActivity {
  date: string
  sent: number
  replies: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'à l\'instant'
  if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)} min`
  if (diff < 86400000) return `il y a ${Math.floor(diff / 3600000)} h`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function getInitials(company: string): string {
  return company
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function eventLabel(ev: DashboardEvent): { message: string; status: string; statusColor: string } {
  const d = ev.data
  switch (ev.type) {
    case 'email_sent':
      return {
        message: `Email envoyé → ${String(d.company ?? d.contactEmail ?? '')}`,
        status: 'Envoyé',
        statusColor: '#3b82f6',
      }
    case 'reply_received':
      return {
        message: `Réponse de ${String(d.company ?? d.from_email ?? '')}`,
        status: String(d.classification ?? 'reçue'),
        statusColor: '#f59e0b',
      }
    case 'rdv_created': {
      const dateStr = d.scheduledAt
        ? new Date(String(d.scheduledAt)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        : ''
      return {
        message: `RDV confirmé — ${String(d.company ?? '')}${dateStr ? ` le ${dateStr}` : ''}`,
        status: 'RDV',
        statusColor: '#10b981',
      }
    }
    case 'agent_decision':
      return {
        message: `Agent: ${String(d.action ?? d.message ?? '')}`,
        status: 'Décision',
        statusColor: '#7c3aed',
      }
    default:
      return { message: ev.type, status: 'Info', statusColor: '#6b6b80' }
  }
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

// ─── Bar Chart Component ──────────────────────────────────────────────────────

function BarChart({ data }: { data: DailyActivity[] }) {
  const max = Math.max(...data.map(d => d.sent), 1)
  return (
    <div className="flex items-end gap-1 h-[72px]">
      {data.map((d, i) => {
        const isLast = i === data.length - 1
        const pct = (d.sent / max) * 100
        const day = new Date(d.date).toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 2)
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[9px]" style={{ color: '#6b6b80' }}>{d.sent || ''}</span>
            <div
              className="w-full rounded-sm transition-all"
              style={{
                height: `${Math.max(pct * 0.52, 4)}px`,
                background: isLast ? '#7c3aed' : '#1a1a24',
                border: `1px solid ${isLast ? '#7c3aed' : '#1e1e2e'}`,
              }}
              title={`${d.date}: ${d.sent} envoyés`}
            />
            <span className="text-[9px]" style={{ color: '#4a4a5a' }}>{day}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub: string
  iconBg: string
}) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: '#111118', border: '1px solid #1e1e2e' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: iconBg + '22' }}
      >
        <Icon size={15} style={{ color: iconBg }} />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#6b6b80' }}>
          {label}
        </p>
        <p className="text-[24px] font-bold mt-0.5 leading-none" style={{ color: '#e8e8f0', letterSpacing: '-0.03em' }}>
          {value}
        </p>
        <p className="text-[11px] mt-1" style={{ color: '#6b6b80' }}>{sub}</p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const sseRef = useRef<EventSource | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/summary')
      if (!res.ok) return
      const data = (await res.json()) as DashboardSummary
      setSummary(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  // SSE connection with reconnect logic
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close()
    const es = new EventSource('/api/dashboard/stream')
    sseRef.current = es
    es.onmessage = () => void fetchSummary()
    es.onerror = () => {
      es.close()
      sseRef.current = null
      setTimeout(connectSSE, 5000)
    }
  }, [fetchSummary])

  useEffect(() => {
    void fetchSummary()
    connectSSE()
    refreshTimerRef.current = setInterval(() => void fetchSummary(), 30000)
    return () => {
      sseRef.current?.close()
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [fetchSummary, connectSSE])

  const s = summary
  const rdvThisMonth = s?.rdvThisMonth ?? 0
  const revenue = s?.revenue_this_month ?? rdvThisMonth * 50

  // Build 7-day activity for bar chart
  const sevenDayActivity: DailyActivity[] = s?.dailyActivity
    ? s.dailyActivity.slice(-7)
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        return { date: d.toISOString().slice(0, 10), sent: 0, replies: 0 }
      })

  const tickText = s?.lastTickMinutesAgo != null
    ? `Prochain tick dans ~${Math.max(0, 15 - (s.lastTickMinutesAgo % 15))}min`
    : 'Tick récent'

  return (
    <div className="flex flex-col h-full" style={{ background: '#0a0a0f' }}>
      {/* Header */}
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid #1e1e2e' }}
      >
        <div>
          <h1
            className="text-[22px] font-bold"
            style={{ color: '#e8e8f0', letterSpacing: '-0.03em', lineHeight: 1 }}
          >
            Bonjour, Thomas 👋
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b6b80' }}>
            L&apos;agent tourne en ce moment — {s?.emailsSentToday ?? 0} emails envoyés aujourd&apos;hui
          </p>
        </div>
        <Link
          href="/campagnes"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-90"
          style={{ background: '#7c3aed', color: '#fff' }}
        >
          <Zap size={14} />
          Nouvelle campagne
        </Link>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="max-w-6xl space-y-4">

          {/* Live ticker bar */}
          <div
            className="rounded-lg px-4 py-2.5 flex items-center gap-3 text-[12px]"
            style={{ background: '#7c3aed12', border: '1px solid #7c3aed30' }}
          >
            <span className="dot-live" />
            <span style={{ color: '#a78bfa' }}>
              Agent actif · {tickText} · {s?.activeCampaigns ?? 0} campagnes actives · ↗ {s?.rdvThisWeek ?? 0} leads cette semaine
            </span>
            {loading && <span className="ml-auto text-[11px]" style={{ color: '#6b6b80' }}>Chargement…</span>}
          </div>

          {/* KPI Grid — 5 cards */}
          <div className="grid grid-cols-5 gap-3">
            <KpiCard
              icon={Users}
              label="Leads totaux"
              value={(s?.pipeline?.prospects ?? 0).toLocaleString('fr-FR')}
              sub={`+${s?.rdvThisWeek ?? 0} cette semaine`}
              iconBg="#7c3aed"
            />
            <KpiCard
              icon={Calendar}
              label="RDV ce mois"
              value={String(rdvThisMonth)}
              sub="RDV confirmés"
              iconBg="#10b981"
            />
            <KpiCard
              icon={Mail}
              label="Emails envoyés"
              value={(s?.totalEmailsSent ?? 0).toLocaleString('fr-FR')}
              sub={`${s?.replyRate ?? 0}% taux de réponse`}
              iconBg="#3b82f6"
            />
            <KpiCard
              icon={TrendingUp}
              label="Taux de réponse"
              value={`${s?.replyRate ?? 0}%`}
              sub="Moyenne industrie : 3.2%"
              iconBg="#f59e0b"
            />
            <KpiCard
              icon={Euro}
              label="Revenus du mois"
              value={formatEuro(revenue)}
              sub="à 50€ par RDV"
              iconBg="#ec4899"
            />
          </div>

          {/* Main 2-column grid */}
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 320px' }}>
            {/* LEFT column */}
            <div className="space-y-4">

              {/* Activité récente */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e2e' }}
              >
                <div
                  className="px-4 py-3 flex items-center justify-between"
                  style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Activité récente</p>
                  <Link href="/leads" className="text-[11px] transition-opacity hover:opacity-80" style={{ color: '#7c3aed' }}>
                    Voir tout →
                  </Link>
                </div>
                <div style={{ background: '#111118' }}>
                  {(s?.recentEvents ?? []).slice(0, 5).length === 0 ? (
                    <p className="text-[12px] px-4 py-6 text-center" style={{ color: '#4a4a5a' }}>
                      Aucune activité récente
                    </p>
                  ) : (s?.recentEvents ?? []).slice(0, 5).map(ev => {
                    const { message, status, statusColor } = eventLabel(ev)
                    const company = String(ev.data?.company ?? ev.data?.contactEmail ?? 'Contact')
                    const initials = getInitials(company)
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center gap-3 px-4 py-3"
                        style={{ borderBottom: '1px solid #1e1e2e' }}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
                          style={{ background: '#1a1a24', color: '#a78bfa' }}
                        >
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] truncate" style={{ color: '#e8e8f0' }}>{company}</p>
                          <p className="text-[11px] truncate" style={{ color: '#6b6b80' }}>{message}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: statusColor + '22', color: statusColor }}
                          >
                            {status}
                          </span>
                          <span className="text-[10px]" style={{ color: '#4a4a5a' }}>{timeAgo(ev.created_at)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Activité des 7 derniers jours */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e2e' }}
              >
                <div
                  className="px-4 py-3"
                  style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Activité des 7 derniers jours</p>
                </div>
                <div className="px-4 py-4" style={{ background: '#111118' }}>
                  <BarChart data={sevenDayActivity} />
                </div>
              </div>

            </div>

            {/* RIGHT column */}
            <div className="space-y-4">

              {/* À traiter maintenant */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e2e' }}
              >
                <div
                  className="px-4 py-3 flex items-center justify-between"
                  style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>À traiter maintenant</p>
                  {(s?.draftsAwaitingValidation ?? 0) > 0 && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: '#ef444422', color: '#ef4444' }}
                    >
                      {s?.draftsAwaitingValidation}
                    </span>
                  )}
                </div>
                <div style={{ background: '#111118' }}>
                  {(s?.pendingDrafts ?? []).length === 0 ? (
                    <p className="text-[12px] px-4 py-4 text-center" style={{ color: '#4a4a5a' }}>
                      Aucun draft en attente
                    </p>
                  ) : (s?.pendingDrafts ?? []).slice(0, 3).map(d => (
                    <div
                      key={d.id}
                      className="px-4 py-3"
                      style={{ borderBottom: '1px solid #1e1e2e' }}
                    >
                      <p className="text-[12px] font-medium" style={{ color: '#e8e8f0' }}>{d.company}</p>
                      <p className="text-[11px]" style={{ color: '#6b6b80' }}>{d.classification} · {timeAgo(d.created_at)}</p>
                    </div>
                  ))}
                  <div className="px-4 py-2.5">
                    <Link href="/reponses-a-valider" className="text-[11px] transition-opacity hover:opacity-80" style={{ color: '#7c3aed' }}>
                      Voir les réponses →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Prochains RDV */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e2e' }}
              >
                <div
                  className="px-4 py-3"
                  style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Prochains RDV</p>
                </div>
                <div style={{ background: '#111118' }}>
                  {(s?.upcomingRdvs ?? []).length === 0 ? (
                    <p className="text-[12px] px-4 py-4 text-center" style={{ color: '#4a4a5a' }}>
                      Aucun RDV à venir
                    </p>
                  ) : (s?.upcomingRdvs ?? []).slice(0, 3).map(r => {
                    const dt = new Date(r.scheduled_at)
                    return (
                      <div
                        key={r.id}
                        className="px-4 py-3"
                        style={{ borderBottom: '1px solid #1e1e2e' }}
                      >
                        <p className="text-[12px] font-medium" style={{ color: '#e8e8f0' }}>{r.company}</p>
                        <p className="text-[11px]" style={{ color: '#10b981' }}>
                          {dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          &nbsp;·&nbsp;
                          {dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Santé de l'agent */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid #1e1e2e' }}
              >
                <div
                  className="px-4 py-3"
                  style={{ background: '#111118', borderBottom: '1px solid #1e1e2e' }}
                >
                  <p className="text-[13px] font-semibold" style={{ color: '#e8e8f0' }}>Santé de l&apos;agent</p>
                </div>
                <div className="px-4 py-3 space-y-3" style={{ background: '#111118' }}>
                  {[
                    { label: 'Campagnes actives', value: `${s?.activeCampaigns ?? 0} / ${s?.totalCampaigns ?? 0}` },
                    { label: "Emails envoyés aujourd'hui", value: `${s?.emailsSentToday ?? 0} / 42` },
                    {
                      label: 'Dernier tick',
                      value: s?.lastTickMinutesAgo != null ? `il y a ${s.lastTickMinutesAgo}min` : 'N/A',
                    },
                    { label: 'Warmup email', value: 'Actif' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: '#6b6b80' }}>{row.label}</span>
                      <span className="text-[11px] font-medium" style={{ color: '#e8e8f0' }}>{row.value}</span>
                    </div>
                  ))}
                  <div
                    className="pt-2 text-[10px] text-center rounded"
                    style={{ borderTop: '1px solid #1e1e2e', color: '#4a4a5a' }}
                  >
                    RGPD — Activé
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
