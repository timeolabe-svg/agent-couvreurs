import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * PRÉPARE UN BROUILLON DE RELANCE DANS « À VALIDER », POUR UN CONTACT DÉSIGNÉ.
 *
 * ⚠️ CE QUE CET ENDPOINT NE FAIT PAS : envoyer. La règle de Timéo est constante et il a eu à la
 * répéter — ce qui part chez un prospect qui a déjà répondu passe par lui. On dépose donc le texte
 * dans « À valider », il l'ajuste ou le rejette.
 *
 * ⚠️ ET SURTOUT : AUCUN PRIX N'EST ÉCRIT ICI. Le tarif réel de Haris n'est toujours pas connu, et
 * c'est précisément la question posée par le prospect. Inventer un montant serait la faute la plus
 * coûteuse possible — elle engage le client sur un chiffre qu'il n'a jamais donné.
 *
 * ?email=x@y.fr&texte=...&apply=1
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase()
  const texte = req.nextUrl.searchParams.get('texte') ?? ''
  const apply = req.nextUrl.searchParams.get('apply') === '1'
  if (!email || !texte) return NextResponse.json({ error: 'paramètres ?email= et ?texte= requis' }, { status: 400 })

  const { sql } = await import('@/lib/db')

  const [derniere] = (await sql`
    SELECT ir.id, ir.created_at, c.company
    FROM incoming_replies ir
    LEFT JOIN contacts c ON c.id = ir.contact_id
    WHERE LOWER(ir.from_email) = ${email}
    ORDER BY ir.created_at DESC LIMIT 1
  `) as Array<{ id: string; created_at: string; company: string | null }>

  if (!derniere) return NextResponse.json({ error: 'aucune réponse reçue de cette adresse' }, { status: 404 })

  // Un brouillon déjà en attente sur ce contact = ne pas en empiler un second.
  const [existant] = (await sql`
    SELECT rd.id FROM reply_drafts rd
    WHERE rd.incoming_reply_id = ${derniere.id}::uuid AND rd.status = 'pending'
    LIMIT 1
  `) as Array<{ id: string }>
  if (existant) {
    return NextResponse.json({ ok: true, deja_en_attente: true, message: 'Un brouillon est déjà en attente de validation pour ce contact.' })
  }

  if (apply) {
    await sql`
      INSERT INTO reply_drafts (incoming_reply_id, body, status, created_at)
      VALUES (${derniere.id}::uuid, ${texte}, 'pending', NOW())
    `
  }

  return NextResponse.json({
    mode: apply ? 'BROUILLON CRÉÉ (en attente de validation)' : 'APERÇU — relancer avec &apply=1',
    entreprise: derniere.company,
    dernier_message_recu_le: String(derniere.created_at).slice(0, 16),
    texte,
    lecture: 'Rien n\'est envoyé. Le brouillon apparaît dans « À valider ».',
  })
}
