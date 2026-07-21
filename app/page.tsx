'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Mail, MessageSquare, Calendar, User, RefreshCw, Zap,
  Bell, Target, Trophy, Settings, BarChart2, Sparkles, Bot,
  ChevronDown, ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekDay {
  date: string
  dayName: string
  rdvCount: number
}

interface TopCampaign {
  name: string
  sentThisMonth: number
  replyRate: number
  rdvCount: number
  status: string
}

interface RecentActivity {
  id: string
  type: string
  time: string
  text: string
  daysAgo: number
  created_at: string
}

interface WeeklyLearning {
  id: string
  period_start: string
  period_end: string
  emails_sent: number | null
  reply_rate: number | null
  rdv_count: number | null
  top_sectors: string[] | null
  top_subject_patterns: string[] | null
  recommendations: Record<string, unknown> | null
  created_at: string
}

interface DashboardSummary {
  // existing
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
  dailyActivity: { date: string; sent: number; replies: number }[]
  recentEvents: { id: string; type: string; data: Record<string, unknown>; created_at: string }[]
  pendingDrafts: { id: string; company: string; classification: string; created_at: string }[]
  upcomingRdvs: { id: string; company: string; scheduled_at: string }[]
  // new
  repliesReceived: number
  clientsSigned: number
  emailsSentThisWeek: { date: string; count: number }[]
  replyRateVsLastWeek: number
  pendingFollowups: number
  weekCalendar: WeekDay[]
  topCampaigns: TopCampaign[]
  recentActivity: RecentActivity[]
  weeklyLearning: WeeklyLearning | null
  revenue: number
  monthlyHistory?: { month: string; rdv: number; revenue: number }[]
  _demo?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function daysAgoText(created_at: string): string {
  const diff = Date.now() - new Date(created_at).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'aujourd\'hui'
  if (days === 1) return '1 j'
  return `${days} j`
}

function ActivityIcon({ type }: { type: string }) {
  if (type === 'rdv_created') return <Calendar size={14} style={{ color: '#7d6fb0' }} />
  if (type === 'email_sent') return <Mail size={14} style={{ color: '#5f83ac' }} />
  if (type === 'reply_received') return <MessageSquare size={14} style={{ color: '#5c9b82' }} />
  return <Bell size={14} style={{ color: '#6b6b80' }} />
}

const DAY_NAMES = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']

// ─── Blink dot ────────────────────────────────────────────────────────────────

function BlinkDot({ color = '#5c9b82' }: { color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        animation: 'blink 2s infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
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

  useEffect(() => {
    void fetchSummary()
    refreshTimerRef.current = setInterval(() => void fetchSummary(), 30000)
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [fetchSummary])

  const s = summary
  const emailsSent = s?.totalEmailsSent ?? s?.repliesReceived != null ? (s?.totalEmailsSent ?? 0) : 0
  const repliesReceived = s?.repliesReceived ?? s?.totalReplies ?? 0
  const rdvCount = s?.rdvThisMonth ?? 0
  // KPI du haut = TOTAL de tous les RDV obtenus depuis le début (pas seulement le mois en cours).
  const rdvTotal = s?.totalRdv ?? rdvCount
  const clientsSigned = s?.clientsSigned ?? s?.totalSigned ?? 0
  const revenue = s?.revenue ?? (rdvCount * 80)
  const pendingReplies = s?.draftsAwaitingValidation ?? 0
  const rdvToday = s?.rdvToday ?? 0
  const pendingFollowups = s?.pendingFollowups ?? 0
  const emailsSentToday = s?.emailsSentToday ?? 0

  // bar chart data
  const barData: { date: string; count: number }[] = s?.emailsSentThisWeek?.length
    ? s.emailsSentThisWeek
    : (s?.dailyActivity ?? []).slice(-7).map(d => ({ date: d.date, count: d.sent }))

  const barMax = Math.max(...barData.map(d => d.count), 1)

  // pipeline
  const pipeline = s?.pipeline ?? { prospects: 847, contacted: 234, replied: 18, rdv: 5, signed: 0 }
  const pTotal = pipeline.prospects || 1

  // week calendar
  const today = new Date()
  const weekCalendar: WeekDay[] = s?.weekCalendar?.length
    ? s.weekCalendar
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today)
        const dayOfWeek = today.getDay()
        const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
        d.setDate(today.getDate() + diffToMon + i)
        return {
          date: d.toISOString().slice(0, 10),
          dayName: DAY_NAMES[d.getDay()],
          rdvCount: 0,
        }
      })

