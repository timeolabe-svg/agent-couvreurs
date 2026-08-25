/**
 * GET /api/cron/dedupe-rdv
 *
 * Supprime les RDV en DOUBLE : garde le plus ancien RDV confirmé par contact, supprime les autres.
 * Corrige la double-facturation (2 RDV pour le même prospect = client facturé 2x).
 * Idempotent. Protégé par cron-auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from "@/lib/cron-wrap"

export const dynamic = 'force-dynamic'

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const { sql } = await import('@/lib/db')

  /**
   * Garde le rendez-vous confirmé le plus ancien par contact, et ANNULE les doublons.
   *
   * ⚠️ ON N'EFFACE PLUS (audit croisé du 26/08, session Optimum). Ce cron faisait un `DELETE`.
   * Un rendez-vous porte de l'argent : c'est la ligne sur laquelle le client est facturé, et sur
   * laquelle se calcule la commission mensuelle des clients signés. La règle posée pour les clients
   * perdus vaut ici aussi — « un client perdu se DATE, ne se supprime jamais, sinon les factures
   * passées changent ».
   *
   * Et un doublon supprimé ne laisse aucune trace : impossible de savoir, après coup, si le
   * dédoublonnage a bien visé les bonnes lignes. En passant en `cancelled`, la ligne reste lisible,
   * elle sort des compteurs (qui excluent désormais les annulés) et la décision est réversible.
   */
  const annules = (await sql`
    UPDATE rdv SET status = 'cancelled',
      notes = COALESCE(notes, '') || ' [doublon annulé automatiquement le ' || to_char(NOW(), 'DD/MM/YYYY') || ']'
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at ASC) AS rn
        FROM rdv
        WHERE status = 'confirmed' AND contact_id IS NOT NULL
      ) t WHERE t.rn > 1
    )
    RETURNING id, contact_id
  `) as Array<{ id: string; contact_id: string }>

  return NextResponse.json({
    ok: true,
    annules: annules.length,
    ids: annules.map(d => d.id),
    lecture: 'Les doublons sont ANNULÉS, jamais supprimés : un rendez-vous porte de la facturation, et une suppression ne laisse aucune trace vérifiable.',
  })
}

/** Enveloppe d erreur + battement (cf. lib/cron-wrap.ts, audit 09/08). */
export const GET = wrapCron('dedupe-rdv', handler)
