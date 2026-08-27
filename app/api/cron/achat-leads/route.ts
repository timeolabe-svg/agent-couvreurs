import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import { alertIndependent } from '@/lib/alert'
import { METIERS_CIBLES, aliasDe } from '@/app/api/admin/plan-couverture/route'
import {
  assurerTablesAchat, feuVert, lancerJob, recolterJob, estDuMetier, detecterAnomalies,
  poserArret, lireArret, depenses, FicheOutscraper, Sql,
  LIMITE_PAR_VILLE, PRIX_POUR_MILLE_USD, PLAFOND_JOUR_USD, PLAFOND_MOIS_USD,
} from '@/lib/outscraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * L'ACHAT AUTOMATIQUE DE LEADS — un passage lance, le passage suivant récolte.
 *
 * Par défaut ce cron NE DÉPENSE RIEN : il dit ce qu'il achèterait et ce que ça coûterait.
 * Il faut trois choses réunies pour qu'un euro parte : `?reel=1` dans l'appel, `ACHAT_LEADS_ACTIF=1`
 * en variable d'environnement, et aucun arrêt d'urgence posé en base.
 *
 * ⚠️ POURQUOI DEUX PASSAGES ET PAS UN.
 * L'ordonnanceur coupe à 30 secondes. Un scraping de quatre villes prend plusieurs minutes. Lancer
 * et attendre dans le même appel, c'est se faire couper APRÈS le paiement et AVANT l'import : on
 * aurait payé un fichier qu'on n'aurait jamais lu. Le premier passage lance et enregistre
 * l'identifiant du job ; les passages suivants viennent voir s'il est prêt.
 *
 * ⚠️ UNE VILLE À ZÉRO FICHE N'EST JAMAIS MARQUÉE « FAITE ».
 * Zéro fiche peut vouloir dire « il n'y a pas de couvreur ici » ou « l'API a eu un incident ». Les
 * deux se ressemblent exactement. Marquer à tort, c'est perdre les leads de cette ville POUR
 * TOUJOURS, sans jamais le savoir. On la laisse donc revenir ; ce n'est qu'au deuxième zéro qu'on
 * la classe « épuisée ».
 */

const TAILLE_LOT = 4

