import { NextRequest, NextResponse } from 'next/server'
import { checkLinkedinBotAuth } from '@/lib/linkedin-bot-auth'

export const dynamic = 'force-dynamic'

/**
 * PROCHAINS LEADS À INVITER — le bot résout lui-même le profil (recherche LinkedIn native, page
 * de résultats = liste, coût quasi nul) puis ouvre le profil retenu pour confirmer l'identité et
 * lire le prénom réel sur le <h1> avant d'inviter. `profile_url` peut donc être NULL ici : c'est
 * le cas normal d'un lead tout juste promu depuis Outscraper/SIRENE (§2 du plan), pas une erreur.
 *
 * Le budget de visites/jour, lui, reste ENTIÈREMENT côté bot (state.json, fail-closed) — cette
 * route ne fait AUCUN calcul de quota, elle liste des candidats, jamais un nombre à en inviter.
 *
 * GET /api/linkedin/next-invites?key=<LINKEDIN_BOT_SECRET>&limit=10
 */
export async function GET(request: NextRequest) {
  const auth = checkLinkedinBotAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  try {
    const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 10)))
    const { sql } = await import('@/lib/db')

    // Blocklist vérifiée ICI, PAS seulement au moment d'inviter côté bot : un lead qui vient
    // d'être blocklisté (par email, sur l'autre canal) ne doit même pas être PROPOSÉ.
    const rows = await sql`
      SELECT ll.id, ll.first_name, ll.last_name, ll.company, ll.profile_url,
             c.city, c.sector, c.director_name
      FROM linkedin_leads ll
      LEFT JOIN contacts c ON c.id = ll.contact_id
      WHERE ll.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM blocklist b
          WHERE (c.email IS NOT NULL AND LOWER(b.email) = LOWER(c.email))
             OR (ll.profile_url IS NOT NULL AND LOWER(b.linkedin_url) = LOWER(ll.profile_url))
        )
      ORDER BY ll.created_at ASC
      LIMIT ${limit}
    `
    return NextResponse.json({ ok: true, leads: rows })
  } catch (err) {
    console.error('[linkedin/next-invites] error', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
