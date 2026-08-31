import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { pingHeartbeat } from '@/lib/heartbeat'
import { alertIndependent } from '@/lib/alert'
import { METIERS_CIBLES, aliasDe } from '@/app/api/admin/plan-couverture/route'
import { regionDuDepartement } from '@/lib/regions'
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

/**
 * TAILLE DU LOT, PAR MÉTIER — consigne de Timéo (27/08).
 *
 * « Pour les couvreurs on demande 15 villes en même temps, mais pour les 2 autres seulement 5 par 5
 * car ça ne sert à rien de faire plus. »
 *
 * Le raisonnement est juste : ce qui coûte, ce n'est pas la requête, c'est la fiche trouvée. Un lot
 * de quinze villes de terrassiers rapporterait à peine plus qu'un lot de cinq, tout en immobilisant
 * le budget du jour. On calibre donc le lot sur la densité du métier.
 */
const TAILLE_LOT_PAR_METIER: Record<string, number> = { couvreur: 15, terrassier: 5, pisciniste: 5 }
const TAILLE_LOT_DEFAUT = 5

/**
 * ⚠️ L'ESTIMATION DE COÛT BLOQUAIT SUR UN CHIFFRE IMAGINAIRE.
 *
 * Elle supposait 500 fiches par ville — le maximum DEMANDÉ à l'API. Mesuré sur les 7 962 fiches
 * déjà achetées : une ville en rapporte **2 à 4** (couvreur 3,7 · pisciniste 2,3 · terrassier 2,1).
 * L'estimation était donc environ cent cinquante fois trop haute, et un lot de quinze villes était
 * annoncé à 22,50 $ — au-dessus du plafond de 10 $/jour, donc refusé, alors que la dépense réelle
 * aurait été de quelques centimes.
 *
 * Un garde-fou qui bloque sur une valeur fausse ne protège de rien : il empêche seulement de
 * travailler, et on finit par le désactiver — ce qui supprime la vraie protection.
 *
 * On estime donc sur le rendement OBSERVÉ, avec une marge de sécurité large (×5 environ) pour
 * couvrir les grandes villes. Les deux vraies protections restent intactes : le plafond compare
 * cette estimation à la dépense RÉELLE déjà enregistrée, et `LIMITE_PAR_VILLE` borne toujours la
 * requête à 500 fiches par ville quoi qu'il arrive.
 */
