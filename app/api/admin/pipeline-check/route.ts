import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/** Diagnostic ponctuel : où en est le pipeline terrassier (funnel prospect -> queued step0 prêt). */
export async function GET(request: NextRequest) {
  const auth = checkCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sql } = await import('@/lib/db')

  const funnel = await sql`
    SELECT
      COUNT(*) FILTER (WHERE c.sector = 'terrassier')::int AS terrassier_total,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND COALESCE(c.google_reviews_count,0) >= 20)::int AS terrassier_cible_20avis,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND COALESCE(c.google_reviews_count,0) >= 20 AND c.email IS NOT NULL AND c.email <> '')::int AS terrassier_avec_email,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step = 0))::int AS terrassier_step0_en_file,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step = 0 AND eq.status = 'queued') AND c.email_validated IS TRUE)::int AS terrassier_step0_pret_a_envoyer,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id AND eq.sequence_step = 0 AND eq.status = 'queued') AND (c.email_validated IS NULL OR c.email_validated = false))::int AS terrassier_step0_attend_validation,
      COUNT(*) FILTER (WHERE c.sector = 'terrassier' AND COALESCE(c.google_reviews_count,0) >= 20 AND NOT EXISTS (SELECT 1 FROM email_queue eq WHERE eq.contact_id = c.id))::int AS terrassier_jamais_mis_en_file
    FROM contacts c
  `
  return NextResponse.json({ ok: true, funnel: funnel[0] })
}
