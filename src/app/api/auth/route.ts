import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { AuthError } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient, clearSessionCookies } from '../../../lib/supabase/server'
import { budgetFetch, boundedStage } from '../../../lib/ops/requestBudget'
import { trace } from '../../../lib/ops/trace'
import { GOOGLE_SIGN_IN_ENABLED, passwordRule, TURNSTILE_SITE_KEY, VERIFICATION_TYPES } from '../../../lib/auth/authPolicy'
import { authDestination } from '../../../lib/auth/redirect'
import { AUTH_PRIVATE_CACHE, authOrigin, JsonInputError, readBoundedJson, sessionCookieOptions } from '../../../lib/auth/requestSecurity'
import { authNetworkLimit, cleanEnv, makeRecoveryIntent, matchesRecoveryAddress, rateLimit, readRecoveryIntent, recoveryGrant } from '../../../lib/auth/securityServer'
import { verifiedSession } from '../../../lib/auth/recoverySession'

const email = z.string().trim().toLowerCase().max(254).email()
const password = z.string().min(1).max(1024)
const captchaToken = z.string().min(1).max(4096).optional()
const next = z.string().max(2048).optional()

const input = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('login'), email, password, captchaToken, next }),
  z.strictObject({ action: z.literal('signup'), email, password, captchaToken, name: z.string().trim().min(1).max(100), accepted: z.literal(true) }),
  z.strictObject({ action: z.literal('forgot'), email, captchaToken }),
  z.strictObject({ action: z.literal('resend'), email, captchaToken }),
  z.strictObject({ action: z.literal('verify'), type: z.enum(VERIFICATION_TYPES), tokenHash: z.string().regex(/^[A-Za-z0-9_-]{20,256}$/), intent: z.string().max(512).optional(), next }),
  z.strictObject({ action: z.literal('update'), password }),
  z.strictObject({ action: z.literal('signout') }),
  z.strictObject({ action: z.literal('google'), next }),
])

function reply(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': AUTH_PRIVATE_CACHE, ...headers } })
}

function provider(action: string, error?: AuthError | null) {
  // Record the outcome only. The provider message, credentials and redirect are never logged.
  trace('auth', action, { result: error ? 'refused' : 'ok', status: error?.status ?? null })
}

function providerFailure(error: AuthError) {
  if (error.status === 429) return reply({ error: 'Too many requests. Wait a little and try again.' }, 429, { 'Retry-After': '60' })
  if (error.status === 0 || (error.status ?? 0) >= 500) return reply({ error: 'Sign-in is temporarily unavailable. Try again shortly.' }, 503)
  return null
}