interface Ville { code_insee: string; nom: string; departement: string; population: number }

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { sql } = await import('@/lib/db')
  const q = sql as unknown as Sql
  await assurerTablesAchat(q)

  const reel = req.nextUrl.searchParams.get('reel') === '1'
  const metierDemande = req.nextUrl.searchParams.get('metier')

  // ── 1. Une commande attend-elle d'être récoltée ? ────────────────────────────
  const enCours = (await sql`
    SELECT id, request_id, metier, categorie, villes
    FROM achat_commandes
    WHERE statut = 'en_cours' AND simulation = FALSE
    ORDER BY lancee_le ASC LIMIT 1
  `) as Array<{ id: number; request_id: string; metier: string; categorie: string; villes: Ville[] }>

  if (enCours[0]) {
    return NextResponse.json(await recolter(q, enCours[0]))
  }

  // ── 2. Rien en cours : préparer le prochain lot ──────────────────────────────
  const metier = METIERS_CIBLES.find(m => m.sector === (metierDemande ?? prochainMetierParDefaut()))
    ?? METIERS_CIBLES[0]

  /**
   * ⚠️ DÉPARTEMENT PAR DÉPARTEMENT — consigne explicite de Timéo (27/08), et le code faisait
   * l'inverse.
   *
   * Il triait par `population DESC` sur TOUTE LA FRANCE : le lot suivant partait donc à Paris, puis
   * Marseille, puis Lyon, en sautant d'un département à l'autre. Aucun département n'était jamais
   * terminé, et c'est exactement ce que Timéo fait à la main pour une bonne raison : **un
   * département couvert en entier, c'est une zone où le client peut réellement travailler** ; vingt
   * départements couverts au tiers, c'est de l'argent dépensé sans zone exploitable.
   *
   * La règle appliquée ici, dans l'ordre :
   *   1. on FINIT le département déjà commencé (le plus avancé d'abord) — jamais deux chantiers
   *      ouverts en même temps ;
   *   2. s'il n'y en a aucun, on ouvre le département le plus peuplé ;
   *   3. dans le département retenu, on prend les plus grandes villes d'abord.
   *
   * ⚠️ `?departement=31` force un département précis : quand Timéo sait où son client veut aller,
   * la machine ne doit pas décider à sa place.
   */
  const deptDemande = req.nextUrl.searchParams.get('departement')
  const [deptChoisi] = (await sql`
    WITH restant AS (
      SELECT v.departement,
             COUNT(*)::int AS villes_restantes,
             SUM(v.population)::bigint AS population_restante
      FROM villes_scraping v
      WHERE NOT EXISTS (
        SELECT 1 FROM scrape_couverture sc
        WHERE LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = ANY(${aliasDe(metier.categorie_google)})
      )
      GROUP BY v.departement
    ),
    deja AS (
      SELECT v.departement, COUNT(*)::int AS villes_faites
      FROM villes_scraping v
      JOIN scrape_couverture sc
        ON LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = ANY(${aliasDe(metier.categorie_google)})
      GROUP BY v.departement
    )
    SELECT r.departement, r.villes_restantes, COALESCE(d.villes_faites, 0) AS villes_faites
    FROM restant r LEFT JOIN deja d ON d.departement = r.departement
    WHERE (${deptDemande}::text IS NULL OR r.departement = ${deptDemande})
    -- 1) le département déjà entamé passe devant  2) sinon le plus peuplé
    ORDER BY (COALESCE(d.villes_faites, 0) > 0) DESC, COALESCE(d.villes_faites, 0) DESC,
             r.population_restante DESC NULLS LAST, r.departement ASC
    LIMIT 1
  `) as Array<{ departement: string; villes_restantes: number; villes_faites: number }>

  const lot = deptChoisi ? (await sql`
    SELECT v.code_insee, v.nom, v.departement, v.population
    FROM villes_scraping v
    WHERE v.departement = ${deptChoisi.departement}
      AND NOT EXISTS (
        SELECT 1 FROM scrape_couverture sc
        WHERE LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = ANY(${aliasDe(metier.categorie_google)})
      )
    ORDER BY v.population DESC NULLS LAST, v.code_insee ASC
    LIMIT ${TAILLE_LOT}
  `) as Ville[] : []

  if (lot.length === 0) {
    await pingHeartbeat('achat-leads', true, `${metier.sector} : couverture complète`, 60)
    return NextResponse.json({ ok: true, metier: metier.sector, message: 'plus aucune ville à couvrir pour ce métier' })
  }

  /**
   * ⚠️ LE COÛT EST ESTIMÉ AU PIRE CAS, pas au cas probable. On demande 500 fiches par ville : le
   * plafond doit être testé contre ce que la commande coûterait si Outscraper les trouvait toutes.
   * Estimer au « probable » revient à autoriser une dépense qu'on n'a pas budgétée.
   */
  const coutMaximum = (lot.length * LIMITE_PAR_VILLE * PRIX_POUR_MILLE_USD) / 1000
  const requetes = lot.map(v => `${metier.categorie_google}, ${v.nom}, France`)
  const d = await depenses(q)
  const arret = await lireArret(q)

  const apercu = {
    metier: metier.sector,
    categorie_google: metier.categorie_google,
    // On expose le département retenu et son AVANCEMENT : c'est la seule façon de vérifier d'un
    // coup d'œil qu'on finit bien une zone avant d'en ouvrir une autre.
    departement: deptChoisi
      ? `${deptChoisi.departement} — ${deptChoisi.villes_faites} ville(s) déjà couverte(s), ${deptChoisi.villes_restantes} restante(s)`
      : '(aucun département restant)',
    villes: lot.map(v => `${v.nom} (${v.departement}, ${v.population.toLocaleString('fr-FR')} hab)`),
    requetes,
    limite_par_ville: LIMITE_PAR_VILLE,
    cout_maximum_estime_usd: Number(coutMaximum.toFixed(2)),
    depense_jour_usd: Number(d.jour.toFixed(2)),
    depense_mois_usd: Number(d.mois.toFixed(2)),
    plafonds_usd: { jour: PLAFOND_JOUR_USD, mois: PLAFOND_MOIS_USD },
    arret_urgence: arret.arrete ? arret.motif : null,
  }

  if (!reel) {
    await pingHeartbeat('achat-leads', true, `simulation ${metier.sector}`, 60)
    return NextResponse.json({
      ok: true, simulation: true, ...apercu,
      lecture: 'Aucune dépense. Ajouter ?reel=1 (et ACHAT_LEADS_ACTIF=1) pour que cette commande parte vraiment.',
    })
  }

  const vert = await feuVert(q, coutMaximum)
  if (!vert.ok) {
    await pingHeartbeat('achat-leads', true, `bloque : ${vert.raison}`, 60)
    return NextResponse.json({ ok: false, achat_bloque: vert.raison, ...apercu })
  }

  let requestId: string
  try {
    ;({ requestId } = await lancerJob(requetes, LIMITE_PAR_VILLE))
  } catch (e) {
    /**
     * ⚠️ UN ÉCHEC AU LANCEMENT NE MARQUE AUCUNE VILLE. Si on notait la couverture avant de savoir
     * si le job est parti, une panne d'API effacerait silencieusement des villes du plan.
     */
    await pingHeartbeat('achat-leads', false, String(e).slice(0, 120), 60)
    return NextResponse.json({ ok: false, erreur_lancement: String(e).slice(0, 200), ...apercu }, { status: 502 })
  }

  await sql`
    INSERT INTO achat_commandes (request_id, metier, categorie, villes, statut)
    VALUES (${requestId}, ${metier.sector}, ${metier.categorie_google}, ${JSON.stringify(lot)}::jsonb, 'en_cours')
  `
  await pingHeartbeat('achat-leads', true, `job ${requestId} lance`, 60)
  return NextResponse.json({
    ok: true, lance: true, request_id: requestId, ...apercu,
    lecture: 'Le job tourne chez Outscraper. Le prochain passage viendra le récolter, importer les fiches et enregistrer le coût réel.',
  })
}

