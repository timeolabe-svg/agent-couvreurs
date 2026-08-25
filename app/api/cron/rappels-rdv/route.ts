import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'
import { pingHeartbeat } from '@/lib/heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RAPPELS AVANT RENDEZ-VOUS — 24 h, 3 h, 30 min.
 *
 * Demandé par Timéo après le no-show de Couvreur Jimmy le 18/08 : un rendez-vous manqué n'est pas
 * facturé, donc chaque no-show est une perte sèche. Le rappel est le levier le plus rentable qui
 * existe sur ce point — l'artisan est sur un chantier, il a dit oui il y a trois jours, il a
 * simplement oublié.
 *
 * ⚠️ TROIS RÈGLES QUI TIENNENT TOUT :
 *
 *  1. UN RAPPEL N'EST PAS UNE RELANCE COMMERCIALE. Aucun argument, aucune offre, aucune question
 *     ouverte : on redonne l'heure et le numéro, point. Un rappel qui vend redevient un mail de
 *     prospection, et c'est exactement ce que Timéo reproche à l'agent.
 *
 *  2. CHAQUE RAPPEL PART UNE FOIS ET UNE SEULE. Le cron tourne toutes les 10 minutes ; sans trace
 *     en base, le rappel « 30 min » partirait à chaque passage. C'est la mécanique qui a produit
 *     l'incident des 130 mails. On écrit donc la trace AVANT d'envoyer, avec une contrainte
 *     d'unicité (rdv_id, echeance) : si deux runs se chevauchent, le second est rejeté par la base,
 *     pas par un test applicatif qui peut perdre la course.
 *
 *  3. ON NE RAPPELLE QUE CE QUI EST CONFIRMÉ ET À VENIR. Un RDV annulé ou déjà passé ne reçoit
 *     rien — c'est le pendant de la règle « un RDV confirmé coupe toute relance automatique ».
 *
 * Le rappel « 30 min » part par email comme les autres. Timéo préfèrerait un SMS, et il a raison :
 * un artisan sur un toit ne lit pas ses mails. Ça demande un fournisseur SMS (compte + coût par
 * message) — le canal est prévu dans le code (`canal`), il reste à brancher.
 */

interface Echeance {
  cle: string
  minutesAvant: number
  /** Fenêtre de tir : on envoie si le RDV tombe dans [minutesAvant - tolerance, minutesAvant]. */
  toleranceMin: number
  libelle: string
}

// Ordre décroissant : on traite d'abord le rappel le plus lointain.
const ECHEANCES: Echeance[] = [
  { cle: 'j-1',    minutesAvant: 24 * 60, toleranceMin: 90, libelle: 'demain' },
  { cle: 'h-3',    minutesAvant: 180,     toleranceMin: 45, libelle: 'dans 3 heures' },
  { cle: 'min-30', minutesAvant: 30,      toleranceMin: 15, libelle: 'dans une demi-heure' },
]

