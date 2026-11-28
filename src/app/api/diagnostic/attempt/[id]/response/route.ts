import { routeFailure } from '../../../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../../lib/auth/applicationAccess'

/**
 * Records one answer via atomic RPC.
 *
 * Correctness is decided securely inside the RPC and never sent back to
 * the client — the learner sees nothing until the attempt is scored.
 *
 * The confidence column is a 1–5 smallint. The interface offers three levels,
 * so they are mapped here rather than sending strings the column rejects.
 */
const CONFIDENCE_SCALE: Record<string, number> = { low: 1, medium: 3, high: 5 }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const { id: attemptId } = await params
  const body = await req.json().catch(() => null)
  const itemId = body?.itemId
  const selectedOptionIndex = body?.selectedOptionIndex
  if (typeof itemId !== 'string' || !itemId || !Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0) {
    return NextResponse.json({ ok: false, error: 'Missing itemId or selectedOptionIndex' }, { status: 400 })
  }
  const rawConfidence = typeof body.confidence === 'string' ? body.confidence.toLowerCase() : ''
  if (!Object.hasOwn(CONFIDENCE_SCALE, rawConfidence)) {
    return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Choose how sure you are before moving on.' }, { status: 400 })
  }

  // Retain the older receipt shape. The command also checks for an existing
  // response under the attempt lock, including when two old clients race.
  const { data: already, error: answerReadError } = await supabase
    .from('assessment_responses').select('id')
    .eq('user_id', user.id).eq('attempt_id', attemptId).eq('item_id', itemId).maybeSingle()
  if (answerReadError) return routeFailure('diagnostic.answer', 'Could not check your answer. Try saving again.', answerReadError)
  if (already) return NextResponse.json({ ok: true, id: already.id, locked: true })

  const elapsed = Number(body.elapsedSeconds)
  const elapsedSeconds = Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(2_147_483_647, Math.round(elapsed)) : null

  const { data: responseId, error: respErr } = await supabase.rpc('record_assessment_response', {
    p_attempt_id: attemptId,
    p_item_id: itemId,
    p_selected_option: selectedOptionIndex,
    p_confidence: CONFIDENCE_SCALE[rawConfidence],
    p_elapsed_seconds: elapsedSeconds
  })

  if (respErr) {
    // Graceful lock or conflict errors
    if (/Attempt not found|Attempt is|Time is up|Session not started/.test(respErr.message)) {
       return NextResponse.json({ ok: false, error: 'This paper is no longer accepting answers.' }, { status: 409 })
    }
    if (/Item not in form|Item not found|option does not exist/.test(respErr.message)) {
       return NextResponse.json({ ok: false, error: 'That question is unavailable in this paper.' }, { status: 400 })
    }
    return routeFailure('diagnostic.answer', 'Could not confirm your answer. Try saving again.', respErr)
  }

  // Deliberately no correctness in the response body.
  return NextResponse.json({ ok: true, id: responseId })
}
