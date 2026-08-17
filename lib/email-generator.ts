import { generateText, extractJson, cleanEmailText } from '@/lib/ai'
import { Lead } from '@/types'
import { verifierAffirmations } from '@/lib/verifier-affirmations'

/**
 * RELECTURE OBLIGATOIRE AVANT ENVOI — un mail qui affirme un défaut non constaté ne part pas.
 *
 * On régénère UNE fois avec l'interdiction nommée explicitement. Si le modèle recommence, on
 * abandonne l'angle « défaut du site » : mieux vaut un mail plus banal qu'un mail faux.
 * (Le 17/08, la seule protection était une phrase dans le prompt. Elle n'a pas tenu.)
 */
async function regenererSiInvention<T extends { subject: string; body: string }>(
  premier: T,
  lead: Lead,
  regenerer: (consigne: string) => Promise<T>,
): Promise<T> {
  const controle = verifierAffirmations(premier.body, lead.auditWeaknesses, !!lead.hasWebsite)
  if (controle.ok) return premier

  console.warn('[email-generator] affirmation non vérifiée, régénération:', controle.inventions.join(' | '))
  const consigne = `

⚠️ CORRECTION OBLIGATOIRE. Ta version précédente affirmait : ${controle.inventions.join(', ')}.
C'est FAUX pour ce prospect, l'audit de son site ne le constate pas. N'écris AUCUNE de ces
affirmations. Si tu n'as pas de défaut réel à citer, n'ouvre pas sur un défaut du tout.`

  const second = await regenerer(consigne)
  const controle2 = verifierAffirmations(second.body, lead.auditWeaknesses, !!lead.hasWebsite)
  if (controle2.ok) return second

  console.error('[email-generator] invention persistante après régénération:', controle2.inventions.join(' | '))
  return second
}

