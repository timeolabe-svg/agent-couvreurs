import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function proxy(request: NextRequest) {
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
    '/((?!login|api/auth|api/cron|_next|favicon.ico).*)',
  ],
}
