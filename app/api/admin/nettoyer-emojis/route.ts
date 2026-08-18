import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { stripEmojis } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RETIRE LES EMOJIS DÉJÀ STOCKÉS — noms d'entreprise ET mails pas encore partis.
 *
 * Le correctif à la source empêche les prochains. Celui-ci répare l'existant : les fiches déjà en
 * base gardent leur « 🥇 » et, surtout, les mails DÉJÀ RÉDIGÉS en file d'attente portent l'emoji
 * dans leur objet et leur corps. Ne corriger que la source laisserait partir des semaines de mails
 * fautifs — l'entrepôt est plein avant que la chaîne ne soit réparée.
 *
 * ⚠️ On ne touche QUE les lignes 'pending'/'queued'. Un mail déjà envoyé ne se réécrit pas : le
 * prospect a reçu ce qu'il a reçu, et modifier l'archive ferait mentir l'historique.
 *
 * Le nettoyage passe par la MÊME fonction que l'insertion (stripEmojis), pas par une regex SQL
 * recopiée : deux implémentations, ce serait deux comportements et une base à moitié propre.
 *
 * ?apply=1 pour écrire (sans ce paramètre : aperçu, rien n'est modifié).
 */

/**
 * ⚠️ PAS DE FILTRE REGEX EN SQL.
 *
 * Premier jet : un WHERE avec une classe de caractères écrite en syntaxe JavaScript. Résultat,
 * HTTP 500 — cette syntaxe d'échappement est du JavaScript, Postgres ne la connaît pas (son moteur
 * attend 4 ou 8 chiffres hexadécimaux, et les emojis vivent hors du plan de base).
 *
 * Plutôt que de traduire la même règle dans un second dialecte — deux écritures, deux comportements,
 * une base à moitié nettoyée — on rapatrie les lignes et on filtre avec la MÊME fonction que celle
 * qui nettoie à l'insertion. Les volumes le permettent largement (quelques milliers de lignes).
 */

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  const contacts = (await sql`
    SELECT id, company, name FROM contacts
  `) as Array<{ id: string; company: string | null; name: string | null }>

  const mails = (await sql`
    SELECT id, subject, body FROM email_queue
    WHERE status IN ('pending', 'queued')
  `) as Array<{ id: string; subject: string | null; body: string | null }>

  const exemples: string[] = []
  let contactsCorriges = 0
  let mailsCorriges = 0

  for (const c of contacts) {
    const company = c.company ? stripEmojis(c.company) : c.company
    const name = c.name ? stripEmojis(c.name) : c.name
    if (company === c.company && name === c.name) continue
    if (exemples.length < 15 && c.company && company !== c.company) exemples.push(`${c.company}  →  ${company}`)
    contactsCorriges++
    if (apply) {
      await sql`UPDATE contacts SET company = ${company}, name = ${name} WHERE id = ${c.id}`
    }
  }

  for (const m of mails) {
    const subject = m.subject ? stripEmojis(m.subject) : m.subject
    const body = m.body ? stripEmojis(m.body) : m.body
    if (subject === m.subject && body === m.body) continue
    mailsCorriges++
    if (apply) {
      await sql`UPDATE email_queue SET subject = ${subject}, body = ${body} WHERE id = ${m.id}`
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    contacts_examines: contacts.length,
    contacts_corriges: contactsCorriges,
    mails_en_file_examines: mails.length,
    mails_en_file_corriges: mailsCorriges,
    exemples,
    lecture: 'Les mails déjà envoyés ne sont pas touchés : on ne réécrit pas ce que le prospect a déjà lu.',
  })
}
