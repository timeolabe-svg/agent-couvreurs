import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * LA VÉRIFICATION D'ADRESSES SUIT-ELLE LE RYTHME D'ENVOI ?
 *
 * ⚠️ La question ne se répond pas en relisant les réglages du cron (BATCH, budget de temps) : ce
 * sont des intentions. Ce qui compte, c'est combien d'adresses sortent RÉELLEMENT de la file
 * chaque jour, et combien d'entre elles deviennent envoyables.
 *
 * Le piège à éviter ici : compter les VÉRIFICATIONS et croire qu'on a compté du STOCK. Une adresse
 * vérifiée invalide ne donne aucun lead. Le seul débit qui compte, c'est celui des adresses qui
 * passent « prêtes à partir » — et il faut le comparer au rythme d'envoi, sinon l'agent tourne à
 * vide sans qu'aucun compteur ne se plaigne.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  // Débit réel, jour par jour, d'après la date de dernière tentative MillionVerifier.
  const parJour = (await sql`
    SELECT (mv_last_attempt_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')::date AS jour,
           COUNT(*)::int                                             AS verifiees,
           COUNT(*) FILTER (WHERE email_validated IS TRUE)::int      AS devenues_valides,
           COUNT(*) FILTER (WHERE mv_status = 'injoignable')::int    AS rejetees
    FROM contacts
    WHERE mv_last_attempt_at IS NOT NULL
      AND mv_last_attempt_at >= NOW() - INTERVAL '14 days'
    GROUP BY 1 ORDER BY 1 DESC
  `) as Array<Record<string, number | string>>

  /**
   * ⚠️ « VÉRIFIÉE » NE VEUT PAS DIRE « UTILISABLE ». MillionVerifier rend plusieurs verdicts, et
   * seuls les 'ok' donnent un lead. Le 17/08 : 155 adresses vérifiées, 19 seulement devenues
   * envoyables — sans cette ventilation on lit « 155 » et on croit le stock reconstitué.
   * catch_all = adresse acceptée par un serveur qui accepte tout : on ne l'envoie pas (source de
   * rebond), elle part en réserve. C'est une décision, pas une panne.
   */
  const verdicts = (await sql`
    SELECT COALESCE(mv_status, 'sans_verdict') AS verdict, COUNT(*)::int AS n
    FROM contacts
    WHERE mv_last_attempt_at >= NOW() - INTERVAL '7 days'
    GROUP BY 1 ORDER BY 2 DESC
  `) as Array<{ verdict: string; n: number }>

  // Ce qu'il reste à vérifier, et ce qui est déjà prêt.
  const [etat] = (await sql`
    WITH jamais AS (
      SELECT c.* FROM contacts c
      WHERE NOT EXISTS (
        SELECT 1 FROM email_queue q
        WHERE q.contact_id = c.id AND q.sequence_step = 0 AND q.status = 'sent'
      )
    )
    SELECT
      COUNT(*) FILTER (WHERE email_validated IS TRUE
                         AND COALESCE(google_reviews_count, 0) >= 20)::int  AS prets_a_partir,
      COUNT(*) FILTER (WHERE email_validated IS NOT TRUE
                         AND mv_status IS DISTINCT FROM 'injoignable')::int AS restent_a_verifier,
      COUNT(*) FILTER (WHERE email_validated IS NOT TRUE
                         AND mv_status IS DISTINCT FROM 'injoignable'
                         AND mv_last_attempt_at IS NULL)::int               AS jamais_tentees
    FROM jamais
  `) as Array<Record<string, number>>

  /**
   * Y A-T-IL VRAIMENT DES ADRESSES EN DOUBLE ?
   *
   * La dédup inter-fiches ne se justifie que si le cas existe. Sur ce projet, `contacts` porte une
   * contrainte d'unicité sur l'email (`ON CONFLICT (email) DO NOTHING` à l'import) : le doublon
   * observé sur les autres agents peut très bien être impossible ici. On mesure avant de coder.
   */
  const doublons = (await sql`
    SELECT LOWER(email) AS email, COUNT(*)::int AS fiches
    FROM contacts WHERE email IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
    ORDER BY 2 DESC LIMIT 20
  `) as Array<{ email: string; fiches: number }>

  /**
   * ⚠️ LES CONTACTS COINCÉS DANS LES LIMBES — ni envoyés, ni retentés, ni fermés.
   *
   * La fermeture des files zombies exige `email_confidence_score < 90`. Cette condition date de
   * l'époque où un score élevé autorisait l'envoi SANS MillionVerifier. Depuis que la clé MV est
   * posée, le moteur exige `email_validated IS TRUE` pour tout le monde : un contact à confiance
   * ≥ 90 qui épuise ses tentatives MV n'est donc plus envoyable, plus retentable (le sélecteur
   * exige `mv_attempts < MAX`), et plus fermable. Il reste en file À VIE.
   *
   * Ce sont les MEILLEURES adresses du fichier (score ≥ 90 = mailto cliquable sur leur propre site).
   */
  const limbes = (await sql`
    SELECT
      COUNT(*)::int AS contacts_bloques,
      COUNT(*) FILTER (WHERE COALESCE(email_confidence_score, 0) >= 90)::int AS dont_confiance_haute,
      (SELECT COUNT(*)::int FROM email_queue q
        WHERE q.status IN ('queued','pending')
          AND q.contact_id IN (
            SELECT id FROM contacts
            WHERE mv_attempts >= 5 AND email_validated IS NOT TRUE
              AND mv_status IS DISTINCT FROM 'injoignable'
          )) AS lignes_de_file_mortes
    FROM contacts
    WHERE mv_attempts >= 5 AND email_validated IS NOT TRUE
      AND mv_status IS DISTINCT FROM 'injoignable'
  `) as Array<Record<string, number>>

  // Rythme d'envoi réel : personnes démarchées par jour sur 7 jours.
  const [rythme] = (await sql`
    SELECT COALESCE(ROUND(COUNT(DISTINCT contact_id)::numeric / 7), 0)::int AS par_jour
    FROM email_queue
    WHERE status = 'sent' AND sequence_step = 0 AND sent_at >= NOW() - INTERVAL '7 days'
  `) as Array<{ par_jour: number }>

  const derniers7 = parJour.slice(0, 7)
  const verifParJour = Math.round(derniers7.reduce((s, l) => s + Number(l.verifiees), 0) / Math.max(1, derniers7.length))
  const validesParJour = Math.round(derniers7.reduce((s, l) => s + Number(l.devenues_valides), 0) / Math.max(1, derniers7.length))
  const envoiParJour = Number(rythme?.par_jour ?? 0)
  const restent = Number(etat?.restent_a_verifier ?? 0)

  /**
   * LE VERDICT. On compare des adresses DEVENUES ENVOYABLES à des personnes DÉMARCHÉES — deux
   * grandeurs de même nature. Comparer « vérifications » et « envois » donnerait un faux positif :
   * on peut vérifier 200 adresses par jour et n'en rendre que 10 utilisables.
   */
  const tientLeRythme = validesParJour >= envoiParJour

  return NextResponse.json({
    contacts_dans_les_limbes: limbes[0],
    adresses_en_double: { groupes: doublons.length, detail: doublons },
    debit_par_jour: parJour,
    verdicts_7_jours: verdicts,
    moyenne_7_jours: {
      adresses_verifiees: verifParJour,
      // LE chiffre : celles qui deviennent réellement envoyables.
      devenues_envoyables: validesParJour,
      personnes_demarchees: envoiParJour,
    },
    stock: {
      prets_a_partir: Number(etat?.prets_a_partir ?? 0),
      restent_a_verifier: restent,
      jamais_tentees: Number(etat?.jamais_tentees ?? 0),
      jours_pour_tout_verifier: verifParJour > 0 ? Math.round((restent / verifParJour) * 10) / 10 : null,
    },
    tient_le_rythme: tientLeRythme,
    lecture: tientLeRythme
      ? `La vérification rend ${validesParJour} adresses envoyables par jour pour ${envoiParJour} personnes démarchées. Elle suit.`
      : `⚠️ La vérification ne rend que ${validesParJour} adresses envoyables par jour alors qu'on en démarche ${envoiParJour}. Le stock se vide plus vite qu'il ne se remplit.`,
  })
}
