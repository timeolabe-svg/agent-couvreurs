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

  const partis = fautifs.filter(f => f!.etat === 'sent')
  const aPartir = fautifs.filter(f => f!.etat === 'queued')
  const personnes = new Set(partis.map(f => f!.email))

  return NextResponse.json({
    mails_examines: lignes.length,
    // Ce qui est DÉJÀ parti : irréparable, on le chiffre honnêtement plutôt que de l'arrondir.
    mails_fautifs_deja_partis: partis.length,
    personnes_deja_touchees: personnes.size,
    /**
     * ⚠️ LE CHIFFRE QUI COMPTE MAINTENANT : ce qui n'est PAS encore parti.
     *
     * Consigne de Timéo le 17/08 : pour ces personnes, la relance ne doit surtout pas répéter
     * l'affirmation fausse, elle doit repartir sur les templates validés comme si de rien n'était.
     * Tant que ce nombre n'est pas 0, la faute est encore devant nous, pas derrière.
     */
    mails_fautifs_ENCORE_EN_FILE: aPartir.length,
    detail_encore_en_file: aPartir.slice(0, 50),
    detail_deja_partis: partis.slice(0, 20),
    lecture: aPartir.length === 0
      ? `Aucune relance en attente ne répète une affirmation non fondée. ${personnes.size} personne(s) l'ont reçue avant le correctif, ça ne se rattrape pas.`
      : `⚠️ ${aPartir.length} mail(s) encore en file portent une affirmation fausse. Lancer /api/admin/refresh-queued?apply=1.`,
  })
}
