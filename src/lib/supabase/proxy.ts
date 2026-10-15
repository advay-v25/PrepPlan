import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll(cookies) { cookies.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } } })
  const { data } = await supabase.auth.getClaims()
  const isDemo = process.env.NODE_ENV !== 'production' && request.nextUrl.searchParams.get('demo') === '1'
  const protectedRoute = request.nextUrl.pathname === '/app' || request.nextUrl.pathname.startsWith('/app/') || request.nextUrl.pathname === '/onboarding' || request.nextUrl.pathname.startsWith('/onboarding/')
  if (!data?.claims && protectedRoute && !isDemo) {
    const url = request.nextUrl.clone(); url.pathname = '/login'; url.search = ''; url.searchParams.set('next', request.nextUrl.pathname)
    const redirect = NextResponse.redirect(url)
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    return redirect
  }
  return response
}