function mailClient() {
  const anonKey = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL)
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: budgetFetch(fetch) },
  })
}

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let payload: unknown
  try { payload = await readBoundedJson(request, 12 * 1024) }
  catch (error) {
    if (error instanceof JsonInputError) return reply({ error: error.message }, error.status)
    return reply({ error: 'PrepPlan could not read this request.' }, 400)
  }
  const parsed = input.safeParse(payload)
  if (!parsed.success) return reply({ error: 'Check the details and try again.' }, 400)
  const data = parsed.data
  const origin = authOrigin(request)
  if (!origin) return reply({ error: 'This address is not configured for PrepPlan sign-in.' }, 503)

  try {
    if (data.action === 'signout') {
      try {
        const supabase = await createClient()
        const { error } = await boundedStage('sign out', 10_000, () => supabase.auth.signOut({ scope: 'local' }))
        if (error) return reply({ error: 'This browser has been signed out. PrepPlan could not confirm that its session was revoked.' }, 502)
        return reply({ ok: true })
      } catch {
        return reply({ error: 'This browser has been signed out. PrepPlan could not confirm that its session was revoked.' }, 502)
      } finally { await clearSessionCookies() }
    }

    if (data.action === 'update') {
      const rule = passwordRule(data.password)
      if (rule) return reply({ error: rule }, 400)
      const supabase = await createClient()
      const session = await verifiedSession(supabase)
      if (!session || !(await recoveryGrant('take', session.userId, session.id))) {
        return reply({ error: 'Start again from a new password-reset email.', code: 'RECOVERY_REQUIRED' }, 403)
      }
      let saved = false
      try {
        const { error } = await boundedStage('update password', 12_000, () => supabase.auth.updateUser({ password: data.password }))
        provider('password_update', error)
        if (error && error.status && error.status < 500) {
          return reply({ error: 'Your password was refused. Request a new link and choose a different password.', code: 'RECOVERY_REQUIRED' }, 400)
        }
        if (error) throw new Error('Password update not confirmed')
        saved = true
        const { error: signOutError } = await boundedStage('revoke sessions', 10_000, () => supabase.auth.signOut({ scope: 'global' }))
        return reply({ ok: true, next: signOutError ? '/login?reset=sessions' : '/login?reset=success' })
      } catch {
        if (saved) return reply({ ok: true, next: '/login?reset=sessions' })
        return reply({ error: 'PrepPlan could not confirm the password change. Try signing in with the new password, or request a new reset email.', code: 'RESET_OUTCOME_UNKNOWN' }, 502)
      } finally { await clearSessionCookies() }
    }

    if (data.action === 'verify') {
      const limited = await authNetworkLimit(request, 'verify')
      if (limited) return limited
      const invalidLink = () => reply({ error: 'This email link is invalid or has expired. Request a new link and try again.', code: 'INVALID_LINK' }, 400)
      const supabase = await createClient()
      if (data.type === 'recovery') {
        // Supabase shares recovery-token storage with magic links. The signed email intent is the Roadmap-specific recovery proof.
        const intent = data.intent ? readRecoveryIntent(data.intent) : null
        if (!intent) return invalidLink()
        const isolated = mailClient()
        const { data: result, error } = await boundedStage('verify recovery email', 12_000, () =>
          isolated.auth.verifyOtp({ token_hash: data.tokenHash, type: 'recovery' }))
        provider('verify_recovery', error)
        if (error) return providerFailure(error) ?? invalidLink()
        if (!result.user?.email || !result.session || !matchesRecoveryAddress(intent, result.user.email)) return invalidLink()
        const session = await verifiedSession(isolated, result.session.access_token)
        if (!session || session.userId !== result.user.id || !(await recoveryGrant('open', session.userId, session.id, intent.id))) return invalidLink()
        const { error: sessionError } = await boundedStage('install recovery session', 10_000, () => supabase.auth.setSession({
          access_token: result.session!.access_token, refresh_token: result.session!.refresh_token,
        }))
        if (sessionError) throw new Error('Recovery session unavailable')
        return reply({ ok: true, next: '/update-password' })
      }
      const { data: result, error } = await boundedStage('verify email', 12_000, () =>
        supabase.auth.verifyOtp({ token_hash: data.tokenHash, type: data.type }))
      provider('verify_email', error)
      if (error) return providerFailure(error) ?? invalidLink()
      if (!result.session || !result.user?.email_confirmed_at) return invalidLink()
      const destination = data.type === 'signup' ? '/onboarding' : authDestination(data.next ?? null)
      return reply({ ok: true, next: destination })
    }

    if (data.action === 'google') {
      if (!GOOGLE_SIGN_IN_ENABLED) return reply({ error: 'Google sign-in is not configured. Use email to continue.' }, 404)
      const limited = await authNetworkLimit(request, 'signin')
      if (limited) return limited
      const supabase = await createClient()
      const { data: oauth, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: origin + '/auth/callback', scopes: 'openid email profile', skipBrowserRedirect: true },
      })
      const expected = new URL('/auth/v1/authorize', process.env.NEXT_PUBLIC_SUPABASE_URL)
      const destination = oauth.url ? new URL(oauth.url) : null
      if (error || !destination || destination.origin !== expected.origin || destination.pathname !== expected.pathname) {
        return reply({ error: 'Google sign-in could not start. Try again or use email.' }, 503)
      }
      const cookieStore = await cookies()
      cookieStore.set('roadmap-oauth-next', authDestination(data.next ?? null), { ...sessionCookieOptions(), maxAge: 600 })
      return reply({ ok: true, providerUrl: destination.href })
    }

    if (TURNSTILE_SITE_KEY && !data.captchaToken) return reply({ error: 'Complete the security check and try again.' }, 400)

    if (data.action === 'login') {
      const limited = await authNetworkLimit(request, 'signin')
      if (limited) return limited
      const supabase = await createClient()
      const { data: result, error } = await boundedStage('sign in', 12_000, () => supabase.auth.signInWithPassword({
        email: data.email, password: data.password, options: { captchaToken: data.captchaToken },
      }))
      provider('password_login', error)
      if (error) {
        if (error.code === 'captcha_failed') return reply({ error: 'The security check expired. Try it again.' }, 400)
        return providerFailure(error) ?? reply({ error: 'Sign-in did not work. Check your email and password, or verify your email first.' }, 401)
      }
      if (!result.user?.email_confirmed_at || !result.session) {
        await clearSessionCookies()
        return reply({ error: 'Sign-in did not work. Check your email and password, or verify your email first.' }, 401)
      }
      return reply({ ok: true, next: authDestination(data.next ?? null) })
    }

    if (data.action === 'signup') {
      const rule = passwordRule(data.password)
      if (rule) return reply({ error: rule }, 400)
    }
    const limited = await authNetworkLimit(request, 'email')
    if (limited) return limited
    const addressLimit = await rateLimit('auth_email_address', data.email)
    if (addressLimit) return addressLimit.status === 429 ? reply({ ok: true }, 202) : addressLimit
    const client = mailClient()
    const send = async () => {
      const options = { captchaToken: data.captchaToken, emailRedirectTo: origin + '/auth/verify' }
      if (data.action === 'signup') return client.auth.signUp({
        email: data.email, password: data.password, options: { ...options, data: { full_name: data.name } },
      })
      if (data.action === 'resend') return client.auth.resend({ type: 'signup', email: data.email, options })
      const intent = makeRecoveryIntent(data.email)
      return client.auth.resetPasswordForEmail(data.email, {
        captchaToken: data.captchaToken, redirectTo: origin + '/auth/verify#type=recovery&intent=' + intent,
      })
    }
    const { error } = await boundedStage('request auth email', 12_000, send)
    provider(data.action, error)
    if (error?.code === 'captcha_failed') return reply({ error: 'The security check expired. Try it again.' }, 400)
    // Duplicate, unknown, not admitted, provider mail limits and recipient-specific delivery errors have one outward result.
    return reply({ ok: true }, 202)
  } catch {
    trace('auth', 'unavailable', { action: data.action })
    return reply({ error: 'PrepPlan could not confirm the request. Wait a moment and try again.' }, 503)
  }
}
