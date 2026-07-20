import { generateText, extractJson } from '@/lib/ai'

export type ReplyClassification =
  | 'desinterest'
  | 'objection'
  | 'question'
  | 'interest'
  | 'rdv_request'
  | 'oof'
  | 'spam'
  | 'other'

export type ActionType =
  | 'auto_reply'
  | 'draft_for_validation'
  | 'no_action'
  | 'blocklist'

export interface ClassificationResult {
  classification: ReplyClassification
  action: ActionType
  confidence: number
  reasoning: string
  extractedDate?: string
  extractedName?: string
}

const CLASSIFICATION_PROMPT = `Tu es l'agent IA de Hdigiweb, une agence web toulousaine.
Tu analyses les réponses à nos emails de prospection envoyés à des artisans BTP en France.

Notre service : Améliorer la visibilité Google des couvreurs pour leur générer plus de devis.

Email envoyé :
{originalEmailBody}

Réponse reçue de {contactName} ({contactCompany}) :
Objet : {replySubject}
Message : {replyBody}

Classifie cette réponse parmi : desinterest / objection / question / interest / rdv_request / oof / spam / other

TU ES AUTONOME. Tu réponds toi-même à la grande majorité des messages. Tu ne demandes une validation humaine que si tu as un VRAI doute ou si c'est trop technique/sensible.

CAS CONFUSION / "je n'ai pas reçu de document" :
Nos emails de prospection sont des textes PURS — aucune pièce jointe, aucun document n'est jamais envoyé.
Si le prospect dit "je n'ai pas reçu votre document", "je n'ai rien reçu", "quel document ?", ou semble confus sur l'objet de notre email → classe en "spam" / action "no_action". C'est une confusion sans valeur commerciale, pas une vraie question sur nos services.
NE JAMAIS classer comme "question" un message de confusion sur un document ou pièce jointe inexistants.

DISTINCTION CRUCIALE objection vs desinterest :
- "objection" = il freine mais la porte est ENCORE ouverte : "trop cher", "pas le budget", "j'ai déjà quelqu'un", "pas le temps", "envoyez par mail". → c'est à TRAVAILLER, l'agent doit convaincre. C'est normal au 1er échange. NE PAS blocklister.
- "desinterest" = refus ferme et définitif UNIQUEMENT : "stop", "ne me recontactez plus", "pas intéressé du tout", "retirez-moi". → blocklist.
Dans le doute entre les deux → choisis "objection" (on garde le lead et on tente de convaincre).

Choix de l'action :
- desinterest (refus ferme/définitif seulement) → blocklist
- spam → no_action
- oof (absence/accusé réception automatique) → no_action
- interest / question / objection / rdv_request → auto_reply (tu réponds seul)

EXCEPTION → draft_for_validation (demande validation) UNIQUEMENT si :
- le prospect demande un prix précis, un devis chiffré, ou négocie un tarif
- question très technique nécessitant une expertise précise que tu n'as pas
- réclamation, mécontentement, ton agressif ou juridique
- situation ambiguë où tu n'es pas sûr de la bonne réponse (confidence < 70)

Dans le doute léger : réponds toi-même (auto_reply). Ne sur-sollicite pas l'humain.

IMPORTANT — rdv_request : classe en "rdv_request" dès que le prospect veut concrètement échanger : il dit "ça m'intéresse, contactez-moi", "rappelez-moi", "appelez-moi au ...", donne un numéro, propose un moment, ou demande un RDV/appel. Action = auto_reply.
Si rdv_request : extrais dans "extractedDate" le moment souhaité tel qu'écrit ("en fin de journée", "demain matin", "mardi 14h", "cette semaine"...), sinon null.

Réponds en JSON strict :
{
  "classification": "...",
  "action": "...",
  "confidence": 0-100,
  "reasoning": "...",
  "extractedDate": "..." ou null,
  "extractedName": "..." ou null
}`

