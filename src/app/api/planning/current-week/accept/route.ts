import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { currentWeekCommandError } from '../../../../../lib/planning/currentWeek/commandError'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'

export const dynamic = 'force-dynamic'

/**
 * Atomically adds the reviewed proposal to the same cycle. The database checks ownership, cycle identity, revision and that nothing the
 * plan depends on changed; a refusal says why and offers a rebuild. A repeat returns the stored receipt.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await req.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || typeof body.draftId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.draftId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 || body.expectedRevision > 2147483647) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', error: 'draftId and expectedRevision are required' }, { status: 400 })
  // `reason: 'class_change'` accepts the reviewed adjustment of existing tasks (one atomic command); choices say, per unplaced task, keep or defer.
  const recovery = body.reason === 'class_change'
  if (body.reason !== undefined && !recovery) return NextResponse.json({ ok: false, code: 'BAD_REQUEST', error: 'Unknown plan reason.' }, { status: 400 })
  const { data, error } = recovery
    ? await supabase.rpc('accept_class_recovery', { p_draft_id: body.draftId, p_expected_revision: body.expectedRevision, p_choices: body.choices && typeof body.choices === 'object' && !Array.isArray(body.choices) ? body.choices : {} })
    : await supabase.rpc('accept_current_week_plan', { p_draft_id: body.draftId, p_expected_revision: body.expectedRevision })
  if (error) {
    const failure = currentWeekCommandError(error.message ?? '')
    return NextResponse.json(failure, { status: failure.status })
  }
  return NextResponse.json({ ok: true, receipt: data })
}
