/**
 * Filet de sécurité base64.
 *
 * Certains clients mail (mobiles surtout) encodent le corps en
 * `Content-Transfer-Encoding: base64`. Si le parser MIME rate cet encodage
 * (structure multipart imbriquée, en-tête mal placé…), on se retrouve avec un
 * gros bloc de lettres illisible stocké tel quel → l'IA lit du charabia et
 * répond n'importe quoi, et le client voit du base64 dans la messagerie.
 *
 * Détecte un bloc base64 et le décode. Discriminateur robuste : on tente le
 * décodage et on n'accepte QUE si le résultat est du vrai texte UTF-8 (peu de
 * caractères de contrôle / de remplacement). Un vrai message texte, décodé "par
 * erreur", produit des octets cassés → rejeté. Le base64 replié peut contenir
 * des espaces/retours à la ligne (soft-wrap) : on les retire avant analyse.
 */
export function recoverBase64(text: string): string {
  const compact = (text || '').replace(/\s+/g, '')
  // Assez long, alphabet base64 pur, longueur multiple de 4.
  if (compact.length < 32 || compact.length % 4 !== 0) return text
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return text

  let decoded: string
  try {
    decoded = Buffer.from(compact, 'base64').toString('utf-8')
  } catch {
    return text
  }
  if (!decoded) return text

  // Compte les caractères "cassés" : remplacement UTF-8 (U+FFFD = 65533) ou
  // caractère de contrôle hors tab/newline/CR. Un décodage de non-texte en est truffé.
  let broken = 0
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i)
    if (c === 65533 || (c < 0x20 && c !== 9 && c !== 10 && c !== 13)) broken++
  }
  if (broken / decoded.length > 0.02) return text

  // Doit ressembler à du vrai texte : au moins une lettre ET un blanc.
  if (!/[a-zA-Zà-ÿ]/.test(decoded) || !/\s/.test(decoded)) return text

  return decoded.trim()
}
