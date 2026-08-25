import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * SUIVI DES RENDEZ-VOUS ET RÉMUNÉRATION — la source unique de ce que Timéo facture.
 *
 * ⚠️ BARÈME HDIGIWEB, DIFFÉRENT DE CELUI DE REVELE : **80 € par rendez-vous qualifié**, plus
 * **5 % du montant MENSUEL de chaque client signé, tant qu'il reste client**. Chez Revele c'est
 * 10 € + 400 € à la signature. Les deux projets partagent le code, jamais les montants — les
 * recopier reviendrait à facturer un client au tarif d'un autre.
 *
 * ⚠️ LA COMMISSION EST RÉCURRENTE, PAS PONCTUELLE. Deux clients à 500 €/mois = 50 €/mois pour
 * Timéo, chaque mois, jusqu'à ce que Haris déclare la fin. C'est le point le plus facile à se
 * tromper et le plus coûteux : traiter la commission comme un one-shot ferait perdre l'essentiel
 * du revenu, mois après mois, sans que rien ne le signale.
 *
 * ⚠️ UN CLIENT PERDU N'EST JAMAIS SUPPRIMÉ — il reçoit une DATE DE FIN. Supprimer la ligne ferait
 * changer les factures des mois déjà prélevés : un client parti en novembre modifierait
 * rétroactivement ce qui a été facturé en septembre. Une facture émise ne se réécrit pas, c'est ce
 * qui permet aux deux parties de se mettre d'accord six mois plus tard.
 *
 * C'est cet endpoint, et lui seul, qui dit ce qui est dû. Le tableau de bord doit le LIRE, jamais
 * recalculer de son côté : deux calculs, c'est deux vérités, et un paiement qui se perd entre les
 * deux.
 */

export const ETAPES = [
  { key: 'a_venir',      label: 'À venir',      fixe: 0,  abonnement: false },
  { key: 'qualifie',     label: 'Qualifié',     fixe: 80, abonnement: false },
  /**
   * ⚠️ LE FIXE RESTE À 80 ICI, ET CE N'EST PAS UNE CONTRADICTION AVEC LE BADGE « +5 %/mois ».
   *
   * Les 80 € sont dus une seule fois par rendez-vous qualifié. Un rendez-vous signé A FORCÉMENT été
   * qualifié — mais Haris peut le faire passer directement de « à venir » à « signé » sans cocher
   * « qualifié » au passage. Mettre 0 ici lui ferait perdre les 80 € dans ce cas, en silence.
   *
   * Le montant n'est donc jamais compté deux fois : un rendez-vous porte UN seul classement à la
   * fois. Le badge, lui, décrit ce que la signature APPORTE EN PLUS de la qualification — la
   * commission — parce que c'est la question que se pose celui qui clique.
   */
  { key: 'signe',        label: 'Client signé', fixe: 80, abonnement: true  },
  { key: 'perdu',        label: 'Perdu',        fixe: 80, abonnement: false },
  { key: 'non_qualifie', label: 'Non qualifié', fixe: 0,  abonnement: false },
] as const

/** Les trois seuls cas où un rendez-vous ne compte pas — formulés par Timéo. */
export const MOTIFS_NON_QUALIFIE = [
  { key: 'no_show',           label: "Ne s'est pas présenté" },
  { key: 'hors_offre',        label: "N'est pas là pour l'offre qu'on propose" },
  { key: 'pas_decisionnaire', label: "Ce n'est pas la personne décisionnaire qui est présente" },
] as const

const TAUX_COMMISSION = 0.05

/** Part FIXE d'un rendez-vous — acquise une seule fois, au classement. */
export function partFixe(crmStage: string | null): number {
  return (ETAPES.find(e => e.key === (crmStage ?? 'a_venir')) ?? ETAPES[0]).fixe
}

