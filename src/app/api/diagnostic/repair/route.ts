import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { applyRepairProposal, buildRepairProposal, getStudyWeekContext } from '../../../../lib/planning/schedule'

/**
 * Turns a scored attempt into calendar work.
 *
 * GET  previews the proposal — what would be added, to which study week, and why.
 * POST applies it, after the student has seen the preview.
 *
 * The split matters: §10 of the plan requires that Tests emit a result and a
 * proposal, never a direct calendar mutation. Previously this endpoint wrote
 * coach_proposals rows that nothing ever executed, so a repair never reached a
 * calendar at all — and it wrote task_type 'repair', which the plan_blocks
 * check constraint would have rejected.
 */

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const attemptId = new URL(req.url).searchParams.get('attemptId')
  if (!attemptId) return NextResponse.json({ ok: false, error: 'Missing attemptId' }, { status: 400 })

  const proposal = await buildRepairProposal(user.id, attemptId)
  if (!proposal) {
    return NextResponse.json({ ok: true, proposal: null, message: 'Nothing from this attempt needs repair.' })
  }
  return NextResponse.json({ ok: true, proposal })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const attemptId: string | undefined = body.attemptId
  if (!attemptId) return NextResponse.json({ ok: false, error: 'Missing attemptId' }, { status: 400 })

  const proposal = await buildRepairProposal(user.id, attemptId)
  if (!proposal) {
    return NextResponse.json({ ok: true, created: 0, message: 'Nothing from this attempt needs repair.' })
  }

  const admin = createAdminClient()

  // Applying twice would duplicate the whole repair set into the week.
  const { data: already } = await admin
    .from('plan_blocks')
    .select('id')
    .eq('user_id', user.id)
    .eq('attempt_id', attemptId)
    .limit(1)

  if (already && already.length > 0) {
    return NextResponse.json({
      ok: true,
      created: 0,
      alreadyApplied: true,
      message: 'The follow-up work from this diagnostic is already in your calendar.',
      targetWeekStart: proposal.targetWeekStart,
    })
  }

  const ctx = await getStudyWeekContext(user.id)
  const { data: cycle } = await admin
    .from('planning_cycles')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  try {
    const { created, taskIds } = await applyRepairProposal(user.id, proposal, (cycle?.id as string) ?? null)

    // The decision (coach_proposals row) is recorded within applyRepairProposal before calling the RPC.

    return NextResponse.json({
      ok: true,
      created,
      rolledOver: proposal.rolledOver,
      targetWeekStart: proposal.targetWeekStart,
      targetWeekLabel: proposal.targetWeekLabel,
      reason: proposal.reason,
      currentWeekStart: ctx.week.startDate,
    })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