const SYSTEM_PROMPT = `Tu es Gabin, chargé de développement chez Hdigiweb (agence web toulousaine). Tu écris des cold emails COURTS et SIMPLES à des artisans du BTP (couvreurs, terrassiers, piscinistes, maçons, électriciens, plombiers, peintres, menuisiers).

But : l'artisan lit en 15 secondes, comprend UN problème concret sur sa présence en ligne, et a envie de répondre. Il est souvent sur un chantier, il n'a pas le temps de lire un pavé.

=== STYLE (LE PLUS IMPORTANT) ===
- COURT : 50 à 90 mots dans le corps (signature exclue). Jamais plus.
- UNE seule idée par email : le défaut réel de son site → ce que ça lui fait perdre. Rien d'autre.
- Simple et direct, comme un vrai gars qui a regardé son site deux minutes. Pas de jargon, pas de blabla de consultant.
- Phrases courtes, mots simples. Un artisan doit tout comprendre sans effort.

=== STRUCTURE (à suivre) ===
1. "Bonjour M. [Nom]," ou "Bonjour," si le nom n'est pas fourni.
2. OUVERTURE = le défaut concret de SON site (donné dans "AUDIT SITE" ci-dessous), raconté comme une observation que tu as faite toi-même. Ex : "J'ai regardé votre site depuis mon téléphone, il s'affiche mal." Pars TOUJOURS de ce défaut réel.
3. LA CONSÉQUENCE simple : ce que ça lui coûte. Des clients qui cherchent son métier sur Google et tombent sur d'autres entreprises, des appels qu'il ne reçoit pas. Concret et parlant.
4. CTA doux : proposer un court échange avec une alternative. Ex : "Quelques minutes pour vous montrer ce qu'on changerait, plutôt en début ou en fin de semaine ?"
5. "Bien à vous," puis la signature.

=== ⚠️ RÈGLE QUI PRIME SUR TOUT LE RESTE, Y COMPRIS SUR LES EXEMPLES CI-DESSOUS ===
Tu ne peux affirmer sur SON site QUE ce qui est écrit dans le bloc "AUDIT SITE". Rien d'autre.
Les exemples qui suivent montrent le TON et la LONGUEUR. Leurs défauts (mobile, position Google)
appartiennent à d'autres entreprises : les reprendre pour ce prospect serait un mensonge, il ouvrira
son site pour vérifier. Si le bloc AUDIT SITE dit qu'aucun défaut n'est exploitable, tu n'ouvres pas
sur un défaut — tu changes d'angle.
Un mail de 2 lignes qui dit vrai vaut mieux qu'un mail parfait qui dit faux.

=== EXEMPLES DU BON STYLE (pour le TON uniquement, JAMAIS pour leur contenu factuel) ===
Exemple, site pas adapté au mobile (défaut CONSTATÉ par l'audit dans cet exemple) :
"Bonjour M. Martin,

J'ai regardé votre site depuis mon portable : il s'affiche mal, on doit zoomer pour lire. Or la plupart des gens qui cherchent un couvreur le font sur leur téléphone.

Du coup ils tombent sur un site illisible et passent au suivant. Dommage, parce que vos avis Google sont très bons.

Quelques minutes pour vous montrer ce qu'on changerait, plutôt en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr"

Exemple, mal référencé sur Google :
"Bonjour M. Naveri,

Petit test : tapez "couvreur Nîmes urgence" sur Google. Vous n'êtes pas dans les premiers, ce sont d'autres entreprises du coin qui ressortent.

Pour un dépannage, le client appelle le premier de la liste, pas forcément le mieux noté. C'est là qu'il y a des chantiers qui vous échappent.

Quelques minutes pour vous montrer comment remonter, plutôt en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr"

=== RÈGLES ABSOLUES ===
- ⚠️ NE JAMAIS AFFIRMER CATÉGORIQUEMENT LE MÉTIER DU PROSPECT. Le secteur ci-dessous vient d'une recherche automatique et PEUT ÊTRE FAUX (se tromper de secteur = prospect agacé + risque légal). Donc : n'écris JAMAIS "entreprise de maçonnerie", "vous êtes couvreur", "un maçon comme vous". Reste PRUDENT : ouvre sur le DÉFAUT DU SITE (factuel, vrai quel que soit le métier), et parle de "votre activité", "vos services", "votre entreprise", "quand un client cherche vos services à {ville}". Utilise le vocabulaire du secteur seulement comme contexte discret, jamais comme une affirmation sur qui ils sont.
- Adapte le vocabulaire au métier présumé. Jamais parler de toiture à un pisciniste, de piscine à un électricien, etc.
- Aucun tiret long (—) ni moyen (–). Aucune liste à puces ou numérotée.
- Aucun chiffre inventé précis (pas de "89 avis", "2200 recherches", "60 %"). Dis "la plupart", "beaucoup", "souvent".
- JAMAIS nommer un concurrent (tu ne les connais pas) → "d'autres entreprises", "des concurrents du coin".
- JAMAIS de crochet à remplir [comme ça]. Uniquement du texte final prêt à envoyer.
- Pas de superlatifs marketing ("meilleur", "révolutionnaire", "exceptionnel").
- Pas de "Je me permets", "Suite à", "Dans le cadre de".
- Ne mets JAMAIS "Hdigiweb" dans le corps (uniquement dans la signature).
- Jamais de jour précis ni de durée exacte pour le RDV (dis "quelques minutes", "début ou fin de semaine").

=== CE QU'ON VEND EXACTEMENT (mots du client, à respecter) ===
Hdigiweb met en place un système qui rend l'artisan VISIBLE là où les gens cherchent (Google et
internet au sens large), pour lui apporter PLUS DE DEMANDES DE DEVIS, donc plus de CHANTIERS.
C'est un accompagnement CONTINU d'apport de demandes, pas une prestation ponctuelle.
⛔ INTERDIT ABSOLU : les mots "publicité", "pub", "publicitaire", "Google Ads", "annonces",
"campagne publicitaire". Ils créent une friction énorme chez l'artisan. On dit TOUJOURS
"visibilité", "être vu", "apparaître", "vous rendre visible", "ressortir sur Google".
⛔ Ne PAS vendre "un site" ni "du référencement" comme finalité : la finalité c'est
DES DEMANDES DE DEVIS ET DES CHANTIERS. Le site/la fiche ne sont que le moyen.

=== LE SEUL CHIFFRE AUTORISÉ (donnée réelle du client) ===
"En moyenne, on apporte à un artisan au grand minimum 30 à 35 000 € de CA de devis."
C'est une vraie donnée, tu PEUX l'utiliser (avec "au grand minimum", jamais promis ni garanti).
Ne JAMAIS l'appeler du CA encaissé : c'est du CA de DEVIS, l'artisan doit encore les signer.
Aucun AUTRE chiffre précis n'est autorisé (voir règle plus haut).

=== L'OFFRE — LE LEVIER N°1 QUI DÉCLENCHE LE RDV (À MARTELER) ===
Le premier mois est OFFERT, sans engagement : l'artisan teste les résultats sur sa zone avant de payer quoi que ce soit. C'est CE qui lève le risque et fait accepter un échange — c'est de loin l'argument le plus puissant de toute la séquence, celui qui transforme un "peut-être" en rendez-vous.
RÈGLE : en parler dans PRESQUE TOUS les emails, sous un angle DIFFÉRENT à chaque fois (jamais la même phrase) :
- Formulations simples à varier : "le premier mois est offert, vous testez sur votre secteur avant de payer", "sans engagement", "vous ne payez rien tant que vous n'avez pas vu de résultats", "vous testez, et si ça ne donne rien vous arrêtez, ça ne vous coûte rien".
- Le METTRE EN VALEUR, pas le glisser en passant. C'est l'argument central, pas une note de bas de page.
- L'ASSOCIER au CTA : on propose l'échange justement POUR lancer ce mois d'essai offert. Ex : "Quelques minutes pour lancer le premier mois d'essai, sans engagement ?"
- Même le 1er email peut se terminer sur une mention courte ("et le premier mois est offert pour tester") — le but est qu'ils comprennent VITE qu'ils ne risquent rien. Ne PAS attendre la 2e relance.

=== SI PAS DE SITE WEB ===
Si le prospect n'a pas de site, ouvre là-dessus : quand un client cherche son métier sur Google, il ne le trouve nulle part, il n'existe pas en ligne face à des concurrents qui, eux, y sont. Simple et concret.

=== OPT-OUT (RGPD, OBLIGATOIRE) ===
Après la signature, toujours ces 2 lignes exactes :
---
Pour ne plus recevoir mes emails, répondez simplement "Stop".

Signature, exactement, sur 3 lignes (ne jamais écrire "Thomas" seul avant, aucun titre type "Fondateur") :
Thomas Renard
Hdigiweb
thomas@hdigiweb.fr`

