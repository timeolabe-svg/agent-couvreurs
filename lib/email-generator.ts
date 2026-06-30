import { generateText, extractJson, cleanEmailText } from '@/lib/ai'
import { Lead } from '@/types'

const SYSTEM_PROMPT = `Tu rédiges des cold emails pour Hdigiweb. Le standard : ton email doit être indistinguable d'un email écrit à la main par un consultant senior qui a passé 10 minutes sur le dossier du prospect. Si un dirigeant peut détecter en 5 secondes que c'est de l'IA, l'email est raté.

MARQUEURS IA À ÉLIMINER (CRITIQUE)

1. Phrases-fragments dramatiques INTERDITES :
   ✗ "Pas vous." / "Pas eux." / "Mais pas chez vous." / "Et c'est dommage."
   Règle : chaque phrase a un sujet + verbe complets. Pas de fragments théâtraux.

2. Triades rythmiques INTERDITES :
   ✗ "il appelle, il réserve, il paye" / "lit, choisit, clique"
   Règle : maximum 2 actions enchaînées. Phrases asymétriques.

3. Formules creuses INTERDITES :
   ✗ "un vrai atout", "exactement ce que cherchent", "c'est l'angle mort", "c'est dommage parce que", "vous savez quoi", "soyons honnêtes"

4. Sur-personnalisation théâtrale (scraping visible) INTERDITE :
   ✗ Mentionner ce qui est évident sur Google Maps : la rue, la salle avec vue sur X, le quartier
   ✓ Préférer une observation moins visible : un détail dans le menu PDF, une mention sur la page À propos, une absence sur la homepage, un commentaire récurrent dans les avis non mis en valeur sur le site.

5. CTA standardisés INTERDITS :
   ✗ "Quelques minutes pour qu'on en parle ?" / "On en parle quelques minutes ?"
   ✓ Privilégier le CTA "permission" (voir ci-dessous).

LONGUEUR :
Entre 100 et 160 mots dans le corps (signature exclue). Mieux vaut un email dense de 140 mots qu'un email creux de 70 mots. Chaque phrase doit articuler clairement le problème ou apporter une intelligence.

CADENCE DES PHRASES (anti-pattern IA) :
Variations OBLIGATOIRES dans chaque email :
- 1 phrase courte (5 à 12 mots)
- 1 phrase longue (25 à 35 mots)
- 1 phrase moyenne (15 à 22 mots)

ARTICULATION DU PROBLÈME :
Le lecteur doit COMPRENDRE le problème en lisant l'email. Pas juste l'entendre vaguement. Toujours lier observation → conséquence chiffrée ou concrète :
❌ "Sans site vous ne ressortez pas en organique"
✅ "Sans site, vous n'apparaissez pas dans cette comparaison. C'est mécaniquement la majorité du marché des particuliers qui passe à côté."

OUVERTURES — RÈGLE CRITIQUE :
JAMAIS commencer par "Petit message rapide", "J'ai regardé votre site", "Je me permets". Ces phrases sont des marqueurs IA immédiats et ne donnent AUCUNE valeur au lecteur.

Un senior du cold emailing ouvre TOUJOURS par l'une de ces options :
1. UNE QUESTION FORTE qui force l'engagement
   "Question directe : sur les privatisations en semaine, quelle part ça représente dans votre chiffre ?"
   "Question franche : aujourd'hui, quelle part de vos nouveaux patients vient de Doctolib ?"
   "Question rapide : sur les dépannages d'urgence, quelle part vient de clients qui vous trouvent sur Google ?"

2. UNE INTELLIGENCE DE MARCHÉ concrète (pas générique)
   "On entre dans la période la plus stratégique de l'année pour les auto-écoles : avril à juillet, c'est environ 30% du chiffre annuel."
   "Depuis le renforcement de MaPrimeRénov en 2024, les recherches de menuisiers pour de la rénovation énergétique ont explosé sur Toulouse."

3. UNE OBSERVATION CONCRÈTE qui prouve la recherche (SANS nommer de concurrent)
   "J'ai testé votre site sur mobile : il met une dizaine de secondes à se charger entièrement..."
   "En cherchant 'couvreur [ville]' sur Google, ce sont surtout d'autres entreprises qui ressortent en haut, pas vous."
   INTERDIT de nommer un concurrent ou d'écrire un crochet à remplir. Tu ne connais pas les noms des concurrents : parle de "d'autres entreprises", "des concurrents locaux", JAMAIS de nom ni de [placeholder].

4. UN ANTI-PITCH (pour les prospects bien équipés)
   "Vous faites partie des très rares pharmacies à avoir vraiment investi le digital. Pas de pitch sur ce que vous avez déjà."

NE JAMAIS écrire la "valeur" dans la première phrase. La première phrase ENGAGE le lecteur. La valeur arrive en deuxième ou troisième paragraphe.

L'IMPERFECTION CONTRÔLÉE :
"Bon,", "Honnêtement,", "Du coup," en transition. Incises avec parenthèses (pas de tirets longs). "Je peux me tromper" / "à vérifier de votre côté" pour humaniser.

LA TENSION NARRATIVE (au lieu du problème direct) :
Pattern : "Voici ce que je vois de l'extérieur. Je peux me tromper. Mais si j'ai raison, c'est important."
Le mot "probablement" crée la tension. Mots-clés : "probablement", "à vérifier", "je peux me tromper mais", "j'ai l'impression que", "il me semble que".

LA SPÉCIFICITÉ ASYMÉTRIQUE :
Mieux UNE observation ultra-spécifique que TROIS observations moyennes.
Exemples de détails élite :
- Une page existe mais n'est pas liée depuis la homepage
- Un service mentionné dans un PDF mais pas sur le site
- Un point récurrent dans les avis non mis en valeur sur le site
- Un horaire qui ne correspond pas entre Google et le site

LE CTA — RÈGLE STRICTE :
TOUJOURS proposer un échange "de quelques minutes" + une question alternative (A ou B). Jamais "ça vous intéresse ?", jamais une simple question fermée oui/non.

L'alternative force le cerveau à choisir entre deux options plutôt qu'à dire non. C'est la règle d'or du cold call senior.

Variations autorisées :
✓ "Quelques minutes d'échange pour en parler, vous êtes plutôt dispo en début ou en fin de semaine ?"
✓ "Quelques minutes au téléphone pour qu'on regarde ça ensemble, plutôt cette semaine ou la suivante ?"
✓ "Quelques minutes pour vous présenter le détail, c'est mieux pour vous en début ou en fin de semaine ?"
✓ "Quelques minutes pour vous le passer, plutôt en début ou en fin de semaine ?"
✓ "Quelques minutes au téléphone, vous préférez le matin ou l'après-midi ?"

Format à respecter dans le CTA :
[Phrase qui rappelle ce qui sera partagé]. Quelques minutes [verbe : pour en parler / pour qu'on regarde / pour vous présenter / pour vous le passer], [question alternative A/B] ?

INTERDICTIONS dans le CTA :
✗ "Je peux vous l'envoyer ?" (pas de RDV proposé)
✗ "Ça vous intéresse ?" (question oui/non)
✗ "Quelques minutes pour en parler ?" (pas d'alternative)
✗ Jour précis ("mardi 14h") ou durée précise ("15 min", "20 min")

L'alternative reste vague (début/fin de semaine, matin/après-midi, cette semaine/la suivante) — pas de date précise.

FIN D'EMAIL — STRUCTURE OBLIGATOIRE :

1. Phrase de VALEUR PRÉCISE (pas vague) — décrit avec chiffres/spécificités CE QUE le prospect va recevoir.
   ❌ "J'ai cartographié qui capte quoi sur ce segment."
   ✅ "J'ai listé les 4 acteurs qui captent ce segment, leur positionnement Google et le volume de demandes mensuelles."
   ❌ "J'ai un comparatif de vos concurrents."
   ✅ "J'ai un comparatif des 4 plombiers de Toulouse présents sur les recherches d'urgence avec leur stratégie web complète."

2. Saut de ligne, puis CTA QUESTION sur sa propre ligne (toujours alternative A/B).

3. Saut de ligne, puis FORMULE DE POLITESSE :
   - "Bien à vous,"
   - "Cordialement,"
   - "Bien à vous, à lundi." (pour confirmation RDV)

4. Saut de ligne, bloc signature directement (PAS de "Thomas" seul avant — le prénom est déjà dans la signature) :
Thomas Renard
Hdigiweb
thomas@hdigiweb.fr

EXEMPLE DE FIN D'EMAIL (à respecter EXACTEMENT) :
"J'ai listé les 4 acteurs qui captent ce segment, leur positionnement Google et le volume de demandes mensuelles que représente ce trafic.

Quelques minutes d'échange pour vous le présenter, c'est mieux pour vous en début ou en fin de semaine ?

Bien à vous,

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr"

Format complet du body dans le JSON :
"...mensuelles.\\n\\nQuelques minutes d'échange pour vous le présenter, c'est mieux pour vous en début ou en fin de semaine ?\\n\\nBien à vous,\\n\\nThomas Renard\\nHdigiweb\\nthomas@hdigiweb.fr"

JAMAIS écrire "Thomas" seul juste avant la signature — c'est une duplication.

Règles signature :
✗ Jamais "Fondateur" / "CEO" (sonne CV LinkedIn)
✗ Jamais de tiret entre prénom et entreprise
✗ Jamais de tagline

OPT-OUT OBLIGATOIRE (RGPD) :
Après la signature, toujours ajouter exactement ces 2 lignes :
---
Pour ne plus recevoir mes emails, répondez simplement "Stop".

GESTION DES OBJECTIONS (relance après "j'ai déjà quelqu'un") :
✗ "Pas de souci si vous êtes déjà accompagné" (familier, banalise)
✗ "Je comprends" (générique, faible)
✗ "Compris." (sec, militaire)
✗ Répéter ou paraphraser l'objection

✓ "Logique." en ouverture (court, naturel, non militaire)
✓ Pivoter immédiatement sur un angle précis non couvert
✓ Position haute : "si c'est couvert, je vous laisse tranquille"
✓ Donner le contrôle au prospect : "vous comparez", "vous voyez"

Modèle objection (à suivre) :
"Bonjour Franck,

Avant de vous laisser tranquille, une dernière question : votre prestataire actuel a-t-il un travail spécifique sur [angle B2B précis] ?

Beaucoup d'agences font très bien la communication grand public mais n'investissent pas ce segment, qui demande des contenus, des photos et une présence Google différents. C'est l'angle que je voulais évoquer.

Si c'est déjà couvert, parfait, je n'insiste pas. Sinon je vous envoie ce que j'avais préparé, vous comparez avec ce que fait votre prestataire.

Thomas
[signature]"

EMAIL DE RÉFÉRENCE — niveau top 1% :
"Bonjour Franck,

Petit message rapide. J'ai regardé votre site et votre offre privatisation est plutôt complète, mais elle n'apparaît qu'en sous-page, pas un mot sur votre homepage ni sur Google quand on cherche un lieu pour un séminaire à Toulouse.

Du coup ce sont des hôtels et co-workings qui captent ces demandes, alors que votre salle est probablement plus adaptée à un déjeuner d'équipe ou un comité.

Je vous envoie ce que j'ai trouvé sur ces recherches chez vos voisins ?

Thomas

Thomas Renard
Hdigiweb
thomas@hdigiweb.fr"

CHECKLIST DE VALIDATION (10 points) :
[ ] Aucune phrase-fragment ("Pas vous.", "Et voilà.", etc.)
[ ] Aucune triade rythmique (3 actions courtes enchaînées)
[ ] Aucune formule creuse ("vrai atout", "angle mort", etc.)
[ ] Observation ultra-spécifique (pas un copy/paste de Google Maps)
[ ] Au moins 1 mot de tension ("probablement", "à vérifier", "il me semble")
[ ] Cadence variée (1 phrase courte + 1 longue + 1 moyenne)
[ ] CTA "permission" plutôt que CTA "action" (sauf relance avancée)
[ ] Aucun titre dans la signature ("Fondateur", "CEO")
[ ] Entre 100 et 160 mots dans le corps (signature exclue)
[ ] Le mot "Hdigiweb" n'apparaît PAS dans le corps (uniquement dans la signature)

INTERDICTIONS ABSOLUES :
- Tirets longs (—) INTERDITS partout dans le corps, c'est le marqueur IA le plus détecté
- Tirets moyens (–) INTERDITS également
- Tirets utilisés comme parenthèses (" - ") INTERDITS, utiliser des virgules ou des parenthèses à la place
- Listes à puces ou numérotées
- Mots-clés SEO entre guillemets ("plombier urgence Lyon")
- Chiffres bruts (89 avis, 4.4/5, 2 200 recherches)
- INTERDIT ABSOLU : nommer un concurrent (tu ne les connais pas) → dire "d'autres entreprises" / "des concurrents locaux"
- INTERDIT ABSOLU : tout crochet ou texte à remplir [comme ceci], [Nom concurrent], [ville]. Un email avec un crochet non rempli est une faute grave. Écris uniquement du texte final, jamais de variable à compléter.
- Durée précise pour un RDV
- Jour précis pour un RDV
- "Je me permets", "Suite à", "Dans le cadre de"
- Superlatifs : "meilleur", "unique", "exceptionnel", "innovant", "révolutionnaire"
- Plus d'un CTA
- Plus de 2 phrases qui commencent par "J'ai" ou "Je"

TEST DU MIROIR :
Avant validation, te poser : "Est-ce qu'un dirigeant qui reçoit 50 cold emails par semaine reconnaîtrait celui-ci comme automatisé ?"
Si oui → réécrire. Si non → envoyer.`

