import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { isEmptyEmailComplaint } from '@/lib/reply-agent/classifier'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * REPÊCHE LES PERSONNES QUI ONT SIGNALÉ UN MAIL VIDE ET QUI ONT ÉTÉ CLASSÉES « SPAM ».
 *
 * Le correctif du classifieur empêche les prochaines. Celui-ci rend visibles celles qui sont déjà
 * en base : tant que leur ligne porte `classification = 'spam'`, la messagerie les masque et
 * personne ne saura jamais qu'elles ont écrit.
 *
 * ⚠️ CE QUE CET ENDPOINT NE FAIT PAS, VOLONTAIREMENT : il n'envoie RIEN et ne génère aucun
 * brouillon. Ces messages datent de juin et juillet ; répondre automatiquement deux mois plus tard
 * à « je n'ai rien reçu » serait pire que le silence. On les remet sous les yeux de Timéo, il
 * décide. La règle « ce qui est à valider attend son accord » vaut aussi pour un rattrapage.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  const spams = (await sql`
    SELECT ir.id, ir.from_email, ir.subject, ir.body, ir.created_at, c.company
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE ir.classification = 'spam'
    ORDER BY ir.created_at DESC
  `) as Array<{ id: string; from_email: string; subject: string | null; body: string | null; created_at: string; company: string | null }>

  // Le tri se fait avec la MÊME fonction que le classifieur : deux règles séparées finiraient par
  // diverger, et on repêcherait autre chose que ce qu'on a corrigé.
  const aRepecher = spams.filter(s => isEmptyEmailComplaint(s.body ?? '', s.subject ?? ''))

  if (apply) {
    for (const s of aRepecher) {
      await sql`UPDATE incoming_replies SET classification = 'question' WHERE id = ${s.id}`
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    messages_classes_spam: spams.length,
    vraies_personnes_a_repecher: aRepecher.length,
    detail: aRepecher.map(s => ({
      email: s.from_email,
      entreprise: s.company,
      recu_le: s.created_at,
      message: (s.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120),
    })),
    lecture: 'Aucun message ne leur est envoyé : ils redeviennent seulement visibles dans la messagerie, onglet « En attente ».',
  })
}
