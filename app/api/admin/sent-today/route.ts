import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 30

/** Ce qui est réellement PARTI aujourd'hui (sent_at), avec les sujets pour vérifier la version. */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { db } = await import('@/lib/db')
  const { sql } = await import('drizzle-orm')

  const rows = await db.execute(sql`
    SELECT q.subject, q.sent_at, c.email, q.sequence_step
    FROM email_queue q
    JOIN contacts c ON c.id = q.contact_id
    WHERE q.status = 'sent' AND q.sent_at::date = CURRENT_DATE
    ORDER BY q.sent_at DESC
  `)
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])
  return NextResponse.json({ ok: true, envoyes_aujourdhui: list.length, mails: list })
}
