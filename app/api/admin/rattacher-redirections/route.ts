import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * REPORTE SUR LA FICHE LES CHANGEMENTS D'ADRESSE DÉJÀ TRAITÉS.
 *
 * Le traitement du renvoi fonctionne depuis longtemps (contact créé sur la nouvelle adresse,
 * ancienne file annulée) mais il n'écrivait la trace que dans le journal d'événements. L'affichage,
 * lui, re-cherchait l'intention dans le texte du message — avec sa propre expression, plus étroite.
 * Résultat : des conversations reprises ailleurs restaient affichées comme « en attente ».
 *
 * On récupère donc les renvois passés depuis le journal (seul endroit où le lien ancienne → nouvelle
 * adresse existe) et on les inscrit sur la fiche.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  const evts = (await sql`
    SELECT DISTINCT
      LOWER(data->>'contactEmail') AS ancienne,
      LOWER(data->>'newEmail')     AS nouvelle
    FROM dashboard_events
    WHERE data->>'action' = 'email_updated'
      AND data->>'newEmail' IS NOT NULL
  `) as Array<{ ancienne: string; nouvelle: string }>

  /**
   * ⚠️ TOUS LES RENVOIS N'ONT PAS LAISSÉ D'ÉVÉNEMENT.
   *
   * Bleu 30 Piscines écrit le 03/07 « Veuillez noter notre changement d'adresse mail :
   * contact@bleu30-piscines.fr ». Aucun événement, aucune fiche créée, aucune trace : le message
   * date d'avant la mise en place du traitement, ou la branche a échoué en silence. Deux mois plus
   * tard, ce prospect n'a jamais rien reçu à l'adresse qu'il avait lui-même donnée, et il figurait
   * dans la liste des leads sans réponse sans qu'on sache pourquoi.
   *
   * On relit donc les messages eux-mêmes, avec la MÊME détection que la production, pour rattraper
   * ceux qui sont passés à travers.
   */
  const messages = (await sql`
    SELECT ir.id, ir.body, ir.subject, ir.created_at, c.id AS contact_id, c.email AS ancienne, c.redirige_vers
    FROM incoming_replies ir
    JOIN contacts c ON c.id = ir.contact_id
    WHERE c.redirige_vers IS NULL
      AND (ir.classification IS NULL OR ir.classification NOT IN ('spam', 'archive_bug'))
      AND ir.body ~* '(changement d|nouvelle adresse|nouveau (mail|email)|contactez[- ](moi|nous))'
    ORDER BY ir.created_at DESC
  `) as Array<{ id: string; body: string | null; subject: string | null; created_at: string; contact_id: string; ancienne: string; redirige_vers: string | null }>

  const rattrapesTexte: Array<{ ancienne: string; nouvelle: string; recu_le: string; ecrit: boolean }> = []
  for (const m of messages) {
    const corps = `${m.subject ?? ''}
${m.body ?? ''}`
    /**
     * ⚠️ CES TROIS EXPRESSIONS ONT ÉTÉ ABÎMÉES EN ÉCRIVANT CE FICHIER : les antislashs ont sauté au
     * passage dans un script, transformant `chang\w*\s+d'adresse` en `changw*s+d'adresse` — qui ne
     * correspond à rien, et qu'aucune vérification de types ne signale (c'est du JavaScript valide).
     * Un rattrapage silencieusement inopérant est pire que pas de rattrapage : il rassure.
     * Relire les expressions régulières APRÈS toute écriture automatisée de fichier.
     */
    const intention = /(chang\w*\s+d['’]?adresse|nouvelle\s+adresse|nouveau\s+(mail|email))/i.test(corps)
    if (!intention) continue
    const trouvees = (corps.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) ?? [])
      .map(x => x.toLowerCase().replace(/[.,;)\]]+$/, ''))
      .filter(x => x !== m.ancienne.toLowerCase() && !x.includes('hdigiweb') && !x.includes('sentry') && !x.includes('googleusercontent'))
    const nouvelle = trouvees[0]
    if (!nouvelle) continue

    let ecrit = false
    if (apply) {
      const r = (await sql`
        UPDATE contacts SET redirige_vers = ${nouvelle}
        WHERE id = ${m.contact_id}::uuid AND redirige_vers IS NULL
        RETURNING id
      `) as Array<{ id: string }>
      ecrit = r.length > 0
      if (ecrit) {
        // Fiche neuve sur la bonne adresse, avec les avis (sans eux le nettoyage l'annulerait).
        const nc = (await sql`
          INSERT INTO contacts (email, company, name, city, sector, phone, website, source,
            email_validated, email_confidence_score, audit_done, audit_score, audit_level,
            audit_weaknesses, audit_cms, google_rating, google_reviews_count)
          SELECT ${nouvelle}, company, name, city, sector, phone, website, 'email_change',
            true, 99, audit_done, audit_score, audit_level, audit_weaknesses, audit_cms,
            google_rating, google_reviews_count
          FROM contacts WHERE id = ${m.contact_id}::uuid
          ON CONFLICT (email) DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>
        if (nc[0]?.id) {
          await sql`
            INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
            SELECT ${nc[0].id}::uuid, campaign_id, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW()
            FROM email_queue WHERE contact_id = ${m.contact_id}::uuid ORDER BY created_at ASC LIMIT 1
          `
        }
        await sql`UPDATE email_queue SET status = 'cancelled' WHERE contact_id = ${m.contact_id}::uuid AND status IN ('pending','queued')`
      }
    }
    rattrapesTexte.push({ ancienne: m.ancienne, nouvelle, recu_le: String(m.created_at).slice(0, 10), ecrit })
  }

  const faits: Array<{ ancienne: string; nouvelle: string; ecrit: boolean }> = []

  for (const e of evts) {
    if (!e.ancienne || !e.nouvelle) continue
    let ecrit = false
    if (apply) {
      const r = (await sql`
        UPDATE contacts SET redirige_vers = ${e.nouvelle}
        WHERE LOWER(email) = ${e.ancienne} AND redirige_vers IS DISTINCT FROM ${e.nouvelle}
        RETURNING id
      `) as Array<{ id: string }>
      // ⚠️ On compte le RETURNING, pas l'intention : un compteur incrémenté à côté de l'écriture
      // annonce un travail qui n'a pas eu lieu.
      ecrit = r.length > 0
    }
    faits.push({ ancienne: e.ancienne, nouvelle: e.nouvelle, ecrit })
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    renvois_jamais_appliques: rattrapesTexte.length,
    detail_jamais_appliques: rattrapesTexte,
    renvois_trouves: faits.length,
    fiches_mises_a_jour: faits.filter(f => f.ecrit).length,
    detail: faits,
  })
}
