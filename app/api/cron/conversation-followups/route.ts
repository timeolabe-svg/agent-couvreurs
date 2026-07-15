import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// RELANCE DES CONVERSATIONS SILENCIEUSES.
// Après que l'agent a répondu à un prospect intéressé, si celui-ci ne répond plus,
// on ne le laisse pas mourir : on remet UNE relance en file (email_queue), que
// send-campaign enverra avec TOUTES ses protections anti-boucle (claim atomique,
// anti-doublon, plafond 4/contact, blocklist, dédup step). Aucun envoi direct ici.
//
// Garde-fous : uniquement les vraies conversations (interest/question/objection/rdv),
// silencieuses depuis >= SILENCE_DAYS, pas blocklistées, sans RDV calé, et MAX 2
// relances de conversation par contact (steps 20/21). La relance est annulée
// automatiquement (cancelSteps) dès que le prospect répond.

const SILENCE_DAYS = 3
const MAX_CONVO_RELANCES = 2
const MAX_PER_RUN = 20

export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  if (process.env.SEND_PAUSED === '1') return NextResponse.json({ ok: true, paused: true })

  sql = (await import('@/lib/db')).sql

  const [campaign] = (await sql`SELECT id FROM campaigns WHERE status = 'active' LIMIT 1`) as Array<{ id: string }>
  if (!campaign) return NextResponse.json({ ok: true, reason: 'aucune campagne active' })

  // Candidats : conversations réelles, silencieuses après NOTRE dernier message.
  const rows = (await sql`
    SELECT c.id, c.email, c.company, c.name,
      (SELECT eq.from_email FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.from_email IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS owner_box,
      (SELECT eq.subject FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent' AND eq.subject IS NOT NULL ORDER BY eq.sent_at DESC LIMIT 1) AS last_subject,
      GREATEST(
        COALESCE((SELECT MAX(eq.sent_at) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.status = 'sent'), TIMESTAMP 'epoch'),
        COALESCE((SELECT MAX(rd.sent_at) FROM reply_drafts rd JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id WHERE ir.contact_id = c.id AND rd.status = 'sent'), TIMESTAMP 'epoch')
      ) AS last_out,
      COALESCE((SELECT MAX(ir.created_at) FROM incoming_replies ir WHERE ir.contact_id = c.id), TIMESTAMP 'epoch') AS last_in,
      (SELECT COUNT(*) FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status = 'sent')::int AS convo_relances
    FROM contacts c
    WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id AND ir.classification IN ('interest','question','objection','rdv_request'))
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id AND r.status = 'confirmed')
      AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step >= 20 AND eq.status IN ('pending','queued','sending'))
    LIMIT 200
  `) as Array<{ id: string; email: string; company: string; name: string | null; owner_box: string | null; last_subject: string | null; last_out: string; last_in: string; convo_relances: number }>

  const now = Date.now()
  const cutoff = now - SILENCE_DAYS * 86400000
  const due = rows.filter(r => {
    const out = new Date(r.last_out).getTime()
    const inn = new Date(r.last_in).getTime()
    return out > inn                    // la balle est dans leur camp (on a parlé en dernier)
      && out <= cutoff                  // silence depuis >= SILENCE_DAYS
      && r.convo_relances < MAX_CONVO_RELANCES
      && !!r.owner_box                  // on connaît la boîte qui suit la conversation
  }).slice(0, MAX_PER_RUN)

  let queued = 0
  const results: string[] = []
  for (const r of due) {
    const step = 20 + r.convo_relances // 20 puis 21
    const name = (r.name && r.name.trim()) ? `M. ${r.name.trim().split(/\s+/).slice(-1)[0]}` : ''
    const greeting = name ? `Bonjour ${name},` : 'Bonjour,'
    const subject = r.last_subject ? (r.last_subject.startsWith('Re:') ? r.last_subject : `Re: ${r.last_subject}`) : 'Re: votre visibilité sur Google'
    const body = r.convo_relances === 0
      ? `${greeting}

Je reviens vers vous, je n'ai pas eu de retour. Avez-vous eu le temps d'y réfléchir ?

Pour rappel, le premier mois est offert, sans engagement : vous testez et vous voyez ce que ça donne avant de payer quoi que ce soit.

Quelques minutes pour en parler, plutôt en début ou en fin de semaine ?

Bien à vous,

Gabin
Hdigiweb
${r.owner_box}
---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`
      : `${greeting}

Dernier message de ma part. Si vous voulez tester sans risque, le premier mois reste offert et sans engagement, vous ne payez que si les résultats vous convainquent.

Un mot de votre part et on lance ça.

Bien à vous,

Gabin
Hdigiweb
${r.owner_box}
---
Pour ne plus recevoir mes emails, répondez simplement "Stop".`

    try {
      await sql`
        INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
        VALUES (${r.id}, ${campaign.id}, ${step}, ${r.owner_box}, ${subject}, ${body}, 'queued', NOW())
      `
      queued++
      results.push(`↻ relance conversation → ${r.email} (relance ${r.convo_relances + 1}/${MAX_CONVO_RELANCES})`)
    } catch (e) {
      results.push(`✗ ${r.email}: ${String(e).slice(0, 60)}`)
    }
  }

  return NextResponse.json({ ok: true, candidats: rows.length, dus: due.length, mis_en_file: queued, results })
}
