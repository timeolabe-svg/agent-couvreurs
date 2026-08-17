import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true, _demo: true })
  }
  const { db } = await import('@/lib/db')
  const { reply_drafts } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  // ⚠️ On TRACE que c'est Timéo qui rejette, pas la machine. Sans cette marque, le rattrapage
    // régénérait le brouillon quelques minutes plus tard : un refus humain contourné par un cron.
    await db.update(reply_drafts).set({ status: 'rejected', rejete_par: 'humain', rejete_le: new Date() }).where(eq(reply_drafts.id, id))
  return NextResponse.json({ ok: true })
}
