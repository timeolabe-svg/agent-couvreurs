'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Calendar, Cpu, Settings, BarChart2 } from 'lucide-react'

const NAV = [
  { href: '/',          label: 'Suivi leads', icon: LayoutDashboard },
  { href: '/agenda',    label: 'Agenda',      icon: Calendar },
  { href: '/stats',     label: 'Analytique',  icon: BarChart2 },
  { href: '/agent',     label: 'Agent IA',    icon: Cpu },
  { href: '/campagnes', label: 'Campagnes',   icon: Settings },
]

export default function Sidebar() {
  const path = usePathname()

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
        {NAV.map(({ href, label, icon: Icon }) => {
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
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-[11px]" style={{ color: 'var(--color-muted-2)' }}>Toulouse · PME/TPE</p>
      </div>
    </aside>
  )
}
