import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cron-auth'
import { wrapCron } from '@/lib/cron-wrap'
import { isExplicitOptOut, isRgpdRequestOrComplaint, stripOurFooterAndQuotes } from '@/lib/rgpd'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * TEST DE LA DÉTECTION D'OPPOSITION — le filet qui manquait complètement.
 *
 * ⚠️ Ce projet n'avait AUCUN test sur ses deux fonctions les plus critiques, alors que ce sont
 * elles qui ont produit ses deux pires incidents : des « Stop » ignorés pendant cinq jours (motif
 * de la plainte CNIL du 06/08), puis l'inverse le 10/08 — un prospect répondant « appelez-moi ! »
 * blocklisté parce que notre propre pied de page était analysé comme s'il l'avait écrit.
 *
 * DEUX FAMILLES D'ERREUR, À NE JAMAIS CONFONDRE, parce qu'elles ne coûtent pas la même chose :
 *   • OPPOSITION MANQUÉE  → on continue d'écrire à quelqu'un qui a dit stop. Faute RGPD.
 *   • FAUX POSITIF        → un lead chaud est blocklisté et sa séquence annulée. Client perdu,
 *                            en silence, sans que rien n'apparaisse nulle part.
 *
 * L'endpoint renvoie 500 si un seul cas échoue : un appel automatique peut ainsi le remonter sans
 * que quiconque ait à lire le détail.
 *
 * ⚠️ Il fait AUSSI un balayage des vraies réponses reçues, et c'est le plus important : des cas de
 * test inventés ne prouvent que ce qu'on a pensé à écrire. Le balayage, lui, répond à « est-ce que
 * ce défaut existe DANS MES DONNÉES ? » — la seule question qui compte.
 */

type Cas = { texte: string; optout: boolean; rgpd: boolean; pourquoi: string }

const CAS: Cas[] = [
  // --- Oppositions simples, écriture normale ---
  { texte: 'Stop', optout: true, rgpd: false, pourquoi: 'le mot seul' },
  { texte: 'Merci de me désabonner de votre liste.', optout: true, rgpd: false, pourquoi: 'désabonnement classique' },
  { texte: 'Je ne souhaite plus recevoir vos mails.', optout: true, rgpd: false, pourquoi: 'formulation la plus fréquente' },
  { texte: 'Arrêtez de m\'envoyer des mails svp', optout: true, rgpd: false, pourquoi: 'impératif' },
  { texte: 'Retirez-moi de votre fichier.', optout: true, rgpd: false, pourquoi: 'retrait du fichier' },

  // --- ACCENTS CASSÉS (U+FFFD) : la famille qui mettait la fonction en défaut ---
  { texte: 'Merci de me d�sabonner', optout: true, rgpd: false, pourquoi: 'mojibake sur désabonner' },
  { texte: 'Arr�tez de m\'�crire', optout: true, rgpd: false, pourquoi: 'mojibake sur arrêtez et écrire' },
  { texte: 'Je m\'oppose au traitement de mes donn�es', optout: false, rgpd: true, pourquoi: 'opposition RGPD en mojibake' },

  // --- Apostrophe courbe (tout clavier mobile la produit) ---
  { texte: 'Arrêtez de m’écrire.', optout: true, rgpd: false, pourquoi: 'apostrophe typographique' },
  { texte: 'Je m’oppose à ce démarchage.', optout: false, rgpd: true, pourquoi: 'opposition, apostrophe courbe' },

  // --- Demandes RGPD (traitement renforcé, jamais de réponse auto) ---
  { texte: 'Supprimez mes données immédiatement.', optout: false, rgpd: true, pourquoi: 'droit à l\'effacement' },
  { texte: 'Je vais porter plainte à la CNIL.', optout: false, rgpd: true, pourquoi: 'plainte CNIL' },
  { texte: 'C\'est du spam, arrêtez.', optout: true, rgpd: true, pourquoi: 'accusation de spam' },

  // --- FAUX POSITIFS : ne doivent JAMAIS être pris pour une opposition ---
  { texte: 'Bonjour, nous travaillons non-stop en ce moment, rappelez en septembre.', optout: false, rgpd: false, pourquoi: '« non-stop » n\'est pas un stop' },
  { texte: 'Oui je suis très intéressé, appelez-moi !', optout: false, rgpd: false, pourquoi: 'le lead le plus chaud possible' },
  { texte: 'Pas intéressé pour le moment, merci.', optout: false, rgpd: false, pourquoi: 'désintérêt commercial ≠ opposition' },
  { texte: 'Votre offre ne correspond pas à nos besoins.', optout: false, rgpd: false, pourquoi: 'refus commercial simple' },

  // --- NOTRE PROPRE PIED DE PAGE CITÉ : le bug du 10/08 ---
  {
    texte: [
      'Oui ça m\'intéresse, appelez-moi cette semaine !',
      '',
      'Le 10 août 2026, Hdigiweb a écrit :',
      '> Vos coordonnées professionnelles proviennent de sources publiques.',
      '> Conformément au RGPD, vous pouvez demander leur suppression.',
      '> Pour ne plus recevoir mes emails, répondez simplement "Stop".',
    ].join('\n'),
    optout: false, rgpd: false,
    pourquoi: 'lead chaud citant notre bloc légal — ni opt-out ni demande RGPD',
  },
  {
    texte: [
      'Bonjour, oui volontiers pour un rendez-vous.',
      'Le 10 ao�t 2026, Hdigiweb a �crit :',
      'Pour ne plus recevoir mes emails, r�pondez simplement "Stop".',
    ].join('\n'),
    optout: false, rgpd: false,
    pourquoi: 'même cas, marqueur de citation en mojibake',
  },
]

