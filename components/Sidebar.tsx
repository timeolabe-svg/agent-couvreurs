'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Megaphone, Mail, BarChart2 } from 'lucide-react'

const NAV = [
  { href: '/',           label: 'Vue d\'ensemble', icon: LayoutDashboard },
  { href: '/prospects',  label: 'Prospects',        icon: Users },
  { href: '/campagnes',  label: 'Campagnes',        icon: Megaphone },
  { href: '/emails',     label: 'Emails IA',        icon: Mail },
  { href: '/stats',      label: 'Statistiques',     icon: BarChart2 },
]

export default function Sidebar() {
  const path = usePathname()

  return (
    <aside
      className="w-52 flex-shrink-0 flex flex-col h-full"
      style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
    >
      <div className="px-4 h-14 flex items-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
          Selquia
        </span>
        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          Cold Email
        </span>
      </div>

      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path === href
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                color: active ? 'var(--color-text)' : 'var(--color-muted)',
                background: active ? 'var(--color-surface-2)' : 'transparent',
              }}
            >
              <Icon size={14} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="px-4 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Couvreurs · France</p>
      </div>
    </aside>
  )
}
