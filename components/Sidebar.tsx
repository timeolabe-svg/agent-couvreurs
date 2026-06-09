'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Calendar, Cpu, BarChart2, Megaphone, SlidersHorizontal, Bell, Brain, Users, LogOut } from 'lucide-react'
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

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/replies?status=pending&limit=50')
        if (!res.ok) return
        const json = await res.json() as { data: Array<{ draft: unknown | null }> }
        const count = (json.data ?? []).filter((item) => item.draft !== null).length
        setPendingCount(count)
      } catch {
        // ignore
      }
    }
    void load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const renderLink = (href: string, label: string, Icon: React.ElementType, badge?: number) => {
    const active = path === href || (href !== '/' && path.startsWith(href))
    return (
      <Link
        key={href}
        href={href}
        className="flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors"
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
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside
      className="w-48 flex-shrink-0 flex flex-col h-full"
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
        <div className="ml-auto" title="Agent actif">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {NAV_BEFORE_BELL.map(({ href, label, icon: Icon }) => renderLink(href, label, Icon))}
        {renderLink('/reponses-a-valider', 'À valider', Bell, pendingCount)}
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
  )
}
