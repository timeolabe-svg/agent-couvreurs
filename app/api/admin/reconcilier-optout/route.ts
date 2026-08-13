import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RÉCONCILIATION OPPOSITION ↔ FILE D'ENVOI.
 *
 * ⚠️ POURQUOI CET OUTIL EXISTE, ET POURQUOI IL DOIT TOURNER TOUT SEUL.
 *
 * La blocklist se remplit par PLUSIEURS chemins indépendants : réponse « Stop » détectée par
 * `poll-imap-replies`, demande RGPD, bounce, ajout manuel, et bientôt le désabonnement en un clic.
 * Chacun est censé faire DEUX choses : inscrire la personne, ET annuler ses mails déjà programmés.
 * Il suffit qu'UN SEUL de ces chemins oublie la seconde pour que quelqu'un de correctement
 * blocklisté continue de recevoir des mails.
 *
 * Ce n'est pas une hypothèse. Côté LabegarIA, le jour de la reprise des envois : 4 prospects se
 * désabonnent dans la matinée, sont bien inscrits, et gardent 18 mails programmés — dont deux pour
 * le soir même. Et j'ai moi-même corrigé aujourd'hui un `cancelSteps` qui portait un `LIMIT 1` :
 * l'annulation ne couvrait qu'une seule fiche contact sur deux.
 *
 * LE PRINCIPE : ne jamais faire reposer une opposition sur une seule ligne de défense. Le moteur
 * d'envoi refuse déjà les adresses blocklistées — c'est la première. Ceci est la seconde, et elle
 * est INDÉPENDANTE : elle ne demande à aucun chemin d'avoir bien fait son travail, elle compare
 * l'état final des deux tables. C'est exactement le manquement qui a produit la plainte CNIL.
 *
 * GET            → diagnostic (ne modifie rien) : qui est protégé mais garde des mails en file
 * GET ?apply=1   → annule ces mails
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  /**
   * ⚠️ La jointure se fait sur l'EMAIL, jamais sur `contact_id`.
   * Une même personne peut exister en plusieurs fiches (casse différente, import répété). Joindre
   * par identifiant ne verrait qu'une fiche et laisserait l'autre envoyer — c'est précisément le
   * bug du `LIMIT 1`. On couvre aussi les blocages par DOMAINE entier.
   */
  const enEcart = (await sql`
    SELECT c.email,
           c.company,
           b.reason        AS motif_opposition,
           b.created_at    AS oppose_depuis,
           COUNT(q.id)::int AS mails_programmes,
           MIN(q.scheduled_at) AS prochain_envoi
    FROM blocklist b
    JOIN contacts c
      ON (b.email IS NOT NULL AND LOWER(c.email) = LOWER(b.email))
      OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
    JOIN email_queue q
      ON q.contact_id = c.id
     AND q.status IN ('pending', 'queued', 'queued_instantly', 'scheduled', 'sending')
    GROUP BY c.email, c.company, b.reason, b.created_at
    ORDER BY MIN(q.scheduled_at) ASC NULLS LAST
  `) as Array<{
    email: string; company: string | null; motif_opposition: string | null
    oppose_depuis: string; mails_programmes: number; prochain_envoi: string | null
  }>

  const total = enEcart.reduce((n, r) => n + r.mails_programmes, 0)

  /**
   * ⚠️ SECONDE FAMILLE, DÉCOUVERTE LE 12/08 : la fiche a RÉPONDU mais n'est pas blocklistée.
   *
   * Le cas qui l'a révélée : un prospect répond « NO WAY ! » depuis son adresse personnelle. Le
   * particulier est blocklisté, l'entreprise démarchée non — et elle gardait trois relances
   * programmées pour les jours suivants. La réconciliation par blocklist ci-dessus ne pouvait pas
   * le voir : elle part de la liste, or la liste ne contenait pas la bonne adresse.
   *
   * On part donc de `incoming_replies.contact_id`, qui dit QUELLE FICHE a répondu quelle que soit
   * l'adresse d'expédition. Dès qu'une fiche a répondu, plus aucun mail FROID ne la concerne.
   * Les étapes >= 20 sont épargnées : ce sont les relances de conversation, faites pour ça.
   */
  const ontRepondu = (await sql`
    SELECT c.id, c.email, c.company,
           MIN(ir.created_at) AS a_repondu_le,
           COUNT(q.id)::int AS mails_froids_programmes,
           MIN(q.scheduled_at) AS prochain_envoi,
           BOOL_OR(ir.classification = 'desinterest') AS a_refuse
    FROM incoming_replies ir
    JOIN contacts c ON c.id = ir.contact_id
    JOIN email_queue q ON q.contact_id = c.id
     AND q.status IN ('pending', 'queued', 'queued_instantly', 'scheduled')
     AND q.sequence_step < 20
    WHERE COALESCE(ir.classification, '') NOT IN ('oof', 'spam', 'warmup')
    GROUP BY c.id, c.email, c.company
    ORDER BY MIN(q.scheduled_at) ASC
  `) as Array<{
    id: string; email: string; company: string | null; a_repondu_le: string
    mails_froids_programmes: number; prochain_envoi: string | null; a_refuse: boolean
  }>

  const totalFroids = ontRepondu.reduce((n, r) => n + r.mails_froids_programmes, 0)

  if (!apply) {
    return NextResponse.json({
      ok: enEcart.length === 0 && ontRepondu.length === 0,
      mode: 'diagnostic',
      opposes_avec_file_active: { personnes: enEcart.length, mails: total, detail: enEcart },
      ont_repondu_avec_relance_froide: {
        personnes: ontRepondu.length, mails: totalFroids,
        detail: ontRepondu.map(r => ({
          contact: r.company ?? r.email, email: r.email,
          a_repondu_le: r.a_repondu_le, mails: r.mails_froids_programmes,
          prochain_envoi: r.prochain_envoi,
          refus_explicite: r.a_refuse,
        })),
      },
      message: (enEcart.length + ontRepondu.length)
        ? 'Des prospects qui ont écrit ou se sont opposés ont ENCORE des mails programmés. Relancer avec ?apply=1.'
        : 'Aucun écart : personne ne reçoit de relance après avoir écrit.',
    })
  }

  const annules = (await sql`
    UPDATE email_queue q
    SET status = 'cancelled'
    FROM contacts c, blocklist b
    WHERE q.contact_id = c.id
      AND q.status IN ('pending', 'queued', 'queued_instantly', 'scheduled', 'sending')
      AND (
        (b.email IS NOT NULL AND LOWER(c.email) = LOWER(b.email))
        OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
      )
    RETURNING q.id
  `) as Array<{ id: string }>

  // Fiches ayant répondu : on coupe la séquence FROIDE uniquement.
  const idsRepondu = ontRepondu.map(r => r.id)
  const annulesFroids = idsRepondu.length
    ? (await sql`
        UPDATE email_queue SET status = 'cancelled'
        WHERE contact_id = ANY(${idsRepondu})
          AND status IN ('pending', 'queued', 'queued_instantly', 'scheduled')
          AND sequence_step < 20
        RETURNING id
      `) as Array<{ id: string }>
    : []

  /**
   * ⚠️ On ne blockliste QUE sur refus explicite (`desinterest`). Une question ou une demande de
   * rendez-vous ne doit surtout pas finir en blocklist : ce serait tuer le lead le plus chaud, la
   * faute symétrique de celle qu'on répare ici. Arrêter la séquence froide suffit dans ces cas.
   */
  const aBloquer = ontRepondu.filter(r => r.a_refuse).map(r => r.email)
  let bloques = 0
  for (const e of aBloquer) {
    const r = (await sql`
      INSERT INTO blocklist (email, reason)
      SELECT ${e}, 'desinterest'
      WHERE NOT EXISTS (SELECT 1 FROM blocklist WHERE LOWER(email) = LOWER(${e}))
      RETURNING id
    `) as Array<{ id: string }>
    bloques += r.length
  }

  return NextResponse.json({
    ok: true,
    mode: 'appliqué',
    opposes: { personnes: enEcart.length, mails_annules: annules.length },
    ont_repondu: {
      personnes: ontRepondu.length,
      mails_froids_annules: annulesFroids.length,
      blocklistes_pour_refus: bloques,
      detail: ontRepondu.map(r => `${r.company ?? r.email} — ${r.mails_froids_programmes} relance(s) froide(s) coupée(s)${r.a_refuse ? ', refus explicite → blocklist' : ''}`),
    },
  })
}

export const GET = wrapCron('reconcilier-optout', handler)
