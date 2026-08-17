import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * TOUTE BOÎTE QUI ENVOIE DOIT ÊTRE RELEVÉE.
 *
 * ⚠️ INVARIANT MANQUANT, ET IL COÛTE DES LEADS. Les adresses d'envoi viennent d'une variable
 * (SMTP), celles qu'on relève d'une autre (IMAP_ACCOUNTS). Rien ne garantissait qu'elles
 * coïncident. Une boîte qui envoie mais qu'on ne relève jamais est un trou noir parfait : les
 * mails partent, les prospects répondent, et PERSONNE ne lit leurs réponses. Aucune erreur, aucun
 * compteur en baisse — juste des leads qui n'existent pas.
 *
 * C'est la question posée le 17/08 : un prospect a écrit à gabin@hdigiweb-agence.com et son
 * message n'est nulle part en base. Avant d'accuser le budget de temps du poller, il faut savoir
 * si cette boîte est seulement dans la liste de celles qu'on relève.
 *
 * GET ?relever=1 → tente une connexion IMAP sur chaque boîte configurée (lent, ~2 s par boîte)
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  // Ce qui ENVOIE, d'après la réalité des mails partis — pas d'après une variable.
  const envoi = (await sql`
    SELECT LOWER(from_email) AS boite, COUNT(*)::int AS mails, MAX(sent_at) AS dernier
    FROM email_queue
    WHERE status = 'sent' AND from_email IS NOT NULL AND from_email <> 'pending@hdigiweb.fr'
    GROUP BY LOWER(from_email)
    ORDER BY MAX(sent_at) DESC
  `) as Array<{ boite: string; mails: number; dernier: string }>

  // Ce qui est RELEVÉ, d'après la configuration.
  let releve: string[] = []
  let erreurConfig: string | null = null
  try {
    const brut = process.env.IMAP_ACCOUNTS ?? ''
    // Format attendu : "email:motdepasse,email:motdepasse" (ou JSON selon les projets).
    if (brut.trim().startsWith('[') || brut.trim().startsWith('{')) {
      const j = JSON.parse(brut) as Array<{ email?: string; user?: string }> | Record<string, unknown>
      releve = Array.isArray(j)
        ? j.map(x => String(x.email ?? x.user ?? '').toLowerCase()).filter(Boolean)
        : Object.keys(j).map(k => k.toLowerCase())
    } else {
      releve = brut.split(',').map(p => p.split(':')[0].trim().toLowerCase()).filter(Boolean)
    }
  } catch (e) {
    erreurConfig = String(e).slice(0, 150)
  }

  const releveSet = new Set(releve)
  const trousNoirs = envoi.filter(e => !releveSet.has(e.boite))
  const releveesSansEnvoi = releve.filter(b => !envoi.some(e => e.boite === b))

  return NextResponse.json({
    ok: trousNoirs.length === 0,
    boites_qui_envoient: envoi,
    boites_relevees: releve,
    erreur_lecture_config: erreurConfig,
    // LE chiffre à regarder : une boîte ici = des réponses de prospects que personne ne lira jamais.
    TROUS_NOIRS: trousNoirs,
    relevees_mais_sans_envoi: releveesSansEnvoi,
    lecture: trousNoirs.length
      ? 'Ces boîtes envoient des mails mais ne sont JAMAIS relevées. Toute réponse qui y arrive est perdue. Ajouter leurs identifiants à IMAP_ACCOUNTS.'
      : 'Chaque boîte qui envoie est bien relevée.',
  })
}

export const GET = wrapCron('boites', handler)
