import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * CLASSE EN LOT LES RENDEZ-VOUS QUE PERSONNE N'A CLASSÉS.
 *
 * Le classement commercial (`crm_stage`) appartient au client : c'est lui qui sait si le rendez-vous
 * a donné quelque chose. Sauf qu'il ne le fait pas — les dix rendez-vous livrés depuis juin étaient
 * tous restés « à venir », y compris celui du 22 juin. Or la facturation ne compte QUE les
 * rendez-vous classés : le tableau de bord affichait donc 0 € pour dix rendez-vous réellement
 * livrés, et Timéo ne pouvait rien facturer.
 *
 * ⚠️ CE POINT D'ENTRÉE NE DEVINE RIEN. Il applique l'étape que Timéo demande, aux rendez-vous
 * PASSÉS restés « à venir », et il la montre avant de l'écrire. Décider à sa place qu'un rendez-vous
 * a été « qualifié » ou « perdu » reviendrait à fabriquer un chiffre d'affaires ou à en effacer un.
 *
 *   (défaut)                 aperçu, rien n'est écrit
 *   ?etape=non_qualifie&apply=1   applique
 *   &motif=...               raison, conservée uniquement pour « non_qualifie »
 */

const ETAPES_VALIDES = ['a_venir', 'qualifie', 'signe', 'perdu', 'non_qualifie']

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const etape = req.nextUrl.searchParams.get('etape') ?? 'non_qualifie'
  const motif = req.nextUrl.searchParams.get('motif') ?? ''
  const apply = req.nextUrl.searchParams.get('apply') === '1'
  if (!ETAPES_VALIDES.includes(etape)) {
    return NextResponse.json({ error: `étape inconnue : ${etape}`, valides: ETAPES_VALIDES }, { status: 400 })
  }

  const { sql } = await import('@/lib/db')

  /**
   * ⚠️ ON NE TOUCHE QU'AUX RENDEZ-VOUS PASSÉS ET NON CLASSÉS. Un rendez-vous à venir n'a pas encore
   * eu lieu, et un rendez-vous déjà classé porte une décision du client — l'écraser en lot
   * effacerait un chiffre d'affaires signé sans que personne s'en aperçoive.
   */
  /**
   * ⚠️ Ciblage nominatif possible : un classement en lot se trompe forcément sur un cas ou deux,
   * et il faut pouvoir le défaire sans toucher aux autres. PRO RÉNOV a été classé à tort le 25/08.
   */
  const entreprise = req.nextUrl.searchParams.get("entreprise")

  const cibles = entreprise
    ? (await sql`
        SELECT r.id, r.scheduled_at, r.status, r.crm_stage, c.company
        FROM rdv r JOIN contacts c ON c.id = r.contact_id
        WHERE c.company ILIKE ${"%" + entreprise + "%"}
        ORDER BY r.scheduled_at ASC
      `) as Array<{ id: string; scheduled_at: string; status: string; crm_stage: string | null; company: string }>
    : (await sql`
    SELECT r.id, r.scheduled_at, r.status, r.crm_stage, c.company
    FROM rdv r JOIN contacts c ON c.id = r.contact_id
    WHERE r.scheduled_at < NOW()
      AND (r.crm_stage IS NULL OR r.crm_stage = 'a_venir')
    ORDER BY r.scheduled_at ASC
      `) as Array<{ id: string; scheduled_at: string; status: string; crm_stage: string | null; company: string }>

  if (!apply) {
    return NextResponse.json({
      mode: 'APERÇU — rien n\'est écrit',
      etape_qui_serait_appliquee: etape,
      rendez_vous_concernes: cibles.length,
      detail: cibles.map(r => `${String(r.scheduled_at).slice(0, 16)} — ${r.company}`),
      lecture: 'Relancer avec &apply=1 pour appliquer. Les rendez-vous à venir et ceux déjà classés ne sont jamais touchés.',
    })
  }

  const ids = cibles.map(r => r.id)
  if (ids.length === 0) return NextResponse.json({ ok: true, modifies: 0, message: 'aucun rendez-vous passé non classé' })

  await sql`
    UPDATE rdv
    SET crm_stage = ${etape},
        unqualified_reason = CASE WHEN ${etape} = 'non_qualifie' THEN ${motif || null} ELSE NULL END,
        signed_at = CASE WHEN ${etape} = 'signe' THEN COALESCE(signed_at, NOW()) ELSE NULL END
    WHERE id = ANY(${ids})
  `

  return NextResponse.json({
    ok: true,
    etape_appliquee: etape,
    modifies: ids.length,
    detail: cibles.map(r => `${String(r.scheduled_at).slice(0, 16)} — ${r.company}`),
    lecture: etape === 'non_qualifie'
      ? 'Ces rendez-vous ne comptent pas dans le chiffre d\'affaires facturable. Le classement reste modifiable depuis l\'onglet Suivi RDV.'
      : 'Classement appliqué. Modifiable depuis l\'onglet Suivi RDV.',
  })
}
