import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { verifierAffirmations } from '@/lib/verifier-affirmations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * COMBIEN DE PROSPECTS ONT REÇU UNE AFFIRMATION FAUSSE SUR LEUR SITE ?
 *
 * ⚠️ Mesurer, pas supposer. Le 17/08 on découvre qu'un mail affirmait « votre site s'affiche mal
 * sur téléphone » à un prospect dont le site est noté 88/moderne. La cause : la phrase d'audit se
 * déclenchait sur le mot « mobile », qui traîne dans une faiblesse sans rapport (« appel impossible
 * depuis un mobile »). La question qui compte n'est pas « est-ce corrigé » mais « à combien de
 * personnes est-ce déjà parti ».
 *
 * On relit donc les mails RÉELLEMENT ENVOYÉS contre l'audit RÉEL de chaque contact. C'est la seule
 * façon honnête de chiffrer : compter les lignes fautives dans le code ne dit rien du nombre de
 * personnes touchées.
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  const lignes = (await sql`
    SELECT q.id, q.sent_at, q.status, q.body, q.sequence_step,
           c.email, c.company, c.audit_level, c.audit_score, c.audit_weaknesses
    FROM email_queue q
    JOIN contacts c ON c.id = q.contact_id
    WHERE q.status IN ('sent', 'queued') AND q.body IS NOT NULL
    ORDER BY q.sent_at DESC NULLS LAST
  `) as Array<{
    id: string; sent_at: string; status: string; body: string; sequence_step: number
    email: string; company: string; audit_level: string | null
    audit_score: number | null; audit_weaknesses: string[] | null
  }>

  const fautifs = lignes
    .map(l => {
      const ctrl = verifierAffirmations(l.body, l.audit_weaknesses, l.audit_level !== 'no-website')
      return ctrl.ok ? null : {
        etat: l.status,
        email: l.email,
        entreprise: l.company,
        envoye_le: l.sent_at,
        etape: l.sequence_step,
        affirmations_non_fondees: ctrl.inventions,
        audit_reel: { niveau: l.audit_level, score: l.audit_score, faiblesses: l.audit_weaknesses },
      }
    })
    .filter(Boolean)

  const personnes = new Set(fautifs.map(f => f!.email))

  return NextResponse.json({
    mails_envoyes_examines: lignes.length,
    mails_fautifs: fautifs.length,
    // LE chiffre : des personnes réelles, pas des lignes de base.
    personnes_concernees: personnes.size,
    detail: fautifs.slice(0, 50),
    lecture: fautifs.length === 0
      ? 'Aucun mail envoyé n\'affirme un défaut que l\'audit ne constate pas.'
      : `${personnes.size} personne(s) ont reçu au moins une affirmation fausse sur leur site. Le correctif empêche les prochains, il ne rattrape pas ceux-là.`,
  })
}