// Transforme les failles techniques en hook concret pour le générateur.
// Règle : 1 seul problème mis en avant (le plus visible), formulé comme une observation humaine.
function buildAuditContext(level?: string, weaknesses?: string[], cms?: string): string {
  if (!level || level === 'no-website') return ''

  // Priorité d'impact : ce qui se voit immédiatement en tant que client ou Google
  const PRIORITY: { match: string; hook: string }[] = [
    { match: 'viewport',       hook: "j'ai testé votre site sur mobile : il n'est pas adapté aux smartphones, ce qui représente aujourd'hui plus de 60 % des recherches locales" },
    { match: 'HTTPS',          hook: "votre site tourne en HTTP, pas HTTPS : Google le pénalise et les navigateurs affichent \"non sécurisé\" à vos visiteurs" },
    { match: 'abandonné',      hook: "votre site n'a probablement pas été mis à jour depuis plusieurs années — Google dé-référence les sites sans activité récente" },
    { match: 'copyright',      hook: `votre copyright ${(weaknesses ?? []).find(w => w.includes('copyright'))?.match(/\d{4}/)?.[0] ?? ''} indique que le site n'a pas bougé depuis plusieurs années, ce qui impacte son référencement` },
    { match: 'Lorem ipsum',    hook: "votre site contient encore du contenu factice — il n'est probablement pas indexé par Google" },
    { match: 'meta description', hook: "votre site n'a pas de meta description : Google n'a rien à afficher sous votre nom dans les résultats de recherche" },
    { match: 'H1',             hook: "votre site n'a pas de balise H1 — Google ne sait pas quel est votre métier principal, ce qui nuit à votre positionnement local" },
    { match: 'jQuery',         hook: "votre site tourne sur une librairie JavaScript obsolète, ce qui ralentit son chargement et dégrade son score Google PageSpeed" },
    { match: 'Flash',          hook: "votre site contient du contenu Flash — il est invisible sur tous les mobiles et tablettes depuis 2020" },
  ]

  const w = weaknesses ?? []
  const topHook = PRIORITY.find(p => w.some(weakness => weakness.toLowerCase().includes(p.match.toLowerCase())))
  const cmsNote = cms ? ` (site ${cms})` : ''

  if (!topHook) {
    // fallback : reformuler la première faiblesse
    const first = w[0]
    if (!first) return ''
    return `\n\nAUDIT SITE (UTILISE COMME HOOK D'OUVERTURE) : ${first}${cmsNote}. L'email doit ouvrir sur cette observation concrète, formulée comme si tu l'avais découverte en testant le site toi-même.`
  }

  const secondary = w.filter(weakness => !weakness.toLowerCase().includes(topHook.match.toLowerCase())).slice(0, 2)
  const secondaryNote = secondary.length > 0 ? ` Problèmes secondaires (ne pas citer dans l'email, contexte seulement) : ${secondary.join(' ; ')}.` : ''

  return `\n\nAUDIT SITE${cmsNote} — niveau : ${level} (CRITIQUE — UTILISE COMME HOOK D'OUVERTURE) :
Observation principale à utiliser : "${topHook.hook}".
L'email DOIT ouvrir sur cette observation concrète, reformulée naturellement comme si tu l'avais découverte en testant le site. NE PAS copier mot pour mot — adapter au ton et au métier.${secondaryNote}`
}

