import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/Sidebar'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Hdigiweb — Agent IA Prospection',
  description: 'Agent IA de cold emailing pour Hdigiweb — PME/TPE Toulouse & Occitanie',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={geist.variable}>
      <body style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
      </body>
    </html>
  )
}
