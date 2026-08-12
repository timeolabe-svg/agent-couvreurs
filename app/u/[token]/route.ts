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

/** Appelé automatiquement par Gmail/Outlook (RFC 8058). Aucune page rendue : seul le code compte. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await desinscrire(token)
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 400 })
}

/** Clic humain sur le lien du corps du message : on rend une page lisible, sans jargon. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const r = await desinscrire(token)

  const page = r.ok
    ? `<h1>C'est fait.</h1>
       <p>L'adresse <strong>${r.email}</strong> ne recevra plus aucun message de notre part.</p>
       <p class="d">${r.annules ? `${r.annules} message${r.annules > 1 ? 's' : ''} encore programmé${r.annules > 1 ? 's' : ''} ${r.annules > 1 ? 'ont' : 'a'} été annulé${r.annules > 1 ? 's' : ''}.` : 'Aucun message n\'était en attente.'}</p>
       <p class="d">Vous pouvez fermer cette page. Désolé pour le dérangement.</p>`
    : `<h1>Ce lien n'est pas valide.</h1>
       <p>Il a peut-être été tronqué par votre messagerie.</p>
       <p class="d">Répondez simplement « Stop » au message reçu : nous vous retirerons de la liste.</p>`

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
       @media(prefers-color-scheme:dark){body{background:#111;color:#eee}.d{color:#999}}
     </style></head><body>${page}</body></html>`,
    { status: r.ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
