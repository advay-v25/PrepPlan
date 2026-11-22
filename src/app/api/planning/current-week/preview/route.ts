import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { getOrCreateCurrentWeekProposal } from '../../../../../lib/planning/currentWeek/service'
import { getOrCreateClassRecovery } from '../../../../../lib/planning/classRecovery'

export const dynamic = 'force-dynamic'

/**
 * Prepares (or reuses) a versioned proposal for the student's EXISTING cycle. Reads the week and writes one draft; never a task.
 * `{ reason: 'class_change', change: <operation key of a saved class change> }` prepares the reviewed adjustment of EXISTING tasks for that
 * change instead of an empty-week plan; any other reason is refused. No body keeps the original empty-week behaviour.
 */
export async function POST(req: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const body = await req.json().catch(() => ({}))
  try {
    if (body && typeof body === 'object' && body.reason !== undefined) {
      if (body.reason !== 'class_change' || typeof body.change !== 'string') return NextResponse.json({ ok: false, code: 'BAD_REQUEST', error: 'Unknown plan reason.' }, { status: 400 })
      const r = await getOrCreateClassRecovery(access.user.id, body.change)
      if (r.status === 'unknown_change') return NextResponse.json({ ok: false, code: 'NOT_FOUND', error: 'That class change was not found.' }, { status: 404 })
      return NextResponse.json({ ok: true, reason: 'class_change', ...r })
    }
    const proposal = await getOrCreateCurrentWeekProposal(access.user.id)
    return NextResponse.json({ ok: true, ...proposal })
  } catch (error) {
    console.error('Current-week preview failed:', error)
    return NextResponse.json({ ok: false, code: 'PREVIEW_FAILED', error: 'We could not prepare a plan just now. Nothing was changed. Try again.' }, { status: 500 })
  }
}