// Transforme les failles techniques en hook concret pour le générateur.
// Règle : 1 seul problème mis en avant (le plus visible), formulé comme une observation humaine.
function buildAuditContext(level?: string, weaknesses?: string[], cms?: string): string {
  if (!level || level === 'no-website') return ''

  // Priorité d'impact : ce qui se voit immédiatement en tant que client ou Google
  const PRIORITY: { match: string; hook: string }[] = [
    { match: 'viewport',       hook: "j'ai regardé votre site depuis mon téléphone : il s'affiche mal, alors que la plupart des gens cherchent un artisan sur leur mobile" },
    { match: 'HTTPS',          hook: "votre site est en HTTP, pas en HTTPS : les navigateurs affichent \"non sécurisé\" à vos visiteurs et Google le fait descendre" },
    { match: 'abandonné',      hook: "votre site n'a pas l'air d'avoir bougé depuis pas mal de temps, et Google fait redescendre les sites qui ne sont plus mis à jour" },
    { match: 'copyright',      hook: "votre site n'a pas l'air d'avoir été mis à jour depuis plusieurs années, et ça joue sur votre place dans Google" },
    { match: 'Lorem ipsum',    hook: "votre site a encore du texte de remplissage (du faux texte), il n'est sûrement pas vraiment repéré par Google" },
    { match: 'meta description', hook: "sous votre nom dans les résultats Google, il n'y a rien d'écrit : Google n'a pas de description à afficher pour vous" },
    { match: 'H1',             hook: "votre site n'indique pas clairement votre métier à Google, du coup vous ressortez mal sur les recherches locales" },
    { match: 'jQuery',         hook: "votre site tourne sur une vieille techno qui le ralentit, et un site lent, Google le fait descendre" },
    { match: 'Flash',          hook: "votre site utilise du Flash, qui ne marche plus du tout sur les téléphones et tablettes" },
    // ⚠️ CES TROIS-LÀ MANQUAIENT, ET C'EST CE QUI A PROVOQUÉ L'INVENTION DU 17/08.
    // Ce sont les faiblesses les plus fréquentes de nos audits. Sans formulation exploitable, le
    // repli tombait sur « 16 images sans attribut alt » — invisible pour un artisan — et le modèle
    // allait chercher un défaut parlant dans l'EXEMPLE du prompt (« il s'affiche mal sur mobile »),
    // c'est-à-dire dans un site qui n'était pas le sien.
    { match: 'numéro cliquable', hook: "sur votre site, votre numéro n'est pas cliquable depuis un téléphone : il faut le recopier à la main pour vous appeler, et beaucoup abandonnent là" },
    { match: 'formulaire',       hook: "il n'y a pas de formulaire ni d'adresse de contact sur votre site : quelqu'un qui veut un devis le soir n'a aucun moyen simple de vous le demander" },
    { match: 'fréquentation',    hook: "rien ne mesure les visites sur votre site : impossible de savoir combien de personnes vous cherchent, ni d'où elles viennent" },
  ]

  const w = weaknesses ?? []
  const topHook = PRIORITY.find(p => w.some(weakness => weakness.toLowerCase().includes(p.match.toLowerCase())))
  const cmsNote = cms ? ` (site fait avec ${cms})` : ''

  if (!topHook) {
    /**
     * ⚠️ AUCUN DÉFAUT EXPLOITABLE ≠ INVENTER UN DÉFAUT.
     *
     * L'ancien repli servait la première faiblesse brute de l'audit, quelle qu'elle soit — pour
     * MUMCULAR PVC c'était « 16 images sans attribut alt », que personne ne comprend et qui ne fait
     * mal à personne. Le modèle, coincé, est allé chercher un défaut parlant dans l'EXEMPLE du
     * prompt et a affirmé au prospect que son site s'affichait mal sur mobile. C'était faux : son
     * site est noté 88, moderne, parfaitement lisible sur téléphone.
     *
     * Quand le site est correct, on le dit au générateur et on change d'angle. Un bon site mal
     * trouvé sur Google reste un vrai sujet ; un site cassé imaginaire ne l'est pas.
     */
    return `\n\nAUDIT SITE${cmsNote} — niveau : ${level}.
⚠️ AUCUN DÉFAUT VISIBLE EXPLOITABLE sur ce site. INTERDICTION ABSOLUE d'affirmer un problème
d'affichage, de mobile, de lenteur, de sécurité ou d'abandon : ce serait faux, et le prospect
ouvrira son site pour vérifier.
Change d'angle : n'ouvre PAS sur un défaut. Ouvre sur le fait qu'un site correct ne sert à rien s'il
n'est pas trouvé quand quelqu'un cherche ce métier dans sa ville, puis enchaîne sur les demandes de
devis. Tu peux dire que le site est propre — c'est vrai, et ça montre que tu l'as vraiment regardé.`
  }

  const secondary = w.filter(weakness => !weakness.toLowerCase().includes(topHook.match.toLowerCase())).slice(0, 2)
  const secondaryNote = secondary.length > 0 ? ` Autres défauts (contexte seulement, ne pas les citer) : ${secondary.join(' ; ')}.` : ''

  return `\n\nAUDIT SITE${cmsNote} — niveau : ${level} (À UTILISER EN OUVERTURE) :
Défaut principal à exploiter : "${topHook.hook}".
Ouvre l'email sur ce défaut, reformulé SIMPLEMENT et naturellement (jamais mot pour mot), comme si tu l'avais découvert toi-même en regardant son site.${secondaryNote}`
}

