import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { extractReturnDate } from '@/app/api/cron/poll-imap-replies/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * REPÊCHE TOUS LES « JE SUIS FERMÉ / EN CONGÉS » DEPUIS LE DÉBUT, ET NOTE LEUR DATE DE RETOUR.
 *
 * ⚠️ Ces prospects sont les MIEUX disposés du fichier et ils étaient traités comme des déchets :
 * classés « absence », masqués de la messagerie, rangés nulle part. « Je suis en congés, rappelez
 * après le 25 » n'est pas un refus — c'est un rendez-vous à date, donné spontanément.
 *
 * On relit donc TOUT l'historique des réponses, on en extrait la date de retour avec la même
 * fonction que le poller (une seconde implémentation finirait par diverger), et on l'écrit sur la
 * fiche. Ils deviennent alors visibles dans l'onglet « Absents » et relançables à la bonne date.
 *
 * ⚠️ Une date de retour DÉJÀ PASSÉE est conservée telle quelle : c'est justement le signal qu'on a
 * raté le créneau et qu'il faut recontacter maintenant. L'effacer masquerait l'oubli.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  // On ne se limite pas aux lignes classées 'oof' : la classification a pu se tromper, et le texte
  // fait foi. On ratisse large puis on ne garde que ce qui contient une vraie date de retour.
  const candidats = (await sql`
    SELECT ir.id, ir.contact_id, ir.from_email, ir.body, ir.created_at, ir.classification,
           c.company, c.absent_jusqu_au
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE ir.contact_id IS NOT NULL
      AND (
        ir.classification = 'oof'
        OR ir.body ~* '(cong[ée]s?|ferm[ée]|vacances|absent|reprise|r[ée]ouvert|de retour|jusqu.au)'
      )
    ORDER BY ir.created_at ASC
  `) as Array<{
    id: string; contact_id: string; from_email: string; body: string | null
    created_at: string; classification: string | null; company: string | null; absent_jusqu_au: string | null
  }>

  const trouves: Array<{ email: string; entreprise: string | null; message_du: string; retour_le: string; deja_passe: boolean }> = []
  const sansDate: string[] = []
  const vus = new Set<string>()

  for (const c of candidats) {
    if (vus.has(c.contact_id)) continue
    // La date est calculée par rapport à la date du MESSAGE, pas à aujourd'hui : « de retour le 5 »
    // écrit en juin veut dire le 5 juillet, pas le 5 du mois prochain.
    const ret = extractReturnDate(c.body ?? '', new Date(c.created_at))
    if (!ret) { if (c.classification === 'oof') sansDate.push(c.from_email); continue }
    vus.add(c.contact_id)

    const iso = ret.toISOString().slice(0, 10)
    trouves.push({
      email: c.from_email,
      entreprise: c.company,
      message_du: String(c.created_at).slice(0, 10),
      retour_le: iso,
      deja_passe: ret.getTime() < Date.now(),
    })

    if (apply) {
      await sql`
        UPDATE contacts
        SET absent_jusqu_au = ${iso},
            absence_motif   = ${(c.body ?? '').replace(/\s+/g, ' ').slice(0, 300)},
            absence_vue_le  = ${c.created_at}
        WHERE id = ${c.contact_id}
      `
    }
  }

  const aRecontacter = trouves.filter(t => t.deja_passe)

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    messages_examines: candidats.length,
    absences_avec_date_de_retour: trouves.length,
    // ⚠️ LE chiffre qui compte : ceux dont la date est passée et qu'on n'a jamais recontactés.
    date_deja_passee_a_recontacter: aRecontacter.length,
    detail: trouves,
    absences_sans_date_lisible: sansDate,
    lecture: 'La date est calculée par rapport à la date du message, pas à aujourd\'hui. Les dates déjà passées sont conservées : ce sont les créneaux qu\'on a ratés.',
  })
}
