import { NextResponse } from 'next/server'
import { getGmailBoxes } from '@/lib/gmail-sender'

export const dynamic = 'force-dynamic'

/**
 * LA CAPACITÉ D'ENVOI RÉELLE — calculée depuis les boîtes, pour de vrai.
 *
 * ⚠️ La page Campagnes affichait « CAPACITÉ D'ENVOI GLOBALE (CALCULÉE DEPUIS VOS BOÎTES MAILS) :
 * 334/jour, 7 348/mois ». Ce n'était calculé depuis rien : `const DAILY_CAPACITY = 334` était écrit
 * en dur dans la page. C'est sur ce chiffre qu'on répartit les campagnes en pourcentage et qu'on
 * décide s'il faut racheter des leads — un plafond imaginaire fait promettre un volume qui ne
 * partira jamais, et acheter de la donnée pour le remplir.
 *
 * Le moteur (send-campaign) raisonne en TROIS ENVELOPPES indépendantes, et c'est cette réalité-là
 * qu'il faut montrer : la capacité en NOUVEAUX CONTACTS est la seule qui mesure la prospection ; le
 * plafond des relances est un garde-fou technique très large, l'afficher comme de la « capacité »
 * gonflerait le chiffre exactement comme le faisait le 334.
 */

// Doivent rester alignés sur app/api/cron/send-campaign/route.ts.
const NEW_CAP_PER_BOX = 40
const RELANCE_CAP_PER_BOX = 150
const CONVO_DAILY_CAP = 30

export async function GET() {
  // ⚠️ Import DANS le handler : `lib/db` instancie la connexion Neon au chargement du module, et
  // la collecte de données du build (sans DATABASE_URL) plantait tout le build à cause de ça.
  const { sql } = await import('@/lib/db')
  const boxes = getGmailBoxes()

  const sentToday = (await sql`
    SELECT sent_via,
      SUM(CASE WHEN sequence_step = 0 THEN 1 ELSE 0 END)::int AS new_sent,
      SUM(CASE WHEN sequence_step BETWEEN 1 AND 19 THEN 1 ELSE 0 END)::int AS relance_sent
    FROM email_queue
    WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sent_via IS NOT NULL
    GROUP BY sent_via
  `) as Array<{ sent_via: string; new_sent: number; relance_sent: number }>
  const newByBox = new Map(sentToday.map(r => [r.sent_via, r.new_sent]))
  const relByBox = new Map(sentToday.map(r => [r.sent_via, r.relance_sent]))

  const detail = boxes.map(b => ({
    email: b.email,
    nouveaux_envoyes_aujourdhui: newByBox.get(b.email) ?? 0,
    nouveaux_plafond: NEW_CAP_PER_BOX,
    relances_envoyees_aujourdhui: relByBox.get(b.email) ?? 0,
  }))

  const nouveauxParJour = boxes.length * NEW_CAP_PER_BOX
  const nouveauxDejaPartis = detail.reduce((s, d) => s + d.nouveaux_envoyes_aujourdhui, 0)

  return NextResponse.json({
    // LE chiffre de la prospection : combien de personnes NOUVELLES peuvent être démarchées par jour.
    nouveaux_par_jour: nouveauxParJour,
    nouveaux_restants_aujourdhui: Math.max(0, nouveauxParJour - nouveauxDejaPartis),
    nouveaux_par_mois: nouveauxParJour * 22,
    // Garde-fou technique, PAS un objectif : les relances suivent le nombre de personnes en séquence.
    plafond_technique_relances_par_jour: boxes.length * RELANCE_CAP_PER_BOX,
    plafond_relances_conversation: CONVO_DAILY_CAP,
    boites: detail,
    nombre_de_boites: boxes.length,
    lecture: 'nouveaux_par_jour = 40 par boîte. Les relances ont leur propre enveloppe et ne mangent jamais cette capacité.',
  })
}
