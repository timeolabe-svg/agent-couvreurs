import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * REMET CHAQUE RELANCE EN ATTENTE SUR LA BOÎTE QUI A RÉELLEMENT ENVOYÉ LE PREMIER MAIL.
 *
 * Le correctif dans send-campaign aligne les fils à partir de maintenant. Celui-ci répare le passé :
 * tous les contacts dont le step 0 est parti d'une boîte différente de celle assignée traînent des
 * relances pointant vers la mauvaise adresse. Elles partiraient telles quelles.
 *
 * ⚠️ Ce que ça évite, vu du prospect : recevoir le premier message de gabin@hdigiweb-agence.com puis
 * la relance de gabin@hdigiweb-digital.com. Chez lui c'est un fil cassé et un inconnu qui relance —
 * donc de l'indésirable. Et sa réponse repart vers une boîte qui n'a pas l'historique.
 *
 * On ne touche QUE les lignes 'queued'/'pending' : un mail déjà parti l'est.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  // Le step 0 réellement envoyé fait foi (`sent_via`), pas l'intention (`from_email`).
  const desalignees = (await sql`
    SELECT r.id, r.contact_id, r.sequence_step, r.from_email AS boite_prevue, s.sent_via AS boite_reelle
    FROM email_queue r
    JOIN (
      SELECT DISTINCT ON (contact_id) contact_id, sent_via
      FROM email_queue
      WHERE status = 'sent' AND sequence_step = 0 AND sent_via IS NOT NULL
      ORDER BY contact_id, sent_at DESC
    ) s ON s.contact_id = r.contact_id
    WHERE r.sequence_step > 0
      AND r.status IN ('queued', 'pending')
      AND r.from_email IS DISTINCT FROM s.sent_via
  `) as Array<{ id: string; contact_id: string; sequence_step: number; boite_prevue: string; boite_reelle: string }>

  if (apply && desalignees.length > 0) {
    await sql`
      UPDATE email_queue r SET from_email = s.sent_via
      FROM (
        SELECT DISTINCT ON (contact_id) contact_id, sent_via
        FROM email_queue
        WHERE status = 'sent' AND sequence_step = 0 AND sent_via IS NOT NULL
        ORDER BY contact_id, sent_at DESC
      ) s
      WHERE r.contact_id = s.contact_id
        AND r.sequence_step > 0
        AND r.status IN ('queued', 'pending')
        AND r.from_email IS DISTINCT FROM s.sent_via
    `
  }

  const contacts = new Set(desalignees.map(d => d.contact_id))

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    relances_desalignees: desalignees.length,
    contacts_concernes: contacts.size,
    exemples: desalignees.slice(0, 10).map(d => `étape ${d.sequence_step} : ${d.boite_prevue} → ${d.boite_reelle}`),
    lecture: desalignees.length === 0
      ? 'Chaque relance en attente part bien de la boîte qui a envoyé le premier mail.'
      : `${contacts.size} fil(s) auraient été relancés depuis une autre adresse que celle du premier contact.`,
  })
}
