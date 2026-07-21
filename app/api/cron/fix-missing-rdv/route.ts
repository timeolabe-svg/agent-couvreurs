import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { cleanIncomingBody } from '@/lib/decode-body'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

let sql!: NeonQueryFunction<false, false>

// Même détection que le poll : le prospect a donné carte blanche pour l'appel.
function isOpenCallRequest(text: string): boolean {
  const t = (text || '').toLowerCase().replace(/[’‘`´]/g, "'") // apostrophes courbes (iPhone/Outlook) normalisées
  if (/\b(non|pas maintenant|plus tard|arr[êe]tez)\b/.test(t)) return false
  return /(appel(ez|e|er)[- ]?moi|rappel(ez|e|er)[- ]?moi|veuillez m'?appeler|veiller m'?appeler|me contacter|contactez[- ]?moi|vous pouvez m'?appeler|quand vous (voulez|voudrez|le souhaitez|souhaitez)|[àa] votre convenance|n'?importe quand|quand [çc]a vous arrange|je suis (dispo|disponible|joignable))/.test(t)
}

// RATTRAPAGE one-shot : cale un RDV pour les leads qui ont demandé à être rappelés (carte blanche)
// mais qui n'ont AUCUN RDV confirmé (l'agent s'était contenté de proposer). ?apply=1 pour exécuter.
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  const rows = (await sql`
    SELECT DISTINCT ON (c.id) c.id, c.email, c.company, c.name, c.phone, ir.id AS reply_id, ir.body, ir.subject, ir.created_at
    FROM contacts c
    JOIN incoming_replies ir ON ir.contact_id = c.id
    WHERE ir.created_at > NOW() - INTERVAL '14 days'
      AND ir.classification IN ('rdv_request', 'interest')
      AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    ORDER BY c.id, ir.created_at DESC
  `) as Array<{ id: string; email: string; company: string | null; name: string | null; phone: string | null; reply_id: string; body: string; subject: string | null; created_at: string }>

  // Objet + corps : le message est souvent écrit DANS L'OBJET (mobile), le corps ne contenant que
  // la signature ("Envoyé de mon iPhone"). En ne lisant que le corps, on rate complètement la demande.
  const full = (r: { subject?: string | null; body?: string | null }) => `${r.subject ?? ''}\n${cleanIncomingBody(r.body || '')}`
  const candidats = rows.filter(r => isOpenCallRequest(full(r)))
  if (!apply) {
    return NextResponse.json({ dry_run: true, a_caler: candidats.length, leads: candidats.map(c => ({ company: c.company, email: c.email, phone: c.phone, extrait: full(c).replace(/\s+/g, ' ').slice(0, 70) })) })
  }

  const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
  const availability = await getAvailability()

  // Destinataires de notif (champ UI en priorité).
  let recipients: string[] = []
  try {
    const r = (await sql`SELECT value FROM agent_config WHERE key = 'client_notif_email' LIMIT 1`) as Array<{ value: string }>
    recipients = (r[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  } catch { /* ignore */ }
  if (recipients.length === 0) recipients = (process.env.CLIENT_NOTIFY_EMAIL ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const boxes = getGmailBoxes()

  const results: string[] = []
  for (const c of candidats) {
    try {
      const slot = findNextAvailableSlot(null, availability)
      await sql`INSERT INTO rdv (contact_id, incoming_reply_id, scheduled_at, duration_min, status, notes)
        VALUES (${c.id}, ${c.reply_id}, ${slot.toISOString()}, ${availability.slotDurationMin || 30}, 'confirmed', ${'RDV — le prospect a demandé à être rappelé (carte blanche), calé au prochain créneau.'})`
      const dateStr = slot.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      const timeStr = slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      if (boxes.length > 0) {
        const text = [
          `${c.name || c.company || c.email} a demandé à être rappelé.`,
          `Quand : ${dateStr} à ${timeStr}`,
          c.phone ? `Téléphone : ${c.phone}` : '',
          `Email : ${c.email}`,
          ``,
          `Message reçu : "${full(c).replace(/\s+/g, ' ').slice(0, 200)}"`,
          ``,
          `Agenda : https://agent-couvreurs.vercel.app/agenda`,
        ].filter(Boolean).join('\n')
        for (const to of recipients) {
          await sendFromBox(boxes[0], { to, subject: `Nouveau rendez-vous — ${c.company ?? c.email}`, text, senderName: 'Agent Hdigiweb' }).catch(() => {})
        }
      }
      results.push(`✓ RDV calé ${dateStr} ${timeStr} → ${c.company ?? c.email}`)
    } catch (e) {
      results.push(`✗ ${c.email}: ${String(e).slice(0, 60)}`)
    }
  }
  return NextResponse.json({ ok: true, cales: results.length, results })
}
