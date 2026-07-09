'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Calendar, Cpu, BarChart2, Megaphone, SlidersHorizontal, MessageSquare, Brain, Users, LogOut, Inbox, Menu, X } from 'lucide-react'
import { signOut } from 'next-auth/react'

const NAV_BEFORE_BELL = [
  { href: '/',          label: 'Suivi leads', icon: LayoutDashboard },
  { href: '/leads',     label: 'Leads',       icon: Users },
  { href: '/agenda',    label: 'Agenda',      icon: Calendar },
]

const NAV_AFTER_BELL = [
  { href: '/stats',       label: 'Analytique',    icon: BarChart2 },
  { href: '/agent',       label: 'Agent IA',      icon: Cpu },
  { href: '/campagnes',   label: 'Campagnes',     icon: Megaphone },
  { href: '/learning',    label: 'Auto-Learning', icon: Brain },
  { href: '/parametres',  label: 'Paramètres',    icon: SlidersHorizontal },
]

export default function Sidebar() {
  const path = usePathname()
  const [pendingCount, setPendingCount] = useState(0)
  const [open, setOpen] = useState(false) // tiroir mobile

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/reply-drafts?count=true')
        if (!res.ok) return
        const json = await res.json() as { count: number }
        setPendingCount(json.count ?? 0)
      } catch {
        // ignore
      }
    }
    void load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  // Ferme le tiroir à chaque changement de page (mobile).
  useEffect(() => { setOpen(false) }, [path])

  const renderLink = (href: string, label: string, Icon: React.ElementType, badge?: number) => {
    const active = path === href || (href !== '/' && path.startsWith(href))
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        className="flex items-center gap-2.5 px-3 py-2.5 md:py-2 rounded-md text-[13px] transition-colors"
        style={{
          color: active ? 'var(--color-text)' : 'var(--color-muted)',
          background: active ? 'var(--color-surface-2)' : 'transparent',
          fontWeight: active ? 500 : 400,
        }}
      >
        <Icon size={14} />
        <span className="flex-1">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-none"
            style={{ background: 'var(--color-danger)', color: '#fff' }}
          >
            {badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <>
      {/* Barre du haut — MOBILE uniquement */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 h-12 z-30 flex items-center gap-2.5 px-3"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
      >
        <button onClick={() => setOpen(true)} aria-label="Menu" className="p-1.5 -ml-1.5 rounded-md">
          <Menu size={18} style={{ color: 'var(--color-text)' }} />
        </button>
        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-accent)' }}>
          <Cpu size={11} color="#fff" />
        </div>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Hdigiweb</span>
        {pendingCount > 0 && (
          <Link href="/reponses-a-valider" className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-semibold leading-none" style={{ background: 'var(--color-danger)', color: '#fff' }}>
            {pendingCount} à valider
          </Link>
        )}
      </header>

      {/* Fond sombre quand le tiroir est ouvert (mobile) */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)} />
      )}

      <aside
        className={`w-60 md:w-48 flex-shrink-0 flex flex-col h-full fixed md:static top-0 left-0 z-50 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
      >
        <div
          className="px-4 h-14 flex items-center gap-2.5"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div
            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-accent)' }}
          >
            <Cpu size={11} color="#fff" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold leading-tight truncate" style={{ color: 'var(--color-text)' }}>
              Hdigiweb
            </span>
            <span className="text-[10px] leading-tight" style={{ color: 'var(--color-muted)' }}>
              Agent IA
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" title="Agent actif" />
            <button onClick={() => setOpen(false)} className="md:hidden p-1 -mr-1" aria-label="Fermer">
              <X size={16} style={{ color: 'var(--color-muted)' }} />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
          {NAV_BEFORE_BELL.map(({ href, label, icon: Icon }) => renderLink(href, label, Icon))}
          {renderLink('/conversations', 'Messagerie', Inbox)}
          {renderLink('/reponses-a-valider', 'À valider', MessageSquare, pendingCount)}
          {NAV_AFTER_BELL.map(({ href, label, icon: Icon }) => renderLink(href, label, Icon))}
        </nav>

        <div className="px-2 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-[11px] px-2 mb-2" style={{ color: 'var(--color-muted-2)' }}>Toulouse · PME/TPE</p>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-2 text-gray-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </aside>
    </>
  )
}
