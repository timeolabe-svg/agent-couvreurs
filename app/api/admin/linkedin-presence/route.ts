import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * COMBIEN DE CES ENTREPRISES SONT SUR LINKEDIN ? — mesuré sans jamais ouvrir LinkedIn.
 *
 * ⚠️ POURQUOI ON NE VA PAS LE DEMANDER À LINKEDIN DIRECTEMENT. Chercher 3 000 entreprises sur
 * LinkedIn, c'est 3 000 consultations en rafale : c'est très exactement le comportement qui a fait
 * restreindre le compte le 03/08 (la cause était le VOLUME DE VISITES, pas les invitations).
 * LinkedIn sanctionne un comportement, pas une identité — le faire depuis le compte du client
 * revient à mettre son compte à lui en jeu, et c'est son outil de travail.
 *
 * Méthode retenue : on lit le SITE de l'entreprise, qu'on possède déjà, et on y cherche les liens
 * sortants vers LinkedIn. Une entreprise qui tient un LinkedIn le met presque toujours dans son
 * pied de page. C'est gratuit, invisible pour LinkedIn, et ça répond à la question posée.
 *
 * ⚠️ CE QUE CETTE MESURE NE DIT PAS, et il faut le dire avant de donner le chiffre : une entreprise
 * peut avoir un LinkedIn sans le mettre sur son site. Le chiffre obtenu est donc un PLANCHER, pas
 * une vérité. On ne le présentera jamais comme « X % sont sur LinkedIn », mais comme « au moins X % ».
 *
 * Distinction importante : page ENTREPRISE (linkedin.com/company/...) ou profil PERSONNEL
 * (linkedin.com/in/...). C'est le second qui compte : on veut le dirigeant, pas une page vitrine
 * que personne ne consulte.
 *
 * Usage : ?batch=40 (traite 40 sites), à répéter. ?stats=1 pour le cumul.
 */

const TIMEOUT_MS = 6000
const BUDGET_MS = 45000

interface Trouvaille {
  company: string[]
  personal: string[]
}