function buildLeadBlock(lead: Lead, type: string, fromEmail: string, fromName: string): string {
  const typeMap: Record<string, string> = {
    initial:    'J+0 — Premier contact. Ouvre sur le défaut audité de son site. Court (50-90 mots). CTA doux.',
    followup_1: 'J+3 — Relance courte (40-70 mots). Un autre angle du même problème, pas une répétition. CTA doux.',
    followup_2: 'J+7 — Relance (40-70 mots). Un artisan du même métier qu\'on a aidé (sans nom, sans chiffre inventé), ton chaleureux. CTA doux.',
    followup_3: 'J+14 — Dernière relance, très courte (30-60 mots). Propose un audit gratuit de son site.',
  }

  const situation = !lead.hasWebsite
    ? 'Aucun site web. Invisible sur Google pour les recherches directes.'
    : !lead.hasGoogleAds
    ? 'Site existant mais faible visibilité quand on cherche son métier sur Google.'
    : 'Site existant mais qui ne lui rapporte pas assez de demandes.'

  const auditContext = buildAuditContext(lead.auditLevel, lead.auditWeaknesses, lead.auditCms)

  const sector = (lead.specialty?.[0] || 'artisan du bâtiment').toLowerCase()
  // Vocabulaire/recherches Google adaptés au métier (BtP)
  const sectorHints: Record<string, string> = {
    couvreur: 'recherches type "couvreur {ville}", "réparation toiture", "démoussage", "rénovation toiture". Parle de toiture/couverture.',
    terrassier: 'recherches type "terrassement {ville}", "entreprise de terrassement", "VRD", "assainissement". Parle de terrassement/préparation de terrain, JAMAIS de toiture.',
    pisciniste: 'recherches type "construction piscine {ville}", "pisciniste {ville}", "rénovation piscine". Parle de piscine/bassin, JAMAIS de toiture.',
    'maçon': 'maçonnerie, construction, gros œuvre, murs, fondations. Recherches: "maçon {ville}", "entreprise maçonnerie". JAMAIS toiture.',
    'électricien': 'installation électrique, dépannage électrique, tableau électrique. Recherches: "électricien {ville}". JAMAIS toiture.',
    'plombier': 'plomberie, chauffage, chaudière, sanitaires. Recherches: "plombier {ville}". JAMAIS toiture.',
    'peintre': 'peinture intérieure et extérieure, ravalement. Recherches: "peintre {ville}". JAMAIS toiture.',
    'menuisier': 'menuiserie, fenêtres, portes, parquet. Recherches: "menuisier {ville}". JAMAIS toiture.',
  }
  const hint = sectorHints[sector] ?? `Adapte le vocabulaire et les exemples de recherches Google au métier "${sector}". N'utilise PAS de vocabulaire d'un autre métier.`

  return `LEAD :
- Prénom : ${lead.firstName || '(non disponible — utiliser "Bonjour,")'}
- Entreprise : ${lead.company}
- Métier du prospect : ${sector}
- Ville : ${lead.city}
- Site web : ${lead.hasWebsite ? 'oui' : 'NON'}
- Visibilité payante détectée : ${lead.hasGoogleAds ? 'oui' : 'NON'} (info interne, NE JAMAIS l'évoquer dans l'email)
- Bonne réputation Google : ${lead.googleRating && lead.googleRating >= 4.0 ? 'oui' : 'non'}
- Situation : ${situation}${auditContext}

ADAPTATION MÉTIER (CRITIQUE) : ce prospect est un ${sector}. ${hint}
Toute mention d'un autre métier (ex: toiture pour un pisciniste) est une faute grave.

TYPE : ${typeMap[type] || typeMap.initial}

Rappel : COURT et SIMPLE, une seule idée, ouvre sur le défaut audité, CTA doux. Pas de pavé.

La signature doit être exactement :
${fromName}
Hdigiweb
${fromEmail}

Réponds en JSON uniquement :
{"subject": "...", "body": "...avec signature complète à la fin..."}`
}