/** Commission MENSUELLE d'un client signé — nulle dès qu'il n'est plus client. */
export function commissionMensuelle(crmStage: string | null, montantMensuel: number | null, finLe: string | null): number {
  const e = ETAPES.find(x => x.key === (crmStage ?? 'a_venir')) ?? ETAPES[0]
  if (!e.abonnement || !montantMensuel) return 0
  // Une date de fin PASSÉE arrête la commission ; une date future (préavis) la laisse courir.
  if (finLe && new Date(finLe).getTime() < Date.now()) return 0
  return Math.round(montantMensuel * TAUX_COMMISSION * 100) / 100
}

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ rdvs: [], _demo: true })
  const { sql } = await import('@/lib/db')

  const rdvs = (await sql`
    SELECT r.id, r.contact_id, r.scheduled_at, r.duration_min, r.status, r.notes,
           r.crm_stage, r.unqualified_reason, r.montant_mensuel, r.client_actif_jusqu_a,
           r.signed_at, r.client_note, r.created_at,
           c.company, c.name, c.city, c.phone, c.email
    FROM rdv r
    LEFT JOIN contacts c ON c.id = r.contact_id
    -- Un créneau seulement PROPOSÉ n'est pas un rendez-vous : le prospect n'a jamais dit oui.
    -- Les compter gonflerait la base de facturation, l'erreur la plus grave possible ici.
    WHERE r.status = 'confirmed'
    ORDER BY r.scheduled_at DESC
  `) as Array<Record<string, unknown>>

  const nb = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const lignes: Array<Record<string, unknown>> = rdvs.map(r => {
    const montant = nb(r.montant_mensuel)
    const fin = r.client_actif_jusqu_a ? String(r.client_actif_jusqu_a) : null
    return {
      ...r,
      montant_mensuel: montant,
      client_actif: r.crm_stage === 'signe' && (!fin || new Date(fin).getTime() >= Date.now()),
      part_fixe: partFixe(r.crm_stage as string | null),
      commission_mensuelle: commissionMensuelle(r.crm_stage as string | null, montant, fin),
    }
  })

  const etape = (r: Record<string, unknown>) => String(r.crm_stage ?? 'a_venir')
  // Un rendez-vous passé et non classé n'est pas « à venir » : il attend une décision.
  const aClasserFn = (r: Record<string, unknown>) =>
    etape(r) === 'a_venir' && new Date(String(r.scheduled_at)).getTime() < Date.now()

  const clientsActifs = lignes.filter(r => r.client_actif)
  const kpi = {
    total: lignes.length,
    qualifies: lignes.filter(r => ['qualifie', 'signe', 'perdu'].includes(etape(r))).length,
    signes: lignes.filter(r => etape(r) === 'signe').length,
    aVenir: lignes.filter(r => etape(r) === 'a_venir' && !aClasserFn(r)).length,
    aClasser: lignes.filter(aClasserFn).length,
    nonQualifies: lignes.filter(r => etape(r) === 'non_qualifie').length,

    // ── L'ARGENT ─────────────────────────────────────────────────────────────
    // Acquis une fois : 80 € par rendez-vous qualifié (signés et perdus compris).
    fixeAcquis: lignes.reduce((n, r) => n + Number(r.part_fixe ?? 0), 0),
    // Récurrent : 5 % du total mensuel des clients ENCORE actifs — ce qui tombe chaque mois.
    clientsActifs: clientsActifs.length,
    caMensuelClients: clientsActifs.reduce((n, r) => n + Number(r.montant_mensuel ?? 0), 0),
    commissionMensuelle: clientsActifs.reduce((n, r) => n + Number(r.commission_mensuelle ?? 0), 0),
  }

  return NextResponse.json({
    rdvs: lignes,
    bareme: { fixe_par_rdv_qualifie: 80, commission_sur_abonnement: TAUX_COMMISSION },
    motifs: MOTIFS_NON_QUALIFIE,
    kpi,
  })
}

