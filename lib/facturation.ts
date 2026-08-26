/**
 * FACTURATION DES RENDEZ-VOUS — une seule définition du prix, un seul moment de prélèvement.
 *
 * ⚠️ CE QUE ÇA RÉPARE (audit croisé du 26/08, signalé par la session Revele).
 *
 * Le prélèvement Stripe était écrit en dur dans `POST /api/rdv` : `amount: 5000` avec le commentaire
 * « 50€ in cents », alors que le tarif de ce client est de **80 €** et que le tableau de bord
 * calculait déjà son chiffre d'affaires sur 80. Deux montants pour la même prestation, dans le même
 * dépôt — et c'est celui qui prélève qui avait tort.
 *
 * ⚠️ ET IL PRÉLEVAIT AU MAUVAIS MOMENT. Le prélèvement partait à la CRÉATION du rendez-vous, en
 * `off_session`, avant toute qualification. Or la règle posée par Timéo le 25/08 est que seuls les
 * rendez-vous classés `qualifie`, `signe` ou `perdu` sont facturables : un `non_qualifie` ne compte
 * pas. Le jour où la clé Stripe serait posée, le client aurait donc été débité pour des rendez-vous
 * que Timéo lui-même considère comme non facturables — neuf sur dix ce jour-là.
 *
 * ⚠️ ET SANS ANTI-DOUBLON. Rien n'empêchait deux prélèvements pour le même rendez-vous. On écrit
 * donc la date de facturation SUR la ligne du rendez-vous, et c'est la base qui garantit l'unicité :
 * l'UPDATE conditionnel ne réussit qu'une fois.
 */

/** Le tarif convenu avec Haris pour un rendez-vous facturable. Source unique. */
export const PRIX_PAR_RDV = 80

/** Les étapes commerciales qui déclenchent la facturation. `a_venir` et `non_qualifie` ne comptent pas. */
export const ETAPES_FACTURABLES = ['qualifie', 'signe', 'perdu'] as const

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

export interface ResultatFacturation {
  facture: boolean
  raison: string
  montant_eur?: number
}

/**
 * Prélève le rendez-vous s'il vient de devenir facturable, une seule fois, jamais deux.
 *
 * Ne lève JAMAIS : un échec de paiement ne doit pas empêcher d'enregistrer le classement commercial.
 * Le rendez-vous reste alors non facturé et repassera au prochain changement d'étape.
 */
export async function facturerRdv(sql: Sql, rdvId: string): Promise<ResultatFacturation> {
  if (!process.env.STRIPE_SECRET_KEY) return { facture: false, raison: 'Stripe non configuré' }

  await sql`ALTER TABLE rdv ADD COLUMN IF NOT EXISTS facture_le TIMESTAMPTZ`.catch(() => {})

  const lignes = (await sql`
    SELECT r.crm_stage, r.facture_le, r.scheduled_at, c.company
    FROM rdv r JOIN contacts c ON c.id = r.contact_id
    WHERE r.id = ${rdvId}::uuid
  `) as Array<{ crm_stage: string | null; facture_le: string | null; scheduled_at: string; company: string }>
  const r = lignes[0]
  if (!r) return { facture: false, raison: 'rendez-vous introuvable' }
  if (r.facture_le) return { facture: false, raison: 'déjà facturé' }
  if (!ETAPES_FACTURABLES.includes(String(r.crm_stage) as typeof ETAPES_FACTURABLES[number])) {
    return { facture: false, raison: `étape « ${r.crm_stage} » non facturable` }
  }

  /**
   * ⚠️ ON RÉSERVE AVANT DE PRÉLEVER, comme pour le claim du moteur d'envoi. L'UPDATE conditionnel
   * ne réussit que si `facture_le` est encore vide : deux appels simultanés ne peuvent pas débiter
   * deux fois, et c'est la base qui tranche, pas le code.
   */
  const reserve = (await sql`
    UPDATE rdv SET facture_le = NOW() WHERE id = ${rdvId}::uuid AND facture_le IS NULL RETURNING id
  `) as unknown[]
  if (reserve.length === 0) return { facture: false, raison: 'déjà facturé (course évitée)' }

  try {
    const { stripe } = await import('@/lib/stripe')
    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const [client] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_customer_id'))
    const [moyen] = await db.select().from(agent_config).where(eq(agent_config.key, 'stripe_payment_method_id'))
    if (!client?.value || !moyen?.value) {
      await sql`UPDATE rdv SET facture_le = NULL WHERE id = ${rdvId}::uuid`
      .catch((err) => { console.error(`[facturation] reservation NON rendue pour le rdv ${rdvId} — il restera marque comme facture sans avoir ete preleve :`, String(err).slice(0, 160)) })
      return { facture: false, raison: 'aucun moyen de paiement enregistré' }
    }

    await stripe.paymentIntents.create({
      amount: PRIX_PAR_RDV * 100,
      currency: 'eur',
      customer: client.value,
      payment_method: moyen.value,
      confirm: true,
      off_session: true,
      description: `RDV qualifié Hdigiweb — ${r.company} — ${new Date(r.scheduled_at).toLocaleDateString('fr-FR')}`,
      metadata: { rdv_id: rdvId, contact_company: r.company, etape: String(r.crm_stage) },
    }, { idempotencyKey: `rdv-${rdvId}` })

    return { facture: true, raison: 'prélevé', montant_eur: PRIX_PAR_RDV }
  } catch (e) {
    /**
     * ⚠️ On REND la réservation : sans ça, un échec de paiement rendrait le rendez-vous
     * définitivement non facturable, et personne ne s'en apercevrait.
     *
     * ⚠️ Et si CETTE écriture échoue à son tour, il faut le savoir : le rendez-vous resterait marqué
     * comme facturé sans avoir été prélevé, donc invisible pour toujours. C'est le pire état
     * possible — pas une erreur, un manque à gagner silencieux. Le `catch` journalise désormais.
     */
    await sql`UPDATE rdv SET facture_le = NULL WHERE id = ${rdvId}::uuid`
      .catch((err) => { console.error(`[facturation] reservation NON rendue pour le rdv ${rdvId} — il restera marque comme facture sans avoir ete preleve :`, String(err).slice(0, 160)) })
    return { facture: false, raison: `échec Stripe : ${String(e).slice(0, 120)}` }
  }
}
