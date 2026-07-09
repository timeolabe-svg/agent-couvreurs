import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'
import SessionProvider from '@/components/SessionProvider'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Hdigiweb — Agent IA Prospection',
  description: 'Agent IA de cold emailing pour Hdigiweb — PME/TPE Toulouse & Occitanie',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={geist.variable}>
      <body style={{ height: '100dvh', overflow: 'hidden' }} className="flex">
        <SessionProvider>
          <Sidebar />
          {/* pt-12 sur mobile = place pour le header fixe ; 0 sur desktop */}
          <main className="flex-1 overflow-y-auto min-w-0 pt-12 md:pt-0">{children}</main>
        </SessionProvider>
      </body>
    </html>
  )
}
