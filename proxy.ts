import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function proxy(request: NextRequest) {
  // INTERRUPTEUR TEMPORAIRE : AUTH_DISABLED=1 → accès libre au dashboard (sans login).
  // Pour réactiver la connexion : supprimer la variable AUTH_DISABLED dans Vercel + redéployer.
  if (process.env.AUTH_DISABLED === '1') {
    return NextResponse.next()
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
     * Protect everything EXCEPT:
     * - /login
     * - /api/auth/* (next-auth callbacks)
     * - /api/cron/* (protected by CRON_SECRET)
     * - /_next/* (static files)
     * - /favicon.ico
     */
    '/((?!login$|login/|api/auth/|api/cron/|_next/|favicon\\.ico$).*)',
  ],
}
