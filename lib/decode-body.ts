/**
 * Filet de sécurité base64.
 *
 * Certains clients mail (mobiles surtout) encodent le corps en
 * `Content-Transfer-Encoding: base64`. Si le parser MIME rate cet encodage
 * (structure multipart imbriquée, en-tête mal placé…), on se retrouve avec un
 * gros bloc de lettres illisible stocké tel quel → l'IA lit du charabia et
 * répond n'importe quoi, et le client voit du base64 dans la messagerie.
 *
 * Cette fonction détecte un bloc base64 et le décode. Elle est SANS DANGER sur
 * du texte normal : un vrai message contient des espaces (0x20), or le base64
 * replié n'en contient jamais (il utilise des CRLF) → on ne touche pas au texte.
 */
export function recoverBase64(text: string): string {
  const trimmed = (text || '').trim()
  if (trimmed.length < 24) return text
  // Un vrai texte contient des espaces ; le base64 non. → présence d'espace = on ne touche à rien.
  if (/ /.test(trimmed)) return text
  const compact = trimmed.replace(/\s+/g, '')
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return text
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf-8')
    if (!decoded) return text
    const printable = decoded.replace(/[^\t\n\r\x20-\x7E -￿]/g, '')
    const looksLikeText =
      printable.length / decoded.length > 0.9 &&
      /[a-zA-Zàâäéèêëîïôöùûüç]/.test(decoded) &&
      / /.test(decoded) // le texte décodé doit, lui, contenir des espaces
    return looksLikeText ? decoded.trim() : text
  } catch {
    return text
  }
}
