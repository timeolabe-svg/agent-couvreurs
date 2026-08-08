export const dynamic = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

/**
 * GET /api/cron/report-costs
 *
 * Déclare la CONSOMMATION de ce projet au CRM de LabegarIA, qui centralise les coûts des 3 agents.
 * Ce projet vit dans sa PROPRE base : le CRM ne peut pas mesurer sa consommation, c'est donc à lui
 * de la remonter. Sans ce cron, le coût dédié de ce projet resterait à 0 dans le CRM — donc sa
 * marge affichée serait flatteuse, et un prix de vente calculé dessus serait trop bas.
 *
 * Lecture SEULE côté base locale : ne modifie rien ici, envoie 6 compteurs.
 *
 * Tourne TOUS LES JOURS (cf. vercel.json) : le coût doit suivre la consommation au fil du mois
 * (importer 5 000 fiches le 3 doit se voir tout de suite), pas se figer entre deux passages.
 * Les 3 premiers jours du mois, on remonte AUSSI le mois précédent pour le clôturer avec ses
 * chiffres définitifs.
 *
 * Variables d'env attendues :
 *   CRM_URL     (défaut : https://labegaria-app.vercel.app)
 *   CRM_KEY     jeton machine du CRM (son CRON_SECRET) — obligatoire
 *   CRM_CLIENT  nom EXACT du projet dans crm_clients (défaut : "Hdigiweb")
 */

interface Rapport { mois: string; ok: boolean; payload?: Record<string, unknown>; erreur?: string }

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 503 })

  const CRM_URL = (process.env.CRM_URL || 'https://labegaria-app.vercel.app').replace(/\/$/, '')
  const CRM_KEY = process.env.CRM_KEY
  const CRM_CLIENT = process.env.CRM_CLIENT || 'Hdigiweb'
  if (!CRM_KEY) return NextResponse.json({ error: 'CRM_KEY non configurée — impossible de remonter les coûts' }, { status: 503 })

  const force = req.nextUrl.searchParams.get('mois')
  if (force && !/^\d{4}-\d{2}$/.test(force)) return NextResponse.json({ error: 'mois attendu au format AAAA-MM' }, { status: 400 })

  // Le mois en cours d'abord (c'est celui qui compte), puis éventuellement la clôture du précédent.
  const now = new Date()
  const mois = [force ?? now.toISOString().slice(0, 7)]
  if (!force && now.getUTCDate() <= 3) {
    mois.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7))
  }

  const { sql } = await import('@/lib/db')

  // Boîtes et domaines : configuration réelle (charge FIXE), lue une seule fois pour tous les mois.
  // Lue et non saisie : un nombre saisi dériverait dès qu'une boîte est ajoutée ou retirée.
  let boites = 0
  let domaines = 0
  try {
    const { getGmailBoxes } = await import('@/lib/gmail-sender')
    const bx = getGmailBoxes()
    boites = bx.length
    domaines = new Set(bx.map(b => b.email.split('@')[1]?.toLowerCase()).filter(Boolean)).size
  } catch { /* configuration illisible : 0 plutôt qu'un nombre inventé */ }

  const rapports: Rapport[] = []

  for (const cible of mois) {
    const debut = `${cible}-01`

    const [{ n: emails_envoyes }] = await sql`
      SELECT COUNT(*)::int AS n FROM email_queue
      WHERE status = 'sent' AND sent_at >= ${debut}::date AND sent_at < (${debut}::date + INTERVAL '1 month')
    ` as Array<{ n: number }>

    // Un contact compte une fois par mois où il a été soumis à MillionVerifier (les tentatives ne
    // sont pas datées individuellement) → très légère SOUS-estimation, jamais de surestimation.
    const [{ n: emails_verifies }] = await sql`
      SELECT COUNT(*)::int AS n FROM contacts
      WHERE mv_last_attempt_at >= ${debut}::date AND mv_last_attempt_at < (${debut}::date + INTERVAL '1 month')
    ` as Array<{ n: number }>

    const [{ n: fiches_scrapees }] = await sql`
      SELECT COUNT(*)::int AS n FROM contacts
      WHERE created_at >= ${debut}::date AND created_at < (${debut}::date + INTERVAL '1 month')
    ` as Array<{ n: number }>

    // Requêtes Google Places facturées sur le mois, si ce projet tient ce compteur.
    const places = await sql`SELECT value FROM agent_config WHERE key = ${'places_calls_month_' + cible}` as Array<{ value: string }>
    const requetes_places = Number(places[0]?.value ?? 0) || 0

    const payload = { client: CRM_CLIENT, mois: cible, emails_envoyes, emails_verifies, fiches_scrapees, requetes_places, boites, domaines }

    try {
      const r = await fetch(`${CRM_URL}/api/crm/usage?key=${encodeURIComponent(CRM_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      })
      rapports.push(r.ok
        ? { mois: cible, ok: true, payload }
        : { mois: cible, ok: false, payload, erreur: `CRM a répondu ${r.status} : ${(await r.text()).slice(0, 200)}` })
    } catch (e) {
      rapports.push({ mois: cible, ok: false, payload, erreur: String(e).slice(0, 200) })
    }
  }

  // 500 explicite si le mois EN COURS n'est pas passé : un report silencieusement raté laisserait le
  // CRM afficher un coût faux, et c'est le genre de panne qu'on ne remarque qu'en relisant ses prix
  // six mois plus tard. Un échec sur la seule clôture du mois précédent ne bloque pas : elle sera
  // retentée le lendemain.
  if (!rapports[0]?.ok) {
    return NextResponse.json({ ok: false, error: rapports[0]?.erreur ?? 'report du mois en cours échoué', rapports }, { status: 500 })
  }
  return NextResponse.json({ ok: true, rapports })
}
