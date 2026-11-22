import type { SupabaseClient } from '@supabase/supabase-js'

/** App APIs need their own access gate; the /app layout cannot protect /api. */
import { isAdmitted } from '../beta/admission'

export type AccessClient = Pick<SupabaseClient, 'auth' | 'from'>

function denied(status: number, code: string, error: string, nextUrl?: string) {
  return { ok: false as const, response: Response.json({ ok: false, code, error, ...(nextUrl ? { nextUrl } : {}) }, { status }) }
}

/** Setup commands need a verified, admitted user before setup is complete. */
export async function requireSetupAccess(client: AccessClient, admitted: (userId: string) => Promise<boolean> = isAdmitted) {
  try {
    const { data: { user }, error } = await client.auth.getUser()
    if (error && (error.status ?? 0) >= 500) return denied(503, 'ACCESS_UNAVAILABLE', 'Your account could not be checked. Try again shortly.')
    if (error || !user) return denied(401, 'SIGN_IN_REQUIRED', 'Sign in to use your plan.', '/login')
    if (!user.email_confirmed_at) return denied(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email before using your plan.', '/check-email')
    if (!(await admitted(user.id))) return denied(403, 'NOT_ADMITTED', 'Roadmap is a private beta and this account has no valid invitation.', '/not-invited')
    return { ok: true as const, user }
  } catch {
    return denied(503, 'ACCESS_UNAVAILABLE', 'Your account could not be checked. Try again shortly.')
  }
}

export async function requireApplicationAccess(client: AccessClient, admitted: (userId: string) => Promise<boolean> = isAdmitted) {
  const access = await requireSetupAccess(client, admitted)
  if (!access.ok) return access
  try {
    const { data: profile, error: profileError } = await client.from('profiles').select('onboarding_status').eq('id', access.user.id).maybeSingle()
    if (profileError) return denied(503, 'ACCESS_UNAVAILABLE', 'Your setup could not be checked. Try again shortly.')
    if (profile?.onboarding_status !== 'complete') return denied(403, 'ONBOARDING_REQUIRED', 'Complete setup before using your plan.', '/onboarding')
    return access
  } catch {
    return denied(503, 'ACCESS_UNAVAILABLE', 'Your account could not be checked. Try again shortly.')
  }
}