export async function PATCH(req: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true, _demo: true })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { sql } = await import('@/lib/db')

  if ('crmStage' in (body ?? {})) {
    const stage = String(body!.crmStage ?? 'a_venir')
    if (!ETAPES.some(e => e.key === stage)) return NextResponse.json({ error: 'étape inconnue' }, { status: 400 })
    /**
     * Sortir de « signé » arrête l'abonnement mais NE SUPPRIME PAS le montant : si Haris s'est
     * trompé de bouton et revient, il ne ressaisit rien. `signed_at` n'est effacé que si le
     * rendez-vous quitte réellement l'état signé — sinon un aller-retour réécrirait la date de
     * début d'abonnement, donc les montants déjà facturés.
     */
    await sql`
      UPDATE rdv SET crm_stage = ${stage},
        signed_at = CASE WHEN ${stage} = 'signe' THEN COALESCE(signed_at, NOW()) ELSE NULL END,
        unqualified_reason = CASE WHEN ${stage} = 'non_qualifie' THEN unqualified_reason ELSE NULL END
      WHERE id = ${id}
    `

    /**
     * ⚠️ C'EST ICI, ET NULLE PART AILLEURS, QUE LE CLIENT EST FACTURÉ.
     *
     * Le prélèvement se déclenchait auparavant à la CRÉATION du rendez-vous, avant toute
     * qualification — donc y compris pour les rendez-vous que Timéo classe ensuite « non qualifié »
     * parce qu'ils n'ont rien donné. Un rendez-vous ne devient facturable qu'au moment où le client
     * le classe, et c'est ce moment-là qu'on écoute.
     *
     * `facturerRdv` ne lève jamais : un échec de paiement ne doit pas empêcher d'enregistrer le
     * classement commercial. Il porte son propre anti-doublon, garanti par la base.
     */
    const { facturerRdv } = await import('@/lib/facturation')
    const facturation = await facturerRdv(sql as never, id)
    if (facturation.facture) {
      await sql`
        INSERT INTO dashboard_events (type, data)
        VALUES ('rdv_facture', ${JSON.stringify({ rdv_id: id, etape: stage, montant_eur: facturation.montant_eur })}::jsonb)
      `.catch(() => {})
    }
  }

  if ('unqualifiedReason' in (body ?? {})) {
    const motif = String(body!.unqualifiedReason ?? '')
    if (motif && !MOTIFS_NON_QUALIFIE.some(m => m.key === motif)) {
      return NextResponse.json({ error: 'motif inconnu' }, { status: 400 })
    }
    await sql`UPDATE rdv SET unqualified_reason = ${motif || null} WHERE id = ${id}`
  }

  if ('montantMensuel' in (body ?? {})) {
    const brut = String(body!.montantMensuel ?? '').replace(',', '.').replace(/[^\d.]/g, '')
    const montant = brut === '' ? null : Number(brut)
    if (montant !== null && (!Number.isFinite(montant) || montant < 0)) {
      return NextResponse.json({ error: 'montant invalide' }, { status: 400 })
    }
    await sql`UPDATE rdv SET montant_mensuel = ${montant} WHERE id = ${id}`
  }

  /**
   * FIN D'ABONNEMENT — une date, jamais une suppression.
   * `null` remet le client en actif (erreur de manipulation rattrapable). Une date passée arrête la
   * commission à partir de ce jour, sans toucher aux mois déjà facturés.
   */
  if ('clientActifJusquA' in (body ?? {})) {
    const d = String(body!.clientActifJusquA ?? '').trim()
    await sql`UPDATE rdv SET client_actif_jusqu_a = ${d || null} WHERE id = ${id}`
  }

  if ('clientNote' in (body ?? {})) {
    await sql`UPDATE rdv SET client_note = ${String(body!.clientNote ?? '') || null} WHERE id = ${id}`
  }

  const [m] = (await sql`
    SELECT crm_stage, montant_mensuel, client_actif_jusqu_a FROM rdv WHERE id = ${id}
  `) as Array<{ crm_stage: string | null; montant_mensuel: string | null; client_actif_jusqu_a: string | null }>

  return NextResponse.json({
    ok: true,
    part_fixe: partFixe(m?.crm_stage ?? null),
    commission_mensuelle: commissionMensuelle(
      m?.crm_stage ?? null,
      m?.montant_mensuel === null || m?.montant_mensuel === undefined ? null : Number(m.montant_mensuel),
      m?.client_actif_jusqu_a ?? null,
    ),
  })
}
