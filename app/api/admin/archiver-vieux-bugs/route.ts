import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { isEmptyEmailComplaint } from '@/lib/reply-agent/classifier'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * SORT DE LA MESSAGERIE LES CONVERSATIONS QUI NE SONT QUE LA TRACE D'UN BUG PASSÉ.
 *
 * Demande de Timéo (19/08) : « les 3 derniers sont des anciens qui ne vont plus, c'est quand j'avais
 * des problèmes, il n'y a pas d'objet de message etc. supprime-les. »
 *
 * Ce sont les gens qui ont répondu « je n'ai rien reçu » / « votre message est vide » en juin et
 * juillet, quand des mails partaient sans contenu. Les rendre visibles était nécessaire pour
 * comprendre ce qui s'était passé ; leur répondre deux mois après ne l'est pas.
 *
 * ⚠️ ON N'EFFACE RIEN. La ligne reste en base avec un classement dédié : effacer ferait perdre la
 * trace du bug et de sa portée, et un même prospect réimporté demain repasserait par le même trou
 * sans qu'on sache qu'il avait déjà écrit. On les range, on ne les détruit pas.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  /**
   * Critère volontairement étroit : la plainte « mail vide » ET un message vieux de plus d'un mois.
   * Une plainte récente est un vrai signal (on enverrait ENCORE des mails vides) et doit rester
   * visible — c'est la seule alerte dont on dispose sur ce défaut.
   */
  const candidats = (await sql`
    SELECT ir.id, ir.from_email, ir.subject, ir.body, ir.created_at, c.company
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE ir.created_at < NOW() - INTERVAL '30 days'
      AND (ir.classification IS NULL OR ir.classification NOT IN ('spam', 'archive_bug'))
    ORDER BY ir.created_at ASC
  `) as Array<{ id: string; from_email: string; subject: string | null; body: string | null; created_at: string; company: string | null }>

  const aArchiver = candidats.filter(c => isEmptyEmailComplaint(c.body ?? '', c.subject ?? ''))

  if (apply) {
    for (const c of aArchiver) {
      await sql`UPDATE incoming_replies SET classification = 'archive_bug' WHERE id = ${c.id}`
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    conversations_archivees: aArchiver.length,
    detail: aArchiver.map(c => ({
      entreprise: c.company, email: c.from_email, recu_le: String(c.created_at).slice(0, 10),
      message: (c.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 90),
    })),
    lecture: 'Rien n\'est supprimé : ces réponses restent en base sous le classement archive_bug, elles sortent simplement de la messagerie.',
  })
}
