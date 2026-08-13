import { NextRequest, NextResponse } from 'next/server'
import { lireJetonDesabo } from '@/lib/unsubscribe-token'

export const dynamic = 'force-dynamic'

/**
 * DÉSABONNEMENT EN UN CLIC (RFC 8058).
 *
 * ⚠️ POURQUOI CETTE ROUTE EXISTE. Sans elle, Gmail et Outlook n'affichent pas leur bouton natif
 * « Se désabonner ». Le seul geste à portée d'un prospect agacé devient alors « Signaler comme
 * spam » — ce qui ne l'inscrit sur aucune liste, ne l'empêche pas de recevoir la suite, et abîme
 * durablement la réputation d'expédition des boîtes du client. Le pire des deux mondes.
 *
 * ⚠️ DEUX MÉTHODES, ET C'EST OBLIGATOIRE.
 *  - POST : c'est ce que la RFC 8058 impose, et ce que les messageries appellent AUTOMATIQUEMENT,
 *    sans ouvrir de navigateur, quand l'utilisateur clique leur bouton natif.
 *  - GET  : c'est ce que fait un humain qui clique le lien dans le corps du message.
 * N'implémenter que l'une des deux laisse la moitié des désinscriptions sans effet — en silence.
 * (Piège vécu côté LabegarIA : la route existait, le POST recevait un 401, personne ne le voyait.)
 *
 * ⚠️ SE DÉSABONNER DOIT ARRÊTER LES MAILS, PAS SEULEMENT REMPLIR UNE LISTE.
 * Inscrire en blocklist sans vider la file laisse partir les envois déjà programmés — constaté
 * côté LabegarIA : 4 désabonnements le matin, 18 mails encore programmés derrière, dont deux pour
 * le soir même. On fait donc les deux, et `/api/admin/reconcilier-optout` vérifie l'accord des
 * deux tables indépendamment.
 *
 * Le jeton est signé (HMAC) : sans ça, n'importe qui pourrait inscrire en masse des adresses sur
 * la blocklist du client rien qu'en devinant le format de l'URL.
 */

async function desinscrire(jeton: string): Promise<{ ok: boolean; email?: string; annules?: number }> {
  const email = lireJetonDesabo(jeton)
  if (!email) return { ok: false }

  const { sql } = await import('@/lib/db')

  // 1) La personne est inscrite. `WHERE NOT EXISTS` : un double clic ne crée pas deux lignes.
  await sql`
    INSERT INTO blocklist (email, reason)
    SELECT ${email}, 'unsubscribe'
    WHERE NOT EXISTS (SELECT 1 FROM blocklist WHERE LOWER(email) = LOWER(${email}))
  `

  // 2) Ses mails programmés tombent. Sur TOUTES ses fiches contacts (une personne peut en avoir
  // plusieurs : casse différente, import répété) — c'est le bug du `LIMIT 1` corrigé ce matin.
  const annules = (await sql`
    UPDATE email_queue SET status = 'cancelled'
    WHERE contact_id IN (SELECT id FROM contacts WHERE LOWER(email) = LOWER(${email}))
      AND status IN ('pending', 'queued', 'queued_instantly', 'scheduled', 'sending')
    RETURNING id
  `) as Array<{ id: string }>

  await sql`
    INSERT INTO dashboard_events (type, data)
    VALUES ('reply_received', ${JSON.stringify({ contactEmail: email, action: 'blocklist', reason: 'désabonnement 1-clic' })}::jsonb)
  `.catch(() => { /* trace best-effort : ne doit jamais faire échouer une désinscription */ })

  return { ok: true, email, annules: annules.length }
}

