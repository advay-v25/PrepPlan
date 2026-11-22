import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { recoverActivation } from '../../../../lib/planning/activation/recoverActivation'
import { requireSetupAccess } from '../../../../lib/auth/applicationAccess'
import { rateLimit } from '../../../../lib/auth/securityServer'

/**
 * Activation recovery. POST only — a link prefetch or page render must never
 * create a draft. Restores or regenerates a versioned draft for review; it
 * does not commit tasks (acceptance is /api/onboarding/plan/confirm).
 */
export async function POST() {
  const supabase = await createClient()
  const access = await requireSetupAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access
  const limited = await rateLimit('study_activation', user.id)
  if (limited) return limited

  const requestId = crypto.randomUUID()
  try {
    const result = await recoverActivation(user.id)
    if (result.status === 'onboarding_incomplete') {
      return NextResponse.json({ ok: false, error: 'Finish setup first.', nextUrl: result.nextUrl, requestId }, { status: 409 })
    }
    return NextResponse.json({ ok: true, requestId, ...result })
  } catch (error: any) {
    console.error(`[activation/recover ${requestId}]`, error)
    return NextResponse.json(
      { ok: false, error: 'Could not prepare your week. Try again, or quote this reference to support.', requestId },
      { status: 500 },
    )
  }
}
