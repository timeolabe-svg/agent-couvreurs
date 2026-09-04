import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * LISTE COMPLÈTE DES LEADS LINKEDIN — source de vérité unique pour le bot.
 *
 * Mirroir volontaire du pattern LabegarIA (charger TOUS les leads une fois par cycle, filtrer
 * localement par statut pour chaque phase) plutôt que d'inventer N endpoints étroits par phase :
 * c'est un pattern déjà éprouvé en production chez LabegarIA, pas une simplification de ma part.
 *
 * GET /api/linkedin/leads?key=<LINKEDIN_BOT_SECRET>&limit=5000
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const limit = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 5000)))
    const { sql } = await import('@/lib/db')
    /**
     * 🚨 `full_name` ET `email` SONT DES CHAMPS DU CONTRAT, PAS DU CONFORT (04/09/2026).
     *
     * Ils manquaient, et rien ne le signalait — ni une erreur, ni un test : le bot lisait
     * `lead.full_name` à 56 endroits sur un objet qui n'en avait pas, donc `undefined` partout.
     * Conséquences mesurées en relisant les chemins concernés, toutes SILENCIEUSES :
     *  · `runCheckReplies` filtre la boîte de réception avec `namesMatch(c.name, l.full_name)` →
     *    toujours faux → shortlist vide → AUCUNE réponse de prospect n'aurait jamais été détectée
     *    ni remontée dans la messagerie de l'app (garantie « zéro lead perdu » à zéro) ;
     *  · la garde anti-mauvais-destinataire de `saisirEtEnvoyer` compare le nom lu à l'écran avec
     *    `lead.full_name` → jamais d'égalité → « ENVOI ANNULÉ » sur tous les DM qui ne passent pas
     *    par le href compose ;
     *  · `openConversationInInbox(full_name)` ne trouve jamais rien → chaque relance retombe sur
     *    l'ouverture du PROFIL, c'est-à-dire sur la dépense qui a fait restreindre LabegarIA.
     *
     * `email` sert la blocklist : `estBloque(lead)` teste l'URL ET l'email, et sans email la garde
     * ne pouvait pas voir qu'une personne s'était opposée PAR MAIL — le stop doit suivre la
     * PERSONNE, pas le canal. Sans conséquence sur la population actuelle (leads sans email), mais
     * la garde doit être vraie avant qu'on lui confie la population qui en a un.
     */
    const rows = await sql`
      SELECT ll.id, ll.first_name, ll.last_name, ll.company, ll.profile_url, ll.status,
             ll.invited_at, ll.connected_at, ll.last_message_at, ll.created_at, ll.contact_id,
             NULLIF(TRIM(CONCAT_WS(' ', ll.first_name, ll.last_name)), '') AS full_name,
             c.email, c.city, c.sector
      FROM linkedin_leads ll
      LEFT JOIN contacts c ON c.id = ll.contact_id
      ORDER BY ll.created_at ASC
      LIMIT ${limit}
    `
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[linkedin/leads] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
