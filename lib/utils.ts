export function formatDistanceToNow(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Date dans le FUTUR (ex: RDV à venir, relance programmée) → "dans X"
  if (diff < 0) {
    const m = Math.floor(-diff / 60000)
    const h = Math.floor(-diff / 3600000)
    const d = Math.floor(-diff / 86400000)
    if (m < 1) return "à l'instant"
    if (m < 60) return `dans ${m} min`
    if (h < 24) return `dans ${h}h`
    if (d === 1) return 'demain'
    return `dans ${d}j`
  }

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 60) return `il y a ${minutes} min`
  if (hours < 24) return `il y a ${hours}h`
  if (days === 1) return 'hier'
  return `il y a ${days}j`
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * RETIRE LES EMOJIS DES NOMS D'ENTREPRISE SCRAPÉS.
 *
 * ⚠️ Les fiches Google sont truffées d'emojis mis là pour attirer l'oeil dans les résultats :
 * « 🥇Dallau Couverture », « ✅Ferre Toiture », « 👷 Maçon 🧱 ». Stockés bruts, ils ressortent
 * partout — dans l'interface que le client regarde, et surtout DANS LES MAILS envoyés en son nom.
 * Un mail qui commence par « Bonjour 🥇Dallau Couverture » ne fait pas sérieux, et c'est le client
 * qui le porte.
 *
 * On nettoie aussi la ponctuation orpheline que le retrait laisse derrière lui : parenthèses vides,
 * espaces avant une virgule, doubles espaces. Sinon on remplace un emoji par une coquille.
 */
/** La classe de caractères « emoji », partagée par les deux nettoyages ci-dessous. */
const EMOJIS = /[\u{1F000}-\u{1FAFF}\u{1FB00}-\u{1FBFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu

/**
 * VERSION POUR TEXTE MIS EN FORME (corps de mail) : retire les emojis, ET RIEN D'AUTRE.
 *
 * ⚠️ `stripEmojis` ci-dessous normalise les espaces avec `\s{2,}` — or `\s` couvre le RETOUR À LA
 * LIGNE. Appliqué à un corps de mail, il transforme les sauts de paragraphe en simples espaces et
 * aplatit tout le message en un bloc. L'aperçu l'a montré : 4 989 des 4 995 mails en attente
 * étaient « modifiés », alors qu'aucun ne contenait d'emoji — c'était leur mise en page qui partait.
 *
 * Un nom d'entreprise tient sur une ligne, pas un mail. Deux usages, deux fonctions.
 */
export function stripEmojisPreservingLayout(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(EMOJIS, '').replace(/[ \t]{2,}/g, ' ')
}

export function stripEmojis(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(EMOJIS, '')
    .replace(/\(\s+/g, '(')
    /**
     * ⚠️ NE PAS TOUCHER À L'ESPACE AVANT ; : ! ? — IL EST CORRECT EN FRANÇAIS.
     *
     * La version d'origine de ce nettoyage retirait l'espace devant toute ponctuation. L'aperçu sur
     * la base l'a montré tout de suite : « Aqua pensez-vous ? » devenait « Aqua pensez-vous? », et
     * « Couvreur Gers : AK Toiture » perdait son espace. Pire, la règle touchait 4 989 des 4 995
     * mails en attente — dont AUCUN ne contenait le moindre emoji. On aurait dégradé la typographie
     * de toute la file d'envoi pour corriger 83 noms d'entreprise.
     *
     * On ne recolle donc que la ponctuation qui, en français, ne prend jamais d'espace avant :
     * la parenthèse et le crochet fermants, le point et la virgule.
     */
    .replace(/\s+([)\].,])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
