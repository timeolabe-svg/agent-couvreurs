import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 🔬 AUDIT A→Z — LES FAITS BRUTS DONT J'AI BESOIN POUR VÉRIFIER LE CODE CONTRE LA RÉALITÉ.
 *
 * ⚠️ POURQUOI CET OUTIL EXISTE (26/08/2026). Timéo : « vous êtes 4 conversations à avoir fait 2
 * audits chacun et t'as encore des problèmes, c'est pas possible ». Il a raison, et l'explication
 * tient en une phrase : **les huit audits ont tous relu du CODE**, en se recopiant les uns les
 * autres. Ils ont donc hérité des mêmes angles morts.
 *
 * Les deux pannes que personne n'avait vues ont été trouvées autrement :
 *   · le webhook Stripe derrière le mur d'authentification → par un `curl` qui a répondu 307 ;
 *   · la clé MillionVerifier lue sous un nom et posée sous un autre → en comparant ce que le code
 *     LIT avec ce que Vercel CONTIENT.
 *
 * Aucune des deux ne provoque d'erreur : elles provoquent une fonctionnalité qui ne marche pas, en
 * silence. Aucune relecture ne les attrape.
 *
 * Cet endpoint ne juge rien. Il expose la structure RÉELLE de la base et les compteurs qui
 * permettent de confronter chaque affirmation du code à un fait. Lecture seule.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL absent' }, { status: 503 })

  const { sql } = await import('@/lib/db')
  const quoi = req.nextUrl.searchParams.get('quoi') ?? 'schema'
  const out: Record<string, unknown> = {}

  /** Structure réelle : sert à repérer toute colonne écrite par le code mais inexistante en base. */
  if (quoi === 'schema') {
    out.colonnes = await sql`
      SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) AS colonnes
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name ORDER BY table_name`
  }

  /**
   * MillionVerifier a-t-il DÉJÀ tourné ? `mv_attempts` n'est incrémenté que sur un verdict rendu :
   * si la somme est nulle, l'API n'a jamais répondu une seule fois.
   */
  if (quoi === 'mv') {
    out.validation = await sql`
      SELECT COUNT(*)::int AS contacts,
             COUNT(*) FILTER (WHERE email_validated)::int AS marques_valides,
             COALESCE(SUM(mv_attempts), 0)::int AS total_tentatives_mv,
             COUNT(*) FILTER (WHERE mv_last_attempt_at IS NOT NULL)::int AS contacts_deja_tentes,
             MAX(mv_last_attempt_at) AS derniere_tentative
      FROM contacts`
    out.envois_vers_non_valides = await sql`
      SELECT COUNT(DISTINCT c.id)::int AS n
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent' AND COALESCE(c.email_validated, false) = false`
    out.rebonds = await sql`
      SELECT COUNT(*)::int AS n FROM blocklist WHERE reason = 'bounce'`
    /**
     * ⚠️ DATER AVANT DE CONCLURE. 625 contacts non validés ont reçu un mail — mais la question n'est
     * pas « combien », c'est « QUAND ». Si tout est antérieur à la pose du verrou, c'est une dette
     * fermée ; s'il y en a cette semaine, le verrou fuit encore. Les deux se corrigent différemment,
     * et confondre les deux fait annoncer une panne là où il n'y a qu'un passé.
     */
    out.envois_non_valides_par_semaine = await sql`
      SELECT to_char(date_trunc('week', q.sent_at), 'YYYY-MM-DD') AS semaine,
             COUNT(DISTINCT c.id)::int AS contacts
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status = 'sent' AND COALESCE(c.email_validated, false) = false
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
    /** Un rebond qui n'a PAS coupé la file est un mail qui repartira dans le vide. */
    out.rebonds_encore_en_file = await sql`
      SELECT COUNT(DISTINCT c.id)::int AS n
      FROM blocklist b JOIN contacts c ON LOWER(c.email) = LOWER(b.email)
      JOIN email_queue q ON q.contact_id = c.id
      WHERE b.reason = 'bounce' AND q.status IN ('queued','pending')`
  }

  /**
   * QUI A DEMANDÉ L'ARRÊT SANS ÊTRE BLOCKLISTÉ ?
   *
   * Le filet CNIL annulait la file mais ne blocklistait personne (colonnes fantômes `source`/`notes`,
   * INSERT rejeté en entier, `.catch` muet). Ces personnes sont donc protégées seulement tant
   * qu'aucune nouvelle ligne de file n'apparaît. On les compte.
   */
  if (quoi === 'refus') {
    out.ont_demande_l_arret_sans_blocklist = await sql`
      SELECT c.email, c.company, MIN(ir.created_at) AS a_ecrit_le,
             (SELECT COUNT(*)::int FROM email_queue q
               WHERE q.contact_id = c.id AND q.status IN ('queued','pending')) AS encore_en_file
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.classification IN ('desinterest', 'unsubscribe', 'mise_en_demeure')
        AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email))
      GROUP BY c.id, c.email, c.company
      ORDER BY 3 DESC LIMIT 100`
    out.total_blocklist = await sql`
      SELECT reason, COUNT(*)::int AS n FROM blocklist GROUP BY reason ORDER BY 2 DESC`
  }

  /** Volumétrie des tables : une table vide que le code lit est une fonctionnalité qui ne tourne pas. */
  if (quoi === 'volumes') {
    out.tables = await sql`
      SELECT relname AS table_name, n_live_tup AS lignes_estimees
      FROM pg_stat_user_tables ORDER BY n_live_tup DESC`
  }

  return NextResponse.json({ ok: true, ...out })
}

export const GET = handler
