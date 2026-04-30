'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Mail,
  BarChart2,
  Zap,
} from 'lucide-react'

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/prospects', label: 'Prospects', icon: Users },
  { href: '/campagnes', label: 'Campagnes', icon: Megaphone },
  { href: '/emails', label: 'Emails IA', icon: Mail },
  { href: '/stats', label: 'Stats', icon: BarChart2 },
]

export default function Sidebar() {
  const path = usePathname()

  return (
    <aside
      style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
      className="w-56 flex-shrink-0 flex flex-col h-full"
    >
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-accent)', boxShadow: '0 0 16px var(--color-accent-glow)' }}
        >
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Selquia
          </div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Agent Couvreurs
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                color: active ? 'var(--color-text)' : 'var(--color-muted)',
                background: active ? 'var(--color-surface-2)' : 'transparent',
                borderLeft: active ? '2px solid var(--color-accent)' : '2px solid transparent',
              }}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Demo badge */}
      <div className="px-4 pb-4">
        <div
          className="px-3 py-2 rounded-lg text-xs text-center"
          style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)', border: '1px solid var(--color-accent-dim)' }}
        >
          Mode Démo
        </div>
      </div>
    </aside>
  )
}
