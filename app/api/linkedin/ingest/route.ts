import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * INGESTION D'UN MESSAGE LINKEDIN — le bot pousse ici tout ce qu'il lit dans la messagerie.
 *
 * Reprend le format de dédup de LabegarIA : `instantly_reply_id = 'li:<lead_id>:<hash_du_texte>'`
 * (le nom de colonne date de l'ère Instantly, mais la contrainte unique dessus est ce qui protège
 * de traiter deux fois le même message — pas la peine d'en créer une autre).
 *
 * POST /api/linkedin/ingest?key=<LINKEDIN_BOT_SECRET>
 * body: { profile_url, first_name?, last_name?, company?, body: string, received_at?: string }
 */
export async function POST(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const payload = await request.json() as {
      profile_url?: string; first_name?: string; last_name?: string; company?: string
      body?: string; received_at?: string
    }
    if (!payload.profile_url || !payload.body?.trim()) {
      return NextResponse.json({ error: 'profile_url et body requis' }, { status: 400 })
    }

    const { sql } = await import('@/lib/db')
    const { profileKey } = await import('@/lib/blocklist')
    const { isExplicitOptOut } = await import('@/lib/rgpd')
    const { classifyReply } = await import('@/lib/reply-agent/classifier')
    const { prepareLinkedinReply } = await import('@/lib/reply-agent/send-linkedin-reply')

    // `key` = clé canonique 'in/<slug>', réservée à la table `blocklist` (seule à la stocker sous
    // cette forme, cf. lib/blocklist.ts). `linkedin_leads.profile_url` stocke lui l'URL COMPLÈTE
    // brute, telle qu'écrite par lead-status/route.ts depuis resolveProfile() du bot — les deux
    // formats ne sont PAS interchangeables.
    //
    // 🚨 BUG CORRIGÉ (04/09/2026) : cette route comparait `profile_url = ${key}` (forme courte)
    // contre une colonne en forme longue → aucune ligne existante n'a JAMAIS matché, chaque
    // réponse créait un lead FANTÔME (profile_url='in/<slug>', contact_id=NULL, jamais rattaché à
    // la vraie fiche). Le vrai lead restait 'messaged' pour toujours (jamais vu comme 'replied' par
    // le statut), et le brouillon de réponse se serait attaché à une URL invalide — le filet de
    // conversation en direct dans runRelances() a évité un double message, mais le pipeline de
    // réponse était cassé. Fix : extraire le même slug que le bot (regex identique à
    // bot.js:profileKey) et matcher sur l'URL complète via LIKE, jamais une comparaison stricte.
    const slug = (payload.profile_url.match(/\/in\/([^/?#]+)/i)?.[1] || '').toLowerCase()
    if (!slug) return NextResponse.json({ error: 'profile_url invalide (pas de /in/<slug>)' }, { status: 400 })

    // Retrouver (ou créer) le lead. Le bot connaît le profil AVANT que la fiche existe si la
    // recherche a résolu un profil jamais invité par nous jusque-là (cas rare, ex. quelqu'un
    // écrit en premier) — on garde la trace quand même, sans contact_id, plutôt que la jeter.
    const leadRows = (await sql`
      SELECT id, contact_id, status FROM linkedin_leads
      WHERE LOWER(profile_url) LIKE '%/in/' || ${slug} || '%'
      LIMIT 1
    `) as Array<{ id: string; contact_id: string | null; status: string | null }>
    let lead = leadRows[0]
    if (!lead) {
      // On stocke l'URL COMPLÈTE (jamais la clé courte) : c'est le format que lit tout le reste du
      // bot (profileKey() côté bot.js compare des URLs complètes entre elles).
      const ins = (await sql`
        INSERT INTO linkedin_leads (first_name, last_name, company, profile_url, status)
        VALUES (${payload.first_name ?? null}, ${payload.last_name ?? null}, ${payload.company ?? null}, ${payload.profile_url}, 'replied')
        RETURNING id, contact_id, status
      `) as Array<{ id: string; contact_id: string | null; status: string | null }>
      lead = ins[0]
    }

    // Statut TERMINAL : un lead qui a déjà décliné n'écrit normalement plus, mais si LinkedIn
    // relivre quand même un message (relance manuelle du prospect, doublon d'ingestion), on
    // l'enregistre pour la trace, sans jamais générer de brouillon derrière — cf. plus bas.

    /**
     * OPT-OUT DÉTERMINISTE, PRIORITAIRE SUR TOUT — même détecteur que l'email (lib/rgpd.ts), pas
     * une copie : cinq familles de formulations différentes ont déjà divergé une fois entre deux
     * détecteurs recopiés, cf. l'incident du 26/08. Un stop bloque les DEUX canaux de la même
     * personne (doctrine LabegarIA) : email ET linkedin_url si le contact les a tous les deux.
     */
    let contactEmail: string | null = null
    if (lead.contact_id) {
      const c = (await sql`SELECT email FROM contacts WHERE id = ${lead.contact_id} LIMIT 1`) as Array<{ email: string | null }>
      contactEmail = c[0]?.email ?? null
    }
    const optOut = isExplicitOptOut(payload.body)
    if (optOut) {
      // `blocklist.linkedin_url` stocke lui la forme CANONIQUE ('in/<slug>', cf. lib/blocklist.ts)
      // — c'est la forme qu'estBloque()/le check du bot recalculent et comparent, contrairement à
      // linkedin_leads.profile_url ci-dessus qui garde l'URL complète.
      await sql`
        INSERT INTO blocklist (email, linkedin_url, reason, source)
        VALUES (${contactEmail}, ${profileKey(payload.profile_url)}, 'unsubscribe', 'linkedin')
      `.catch(() => {}) // best-effort : ne bloque jamais l'ingestion elle-même
      await sql`UPDATE linkedin_leads SET status = 'not_interested' WHERE id = ${lead.id}`
    }

    const classification = optOut
      ? { classification: 'desinterest' as const, action: 'blocklist' as const }
      : await classifyReply({
          replyBody: payload.body,
          replySubject: '',
          originalEmailBody: '',
          contactName: payload.first_name ?? '',
          contactCompany: payload.company ?? '',
        })

    const dedupKey = `li:${lead.id}:${hashCourt(payload.body)}`
    const inserted = (await sql`
      INSERT INTO incoming_replies (contact_id, linkedin_lead_id, channel, body, classification, action_taken, instantly_reply_id, processed_at, created_at)
      VALUES (${lead.contact_id}, ${lead.id}, 'linkedin', ${payload.body}, ${classification.classification}, ${classification.action}, ${dedupKey}, NOW(), ${payload.received_at ?? new Date().toISOString()})
      ON CONFLICT DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>

    if (!inserted[0]) return NextResponse.json({ ok: true, dedup: true }) // déjà traité

    if (!optOut && lead.status !== 'not_interested') {
      await sql`UPDATE linkedin_leads SET status = 'replied', last_message_at = NOW() WHERE id = ${lead.id}`
      // Prépare un brouillon (n'envoie rien) : voir send-linkedin-reply.ts pour le pourquoi.
      await prepareLinkedinReply(inserted[0].id).catch((e) => console.error('[linkedin/ingest] prepareLinkedinReply', e))
    }

    return NextResponse.json({ ok: true, incoming_reply_id: inserted[0].id, blocked: optOut })
  } catch (err) {
    console.error('[linkedin/ingest] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}

/** Hash court et stable pour la dédup — pas de crypto nécessaire, juste une empreinte du texte. */
function hashCourt(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0 }
  return Math.abs(h).toString(36)
}