async function handler(req: NextRequest) {
  const auth = checkCronAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const oppositionsManquees: string[] = []
  const fauxPositifs: string[] = []
  const detail: Array<Record<string, unknown>> = []

  for (const c of CAS) {
    const oo = isExplicitOptOut(c.texte)
    const rg = isRgpdRequestOrComplaint(c.texte)
    const okOo = oo === c.optout
    const okRg = rg.match === c.rgpd
    if (!okOo || !okRg) {
      // Manqué une opposition réelle vs inventé une opposition : deux fautes différentes.
      const manque = (c.optout && !oo) || (c.rgpd && !rg.match)
      const inv = (!c.optout && oo) || (!c.rgpd && rg.match)
      if (manque) oppositionsManquees.push(`${c.pourquoi} — « ${c.texte.slice(0, 60)} »`)
      if (inv) fauxPositifs.push(`${c.pourquoi} — « ${c.texte.slice(0, 60)} »`)
      detail.push({
        cas: c.pourquoi, texte: c.texte.slice(0, 90),
        attendu: { optout: c.optout, rgpd: c.rgpd },
        obtenu: { optout: oo, rgpd: rg.match, motif: rg.motif },
        apres_nettoyage: stripOurFooterAndQuotes(c.texte).slice(0, 90),
      })
    }
  }

  // BALAYAGE DES VRAIES RÉPONSES — un cas de test ne prouve que ce qu'on a pensé à écrire.
  const { sql } = await import('@/lib/db')
  const reelles = (await sql`
    SELECT id, from_email, body FROM incoming_replies
    -- ⚠️ created_at, PAS received_at : la colonne n'existe pas dans ce schéma. Quatrième requête
    -- écrite de mémoire aujourd'hui qui se casse sur un nom de colonne. Relire le schéma, toujours.
    WHERE body IS NOT NULL AND created_at > NOW() - INTERVAL '120 days'
    ORDER BY created_at DESC
    LIMIT 1000
  `) as Array<{ id: string; from_email: string | null; body: string }>

  const abimees = reelles.filter(r => r.body.includes('�'))
  // Parmi les réponses aux accents cassés : lesquelles sont des oppositions ? Avant le correctif
  // elles étaient invisibles. C'est le chiffre qui dit si le défaut était théorique ou réel.
  const opposLatentes = abimees
    .filter(r => isExplicitOptOut(r.body) || isRgpdRequestOrComplaint(r.body).match)
    .map(r => ({ de: r.from_email, extrait: r.body.replace(/\s+/g, ' ').slice(0, 120) }))

  const ok = oppositionsManquees.length === 0 && fauxPositifs.length === 0
  return NextResponse.json({
    ok,
    cas_testes: CAS.length,
    reussis: CAS.length - detail.length,
    oppositions_manquees: oppositionsManquees,
    faux_positifs: fauxPositifs,
    echecs: detail,
    donnees_reelles: {
      reponses_examinees: reelles.length,
      avec_accents_casses: abimees.length,
      dont_oppositions_detectees_grace_au_correctif: opposLatentes.length,
      exemples: opposLatentes.slice(0, 5),
    },
  }, { status: ok ? 200 : 500 })
}

export const GET = wrapCron('test-optout', handler)
