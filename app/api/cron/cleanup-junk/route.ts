import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Nettoyage des conversations MORTES / parasites (spam, challenge-response, plaintes
// "mail vide", "qui êtes-vous", mauvaise cible). Par défaut = APERÇU (mode=dry) : ne
// supprime RIEN, compte seulement. mode=delete pour supprimer réellement.
// Auth cron (?key= ou Bearer).
const JUNK_ILIKE = [
  '%spamenmoins%', '%confirmer l\'envoi%', '%confirme mon envoi%',
  '%qui êtes-vous%', '%qui etes vous%', '%vous êtes qui%', '%vous etes qui%',
  '%je ne vous connais pas%', '%on ne se connait pas%', '%d\'où vient ce mail%', '%d\'ou vient ce mail%',
  '%n\'ai rien reçu%', '%n\'ai rien recu%', '%mail vide%', '%message vide%',
  '%ne sommes pas une entreprise de%', '%pas notre activité%', '%pas notre activite%',
  '%vous trompez d\'entreprise%', '%mauvais secteur%', '%trompé de destinataire%',
]

export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })

  sql = (await import('@/lib/db')).sql
  const mode = new URL(req.url).searchParams.get('mode') ?? 'dry'

  // On supprime UNIQUEMENT les conversations vraiment mortes (motifs ci-dessus).
  // PAS tous les 'spam' : un accusé de réception auto est un VRAI prospect qu'on
  // recontacte plus tard (il est juste masqué de la messagerie, pas supprimé).
  const candidates = (await sql`
    SELECT id, from_email, classification, LEFT(body, 80) AS extrait
    FROM incoming_replies
    WHERE body ILIKE ANY(${JUNK_ILIKE})
    ORDER BY created_at DESC
    LIMIT 200
  `) as Array<{ id: string; from_email: string; classification: string | null; extrait: string }>

  if (mode !== 'delete') {
    return NextResponse.json({
      mode: 'aperçu (aucune suppression)',
      total: candidates.length,
      exemples: candidates.slice(0, 25).map(c => ({ de: c.from_email, classe: c.classification, extrait: (c.extrait || '').replace(/\s+/g, ' ').trim() })),
      pour_supprimer: 'relancer avec &mode=delete',
    })
  }

  // Suppression réelle : d'abord les brouillons liés, puis les réponses.
  const ids = candidates.map(c => c.id)
  if (ids.length === 0) return NextResponse.json({ mode: 'delete', supprimés: 0 })
  await sql`DELETE FROM reply_drafts WHERE incoming_reply_id = ANY(${ids})`
  const del = (await sql`DELETE FROM incoming_replies WHERE id = ANY(${ids}) RETURNING id`) as Array<{ id: string }>
  return NextResponse.json({ mode: 'delete', supprimés: del.length })
}
