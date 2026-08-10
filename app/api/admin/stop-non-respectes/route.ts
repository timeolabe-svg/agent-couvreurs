import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'
import { isExplicitOptOut, isRgpdRequestOrComplaint } from '@/lib/rgpd'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 🚨 STOP NON RESPECTÉS — le filet de rattrapage le plus important du système.
 *
 * INCIDENT CONSTATÉ LE 10/08/2026, en production. Le 4 août à 10h15, un prospect a écrit :
 *   « je vous remercie de SUPPRIMER … de toutes vos listes de diffusion et bases de données,
 *     conformément au RGPD »
 * puis, dans un second message, simplement « Stop ».
 * L'agent lui a quand même envoyé des relances le 6 août ET le 9 août, et trois autres étaient
 * encore programmées. C'est exactement l'enchaînement qui a produit la plainte CNIL du 03/08 —
 * rejoué, alors qu'on avait corrigé la détection.
 *
 * La détection n'était pas en cause : c'est la LECTURE des boîtes qui l'était (le cron ne lisait
 * qu'une boîte sur quatre). Un « Stop » jamais lu ne déclenche évidemment aucun blocage. D'où ce
 * balayage, qui ne fait confiance à AUCUN statut intermédiaire : il relit le TEXTE de toutes les
 * réponses reçues et vérifie, pour chacune, que le contact est bien bloqué et sa file vide.
 *
 * C'est un filet permanent, pas un correctif ponctuel : il tourne chaque jour. Tant qu'il existe un
 * chemin par lequel un « Stop » peut être manqué, il faut quelqu'un qui repasse derrière.
 *
 * GET            → liste les violations (ne modifie rien)
 * GET ?apply=1   → blockliste + annule les files
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const apply = req.nextUrl.searchParams.get('apply') === '1'

  // ── RECHERCHE LIBRE dans le texte des réponses : indispensable quand un « Stop » est visible
  // à l'écran mais introuvable par les requêtes habituelles (rattachement par adresse défaillant).
  const chercher = req.nextUrl.searchParams.get('chercher')
  if (chercher) {
    const motif = `%${chercher}%`
    const trouve = (await sql`
      SELECT id, from_email, classification, action_taken, created_at, LEFT(body, 400) AS extrait
      FROM incoming_replies
      WHERE body ILIKE ${motif} OR from_email ILIKE ${motif}
      ORDER BY created_at DESC LIMIT 30
    `) as unknown as Array<Record<string, unknown>>
    return NextResponse.json({ ok: true, recherche: chercher, trouve })
  }

  // ── COUPURE IMMÉDIATE d'une adresse précise, sans attendre l'analyse : quand on SAIT qu'une
  // personne a demandé l'arrêt, on ne débat pas, on coupe. Le diagnostic peut attendre, pas elle.
  const couper = req.nextUrl.searchParams.get('couper')
  if (couper) {
    const email = couper.toLowerCase().trim()
    const [c] = (await sql`SELECT id FROM contacts WHERE LOWER(email) = ${email} LIMIT 1`) as unknown as Array<{ id: string }>
    if (!c?.id) return NextResponse.json({ ok: false, error: 'contact introuvable' }, { status: 404 })
    const annules = (await sql`
      UPDATE email_queue SET status = 'cancelled'
      WHERE contact_id = ${c.id} AND status IN ('queued', 'pending') RETURNING id
    `) as unknown as Array<{ id: string }>
    await sql`
      INSERT INTO blocklist (email, reason, source, notes)
      VALUES (${email}, 'unsubscribe', 'manuel', 'Coupure manuelle : demande d arret constatee')
      ON CONFLICT (email) DO NOTHING
    `.catch(() => {})
    return NextResponse.json({ ok: true, email, mails_annules: annules.length })
  }

  // Toutes les réponses reçues, avec leur texte. On ne filtre PAS sur la classification : c'est
  // précisément ce qui a échoué (une réponse jamais lue n'a pas de classification).
  const reponses = (await sql`
    SELECT ir.id, LOWER(ir.from_email) AS from_email, ir.body, ir.created_at
    FROM incoming_replies ir
    WHERE ir.from_email IS NOT NULL AND ir.body IS NOT NULL
      AND ir.created_at > NOW() - INTERVAL '180 days'
    ORDER BY ir.created_at ASC
  `) as Array<{ id: string; from_email: string; body: string; created_at: string }>

  // Première demande d'arrêt par adresse (la date compte : tout envoi POSTÉRIEUR est une faute).
  const demandes = new Map<string, { date: string; motif: string; extrait: string }>()
  for (const r of reponses) {
    if (demandes.has(r.from_email)) continue
    const rgpd = isRgpdRequestOrComplaint(r.body)
    const stop = isExplicitOptOut(r.body)
    if (!rgpd.match && !stop) continue
    demandes.set(r.from_email, {
      date: r.created_at,
      motif: rgpd.match ? `rgpd:${rgpd.motif}` : 'stop',
      extrait: r.body.replace(/\s+/g, ' ').slice(0, 160),
    })
  }

  const violations: Array<Record<string, unknown>> = []
  for (const [email, d] of demandes) {
    const [c] = (await sql`SELECT id FROM contacts WHERE LOWER(email) = ${email} LIMIT 1`) as Array<{ id: string }>
    const [bl] = (await sql`SELECT 1 AS x FROM blocklist WHERE LOWER(email) = ${email} LIMIT 1`) as Array<{ x: number }>
    if (!c?.id) continue

    const [{ envoyes_apres }] = (await sql`
      SELECT COUNT(*)::int AS envoyes_apres FROM email_queue
      WHERE contact_id = ${c.id} AND status = 'sent' AND sent_at > ${d.date}::timestamptz
    `) as Array<{ envoyes_apres: number }>
    const [{ encore_en_file }] = (await sql`
      SELECT COUNT(*)::int AS encore_en_file FROM email_queue
      WHERE contact_id = ${c.id} AND status IN ('queued', 'pending')
    `) as Array<{ encore_en_file: number }>

    if (!bl || envoyes_apres > 0 || encore_en_file > 0) {
      violations.push({
        email, motif: d.motif, demande_le: d.date, extrait: d.extrait,
        blockliste: Boolean(bl), mails_envoyes_APRES: envoyes_apres, encore_programmes: encore_en_file,
      })
      if (apply) {
        await sql`
          INSERT INTO blocklist (email, reason, source, notes)
          VALUES (${email}, ${d.motif.startsWith('rgpd') ? 'rgpd' : 'unsubscribe'}, 'auto',
                  ${`Rattrapage 10/08 : demande d'arrêt du ${String(d.date).slice(0, 10)} non appliquée`})
          ON CONFLICT (email) DO NOTHING
        `.catch(() => {})
        await sql`
          UPDATE email_queue SET status = 'cancelled'
          WHERE contact_id = ${c.id} AND status IN ('queued', 'pending')
        `
      }
    }
  }

  return NextResponse.json({
    ok: true,
    mode: apply ? 'appliqué' : 'constat',
    demandes_arret_trouvees: demandes.size,
    violations: violations.length,
    total_mails_encore_programmes: violations.reduce((s, v) => s + Number(v.encore_programmes ?? 0), 0),
    detail: violations,
  })
}

export const GET = wrapCron('stop-non-respectes', handler)
