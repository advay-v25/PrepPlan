import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { getSignals } from '../../../lib/signals/signals-loader'
import { getCoachEvidencePack } from '../../../lib/signals/coachPack'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

/** The four preparation signals (and, with ?include=coach, the Coach's evidence pack). Read-only. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user
  try {
    const signals = await getSignals(user.id)
    const coach = new URL(request.url).searchParams.get('include') === 'coach' ? await getCoachEvidencePack(user.id) : undefined
    return NextResponse.json({ ok: true, signals, coach })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error(`[signals ${requestId}]`, error)
    return NextResponse.json({ ok: false, error: 'Could not load your signals.', requestId }, { status: 500 })
  }
}
