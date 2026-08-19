import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * RETIRE DE LA MESSAGERIE DES CONVERSATIONS DÉSIGNÉES À LA MAIN.
 *
 * Sert aux séquelles d'anciens bugs : en juin, des mails partaient sans objet et sans corps. Les
 * prospects ont répondu « votre message est vide », « j'ai rien reçu ». Ces échanges n'ont aucune
 * suite commerciale possible aujourd'hui — Timéo les a identifiés lui-même et demandé leur retrait.
 *
 * ⚠️ ON NE SUPPRIME RIEN. La ligne reste en base, on pose un marqueur d'archivage. Effacer un
 * échange avec un prospect ferait disparaître la trace d'un envoi réel, y compris pour une
 * éventuelle demande RGPD — et rendrait le comptage des messages faux a posteriori. Masquer se
 * défait, supprimer ne se défait pas.
 *
 * ?emails=a@b.fr,c@d.fr&apply=1
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const emails = (req.nextUrl.searchParams.get('emails') ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (emails.length === 0) return NextResponse.json({ error: 'paramètre ?emails= requis' }, { status: 400 })

  const { sql } = await import('@/lib/db')

  await sql`ALTER TABLE incoming_replies ADD COLUMN IF NOT EXISTS archive_le TIMESTAMPTZ`

  const cibles = (await sql`
    SELECT ir.id, LOWER(ir.from_email) AS email, ir.created_at, c.company
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE LOWER(ir.from_email) = ANY(${emails})
  `) as Array<{ id: string; email: string; created_at: string; company: string | null }>

  if (apply && cibles.length > 0) {
    await sql`UPDATE incoming_replies SET archive_le = NOW() WHERE LOWER(from_email) = ANY(${emails})`
  }

  const trouves = new Set(cibles.map(c => c.email))
  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    demandes: emails.length,
    messages_concernes: cibles.length,
    adresses_trouvees: [...trouves],
    adresses_introuvables: emails.filter(e => !trouves.has(e)),
    detail: cibles.map(c => ({ email: c.email, entreprise: c.company, recu_le: String(c.created_at).slice(0, 10) })),
    lecture: 'Les messages sont masqués de la messagerie, pas supprimés : la trace de l\'échange reste en base.',
  })
}
