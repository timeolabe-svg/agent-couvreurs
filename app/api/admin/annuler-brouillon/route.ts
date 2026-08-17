import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * RETIRER UN BROUILLON DE RÉPONSE QUI NE DOIT PAS PARTIR.
 *
 * ⚠️ Rien ne permettait de le faire. Quand un rattrapage a régénéré à tort une réponse pour un
 * prospect déjà répondu (« Couvreur Jimmy », 17/08), il n'existait aucun moyen de l'annuler : ni
 * endpoint, ni bouton. Le seul recours était d'attendre et d'espérer que personne ne valide.
 *
 * Un système qui sait créer un envoi doit savoir l'empêcher. C'est la contrepartie de l'autonomie.
 *
 * On passe en 'rejected' plutôt que de supprimer : la trace de ce qui a failli partir, et pourquoi
 * on l'a retenu, vaut mieux qu'une ligne disparue.
 *
 * GET ?email=…            → montre les brouillons en attente pour ce contact
 * GET ?email=…&apply=1    → les annule (jamais ceux déjà envoyés)
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'paramètre ?email= requis' }, { status: 400 })
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  const { sql } = await import('@/lib/db')

  const enAttente = (await sql`
    SELECT rd.id, rd.status, rd.created_at, LEFT(regexp_replace(rd.body, '\\s+', ' ', 'g'), 120) AS extrait
    FROM reply_drafts rd
    JOIN incoming_replies ir ON ir.id = rd.incoming_reply_id
    JOIN contacts c ON c.id = ir.contact_id
    WHERE LOWER(c.email) = ${email}
      AND rd.status IN ('pending', 'awaiting_validation', 'scheduled')
    ORDER BY rd.created_at DESC
  `) as Array<Record<string, unknown>>

  if (!apply) {
    return NextResponse.json({
      ok: true, mode: 'aperçu', email,
      brouillons_en_attente: enAttente.length,
      detail: enAttente,
      note: enAttente.length ? 'Relancer avec &apply=1 pour les annuler.' : 'Rien à annuler.',
    })
  }

  const annules = (await sql`
    UPDATE reply_drafts rd
    SET status = 'rejected', rejected_at = NOW()
    FROM incoming_replies ir, contacts c
    WHERE ir.id = rd.incoming_reply_id
      AND c.id = ir.contact_id
      AND LOWER(c.email) = ${email}
      AND rd.status IN ('pending', 'awaiting_validation', 'scheduled')
    RETURNING rd.id
  `) as Array<{ id: string }>

  return NextResponse.json({ ok: true, mode: 'appliqué', email, brouillons_annules: annules.length })
}

export const GET = wrapCron('annuler-brouillon', handler)