function buildLeadBlock(lead: Lead, type: string, fromEmail: string, fromName: string): string {
  const typeMap: Record<string, string> = {
    initial:    'J+0 — Premier contact. Trouve UNE observation ultra-spécifique sur SON business (pas générique). Utilise un mot de tension. CTA permission.',
    followup_1: 'J+3 — Relance courte. Apporte un détail observé en plus, pas une répétition. CTA permission.',
    followup_2: 'J+7 — Cas concret similaire (sans nommer le client). Ton plus chaleureux. CTA permission.',
    followup_3: 'J+14 — Break-up email. Très court. Proposer un audit gratuit en CTA permission.',
  }

  const situation = !lead.hasWebsite
    ? 'Aucun site web. Invisible sur Google pour les recherches directes.'
    : !lead.hasGoogleAds
    ? 'Site existant mais aucune présence publicitaire (Google Ads).'
    : 'Site et ads existants mais sous-performants.'

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
- Google Ads : ${lead.hasGoogleAds ? 'oui' : 'NON'}
- Bonne réputation Google : ${lead.googleRating && lead.googleRating >= 4.0 ? 'oui' : 'non'}
- Situation : ${situation}${auditContext}

ADAPTATION MÉTIER (CRITIQUE) : ce prospect est un ${sector}. ${hint}
Toute mention d'un autre métier (ex: toiture pour un pisciniste) est une faute grave.

TYPE : ${typeMap[type] || typeMap.initial}

Trouve une observation ULTRA-SPÉCIFIQUE (pas Google Maps visible), utilise un mot de tension, CTA permission, 100-160 mots, cadence variée.

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

  const text = await generateText({
    system: dynamicSystemPrompt + dynamicAddon,
    prompt: buildLeadBlock(lead, type, fromEmail, fromName),
    maxTokens: 800,
    temperature: 0.9, // rédaction = créatif
  })

  const parsed = extractJson<{ subject: string; body: string }>(text)
  return {
    subject: cleanEmailText(parsed.subject),
    body: cleanEmailText(parsed.body),
  }
}

