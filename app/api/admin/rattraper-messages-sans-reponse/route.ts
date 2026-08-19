import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * CRÉE UN BROUILLON POUR CHAQUE MESSAGE RESTÉ SANS RÉPONSE.
 *
 * ⚠️ Un correctif de code ne répare que l'avenir. La règle « un message arrivé après un rendez-vous
 * calé ne doit plus être jeté » a été posée le 19/08 — mais les messages ingérés AVANT restent
 * orphelins : aucun brouillon, donc un écran « À valider » vide alors que des gens attendent.
 * C'est le piège classique : on annonce que c'est réparé, l'écran reste vide, et on croit que le
 * correctif ne marche pas.
 *
 * Cas concret : TCT Couverture écrit « Plutôt vers 11h » à 10:00 le 19/08. Message ingéré, puis
 * abandonné par l'ancienne règle. Personne ne le voit.
 *
 * ⚠️ ON NE RÉPOND PAS AUTOMATIQUEMENT. On dépose un brouillon en attente de validation : la règle
 * de Timéo est constante, ce qui part chez un prospect qui a déjà répondu passe par lui.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  /**
   * ⚠️ CIBLAGE OBLIGATOIRE POUR ÉCRIRE. Le rattrapage remonte tout le monde, y compris des cas qui
   * ne doivent PAS recevoir de brouillon : les vieux « mail vide » que Timéo veut supprimer, et les
   * changements d'adresse où il faut écrire à la NOUVELLE adresse. Déverser sept brouillons d'un
   * coup lui donnerait un écran « À valider » plein de choses à jeter — l'inverse du service rendu.
   * On liste tout en aperçu, on n'écrit que sur une adresse nommée.
   */
  const cible = (req.nextUrl.searchParams.get('email') ?? '').toLowerCase().trim()
  const { sql } = await import('@/lib/db')

  /**
   * Sont concernés : le DERNIER message reçu d'un contact, s'il n'a reçu aucune réponse ENVOYÉE
   * après lui. Un brouillon rejeté ou annulé ne compte pas — le prospect n'a rien reçu.
   * On exclut le spam, les auto-répondeurs et les désintéressés : eux n'attendent rien.
   */
  const enAttente = (await sql`
    WITH derniers AS (
      SELECT DISTINCT ON (ir.contact_id)
             ir.id, ir.contact_id, ir.created_at, ir.classification, ir.body,
             c.email, c.company
      FROM incoming_replies ir
      JOIN contacts c ON c.id = ir.contact_id
      WHERE ir.classification IS NULL
         OR ir.classification NOT IN ('spam', 'oof', 'desinterest')
      ORDER BY ir.contact_id, ir.created_at DESC
    )
    SELECT d.* FROM derniers d
    WHERE NOT EXISTS (
      SELECT 1 FROM reply_drafts rd
      WHERE rd.incoming_reply_id = d.id AND rd.status IN ('sent', 'pending', 'scheduled')
    )
    AND NOT EXISTS (
      SELECT 1 FROM email_queue q
      WHERE q.contact_id = d.contact_id AND q.status = 'sent'
        AND q.sequence_step >= 20 AND q.sent_at > d.created_at
    )
    AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE LOWER(b.email) = LOWER(d.email))
    ORDER BY d.created_at DESC
  `) as Array<{ id: string; contact_id: string; created_at: string; classification: string | null; body: string | null; email: string; company: string | null }>

  const crees: Array<{ entreprise: string | null; email: string; recu_le: string; message: string }> = []

  for (const m of enAttente) {
    const texte = (m.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    /**
     * Le brouillon reste VOLONTAIREMENT neutre et court. Ces messages ont jusqu'à deux mois : une
     * réponse qui ferait comme si de rien n'était serait pire que le silence. Timéo réécrit ce
     * qu'il veut, l'important est que la personne redevienne visible et traitable.
     */
    const corps = [
      'Bonjour,',
      '',
      'Merci pour votre message.',
      '',
      'Dites-moi ce qui vous arrange, je m adapte.',
      '',
      'Bien à vous,',
    ].join('\n')

    if (apply && cible && m.email.toLowerCase() === cible) {
      await sql`
        INSERT INTO reply_drafts (incoming_reply_id, body, status, created_at)
        VALUES (${m.id}::uuid, ${corps}, 'pending', NOW())
      `
    }
    crees.push({ entreprise: m.company, email: m.email, recu_le: m.created_at, message: texte.slice(0, 120) })
    void corps
  }

  return NextResponse.json({
    mode: apply && cible ? `APPLIQUÉ sur ${cible}` : 'APERÇU (rien écrit) — relancer avec &apply=1&email=<adresse>',
    personnes_sans_reponse: crees.length,
    detail: crees,
    lecture: 'Ces brouillons attendent dans « À valider ». Rien n\'est envoyé automatiquement, et les textes sont neutres : à toi de les réécrire.',
  })
}
