import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { createAdminClient } from '../supabase/admin'
import { boundedStage } from '../ops/requestBudget'
import { AUTH_PRIVATE_CACHE } from './requestSecurity'

export function equalSecret(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function hasBearer(request: Request, secret: string | undefined) {
  const auth = request.headers.get('authorization')
  return !!secret && !!auth && auth.startsWith('Bearer ') && equalSecret(auth.slice(7), secret)
}

function digest(purpose: string, value: string) {
  // The existing server credential keeps identifiers unlinkable without a new deployment dependency.
  const key = process.env.APP_SECURITY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!key || key.length < 32) throw new Error('Security key unavailable')
  return createHmac('sha256', key).update(purpose).update('\0').update(value).digest('hex')
}

type LimitScope =
  | 'auth_signin_ip' | 'auth_signin_shared'
  | 'auth_email_ip' | 'auth_email_shared' | 'auth_email_address'
  | 'auth_verify_ip' | 'auth_verify_shared'
  | 'study_activation' | 'paper_preflight' | 'paper_start' | 'account_export' | 'account_delete'

export async function rateLimit(scope: LimitScope, subject: string) {
  try {
    const { data, error } = await boundedStage('security rate limit', 8000, async () =>
      await createAdminClient().rpc('security_take_rate_limit', { p_scope: scope, p_subject_hash: digest(scope, subject) }))
    if (error || !Number.isInteger(data) || data < 0) throw new Error('Rate limit unavailable')
    if (data === 0) return null
    const message = 'Too many requests. Wait a little and try again.'
    return Response.json({ ok: false, code: 'RATE_LIMITED', error: message, message }, {
      status: 429, headers: { 'Retry-After': String(data), 'Cache-Control': AUTH_PRIVATE_CACHE },
    })
  } catch {
    console.error('[auth] request quota unavailable', scope)
    const message = 'Roadmap could not check this request. Try again shortly.'
    return Response.json({ ok: false, code: 'SECURITY_UNAVAILABLE', error: message, message }, {
      status: 503, headers: { 'Retry-After': '10', 'Cache-Control': AUTH_PRIVATE_CACHE },
    })
  }
}

export function authNetworkLimit(request: Request, action: 'signin' | 'email' | 'verify') {
  // Vercel supplies this at its ingress. A generic client-supplied forwarding header is never accepted as identity.
  const ip = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.trim() : undefined
  return ip && isIP(ip) ? rateLimit(`auth_${action}_ip`, ip) : rateLimit(`auth_${action}_shared`, 'shared')
}

const recoveryIntent = z.object({ id: z.uuid(), expires: z.number().int(), address: z.string().regex(/^[0-9a-f]{64}$/) })

export function makeRecoveryIntent(email: string, now = Date.now()) {
  const value = Buffer.from(JSON.stringify({ id: randomUUID(), expires: now + 30 * 60_000, address: digest('recovery-address', email) })).toString('base64url')
  return `${value}.${digest('recovery-intent', value)}`
}

export function readRecoveryIntent(token: string, now = Date.now()) {
  if (token.length > 512 || !/^[\w-]+\.[a-f0-9]{64}$/.test(token)) return null
  const [value, signature] = token.split('.')
  if (!equalSecret(signature, digest('recovery-intent', value))) return null
  try {
    const claims = recoveryIntent.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    return claims.success && claims.data.expires > now ? claims.data : null
  } catch { return null }
}

export function matchesRecoveryAddress(intent: NonNullable<ReturnType<typeof readRecoveryIntent>>, email: string) {
  return equalSecret(intent.address, digest('recovery-address', email.trim().toLowerCase()))
}

export async function recoveryGrant(action: 'open' | 'check' | 'take', userId: string, sessionId: string, requestId?: string) {
  const { data, error } = await boundedStage('recovery grant', 8000, async () =>
    await createAdminClient().rpc('security_password_recovery', {
      p_action: action, p_user: userId, p_session: sessionId, ...(requestId ? { p_request: requestId } : {}),
    }))
  if (error) throw new Error('Recovery grant unavailable')
  return data === true
}

export async function sessionIsActive(userId: string, sessionId: string) {
  const { data, error } = await boundedStage('active session', 8000, async () =>
    await createAdminClient().rpc('security_session_is_active', { p_user: userId, p_session: sessionId }))
  if (error) throw new Error('Active session check unavailable')
  return data === true
}
