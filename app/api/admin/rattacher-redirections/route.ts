import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * REPORTE SUR LA FICHE LES CHANGEMENTS D'ADRESSE DÉJÀ TRAITÉS.
 *
 * Le traitement du renvoi fonctionne depuis longtemps (contact créé sur la nouvelle adresse,
 * ancienne file annulée) mais il n'écrivait la trace que dans le journal d'événements. L'affichage,
 * lui, re-cherchait l'intention dans le texte du message — avec sa propre expression, plus étroite.
 * Résultat : des conversations reprises ailleurs restaient affichées comme « en attente ».
 *
 * On récupère donc les renvois passés depuis le journal (seul endroit où le lien ancienne → nouvelle
 * adresse existe) et on les inscrit sur la fiche.
 *
 * ?apply=1 pour écrire (sans : aperçu).
 */
export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const apply = req.nextUrl.searchParams.get('apply') === '1'
  const { sql } = await import('@/lib/db')

  const evts = (await sql`
    SELECT DISTINCT
      LOWER(data->>'contactEmail') AS ancienne,
      LOWER(data->>'newEmail')     AS nouvelle
    FROM dashboard_events
    WHERE data->>'action' = 'email_updated'
      AND data->>'newEmail' IS NOT NULL
  `) as Array<{ ancienne: string; nouvelle: string }>

  const faits: Array<{ ancienne: string; nouvelle: string; ecrit: boolean }> = []

  for (const e of evts) {
    if (!e.ancienne || !e.nouvelle) continue
    let ecrit = false
    if (apply) {
      const r = (await sql`
        UPDATE contacts SET redirige_vers = ${e.nouvelle}
        WHERE LOWER(email) = ${e.ancienne} AND redirige_vers IS DISTINCT FROM ${e.nouvelle}
        RETURNING id
      `) as Array<{ id: string }>
      // ⚠️ On compte le RETURNING, pas l'intention : un compteur incrémenté à côté de l'écriture
      // annonce un travail qui n'a pas eu lieu.
      ecrit = r.length > 0
    }
    faits.push({ ancienne: e.ancienne, nouvelle: e.nouvelle, ecrit })
  }

  return NextResponse.json({
    mode: apply ? 'APPLIQUÉ' : 'APERÇU (rien écrit) — relancer avec &apply=1',
    renvois_trouves: faits.length,
    fiches_mises_a_jour: faits.filter(f => f.ecrit).length,
    detail: faits,
  })
}
