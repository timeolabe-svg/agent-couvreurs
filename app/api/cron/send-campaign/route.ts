/**
 * GET /api/cron/send-campaign
 *
 * MOTEUR D'ENVOI MAISON — remplace Instantly pour l'ENVOI (Instantly = warmup only).
 * Lit la file email_queue (mails dus), envoie via les boîtes Google chauffées
 * (SMTP smtp.gmail.com), plafond DAILY_CAP_PER_BOX/boîte/jour. Aucune limite de leads.
 *
 * PROTECTIONS ANTI-BOUCLE (leçon du bug "130 mails à un contact") :
 *  - kill-switch SEND_PAUSED=1 (coupe tout envoi instantanément)
 *  - claim ATOMIQUE : une ligne passe en 'sending' avant l'envoi → jamais re-sélectionnée
 *  - reaper : requeue les 'sending' coincés > 15 min (crash/timeout)
 *  - échec d'envoi → 'failed' (JAMAIS de retour en file = zéro renvoi en boucle)
 *  - anti-doublon : ne renvoie JAMAIS un (contact, étape) déjà 'sent'
 *  - plafond À VIE : max 4 mails 'sent' par contact (séquence complète), point.
 *
 * À brancher sur cron-job.org toutes les 5-10 min. Chaque run envoie jusqu'à MAX_PER_RUN mails.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { getGmailBoxes, sendFromBox, type GmailBox } from '@/lib/gmail-sender'
import { getInboxSenderName } from '@/lib/instantly/inbox-rotation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cible client : boîtes déjà chauffées → 35/boîte/jour (× 4 boîtes = 140/jour).
const DAILY_CAP_PER_BOX = 35
const MAX_PER_RUN = 8 // ~8 × 2s = 16s : tient sous les 30s de cron-job.org (offre gratuite). 8/run × 4 runs/h = large vs plafond 140/j
const LIFETIME_CAP_PER_CONTACT = 4 // séquence = 4 étapes max, JAMAIS plus
// Les relances de CONVERSATION (step >= 20) vont à des gens qui ont RÉPONDU (ils les attendent,
// n'affectent pas la réputation) → elles ont leur PROPRE plafond et passent même quand le plafond
// cold (warmup) est atteint. Sinon un lead chaud silencieux attendait le lendemain pour être relancé.
const CONVO_DAILY_CAP = 30

interface ClaimedRow {
  id: string
  subject: string
  body: string
  sequence_step: number
  campaign_id: string
  contact_id: string
  from_email: string
}

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // KILL-SWITCH d'urgence : coupe tout envoi si SEND_PAUSED=1 (env Vercel).
  if (process.env.SEND_PAUSED === '1') {
    return NextResponse.json({ ok: true, paused: true, message: 'Envoi en pause (SEND_PAUSED=1)' })
  }
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  // Si MillionVerifier est configuré → on n'envoie QU'aux emails VALIDÉS (email_validated=true),
  // ce qui élimine les bounces. Sans MV → on garde l'ancien comportement (confiance >= 90).
  const requireValidated = Boolean(process.env.MILLION_VERIFIER_API_KEY)

  const { sql } = await import('@/lib/db')

  try {
    const boxes = getGmailBoxes()
    if (boxes.length === 0) {
      return NextResponse.json({ error: 'aucune boîte Gmail configurée (IMAP_ACCOUNTS)' }, { status: 500 })
    }

    // Colonnes de traçage (idempotent).
    await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS sent_via TEXT`

    // Capacité restante par boîte aujourd'hui.
    const sentToday = (await sql`
      SELECT sent_via, COUNT(*)::int AS n
      FROM email_queue
      WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sent_via IS NOT NULL
      GROUP BY sent_via
    `) as Array<{ sent_via: string; n: number }>
    const usedByBox = new Map(sentToday.map(r => [r.sent_via, r.n]))
    const capacity = new Map(boxes.map(b => [b.email, DAILY_CAP_PER_BOX - (usedByBox.get(b.email) ?? 0)]))
    const totalCapacity = [...capacity.values()].reduce((s, c) => s + Math.max(0, c), 0)

    const results: string[] = []
    results.push(`Boîtes: ${boxes.length} | capacité restante aujourd'hui: ${totalCapacity}`)

    // Plafond SÉPARÉ pour les relances de conversation (step >= 20) : elles passent même si le cold
    // est saturé (destinataire = a répondu, faible risque). On compte celles déjà parties aujourd'hui.
    const [{ convoSent }] = (await sql`SELECT COUNT(*)::int AS "convoSent" FROM email_queue WHERE status = 'sent' AND sent_at::date = CURRENT_DATE AND sequence_step >= 20`) as Array<{ convoSent: number }>
    const convoCapacity = Math.max(0, CONVO_DAILY_CAP - (convoSent ?? 0))
    let convoOnly = false
    if (totalCapacity <= 0) {
      if (convoCapacity <= 0) {
        return NextResponse.json({ ok: true, sent: 0, results: [...results, 'Plafond quotidien atteint (cold ET relances de conversation)'] })
      }
      // Cold saturé mais on autorise ENCORE les relances de conversation. On injecte leur capacité
      // dans les boîtes pour que la sélection de boîte fonctionne (la requête ne réclamera QUE des step>=20).
      convoOnly = true
      const per = Math.max(1, Math.ceil(convoCapacity / boxes.length))
      for (const b of boxes) capacity.set(b.email, per)
      results.push(`Plafond cold atteint → relances de conversation uniquement (${convoCapacity} dispo aujourd'hui)`)
    }

    // REAPER : une ligne coincée en 'sending' > 15 min = le run qui l'a réclamée a crashé.
    // On ne peut PAS savoir si le SMTP est parti avant le crash → on la marque 'failed' (JAMAIS
    // 'queued'), pour ne JAMAIS risquer de renvoyer un mail déjà parti. Un mail rare perdu est
    // acceptable ; un doublon (réputation/juridique) ne l'est pas. Cas très rare (runs < 30s).
    const reaped = (await sql`
      UPDATE email_queue SET status = 'failed'
      WHERE status = 'sending' AND sent_at < NOW() - INTERVAL '15 minutes'
      RETURNING id
    `) as Array<{ id: string }>
    if (reaped.length > 0) results.push(`⚠ ${reaped.length} ligne(s) 'sending' coincée(s) → 'failed' (anti-renvoi)`)

    // CLAIM ATOMIQUE : sort les lignes 'queued' → 'sending' en UNE requête (UPDATE ... WHERE id IN (SELECT)).
    // Une ligne passée en 'sending' ne peut PLUS être re-sélectionnée par un run concurrent
    // ni par une réexécution après timeout → zéro renvoi en boucle.
    const limit = Math.min(MAX_PER_RUN, convoOnly ? convoCapacity : totalCapacity)
    const claimed = (await sql`
      UPDATE email_queue SET status = 'sending', sent_at = NOW()
      WHERE id IN (
        SELECT eq.id
        FROM email_queue eq
        JOIN contacts c ON c.id = eq.contact_id
        WHERE eq.status = 'queued'
          AND eq.scheduled_at <= NOW()
          AND c.email IS NOT NULL
          -- Mode "relances de conversation uniquement" (plafond cold saturé) : on ne réclame QUE les step>=20.
          AND (${!convoOnly} OR eq.sequence_step >= 20)
          -- ANTI-RÉPÉTITION : jamais de relance FROIDE (steps 0-3) à un contact qui a déjà
          -- répondu. EXCEPTION : les relances de CONVERSATION (steps >= 20) visent justement
          -- des gens qui ont répondu puis se sont tus → elles doivent passer.
          AND (
            eq.sequence_step >= 20
            OR NOT EXISTS (
              SELECT 1 FROM incoming_replies ir
              WHERE LOWER(ir.from_email) = LOWER(c.email)
                AND (ir.classification IS NULL OR ir.classification NOT IN ('oof', 'spam'))
            )
          )
          -- ANTI-BOUNCE : si MillionVerifier est actif, on n'envoie QU'aux emails validés.
          -- EXCEPTION : les relances de CONVERSATION (step >= 20) visent des gens qui ont DÉJÀ
          -- RÉPONDU → leur email est prouvé livrable. Les bloquer sur le gate MV faisait qu'un lead
          -- chaud silencieux n'était jamais relancé (relance restait 'queued' à vie). On les exempte.
          AND (eq.sequence_step >= 20 OR c.email_validated IS TRUE OR ${!requireValidated})
          -- OPT-OUT / BOUNCE : jamais à une adresse ou un domaine blocklisté.
          AND NOT EXISTS (
            SELECT 1 FROM blocklist b
            WHERE (b.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
               OR (b.domain IS NOT NULL AND LOWER(c.email) LIKE '%@' || LOWER(b.domain))
          )
          -- ANTI-DOUBLON : ne JAMAIS renvoyer un (contact, étape) déjà envoyé.
          AND NOT EXISTS (
            SELECT 1 FROM email_queue s
            WHERE s.contact_id = eq.contact_id AND s.sequence_step = eq.sequence_step AND s.status = 'sent'
          )
          -- ANTI-DOUBLON INTRA-RUN : si DEUX lignes 'queued' existent pour le même (contact, étape)
          -- (double enqueue / backfill / requeue), aucune n'est encore 'sent' → sans ce garde les
          -- deux seraient réclamées dans le même lot et envoyées. On ne garde que la plus ancienne
          -- (id min) ; sa jumelle est ignorée (elle finira annulée/écrasée en aval).
          AND NOT EXISTS (
            SELECT 1 FROM email_queue s3
            WHERE s3.contact_id = eq.contact_id AND s3.sequence_step = eq.sequence_step
              AND s3.status = 'queued' AND s3.id < eq.id
          )
          -- PLAFOND À VIE : jamais plus de 4 mails envoyés à un même contact.
          AND (
            SELECT COUNT(*) FROM email_queue s2
            WHERE s2.contact_id = eq.contact_id AND s2.status = 'sent'
          ) < ${LIFETIME_CAP_PER_CONTACT}
        ORDER BY eq.scheduled_at ASC
        LIMIT ${limit}
        -- VERROU DE FILE (anti-double-envoi entre runs concurrents) : chaque ligne 'queued' est
        -- verrouillée le temps du claim ; un run parallèle SKIP LOCKED la saute au lieu de la
        -- réclamer aussi. Sans ça, deux runs (cron qui se chevauche / rejeu après timeout) peuvent
        -- sélectionner le MÊME lot puis l'envoyer chacun → double envoi (l'incident des 130 mails).
        FOR UPDATE OF eq SKIP LOCKED
      )
      RETURNING id, subject, body, sequence_step, campaign_id, contact_id, from_email
    `) as ClaimedRow[]

    // Infos contact des lignes réclamées.
    const contactIds = [...new Set(claimed.map(r => r.contact_id))]
    const contactRows = contactIds.length > 0
      ? ((await sql`SELECT id, email, name, company, city FROM contacts WHERE id = ANY(${contactIds})`) as Array<{ id: string; email: string; name: string | null; company: string | null; city: string | null }>)
      : []
    const contactMap = new Map(contactRows.map(c => [c.id, c]))

    results.push(`Mails réclamés à envoyer: ${claimed.length}`)

    let sent = 0, skipped = 0, failed = 0

    // Sélection de boîte : PRÉFÈRE la boîte assignée (from_email) — signature = enveloppe.
    const pickBox = (preferred: string): GmailBox | null => {
      const pref = boxes.find(b => b.email.toLowerCase() === preferred.toLowerCase() && (capacity.get(b.email) ?? 0) > 0)
      if (pref) return pref
      return boxes.find(b => (capacity.get(b.email) ?? 0) > 0) ?? null
    }

    for (const row of claimed) {
      const contact = contactMap.get(row.contact_id)
      if (!contact?.email) {
        await sql`UPDATE email_queue SET status = 'failed' WHERE id = ${row.id}`
        skipped++; continue
      }
      if (!row.subject || !row.body) {
        await sql`UPDATE email_queue SET status = 'skipped' WHERE id = ${row.id}`
        skipped++; continue
      }

      let box = pickBox(row.from_email)
      if (!box) {
        // Plus de capacité : on remet la ligne en file (elle n'a PAS été envoyée).
        await sql`UPDATE email_queue SET status = 'queued' WHERE id = ${row.id}`
        results.push('Plus de capacité en cours de run — ligne remise en file')
        break
      }

      // 1) Corrige une salutation "Bonjour ENTREPRISE," / "Bonjour VISION," → "Bonjour,".
      let finalBody = row.body
      const g = finalBody.match(/^\s*Bonjour\s+([^,\n]+),/i)
      if (g) {
        const nm = g[1].trim()
        const comp = (contact.company ?? '').toLowerCase()
        const isCompany = comp && (comp.includes(nm.toLowerCase()) || nm.toLowerCase().includes(comp.slice(0, 6)))
        const isAllCaps = nm.length > 1 && nm === nm.toUpperCase()
        if (isCompany || isAllCaps) finalBody = finalBody.replace(/^\s*Bonjour\s+[^,\n]+,/i, 'Bonjour,')
      }

      // 2) Opt-out garanti sur CHAQUE mail (RGPD + délivrabilité).
      if (!/stop|désabonn|désinscri|ne plus recevoir|unsubscribe/i.test(finalBody)) {
        finalBody = `${finalBody}\n\n---\nPour ne plus recevoir mes emails, répondez simplement "Stop".`
      }

      const senderName = getInboxSenderName(box.email)
      let r = await sendFromBox(box, { to: contact.email, subject: row.subject, text: finalBody, senderName })

      // Boîte HS (535 BadCredentials) → désactivée ce run, retry ailleurs.
      if (!r.ok && /BadCredentials|Invalid login|535/.test(r.error ?? '')) {
        results.push(`⚠ boîte HS: ${box.email} (mdp d'application invalide) — désactivée ce run`)
        capacity.set(box.email, 0)
        const alt = boxes.find(b => (capacity.get(b.email) ?? 0) > 0)
        if (alt) {
          box = alt
          r = await sendFromBox(alt, { to: contact.email, subject: row.subject, text: finalBody, senderName: getInboxSenderName(alt.email) })
        }
      }

      if (r.ok) {
        await sql`UPDATE email_queue SET status = 'sent', sent_at = NOW(), sent_via = ${box.email}, body = ${finalBody} WHERE id = ${row.id}`
        capacity.set(box.email, (capacity.get(box.email) ?? 1) - 1)
        sent++
        results.push(`✓ step ${row.sequence_step} → ${contact.email} via ${box.email}`)
        try {
          await sql`
            INSERT INTO dashboard_events (type, data)
            VALUES ('email_sent', ${JSON.stringify({
              contactEmail: contact.email, company: contact.company, city: contact.city,
              campaignId: row.campaign_id, sequenceStep: row.sequence_step, subject: row.subject, sentVia: box.email,
            })}::jsonb)
          `
        } catch { /* non-bloquant */ }
      } else {
        // Échec → 'failed' (JAMAIS de retour en 'queued' → aucun renvoi en boucle).
        await sql`UPDATE email_queue SET status = 'failed' WHERE id = ${row.id}`
        failed++
        results.push(`✗ ${contact.email} via ${box.email}: ${(r.error ?? '').slice(0, 90)}`)
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, results })
  } catch (err) {
    return NextResponse.json(
      { error: String(err), stack: err instanceof Error ? err.stack?.slice(0, 400) : undefined },
      { status: 500 },
    )
  }
}
