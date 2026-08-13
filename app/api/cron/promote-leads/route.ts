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
   * ⚠️ 12 s et non 22 : ce cron fait DEUX choses, et la seconde est indispensable.
   *
   * Promouvoir un lead crée un contact dont l'adresse n'est PAS encore validée. Or le moteur
   * d'envoi exige `email_validated = true` avant d'écrire à qui que ce soit. Les contacts créés ici
   * resteraient donc bloqués juste avant l'envoi — le même chaînon manquant que celui qu'on vient
   * de réparer, déplacé d'un cran.
   *
   * `validate-emails` a bien son propre cron dans le code, avec battement… mais rien ne l'appelait
   * non plus sur cron-job.org. Plutôt que de réclamer une quatrième tâche à Timéo, on enchaîne :
   * ~12 s de promotion puis une passe de validation (~12 s), soit ~24 s, sous la coupe des 30 s.
   *
   * Débits obtenus, à cadence de 30 min : ~10 leads promus et 5 adresses validées par passage,
   * soit ~480 et ~240 par jour. La validation suit la promotion (35 % des leads donnent un email),
   * donc aucune des deux files ne s'accumule.
   */
  const BUDGET_MS = 12_000

  const { sql } = await import('@/lib/db')
  const restant = (await sql`
    SELECT COUNT(*)::int AS n FROM outscraper_leads WHERE status = 'new'
  `) as Array<{ n: number }>

  if (!restant[0]?.n) {
    return NextResponse.json({ ok: true, traites: 0, importes: 0, restant: 0, note: 'aucun lead à promouvoir' })
  }

  /**
   * On réutilise l'endpoint existant plutôt que d'en dupliquer la logique : sa gestion du scraping
   * d'email, de la blocklist, des doublons et de la mise en file est déjà éprouvée, et la dupliquer
   * garantirait qu'une des deux copies dérive — c'est exactement ce qui est arrivé au pied de page
   * légal, corrigé deux fois au même endroit.
   */
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  const cle = process.env.CRON_SECRET ?? ''

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

  /**
   * SECONDE MOITIÉ DU CYCLE : valider les adresses des contacts fraîchement créés.
   * Sans cette passe, ils restent visibles en base mais ne partent jamais — le moteur refuse
   * d'écrire à une adresse non validée. Un échec ici ne doit PAS faire échouer la promotion :
   * les leads promus le restent, la validation reprendra au passage suivant.
   */
  let validation: unknown = 'non lancée (budget épuisé)'
  if (Date.now() - debut < 16_000) {
    const v = await fetch(`${base}/api/cron/validate-emails?key=${encodeURIComponent(cle)}`, {
      headers: { 'user-agent': 'promote-leads-cron' },
    }).catch(() => null)
    validation = v && v.ok
      ? await v.json().catch(() => 'réponse illisible')
      : `échec (${v?.status ?? 'injoignable'})`
  }

  return NextResponse.json({
    ok: true,
    traites,
    contacts_crees: importes,
    restant_a_promouvoir: apres[0]?.n ?? 0,
    validation,
    duree_s: Math.round((Date.now() - debut) / 100) / 10,
    apercu: detail.slice(0, 10),
  })
}

export const GET = wrapCron('promote-leads', handler, 30)
