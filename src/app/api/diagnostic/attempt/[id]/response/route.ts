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
  const body = await req.json().catch(() => ({} as any))

  const itemId: string | undefined = body.itemId
  const selectedOptionIndex = Number(body.selectedOptionIndex)

  if (!itemId || !Number.isInteger(selectedOptionIndex) || selectedOptionIndex < 0) {
    return NextResponse.json({ ok: false, error: 'Missing itemId or selectedOptionIndex' }, { status: 400 })
  }

  // The RPC does not range-check the option, so an index past the end of the
  // options array was accepted and stored. Validate before calling it.
  const { createAdminClient } = await import('../../../../../../lib/supabase/admin')
  const admin = createAdminClient()
  const { data: item } = await admin
    .from('assessment_items').select('options').eq('id', itemId).maybeSingle()
  if (!item) return NextResponse.json({ ok: false, error: 'Unknown question' }, { status: 400 })
  const optionCount = Array.isArray(item.options) ? item.options.length : 0
  if (selectedOptionIndex >= optionCount) {
    return NextResponse.json({ ok: false, error: 'That option does not exist' }, { status: 400 })
  }

  // Answers lock. Re-submitting the same item is a no-op that says so, rather
  // than an overwrite or a duplicate row — a diagnostic where a student can
  // revise an answer after seeing the next question measures nothing.
  const { data: already } = await supabase
    .from('assessment_responses').select('id')
    .eq('attempt_id', attemptId).eq('item_id', itemId).maybeSingle()
  if (already) return NextResponse.json({ ok: true, id: already.id, locked: true })

  const rawConfidence = typeof body.confidence === 'string' ? body.confidence.toLowerCase() : null
  const confidence = rawConfidence && rawConfidence in CONFIDENCE_SCALE ? CONFIDENCE_SCALE[rawConfidence] : null
  const elapsed = Number(body.elapsedSeconds)
  const elapsedSeconds = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null

  const { data: responseId, error: respErr } = await supabase.rpc('record_assessment_response', {
    p_attempt_id: attemptId,
    p_item_id: itemId,
    p_selected_option: selectedOptionIndex,
    p_confidence: confidence,
    p_elapsed_seconds: elapsedSeconds
  })

  if (respErr) {
    // Graceful lock or conflict errors
    if (respErr.message.includes('Attempt not found') || respErr.message.includes('Attempt is')) {
       return NextResponse.json({ ok: false, error: 'This paper is no longer accepting answers.' }, { status: 409 })
    }
    if (respErr.message.includes('Item not in form') || respErr.message.includes('Item not found')) {
       return NextResponse.json({ ok: false, error: 'That question is unavailable in this paper.' }, { status: 400 })
    }
    return routeFailure('diagnostic.answer', 'Could not confirm your answer. Try saving again.', respErr)
  }

  // Deliberately no correctness in the response body.
  return NextResponse.json({ ok: true, id: responseId })
}
