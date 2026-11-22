import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient, clearSessionCookies } from '../../../lib/supabase/server'
import { authDestination } from '../../../lib/auth/redirect'
import { boundedStage } from '../../../lib/ops/requestBudget'
import { GOOGLE_SIGN_IN_ENABLED } from '../../../lib/auth/authPolicy'
import { sessionCookieOptions } from '../../../lib/auth/requestSecurity'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const store = await cookies()
  const pending = store.get('roadmap-oauth-next')?.value
  store.set('roadmap-oauth-next', '', { ...sessionCookieOptions(), maxAge: 0 })

  const providerError = url.searchParams.get('error')
  if (providerError) redirect(providerError === 'access_denied' ? '/auth/error?reason=cancelled' : '/auth/error?reason=provider')
  if (!GOOGLE_SIGN_IN_ENABLED || !pending || !code || code.length > 256) redirect('/auth/error?reason=missing_code')

  let destination = authDestination(pending)
  try {
    const supabase = await createClient()
    const { data, error } = await boundedStage('oauth callback', 12_000, () => supabase.auth.exchangeCodeForSession(code))
    if (error || !data.user?.email_confirmed_at || !data.session) {
      if (data.session) await clearSessionCookies()
      destination = '/auth/error?reason=expired'
    }
  } catch {
    destination = '/auth/error?reason=unavailable'
  }
  redirect(destination)
}
