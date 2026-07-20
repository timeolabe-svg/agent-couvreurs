import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// ONE-SHOT : repasse en 'proposed' les RDV qui avaient été CALÉS AUTOMATIQUEMENT sur un créneau
// que le prospect n'avait jamais accepté (note "Aucune date précisée — prochain créneau..."). Ces
// RDV inventés ne doivent plus compter comme calés ; l'agent re-proposera un créneau et attendra le oui.
// ?apply=1 pour exécuter (sinon dry-run).
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  try {
    const targets = (await sql`
      SELECT r.id, r.scheduled_at, c.email, c.company
      FROM rdv r LEFT JOIN contacts c ON c.id = r.contact_id
      WHERE r.status = 'confirmed' AND r.notes ILIKE '%Aucune date précisée%'
      ORDER BY r.created_at DESC
    `) as Array<Record<string, unknown>>

    if (!apply) return NextResponse.json({ dry_run: true, a_corriger: targets.length, exemples: targets.slice(0, 20) })

    const updated = (await sql`
      UPDATE rdv SET status = 'proposed'
      WHERE status = 'confirmed' AND notes ILIKE '%Aucune date précisée%'
      RETURNING id
    `) as Array<{ id: string }>

    // Supprime les brouillons NON ENVOYÉS (scheduled/pending) des contacts dont le RDV a été
    // inventé (note "Aucune date précisée", désormais 'proposed') : rédigés par l'ancien code, ils
    // CONFIRMENT le créneau inventé ("comme convenu") → ne surtout pas les envoyer. Une fois
    // supprimés, conversation-followups régénère une vraie PROPOSITION oui/non. (Jamais les 'sent'.)
    const del = (await sql`
      DELETE FROM reply_drafts rd
      USING incoming_replies ir
      WHERE rd.incoming_reply_id = ir.id
        AND rd.status IN ('scheduled', 'pending')
        AND ir.contact_id IN (
          SELECT contact_id FROM rdv WHERE status = 'proposed' AND notes ILIKE '%Aucune date précisée%'
        )
      RETURNING rd.id
    `) as Array<{ id: string }>
    return NextResponse.json({ ok: true, repasses_en_proposed: updated.length, brouillons_non_envoyes_supprimes: del.length })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
