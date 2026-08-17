import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * SUIVI DES RENDEZ-VOUS — classement par le client, et calcul de la rémunération.
 *
 * ⚠️ BARÈME HDIGIWEB, DIFFÉRENT DE CELUI DE REVELE. Ici : **50 € par rendez-vous qualifié + 5 % du
 * CA généré**. Chez Revele : 10 € + 400 € à la signature. Les deux projets partagent le code mais
 * PAS les montants — les recopier d'un projet à l'autre reviendrait à facturer un client au tarif
 * d'un autre.
 *
 * C'est Haris qui classe ses rendez-vous et qui saisit le CA qu'il a réellement encaissé. La
 * commission de 5 % se calcule seule à partir de ce montant : il n'a jamais à faire l'opération, et
 * Timéo n'a jamais à la réclamer.
 *
 * ⚠️ `crm_stage` (classement commercial) et `status` (état technique du rendez-vous) sont deux
 * choses distinctes et le restent. Marquer un RDV « non qualifié » ne l'efface pas de l'agenda ;
 * l'annuler dans l'agenda ne le sort pas des statistiques.
 */

/** Les cinq états, avec ce que chacun rapporte réellement. */
export const ETAPES = [
  { key: 'a_venir',      label: 'À venir',      fixe: 0,  commission: false },
  { key: 'qualifie',     label: 'Qualifié',     fixe: 50, commission: false },
  { key: 'signe',        label: 'Client signé', fixe: 50, commission: true  },
  { key: 'perdu',        label: 'Perdu',        fixe: 50, commission: false },
  { key: 'non_qualifie', label: 'Non qualifié', fixe: 0,  commission: false },
] as const

const TAUX_COMMISSION = 0.05