const ESTIMATION_FICHES_PAR_VILLE = Number(process.env.ACHAT_ESTIMATION_FICHES_PAR_VILLE ?? 20)

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
  /**
   * ⚠️ SI LE MÉTIER DU CYCLE N'A PLUS DE VILLE, ON PASSE AU SUIVANT — sinon la couverture complète
   * d'un métier bloquerait les deux autres, et la machine tournerait à vide en disant « terminé ».
   */
  const position = await positionRotation(q)
  let metier = METIERS_CIBLES.find(m => m.sector === (metierDemande ?? metierDuCycle(position)))
    ?? METIERS_CIBLES[0]
  if (!metierDemande) {
    for (let pas = 0; pas < CYCLE_METIERS.length; pas++) {
      const candidat = METIERS_CIBLES.find(m => m.sector === metierDuCycle(position + pas))
      if (!candidat) continue
      const [reste] = (await sql`
        SELECT 1 AS x FROM villes_scraping v
        WHERE NOT EXISTS (
          SELECT 1 FROM scrape_couverture sc
          WHERE LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = ANY(${aliasDe(candidat.categorie_google)})
        ) LIMIT 1
      `) as Array<{ x: number }>
      if (reste) { metier = candidat; break }
    }
  }

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
  const candidatsDept = (await sql`
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
    SELECT r.departement, r.villes_restantes, COALESCE(d.villes_faites, 0) AS villes_faites,
           r.population_restante
    FROM restant r LEFT JOIN deja d ON d.departement = r.departement
    WHERE (${deptDemande}::text IS NULL OR r.departement = ${deptDemande})
    -- 1) le département déjà entamé passe devant ; le classement par région se fait ensuite en JS.
    ORDER BY (COALESCE(d.villes_faites, 0) > 0) DESC, COALESCE(d.villes_faites, 0) DESC,
             r.population_restante DESC NULLS LAST, r.departement ASC
  `) as Array<{ departement: string; villes_restantes: number; villes_faites: number; population_restante: string }>
  /**
   * ⚠️ ON ACHÈTE LÀ OÙ ÇA RÉPOND, PAS LÀ OÙ IL Y A DU MONDE (31/08).
   *
   * Le classement se faisait à la population. Le prochain lot partait donc dans le Rhône —
   * Auvergne-Rhône-Alpes, poids appris 0,107, la région qui convertit le MOINS de toutes. On
   * s'apprêtait à payer des fiches là où on sait déjà qu'elles répondent le moins.
   *
   * L'auto-apprentissage note pourtant chaque région d'après ce qu'elle rapporte : l'information
   * existait, le choix du département l'ignorait. On la lit désormais, en gardant la règle
   * précédente devant — un département commencé se finit avant d'en ouvrir un autre.
   */
  const poidsRegion: Record<string, number> = await (async () => {
    try {
      const r = (await sql`SELECT value FROM agent_config WHERE key = 'exp_region_weights'`) as Array<{ value: string }>
      return JSON.parse(r[0]?.value ?? '{}') as Record<string, number>
    } catch {
      // Pas de poids appris encore : on retombe sur le classement par population, sans rien casser.
      return {}
    }
  })()

  const deptChoisi = candidatsDept.sort((a, b) => {
    // Un chantier ouvert se termine : cette règle passe avant la performance.
    if ((a.villes_faites > 0) !== (b.villes_faites > 0)) return a.villes_faites > 0 ? -1 : 1
    const pa = poidsRegion[regionDuDepartement(a.departement) ?? ''] ?? 0.5
    const pb = poidsRegion[regionDuDepartement(b.departement) ?? ''] ?? 0.5
    if (pa !== pb) return pb - pa
    return Number(b.population_restante) - Number(a.population_restante)
  })[0]


  const lot = deptChoisi ? (await sql`
    SELECT v.code_insee, v.nom, v.departement, v.population
    FROM villes_scraping v
    WHERE v.departement = ${deptChoisi.departement}
      AND NOT EXISTS (
        SELECT 1 FROM scrape_couverture sc
        WHERE LOWER(sc.ville) = LOWER(v.nom) AND LOWER(sc.categorie) = ANY(${aliasDe(metier.categorie_google)})
      )
    ORDER BY v.population DESC NULLS LAST, v.code_insee ASC
    LIMIT ${TAILLE_LOT_PAR_METIER[metier.sector] ?? TAILLE_LOT_DEFAUT}
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
  // Estimation sur le rendement OBSERVE (cf. la note sur ESTIMATION_FICHES_PAR_VILLE), plus le
  // maximum theorique garde a titre indicatif — pour que l ecart reste visible dans l apercu.
  const coutEstime = (lot.length * ESTIMATION_FICHES_PAR_VILLE * PRIX_POUR_MILLE_USD) / 1000
  const coutMaximumTheorique = (lot.length * LIMITE_PAR_VILLE * PRIX_POUR_MILLE_USD) / 1000
  const requetes = lot.map(v => `${metier.categorie_google}, ${v.nom}, France`)
  const d = await depenses(q)
  const arret = await lireArret(q)

  const apercu = {
    metier: metier.sector,
    categorie_google: metier.categorie_google,
    // On expose le département retenu et son AVANCEMENT : c'est la seule façon de vérifier d'un
    // coup d'œil qu'on finit bien une zone avant d'en ouvrir une autre.
    // Où en est-on dans le cycle 70/15/15 ? Sans ça, impossible de vérifier que la répartition
    // tient : on verrait passer des couvreurs sans savoir si c'est le tour prévu ou une dérive.
    rotation: `achat n°${position % CYCLE_METIERS.length + 1}/20 du cycle — 70 % couvreur, 15 % terrassier, 15 % pisciniste`,
    departement: deptChoisi
      ? `${deptChoisi.departement} — ${deptChoisi.villes_faites} ville(s) déjà couverte(s), ${deptChoisi.villes_restantes} restante(s)`
      : '(aucun département restant)',
    villes: lot.map(v => `${v.nom} (${v.departement}, ${v.population.toLocaleString('fr-FR')} hab)`),
    requetes,
    limite_par_ville: LIMITE_PAR_VILLE,
    taille_du_lot: lot.length,
    cout_estime_usd: Number(coutEstime.toFixed(2)),
    cout_maximum_theorique_usd: Number(coutMaximumTheorique.toFixed(2)),
    base_estimation: `${ESTIMATION_FICHES_PAR_VILLE} fiches/ville (mesure reelle : 2 a 4)`,
    depense_jour_usd: Number(d.jour.toFixed(2)),
    depense_mois_usd: Number(d.mois.toFixed(2)),
    plafonds_usd: { jour: PLAFOND_JOUR_USD, mois: PLAFOND_MOIS_USD },
    arret_urgence: arret.arrete ? arret.motif : null,
    /**
     * ⚠️ « POSÉE » NE VEUT PAS DIRE « LUE ». `vercel env add` stocke une valeur vide en silence sous
     * Windows, et `vercel env pull` renvoie vide même pour un secret qui fonctionne : seul le
     * RUNTIME dit la vérité. On expose donc un booléen — jamais la valeur — pour pouvoir vérifier
     * d'un appel que la clé est réellement disponible côté serveur.
     */
    cle_outscraper_lue_par_le_runtime: Boolean(process.env.OUTSCRAPER_API_KEY),
    achat_reel_actif: process.env.ACHAT_LEADS_ACTIF === '1',
  }

  if (!reel) {
    await pingHeartbeat('achat-leads', true, `simulation ${metier.sector}`, 60)
    return NextResponse.json({
      ok: true, simulation: true, ...apercu,
      lecture: 'Aucune dépense. Ajouter ?reel=1 (et ACHAT_LEADS_ACTIF=1) pour que cette commande parte vraiment.',
    })
  }

  const vert = await feuVert(q, coutEstime)
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
  /**
   * ⚠️ LA ROTATION N'AVANCE QU'ICI, après un lancement RÉUSSI.
   *
   * Si on l'avançait au moment de choisir le métier, chaque simulation décalerait le cycle — et
   * comme je simule beaucoup, la répartition 70/15/15 dériverait sans que rien ne le signale. Une
   * commande qui échoue ne consomme pas non plus son tour : le métier prévu repassera au prochain
   * essai.
   */
  await avancerRotation(q)

  await pingHeartbeat('achat-leads', true, `job ${requestId} lance`, 60)
  return NextResponse.json({
    ok: true, lance: true, request_id: requestId, ...apercu,
    lecture: 'Le job tourne chez Outscraper. Le prochain passage viendra le récolter, importer les fiches et enregistrer le coût réel.',
  })
}

/**
 * RÉPARTITION DES ACHATS ENTRE MÉTIERS — 70 % couvreur, 15 % terrassier, 15 % pisciniste.
 *
 * Consigne de Timéo (27/08). Avant, `prochainMetierParDefaut` renvoyait toujours le premier métier
 * de la liste : la machine n'achetait QUE des couvreurs, et les deux autres n'existaient qu'en
 * passant `?metier=` à la main.
 *
 * ⚠️ PAS DE TIRAGE AU SORT. Un hasard à 70/15/15 peut donner huit couvreurs d'affilée, ou trois
 * piscinistes de suite, et personne ne peut vérifier si c'est normal ou si c'est un bug. Ici la
 * séquence est ÉCRITE : sur vingt achats, exactement quatorze couvreurs, trois terrassiers, trois
 * piscinistes — et Timéo peut lire la position courante à tout moment.
 *
 * Les deux minoritaires sont RÉPARTIS dans le cycle (positions 3, 6, 10, 13, 16, 19) et non groupés
 * à la fin : sinon les terrassiers n'arriveraient qu'après quatorze achats, soit deux semaines.
 */
const CYCLE_METIERS: string[] = (() => {
  const c = Array<string>(20).fill('couvreur')
  c[3] = 'terrassier'; c[10] = 'terrassier'; c[16] = 'terrassier'
  c[6] = 'pisciniste'; c[13] = 'pisciniste'; c[19] = 'pisciniste'
  return c
})()

/** Position courante dans le cycle, SANS l'avancer (la simulation ne doit rien décaler). */
async function positionRotation(sql: Sql): Promise<number> {
  const r = (await sql`SELECT valeur FROM achat_config WHERE cle = 'rotation_metier'`
    .catch(() => [])) as Array<{ valeur: string }>
  return Number(r[0]?.valeur ?? 0)
}

/** Avance d'un cran — appelé UNIQUEMENT après un lancement réel. */
async function avancerRotation(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO achat_config (cle, valeur, pose_le) VALUES ('rotation_metier', '1', now())
    ON CONFLICT (cle) DO UPDATE SET
      valeur = ((COALESCE(NULLIF(achat_config.valeur, ''), '0')::bigint + 1))::text, pose_le = now()
  `.catch(() => {})
}

function metierDuCycle(position: number): string {
  return CYCLE_METIERS[((position % CYCLE_METIERS.length) + CYCLE_METIERS.length) % CYCLE_METIERS.length]
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
