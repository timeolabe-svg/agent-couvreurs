import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

/**
 * PROTECTION D'ACCÈS DE TOUT LE LOGICIEL.
 *
 * ⚠️ INCIDENT DU 25/08 — L'INTERRUPTEUR TEMPORAIRE QUI DURE 47 JOURS.
 *
 * Ce fichier commençait par `if (process.env.AUTH_DISABLED === '1') return NextResponse.next()`,
 * un contournement posé pour un dépannage début juillet. Il est resté. Résultat : pendant
 * quarante-sept jours, TOUT était public — le tableau de bord, les conversations, et surtout
 * `/api/leads` et `/api/rdv`, c'est-à-dire les noms, adresses e-mail et téléphones de plus de
 * trois mille entreprises démarchées. Sur un projet qui a déjà une plainte CNIL ouverte.
 *
 * Rien ne le signalait : aucune erreur, aucun voyant, et un écran de connexion qui n'apparaît pas
 * ressemble exactement à un écran de connexion déjà passé. Le contournement a donc été retiré.
 *
 * ⚠️ NE JAMAIS REMETTRE D'INTERRUPTEUR GLOBAL D'AUTHENTIFICATION. Pour un dépannage ponctuel, se
 * connecter — c'est le but du mot de passe.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  /**
   * ⚠️ LES APPELS MACHINE PORTENT DÉJÀ LEUR PREUVE : la clé `CRON_SECRET`.
   *
   * `/api/cron/*` est exclu par le matcher, mais les crons s'appellent aussi entre eux via
   * `/api/admin/*` (import Outscraper, partage hebdomadaire du vivier, plan de couverture). En
   * retirant le contournement, ces appels se sont mis à être redirigés vers la page de connexion —
   * une panne silencieuse de plus, puisqu'une redirection renvoie un code de succès.
   *
   * On laisse donc passer ce qui présente une clé valide, et UNIQUEMENT sous `/api/`. La règle est
   * la même que pour les crons : ce n'est pas une exception, c'est une seconde forme d'identité.
   *
   * ⚠️ Trois routes admin ne vérifiaient aucune clé (`preview-email`, `reclassify`,
   * `resend-broken`) : c'est précisément pour ça qu'on ne peut PAS ouvrir `/api/admin` en bloc.
   * Ici, sans clé valide, elles restent derrière le mot de passe.
   */
  if (pathname.startsWith('/api/')) {
    const secret = process.env.CRON_SECRET
    if (secret && secret.length >= 8) {
      const header = request.headers.get('authorization') ?? ''
      const fourni = header.replace(/^Bearer\s+/i, '').trim()
        || request.nextUrl.searchParams.get('key')
        || request.nextUrl.searchParams.get('token')
        || ''
      // Même tolérance que checkCronAuth : cron-job.org ajoute des suffixes aléatoires au jeton.
      const fixe = secret.split('%')[0]
      if (fourni === secret || (fixe.length >= 8 && fourni.startsWith(fixe))) {
        return NextResponse.next()
      }
    }
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Protège TOUT sauf :
     * - /login
     * - /api/auth/* (rappels NextAuth)
     * - /api/cron/* (protégé par CRON_SECRET)
     * - /_next/* (fichiers statiques)
     * - /favicon.ico
     */
    '/((?!login$|login/|api/auth/|api/cron/|_next/|favicon\\.ico$).*)',
  ],
}