// CRITIQUE : isole le VRAI texte du prospect en retirant l'historique cité
// (notre email d'origine contient "répondez Stop" → sinon faux opt-out).
export function stripQuotedReply(raw: string): string {
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#3[49];/g, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')

  // Coupe au premier marqueur de citation / historique de conversation
  const markers = [
    /\n\s*Le\s[\s\S]{0,90}?\sa\s+écrit\s*:/i,        // "Le 15 juin 2026, X a écrit :"
    /\n\s*Le\s(lun|mar|mer|jeu|ven|sam|dim)[\s\S]{0,90}?,/i, // "Le lun. 15 juin 2026, ... a"
    /\nOn\s[\s\S]{0,90}?\swrote:/i,
    /-{2,}\s*(Original Message|Message d'origine)\s*-{2,}/i,
    /\n\s*De\s*:[\s\S]{0,250}?Envoyé\s*:/i,           // Outlook FR
    /\n\s*From:[\s\S]{0,250}?Sent:/i,                 // Outlook EN
    /\n_{5,}/,                                         // séparateur Outlook
    /\n>{1,}\s/,                                       // lignes citées ">"
    /\nEnvoyé de mon /i,
    /\nObtenez\s+Outlook/i,
    /\nPour ne plus recevoir mes emails/i,            // notre propre ligne opt-out citée
  ]
  let cutAt = text.length
  for (const m of markers) {
    const match = text.match(m)
    if (match && match.index !== undefined && match.index < cutAt) cutAt = match.index
  }
  text = text.slice(0, cutAt)

  // Retire la signature après "-- "
  text = text.replace(/\n--\s*\n[\s\S]*$/, '')

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// Détecte les réponses AUTOMATIQUES (accusés de réception, absences, bots).
// Ce ne sont PAS de vraies réponses humaines → on les ignore (no_action).
function isAutoResponder(body: string, subject: string, fromEmail: string): boolean {
  const text = (subject + ' ' + body).toLowerCase()
  const from = fromEmail.toLowerCase()

  // Adresses techniques (support, antispam, noreply...)
  if (/(no-?reply|ne-?pas-?repondre|donotreply|mailer-daemon|postmaster|antispam|notification|support@|@webador|@wix|@sendgrid|@mailchimp)/.test(from)) {
    return true
  }

  const autoPatterns = [
    // Accusés de réception
    /nous reviendrons vers vous/,
    /reviendrai vers vous/,
    /accus[ée] de r[ée]ception/,
    /bonne r[ée]ception de (votre|ce)/,
    /bien re[çc]u votre (message|mail|email|demande)/,
    /confirmons la bonne r[ée]ception/,
    /nous mettons tout en [œo]euvre pour/,
    /traiter (votre|ce|le) (message|mail|demande) dans les meilleurs d[ée]lais/,
    /votre (message|demande) a bien [ée]t[ée] re[çc]u/,
    // Réponses automatiques / absences
    /r[ée]ponse automatique/,
    /message automatique/,
    /automatic reply/,
    /out of office/,
    /auto-?reply/,
    /je suis (actuellement )?absent/,
    /actuellement en (cong[ée]s?|vacances|d[ée]placement)/,
    /de retour le \d/,
    /en (cong[ée]s?|vacances) jusqu/,
    /ne pas r[ée]pondre [àa] (cet|ce) (e-?mail|message)/,
  ]
  return autoPatterns.some(p => p.test(text))
}

// Détecte les plaintes "mail vide / je n'ai rien reçu" AVANT Gemini.
// Ces messages n'ont aucune valeur commerciale → spam/no_action immédiat.
export function isEmptyEmailComplaint(body: string, subject = ''): boolean {
  const text = (body + ' ' + subject).toLowerCase()
  const patterns = [
    /n'ai (rien|pas|aucun|aucune) re[çc]u/,             // "je n'ai rien reçu", "je n'ai pas reçu"
    /pas re[çc]u (votre|le|ce|cet|un|mon|de) ?(mail|message|email|document|courrier|fichier)/,
    /mail (vide|vierge|sans contenu|sans message|sans rien)/,
    /message (vide|vierge|sans contenu|sans rien)/,
    /email (vide|vierge|sans contenu|sans rien)/,
    /pas (de|de\s+)contenu/,
    /aucun (contenu|texte|message|fichier|document)/,
    /ne contient (rien|aucun|pas de|ni)/,               // "mail qui ne contient ni message ni fichier"
    // ⚠️ NE matche QUE la PLAINTE (pièce manquante/absente/oubliée), PAS la simple mention
    // "en pièce jointe" : "envoyez-moi le devis en pièce jointe" est un SIGNAL D'ACHAT, pas
    // une plainte "mail vide" — il ne doit surtout pas être classé spam/no_action.
    /(pi[eè]ce|fichier|document) (manquant|absent|oubli[eé])/,
    /sans (pi[eè]ce|fichier|document|pj\b)/,
    /oubli[eé]\s*(la|une|votre|de)?\s*(pi[eè]ce|pj|fichier|document)/,
    /\bpj\b.*manqu/,
    /pas joint/,
    /rien attach[eé]/,
  ]
  return patterns.some(p => p.test(text))
}

// Détecte les anti-spam "challenge-response" (SpamEnMoins, etc.) : un bot qui répond
// "confirmez l'envoi de votre mail en cliquant ici" pour débloquer le message. Ce n'est
// PAS une vraie réponse humaine → ne jamais répondre, ne pas afficher (spam).
export function isChallengeResponseSpam(body: string, subject = ''): boolean {
  const text = (body + ' ' + subject).toLowerCase()
  const patterns = [
    /spamenmoins/,
    /spam\s*en\s*moins/,
    /confirme[rz]?\s+(l['’]envoi|votre\s+envoi|mon\s+envoi)/,
    /confirmer\s+l['’]envoi\s+de\s+votre\s+(mail|message|e-?mail)/,
    /pour\s+l['’]instant\s+bloqu[ée]/,
    /votre\s+(mail|message|e-?mail|courriel)\s+(a\s+[ée]t[ée]|est|sera)\s+bloqu[ée]/,
    /messagerie\s+(est\s+)?(maintenant\s+)?prot[ée]g[ée]e?\s+par/,
    /liste\s+(de|des)\s+correspondants?\s+(de\s+)?confiance/,
    /list\s+of\s+trusted\s+correspond/,
    /added\s+to\s+my\s+list\s+of\s+trusted/,
    /trusted\s+correspondants?/,
    /anti-?spam,?\s*anti-?phishing/,
    /cliqu(ez|ant)\s+(ici|sur\s+le\s+bouton).{0,60}(confirm|valid|d[ée]bloqu)/,
  ]
  return patterns.some(p => p.test(text))
}

// Détecte "vous vous êtes trompé de cible / ce n'est pas notre activité".
// = mauvais secteur de prospection → RISQUE LÉGAL + prospect agacé → blocklist immédiate,
//   jamais de réponse, direction onglet Négatives.
export function isWrongTarget(body: string): boolean {
  const t = (body || '').toLowerCase()
  const patterns = [
    /ne sommes pas une (entreprise|soci[eé]t[eé])\s+(de|d')/,
    /(ce )?n'est pas (notre|mon|le bon) (activit[eé]|secteur|m[eé]tier|domaine)/,
    /(vous )?(vous )?tromp(ez|é|er) (d'|de )(entreprise|destinataire|soci[eé]t[eé]|cible|adresse|secteur)/,
    /(mauvais|pas le bon) (secteur|destinataire|interlocuteur|cible)/,
    /renseign(ez|er)[\s-]?vous sur (notre|mon|la|nos) (activit|soci|m[eé]tier)/,
    /(rien à voir|aucun rapport) avec (notre|mon|nos|mes|la)/,
    // ⚠️ RETIRÉ : /nous ne (faisons|travaillons|sommes) pas (dans|en|de|des)/ était TROP large
    // et blocklistait à tort un artisan qui décrit son périmètre ("on ne fait pas de neuf,
    // que de la réno" / "on ne travaille pas en dessous de X"). Blocklist = irréversible côté
    // séquence : on garde uniquement les tournures NON ambiguës de mauvaise cible ci-dessus.
    /vous vous adressez à la mauvaise/,
  ]
  return patterns.some(p => p.test(t))
}

// Detect opt-out without calling Claude (saves credits + faster)
function isOptOut(body: string, subject: string): boolean {
  const text = (body + ' ' + subject).toLowerCase().trim()
  const optOutPatterns = [
    /^stop\b/m,                                       // "Stop" / "STOP" en début de ligne
    /\bstop\b\s*[.!]?\s*$/m,                           // "... stop" en fin de message
    /^(d[ée]sinscri(re|ption)|unsubscribe|me d[ée]sabonner|ne plus recevoir|ne plus me contacter|ne plus contacter|plus de mail|plus d'email)/m,
    /merci de (me retirer|ne plus|stopper|cesser|me d[ée]sabonner)/,
    /souhait(e|ons) (ne plus|pas) [eê]tre contact/,
    // "cela/ce ne m'intéresse pas" — tournure explicite
    /ce(la|ci) ne m'int[eé]resse pas/,
    // "je ne suis / nous ne sommes pas intéressé(s)" — SAUF s'il enchaîne sur un pivot positif
    // ("pas intéressé par le SEO MAIS par la refonte") ou un report ("pas cette année, au printemps").
    /(je ne suis|nous ne sommes) pas int[eé]ress[eé]e?s?\b(?!.{0,60}(mais|cependant|par contre|en revanche|plus tard|cette ann[eé]e|au printemps|revoy|pour l'instant|pour le moment|par vos|par votre|par la|par le))/,
    // "ne m'intéresse pas" — même garde élargie (fenêtre 60 car., report + pivot).
    /ne m'int[eé]resse pas(?!.{0,60}(mais|cependant|par contre|en revanche|plus tard|cette ann[eé]e|au printemps|revoy|pour l'instant|pour le moment))/,
    // message de moins de 50 chars contenant "pas intéressé"
    ...(((body + ' ' + subject).toLowerCase().trim().length < 50)
      ? [/pas int[eé]ress[eé]e?\b/]
      : []),
    /me retirer de (votre|vos|la) (liste|base|mailing)/,
  ]
  return optOutPatterns.some(p => p.test(text))
}

export async function classifyReply(params: {
  replyBody: string
  replySubject: string
  originalEmailBody: string
  contactName: string
  contactCompany: string
  fromEmail?: string
}): Promise<ClassificationResult> {
  // CRITIQUE : on n'analyse QUE le vrai texte du prospect, jamais la citation
  // de notre email (qui contient "répondez Stop" → sinon faux opt-out).
  const cleanBody = stripQuotedReply(params.replyBody)

  // Défi anti-spam (SpamEnMoins & co) → jamais de réponse, jamais affiché (spam).
  if (isChallengeResponseSpam(params.replyBody, params.replySubject)) {
    return {
      classification: 'spam',
      action: 'no_action',
      confidence: 98,
      reasoning: 'Anti-spam challenge-response (type SpamEnMoins) détecté — ignoré, aucune réponse.',
    }
  }

  // Mauvaise cible ("on n'est pas maçon / ce n'est pas notre activité") → RISQUE LÉGAL.
  // Blocklist immédiate, aucune réponse, onglet Négatives.
  if (isWrongTarget(cleanBody)) {
    return {
      classification: 'desinterest',
      action: 'blocklist',
      confidence: 98,
      reasoning: 'Mauvaise cible / secteur incorrect signalé par le prospect — blocklist (aucune relance, risque légal).',
    }
  }

  // Réponse automatique (accusé de réception, absence, bot) → ignorer totalement
  if (isAutoResponder(cleanBody, params.replySubject, params.fromEmail ?? '')) {
    return {
      classification: 'oof',
      action: 'no_action',
      confidence: 98,
      reasoning: 'Réponse automatique détectée (accusé de réception / absence / bot) — ignorée, pas de brouillon.',
    }
  }

  // Plainte "mail vide / je n'ai rien reçu" → spam/no_action immédiat
  if (isEmptyEmailComplaint(cleanBody, params.replySubject)) {
    return {
      classification: 'spam',
      action: 'no_action',
      confidence: 97,
      reasoning: 'Plainte "mail vide / je n\'ai rien reçu" détectée — confusion sans valeur commerciale, aucune réponse générée.',
    }
  }

  // Détection opt-out rapide — UNIQUEMENT sur le texte réel du prospect
  if (isOptOut(cleanBody, params.replySubject)) {
    return {
      classification: 'desinterest',
      action: 'blocklist',
      confidence: 99,
      reasoning: 'Opt-out explicite détecté — ajout automatique à la blocklist.',
    }
  }

  const prompt = CLASSIFICATION_PROMPT
    .replace('{originalEmailBody}', params.originalEmailBody)
    .replace('{contactName}', params.contactName)
    .replace('{contactCompany}', params.contactCompany)
    .replace('{replySubject}', params.replySubject)
    .replace('{replyBody}', cleanBody)

  const text = await generateText({
    prompt,
    maxTokens: 400,
    temperature: 0.2, // classification = déterministe
  })

  const raw = extractJson<{
    classification: ReplyClassification
    action: ActionType
    confidence: number
    reasoning: string
    extractedDate?: string | null
    extractedName?: string | null
  }>(text)

  return {
    classification: raw.classification,
    action: raw.action,
    confidence: raw.confidence,
    reasoning: raw.reasoning,
    ...(raw.extractedDate ? { extractedDate: raw.extractedDate } : {}),
    ...(raw.extractedName ? { extractedName: raw.extractedName } : {}),
  }
}
