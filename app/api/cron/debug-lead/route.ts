import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import type { NeonQueryFunction } from '@neondatabase/serverless'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let sql!: NeonQueryFunction<false, false>

// Diagnostic ciblé d'un lead : état réel réponses/brouillons/rdv/file. ?email=...
export async function GET(req: Request) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'No DATABASE_URL' }, { status: 500 })
  sql = (await import('@/lib/db')).sql
  // ?cols=table → dump des colonnes réelles en prod (détection de dérive de schéma)
  const colsTable = new URL(req.url).searchParams.get('cols')
  if (colsTable) {
    try {
      const cols = (await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${colsTable} ORDER BY ordinal_position`) as Array<Record<string, unknown>>
      return NextResponse.json({ table: colsTable, columns: cols })
    } catch (e) {
      return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
    }
  }

  // ?audit=1 → réponses classées auto_reply MAIS sans aucun brouillon (auto-réponse jamais créée)
  if (new URL(req.url).searchParams.get('audit')) {
    try {
      const byAction = (await sql`SELECT action_taken, count(*)::int AS n FROM incoming_replies GROUP BY action_taken ORDER BY n DESC`) as Array<Record<string, unknown>>
      const orphans = (await sql`
        SELECT ir.id, ir.from_email, ir.classification, ir.action_taken, ir.created_at
        FROM incoming_replies ir
        LEFT JOIN reply_drafts rd ON rd.incoming_reply_id = ir.id
        WHERE ir.action_taken IN ('auto_reply','draft_for_validation') AND rd.id IS NULL
        ORDER BY ir.created_at DESC LIMIT 50
      `) as Array<Record<string, unknown>>
      return NextResponse.json({ by_action: byAction, orphans_sans_brouillon: orphans.length, orphans })
    } catch (e) {
      return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
    }
  }

  // ?testinsert=<incoming_reply_id> → reproduit l'INSERT auto_reply exact, capture l'erreur, puis nettoie
  const testId = new URL(req.url).searchParams.get('testinsert')
  if (testId) {
    const out: Record<string, unknown> = {}
    try {
      const r = (await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status, send_after) VALUES (${testId}, ${'__debug_test__'}, 'scheduled', ${new Date(Date.now() + 300000).toISOString()}) RETURNING id`) as Array<{ id: string }>
      out.scheduled_insert = 'OK id=' + r[0]?.id
      await sql`DELETE FROM reply_drafts WHERE id = ${r[0].id}`
      out.cleanup = 'ok'
    } catch (e) {
      out.scheduled_insert_error = String((e as Error)?.message ?? e).slice(0, 300)
    }
    try {
      const r2 = (await sql`INSERT INTO reply_drafts (incoming_reply_id, body, status) VALUES (${testId}, ${'__debug_test2__'}, 'pending') RETURNING id`) as Array<{ id: string }>
      out.pending_insert = 'OK id=' + r2[0]?.id
      await sql`DELETE FROM reply_drafts WHERE id = ${r2[0].id}`
    } catch (e) {
      out.pending_insert_error = String((e as Error)?.message ?? e).slice(0, 300)
    }
    return NextResponse.json(out)
  }

  // ?gen=1 → teste la génération Gemini brute (finishReason + longueur) pour un prompt de réponse type
  if (new URL(req.url).searchParams.get('gen')) {
    const key = process.env.GEMINI_API_KEY
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
    if (!key) return NextResponse.json({ error: 'GEMINI_API_KEY absente' })
    const out: Record<string, unknown> = { model }
    for (const maxTok of [1000, 2048]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'Tu es Gabin, commercial chez Hdigiweb. Réponds en français, court.' }] },
            contents: [{ role: 'user', parts: [{ text: 'Un couvreur répond "appelez-moi au 06 14 87 64 81". Rédige la réponse. JSON uniquement: {"body":"..."}' }] }],
            generationConfig: { maxOutputTokens: maxTok, temperature: 0.8, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(20000),
        })
        const j = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> }
        const cand = j.candidates?.[0]
        const txt = cand?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
        out[`maxTok_${maxTok}`] = { http: r.status, finishReason: cand?.finishReason ?? '(none)', textLen: txt.length, sample: txt.slice(0, 120) }
      } catch (e) {
        out[`maxTok_${maxTok}`] = { error: String((e as Error)?.message ?? e).slice(0, 150) }
      }
    }
    return NextResponse.json(out)
  }

  // ?genreal=1 → appelle le VRAI générateur sur un cas "appelez-moi au 06..." pour vérifier le ton
  if (new URL(req.url).searchParams.get('genreal')) {
    try {
      const { generateReplyResponse } = await import('@/lib/reply-agent/generator')
      const body = await generateReplyResponse({
        classification: 'rdv_request',
        originalEmailBody: 'Bonjour, un mot rapide sur votre visibilité Google à Sèvres. Bien à vous, Gabin, Hdigiweb.',
        replyBody: 'Bonjour, je viens de recevoir un mail de votre part. Pouvez-vous m’appeler au 06 14 87 64 81 pour qu’on discute un peu ensemble',
        contactName: 'Bauer',
        contactCompany: 'Rénovation Bauer',
        contactCity: 'Sèvres',
        contactSector: 'couvreur',
        contactPhone: '06 14 87 64 81',
        fromEmail: 'gabin@hdigiweb-agence.com',
      })
      return NextResponse.json({ body })
    } catch (e) {
      return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
    }
  }

  const email = new URL(req.url).searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email requis' }, { status: 400 })

  try {
    const c = (await sql`SELECT id, email, name, company, phone, sector, city FROM contacts WHERE lower(email)=lower(${email}) LIMIT 1`) as Array<Record<string, unknown>>
    if (!c[0]) return NextResponse.json({ error: 'contact introuvable', email })
    const id = c[0].id as string
    const ir = (await sql`SELECT id, classification, action_taken, created_at, left(body,140) AS body FROM incoming_replies WHERE contact_id=${id} ORDER BY created_at`) as Array<Record<string, unknown>>
    const rd = (await sql`SELECT rd.id, rd.status, rd.send_after, rd.sent_at, left(rd.body,140) AS body FROM reply_drafts rd JOIN incoming_replies i ON i.id=rd.incoming_reply_id WHERE i.contact_id=${id} ORDER BY rd.created_at`) as Array<Record<string, unknown>>
    const rv = (await sql`SELECT id, scheduled_at, status, left(notes,100) AS notes FROM rdv WHERE contact_id=${id} ORDER BY scheduled_at`) as Array<Record<string, unknown>>
    const eq = (await sql`SELECT sequence_step, status, sent_at FROM email_queue WHERE contact_id=${id} ORDER BY sequence_step`) as Array<Record<string, unknown>>
    return NextResponse.json({ contact: c[0], incoming_replies: ir, reply_drafts: rd, rdv: rv, email_queue: eq })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
