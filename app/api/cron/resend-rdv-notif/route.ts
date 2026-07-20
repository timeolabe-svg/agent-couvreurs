import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Renvoie la notification du DERNIER RDV confirmé, vers l'adresse de notif RÉELLE (champ UI
// agent_config.client_notif_email, sinon env). Sert à tester que le client reçoit bien.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql

  // Destinataires : champ UI d'abord, sinon env.
  let recipients: string[] = []
  try {
    const r = (await sql`SELECT value FROM agent_config WHERE key = 'client_notif_email' LIMIT 1`) as Array<{ value: string }>
    recipients = (r[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  } catch { /* ignore */ }
  if (recipients.length === 0) {
    recipients = (process.env.CLIENT_NOTIFY_EMAIL ?? 'contact@hdigiweb.fr').split(',').map(s => s.trim()).filter(Boolean)
  }
  if (recipients.length === 0) return NextResponse.json({ error: 'aucun destinataire de notif configuré' })

  // Dernier RDV confirmé + contact.
  const rows = (await sql`
    SELECT r.scheduled_at, r.notes, c.name, c.company, c.email, c.phone, c.city
    FROM rdv r LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'confirmed'
    ORDER BY r.created_at DESC LIMIT 1
  `) as Array<{ scheduled_at: string; notes: string | null; name: string | null; company: string | null; email: string | null; phone: string | null; city: string | null }>
  if (!rows[0]) return NextResponse.json({ error: 'aucun RDV confirmé à renvoyer' })
  const rdv = rows[0]

  const at = new Date(rdv.scheduled_at)
  const dateStr = at.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const who = rdv.name || rdv.company || rdv.email || 'Prospect'
  const text = [
    `[TEST] Vérification de l'adresse de notification.`,
    ``,
    `${who} (${rdv.company ?? ''}) a un rendez-vous confirmé.`,
    `Quand : ${dateStr} à ${timeStr}`,
    rdv.phone ? `Téléphone : ${rdv.phone}` : '',
    rdv.city ? `Ville : ${rdv.city}` : '',
    rdv.email ? `Email prospect : ${rdv.email}` : '',
    ``,
    `Agenda : https://agent-couvreurs.vercel.app/agenda`,
    ``,
    `(Si vous recevez ce message, l'adresse de notification fonctionne.)`,
  ].filter(Boolean).join('\n')

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ error: 'aucune boîte Gmail (IMAP_ACCOUNTS)', recipients })

  const results: string[] = []
  for (const to of recipients) {
    const r = await sendFromBox(boxes[0], { to, subject: `Nouveau rendez-vous — ${rdv.company ?? who}`, text, senderName: 'Agent Hdigiweb' }).catch((e) => ({ ok: false, from: boxes[0].email, error: String(e).slice(0, 80) }))
    results.push(`${to} → ${r.ok ? 'envoyé via ' + r.from : 'ÉCHEC: ' + (r.error ?? '')}`)
  }
  return NextResponse.json({ ok: true, rdv: { who, dateStr, timeStr }, recipients, results })
}
