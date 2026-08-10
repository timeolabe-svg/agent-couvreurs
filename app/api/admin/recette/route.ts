import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * RECETTE DE BOUT EN BOUT — vérifier la chaîne complète sur un vrai prospect (Timéo lui-même).
 *
 * Pourquoi un outil plutôt qu'un test à la main : après deux jours de correctifs, la seule preuve
 * qui vaut est un lead qui traverse RÉELLEMENT toute la chaîne — génération du message, envoi SMTP,
 * réception de la réponse en IMAP, classification, brouillon, validation, réponse envoyée. Chaque
 * étape a eu son bug, et plusieurs étaient invisibles depuis l'interface.
 *
 * ⚠️ LE TEST EMPRUNTE LE PIPELINE NORMAL, PAS UN RACCOURCI. On insère seulement ce qu'un lead
 * scrapé aurait : un contact qui passe les gates (audité, email validé, assez d'avis) et une ligne
 * de file en attente de génération. C'est ensuite `autopilot-tick` qui écrit le mail et
 * `send-campaign` qui l'envoie. Un test qui court-circuite le chemin réel ne prouve rien.
 *
 * GET ?start=1    → crée le contact de test + la ligne de file
 * GET ?etat=1     → où en est la recette, étape par étape
 * GET ?cleanup=1  → efface toute trace (contact, file, réponses, brouillons)
 */

const EMAIL_TEST = 'timeo.labe@gmail.com'
const SOCIETE_TEST = 'RECETTE — ne pas démarcher'

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const p = req.nextUrl.searchParams

  // ── NETTOYAGE : ne laisser AUCUNE trace, sinon le test pollue les compteurs qu'on vient de
  // fiabiliser (un contact de test compté comme prospect, c'est exactement le défaut des 9 RDV).
  if (p.get('cleanup') === '1') {
    const [c] = (await sql`SELECT id FROM contacts WHERE LOWER(email) = ${EMAIL_TEST}`) as Array<{ id: string }>
    if (c?.id) {
      await sql`DELETE FROM reply_drafts WHERE incoming_reply_id IN (SELECT id FROM incoming_replies WHERE contact_id = ${c.id})`.catch(() => {})
      await sql`DELETE FROM incoming_replies WHERE contact_id = ${c.id} OR LOWER(from_email) = ${EMAIL_TEST}`.catch(() => {})
      await sql`DELETE FROM email_queue WHERE contact_id = ${c.id}`
      await sql`DELETE FROM contacts WHERE id = ${c.id}`
    }
    await sql`DELETE FROM blocklist WHERE LOWER(email) = ${EMAIL_TEST}`.catch(() => {})
    return NextResponse.json({ ok: true, nettoye: Boolean(c?.id) })
  }

  // ── DÉMARRAGE
  if (p.get('start') === '1') {
    const [camp] = (await sql`SELECT id, name FROM campaigns WHERE status = 'active' ORDER BY created_at LIMIT 1`) as Array<{ id: string; name: string }>
    if (!camp) return NextResponse.json({ error: 'aucune campagne active' }, { status: 400 })

    // Contact qui passe TOUTES les portes du pipeline réel : audité, email fiable, ≥20 avis.
    // Aucune de ces valeurs n'est un contournement — ce sont exactement les conditions qu'un vrai
    // lead doit remplir pour qu'un mail parte.
    // ⚠️ Le schéma Hdigiweb n'est PAS celui de labegaria : `contacts` n'a ni `campaign_id` ni
    // `status` (le rattachement à la campagne se fait au niveau de `email_queue`). Écrire l'insert
    // de mémoire donnait un « column does not exist » — et, sans enveloppe d'erreur, un 500 muet.
    const [contact] = (await sql`
      INSERT INTO contacts (company, email, website, city, sector,
        email_confidence_score, email_validated, audit_done, google_reviews_count, google_rating)
      VALUES (${SOCIETE_TEST}, ${EMAIL_TEST}, 'https://hdigiweb.com', 'Toulouse', 'couvreur',
        99, true, true, 25, 4.6)
      ON CONFLICT (email) DO UPDATE SET
        email_validated = true, audit_done = true, google_reviews_count = 25
      RETURNING id
    `) as Array<{ id: string }>

    // Placeholder : c'est autopilot-tick qui écrira le vrai message (chemin normal).
    await sql`
      INSERT INTO email_queue (contact_id, campaign_id, sequence_step, from_email, subject, body, status, scheduled_at)
      SELECT ${contact.id}, ${camp.id}, 0, 'pending@hdigiweb.fr', '__pending_generation__', '__pending_generation__', 'pending', NOW()
      WHERE NOT EXISTS (SELECT 1 FROM email_queue WHERE contact_id = ${contact.id} AND sequence_step = 0)
    `

    return NextResponse.json({
      ok: true,
      contact_id: contact.id,
      campagne: camp.name,
      suite: [
        '1. GET /api/cron/autopilot-tick  → écrit le vrai message (génération IA + garde-fous)',
        '2. GET /api/cron/send-campaign   → l’envoie réellement en SMTP',
        '3. Timéo répond depuis sa boîte',
        '4. GET /api/cron/poll-imap-replies → lit, classe, produit un brouillon',
        '5. GET ?etat=1 pour voir où on en est',
      ],
    })
  }

  // ── ÉTAT : chaque étape, avec ce qui s'est réellement passé.
  const [contact] = (await sql`
    SELECT id, company, email FROM contacts WHERE LOWER(email) = ${EMAIL_TEST}
  `) as Array<{ id: string; company: string; email: string }>
  if (!contact) return NextResponse.json({ ok: true, etat: 'aucune recette en cours (lancer ?start=1)' })

  const file = (await sql`
    SELECT sequence_step, status, subject, LEFT(body, 2000) AS extrait, sent_at, from_email
    FROM email_queue WHERE contact_id = ${contact.id} ORDER BY sequence_step
  `) as Array<Record<string, unknown>>

  const reponses = (await sql`
    SELECT id, classification, action_taken, LEFT(body, 300) AS extrait, created_at
    FROM incoming_replies WHERE contact_id = ${contact.id} OR LOWER(from_email) = ${EMAIL_TEST}
    ORDER BY created_at DESC
  `) as Array<Record<string, unknown>>

  const brouillons = (await sql`
    SELECT rd.id, rd.status, LEFT(rd.body, 500) AS extrait, rd.created_at, rd.sent_at
    FROM reply_drafts rd
    WHERE rd.incoming_reply_id IN (SELECT id FROM incoming_replies WHERE contact_id = ${contact.id} OR LOWER(from_email) = ${EMAIL_TEST})
    ORDER BY rd.created_at DESC
  `) as Array<Record<string, unknown>>

  const envoye = file.find(f => f.status === 'sent')
  const etapes = [
    { etape: '1. contact créé', fait: true, detail: String(contact.company) },
    { etape: '2. message écrit par l’agent', fait: file.some(f => f.subject !== '__pending_generation__'), detail: String(file[0]?.subject ?? '—') },
    { etape: '3. mail ENVOYÉ', fait: Boolean(envoye), detail: envoye ? `le ${String(envoye.sent_at).slice(0, 16)} depuis ${envoye.from_email}` : 'pas encore' },
    { etape: '4. réponse de Timéo reçue', fait: reponses.length > 0, detail: reponses.length ? `${reponses.length} reçue(s)` : 'en attente de ta réponse' },
    { etape: '5. réponse classée', fait: reponses.some(r => r.classification), detail: String(reponses[0]?.classification ?? '—') },
    { etape: '6. brouillon produit', fait: brouillons.length > 0, detail: String(brouillons[0]?.status ?? '—') },
    { etape: '7. réponse envoyée au prospect', fait: brouillons.some(b => b.status === 'sent'), detail: brouillons.some(b => b.status === 'sent') ? 'oui' : 'attend ta validation' },
  ]

  return NextResponse.json({ ok: true, contact, etapes, file, reponses, brouillons })
}

/** Enveloppe d erreur : un outil de recette qui rend un 500 muet ne sert a rien. */
export const GET = wrapCron('admin-recette', handler)