/** Ce que rapporte un rendez-vous : la part fixe, plus 5 % du CA s'il a signé. */
export function remuneration(crmStage: string | null, caHt: number | null): number {
  const e = ETAPES.find(x => x.key === (crmStage ?? 'a_venir')) ?? ETAPES[0]
  const fixe = e.fixe
  const commission = e.commission && caHt ? Math.round(caHt * TAUX_COMMISSION * 100) / 100 : 0
  return Math.round((fixe + commission) * 100) / 100
}

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ rdvs: [], _demo: true })
  const { sql } = await import('@/lib/db')

  const rdvs = (await sql`
    SELECT r.id, r.contact_id, r.scheduled_at, r.duration_min, r.status, r.notes,
           r.crm_stage, r.unqualified_reason, r.ca_ht, r.signed_at, r.client_note, r.created_at,
           c.company, c.name, c.city, c.phone, c.email
    FROM rdv r
    LEFT JOIN contacts c ON c.id = r.contact_id
    /**
     * ⚠️ UN CRÉNEAU PROPOSÉ N'EST PAS UN RENDEZ-VOUS.
     *
     * Première version : toutes les lignes de la table rdv. Résultat affiché — 14 rendez-vous, alors que
     * Timéo en comptait 9. Les 5 en trop étaient des créneaux au statut proposed : l'agent les a suggérés,
     * le prospect n'a jamais dit oui. Trois d'entre eux faisaient même doublon avec le rendez-vous
     * confirmé qui a suivi.
     *
     * Gonfler le nombre de rendez-vous est la pire erreur possible sur cet écran : c'est lui qui
     * sert de base à la facturation. Un chiffre qui surestime ce qu'on a produit se retourne contre
     * nous à la première vérification du client.
     *
     * Règle déjà posée pour l'agenda : rien n'est un rendez-vous tant que le prospect n'a pas
     * confirmé. Les annulés sortent aussi — ils n'ont pas eu lieu.
     */
    WHERE r.status = 'confirmed'
    ORDER BY r.scheduled_at DESC
  `) as Array<Record<string, unknown>>

  const lignes: Array<Record<string, unknown>> = rdvs.map(r => ({
    ...r,
    ca_ht: r.ca_ht === null ? null : Number(r.ca_ht),
    remuneration: remuneration(r.crm_stage as string | null, r.ca_ht === null ? null : Number(r.ca_ht)),
  }))
  const etape = (r: Record<string, unknown>) => String(r.crm_stage ?? 'a_venir')

  /**
   * ⚠️ « À venir » et « Non qualifié » comptent comme RENDEZ-VOUS mais rapportent 0 €.
   * Timéo l'a demandé explicitement pour les 9 rendez-vous antérieurs au 17/08 : ils restent dans
   * les statistiques — ils ont bien eu lieu — mais ne doivent produire aucune facturation. Un
   * compteur d'activité et un compteur d'argent ne mesurent pas la même chose.
   */
  /**
   * ⚠️ « À VENIR » NE VEUT RIEN DIRE POUR UN RENDEZ-VOUS PASSÉ.
   *
   * Tous les rendez-vous non classés tombaient dans « À venir », y compris ceux de juillet. Timéo
   * l'a vu tout de suite : « il doit y avoir que celui de demain dans à venir ». Un rendez-vous
   * passé et non classé n'est pas à venir — il ATTEND UNE DÉCISION, et c'est exactement ce que
   * l'écran doit réclamer. Laisser dormir 8 rendez-vous dans une case au nom rassurant, c'est
   * garantir que personne ne les classera jamais.
   */
  const passe = (r: Record<string, unknown>) =>
    etape(r) === 'a_venir' && new Date(String(r.scheduled_at)).getTime() < Date.now()

  const total = lignes.length
  const qualifies = lignes.filter(r => ['qualifie', 'signe', 'perdu'].includes(etape(r))).length
  const signes = lignes.filter(r => etape(r) === 'signe').length
  const aVenir = lignes.filter(r => etape(r) === 'a_venir' && !passe(r)).length
  const aClasser = lignes.filter(passe).length
  const nonQualifies = lignes.filter(r => etape(r) === 'non_qualifie').length
  const caGenere = lignes.reduce((n, r) => n + (typeof r.ca_ht === 'number' ? r.ca_ht : 0), 0)
  const aFacturer = lignes.reduce((n, r) => n + (r.remuneration as number), 0)

  return NextResponse.json({
    rdvs: lignes,
    bareme: { fixe_par_rdv_qualifie: 50, commission_sur_ca: TAUX_COMMISSION },
    kpi: { total, qualifies, signes, aVenir, aClasser, nonQualifies, caGenere, aFacturer },
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
    // Sortir de « signé » efface l'horodatage : sinon un RDV repassé en « perdu » garderait une
    // date de signature et continuerait de compter comme client dans les bilans.
    await sql`
      UPDATE rdv SET crm_stage = ${stage},
        signed_at = CASE WHEN ${stage} = 'signe' THEN COALESCE(signed_at, NOW()) ELSE NULL END,
        unqualified_reason = CASE WHEN ${stage} = 'non_qualifie' THEN unqualified_reason ELSE NULL END
      WHERE id = ${id}
    `
  }

  if ('unqualifiedReason' in (body ?? {})) {
    await sql`UPDATE rdv SET unqualified_reason = ${String(body!.unqualifiedReason ?? '') || null} WHERE id = ${id}`
  }

  if ('caHt' in (body ?? {})) {
    const brut = String(body!.caHt ?? '').replace(',', '.').replace(/[^\d.]/g, '')
    const montant = brut === '' ? null : Number(brut)
    if (montant !== null && (!Number.isFinite(montant) || montant < 0)) {
      return NextResponse.json({ error: 'montant invalide' }, { status: 400 })
    }
    await sql`UPDATE rdv SET ca_ht = ${montant} WHERE id = ${id}`
  }

  if ('clientNote' in (body ?? {})) {
    await sql`UPDATE rdv SET client_note = ${String(body!.clientNote ?? '') || null} WHERE id = ${id}`
  }

  const [maj] = (await sql`SELECT crm_stage, ca_ht FROM rdv WHERE id = ${id}`) as Array<{ crm_stage: string | null; ca_ht: string | null }>
  return NextResponse.json({
    ok: true,
    remuneration: remuneration(maj?.crm_stage ?? null, maj?.ca_ht === null || maj?.ca_ht === undefined ? null : Number(maj.ca_ht)),
  })
}
