import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { cleanIncomingBody } from '@/lib/decode-body'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

let sql!: NeonQueryFunction<false, false>

// Détection "carte blanche" (même règle que le poll), formes interrogatives incluses.
function isOpenCallRequest(text: string): boolean {
  const t = (text || '').toLowerCase().replace(/[’‘`´]/g, "'")
  if (/\b(non|pas maintenant|plus tard|arr[êe]tez)\b/.test(t)) return false
  return /(appel(ez|e|er)[- ]?moi|rappel(ez|e|er)[- ]?moi|veuillez m'?appeler|veiller m'?appeler|me contacter|contactez[- ]?moi|vous pouvez m'?appeler|quand vous (voulez|voudrez|le souhaitez|souhaitez)|[àa] votre convenance|n'?importe quand|quand [çc]a vous arrange|je suis (dispo|disponible|joignable)|(pouvez|pourriez|peux|peut)[- ]?(vous|tu)?\s*m'?(appeler|e (rappeler|contacter|joindre))|possible de m'?(appeler|e (rappeler|contacter))|j'?(aimerais|souhaite|voudrais) (qu'?on m'?appelle|[êe]tre (rappel[ée]|contact[ée])))/.test(t)
}

// RATTRAPAGE : leads qui ont demandé à être rappelés mais qui n'ont AUCUN RDV confirmé.
// On cale le RDV au prochain créneau libre, on envoie une confirmation au prospect, on notifie
// le client. ?apply=1 pour exécuter (sinon dry-run).
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  const rows = (await sql`
    SELECT DISTINCT ON (c.id) c.id, c.email, c.company, c.name, c.phone,
           ir.id AS reply_id, ir.body, ir.subject
    FROM contacts c
    JOIN incoming_replies ir ON ir.contact_id = c.id
    WHERE ir.created_at > NOW() - INTERVAL '21 days'
      AND ir.classification IN ('rdv_request', 'interest', 'question')
      AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
    ORDER BY c.id, ir.created_at DESC
  `) as Array<{ id: string; email: string; company: string | null; name: string | null; phone: string | null; reply_id: string; body: string; subject: string | null }>

  const full = (r: { subject?: string | null; body?: string | null }) => `${r.subject ?? ''}\n${cleanIncomingBody(r.body || '')}`
  const cibles = rows.filter(r => isOpenCallRequest(full(r)))

  if (!apply) {
    return NextResponse.json({
      dry_run: true, a_traiter: cibles.length,
      leads: cibles.map(r => ({ company: r.company, phone: r.phone, extrait: full(r).replace(/\s+/g, ' ').slice(0, 70) })),
    })
  }

  const { getAvailability, findNextAvailableSlot } = await import('@/lib/availability')
  const availability = await getAvailability()
  const boxes = getGmailBoxes()

  let recipients: string[] = []
  try {
    const r = (await sql`SELECT value FROM agent_config WHERE key = 'client_notif_email' LIMIT 1`) as Array<{ value: string }>
    recipients = (r[0]?.value ?? '').split(',').map(s => s.trim()).filter(Boolean)
  } catch { /* ignore */ }
  if (recipients.length === 0) recipients = (process.env.CLIENT_NOTIFY_EMAIL ?? '').split(',').map(s => s.trim()).filter(Boolean)

  const results: string[] = []
  for (const c of cibles) {
    try {
      const busy = (await sql`SELECT scheduled_at FROM rdv WHERE status = 'confirmed' AND scheduled_at > NOW() - INTERVAL '1 day'`) as Array<{ scheduled_at: string }>
      const slot = findNextAvailableSlot(null, availability, busy.map(b => b.scheduled_at))
      const dateStr = slot.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      const timeStr = slot.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

      await sql`INSERT INTO rdv (contact_id, incoming_reply_id, scheduled_at, duration_min, status, notes)
        VALUES (${c.id}, ${c.reply_id}, ${slot.toISOString()}, ${availability.slotDurationMin || 30}, 'confirmed', ${'RDV — le prospect a demandé à être rappelé, calé au prochain créneau.'})`

      // Confirmation au prospect (déterministe : on parle en notre nom, on ne répète pas son numéro).
      const [ob] = (await sql`SELECT from_email FROM email_queue WHERE contact_id = ${c.id} AND status = 'sent' AND from_email IS NOT NULL ORDER BY sent_at DESC LIMIT 1`) as Array<{ from_email: string }>
      const box = ob?.from_email || boxes[0]?.email || 'contact@hdigiweb.fr'
      const nom = c.name?.trim() ? ` M. ${c.name.trim().split(/\s+/).slice(-1)[0]}` : ''
      const body = `Bonjour${nom},\n\nParfait, je vous rappelle ${dateStr} à ${timeStr}.\n\nSi ce moment ne vous convient pas, dites-moi simplement un autre créneau et je m'adapte.\n\nBien à vous,\n\nGabin\nHdigiweb\n${box}`
      await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status, send_after) VALUES (${c.reply_id}, ${body}, 'scheduled', NOW())`

      if (boxes.length > 0) {
        const text = [
          `${c.name || c.company || c.email} a demandé à être rappelé.`,
          `Quand : ${dateStr} à ${timeStr}`,
          c.phone ? `Téléphone : ${c.phone}` : '',
          `Email : ${c.email}`,
          ``,
          `Agenda : https://agent-couvreurs.vercel.app/agenda`,
        ].filter(Boolean).join('\n')
        for (const to of recipients) {
          await sendFromBox(boxes[0], { to, subject: `Nouveau rendez-vous — ${c.company ?? c.email}`, text, senderName: 'Agent Hdigiweb' }).catch(() => {})
        }
      }
      results.push(`✓ ${c.company ?? c.email} → RDV ${dateStr} ${timeStr} + confirmation envoyée`)
    } catch (e) {
      results.push(`✗ ${c.email}: ${String(e).slice(0, 60)}`)
    }
  }
  return NextResponse.json({ ok: true, traites: results.length, results })
}
