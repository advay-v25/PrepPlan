import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { previewWeeklyTransition } from '../../../../lib/planning/weeklyReview/service'
import { withReadSnapshot } from '../../../../lib/ops/perRequest'
import { tagReads } from '../../../../lib/ops/readTrace'

export const dynamic = 'force-dynamic'

/**
 * Turns the student's answers into a proposed next week and saves it as a draft. POST only, and it changes
 * nothing the student can see: no task, cycle or week is touched until the draft is accepted.
 * Body: { cycleId, choices: { [taskId]: { happened, next?, estimateMinutes? } }, acknowledgeNoPaper?, lighter?, declineMock? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { user } = access

  const body = await request.json().catch(() => null) as any
  const valid = body && typeof body.cycleId === 'string' && body.choices && typeof body.choices === 'object' && !Array.isArray(body.choices)
    && (body.unreportedClassKeys === undefined || (Array.isArray(body.unreportedClassKeys) && body.unreportedClassKeys.length <= 500
      && body.unreportedClassKeys.every((key: unknown) => typeof key === 'string' && key.length <= 100)))
  if (!valid) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })

  const requestId = crypto.randomUUID()
  try {
    const result = await tagReads('weekly-review:preview', () => withReadSnapshot(() => previewWeeklyTransition(user.id, {
      cycleId: body.cycleId, choices: body.choices, acknowledgeNoPaper: body.acknowledgeNoPaper === true, lighter: body.lighter === true, declineMock: body.declineMock === true, mockEstimates: body.mockEstimates, extraWindows: body.extraWindows, plannedBreak: body.plannedBreak === true, useLeftover: body.useLeftover !== false, recoveryPath: ['steady', 'protect_core'].includes(body.recoveryPath) ? body.recoveryPath : null, unreportedClassKeys: body.unreportedClassKeys,
    })))
    if (result.ok) return NextResponse.json({ ...result, requestId })
    const status = result.code === 'failed' ? 500 : result.code === 'invalid_choices' ? 400 : 409
    return NextResponse.json({ ...result, requestId }, { status })
  } catch (error) {
    console.error(`[weekly-review/preview ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not prepare the review. Nothing was changed.', requestId }, { status: 500 })
  }
}
