import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * RÉÉCRIT LES MAILS DÉJÀ EN FILE AVEC LA SÉQUENCE VALIDÉE.
 *
 * Les leads préparés AVANT la refonte portent l'ancien contenu (généré librement par l'IA :
 * pitch qui dérive, chiffres inventés, mot "publicité", offre que Hdigiweb ne vend pas). Ils
 * partiraient tels quels. On réécrit donc `subject`/`body` de toutes les lignes encore `queued`
 * à partir de `buildHdigiwebSequence`, sans toucher au planning ni à la boîte d'envoi
 * (l'affinité boîte↔conversation doit être préservée).
 *
 * Complète aussi la séquence : l'ancienne faisait 4 mails, la nouvelle en fait 6. Les contacts
 * encore en cours reçoivent les steps manquants, calés depuis l'ancre du step 0.
 *
 * Usage :  /api/admin/refresh-queued?key=<CRON_SECRET>            → aperçu (n'écrit rien)
 *          /api/admin/refresh-queued?key=<CRON_SECRET>&apply=1    → applique
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(request.url)
    const apply = url.searchParams.get('apply') === '1'
    const audit = url.searchParams.get('audit') === '1'

    const { db } = await import('@/lib/db')
    const { email_queue, contacts } = await import('@/lib/db/schema')
    const { eq, and, lt, inArray, sql } = await import('drizzle-orm')

    // ── CONTRÔLE : aucun mail en attente ne doit porter l'ancien discours ─────
    // (chiffres inventés, mot "publicité" interdit par le client, tirets cadratins de l'IA).
    if (audit) {
      const INTERDITS: Record<string, string> = {
        publicite: '%publicit%',
        google_ads: '%Google Ads%',
        annonces: '%annonce%',
        chiffre_11_devis: '%11 devis%',
        chiffre_8_15: '%8 à 15%',
        chiffre_3_4_appels: '%3-4 appel%',
        chiffre_70_pct: '%70 %%',
        tiret_cadratin: '%—%',
      }
      const res: Record<string, number> = {}
      for (const [nom, pat] of Object.entries(INTERDITS)) {
        const [r] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(email_queue)
          .where(and(
            eq(email_queue.status, 'queued'),
            sql`(${email_queue.body} ILIKE ${pat} OR ${email_queue.subject} ILIKE ${pat})`,
          ))
        res[nom] = r?.n ?? 0
      }
      const total = Object.values(res).reduce((a, b) => a + b, 0)
      return NextResponse.json({
        ok: true,
        controle: 'mails en file portant l\'ancien discours',
        verdict: total === 0 ? 'PROPRE' : 'À CORRIGER',
        occurrences: res,
      })
    }
    const { buildHdigiwebSequence, auditHookSentence, SEQUENCE_DELAYS, SEQUENCE_LENGTH } =
      await import('@/data/sequence')
    const { getInboxSenderName } = await import('@/lib/instantly/inbox-rotation')

    // Uniquement ce qui n'est PAS encore parti, et uniquement la séquence FROIDE :
    // les steps >= 20 sont les relances de conversation, elles ont leur propre texte.
    const rows = await db
      .select({ queue: email_queue, contact: contacts })
      .from(email_queue)
      .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
      .where(and(eq(email_queue.status, 'queued'), lt(email_queue.sequence_step, 20)))

    const varsFor = (c: typeof rows[number]['contact'], fromEmail: string) => ({
      firstName: c.name?.split(' ')[0] ?? '',
      city: c.city ?? '',
      sector: c.sector ?? undefined,
      fromEmail,
      fromName: getInboxSenderName(fromEmail),
      auditHook: auditHookSentence(c.audit_level, c.audit_weaknesses),
    })

    // ── 1. Réécriture du contenu des lignes en file ──────────────────────────
    // Budget de temps (maxDuration=60) + écritures par lots parallèles : 2400 UPDATE séquentiels
    // dépassaient largement la limite (FUNCTION_INVOCATION_TIMEOUT). L'opération est IDEMPOTENTE
    // (les lignes déjà réécrites sont détectées identiques et sautées sans écriture), donc il
    // suffit de rappeler l'endpoint jusqu'à `restant: 0`.
    const START = Date.now()
    const TIME_BUDGET_MS = 45000
    const CHUNK = 40

    let rewritten = 0
    let unchanged = 0
    let remaining = 0
    const samples: Array<{ email: string; step: number; subject: string; body: string }> = []

    const todo: Array<{ id: string; subject: string; body: string }> = []
    for (const { queue, contact } of rows) {
      const step = queue.sequence_step ?? 0
      if (step >= SEQUENCE_LENGTH) continue // step orphelin d'une ancienne séquence plus longue
      const fresh = buildHdigiwebSequence(step, varsFor(contact, queue.from_email))
      if (fresh.subject === queue.subject && fresh.body === queue.body) { unchanged++; continue }
      if (samples.length < 3) {
        samples.push({ email: contact.email, step, subject: fresh.subject, body: fresh.body })
      }
      todo.push({ id: queue.id, subject: fresh.subject, body: fresh.body })
    }

    if (apply) {
      for (let i = 0; i < todo.length; i += CHUNK) {
        if (Date.now() - START > TIME_BUDGET_MS) { remaining = todo.length - i; break }
        const slice = todo.slice(i, i + CHUNK)
        await Promise.all(slice.map(t =>
          db.update(email_queue)
            .set({ subject: t.subject, body: t.body })
            .where(eq(email_queue.id, t.id)),
        ))
        rewritten += slice.length
      }
    } else {
      rewritten = todo.length
    }

    // Tant que la réécriture n'est pas finie, on ne touche pas à l'ajout des steps manquants
    // (sinon on insérerait des lignes pendant que le reste est encore à l'ancien format).
    if (remaining > 0) {
      return NextResponse.json({
        ok: true,
        mode: 'APPLIQUÉ (partiel — rappeler l\'endpoint pour continuer)',
        reecrits: rewritten,
        deja_a_jour: unchanged,
        restant: remaining,
        steps_ajoutes: 0,
      })
    }

    // ── 2. Complément 4 mails → 6 pour les contacts encore en cours ──────────
    // Ancre = date prévue/réelle du step 0 ; on recale les steps manquants dessus. Si l'échéance
    // est déjà passée (vieux lead), on décale à demain pour ne pas tout envoyer d'un coup.
    const activeContactIds = [...new Set(rows.map(r => r.contact.id))]
    let added = 0
    let addRemaining = 0
    const toInsert: Array<typeof email_queue.$inferInsert> = []
    const now = new Date()

    if (activeContactIds.length > 0) {
      const allRows = await db
        .select({ queue: email_queue, contact: contacts })
        .from(email_queue)
        .innerJoin(contacts, eq(email_queue.contact_id, contacts.id))
        .where(and(inArray(email_queue.contact_id, activeContactIds), lt(email_queue.sequence_step, 20)))

      const byContact = new Map<string, typeof allRows>()
      for (const r of allRows) {
        const list = byContact.get(r.contact.id) ?? []
        list.push(r)
        byContact.set(r.contact.id, list)
      }

      for (const [, list] of byContact) {
        const contact = list[0].contact
        const steps = new Set(list.map(r => r.queue.sequence_step ?? 0))
        const step0 = list.find(r => (r.queue.sequence_step ?? 0) === 0)?.queue
        const anchor = step0?.sent_at ?? step0?.scheduled_at ?? list[0].queue.scheduled_at ?? now
        const fromEmail = step0?.from_email ?? list[0].queue.from_email
        const campaignId = list[0].queue.campaign_id
        const variantId = list[0].queue.variant_id

        for (let i = 0; i < SEQUENCE_LENGTH; i++) {
          if (steps.has(i)) continue
          const when = new Date(anchor.getTime() + (SEQUENCE_DELAYS[i] ?? i * 3) * 86400000)
          // jamais dans le passé : on décale à demain plutôt que de partir immédiatement
          if (when.getTime() < now.getTime()) when.setTime(now.getTime() + 86400000)
          const fresh = buildHdigiwebSequence(i, varsFor(contact, fromEmail))
          toInsert.push({
            contact_id: contact.id,
            campaign_id: campaignId,
            sequence_step: i,
            from_email: fromEmail,
            subject: fresh.subject,
            body: fresh.body,
            status: 'queued',
            scheduled_at: when,
            variant_id: variantId,
          })
        }
      }

      // Insertion par lots (2000 INSERT séquentiels = timeout garanti).
      if (apply) {
        for (let i = 0; i < toInsert.length; i += 200) {
          if (Date.now() - START > 55000) { addRemaining = toInsert.length - i; break }
          await db.insert(email_queue).values(toInsert.slice(i, i + 200))
          added += Math.min(200, toInsert.length - i)
        }
      } else {
        added = toInsert.length
      }
    }

    return NextResponse.json({
      ok: true,
      mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
      queued_examines: rows.length,
      contacts_concernes: activeContactIds.length,
      reecrits: rewritten,
      deja_a_jour: unchanged,
      steps_ajoutes: added,
      steps_restants: addRemaining,
      exemples: samples,
    })
  } catch (err) {
    // Jamais de 500 muet : on renvoie la vraie erreur (sinon debug à l'aveugle).
    console.error('[admin/refresh-queued]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
