import { NextRequest, NextResponse } from 'next/server'
import { wrapCron } from '@/lib/cron-wrap'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * PROMOTION DES LEADS ACHETÉS → CONTACTS DÉMARCHABLES.
 *
 * ⚠️ CE CHAÎNON N'EXISTAIT PAS. La logique (scraper l'email sur le site du lead, créer le contact,
 * le mettre en file) vivait dans `/api/admin/import-outscraper?process=1` — un endpoint ADMIN,
 * qu'AUCUN cron n'appelait. Autrement dit : on pouvait acheter et importer un fichier de leads, il
 * ne se passait plus rien. Jamais.
 *
 * Constaté le 13/08/2026 : 523 leads en attente depuis l'import de la veille, et seulement
 * 3 NOUVEAUX contacts démarchés dans la journée (sur 123 mails partis — les 120 autres étaient des
 * relances de prospects déjà connus). Le stock était là, la machine tournait, et pourtant la
 * prospection ne renouvelait plus personne. Rien n'était en erreur : le chaînon manquait, tout
 * simplement, et aucun compteur ne mesurait son absence.
 *
 * ⚠️ BUDGET DE TEMPS OBLIGATOIRE. Chaque lead coûte ~1,8 s (on va chercher son email sur son site).
 * cron-job.org coupe à 30 s, quoi qu'en dise `maxDuration`. On s'arrête donc à 22 s : les leads non
 * traités restent en base et repartiront au prochain passage. Un cron qui abat 80 % du travail et
 * rend la main vaut infiniment mieux qu'un cron coupé à 100 % du sien.
 *
 * À CADENCER TOUTES LES 30 MIN sur cron-job.org : ~10 leads par passage ≈ 480/jour, de quoi
 * absorber un fichier de 3 000 fiches en quelques jours.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const debut = Date.now()
  /**
   * ⚠️ ENCHAÎNER LES DEUX ÉTAPES DANS LE MÊME PASSAGE NE TENAIT PAS.
   * Mesuré : 29,7 s pour promotion (12 s de budget, mais un lot en cours déborde) + validation
   * (~12 s). À 300 ms de la coupe des 30 s, un passage sur deux aurait échoué — et j'aurais
   * réintroduit exactement la panne que je venais de réparer.
   *
   * On ALTERNE donc : un passage promeut, le suivant valide. À 30 min de cadence, chaque étape
   * tourne toutes les heures et chaque passage reste autour de 24 s.
   *
   * ⚠️ L'alternance repose sur un compteur PERSISTANT en base, jamais sur l'heure : une bascule
   * dérivée de l'horloge devient dégénérée dès que la période du cron est un multiple du pas —
   * une des deux étapes ne tournerait alors JAMAIS, sans la moindre erreur visible.
   *
   * Pourquoi la validation est indispensable ici : promouvoir un lead crée un contact dont
   * l'adresse n'est PAS encore validée, or le moteur d'envoi exige `email_validated` avant
   * d'écrire à qui que ce soit. Les contacts créés resteraient bloqués juste avant l'envoi — le
   * même chaînon manquant que celui qu'on vient de réparer, déplacé d'un cran. `validate-emails`
   * a bien son propre cron dans le code, avec battement… mais rien ne l'appelait non plus.
   *
   * Débits à cadence de 30 min : ~20 leads promus et ~10 adresses validées par heure, soit ~480 et
   * ~240 par jour. La validation suit la promotion (35 % des leads donnent un email exploitable),
   * donc aucune des deux files ne s'accumule.
   */
  const BUDGET_MS = 22_000

  const { sql } = await import('@/lib/db')
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  const cle = process.env.CRON_SECRET ?? ''

  const compteur = (await sql`
    INSERT INTO agent_config (key, value, updated_at) VALUES ('promote_leads_tour', '1', now())
    ON CONFLICT (key) DO UPDATE SET
      value = ((COALESCE(NULLIF(agent_config.value, ''), '0')::bigint + 1))::text, updated_at = now()
    RETURNING value
  `) as Array<{ value: string }>
  const tour = Number(compteur[0]?.value ?? 0)

  const restant = (await sql`
    SELECT COUNT(*)::int AS n FROM outscraper_leads WHERE status = 'new'
  `) as Array<{ n: number }>

  // Tour PAIR → validation. Sauf s'il n'y a plus rien à promouvoir : dans ce cas on valide à
  // chaque passage, il n'y a aucune raison d'attendre.
  const plusRienAPromouvoir = !restant[0]?.n
  if (tour % 2 === 0 || plusRienAPromouvoir) {
    const v = await fetch(`${base}/api/cron/validate-emails?key=${encodeURIComponent(cle)}`, {
      headers: { 'user-agent': 'promote-leads-cron' },
    }).catch(() => null)
    const r1 = v && v.ok ? await v.json().catch(() => null) : null
    // Une seconde passe si la première dit qu'il en reste, et si le temps le permet largement.
    let r2 = null
    if (r1 && String(r1.remaining ?? '').startsWith('oui') && Date.now() - debut < 14_000) {
      const v2 = await fetch(`${base}/api/cron/validate-emails?key=${encodeURIComponent(cle)}`, {
        headers: { 'user-agent': 'promote-leads-cron' },
      }).catch(() => null)
      r2 = v2 && v2.ok ? await v2.json().catch(() => null) : null
    }
    return NextResponse.json({
      ok: true, tour, mode: 'validation',
      passes: [r1, r2].filter(Boolean),
      restant_a_promouvoir: restant[0]?.n ?? 0,
      duree_s: Math.round((Date.now() - debut) / 100) / 10,
    })
  }

  /**
   * On réutilise l'endpoint existant plutôt que d'en dupliquer la logique : sa gestion du scraping
   * d'email, de la blocklist, des doublons et de la mise en file est déjà éprouvée, et la dupliquer
   * garantirait qu'une des deux copies dérive — c'est exactement ce qui est arrivé au pied de page
   * légal, corrigé deux fois au même endroit.
   */
  let traites = 0, importes = 0
  const detail: string[] = []

  while (Date.now() - debut < BUDGET_MS) {
    const r = await fetch(`${base}/api/admin/import-outscraper?process=1&batch=5&key=${encodeURIComponent(cle)}`, {
      headers: { 'user-agent': 'promote-leads-cron' },
    }).catch(() => null)
    if (!r || !r.ok) { detail.push(`arrêt : réponse ${r?.status ?? 'injoignable'}`); break }
    const j = await r.json().catch(() => null) as { traites?: number; importes?: number; results?: string[] } | null
    if (!j || !j.traites) break
    traites += j.traites
    importes += j.importes ?? 0
    if (j.results) detail.push(...j.results.slice(0, 3))
  }

  const apres = (await sql`
    SELECT COUNT(*)::int AS n FROM outscraper_leads WHERE status = 'new'
  `) as Array<{ n: number }>

  return NextResponse.json({
    ok: true,
    tour,
    mode: 'promotion',
    traites,
    contacts_crees: importes,
    restant_a_promouvoir: apres[0]?.n ?? 0,
    duree_s: Math.round((Date.now() - debut) / 100) / 10,
    apercu: detail.slice(0, 10),
  })
}

export const GET = wrapCron('promote-leads', handler, 30)
