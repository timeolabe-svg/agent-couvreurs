import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 🧪 RECETTE DES DÉTECTEURS — est-ce que les garde-fous RECONNAISSENT vraiment ce qu'ils doivent ?
 *
 * ⚠️ POURQUOI CET OUTIL EXISTE (26/08/2026). J'ai réparé trois expressions régulières aujourd'hui et
 * je n'en ai testé AUCUNE. J'ai vérifié qu'elles étaient présentes dans le fichier — pas qu'elles
 * fonctionnaient. C'est très exactement l'écart que Timéo me reproche depuis ce matin : « présent »
 * n'est pas « correct ».
 *
 * Et le risque est asymétrique. Un détecteur d'opt-out trop LARGE blockliste un lead chaud (on perd
 * de l'argent) ; trop ÉTROIT, il laisse partir une relance à quelqu'un qui a dit stop (on perd un
 * procès). Les deux erreurs se mesurent, donc les deux sont dans cette recette.
 *
 * Chaque cas porte l'incident réel dont il vient. Un cas rouge ici est un incident qui peut se
 * rejouer demain.
 */
async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { isExplicitOptOut, isRgpdRequestOrComplaint } = await import('@/lib/rgpd')
  const { partDeMotsRepris, SEUIL_REDITE } = await import('@/lib/utils')

  type Cas = { quoi: string; texte: string; attendu: boolean; origine: string }

  const OPT_OUT: Cas[] = [
    { quoi: 'stop seul sur sa ligne', texte: 'Bonjour,\nStop\nMerci', attendu: true,
      origine: 'la forme la plus courante : on salue avant de refuser' },
    { quoi: 'stop en fin de phrase polie', texte: 'Merci de ne plus me recontacter.', attendu: true,
      origine: 'refus impératif classique' },
    { quoi: 'desabonnez-moi', texte: 'Desabonnez moi de votre liste svp', attendu: true, origine: 'formulation directe' },
    { quoi: 'ne veux plus recevoir', texte: "Je ne veux plus recevoir vos mails.", attendu: true,
      origine: 'verbe conjugue avec « plus » postpose — famille ratee a l origine de la plainte CNIL' },
    { quoi: 'arretez tout court', texte: 'Arretez.', attendu: true, origine: 'message tres court' },
    // — les faux positifs qui coûtent un lead —
    { quoi: 'raison sociale contenant Stop', texte: 'Stop and Go SARL\n12 rue des Lilas', attendu: false,
      origine: 'une signature ne doit pas blocklister' },
    { quoi: 'interesse mais pas maintenant', texte: "Pas interesse pour l'instant, rappelez-moi en septembre.", attendu: false,
      origine: 'lead chaud : un report n est pas un refus' },
    { quoi: 'question neutre', texte: 'Bonjour, pouvez-vous me rappeler vos tarifs ?', attendu: false, origine: 'demande d information' },
    // — la famille « verbe conjugué entre NE et PLUS », et ses faux positifs —
    { quoi: 'ne veux plus etre contacte', texte: "Je ne veux plus etre contacte par vos services.", attendu: true,
      origine: 'verbe au milieu : le motif exigeait « ne plus » colles' },
    { quoi: 'ne desire plus recevoir', texte: 'Je ne desire plus recevoir de prospection.', attendu: true, origine: 'meme famille' },
    { quoi: "n'ai plus besoin", texte: "Je n'ai plus besoin de vos services, merci.", attendu: true, origine: 'meme famille' },
    { quoi: 'indisponible cette semaine', texte: 'Je ne suis plus disponible cette semaine, rappelez-moi lundi.', attendu: false,
      origine: 'UN REPORT N EST PAS UN REFUS — le piege si on ouvre « ne ... plus » sans verbe de contact' },
    { quoi: 'ne travaille plus le samedi', texte: 'Nous ne travaillons plus le samedi.', attendu: false,
      origine: 'information d exploitation, pas un refus' },
  ]

  const RGPD: Cas[] = [
    { quoi: 'demande d effacement', texte: 'Je vous demande de supprimer mes donnees de votre fichier.', attendu: true,
      origine: 'droit a l effacement' },
    { quoi: 'effacement avec mojibake', texte: 'Merci de supprimer mes donn�es personnelles.', attendu: true,
      origine: 'corps IMAP abime : le caractere perdu ne doit pas faire rater un refus' },
    { quoi: 'mention CNIL', texte: 'Je vais saisir la CNIL si cela continue.', attendu: true, origine: 'plainte annoncee' },
    { quoi: 'opposition', texte: "Je m oppose au traitement de mes donnees.", attendu: true,
      origine: 'apostrophe remplacee par un espace (clavier mobile)' },
    { quoi: 'accusation de spam seule', texte: "J'ai cru a un spam mais ca m'interesse.", attendu: false,
      origine: 'le mot spam seul ne doit pas blocklister un lead chaud' },
    { quoi: 'message commercial ordinaire', texte: 'Envoyez-moi une proposition chiffree.', attendu: false, origine: 'temoin' },
  ]

  const passe = (l: Cas[], f: (t: string) => boolean) => l.map(c => {
    const obtenu = f(c.texte)
    return { ...c, obtenu, ok: obtenu === c.attendu }
  })

  const optOut = passe(OPT_OUT, t => isExplicitOptOut(t))
  const rgpd = passe(RGPD, t => isRgpdRequestOrComplaint(t).match)

  /** Anti-répétition : deux relances ne doivent jamais redire la même chose. */
  const redite = [
    {
      quoi: 'texte identique', attendu: true,
      part: partDeMotsRepris(
        'Bonjour, je reviens vers vous au sujet de votre visibilite sur Google.',
        'Bonjour, je reviens vers vous au sujet de votre visibilite sur Google.'),
    },
    {
      quoi: 'texte different', attendu: false,
      part: partDeMotsRepris(
        'Bonjour, je reviens vers vous au sujet de votre visibilite sur Google.',
        'Avez-vous eu le temps de regarder le devis que je vous ai transmis la semaine derniere ?'),
    },
  ].map(c => ({ ...c, obtenu: c.part >= SEUIL_REDITE, ok: (c.part >= SEUIL_REDITE) === c.attendu }))

  const tous = [...optOut, ...rgpd]
  const echecs = [
    ...tous.filter(c => !c.ok).map(c => ({ famille: 'detection', ...c })),
    ...redite.filter(c => !c.ok).map(c => ({ famille: 'anti-repetition', ...c })),
  ]

  return NextResponse.json({
    ok: echecs.length === 0,
    resume: {
      total: tous.length + redite.length,
      reussis: tous.filter(c => c.ok).length + redite.filter(c => c.ok).length,
      ECHECS: echecs.length,
    },
    echecs,
    detail: { opt_out: optOut, rgpd, anti_repetition: redite },
  })
}

export const GET = handler