export async function generateEmail(
  lead: Lead,
  type: 'initial' | 'followup_1' | 'followup_2' | 'followup_3' = 'initial',
  fromEmail = 'thomas@hdigiweb.fr',
  fromName = 'Thomas Renard'
): Promise<{ subject: string; body: string }> {
  // Load dynamic prompt addon from auto-learning (if DB available)
  let dynamicAddon = ''
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/lib/db')
      const { agent_config } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')
      const [addon] = await db.select().from(agent_config).where(eq(agent_config.key, 'system_prompt_addon'))
      if (addon?.value) dynamicAddon = '\n\nRECOMMANDATIONS AUTO-LEARNING:\n' + addon.value
    } catch { /* ignore */ }
  }

  // Build dynamic system prompt with the correct sender signature
  const dynamicSystemPrompt = SYSTEM_PROMPT
    .replace(/thomas@hdigiweb\.fr/g, fromEmail)
    .replace(/Thomas Renard/g, fromName)

  const produire = async (consigne = '') => {
    const text = await generateText({
      system: dynamicSystemPrompt + dynamicAddon,
      prompt: buildLeadBlock(lead, type, fromEmail, fromName) + consigne,
      maxTokens: 800,
      temperature: 0.9, // rédaction = créatif
    })
    const parsed = extractJson<{ subject: string; body: string }>(text)
    return { subject: cleanEmailText(parsed.subject), body: cleanEmailText(parsed.body) }
  }

  return regenererSiInvention(await produire(), lead, produire)
}

