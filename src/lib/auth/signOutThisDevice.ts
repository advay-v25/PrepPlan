import { authRequest } from './authRequest'

export async function signOutThisDevice() {
  try {
    const result = await authRequest('signout')
    if (result.ok) return { ok: true as const }
    return { ok: false as const, sessionUnavailable: result.status === 502, message: result.data?.error ?? 'PrepPlan could not confirm sign-out. Reload to check your session.' }
  } catch {
    return { ok: false as const, sessionUnavailable: false, message: 'PrepPlan could not confirm sign-out. Reload to check your session.' }
  }
}
