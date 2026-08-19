import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * REMET EN ROUTE LES PROSPECTS QUI ONT DONNÉ UNE NOUVELLE ADRESSE ET N'ONT JAMAIS RIEN REÇU DESSUS.
 *
 * ⚠️ Ce sont les leads les plus faciles du fichier : ils ont lu le message, répondu, et pris la
 * peine d'indiquer où les joindre. Deux sur trois n'ont jamais été contactés à l'adresse qu'ils
 * avaient donnée — leur file avait été annulée par le nettoyage, faute d'avoir hérité du nombre
 * d'avis Google de la fiche d'origine (une colonne vide vaut zéro, donc « sous le seuil client »).
 *
 * On répare en deux temps, dans cet ordre :
 *   1. recopier les avis depuis la fiche d'origine (sans quoi le nettoyage recommencerait) ;
 *   2. rouvrir la ligne de départ pour que l'agent reprenne la séquence normalement.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  // Les fiches issues d'un changement d'adresse qui n'ont JAMAIS rien reçu.
  const cibles = (await sql`
    SELECT n.id, n.email, n.company, n.google_reviews_count AS avis_actuels,
           o.email AS ancienne_adresse, o.google_reviews_count AS avis_origine,
           (SELECT COUNT(*)::int FROM email_queue q
             WHERE q.contact_id = n.id AND q.status = 'sent') AS mails_partis
    FROM contacts n
    LEFT JOIN contacts o ON LOWER(o.redirige_vers) = LOWER(n.email)
    WHERE n.source = 'email_change'
  `) as Array<{
    id: string; email: string; company: string | null; avis_actuels: number | null
    ancienne_adresse: string | null; avis_origine: number | null; mails_partis: number
  }>

  const aReparer = cibles.filter(c => c.mails_partis === 0)
  const repares: string[] = []

  if (apply) {
    for (const c of aReparer) {
      // 1) Hériter des avis — sinon le nettoyage annulera de nouveau la file au prochain passage.
      if (c.avis_origine != null && c.avis_actuels == null) {
        await sql`UPDATE contacts SET google_reviews_count = ${c.avis_origine} WHERE id = ${c.id}`
      }
      // 2) Rouvrir la ligne de départ (jamais toucher aux 'sent').
      const r = (await sql`
        UPDATE email_queue SET status = 'pending', scheduled_at = NOW()
        WHERE contact_id = ${c.id}::uuid AND sequence_step = 0 AND status = 'cancelled'
        RETURNING id
      `) as Array<{ id: string }>
      if (r.length > 0) repares.push(`${c.company ?? c.email} (${c.ancienne_adresse} → ${c.email})`)
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    fiches_issues_d_un_changement_d_adresse: cibles.length,
    jamais_contactees_sur_la_nouvelle_adresse: aReparer.length,
    detail: aReparer.map(c => ({
      entreprise: c.company, nouvelle: c.email, ancienne: c.ancienne_adresse,
      avis_herites: c.avis_actuels ?? c.avis_origine,
    })),
    remises_en_route: repares,
  })
}
