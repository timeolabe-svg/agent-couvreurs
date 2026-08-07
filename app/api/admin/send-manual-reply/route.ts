import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'

/** Envoi manuel ponctuel d'une réponse (hors moteur automatique), pour un cas précis validé par Timéo. */
export async function POST(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to, subject, body, fromEmail } = await request.json()
  if (!to || !subject || !body) return NextResponse.json({ error: 'missing to/subject/body' }, { status: 400 })

  const boxes = getGmailBoxes()
  const box = boxes.find(b => b.email.toLowerCase() === (fromEmail ?? '').toLowerCase()) ?? boxes[0]
  if (!box) return NextResponse.json({ error: 'no box available' }, { status: 500 })

  const r = await sendFromBox(box, { to, subject, text: body, senderName: 'Gabin' })
  return NextResponse.json({ ok: r.ok, error: r.error, from: box.email, to })
}
