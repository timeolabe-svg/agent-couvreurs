import { createHmac, timingSafeEqual } from 'crypto'

/**
 * JETON DE DÉSABONNEMENT — signé, sans aucun stockage.
 *
 * Le jeton porte l'adresse ET une signature HMAC calculée avec `CRON_SECRET`. Aucune table à
 * gérer, aucune expiration à surveiller, et surtout : un lien reste valide indéfiniment. Un
 * prospect qui retrouve un vieux mail dans six mois doit pouvoir se désinscrire — un lien périmé
 * le renverrait vers « Signaler comme spam », exactement ce qu'on cherche à éviter.
 *
 * ⚠️ La signature n'est PAS décorative. Sans elle, l'adresse serait en clair dans l'URL et
 * n'importe qui pourrait désinscrire n'importe quel prospect en devinant le format — ou pire,
 * inscrire en masse des adresses sur la blocklist du client.
 *
 * ⚠️ On ne met jamais l'adresse en clair dans l'URL : les URL fuient (journaux serveur, Referer,
 * historique). base64url n'est pas du chiffrement, mais évite qu'une adresse traîne lisible dans
 * les logs d'accès.
 */

function cle(): string {
  const s = process.env.CRON_SECRET
  if (!s) throw new Error('CRON_SECRET absent : impossible de signer un lien de désabonnement')
  return s
}

function signature(charge: string): string {
  return createHmac('sha256', cle()).update(charge).digest('base64url').slice(0, 24)
}

export function creerJetonDesabo(email: string): string {
  const charge = Buffer.from(email.trim().toLowerCase(), 'utf8').toString('base64url')
  return `${charge}.${signature(charge)}`
}

/** Retourne l'adresse si le jeton est authentique, sinon null. Jamais d'exception vers l'appelant. */
export function lireJetonDesabo(jeton: string): string | null {
  try {
    const [charge, sig] = String(jeton ?? '').split('.')
    if (!charge || !sig) return null
    const attendue = signature(charge)
    // Comparaison à temps constant : une comparaison naïve laisse deviner la signature octet par
    // octet. Le coût est nul, l'omission est une faille classique.
    const a = Buffer.from(sig)
    const b = Buffer.from(attendue)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const email = Buffer.from(charge, 'base64url').toString('utf8')
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
  } catch {
    return null
  }
}
