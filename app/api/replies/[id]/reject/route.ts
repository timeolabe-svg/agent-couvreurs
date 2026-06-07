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

  await db.update(reply_drafts).set({ status: 'rejected' }).where(eq(reply_drafts.id, id))
  return NextResponse.json({ ok: true })
}