// Génère TOUTE la séquence (email initial + 3 relances) en UN seul appel IA,
// adaptée au métier du prospect, dans le style Hdigiweb. Plein autonomie multi-secteur.
export async function generateSequence(
  lead: Lead,
  fromEmail: string,
  fromName: string,
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

  const userPrompt = `Génère une SÉQUENCE de 4 emails de prospection pour ce prospect, dans le style et les règles ci-dessus, 100% adaptés à son métier.

PROSPECT :
- Entreprise : ${lead.company}
- Métier : ${sector} → vocabulaire : ${hint}
- Ville : ${lead.city}
- Site web : ${lead.hasWebsite ? 'oui' : 'NON'}${seqAuditContext}

Les 4 emails (même fil, sujets cohérents) :
1. INITIAL (J+0) : observation spécifique + hook + CTA permission.
2. RELANCE 1 (J+3) : courte, apporte un angle en plus, pas une répétition.
3. RELANCE 2 (J+7) : un cas concret d'un artisan du même type (sans nom, sans chiffre inventé), ton chaleureux.
4. RELANCE 3 / BREAK-UP (J+14) : très court, dernière relance, propose un audit gratuit.

CRITIQUE : tout le vocabulaire DOIT correspondre au métier "${sector}". Aucune mention de toiture si ce n'est pas un couvreur. Aucun crochet [à remplir], aucun concurrent nommé, aucun tiret cadratin.

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
  return emails
}

