import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_PRIVATE_CACHE, sessionCookieOptions } from '../auth/requestSecurity'

export async function updateSession(request: NextRequest, contentPolicy?: string) {
  function passThrough() {
    const headers = new Headers(request.headers)
    if (contentPolicy) headers.set('Content-Security-Policy', contentPolicy)
    else headers.delete('Content-Security-Policy')
    return NextResponse.next({ request: { headers } })
  }

  const path = request.nextUrl.pathname
  const isProtected = ['/app', '/onboarding', '/account'].some(prefix => path === prefix || path.startsWith(prefix + '/'))
  const isAuth = ['/login', '/signup', '/check-email', '/forgot-password', '/update-password', '/api/auth', '/auth'].some(prefix => path === prefix || path.startsWith(prefix + '/'))
  const isAPI = path.startsWith('/api/')
  const isWorker = path === '/api/health' || path === '/api/reminders/run'
  let response = passThrough()
  let signedIn = false
  const hasSession = request.cookies.getAll().some(({ name }) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name))

  if (hasSession && !isWorker && !isAuth) {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies, headers) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value))
          response = passThrough()
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
        },
      },
    })
    const { data } = await supabase.auth.getClaims()
    signedIn = !!data?.claims
  }

  const isDemo = process.env.NODE_ENV !== 'production' && request.nextUrl.searchParams.get('demo') === '1'
  if (!signedIn && isProtected && !isDemo) {
    const next = request.nextUrl.pathname + request.nextUrl.search
    const destination = new URL('/login', request.url)
    destination.searchParams.set('next', next)
    const login = NextResponse.redirect(destination)
    response.cookies.getAll().forEach(cookie => login.cookies.set(cookie))
    response = login
  }

  if (contentPolicy) response.headers.set('Content-Security-Policy', contentPolicy)
  if (isProtected || isAuth || isAPI || hasSession) response.headers.set('Cache-Control', AUTH_PRIVATE_CACHE)
  if (isProtected || isAuth || isAPI || path === '/not-invited') response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  if (isAuth) response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
