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

  if (!apply) {
    return NextResponse.json({
      ok: enEcart.length === 0,
      mode: 'diagnostic',
      personnes_concernees: enEcart.length,
      mails_a_annuler: total,
      detail: enEcart,
      message: enEcart.length
        ? 'Ces personnes se sont opposées et ont ENCORE des mails programmés. Relancer avec ?apply=1.'
        : 'Aucun écart : toute personne opposée a bien sa file vidée.',
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

  return NextResponse.json({
    ok: true,
    mode: 'appliqué',
    mails_annules: annules.length,
    personnes_concernees: enEcart.length,
    detail: enEcart.map(r => `${r.company ?? r.email} — ${r.mails_programmes} mail(s), opposé depuis ${r.oppose_depuis}`),
  })
}

export const GET = wrapCron('reconcilier-optout', handler)
