'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { DEMO_LEADS } from '@/data/demo'
import { Lead } from '@/types'
import { DashboardLeads } from '@/components/DashboardLeads'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardSummary {
  totalEmailsSent: number
  totalReplies: number
  totalRdv: number
  totalSigned: number
  emailsSentToday: number
  repliesToday: number
  rdvToday: number
  draftsAwaitingValidation: number
  replyRate: number
  rdvRate: number
  recentEvents: DashboardEvent[]
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

// ─── Activity Feed ────────────────────────────────────────────────────────────

function eventLabel(ev: DashboardEvent): string {
  const d = ev.data
  switch (ev.type) {
    case 'email_sent':
      return `📧 Email envoyé → ${String(d.company ?? d.contactEmail ?? '')}`
    case 'reply_received':
      return `💬 Réponse de ${String(d.company ?? d.from_email ?? '')}${d.classification ? ` (${d.classification})` : ''}`
    case 'rdv_created': {
      const dateStr = d.scheduledAt
        ? new Date(String(d.scheduledAt)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        : ''
      return `🎯 RDV confirmé — ${String(d.company ?? '')}${dateStr ? ` le ${dateStr}` : ''}`
    }
    case 'agent_decision':
      return `🤖 Agent: ${String(d.action ?? d.message ?? '')}`
    default:
      return `🔔 ${ev.type}`
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'à l\'instant'
  if (diff < 3600000) return `il y a ${Math.floor(diff / 60000)} min`
  if (diff < 86400000) return `il y a ${Math.floor(diff / 3600000)} h`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function ActivityFeed({ events }: { events: DashboardEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-[11px] px-4 py-6 text-center" style={{ color: 'var(--color-muted-2)' }}>
        Aucune activité récente
      </p>
    )
  }
  return (
    <div>
      {events.slice(0, 10).map((ev) => (
        <div
          key={ev.id}
          className="flex items-start gap-3 px-4 py-2.5"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <p className="text-[12px] flex-1 leading-snug" style={{ color: 'var(--color-text)' }}>
            {eventLabel(ev)}
          </p>
          <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
            {timeAgo(ev.created_at)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Counter with count-up animation ─────────────────────────────────────────

function CountUp({ target, duration = 800 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(0)

  useEffect(() => {
    if (target === prevTarget.current) return
    const start = prevTarget.current
    const diff = target - start
    prevTarget.current = target
    if (diff === 0) return

    const startTime = performance.now()
    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(start + diff * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])

  return <>{value.toLocaleString('fr-FR')}</>
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [events, setEvents] = useState<DashboardEvent[]>([])
  const [leads, setLeads] = useState<Lead[]>(DEMO_LEADS)
  const [loading, setLoading] = useState(true)
  const sseRef = useRef<EventSource | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/summary')
      if (!res.ok) return
      const data = (await res.json()) as DashboardSummary
      setSummary(data)
      if (data.recentEvents?.length) {
        setEvents(data.recentEvents)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch('/api/leads')
      if (!res.ok) return
      const json = (await res.json()) as { leads: Lead[] }
      if (json.leads?.length) setLeads(json.leads)
    } catch {
      // ignore — keep demo leads
    }
  }, [])

  // SSE connection with reconnect logic
  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close()
    }
    const es = new EventSource('/api/dashboard/stream')
    sseRef.current = es

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data as string) as {
          type: string
          events?: DashboardEvent[]
        }
        if (payload.type === 'init' && payload.events) {
          setEvents(payload.events)
        } else if (payload.type === 'update' && payload.events) {
          setEvents((prev) => {
            const ids = new Set(prev.map((x) => x.id))
            const newEvs = payload.events!.filter((x) => !ids.has(x.id))
            return [...newEvs, ...prev].slice(0, 20)
          })
          // Refresh summary counters when new event arrives
          void fetchSummary()
        }
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      sseRef.current = null
      // Reconnect after 5s
      setTimeout(connectSSE, 5000)
    }
  }, [fetchSummary])

  useEffect(() => {
    void fetchSummary()
    void fetchLeads()
    connectSSE()

    // Fallback auto-refresh every 30s
    refreshTimerRef.current = setInterval(() => {
      void fetchSummary()
    }, 30000)

    return () => {
      sseRef.current?.close()
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [fetchSummary, fetchLeads, connectSSE])

  const s = summary

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 h-14 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
            Dashboard
          </h1>
          {s?._demo && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: '#f59e0b15', color: '#d97706', border: '1px solid #f59e0b30' }}
            >
              Démo
            </span>
          )}
          {loading && (
            <span className="text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
              Chargement…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
          Agent actif — live
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-4 max-w-5xl">

          {/* KPI counters */}
          <div
            className="grid grid-cols-4 gap-px rounded-lg overflow-hidden mb-5"
            style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
          >
            {[
              {
                label: 'Emails envoyés',
                value: s?.totalEmailsSent ?? 0,
                sub: s ? `+${s.emailsSentToday} aujourd'hui` : '',
                color: '#3b82f6',
              },
              {
                label: 'Réponses',
                value: s?.totalReplies ?? 0,
                sub: s ? `${s.replyRate}% taux de réponse` : '',
                color: '#f59e0b',
              },
              {
                label: 'RDV générés',
                value: s?.totalRdv ?? 0,
                sub: s ? `${s.rdvRate}% des réponses` : '',
                color: '#22c55e',
              },
              {
                label: 'Clients signés',
                value: s?.totalSigned ?? 0,
                sub: s?.draftsAwaitingValidation
                  ? `${s.draftsAwaitingValidation} drafts en attente`
                  : '',
                color: '#8b5cf6',
              },
            ].map((kpi) => (
              <div key={kpi.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                <p
                  className="text-2xl font-semibold tabular-nums"
                  style={{ color: kpi.color }}
                >
                  <CountUp target={kpi.value} />
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text)' }}>
                  {kpi.label}
                </p>
                {kpi.sub && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted-2)' }}>
                    {kpi.sub}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Pipeline funnel */}
          {s?.pipeline && (
            <div
              className="grid grid-cols-5 gap-px rounded-lg overflow-hidden mb-5"
              style={{ background: 'var(--color-border)', border: '1px solid var(--color-border)' }}
            >
              {[
                { label: 'Prospects',  value: s.pipeline.prospects,  color: '#737373' },
                { label: 'Contactés',  value: s.pipeline.contacted,  color: '#3b82f6' },
                { label: 'Réponses',   value: s.pipeline.replied,    color: '#f59e0b' },
                { label: 'RDV',        value: s.pipeline.rdv,        color: '#22c55e' },
                { label: 'Signés',     value: s.pipeline.signed,     color: '#8b5cf6' },
              ].map((stage) => (
                <div key={stage.label} className="px-5 py-4" style={{ background: 'var(--color-surface)' }}>
                  <p className="text-2xl font-semibold tabular-nums" style={{ color: stage.color }}>
                    <CountUp target={stage.value} />
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text)' }}>{stage.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Live activity feed */}
          <div
            className="rounded-lg overflow-hidden mb-5"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
              <p className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
                Activité en direct
              </p>
              <span className="ml-auto text-[10px]" style={{ color: 'var(--color-muted-2)' }}>
                dernières 10 actions
              </span>
            </div>
            <div style={{ background: 'var(--color-surface)' }}>
              <ActivityFeed events={events} />
            </div>
          </div>

        </div>

        {/* Lead list */}
        <DashboardLeads leads={leads} onLeadsRefresh={fetchLeads} />
      </div>
    </div>
  )
}