function extraireLiens(html: string): Trouvaille {
  const company = new Set<string>()
  const personal = new Set<string>()
  const re = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9\-_%.]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}`
    if (m[1].toLowerCase() === 'company') company.add(url)
    else personal.add(url)
    if (company.size + personal.size > 10) break
  }
  return { company: [...company], personal: [...personal] }
}

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')

  await sql`
    CREATE TABLE IF NOT EXISTS linkedin_presence (
      site            TEXT PRIMARY KEY,
      entreprise      TEXT,
      a_page_company  BOOLEAN NOT NULL DEFAULT FALSE,
      a_profil_perso  BOOLEAN NOT NULL DEFAULT FALSE,
      urls            TEXT[],
      erreur          TEXT,
      verifie_le      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  if (req.nextUrl.searchParams.get('stats') === '1') {
    const [s] = (await sql`
      SELECT COUNT(*)::int AS sites_testes,
             COUNT(*) FILTER (WHERE erreur IS NULL)::int AS sites_lus,
             COUNT(*) FILTER (WHERE a_page_company)::int AS avec_page_entreprise,
             COUNT(*) FILTER (WHERE a_profil_perso)::int AS avec_profil_dirigeant,
             COUNT(*) FILTER (WHERE a_page_company OR a_profil_perso)::int AS avec_linkedin
      FROM linkedin_presence
    `) as Array<Record<string, number>>
    const [tot] = (await sql`
      SELECT COUNT(*)::int AS fiches_totales,
             COUNT(*) FILTER (WHERE site IS NOT NULL AND site <> '')::int AS avec_site
      FROM outscraper_leads
    `) as Array<Record<string, number>>
    const lus = Number(s?.sites_lus ?? 0)
    const avec = Number(s?.avec_linkedin ?? 0)
    return NextResponse.json({
      fiches_totales: Number(tot?.fiches_totales ?? 0),
      fiches_avec_site: Number(tot?.avec_site ?? 0),
      sites_testes: Number(s?.sites_testes ?? 0),
      sites_lus_avec_succes: lus,
      avec_linkedin: avec,
      dont_page_entreprise: Number(s?.avec_page_entreprise ?? 0),
      dont_profil_dirigeant: Number(s?.avec_profil_dirigeant ?? 0),
      taux_sur_sites_lus_pct: lus > 0 ? Math.round((avec / lus) * 1000) / 10 : 0,
      /**
       * ⚠️ Deux dénominateurs différents, à ne jamais confondre : le taux ci-dessus porte sur les
       * sites qu'on a réussi à lire, PAS sur le fichier entier. Rapporté au fichier complet (dont
       * 70 % n'ont même pas de site), la proportion réellement joignable sur LinkedIn est bien
       * plus basse. C'est ce dernier chiffre qui décide s'il faut ouvrir le canal.
       */
      projection_sur_fichier_complet: lus > 0 && Number(tot?.fiches_totales ?? 0) > 0
        ? Math.round((avec / lus) * Number(tot?.avec_site ?? 0))
        : 0,
      lecture: 'PLANCHER : on ne détecte que les entreprises qui affichent leur LinkedIn sur leur site. Celles qui en ont un sans le publier ne sont pas comptées.',
    })
  }

  /**
   * ⚠️ LA QUESTION UTILE N'EST PAS « COMBIEN ONT UN LINKEDIN » MAIS « COMBIEN DE CEUX QU'ON NE PEUT
   * PAS JOINDRE PAR MAIL ONT UN LINKEDIN ».
   *
   * Une entreprise déjà démarchée par email n'apporte rien de plus sur LinkedIn : c'est le même
   * prospect, touché deux fois. Le canal ne se justifie que par ce qu'il RAJOUTE. Mesurer sur le
   * fichier entier gonflerait le gisement d'un tiers de gens déjà couverts.
   */
  if (req.nextUrl.searchParams.get('non_contactes') === '1') {
    const [r] = (await sql`
      WITH testes AS (
        SELECT p.site, p.erreur, p.a_page_company, p.a_profil_perso,
               EXISTS (
                 SELECT 1 FROM contacts c
                 JOIN email_queue q ON q.contact_id = c.id
                 WHERE c.website = p.site AND q.sequence_step = 0 AND q.status = 'sent'
               ) AS deja_contacte
        FROM linkedin_presence p
      )
      SELECT
        COUNT(*) FILTER (WHERE erreur IS NULL AND NOT deja_contacte)::int AS sites_lus_non_contactes,
        COUNT(*) FILTER (WHERE erreur IS NULL AND NOT deja_contacte
                           AND (a_page_company OR a_profil_perso))::int   AS avec_linkedin,
        COUNT(*) FILTER (WHERE erreur IS NULL AND NOT deja_contacte
                           AND a_profil_perso)::int                       AS avec_profil_dirigeant,
        COUNT(*) FILTER (WHERE erreur IS NULL AND deja_contacte)::int     AS sites_lus_deja_contactes
      FROM testes
    `) as Array<Record<string, number>>

    // Le gisement total à projeter : fiches jamais démarchées par mail ET qui ont un site.
    const [g] = (await sql`
      SELECT COUNT(*)::int AS non_contactes_avec_site
      FROM outscraper_leads l
      WHERE l.site IS NOT NULL AND l.site <> ''
        AND NOT EXISTS (
          SELECT 1 FROM contacts c
          JOIN email_queue q ON q.contact_id = c.id
          WHERE c.website = l.site AND q.sequence_step = 0 AND q.status = 'sent'
        )
    `) as Array<Record<string, number>>

    const lus = Number(r?.sites_lus_non_contactes ?? 0)
    const avec = Number(r?.avec_linkedin ?? 0)
    const perso = Number(r?.avec_profil_dirigeant ?? 0)
    const gisement = Number(g?.non_contactes_avec_site ?? 0)
    const tx = (n: number) => (lus > 0 ? Math.round((n / lus) * 1000) / 10 : 0)

    return NextResponse.json({
      echantillon: { sites_lus_non_contactes: lus, sites_lus_deja_contactes: Number(r?.sites_lus_deja_contactes ?? 0) },
      dans_l_echantillon: { avec_linkedin: avec, dont_profil_dirigeant: perso },
      taux_pct: { avec_linkedin: tx(avec), profil_dirigeant: tx(perso) },
      gisement_total_non_contactes_avec_site: gisement,
      projection: {
        entreprises_avec_linkedin: Math.round((avec / Math.max(1, lus)) * gisement),
        profils_dirigeant_visibles: Math.round((perso / Math.max(1, lus)) * gisement),
      },
      lecture: 'Projection = taux observé sur l'échantillon appliqué au gisement. PLANCHER pour les profils dirigeants : la plupart ne publient pas leur profil perso sur le site de leur entreprise.',
    })
  }

  if (req.nextUrl.searchParams.get('liste') === '1') {
    const rows = (await sql`
      SELECT entreprise, site, a_page_company, a_profil_perso, urls
      FROM linkedin_presence
      WHERE a_page_company OR a_profil_perso
      ORDER BY a_profil_perso DESC
    `) as Array<Record<string, unknown>>
    return NextResponse.json({ n: rows.length, rows })
  }

  const batch = Math.min(60, Math.max(1, parseInt(req.nextUrl.searchParams.get('batch') || '40', 10)))
  const cibles = (await sql`
    SELECT DISTINCT ON (l.site) l.site, l.name
    FROM outscraper_leads l
    WHERE l.site IS NOT NULL AND l.site <> ''
      AND NOT EXISTS (SELECT 1 FROM linkedin_presence p WHERE p.site = l.site)
    LIMIT ${batch}
  `) as Array<{ site: string; name: string }>

  const debut = Date.now()
  let lus = 0, avecLinkedin = 0, erreurs = 0

  for (const c of cibles) {
    if (Date.now() - debut > BUDGET_MS) break
    const url = c.site.startsWith('http') ? c.site : `https://${c.site}`
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HdigiwebBot/1.0)' },
      })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const html = (await r.text()).slice(0, 400_000)
      const t = extraireLiens(html)
      const trouve = t.company.length > 0 || t.personal.length > 0
      if (trouve) avecLinkedin++
      lus++
      await sql`
        INSERT INTO linkedin_presence (site, entreprise, a_page_company, a_profil_perso, urls, erreur)
        VALUES (${c.site}, ${c.name}, ${t.company.length > 0}, ${t.personal.length > 0},
                ${[...t.company, ...t.personal]}, NULL)
        ON CONFLICT (site) DO UPDATE SET
          a_page_company = EXCLUDED.a_page_company,
          a_profil_perso = EXCLUDED.a_profil_perso,
          urls = EXCLUDED.urls, erreur = NULL, verifie_le = NOW()
      `
    } catch (e) {
      erreurs++
      // ⚠️ On TRACE l'échec au lieu de sauter la ligne : un site injoignable n'est pas une
      // entreprise sans LinkedIn. Les confondre ferait baisser le taux sans qu'on le sache.
      await sql`
        INSERT INTO linkedin_presence (site, entreprise, erreur)
        VALUES (${c.site}, ${c.name}, ${String(e).slice(0, 120)})
        ON CONFLICT (site) DO UPDATE SET erreur = EXCLUDED.erreur, verifie_le = NOW()
      `.catch(() => {})
    }
  }

  return NextResponse.json({
    traites: lus + erreurs,
    sites_lus: lus,
    avec_linkedin: avecLinkedin,
    injoignables: erreurs,
    reste_a_traiter: cibles.length === batch ? 'oui' : 'dernier lot',
  })
}
