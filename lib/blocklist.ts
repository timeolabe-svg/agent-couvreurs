/**
 * VÉRIFICATION DE BLOCKLIST — POINT UNIQUE, INSENSIBLE À LA CASSE.
 *
 * Avant ce fichier (03/09/2026, canal LinkedIn), quatre routes refaisaient chacune leur propre
 * requête, avec une divergence dangereuse : `autopilot-tick` comparait l'email en EXACT (sensible
 * à la casse), alors que le moteur d'invariants comparait en `LOWER(...)`. Un même contact pouvait
 * donc être jugé bloqué par l'un et pas par l'autre selon la casse de son adresse. On aligne tout
 * le monde sur la version la plus stricte — celle des invariants — pas sur la plus permissive.
 *
 * Doctrine reprise de LabegarIA : la blocklist vit au niveau PERSONNE, pas au niveau canal. Un
 * stop reçu par email doit aussi bloquer LinkedIn de la même personne, et réciproquement — d'où
 * la vérification simultanée sur email, domaine ET linkedin_url dans un seul appel.
 */

import { sql } from '@/lib/db'

/** Normalise toute variante d'URL LinkedIn en clé canonique `in/<slug>` (casse, www, sous-domaine
 *  pays, slash final, paramètres de requête). Sans ça, `in/jean-dupont`, `www.linkedin.com/in/
 *  Jean-Dupont/` et `fr.linkedin.com/in/jean-dupont?trk=...` seraient trois entrées différentes
 *  pour la même personne — un blocage posé sur l'une ne protégerait pas des deux autres. */
export function profileKey(url: string): string {
  const m = url.match(/linkedin\.com\/(in|company)\/([a-zA-Z0-9\-_%.]+)/i)
  if (m) return `${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase().replace(/\/$/, '')}`
  return url.trim().toLowerCase()
}

/**
 * Vrai si l'email, le domaine de l'email, OU le profil LinkedIn donné apparaît dans la blocklist.
 * Passer les DEUX quand on les connaît (un contact promu depuis le canal LinkedIn peut avoir les
 * deux) : un stop sur l'un doit bloquer l'autre pour la MÊME personne.
 */
export async function estBloque(params: { email?: string | null; linkedinUrl?: string | null }): Promise<boolean> {
  const email = params.email?.trim().toLowerCase() || null
  const domain = email?.split('@')[1] || null
  const linkedinUrl = params.linkedinUrl ? profileKey(params.linkedinUrl) : null

  if (!email && !linkedinUrl) return false // rien à vérifier : ni faux positif ni faux négatif

  const rows = await sql`
    SELECT 1 FROM blocklist
    WHERE (${email}::text IS NOT NULL AND LOWER(email) = ${email})
       OR (${domain}::text IS NOT NULL AND LOWER(domain) = ${domain})
       OR (${linkedinUrl}::text IS NOT NULL AND LOWER(linkedin_url) = ${linkedinUrl})
    LIMIT 1`
  return rows.length > 0
}