  const todayStr = today.toISOString().slice(0, 10)

  // top campaigns
  const topCampaigns: TopCampaign[] = s?.topCampaigns?.length
    ? s.topCampaigns
    : [
        { name: 'Couvreurs IDF — Relance Q2', sentThisMonth: 234, replyRate: 7.7, rdvCount: 5, status: 'active' },
        { name: 'Couvreurs Lyon — Initial', sentThisMonth: 98, replyRate: 4.1, rdvCount: 2, status: 'active' },
        { name: 'Toitures Nord — Test A/B', sentThisMonth: 45, replyRate: 0, rdvCount: 0, status: 'paused' },
      ]

  // recent activity
  const recentActivity: RecentActivity[] = s?.recentActivity?.length
    ? s.recentActivity
    : (s?.recentEvents ?? []).slice(0, 10).map(ev => ({
        id: ev.id,
        type: ev.type,
        time: formatTime(ev.created_at),
        text: ev.type === 'rdv_created'
          ? `RDV pris avec ${String(ev.data?.company ?? '')}`
          : ev.type === 'email_sent'
          ? `Email envoyé à ${String(ev.data?.company ?? '')}`
          : ev.type === 'reply_received'
          ? `Réponse reçue de ${String(ev.data?.company ?? '')}`
          : String(ev.data?.message ?? ev.type),
        daysAgo: 0,
        created_at: ev.created_at,
      }))

