import { routeFailure } from '../../../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { EVIDENCE_POLICY_VERSION } from '../../../../../../lib/diagnostic/evidencePolicy'
import { requireApplicationAccess } from '../../../../../../lib/auth/applicationAccess'

/**
 * Scores an attempt and turns its responses into concept evidence atomically via RPC.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const { id: attemptId } = await params

  // We rely on the RPC for all atomic validation, scoring and evidence generation.
  // We pass the current policy versions so the database can stamp them on the attempt and evidence.
  const SCORING_POLICY_VERSION = '1.0'

  const { data: result, error: rpcErr } = await supabase.rpc('finalize_assessment_attempt', {
    p_attempt_id: attemptId,
    p_scoring_policy: SCORING_POLICY_VERSION,
    p_evidence_policy: EVIDENCE_POLICY_VERSION
  })

  if (rpcErr) {
    if (rpcErr.message.includes('Attempt not found')) {
      return NextResponse.json({ ok: false, error: 'Attempt not found' }, { status: 404 })
    }
    if (rpcErr.message.includes('No responses found')) {
      return NextResponse.json({ ok: false, error: 'Nothing has been answered yet' }, { status: 400 })
    }
    return routeFailure('diagnostic.submit', 'Could not confirm submission. Try again to open the result or submit your saved answers.', rpcErr)
  }

  return NextResponse.json(result)
}