function corpsRappel(e: Echeance, quand: string, telephoneClient: string | null): string {
  const lignes = [
    'Bonjour,',
    '',
    e.cle === 'min-30'
      ? `Petit rappel, notre échange est prévu ${e.libelle}, à ${quand}.`
      : `Petit rappel de notre échange prévu ${e.libelle}, ${quand}.`,
    '',
    telephoneClient
      ? `Je vous appelle sur le numéro que vous m'avez donné. Si ce n'est pas le bon moment, répondez à ce message et on décale.`
      : `Si ce n'est pas le bon moment, répondez simplement à ce message et on décale.`,
    '',
    'Bien à vous,',
  ]
  return lignes.join('\n')
}

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (process.env.SEND_PAUSED === '1') {
    return NextResponse.json({ ok: true, paused: true, message: 'Envoi en pause (SEND_PAUSED=1)' })
  }

  const { sql } = await import('@/lib/db')

  // Trace des rappels déjà partis. La contrainte d'unicité EST le garde-fou anti-doublon.
  await sql`
    CREATE TABLE IF NOT EXISTS rdv_rappels (
      id         SERIAL PRIMARY KEY,
      rdv_id     TEXT NOT NULL,
      echeance   TEXT NOT NULL,
      canal      TEXT NOT NULL DEFAULT 'email',
      envoye_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (rdv_id, echeance)
    )
  `

  const boxes = getGmailBoxes()
  if (boxes.length === 0) return NextResponse.json({ error: 'aucune boîte configurée' }, { status: 500 })

  /**
   * APERÇU — « est-ce que les rappels vont vraiment partir ? »
   *
   * Un cron qui répond « 0 envoyé » ne prouve rien : ça peut vouloir dire « rien à faire » comme
   * « je ne vois pas les rendez-vous ». On expose donc, pour chaque RDV à venir, l'heure exacte à
   * laquelle chaque rappel partira et ceux qui sont déjà partis. Vérifiable sans envoyer un mail
   * de test à un vrai prospect.
   */
  /**
   * ⚠️ UNE SEULE CONVENTION D HEURE DANS UN MEME ECRAN.
   * Cet apercu affichait l heure de tir en UTC et l heure d envoi reel en heure de Paris : les deux
   * colonnes semblaient decalees de 2 h et donnaient l impression d un rappel parti au mauvais
   * moment, alors que tout etait juste. Comparer deux colonnes exige la meme convention.
   */
  if (req.nextUrl.searchParams.get('apercu') === '1') {
    const rdvs = (await sql`
      SELECT r.id, r.scheduled_at, c.company, c.email
      FROM rdv r JOIN contacts c ON c.id = r.contact_id
      WHERE r.status = 'confirmed' AND r.scheduled_at > NOW()
      ORDER BY r.scheduled_at ASC LIMIT 20
    `) as Array<{ id: string; scheduled_at: string; company: string | null; email: string }>

    const dejaEnvoyes = (await sql`SELECT rdv_id, echeance, envoye_le FROM rdv_rappels`) as Array<{ rdv_id: string; echeance: string; envoye_le: string }>
    const envoye = new Map(dejaEnvoyes.map(x => [`${x.rdv_id}|${x.echeance}`, x.envoye_le]))

    return NextResponse.json({
      maintenant: new Date().toISOString(),
      rendez_vous_a_venir: rdvs.map(r => ({
        entreprise: r.company ?? r.email,
        rdv_le: new Date(r.scheduled_at).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }),
        rappels: ECHEANCES.map(e => {
          const t = new Date(new Date(r.scheduled_at).getTime() - e.minutesAvant * 60000)
          return {
            echeance: e.cle,
            part_vers: t.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }),
            etat: envoye.has(`${r.id}|${e.cle}`) ? 'déjà envoyé le ' + new Date(envoye.get(`${r.id}|${e.cle}`)!).toLocaleString('fr-FR', { timeZone: 'UTC' })
              : t.getTime() < Date.now() ? 'fenêtre passée'
              : 'à venir',
          }
        }),
      })),
    })
  }

  const envoyes: string[] = []
  const ignores: string[] = []

  for (const e of ECHEANCES) {
    const dus = (await sql`
      SELECT r.id, r.scheduled_at, c.email, c.company, c.phone,
             (SELECT q.sent_via FROM email_queue q
               WHERE q.contact_id = c.id AND q.status = 'sent' AND q.sent_via IS NOT NULL
               ORDER BY q.sent_at DESC LIMIT 1) AS boite_du_fil
      FROM rdv r
      JOIN contacts c ON c.id = r.contact_id
      WHERE r.status = 'confirmed'
        AND r.scheduled_at > NOW()
        AND r.scheduled_at <= NOW() + (${e.minutesAvant} || ' minutes')::interval
        AND r.scheduled_at >  NOW() + (${e.minutesAvant - e.toleranceMin} || ' minutes')::interval
        AND c.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM rdv_rappels x WHERE x.rdv_id = r.id::text AND x.echeance = ${e.cle})
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
        -- ⚠️ ON NE RAPPELLE PAS UN RENDEZ-VOUS PENDANT QUE LA CONVERSATION EST EN TRAIN DE BOUGER.
        -- Le 25/08, Jaky Lesage a écrit « je suis disponible MAINTENANT », a dit oui à un appel
        -- immédiat, et a reçu six minutes plus tard « rappel de notre échange prévu demain ». Le
        -- créneau de demain n'était plus d'actualité, le prospect venait de le dire, et le rappel
        -- l'a contredit. Un rappel est utile quand un rendez-vous dort, jamais quand il se
        -- renégocie sous nos yeux.
        AND NOT EXISTS (
          SELECT 1 FROM incoming_replies ir
          WHERE ir.contact_id = c.id AND ir.created_at > NOW() - INTERVAL '6 hours'
        )
    `) as Array<{ id: string; scheduled_at: string; email: string; company: string | null; phone: string | null; boite_du_fil: string | null }>

    for (const r of dus) {
      /**
       * ⚠️ ON POSE LA TRACE AVANT D'ENVOYER, PAS APRÈS.
       * Si l'envoi échoue, le prospect n'a pas de rappel — c'est regrettable mais sans gravité.
       * Si on écrivait après, un timeout entre l'envoi et l'écriture ferait repartir le rappel à
       * chaque passage du cron. Le mauvais côté de l'erreur n'est pas le même des deux côtés.
       */
      const pose = (await sql`
        INSERT INTO rdv_rappels (rdv_id, echeance, canal) VALUES (${r.id}::text, ${e.cle}, 'email')
        ON CONFLICT (rdv_id, echeance) DO NOTHING
        RETURNING id
      `) as Array<{ id: number }>
      if (pose.length === 0) { ignores.push(`${r.email} ${e.cle} (déjà envoyé)`); continue }

      // On reste sur la boîte du fil : le prospect connaît cette adresse, c'est celle du rendez-vous.
      const box = boxes.find(b => b.email.toLowerCase() === (r.boite_du_fil ?? '').toLowerCase()) ?? boxes[0]
      /**
       * ⚠️ L'HEURE EST STOCKÉE EN LOCAL NAÏF — LA CONVERTIR LA DÉCALE DE DEUX HEURES.
       *
       * Repéré grâce à l'aperçu, deux minutes avant le premier envoi réel : le RDV de TCT avait été
       * annoncé au prospect « jeudi 20 août à 10:00 », et mon rappel allait lui écrire « 12:00 ».
       * Un rappel qui donne la mauvaise heure est pire que pas de rappel du tout : il fait rater le
       * rendez-vous qu'il était censé sauver.
       *
       * Tout le projet formate ces dates avec timeZone 'UTC' (cf. conversation-followups) : la
       * valeur en base est déjà l'heure de Paris, on l'affiche telle quelle.
       */
      const quand = new Date(r.scheduled_at).toLocaleString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        timeZone: 'UTC',
      })

      const res = await sendFromBox(box, {
        to: r.email,
        subject: e.cle === 'j-1' ? `Notre échange ${e.libelle}` : `Rappel, notre échange ${e.libelle}`,
        text: corpsRappel(e, quand, r.phone) + `\n\n${getInboxSenderName(box.email)}\nHdigiweb\n${box.email}`,
        senderName: getInboxSenderName(box.email),
      }).catch(() => ({ ok: false }))

      envoyes.push(`${e.cle} → ${r.company ?? r.email} (${(res as { ok?: boolean }).ok ? 'envoyé' : 'ÉCHEC'})`)
    }
  }

  await pingHeartbeat('rappels-rdv', true, `envoyes=${envoyes.length}`, 60)
  return NextResponse.json({
    ok: true,
    rappels_envoyes: envoyes.length,
    detail: envoyes,
    ignores,
    echeances: ECHEANCES.map(e => `${e.cle} (${e.minutesAvant} min avant, fenêtre ${e.toleranceMin} min)`),
    lecture: 'Un rappel par échéance et par rendez-vous, jamais deux. Aucun argument commercial dans le message.',
  })
}

export const GET = handler
