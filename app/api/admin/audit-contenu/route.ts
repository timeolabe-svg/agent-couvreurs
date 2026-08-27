import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 📨 AUDIT DU CONTENU RÉELLEMENT ENVOYÉ, ET DE LA QUALITÉ DES LEADS EN FILE.
 *
 * ⚠️ DEUX ZONES QUE JE N'AI JAMAIS AUDITÉES AUTREMENT QU'EN LISANT LE CODE.
 *
 * Tout ce que j'ai vérifié jusqu'ici portait sur la mécanique : les routes répondent, les crons
 * battent, les colonnes existent. Mais un prospect ne reçoit pas une mécanique — il reçoit un TEXTE,
 * et ce texte peut être parfaitement produit par un système parfaitement sain :
 *   · une consigne de style non respectée (tiret cadratin, deux-points) ;
 *   · un pied de page légal absent = infraction à l'article 14 ;
 *   · un gabarit non remplacé (« Bonjour {{prenom}} ») ;
 *   · un numéro de téléphone inventé — 368 prospects en ont déjà reçu un.
 *
 * Et symétriquement : la file peut être pleine de gens qu'on n'aurait jamais dû démarcher.
 *
 * Lecture seule. On lit ce qui est EN FILE (donc ce qui va partir) et ce qui est PARTI récemment.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL absent' }, { status: 503 })

  const { sql } = await import('@/lib/db')
  const out: Record<string, unknown> = {}
  const quoi = req.nextUrl.searchParams.get('quoi') ?? 'contenu'

  if (quoi === 'contenu') {
    /**
     * ⚠️ On regarde les mails EN FILE (`queued`/`pending`) : ce sont ceux qu'on peut encore
     * empêcher de partir. Les mails déjà envoyés sont comptés à part, comme dette.
     */
    out.en_file = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE body NOT ILIKE '%sources publiques%' AND body NOT ILIKE '%pour ne plus recevoir%')::int AS sans_mention_legale,
        COUNT(*) FILTER (WHERE body NOT ILIKE '%/u/%')::int AS sans_lien_desabonnement,
        COUNT(*) FILTER (WHERE body LIKE '%—%' OR body LIKE '%–%' OR subject LIKE '%—%')::int AS avec_tiret_cadratin,
        COUNT(*) FILTER (WHERE body LIKE '%{{%' OR body LIKE '%[[%' OR body ILIKE '%__pending%' OR subject LIKE '%{{%')::int AS gabarit_non_remplace,
        COUNT(*) FILTER (WHERE subject IS NULL OR BTRIM(subject) = '')::int AS sujet_vide,
        COUNT(*) FILTER (WHERE LENGTH(body) < 120)::int AS corps_trop_court,
        COUNT(*) FILTER (WHERE LENGTH(body) > 4000)::int AS corps_tres_long
      FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'`

    /**
     * ⚠️ TOUT NUMÉRO SORTANT DOIT ÊTRE LE VRAI. Incident du 08/08 : Gemini inventait la signature et
     * 368 prospects ont reçu un faux numéro. Le vrai est `06 29 99 03 96`. On cherche donc TOUS les
     * numéros français dans les corps, et on écarte celui-là.
     */
    out.numeros_sortants = await sql`
      SELECT numero, COUNT(*)::int AS occurrences, MIN(statut) AS vu_en
      FROM (
        SELECT REGEXP_REPLACE((REGEXP_MATCHES(body, '0[1-9](?:[ .-]?[0-9]{2}){4}', 'g'))[1], '[^0-9]', '', 'g') AS numero,
               status AS statut
        FROM email_queue
        WHERE status IN ('queued', 'pending', 'sent') AND sent_at > NOW() - INTERVAL '30 days'
      ) x
      WHERE numero <> '0629990396'
      GROUP BY numero ORDER BY 2 DESC LIMIT 10`

    /**
     * ⚠️ DATER ET COMPTER EN PERSONNES AVANT DE CRIER. Un décompte d'occurrences ne dit rien : le
     * même mail peut citer le numéro deux fois, et une dette de juillet n'est pas une fuite en cours.
     * On veut : combien de MAILS, combien de PERSONNES, et sur quelle période.
     */
    out.faux_numero = await sql`
      SELECT
        COUNT(*)::int AS mails,
        COUNT(DISTINCT contact_id)::int AS personnes,
        COUNT(*) FILTER (WHERE status = 'sent')::int AS deja_partis,
        COUNT(*) FILTER (WHERE status IN ('queued','pending'))::int AS encore_en_file,
        MIN(sent_at) AS premier_envoi, MAX(sent_at) AS dernier_envoi
      FROM email_queue
      WHERE body ~ '0[ .-]?6[ .-]?12[ .-]?34[ .-]?56[ .-]?78'`

    /** Les deux-points dans le corps : consigne de style de Timéo. On exclut les URL (http://). */
    out.deux_points = await sql`
      SELECT COUNT(*)::int AS n FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'
        AND REGEXP_REPLACE(body, 'https?://[^ ]*', '', 'g') LIKE '%:%'`

    /** Échantillon lisible : un mail réellement en file, pour juger à l'œil. */
    out.exemple = await sql`
      SELECT subject, LEFT(body, 700) AS corps
      FROM email_queue
      WHERE status IN ('queued', 'pending') AND body <> '__pending_generation__'
      ORDER BY scheduled_at LIMIT 1`
  }

  if (quoi === 'leads') {
    /**
     * QUI VA ÊTRE DÉMARCHÉ ? Un moteur sain qui écrit à la mauvaise cible reste un moteur qui gâche
     * la réputation des boîtes et le temps du client.
     */
    out.file_a_partir = await sql`
      SELECT
        COUNT(DISTINCT c.id)::int AS personnes,
        COUNT(DISTINCT c.id) FILTER (WHERE c.google_reviews_count IS NOT NULL AND c.google_reviews_count < 20)::int AS sous_20_avis,
        COUNT(DISTINCT c.id) FILTER (WHERE COALESCE(c.email_validated, false) = false)::int AS non_valides,
        COUNT(DISTINCT c.id) FILTER (WHERE c.redirige_vers IS NOT NULL)::int AS fiches_redirigees,
        COUNT(DISTINCT c.id) FILTER (WHERE c.absent_jusqu_au IS NOT NULL AND c.absent_jusqu_au > CURRENT_DATE)::int AS absents,
        COUNT(DISTINCT c.id) FILTER (WHERE c.pression_signalee_at IS NOT NULL)::int AS ont_signale_la_pression,
        COUNT(DISTINCT c.id) FILTER (WHERE EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(c.email)))::int AS blocklistes,
        COUNT(DISTINCT c.id) FILTER (WHERE EXISTS (SELECT 1 FROM incoming_replies ir WHERE ir.contact_id = c.id))::int AS ont_deja_repondu
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')`

    out.par_metier = await sql`
      SELECT COALESCE(c.sector, '(vide)') AS metier, COUNT(DISTINCT c.id)::int AS personnes
      FROM email_queue q JOIN contacts c ON c.id = q.contact_id
      WHERE q.status IN ('queued', 'pending')
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`

    out.doublons_par_entreprise = await sql`
      SELECT LOWER(BTRIM(company)) AS entreprise, COUNT(*)::int AS fiches
      FROM contacts WHERE company IS NOT NULL AND BTRIM(company) <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC LIMIT 10`
  }

  return NextResponse.json({ ok: true, ...out })
}

export const GET = handler
