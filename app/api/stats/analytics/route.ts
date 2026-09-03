import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Prix facturé par rendez-vous et étapes réellement facturables : LUS DEPUIS LA FACTURATION.
 *
 * ⚠️ Cette valeur était écrite ici en dur (80), et à trois autres endroits (`50` dans les données de
 * démonstration, `50` en dur dans `app/stats/page.tsx`). Un tarif recopié est un tarif qui diverge :
 * le jour où Timéo renégocie, il en corrige un sur quatre et les trois autres mentent en silence.
 * `lib/facturation.ts` est le seul endroit qui prélève réellement de l'argent — c'est donc lui qui
 * fait foi.
 */
import { PRIX_PAR_RDV, ETAPES_FACTURABLES } from '@/lib/facturation'

type Period = '7d' | '30d' | '90d' | 'all'

function getMockAnalytics(period: Period) {
  const multiplier = period === '7d' ? 0.23 : period === '30d' ? 1 : period === '90d' ? 3 : 5
  const emailsSent = Math.round(847 * multiplier)
  const replies = Math.round(63 * multiplier)
  const replyRate = +(replies / emailsSent * 100).toFixed(1)
  const rdvCount = Math.round(12 * multiplier)
  const optouts = Math.round(8 * multiplier)
  const bounces = Math.round(5 * multiplier)
  return {
    period,
    emailsSent,
    replies,
    replyRate,
    optouts,
    bounces,
    rdvCount,
    revenue: rdvCount * 50,
    conversionRate: +(rdvCount / emailsSent * 100).toFixed(2),
    topCities: [
      { city: 'Toulouse', sent: Math.round(180 * multiplier), replies: Math.round(15 * multiplier), replyRate: 8.3, rdv: Math.round(3 * multiplier), revenue: Math.round(3 * multiplier) * 50 },
      { city: 'Montpellier', sent: Math.round(120 * multiplier), replies: Math.round(9 * multiplier), replyRate: 7.5, rdv: Math.round(2 * multiplier), revenue: Math.round(2 * multiplier) * 50 },
      { city: 'Nîmes', sent: Math.round(90 * multiplier), replies: Math.round(7 * multiplier), replyRate: 7.8, rdv: Math.round(2 * multiplier), revenue: Math.round(2 * multiplier) * 50 },
      { city: 'Perpignan', sent: Math.round(75 * multiplier), replies: Math.round(5 * multiplier), replyRate: 6.7, rdv: Math.round(1 * multiplier), revenue: Math.round(1 * multiplier) * 50 },
      { city: 'Carcassonne', sent: Math.round(60 * multiplier), replies: Math.round(4 * multiplier), replyRate: 6.7, rdv: Math.round(1 * multiplier), revenue: Math.round(1 * multiplier) * 50 },
    ],
    dailyActivity: Array.from({ length: 30 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (29 - i))
      return { date: d.toISOString().slice(0, 10), sent: Math.floor(Math.random() * 35) + 5, replies: Math.floor(Math.random() * 6) }
    }),
    pipeline: {
      prospects: 312,
      contacted: emailsSent,
      replied: replies,
      rdv: rdvCount,
    },
    bestCity: { city: 'Toulouse', replyRate: 8.3, rdv: Math.round(3 * multiplier) },
    classificationBreakdown: [
      { classification: 'interest', count: Math.round(18 * multiplier) },
      { classification: 'question', count: Math.round(12 * multiplier) },
      { classification: 'objection', count: Math.round(10 * multiplier) },
      { classification: 'rdv_request', count: Math.round(8 * multiplier) },
      { classification: 'desinterest', count: Math.round(9 * multiplier) },
      { classification: 'oof', count: Math.round(4 * multiplier) },
      { classification: 'spam', count: Math.round(2 * multiplier) },
    ],
    autoRepliesSent: Math.round(27 * multiplier),
    draftsValidated: Math.round(8 * multiplier),
    draftsPending: Math.round(3 * multiplier),
    // Volumes bas exprès : le canal LinkedIn démarre, pas encore de régime de croisière à simuler.
    linkedin: {
      sent: Math.round(12 * multiplier), replies: Math.round(2 * multiplier), rdvCount: 0,
      replyRate: 8.3, classificationBreakdown: [{ classification: 'interest', count: Math.round(1 * multiplier) }],
    },
    _demo: true,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') ?? '30d') as Period

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(getMockAnalytics(period))
  }

  const { db } = await import('@/lib/db')
  const { email_queue, incoming_replies, rdv, contacts, blocklist, reply_drafts } = await import('@/lib/db/schema')
  const { count, eq, ne, gte, and, inArray, sql } = await import('drizzle-orm')

  const now = new Date()
  let periodStart: Date | null = null
  if (period === '7d') {
    periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  } else if (period === '30d') {
    periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (period === '90d') {
    periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  }

  const emailConditions = periodStart
    ? and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, periodStart))
    : eq(email_queue.status, 'sent')

  const replyConditions = periodStart
    ? gte(incoming_replies.created_at, periodStart)
    : undefined

  // RDV : on EXCLUT les annulés (sinon CA gonflé par des RDV qui n'ont pas eu lieu)
  // On EXCLUT aussi les 'proposed' : un créneau proposé mais PAS encore accepté par le prospect
  // n'est pas un RDV obtenu — sinon les stats et le CA sont gonflés (9 affichés au lieu de 6).
  const rdvConditions = and(
    ne(rdv.status, 'cancelled'),
    ne(rdv.status, 'proposed'),
    periodStart ? gte(rdv.created_at, periodStart) : undefined,
  )

  const [
    [{ emailsSent }],
    [{ contactedDistinct }],
    [{ replies }],
    [{ rdvCount }],
    [{ optouts }],
    [{ bounces }],
  ] = await Promise.all([
    db.select({ emailsSent: count() }).from(email_queue).where(emailConditions),
    // ⚠️ DISTINCT du contact_id : "contactés" doit compter des PROSPECTS, pas des emails. Un même
    // contact reçoit jusqu'à 6 mails (séquence) — les compter tous faisait dépasser le nombre de
    // prospects existants (167% affiché, un contact "contacté" 6 fois comptait pour 6). Repéré via
    // le dashboard : Contactés (3938) > Prospects (2363).
    db.select({ contactedDistinct: sql<number>`count(distinct ${email_queue.contact_id})` }).from(email_queue).where(emailConditions),
    // replies = PROSPECTS distincts ayant fait une VRAIE réponse (on exclut le spam et
    // les auto-réponses/absences, ex : les vieilles plaintes "mail vide").
    db.select({ replies: sql<number>`count(distinct ${incoming_replies.contact_id})` }).from(incoming_replies).where(and(
      replyConditions,
      sql`(${incoming_replies.classification} is null or ${incoming_replies.classification} not in ('spam','oof'))`,
    )),
    db.select({ rdvCount: count() }).from(rdv).where(rdvConditions),
    // opt-outs = vraies désinscriptions seulement (pas les bounces ni ajouts manuels)
    db.select({ optouts: count() }).from(blocklist).where(and(
      inArray(blocklist.reason, ['unsubscribe', 'desinterest']),
      periodStart ? gte(blocklist.created_at, periodStart) : undefined,
    )),
    // bounces = emails rejetés (adresse morte)
    db.select({ bounces: count() }).from(email_queue).where(and(
      eq(email_queue.status, 'bounced'),
      periodStart ? gte(email_queue.sent_at, periodStart) : undefined,
    )),
  ])

  // Clients signés (dernière étape du pipeline) — était codé en dur à 0 dans l'affichage.
  const [{ signedCount }] = await db.select({ signedCount: count() }).from(rdv).where(and(
    eq(rdv.status, 'signed'),
    periodStart ? gte(rdv.created_at, periodStart) : undefined,
  ))

  // CA apporté et commission de 5 % (facture FA-2026-07-03). On somme UNIQUEMENT les RDV
  // réellement marqués 'signed' : un CA saisi puis dé-signé ne doit jamais être compté.
  const [caRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(${rdv.ca_ht}), 0)` })
    .from(rdv)
    .where(and(
      eq(rdv.status, 'signed'),
      periodStart ? gte(rdv.created_at, periodStart) : undefined,
    ))
  const caApporte = Number(caRow?.total ?? 0)
  const commission = +(caApporte * 0.05).toFixed(2)

  const replyRate = emailsSent > 0 ? +(Math.min(replies, emailsSent) / emailsSent * 100).toFixed(1) : 0
  // Voir la note sur `cityRdvFacturableRaw` : le chiffre d'affaires suit ETAPES_FACTURABLES, jamais
  // le nombre brut de rendez-vous. Un rendez-vous `a_venir` ou `non_qualifie` ne rapporte rien.
  const [{ rdvFacturables }] = await db
    .select({ rdvFacturables: count() })
    .from(rdv)
    .where(and(rdvConditions, inArray(rdv.crm_stage, [...ETAPES_FACTURABLES])))
  const revenue = rdvFacturables * PRIX_PAR_RDV
  const conversionRate = emailsSent > 0 ? +(rdvCount / emailsSent * 100).toFixed(2) : 0

  // Top cities
  const citySentRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(email_queue)
    .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
    .where(emailConditions)
    .groupBy(contacts.city)
    .orderBy(sql`count(*) desc`)
    .limit(10)

  const cityRepliesRaw = await db
    .select({ city: contacts.city, cnt: sql<number>`count(distinct ${incoming_replies.contact_id})` })
    .from(incoming_replies)
    .innerJoin(contacts, eq(incoming_replies.contact_id, contacts.id))
    .where(replyConditions)
    .groupBy(contacts.city)

  const cityRdvRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(rdv)
    .innerJoin(contacts, eq(rdv.contact_id, contacts.id))
    .where(rdvConditions)
    .groupBy(contacts.city)

  /**
   * ⚠️ TOUS LES RENDEZ-VOUS NE SONT PAS FACTURABLES (26/08, signalé par les deux autres sessions).
   *
   * Cet écran multipliait le nombre BRUT de rendez-vous par 80 €, alors que la facturation ne retient
   * que les étapes `qualifie`, `signe` et `perdu` — un rendez-vous encore `a_venir` ou classé
   * `non_qualifie` ne rapporte rien. Le tableau de bord, lui, appliquait déjà la bonne règle : deux
   * écrans annonçaient donc deux chiffres d'affaires différents pour le même mois.
   *
   * On lit désormais la MÊME source de vérité que la facturation (`ETAPES_FACTURABLES`), pour que le
   * chiffre affiché soit celui qui sera réellement facturé à Haris.
   */
  const cityRdvFacturableRaw = await db
    .select({ city: contacts.city, cnt: count() })
    .from(rdv)
    .innerJoin(contacts, eq(rdv.contact_id, contacts.id))
    .where(and(rdvConditions, inArray(rdv.crm_stage, [...ETAPES_FACTURABLES])))
    .groupBy(contacts.city)

  const replyMap = Object.fromEntries(cityRepliesRaw.map(r => [r.city ?? '', r.cnt]))
  const rdvMap = Object.fromEntries(cityRdvRaw.map(r => [r.city ?? '', r.cnt]))
  const rdvFacturableMap = Object.fromEntries(cityRdvFacturableRaw.map(r => [r.city ?? '', r.cnt]))

  // Fusionne les villes avec emails envoyés + les villes avec RDV (même si hors top 10 envois)
  const sentMap = Object.fromEntries(citySentRaw.filter(r => r.city).map(r => [r.city ?? '', r.cnt]))
  const allCities = new Set([...Object.keys(sentMap), ...Object.keys(rdvMap)])

  const topCities = Array.from(allCities)
    .map(city => {
      const sent = sentMap[city] ?? 0
      const cityReplies = replyMap[city] ?? 0
      const cityRdv = rdvMap[city] ?? 0
      return {
        city,
        sent,
        replies: cityReplies,
        replyRate: sent > 0 ? +(cityReplies / sent * 100).toFixed(1) : 0,
        rdv: cityRdv,
        rdvFacturables: rdvFacturableMap[city] ?? 0,
        revenue: (rdvFacturableMap[city] ?? 0) * PRIX_PAR_RDV,
      }
    })
    // Trier : RDV d'abord, puis taux de réponse, puis volume envoyé
    .sort((a, b) => b.rdv - a.rdv || b.replyRate - a.replyRate || b.sent - a.sent)
    .slice(0, 5)

  // Best city : priorité aux villes avec RDV, sinon meilleur taux de réponse
  const bestCity = topCities.length > 0
    ? topCities.reduce((best, c) => {
        if (c.rdv > best.rdv) return c
        if (c.rdv === best.rdv && c.replyRate > best.replyRate) return c
        return best
      }, topCities[0])
    : null

  // Daily activity last 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const dailySentRaw = await db
    .select({ date: sql<string>`DATE(${email_queue.sent_at})`, cnt: count() })
    .from(email_queue)
    .where(and(eq(email_queue.status, 'sent'), gte(email_queue.sent_at, thirtyDaysAgo)))
    .groupBy(sql`DATE(${email_queue.sent_at})`)

  const dailyRepliesRaw = await db
    .select({ date: sql<string>`DATE(${incoming_replies.created_at})`, cnt: count() })
    .from(incoming_replies)
    .where(gte(incoming_replies.created_at, thirtyDaysAgo))
    .groupBy(sql`DATE(${incoming_replies.created_at})`)

  const sentByDay = Object.fromEntries(dailySentRaw.map(r => [r.date, r.cnt]))
  const repliesByDay = Object.fromEntries(dailyRepliesRaw.map(r => [r.date, r.cnt]))

  const dailyActivity = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(thirtyDaysAgo)
    d.setDate(thirtyDaysAgo.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    return { date: dateStr, sent: sentByDay[dateStr] ?? 0, replies: repliesByDay[dateStr] ?? 0 }
  })

  // Pipeline
  const [{ totalContacts }] = await db.select({ totalContacts: count() }).from(contacts)

  // Réponses auto envoyées / brouillons (sur la période quand applicable)
  const [
    [{ autoRepliesSent }],
    [{ draftsPending }],
  ] = await Promise.all([
    db.select({ autoRepliesSent: count() }).from(reply_drafts).where(and(
      eq(reply_drafts.status, 'sent'),
      periodStart ? gte(reply_drafts.sent_at, periodStart) : undefined,
    )),
    db.select({ draftsPending: count() }).from(reply_drafts).where(eq(reply_drafts.status, 'pending')),
  ])

  // Classification breakdown
  const classificationRaw = await db
    .select({ classification: incoming_replies.classification, cnt: count() })
    .from(incoming_replies)
    .where(replyConditions)
    .groupBy(incoming_replies.classification)

  const classificationBreakdown = classificationRaw.map(r => ({
    classification: r.classification ?? 'unknown',
    count: r.cnt,
  }))

  /**
   * BLOC LINKEDIN — additif, exprès (03/09/2026, canal LinkedIn). « Diviser mailing et LinkedIn »
   * demandé par Timéo. Plutôt que d'enfiler un paramètre `channel` dans les ~15 requêtes email
   * ci-dessus (dont plusieurs portent déjà des correctifs fins, ex. le DISTINCT sur contact_id à
   * la ligne 123, ou l'exclusion spam/oof à la ligne 128 — un risque de régression pour un gain
   * nul tant que le volume LinkedIn reste à zéro), un bloc séparé calculé indépendamment, isolé
   * par son propre try/catch : une erreur ici ne touche jamais les statistiques email existantes.
   */
  const linkedin = await (async () => {
    try {
      const { linkedin_leads } = await import('@/lib/db/schema')
      const inviteConditions = periodStart ? and(sql`invited_at IS NOT NULL`, gte(linkedin_leads.invited_at, periodStart)) : sql`invited_at IS NOT NULL`
      const [[{ n: sentCount }], [{ n: repliesCount }], [{ n: rdvCount2 }], classifRaw] = await Promise.all([
        db.select({ n: count() }).from(linkedin_leads).where(inviteConditions) as unknown as Promise<Array<{ n: number }>>,
        db.select({ n: sql<number>`count(distinct ${incoming_replies.contact_id})` }).from(incoming_replies).where(and(
          eq(incoming_replies.channel, 'linkedin'),
          replyConditions,
          sql`(${incoming_replies.classification} is null or ${incoming_replies.classification} not in ('spam','oof'))`,
        )) as unknown as Promise<Array<{ n: number }>>,
        db.select({ n: count() }).from(rdv)
          .innerJoin(incoming_replies, eq(incoming_replies.id, rdv.incoming_reply_id))
          .where(and(eq(incoming_replies.channel, 'linkedin'), rdvConditions)) as unknown as Promise<Array<{ n: number }>>,
        db.select({ classification: incoming_replies.classification, cnt: count() })
          .from(incoming_replies)
          .where(and(eq(incoming_replies.channel, 'linkedin'), replyConditions))
          .groupBy(incoming_replies.classification),
      ])
      return {
        sent: sentCount, replies: repliesCount, rdvCount: rdvCount2,
        replyRate: sentCount > 0 ? +(Math.min(repliesCount, sentCount) / sentCount * 100).toFixed(1) : 0,
        classificationBreakdown: classifRaw.map(r => ({ classification: r.classification ?? 'unknown', count: r.cnt })),
      }
    } catch (err) {
      console.error('[stats/analytics] bloc linkedin échoué (isolé) :', err)
      return { sent: 0, replies: 0, rdvCount: 0, replyRate: 0, classificationBreakdown: [] as Array<{ classification: string; count: number }> }
    }
  })()

  return NextResponse.json({
    period,
    linkedin,
    emailsSent,
    replies,
    replyRate,
    optouts,
    bounces,
    rdvCount,
    revenue,
    caApporte,
    commission,
    conversionRate,
    topCities,
    dailyActivity,
    pipeline: {
      prospects: totalContacts,
      contacted: contactedDistinct,
      replied: replies,
      rdv: rdvCount,
      signed: signedCount,
    },
    bestCity: bestCity ? { city: bestCity.city, replyRate: bestCity.replyRate, rdv: bestCity.rdv } : null,
    classificationBreakdown,
    autoRepliesSent,
    draftsValidated: autoRepliesSent,
    draftsPending,
  })
}
