import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const maxDuration = 60

/**
 * EXPORT DES LEADS À TRANSFÉRER VERS UN AUTRE AGENT (LabegarIA).
 *
 * Deux gisements que Hdigiweb n'exploite pas :
 *  - `faible_avis` : moins de 20 avis Google → hors cible client, ils ne partiront jamais.
 *  - `rdv`         : les RDV que le client a jugés non viables.
 *
 * ⚠️ RÈGLE NON NÉGOCIABLE : quiconque a dit "Stop" à Hdigiweb est EXCLU. L'opt-out est attaché à
 * la personne, pas à la campagne : le transférer à une autre marque serait un manquement RGPD.
 * On exclut aussi ceux qui ont déjà répondu (conversation en cours ou refus) pour ne pas
 * re-solliciter quelqu'un qui vient d'être démarché sur un sujet voisin.
 *
 * Usage : /api/admin/export-leads?key=<CRON_SECRET>&type=faible_avis[&limit=500][&full=1]
 */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const url = new URL(request.url)
    const type = url.searchParams.get('type') ?? 'faible_avis'
    const full = url.searchParams.get('full') === '1'
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '2000', 10) || 2000, 5000)

    const { db } = await import('@/lib/db')
    const { sql } = await import('drizzle-orm')

    // Répartition par métier : sert à répondre factuellement à la question "est-ce que tel
    // secteur est déjà couvert, et à quel volume ?" sans avoir à supposer.
    if (type === 'repartition') {
      const r = await db.execute(sql`
        SELECT c.sector,
               COUNT(*)::int                                         AS prospects,
               COUNT(*) FILTER (WHERE COALESCE(c.google_reviews_count,0) >= 20)::int AS cibles_20avis,
               COUNT(DISTINCT eq.contact_id) FILTER (WHERE eq.status = 'sent')::int  AS contactes,
               COUNT(DISTINCT ir.contact_id)::int                    AS ont_repondu,
               COUNT(DISTINCT rv.contact_id)::int                    AS rdv
        FROM contacts c
        LEFT JOIN email_queue eq     ON eq.contact_id = c.id
        LEFT JOIN incoming_replies ir ON ir.contact_id = c.id
        LEFT JOIN rdv rv              ON rv.contact_id = c.id AND rv.status <> 'proposed'
        GROUP BY c.sector
        ORDER BY 2 DESC
      `)
      const rows = (r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])
      return NextResponse.json({ ok: true, type, repartition: rows })
    }

    // Exclusions communes : opt-out, déjà répondu, email absent.
    const exclusions = sql`
      c.email IS NOT NULL AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE lower(b.email) = lower(c.email))
      AND NOT EXISTS (SELECT 1 FROM incoming_replies r WHERE lower(r.from_email) = lower(c.email))
    `

    const rows = type === 'rdv'
      ? await db.execute(sql`
          SELECT DISTINCT ON (lower(c.email))
            c.email, c.company, c.name, c.phone, c.website, c.city, c.sector,
            COALESCE(c.google_reviews_count, 0) AS avis, c.google_rating AS note,
            c.audit_level, c.audit_score, r.status AS rdv_status
          FROM contacts c
          JOIN rdv r ON r.contact_id = c.id
          WHERE c.email IS NOT NULL AND c.email <> ''
            AND NOT EXISTS (SELECT 1 FROM blocklist b WHERE lower(b.email) = lower(c.email))
          ORDER BY lower(c.email), r.created_at DESC
          LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT DISTINCT ON (lower(c.email))
            c.email, c.company, c.name, c.phone, c.website, c.city, c.sector,
            COALESCE(c.google_reviews_count, 0) AS avis, c.google_rating AS note,
            c.audit_level, c.audit_score, c.email_confidence_score AS confiance, c.source, NULL AS rdv_status
          FROM contacts c
          WHERE COALESCE(c.google_reviews_count, 0) < 20
            AND ${exclusions}
            AND NOT EXISTS (SELECT 1 FROM rdv r WHERE r.contact_id = c.id)
          ORDER BY lower(c.email), c.created_at
          LIMIT ${limit}
        `)

    const leads = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[])
    const list = leads as Array<Record<string, unknown>>

    // Répartition utile pour décider du ciblage avant d'importer quoi que ce soit.
    const parSite: Record<string, number> = {}
    const parSecteur: Record<string, number> = {}
    for (const l of list) {
      const k = l.website ? 'avec site' : 'sans site'
      parSite[k] = (parSite[k] ?? 0) + 1
      const s = String(l.sector ?? 'inconnu')
      parSecteur[s] = (parSecteur[s] ?? 0) + 1
    }

    return NextResponse.json({
      ok: true,
      type,
      total: list.length,
      repartition_site: parSite,
      repartition_secteur: parSecteur,
      leads: full ? list : list.slice(0, 5),
      note: full ? undefined : 'aperçu (5 lignes) — ajouter &full=1 pour la liste complète',
    })
  } catch (err) {
    console.error('[admin/export-leads]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
