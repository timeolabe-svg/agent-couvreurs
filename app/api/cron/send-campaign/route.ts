/**
 * GET /api/cron/send-campaign
 *
 * MOTEUR D'ENVOI MAISON — remplace Instantly pour l'ENVOI (Instantly ne sert plus
 * qu'au warmup). Lit la file email_queue (mails dus), envoie via les boîtes Google
 * chauffées (SMTP smtp.gmail.com) en rotation, plafond DAILY_CAP_PER_BOX/boîte/jour.
 * Aucune limite de leads (contrairement à Instantly, plafonné à 1000 contacts uploadés).
 *
 * À brancher sur cron-job.org toutes les 5-10 min. Chaque run envoie jusqu'à MAX_PER_RUN mails.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox, type GmailBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cible client : boîtes déjà chauffées → 35/boîte/jour (× 4 boîtes = 140/jour).
const DAILY_CAP_PER_BOX = 35
const MAX_PER_RUN = 15 // ~15 × 2s = 30s < 60s

interface DueRow {
  id: string
  subject: string
  body: string
  sequence_step: number
  campaign_id: string
  from_email: string
  email: string
  name: string | null
  company: string | null
  city: string | null
}

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const { sql } = await import('@/lib/db')

  try {
    const boxes = getGmailBoxes()
    if (boxes.length === 0) {
      return NextResponse.json({ error: 'aucune boîte Gmail configurée (IMAP_ACCOUNTS)' }, { status: 500 })
    }

    // Colonne de traçage de la boîte émettrice (idempotent).
    await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS sent_via TEXT`

    // Capacité restante par boîte aujourd'hui.
    const sentToday = (await sql`
      SELECT sent_via, COUNT(*)::int AS n
      FROM email_queue
      WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sent_via IS NOT NULL
      GROUP BY sent_via
    `) as Array<{ sent_via: string; n: number }>
    const usedByBox = new Map(sentToday.map(r => [r.sent_via, r.n]))
    const capacity = new Map(boxes.map(b => [b.email, DAILY_CAP_PER_BOX - (usedByBox.get(b.email) ?? 0)]))
    const totalCapacity = [...capacity.values()].reduce((s, c) => s + Math.max(0, c), 0)

    const results: string[] = []
    results.push(`Boîtes: ${boxes.length} | capacité restante aujourd'hui: ${totalCapacity}`)
    if (totalCapacity <= 0) {
      return NextResponse.json({ ok: true, sent: 0, results: [...results, 'Plafond quotidien atteint sur toutes les boîtes'] })
    }

    // Mails dus (step le plus ancien d'abord), non encore envoyés.
    const limit = Math.min(MAX_PER_RUN, totalCapacity)
    const due = (await sql`
      SELECT eq.id, eq.subject, eq.body, eq.sequence_step, eq.campaign_id, eq.from_email,
             c.email, c.name, c.company, c.city
      FROM email_queue eq
      JOIN contacts c ON c.id = eq.contact_id
      WHERE eq.status IN ('queued', 'queued_instantly')
        AND eq.scheduled_at <= NOW()
        AND c.email IS NOT NULL
        -- ANTI-RÉPÉTITION : ne JAMAIS envoyer à un contact qui a déjà répondu
        -- (hors absence auto 'oof' et spam).
        AND NOT EXISTS (
          SELECT 1 FROM incoming_replies ir
          WHERE LOWER(ir.from_email) = LOWER(c.email)
            AND (ir.classification IS NULL OR ir.classification NOT IN ('oof', 'spam'))
        )
        -- OPT-OUT / BOUNCE : ne jamais envoyer à une adresse ou un domaine blocklisté.
        AND NOT EXISTS (
          SELECT 1 FROM blocklist b
          WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
             OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
        )
      ORDER BY eq.scheduled_at ASC
      LIMIT ${limit}
    `) as DueRow[]

    results.push(`Mails dus à traiter: ${due.length}`)

    let sent = 0, skipped = 0, failed = 0

    // Sélection de boîte : on PRÉFÈRE la boîte assignée (from_email) pour que la
    // signature du corps colle à l'enveloppe ; sinon repli sur une boîte dispo.
    const pickBox = (preferred: string): GmailBox | null => {
      const pref = boxes.find(b => b.email.toLowerCase() === preferred.toLowerCase() && (capacity.get(b.email) ?? 0) > 0)
      if (pref) return pref
      return boxes.find(b => (capacity.get(b.email) ?? 0) > 0) ?? null
    }

    for (const row of due) {
      if (!row.subject || !row.body) {
        await sql`UPDATE email_queue SET status = 'skipped' WHERE id = ${row.id}`
        skipped++; continue
      }

      let box = pickBox(row.from_email)
      if (!box) { results.push('Plus de capacité en cours de run'); break }

      // 1) Corrige une salutation qui utilise le nom d'entreprise ou un nom en MAJUSCULES
      //    (ex: "Bonjour VISION," / "Bonjour BROCAL,") → "Bonjour,".
      let finalBody = row.body
      const g = finalBody.match(/^\s*Bonjour\s+([^,\n]+),/i)
      if (g) {
        const nm = g[1].trim()
        const comp = (row.company ?? '').toLowerCase()
        const isCompany = comp && (comp.includes(nm.toLowerCase()) || nm.toLowerCase().includes(comp.slice(0, 6)))
        const isAllCaps = nm.length > 1 && nm === nm.toUpperCase()
        if (isCompany || isAllCaps) {
          finalBody = finalBody.replace(/^\s*Bonjour\s+[^,\n]+,/i, 'Bonjour,')
        }
      }

      // 2) Garantit un opt-out sur CHAQUE mail (RGPD + délivrabilité). Reply-based.
      if (!/stop|désabonn|désinscri|ne plus recevoir|unsubscribe/i.test(finalBody)) {
        finalBody = `${finalBody}\n\n---\nPour ne plus recevoir mes emails, répondez simplement "Stop".`
      }

      const senderName = getInboxSenderName(box.email)
      let r = await sendFromBox(box, { to: row.email, subject: row.subject, text: finalBody, senderName })

      // Boîte HS (535 BadCredentials / mdp d'application invalide) → désactivée ce run, retry ailleurs.
      if (!r.ok && /BadCredentials|Invalid login|535/.test(r.error ?? '')) {
        results.push(`⚠ boîte HS: ${box.email} (mdp d'application invalide) — désactivée ce run`)
        capacity.set(box.email, 0)
        const alt = boxes.find(b => (capacity.get(b.email) ?? 0) > 0)
        if (alt) {
          box = alt
          r = await sendFromBox(alt, { to: row.email, subject: row.subject, text: finalBody, senderName: getInboxSenderName(alt.email) })
        }
      }

      if (r.ok) {
        await sql`UPDATE email_queue SET status = 'sent', sent_at = NOW(), sent_via = ${box.email}, body = ${finalBody} WHERE id = ${row.id}`
        capacity.set(box.email, (capacity.get(box.email) ?? 1) - 1)
        sent++
        results.push(`✓ step ${row.sequence_step} → ${row.email} via ${box.email}`)

        // Trace pour les stats / dashboard (compte les VRAIS envois).
        try {
          await sql`
            INSERT INTO dashboard_events (type, data)
            VALUES ('email_sent', ${JSON.stringify({
              contactEmail: row.email, company: row.company, city: row.city,
              campaignId: row.campaign_id, sequenceStep: row.sequence_step,
              subject: row.subject, sentVia: box.email,
            })}::jsonb)
          `
        } catch { /* non-bloquant */ }
      } else {
        failed++
        results.push(`✗ ${row.email} via ${box.email}: ${(r.error ?? '').slice(0, 90)}`)
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, results })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 400) : undefined },
      { status: 500 },
    )
  }
}
