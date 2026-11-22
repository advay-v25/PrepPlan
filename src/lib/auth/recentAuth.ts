/**
 * Proof that THIS session (not the account) authenticated recently. A Supabase access token carries `amr`: one entry per authentication method used to
 * establish the session, each with its own timestamp. Refreshing a token changes `iat` but adds no `amr` entry, and another device's sign-in changes
 * neither, so neither can make a stale session look fresh. Verify the token before trusting its claims.
 */
export const RECENT_AUTH_MINUTES = 10
export const AUTHENTICATING_METHODS = new Set(['password', 'otp', 'magiclink', 'oauth', 'sso/saml', 'totp', 'mfa/sms', 'mfa/phone', 'mfa/webauthn', 'recovery', 'invite'])

function authenticatedAt(amr: unknown) {
  if (!Array.isArray(amr)) return null
  const times = amr.filter(a => a && typeof a.method === 'string' && AUTHENTICATING_METHODS.has(a.method))
    .map(a => typeof a.timestamp === 'number' ? a.timestamp : NaN).filter(Number.isFinite)
  return times.length ? new Date(Math.max(...times) * 1000) : null
}

export const isRecentAuthClaim = (amr: unknown, now = new Date(), minutes = RECENT_AUTH_MINUTES) => {
  const at = authenticatedAt(amr)
  return !!at && at.getTime() <= now.getTime() + 60_000 && now.getTime() - at.getTime() <= minutes * 60_000
}

export function sessionAuthenticatedAt(accessToken: string | null | undefined): Date | null {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1] ?? '', 'base64url').toString('utf8')) as { amr?: { method?: string; timestamp?: number }[] }
    return authenticatedAt(payload.amr)
  } catch { return null }
}

export const isRecentSessionAuth = (accessToken: string | null | undefined, now = new Date(), minutes = RECENT_AUTH_MINUTES) => {
  const at = sessionAuthenticatedAt(accessToken)
  return !!at && at.getTime() <= now.getTime() + 60_000 && now.getTime() - at.getTime() <= minutes * 60_000
}