  // weekly learning
  const learning = s?.weeklyLearning ?? null
  const learningDate = learning
    ? new Date(learning.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div
      style={{
        background: '#0a0a0f',
        minHeight: '100vh',
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        color: '#e8e8f0',
      }}
    >
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
      `}</style>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 24px' }}>

        {/* ── SECTION 1: Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: '#e8e8f0', margin: 0, lineHeight: 1.2 }}>
              Bonjour, Haris
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <BlinkDot />
              <span style={{ fontSize: 12, color: '#6b6b80' }}>
                L&apos;agent tourne en temps réel · maj à l&apos;instant
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void fetchSummary()}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8, fontSize: 13,
                background: 'transparent', border: '1px solid #1e1e2e',
                color: '#e8e8f0', cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} style={{ opacity: loading ? 0.4 : 1 }} />
              Rafraîchir
            </button>
            <Link
              href="/campagnes"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8, fontSize: 13,
                background: '#7d6fb0', color: '#fff', textDecoration: 'none', fontWeight: 500,
              }}
            >
              <Zap size={13} />
              Nouvelle campagne
            </Link>
          </div>
        </div>

        {/* ── SECTION 2: 4 KPI Cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { Icon: Mail, iconColor: '#5f83ac', label: 'EMAILS ENVOYÉS', value: emailsSent.toLocaleString('fr-FR'), href: '/campagnes' },
            { Icon: MessageSquare, iconColor: '#5c9b82', label: 'RÉPONSES REÇUES', value: String(repliesReceived), href: '/conversations' },
            { Icon: Calendar, iconColor: '#7d6fb0', label: 'RDV GÉNÉRÉS', value: String(rdvTotal), href: '/agenda' },
            { Icon: User, iconColor: '#7d6fb0', label: 'CLIENTS SIGNÉS', value: String(clientsSigned), href: '/leads' },
          ].map(card => (
            <a
              key={card.label}
              href={card.href}
              style={{
                display: 'block',
                textDecoration: 'none',
                cursor: 'pointer',
                background: '#111118',
                border: '1px solid #1e1e2e',
                borderRadius: 8,
                padding: 20,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <card.Icon size={20} style={{ color: card.iconColor, marginBottom: 12 }} />
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b6b80', marginBottom: 4 }}>
                {card.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: '#e8e8f0' }}>
                {card.value}
              </div>
            </a>
          ))}
        </div>

        {/* ── SECTION 3: Facturation ce mois ── */}
        <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0' }}>Rendez-vous générés ce mois</div>
            <span style={{ fontSize: 11, color: '#6b6b80' }}>Remise à zéro chaque mois</span>
          </div>

          {/* 2 big boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {/* RDV count */}
            <div style={{ background: '#1a1a24', border: '1px solid #1e1e2e', borderRadius: 8, padding: '20px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b6b80', marginBottom: 8 }}>Rendez-vous ce mois</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: '#e8e8f0', letterSpacing: '-0.03em' }}>{rdvCount}</div>
            </div>
            {/* Revenue */}
            <div style={{ background: '#1a1a24', border: '1px solid #1e1e2e', borderRadius: 8, padding: '20px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b6b80', marginBottom: 8 }}>Valeur ce mois</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: '#e8e8f0', letterSpacing: '-0.03em' }}>{revenue.toLocaleString('fr-FR')} €</div>
            </div>
          </div>

          {/* Monthly history */}
          {summary?.monthlyHistory && summary.monthlyHistory.length > 0 && (
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b6b80', marginBottom: 8 }}>Historique</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {summary.monthlyHistory.map((m: { month: string; rdv: number; revenue: number }) => (
                  <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#0a0a0f', borderRadius: 6, fontSize: 12 }}>
                    <span style={{ color: '#6b6b80' }}>{m.month}</span>
                    <span style={{ color: '#a99cc9' }}>{m.rdv} RDV</span>
                    <span style={{ color: '#e8e8f0', fontWeight: 600 }}>{m.revenue} €</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 4: Weekly Learning ── */}
        <div
          style={{
            background: 'rgba(124,58,237,0.06)',
            border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bot size={16} style={{ color: '#7d6fb0' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#e8e8f0' }}>Ce que ton agent a appris cette semaine</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {learningDate && (
                <span style={{ fontSize: 12, color: '#6b6b80' }}>Rapport généré le {learningDate}</span>
              )}
              <button style={{
                fontSize: 12, color: '#a99cc9', background: 'rgba(124,58,237,0.15)',
                border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6,
                padding: '4px 10px', cursor: 'pointer',
              }}>
                Analyser
              </button>
            </div>
          </div>

          {learning ? (
            <div>
              <p style={{ fontSize: 13, lineHeight: 1.7, color: '#c4b5fd', marginBottom: 16 }}>
                Sur la période, l&apos;agent a envoyé {learning.emails_sent ?? 0} emails avec un taux de réponse de {(learning.reply_rate ?? 0).toFixed(1)}% et généré {learning.rdv_count ?? 0} RDV.
              </p>

              {/* Top actions */}
              {(learning.top_subject_patterns ?? []).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#5c9b82', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, borderLeft: '2px solid #5c9b82', paddingLeft: 8 }}>
                    TOP 5 ACTIONS CETTE SEMAINE
                  </div>
                  {(learning.top_subject_patterns ?? []).slice(0, 5).map((p, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#d1d5db', padding: '3px 0', paddingLeft: 8 }}>
                      → {p}
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsible rows */}
              {[
                { key: 'winning', dot: '#5c9b82', label: 'Segments gagnants', content: (learning.top_sectors ?? []).join(', ') || 'Aucun segment identifié' },
                { key: 'avoid', dot: '#ef4444', label: 'Segments à éviter', content: 'Données insuffisantes' },
                { key: 'alerts', dot: '#c19653', label: 'Alertes', content: 'Aucune alerte' },
              ].map(row => (
                <div key={row.key} style={{ borderTop: '1px solid rgba(124,58,237,0.15)', paddingTop: 8, marginTop: 8 }}>
                  <button
                    onClick={() => toggleSection(row.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                      color: '#e8e8f0', fontSize: 13, padding: 0,
                    }}
                  >
                    {expandedSections[row.key] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span style={{ color: row.dot, fontSize: 8 }}>●</span> {row.label}
                  </button>
                  {expandedSections[row.key] && (
                    <div style={{ paddingLeft: 20, paddingTop: 8, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                      {row.content}
                    </div>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <Link href="/stats" style={{ fontSize: 12, color: '#a99cc9', textDecoration: 'none' }}>
                  Voir tous les rapports →
                </Link>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: '#6b6b80', textAlign: 'center', padding: '12px 0' }}>
              Aucun rapport disponible — le premier rapport sera généré dimanche.
            </p>
          )}
        </div>

        {/* ── SECTION 5: À traiter status bar ── */}
        <div
          style={{
            background: '#111118',
            border: '1px solid #1e1e2e',
            borderRadius: 8,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <Bell size={14} style={{ color: '#e8e8f0', flexShrink: 0 }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#e8e8f0', marginRight: 4 }}>À traiter</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href="/reponses-a-valider"
              style={{
                background: '#1a1a24', border: '1px solid #1e1e2e',
                borderRadius: 9999, padding: '4px 14px', fontSize: 12,
                color: '#e8e8f0', textDecoration: 'none',
              }}
            >
              {pendingReplies} réponse{pendingReplies !== 1 ? 's' : ''} en attente
            </Link>
            <Link
              href="/agenda"
              style={{
                background: '#1a1a24', border: '1px solid #1e1e2e',
                borderRadius: 9999, padding: '4px 14px', fontSize: 12,
                color: '#e8e8f0', textDecoration: 'none',
              }}
            >
              {rdvToday} RDV aujourd&apos;hui
            </Link>
            <span
              style={{
                background: '#1a1a24', border: '1px solid #1e1e2e',
                borderRadius: 9999, padding: '4px 14px', fontSize: 12,
                color: '#e8e8f0',
              }}
            >
              {pendingFollowups} relance{pendingFollowups !== 1 ? 's' : ''} aujourd&apos;hui
            </span>
          </div>
        </div>

        {/* ── SECTION 6: Performance Email ── */}
        <div
          style={{
            background: '#111118',
            border: '1px solid #1e1e2e',
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={15} style={{ color: '#e8e8f0' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#e8e8f0' }}>Email</span>
            </div>
            <Link href="/stats" style={{ fontSize: 12, color: '#7d6fb0', textDecoration: 'none' }}>
              Détail →
            </Link>
          </div>

          {/* Row 1: today */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: '#6b6b80' }}>Envois aujourd&apos;hui</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: '#e8e8f0', letterSpacing: '-0.03em' }}>
              {emailsSentToday}
            </span>
          </div>

          {/* Row 2: 4 stat boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Envoyés', value: (s?.totalEmailsSent ?? 0).toLocaleString('fr-FR') },
              { label: 'Rép.', value: String(repliesReceived) },
              { label: 'RDV', value: String(rdvCount) },
              { label: 'Taux', value: `${s?.replyRate ?? 0}%` },
            ].map(box => (
              <div
                key={box.label}
                style={{
                  background: '#1a1a24', border: '1px solid #1e1e2e',
                  borderRadius: 6, padding: '10px 16px', textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 11, color: '#6b6b80', marginBottom: 4 }}>{box.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#e8e8f0' }}>{box.value}</div>
              </div>
            ))}
          </div>

        </div>

        {/* ── SECTION 7: 2-column grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 16 }}>

          {/* LEFT: Activité en temps réel */}
          <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid #1e1e2e',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BlinkDot />
                <span style={{ fontWeight: 700, fontSize: 13, color: '#e8e8f0' }}>Activité en temps réel</span>
              </div>
              <span style={{ fontSize: 11, color: '#6b6b80' }}>auto-refresh 30s</span>
            </div>
            <div>
              {recentActivity.length === 0 ? (
                <p style={{ fontSize: 12, color: '#4a4a5a', textAlign: 'center', padding: '24px 16px' }}>
                  Aucune activité récente
                </p>
              ) : recentActivity.map(ev => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px', borderBottom: '1px solid #1e1e2e',
                  }}
                >
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}><ActivityIcon type={ev.type} /></span>
                  <span style={{ fontSize: 12, color: '#6b6b80', flexShrink: 0, minWidth: 36 }}>{ev.time || formatTime(ev.created_at)}</span>
                  <span style={{ fontSize: 12, color: '#e8e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.text}
                  </span>
                  <span style={{ fontSize: 11, color: '#6b6b80', flexShrink: 0 }}>
                    {daysAgoText(ev.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Pipeline */}
          <div style={{ background: '#111118', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <Target size={15} style={{ color: '#e8e8f0' }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e8e8f0' }}>Pipeline de conversion</span>
            </div>
            {[
              { label: 'Prospects identifiés', value: pipeline.prospects, color: '#5f83ac', pct: null },
              { label: 'Contactés', value: pipeline.contacted, color: '#5f83ac', pct: pTotal > 0 ? +((pipeline.contacted / pTotal) * 100).toFixed(1) : 0 },
              { label: 'Réponses', value: pipeline.replied, color: '#c19653', pct: pTotal > 0 ? +((pipeline.replied / pTotal) * 100).toFixed(1) : 0 },
              { label: 'RDV pris', value: pipeline.rdv, color: '#5c9b82', pct: pTotal > 0 ? +((pipeline.rdv / pTotal) * 100).toFixed(1) : 0 },
              { label: 'Clients signés', value: pipeline.signed, color: '#a99cc9', pct: pTotal > 0 ? +((pipeline.signed / pTotal) * 100).toFixed(1) : 0 },
            ].map(row => (
              <div key={row.label} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: '#6b6b80' }}>{row.label}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e8e8f0' }}>{row.value.toLocaleString('fr-FR')}</span>
                    {row.pct !== null && (
                      <span style={{ fontSize: 11, color: '#6b6b80' }}>{row.pct}%</span>
                    )}
                  </div>
                </div>
                <div style={{ height: 4, background: '#1a1a24', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min((row.value / pTotal) * 100, 100)}%`,
                    background: row.color,
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── SECTION 8: Top campagnes ── */}
        <div
          style={{
            background: '#111118',
            border: '1px solid #1e1e2e',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid #1e1e2e',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trophy size={15} style={{ color: '#c19653' }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#e8e8f0' }}>Top campagnes ce mois</span>
            </div>
            <Link href="/campagnes" style={{ fontSize: 12, color: '#7d6fb0', textDecoration: 'none' }}>
              Tout voir →
            </Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nom', 'Canal', 'Envois (mois)', 'Taux réponse', 'RDV', 'Statut'].map(col => (
                  <th
                    key={col}
                    style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontSize: 11, color: '#6b6b80', fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      borderBottom: '1px solid #1e1e2e',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topCampaigns.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e1e2e' }}>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#e8e8f0' }}>{c.name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      background: 'rgba(59,130,246,0.15)', color: '#7d9cc4',
                      padding: '2px 8px', borderRadius: 4, fontSize: 12,
                    }}>
                      email
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#e8e8f0' }}>{c.sentThisMonth}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: c.replyRate > 5 ? '#5c9b82' : c.replyRate > 2 ? '#c19653' : '#6b6b80' }}>
                    {c.replyRate}%
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#a99cc9' }}>{c.rdvCount}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      background: c.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(107,107,128,0.15)',
                      color: c.status === 'active' ? '#5c9b82' : '#6b6b80',
                      padding: '2px 8px', borderRadius: 4, fontSize: 12,
                    }}>
                      {c.status === 'active' ? 'Actif' : 'Pausé'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── SECTION 9: Calendrier de la semaine ── */}
        <div
          style={{
            background: '#111118',
            border: '1px solid #1e1e2e',
            borderRadius: 8,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Calendar size={15} style={{ color: '#e8e8f0' }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: '#e8e8f0' }}>Calendrier de la semaine</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8 }}>
            {weekCalendar.map(day => {
              const isToday = day.date === todayStr
              return (
                <div
                  key={day.date}
                  style={{
                    padding: '12px 8px',
                    borderRadius: 8,
                    textAlign: 'center',
                    background: isToday ? 'rgba(124,58,237,0.15)' : '#111118',
                    border: isToday ? '2px solid #7d6fb0' : '1px solid #1e1e2e',
                  }}
                >
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#6b6b80', marginBottom: 4 }}>
                    {day.dayName}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: isToday ? '#fff' : '#6b6b80' }}>
                    {new Date(day.date + 'T12:00:00').getDate()}
                  </div>
                  <div style={{ fontSize: 11, color: isToday ? '#a99cc9' : '#4a4a5a', marginTop: 4 }}>
                    {day.rdvCount > 0 ? `${day.rdvCount} RDV` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── SECTION 10: Quick actions ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {[
            {
              href: '/campagnes',
              icon: <Zap size={18} style={{ color: '#5f83ac' }} />,
              iconBg: 'rgba(59,130,246,0.15)',
              label: '+ Nouvelle campagne',
            },
            {
              href: '/stats',
              icon: <Sparkles size={18} style={{ color: '#7d6fb0' }} />,
              iconBg: 'rgba(124,58,237,0.15)',
              label: 'Lancer une analyse',
            },
            {
              href: '/stats',
              icon: <BarChart2 size={18} style={{ color: '#c19653' }} />,
              iconBg: 'rgba(245,158,11,0.15)',
              label: 'Stats détaillées',
            },
            {
              href: '/parametres',
              icon: <Settings size={18} style={{ color: '#6b6b80' }} />,
              iconBg: 'rgba(107,107,128,0.15)',
              label: 'Paramètres',
            },
          ].map(action => (
            <Link
              key={action.href + action.label}
              href={action.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: '#111118', border: '1px solid #1e1e2e',
                borderRadius: 8, padding: 16, textDecoration: 'none',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: action.iconBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {action.icon}
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#e8e8f0' }}>{action.label}</span>
            </Link>
          ))}
        </div>

      </div>
    </div>
  )
}
