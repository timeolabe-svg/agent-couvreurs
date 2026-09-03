import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * PROMOTION DES LEADS SANS EMAIL VERS LE CANAL LINKEDIN.
 *
 * Population A du plan (voir _audits ou la conversation du 03/09) : les entreprises déjà
 * scrapées via Outscraper, déjà filtrées sur le métier ET le seuil de 20 avis (le filtre est
 * appliqué EN AMONT dans import-outscraper, `outscraper_leads.status = 'no_email'` ne contient
 * QUE des entreprises qui ont déjà passé ce filtre), mais qui n'ont jamais pu entrer dans
 * `contacts` faute d'email exploitable. Elles sont donc à 0 % joignables aujourd'hui — LinkedIn
 * n'est pas un canal concurrent pour elles, c'est le seul. Zéro chevauchement avec l'email :
 * aucune de ces entreprises n'est dans une séquence email active.
 *
 * Pipeline : SIRENE (gratuit) trouve le nom du dirigeant → promotion en `contacts` (email=NULL)
 * → ligne `linkedin_leads` (profile_url encore NULL, résolu par le bot lui-même via une
 * recherche LinkedIn native au moment d'inviter — voir /api/linkedin/next-invites).
 *
 * `promu_linkedin_le` marque une ligne comme traitée, QUE SIRENE ait trouvé un dirigeant ou pas —
 * sinon le même lot serait retenté indéfiniment sans jamais avancer.
 *
 * Usage : ?batch=10 (traite 10 entreprises), ?stats=1 pour le funnel cumulé.
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const started = Date.now()
  const { sql } = await import('@/lib/db')

  // Idempotent : la colonne peut ne pas encore exister si cette route tourne avant la migration.
  await sql`ALTER TABLE outscraper_leads ADD COLUMN IF NOT EXISTS promu_linkedin_le TIMESTAMPTZ`

  if (request.nextUrl.searchParams.get('stats') === '1') {
    const stats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'no_email')::int AS total_sans_email,
        COUNT(*) FILTER (WHERE status = 'no_email' AND promu_linkedin_le IS NOT NULL)::int AS deja_traites,
        COUNT(*) FILTER (WHERE status = 'no_email' AND promu_linkedin_le IS NULL)::int AS restants
      FROM outscraper_leads`
    const dirigeants = await sql`
      SELECT COUNT(*)::int AS n FROM linkedin_leads WHERE first_name IS NOT NULL`
    return NextResponse.json({ ok: true, outscraper: stats[0], linkedin_leads_avec_dirigeant: dirigeants[0]?.n ?? 0 })
  }

  const batch = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('batch') ?? 10)))

  const todo = await sql`
    SELECT place_id, name, city, sector, reviews
    FROM outscraper_leads
    WHERE status = 'no_email' AND promu_linkedin_le IS NULL
    ORDER BY reviews DESC NULLS LAST, created_at ASC
    LIMIT ${batch}
  ` as Array<{ place_id: string; name: string; city: string | null; sector: string | null; reviews: number | null }>

  const { chercherDirigeant } = await import('@/lib/sirene-dirigeant')
  const resultats: string[] = []

  for (const lead of todo) {
    if (Date.now() - started > 45000) break
    try {
      const dirigeant = await chercherDirigeant(lead.name, lead.city ?? '')

      if (!dirigeant) {
        await sql`UPDATE outscraper_leads SET promu_linkedin_le = NOW() WHERE place_id = ${lead.place_id}`
        resultats.push(`∅ dirigeant introuvable : ${lead.name}`)
        continue
      }

      // Promotion en contacts (email=NULL — canal LinkedIn seul). google_place_id ré-utilisé
      // comme clé de dédoublonnage, ON CONFLICT protège d'une double promotion en cas de rejeu.
      const contact = await sql`
        INSERT INTO contacts (company, city, sector, google_reviews_count, google_place_id, source, director_name, audit_done)
        VALUES (${lead.name}, ${lead.city}, ${lead.sector}, ${lead.reviews}, ${lead.place_id}, 'outscraper', ${`${dirigeant.firstName} ${dirigeant.lastName}`}, false)
        ON CONFLICT (google_place_id) DO NOTHING
        RETURNING id
      ` as Array<{ id: string }>

      if (!contact[0]) {
        // Le contact existait déjà (rejeu) : on marque quand même traité pour ne pas boucler.
        await sql`UPDATE outscraper_leads SET promu_linkedin_le = NOW() WHERE place_id = ${lead.place_id}`
        resultats.push(`↻ déjà promu : ${lead.name}`)
        continue
      }

      await sql`
        INSERT INTO linkedin_leads (contact_id, first_name, last_name, company, status)
        VALUES (${contact[0].id}, ${dirigeant.firstName}, ${dirigeant.lastName}, ${lead.name}, 'pending')
      `
      await sql`UPDATE outscraper_leads SET promu_linkedin_le = NOW() WHERE place_id = ${lead.place_id}`
      resultats.push(`✓ ${lead.name} → ${dirigeant.firstName} ${dirigeant.lastName} (${dirigeant.qualite})`)
    } catch (e) {
      resultats.push(`✗ ${lead.name} : ${String(e).slice(0, 100)}`)
    }
  }

  return NextResponse.json({ ok: true, traites: resultats.length, resultats })
}
