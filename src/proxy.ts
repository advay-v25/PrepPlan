import { randomBytes } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/proxy'
import { appRequestRefusal } from './lib/auth/requestSecurity'

export async function proxy(request: NextRequest) {
  const refusal = appRequestRefusal(request)
  if (refusal) return refusal
  if (request.nextUrl.pathname.startsWith('/api/')) return updateSession(request)

  const nonce = randomBytes(18).toString('base64')
  const dev = process.env.NODE_ENV !== 'production'
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic' https://challenges.cloudflare.com" + (dev ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://challenges.cloudflare.com" + (dev ? ' ws: wss:' : ''),
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  return updateSession(request, csp)
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png).*)'] }
