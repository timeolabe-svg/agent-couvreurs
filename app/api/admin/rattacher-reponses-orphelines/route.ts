import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * RATTACHE LES RÉPONSES QUI N'APPARTIENNENT À PERSONNE.
 *
 * ⚠️ Une réponse dont `contact_id` est NULL est invisible pour TOUT ce qui raisonne par contact :
 * la messagerie, l'historique de la fiche, les compteurs, la détection de lead en attente. Elle est
 * en base, elle est lisible en SQL, et pourtant elle n'existe pour aucun écran.
 *
 * Cas trouvé le 18/08 : eseveranpeinture@gmail.com écrit le 25/06 « je n'ai reçu aucun document ».
 * Un contact est bien créé pour lui le lendemain — mais le lien n'a jamais été posé entre les deux.
 * Deux mois plus tard il n'est nulle part.
 *
 * On rapproche par ADRESSE, la seule clé fiable ici. Quand plusieurs fiches partagent l'adresse
 * (ça n'arrive pas aujourd'hui, cf. la contrainte d'unicité) on prend la plus ancienne : c'est
 * celle qui porte l'historique d'envoi.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  const orphelines = (await sql`
    SELECT ir.id, ir.from_email, ir.created_at, ir.classification,
           (SELECT c.id FROM contacts c
             WHERE LOWER(c.email) = LOWER(ir.from_email)
             ORDER BY c.created_at ASC LIMIT 1) AS contact_trouve
    FROM incoming_replies ir
    WHERE ir.contact_id IS NULL
    ORDER BY ir.created_at DESC
  `) as Array<{ id: string; from_email: string; created_at: string; classification: string | null; contact_trouve: string | null }>

  const rattachables = orphelines.filter(o => o.contact_trouve)

  if (apply) {
    for (const o of rattachables) {
      await sql`UPDATE incoming_replies SET contact_id = ${o.contact_trouve}::uuid WHERE id = ${o.id}`
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    reponses_orphelines: orphelines.length,
    rattachables: rattachables.length,
    // Sans fiche correspondante : ce sont des expéditeurs qu'on n'a jamais démarchés.
    sans_fiche_correspondante: orphelines.filter(o => !o.contact_trouve).map(o => o.from_email),
    detail: rattachables.map(o => ({ email: o.from_email, recu_le: o.created_at, classification: o.classification })),
  })
}