function prochainMetierParDefaut(): string {
  return METIERS_CIBLES[0].sector
}

/**
 * RÉCOLTE : lire le job, filtrer, importer, mesurer, et arrêter au moindre signe étrange.
 */
async function recolter(
  q: Sql,
  cmd: { id: number; request_id: string; metier: string; categorie: string; villes: Ville[] },
): Promise<Record<string, unknown>> {

  let res: Awaited<ReturnType<typeof recolterJob>>
  try {
    res = await recolterJob(cmd.request_id)
  } catch (e) {
    await pingHeartbeat('achat-leads', false, String(e).slice(0, 120), 60)
    return { ok: false, request_id: cmd.request_id, erreur_recolte: String(e).slice(0, 200) }
  }

  if (!res.pret) {
    await pingHeartbeat('achat-leads', true, `job ${cmd.request_id} en cours`, 60)
    return { ok: true, request_id: cmd.request_id, statut: 'le job tourne encore chez Outscraper' }
  }
  if ('echec' in res) {
    await q`UPDATE achat_commandes SET statut = 'echec', anomalie = ${res.echec}, terminee_le = NOW() WHERE id = ${cmd.id}`
    await alertIndependent(
      'Achat de leads : le job Outscraper a echoue',
      `Commande ${cmd.request_id} (${cmd.metier}) : ${res.echec}\nAucune ville n'a ete marquee couverte, le lot repassera.`,
    )
    return { ok: false, request_id: cmd.request_id, echec: res.echec }
  }

  const brutes = res.fiches
  const duMetier = brutes.filter(f => estDuMetier(f, cmd.categorie))
  const horsMetier = brutes.length - duMetier.length

  // ── Import via le chemin déjà éprouvé (upsert, promotion 20 avis, dédup contacts) ──
  const base = (process.env.PUBLIC_APP_URL || 'https://agent-couvreurs.vercel.app').replace(/\/+$/, '')
  let importe = { inserts: 0, doublons_rafraichis: 0, deja_en_base: 0, recus: 0 }
  if (duMetier.length > 0) {
    const r = await fetch(`${base}/api/admin/import-outscraper?key=${process.env.CRON_SECRET ?? ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: duMetier.map(versLigneImport(cmd)), sector: cmd.metier, category: cmd.categorie }),
      signal: AbortSignal.timeout(30_000),
    })
    if (r.ok) importe = await r.json()
  }
  const doublons = (importe.doublons_rafraichis ?? 0) + (importe.deja_en_base ?? 0)
  const nouveaux = importe.inserts ?? 0
  const coutReel = (brutes.length * PRIX_POUR_MILLE_USD) / 1000

  // ── Anomalies : on arrête AVANT le prochain achat, pas après ─────────────────
  const anomalies = detecterAnomalies({
    fiches: brutes, horsMetier, doublons, villesDemandees: cmd.villes.length,
  })

  await q`
    UPDATE achat_commandes
    SET statut = ${anomalies.length > 0 ? 'anomalie' : 'terminee'},
        fiches = ${brutes.length}, nouveaux = ${nouveaux}, doublons = ${doublons},
        hors_metier = ${horsMetier}, cout_usd = ${coutReel},
        anomalie = ${anomalies.length > 0 ? anomalies.join(' | ') : null},
        terminee_le = NOW()
    WHERE id = ${cmd.id}
  `

  // ── Couverture : uniquement ce qu'on a réellement obtenu ─────────────────────
  const coutParVille = cmd.villes.length > 0 ? coutReel / cmd.villes.length : 0
  const marquees: string[] = []
  const laissees: string[] = []
  for (const v of cmd.villes) {
    const fichesVille = duMetier.filter(f => estDeLaVille(f, v)).length

    if (fichesVille === 0) {
      /**
       * ⚠️ ZÉRO FICHE : ON NE MARQUE PAS. On compte les tentatives ; au deuxième zéro consécutif,
       * la ville est classée « épuisée » (elle n'a vraiment rien pour ce métier). Un seul zéro peut
       * être un incident d'API, et un incident ne doit pas coûter une ville pour toujours.
       */
      const [{ n }] = (await q`
        SELECT COUNT(*)::int AS n FROM achat_commandes
        WHERE statut IN ('terminee','anomalie') AND categorie = ${cmd.categorie}
          AND villes @> ${JSON.stringify([{ code_insee: v.code_insee }])}::jsonb
      `) as Array<{ n: number }>
      if (n >= 2) {
        await q`
          INSERT INTO scrape_couverture (categorie, ville, fiches, statut, code_insee, cout_usd, commande_id, nouveaux, doublons)
          VALUES (${cmd.categorie}, ${v.nom}, 0, 'epuise', ${v.code_insee}, ${coutParVille}, ${cmd.request_id}, 0, 0)
          ON CONFLICT (categorie, ville) DO NOTHING
        `
        marquees.push(`${v.nom} (épuisée après ${n} passages à zéro)`)
      } else {
        laissees.push(`${v.nom} (0 fiche, tentative ${n} : elle repassera)`)
      }
      continue
    }

    await q`
      INSERT INTO scrape_couverture (categorie, ville, fiches, statut, code_insee, cout_usd, commande_id, nouveaux, doublons)
      VALUES (${cmd.categorie}, ${v.nom}, ${fichesVille}, 'fait', ${v.code_insee}, ${coutParVille}, ${cmd.request_id}, ${nouveaux}, ${doublons})
      ON CONFLICT (categorie, ville) DO UPDATE SET
        fiches = EXCLUDED.fiches, statut = 'fait', code_insee = EXCLUDED.code_insee,
        cout_usd = EXCLUDED.cout_usd, commande_id = EXCLUDED.commande_id
    `
    marquees.push(`${v.nom} (${fichesVille} fiches)`)
  }

  if (anomalies.length > 0) {
    await poserArret(q, `commande ${cmd.request_id} : ${anomalies.join(' | ')}`)
    await alertIndependent(
      'Achat de leads STOPPE : anomalie detectee',
      [
        `Commande ${cmd.request_id} — ${cmd.metier} (${cmd.categorie})`,
        `Villes : ${cmd.villes.map(v => v.nom).join(', ')}`,
        `Fiches recues : ${brutes.length} | du metier : ${duMetier.length} | nouvelles : ${nouveaux} | doublons : ${doublons}`,
        `Cout estime : ${coutReel.toFixed(2)} USD`,
        '',
        'ANOMALIES :',
        ...anomalies.map(a => `  - ${a}`),
        '',
        "Tout achat est suspendu. Pour reprendre : DELETE FROM achat_config WHERE cle = 'arret'.",
      ].join('\n'),
    )
  }

  await pingHeartbeat('achat-leads', true, `recolte ${brutes.length} fiches, ${anomalies.length} anomalie(s)`, 60)
  return {
    ok: true,
    request_id: cmd.request_id,
    metier: cmd.metier,
    fiches_recues: brutes.length,
    du_metier: duMetier.length,
    hors_metier: horsMetier,
    nouveaux,
    doublons,
    cout_usd: Number(coutReel.toFixed(2)),
    villes_marquees: marquees,
    villes_non_marquees: laissees,
    anomalies,
    achat_suspendu: anomalies.length > 0,
  }
}

/** Une fiche appartient à la ville si Google l'y range, ou à défaut par le code postal du département. */
function estDeLaVille(f: FicheOutscraper, v: Ville): boolean {
  const ville = String(f.city ?? '').toLowerCase().trim()
  if (ville && ville === v.nom.toLowerCase().trim()) return true
  const cp = String(f.postal_code ?? '')
  return Boolean(v.departement) && cp.startsWith(v.departement)
}

function versLigneImport(cmd: { metier: string; categorie: string }) {
  return (f: FicheOutscraper) => ({
    place_id: f.place_id,
    name: f.name,
    site: f.site,
    phone: f.phone,
    city: f.city,
    postal_code: f.postal_code,
    rating: f.rating,
    reviews: f.reviews,
    category: cmd.categorie,
    sector: cmd.metier,
  })
}

export const GET = handler