/**
 * Deux appelants, un seul traitement :
 *  - Gmail/Outlook (RFC 8058), qui attendent un simple code de retour ;
 *  - le bouton de confirmation de la page ci-dessous, pour qui il faut une page lisible.
 * On distingue sur l'en-tête `Accept` : un navigateur demande du HTML, une messagerie non.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await desinscrire(token)
  const versNavigateur = (req.headers.get('accept') ?? '').includes('text/html')

  if (!versNavigateur) return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 400 })

  return pageHtml(
    r.ok
      ? `<h1>C'est fait.</h1>
         <p>L'adresse <strong>${String(r.email).replace(/[<>&"]/g, '')}</strong> ne recevra plus aucun message de notre part.</p>
         <p class="d">${r.annules ? `${r.annules} message${r.annules > 1 ? 's' : ''} encore programmé${r.annules > 1 ? 's' : ''} ${r.annules > 1 ? 'ont' : 'a'} été annulé${r.annules > 1 ? 's' : ''}.` : 'Aucun message n\'était en attente.'}</p>
         <p class="d">Vous pouvez fermer cette page. Désolé pour le dérangement.</p>`
      : `<h1>Ce lien n'est pas valide.</h1>
         <p class="d">Répondez simplement « Stop » au message reçu : nous vous retirerons de la liste.</p>`,
    r.ok ? 200 : 400,
  )
}

function pageHtml(corps: string, statut: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <meta name="robots" content="noindex">
     <title>Désabonnement</title>
     <style>
       body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.5rem;color:#1a1a1a;line-height:1.6}
       h1{font-size:1.35rem;margin:0 0 .75rem}
       p{margin:.5rem 0}
       .d{color:#666;font-size:.92rem}
       button{margin-top:1.25rem;padding:.7rem 1.4rem;font-size:1rem;border:0;border-radius:.4rem;background:#1a1a1a;color:#fff;cursor:pointer}
       @media(prefers-color-scheme:dark){body{background:#111;color:#eee}.d{color:#999}button{background:#eee;color:#111}}
     </style></head><body>${corps}</body></html>`,
    { status: statut, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/**
 * ⚠️ CE GET NE DÉSINSCRIT PLUS DIRECTEMENT — et c'est une correction, pas une complication.
 *
 * Première version : un GET sur ce lien désinscrivait immédiatement. Or les passerelles de sécurité
 * des messageries d'entreprise (Proofpoint, Microsoft Safe Links, Barracuda…) VISITENT
 * AUTOMATIQUEMENT tous les liens d'un mail entrant pour les analyser, avant même que le
 * destinataire l'ouvre. Chez un prospect protégé par l'une d'elles, le lien aurait été appelé tout
 * seul : blocklist posée et séquence annulée, sans que personne n'ait cliqué.
 *
 * Le résultat aurait été indétectable — on aurait vu des « désinscriptions » parfaitement normales
 * en base, et perdu en silence les prospects des entreprises les mieux équipées, c'est-à-dire les
 * plus grosses. Exactement la famille de bug qui fait perdre des leads sans laisser de trace.
 *
 * Un GET doit rester sans effet de bord. Le clic humain passe donc par un bouton qui POSTe.
 * Le POST automatique de la RFC 8058, lui, garde son effet immédiat : il n'est émis QUE sur action
 * explicite de l'utilisateur dans son client mail, jamais par un scanner.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const email = lireJetonDesabo(token)

  if (!email) {
    return pageHtml(
      `<h1>Ce lien n'est pas valide.</h1>
       <p>Il a peut-être été tronqué par votre messagerie.</p>
       <p class="d">Répondez simplement « Stop » au message reçu : nous vous retirerons de la liste.</p>`,
      400,
    )
  }

  return pageHtml(
    `<h1>Ne plus recevoir nos messages</h1>
     <p>Confirmez pour retirer <strong>${email.replace(/[<>&"]/g, '')}</strong> de notre liste.
        Plus aucun message ne partira, y compris ceux déjà programmés.</p>
     <form method="POST"><button type="submit">Me désabonner</button></form>
     <p class="d">Vous pouvez aussi répondre « Stop » à notre message.</p>`,
    200,
  )
}