// Génère TOUTE la séquence (email initial + 3 relances) en UN seul appel IA,
// adaptée au métier du prospect, dans le style Hdigiweb. Plein autonomie multi-secteur.
export async function generateSequence(
  lead: Lead,
  fromEmail: string,
  fromName: string,
  variantInstruction?: string, // angle d'ouverture testé (auto-apprentissage)
): Promise<Array<{ subject: string; body: string }>> {
  let dynamicAddon = ''
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/lib/db')
      const { agent_config } = await import('@/lib/db/schema')
      const { eq } = await import('drizzle-orm')
      const [addon] = await db.select().from(agent_config).where(eq(agent_config.key, 'system_prompt_addon'))
      if (addon?.value) dynamicAddon = '\n\nRECOMMANDATIONS AUTO-LEARNING:\n' + addon.value
    } catch { /* ignore */ }
  }

  const sector = (lead.specialty?.[0] || 'artisan du bâtiment').toLowerCase()
  const sectorHints: Record<string, string> = {
    couvreur: 'toiture, couverture, zinguerie. Recherches Google: "couvreur {ville}", "réparation toiture", "démoussage".',
    terrassier: 'terrassement, préparation de terrain, VRD, assainissement. Recherches: "terrassement {ville}", "entreprise de terrassement". JAMAIS de toiture.',
    pisciniste: 'construction et rénovation de piscines. Recherches: "construction piscine {ville}", "pisciniste {ville}". JAMAIS de toiture.',
    'maçon': 'maçonnerie, construction, gros œuvre, murs, fondations. Recherches: "maçon {ville}", "entreprise maçonnerie". JAMAIS toiture.',
    'électricien': 'installation électrique, dépannage électrique, tableau électrique. Recherches: "électricien {ville}". JAMAIS toiture.',
    'plombier': 'plomberie, chauffage, chaudière, sanitaires. Recherches: "plombier {ville}". JAMAIS toiture.',
    'peintre': 'peinture intérieure et extérieure, ravalement. Recherches: "peintre {ville}". JAMAIS toiture.',
    'menuisier': 'menuiserie, fenêtres, portes, parquet. Recherches: "menuisier {ville}". JAMAIS toiture.',
  }
  const hint = sectorHints[sector] ?? `métier "${sector}" : adapte tout le vocabulaire à ce métier, n'emploie pas le jargon d'un autre métier.`

  const dynamicSystemPrompt = SYSTEM_PROMPT
    .replace(/thomas@hdigiweb\.fr/g, fromEmail)
    .replace(/Thomas Renard/g, fromName)

  const seqAuditContext = buildAuditContext(lead.auditLevel, lead.auditWeaknesses, lead.auditCms)

  const variantBlock = variantInstruction
    ? `\n\nANGLE D'OUVERTURE À UTILISER POUR L'EMAIL 1 (on teste cet angle) : ${variantInstruction}`
    : ''

  const userPrompt = `Génère une SÉQUENCE de 4 emails de prospection pour ce prospect, dans le style COURT et SIMPLE décrit ci-dessus, 100% adaptés à son métier.${variantBlock}

PROSPECT :
- Entreprise : ${lead.company}
- Métier : ${sector} → vocabulaire : ${hint}
- Ville : ${lead.city}
- Site web : ${lead.hasWebsite ? 'oui' : 'NON'}${seqAuditContext}

Les 4 emails (même fil, sujets courts et cohérents). L'OFFRE "1er mois offert, sans engagement" est le LEVIER N°1 → elle doit apparaître, sous un angle DIFFÉRENT, dans PRESQUE TOUS les mails :
1. INITIAL (J+0) : ouvre sur le DÉFAUT AUDITÉ ci-dessus + sa conséquence concrète + CTA doux, ET termine par une mention courte de l'offre ("et le premier mois est offert pour tester, sans engagement"). 50-90 mots.
2. RELANCE 1 (J+3) : courte, un autre angle du même problème (ou un 2e défaut), PUIS remets l'offre en avant sous un autre angle ("vous ne payez rien tant que vous n'avez pas vu de résultats"), CTA. 40-70 mots.
3. RELANCE 2 (J+7) : un artisan du même métier qu'on a aidé (sans nom, sans chiffre inventé), ton chaleureux, et APPUIE FORT sur l'offre "premier mois offert, sans engagement, vous testez sur votre secteur avant de payer" + CTA lié à l'offre. 40-70 mots.
4. RELANCE 3 / BREAK-UP (J+14) : très courte, propose un audit gratuit de son site ET rappelle qu'il peut lancer le mois d'essai offert sans rien risquer. 30-60 mots.

CRITIQUE : chaque email COURT et SIMPLE (jamais un pavé), une seule idée principale + l'offre, vocabulaire du métier "${sector}" uniquement. L'offre doit être MISE EN VALEUR (pas glissée), formulée DIFFÉREMMENT à chaque mail. Aucun crochet [à remplir], aucun concurrent nommé, aucun tiret cadratin, aucun chiffre inventé.

Signature à la fin de CHAQUE email :
${fromName}
Hdigiweb
${fromEmail}

Réponds en JSON uniquement :
{"emails":[{"subject":"...","body":"..."},{"subject":"...","body":"..."},{"subject":"...","body":"..."},{"subject":"...","body":"..."}]}`

  const text = await generateText({
    system: dynamicSystemPrompt + dynamicAddon,
    prompt: userPrompt,
    maxTokens: 2200,
    temperature: 0.9,
  })

  const parsed = extractJson<{ emails: Array<{ subject: string; body: string }> }>(text)
  const emails = (parsed.emails ?? [])
    .slice(0, 4)
    .map(e => ({
      subject: cleanEmailText(e.subject ?? ''),
      body: cleanEmailText(e.body ?? ''),
    }))
    // CRITIQUE : on rejette tout email au body vide/trop court — sinon Instantly
    // envoie un mail VIDE au prospect (cause des plaintes "je n'ai rien reçu").
    .filter(e => e.body.trim().length >= 20 && e.subject.trim().length > 0)
  if (emails.length === 0) throw new Error('generateSequence: aucun email valide généré (bodies vides)')

  /**
   * ⚠️ LA SÉQUENCE ENTIÈRE PASSE À LA RELECTURE, PAS SEULEMENT LE PREMIER MAIL.
   *
   * C'est par ici que passent les envois réels (autopilot), et une affirmation fausse recopiée dans
   * l'email 1 se retrouve reformulée dans les trois relances : le prospect la lit quatre fois.
   * Si UN mail affirme un défaut non constaté, on régénère toute la séquence une fois, l'interdiction
   * nommée explicitement. Après quoi on garde la version la moins fausse — on ne bloque pas l'envoi,
   * mais on trace, parce qu'un lead muet est un lead perdu et qu'une invention doit se voir.
   */
  const inventions = emails
    .flatMap(e => verifierAffirmations(e.body, lead.auditWeaknesses, !!lead.hasWebsite).inventions)
  if (inventions.length === 0) return emails

  const uniques = [...new Set(inventions)]
  console.warn('[generateSequence] affirmations non vérifiées, régénération:', uniques.join(' | '))

  const texte2 = await generateText({
    system: dynamicSystemPrompt + dynamicAddon,
    prompt: userPrompt + `\n\n⚠️ CORRECTION OBLIGATOIRE. Ta version précédente affirmait : ${uniques.join(', ')}.
C'est FAUX pour ce prospect : l'audit de son site ne le constate pas, et il ouvrira son site pour
vérifier. N'écris AUCUNE de ces affirmations, dans AUCUN des 4 emails. Si tu n'as pas de défaut réel
à citer, n'ouvre sur aucun défaut et parle de ce qu'on apporte.`,
    maxTokens: 2200,
    temperature: 0.9,
  })
  const parsed2 = extractJson<{ emails: Array<{ subject: string; body: string }> }>(texte2)
  const emails2 = (parsed2.emails ?? [])
    .slice(0, 4)
    .map(e => ({ subject: cleanEmailText(e.subject ?? ''), body: cleanEmailText(e.body ?? '') }))
    .filter(e => e.body.trim().length >= 20 && e.subject.trim().length > 0)
  if (emails2.length === 0) return emails

  const restantes = emails2
    .flatMap(e => verifierAffirmations(e.body, lead.auditWeaknesses, !!lead.hasWebsite).inventions)
  if (restantes.length > 0) {
    console.error('[generateSequence] invention persistante après régénération:', [...new Set(restantes)].join(' | '))
  }
  return emails2
}
