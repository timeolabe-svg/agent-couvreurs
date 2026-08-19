import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * QUEL PROSPECT A ÉCRIT SANS APPARAÎTRE DANS LA MESSAGERIE ?
 *
 * ⚠️ Question posée par Timéo le 18/08 : « je ne le trouve nulle part dans le logiciel, t'as oublié
 * d'autres leads ? ». Un lead qu'on ne voit pas est un lead perdu, et c'est le pire défaut possible
 * — il ne déclenche aucune erreur, aucun compteur ne baisse, l'écran a simplement l'air normal.
 *
 * On compare donc DEUX populations qui devraient coïncider :
 *   1. les personnes qui ont RÉELLEMENT écrit (incoming_replies) ;
 *   2. celles que la messagerie affiche (même filtre que /api/conversations).
 *
 * Trois façons de disparaître, toutes vérifiées ici :
 *   - classée 'spam' → l'API les exclut, donc un vrai prospect mal classé devient invisible ;
 *   - sans contact_id → orpheline, elle n'appartient à personne ;
 *   - présente mais rangée dans un onglet que personne n'ouvre (l'écran s'ouvre sur « Positives »).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  // 1) Tout le monde a-t-il une place dans la messagerie ?
  const invisibles = (await sql`
    SELECT LOWER(ir.from_email) AS email,
           ir.classification,
           COUNT(*)::int AS messages,
           MAX(ir.created_at) AS dernier,
           BOOL_OR(ir.contact_id IS NULL) AS sans_contact
    FROM incoming_replies ir
    WHERE ir.classification = 'spam' OR ir.contact_id IS NULL
    GROUP BY 1, 2
    ORDER BY 4 DESC
  `) as Array<Record<string, unknown>>

  // 2) Répartition par onglet : un lead rangé ailleurs que dans l'onglet ouvert par défaut est
  //    « invisible » au sens de l'utilisateur, même s'il est bien en base.
  const parOnglet = (await sql`
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = ir.contact_id AND r.status IN ('confirmed','signed')) THEN 'positive (onglet par défaut)'
        WHEN ir.classification = 'desinterest' THEN 'negative'
        ELSE 'en attente / autre onglet'
      END AS onglet,
      COUNT(DISTINCT LOWER(ir.from_email))::int AS personnes
    FROM incoming_replies ir
    WHERE ir.classification IS NULL OR ir.classification <> 'spam'
    GROUP BY 1 ORDER BY 2 DESC
  `) as Array<{ onglet: string; personnes: number }>

  // 3) Qui a écrit sans jamais recevoir de réponse de l'agent ? (invariant « zéro lead perdu »)
  const sansReponse = (await sql`
    SELECT LOWER(ir.from_email) AS email, MAX(ir.created_at) AS dernier_message,
           MAX(c.company) AS entreprise
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE (ir.classification IS NULL OR ir.classification NOT IN ('spam', 'oof', 'desinterest', 'archive_bug'))
      AND NOT EXISTS (
        SELECT 1 FROM reply_drafts rd
        WHERE rd.incoming_reply_id = ir.id AND rd.status = 'sent'
      )
      AND NOT EXISTS (
        SELECT 1 FROM email_queue q
        WHERE q.contact_id = ir.contact_id AND q.sequence_step >= 20 AND q.status = 'sent'
          AND q.sent_at > ir.created_at
      )
    GROUP BY 1
    HAVING MAX(ir.created_at) < NOW() - INTERVAL '6 hours'
    ORDER BY 2 DESC
  `) as Array<Record<string, unknown>>

  /**
   * ⚠️ COMBIEN DE MESSAGES AU TOTAL ? La messagerie n'en lit que les 500 plus récents : au-delà,
   * les conversations anciennes disparaissent de l'écran sans que rien ne le signale.
   */
  const [{ messages }] = (await sql`SELECT COUNT(*)::int AS messages FROM incoming_replies`) as Array<{ messages: number }>

  const [{ total }] = (await sql`
    SELECT COUNT(DISTINCT LOWER(from_email))::int AS total FROM incoming_replies
  `) as Array<{ total: number }>

  return NextResponse.json({
    personnes_ayant_ecrit: total,
    messages_en_base: messages,
    plafond_de_lecture_messagerie: 500,
    tronque: messages > 500,
    // Invisibles dans la messagerie : classées spam ou sans fiche rattachée.
    invisibles_dans_la_messagerie: { n: invisibles.length, detail: invisibles },
    // Où se rangent les autres — l'écran s'ouvre sur « Positives ».
    repartition_par_onglet: parOnglet,
    // Le vrai invariant : personne ne doit rester sans réponse plus de quelques heures.
    sans_reponse_depuis_plus_de_6h: { n: sansReponse.length, detail: sansReponse },
    lecture: invisibles.length === 0 && sansReponse.length === 0
      ? 'Chaque personne qui a écrit est visible dans la messagerie et a reçu une réponse.'
      : 'Voir le détail : des messages sont invisibles ou sans réponse.',
  })
}
