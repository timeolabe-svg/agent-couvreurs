import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * BILAN QUOTIDIEN : NOUVEAUX CONTACTS vs RELANCES.
 *
 * ⚠️ Cette vue n'existait pas, et c'est précisément la question que Timéo pose — il facture au
 * résultat, donc ce qui compte est le nombre de PERSONNES NOUVELLEMENT démarchées, pas le volume
 * de mails. Le tableau de bord affichait « 126 mails aujourd'hui » sans dire que 123 étaient des
 * relances de prospects déjà connus : un chiffre exact qui donne une impression fausse.
 *
 * L'étape 0 est le premier contact. Les étapes 1 à 5 sont la séquence de relance. Les étapes >= 20
 * sont les relances de CONVERSATION (le prospect a déjà répondu puis s'est tu) — comptées à part,
 * parce qu'elles ne relèvent ni de la prospection froide ni de la séquence.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const jours = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('jours') ?? 7)))
  const { sql } = await import('@/lib/db')

  const lignes = (await sql`
    SELECT sent_at::date AS jour,
           COUNT(*) FILTER (WHERE sequence_step = 0)::int                      AS nouveaux_contacts,
           COUNT(*) FILTER (WHERE sequence_step BETWEEN 1 AND 19)::int         AS relances_sequence,
           COUNT(*) FILTER (WHERE sequence_step >= 20)::int                    AS relances_conversation,
           COUNT(*)::int                                                        AS total,
           COUNT(DISTINCT contact_id)::int                                      AS personnes_touchees
    FROM email_queue
    WHERE status = 'sent' AND sent_at >= (CURRENT_DATE - ${jours}::int)
    GROUP BY sent_at::date
    ORDER BY jour DESC
  `) as Array<Record<string, unknown>>

  type Cumul = { nouveaux: number; relances: number; conversation: number; mails: number }
  const total = lignes.reduce<Cumul>((acc, l) => ({
    nouveaux: acc.nouveaux + Number(l.nouveaux_contacts ?? 0),
    relances: acc.relances + Number(l.relances_sequence ?? 0),
    conversation: acc.conversation + Number(l.relances_conversation ?? 0),
    mails: acc.mails + Number(l.total ?? 0),
  }), { nouveaux: 0, relances: 0, conversation: 0, mails: 0 })

  /**
   * COMBIEN DE JOURS DE STOCK RESTE-T-IL ? — la seule question que Timéo pose vraiment.
   *
   * ⚠️ Aucun compteur existant n'y répondait, et j'ai annoncé « stock à sec » sur la base de
   * `outscraper_leads.status = 'new'` (5 lignes). Or ce chiffre ne mesure QUE le tampon de leads
   * bruts. Un contact déjà créé mais jamais démarché est du stock lui aussi — il est simplement
   * plus loin dans le tuyau. Répondre avec le mauvais réservoir, c'est faire racheter des données
   * qu'on possède déjà.
   *
   * On compte donc les PERSONNES qui n'ont jamais reçu de premier mail, et on dit pourquoi :
   * prêtes à partir, en attente de vérification d'adresse, ou écartées par le critère client.
   */
  const stock = (await sql`
    WITH jamais AS (
      SELECT c.id, c.email_validated, c.google_reviews_count, c.mv_status
      FROM contacts c
      WHERE NOT EXISTS (
        SELECT 1 FROM email_queue q
        WHERE q.contact_id = c.id AND q.sequence_step = 0 AND q.status = 'sent'
      )
    )
    SELECT
      (SELECT COUNT(*)::int FROM contacts)                                    AS contacts_total,
      COUNT(*)::int                                                            AS jamais_demarches,
      COUNT(*) FILTER (WHERE email_validated IS TRUE
                         AND COALESCE(google_reviews_count, 0) >= 20)::int     AS prets_a_partir,
      COUNT(*) FILTER (WHERE email_validated IS NOT TRUE
                         AND mv_status IS DISTINCT FROM 'injoignable')::int    AS attendent_verification,
      COUNT(*) FILTER (WHERE COALESCE(google_reviews_count, 0) < 20)::int      AS sous_le_seuil_client,
      COUNT(*) FILTER (WHERE mv_status = 'injoignable')::int                   AS adresses_injoignables
    FROM jamais
  `) as Array<Record<string, number>>

  // Rythme réel des 7 derniers jours : c'est lui qui convertit un stock en JOURS.
  const rythme = lignes.slice(0, 7).reduce((n, l) => n + Number(l.nouveaux_contacts ?? 0), 0) / Math.min(7, Math.max(1, lignes.length))
  const prets = Number(stock[0]?.prets_a_partir ?? 0)

  return NextResponse.json({
    ok: true,
    periode_jours: jours,
    par_jour: lignes,
    cumul: total,
    stock_restant: {
      ...stock[0],
      rythme_moyen_par_jour: Math.round(rythme),
      jours_de_stock_pret: rythme > 0 ? Math.round((prets / rythme) * 10) / 10 : null,
      lecture: 'prets_a_partir = personnes qui recevront un premier mail sans autre condition. attendent_verification deviendront disponibles au fil des passes MillionVerifier.',
    },
    lecture: 'nouveaux_contacts = personnes démarchées pour la première fois (étape 0). C\'est ce chiffre qui mesure la prospection ; le total de mails, lui, gonfle avec les relances.',
  })
}

export const GET = wrapCron('bilan-jour', handler)
