import { routeFailure } from '../../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'

/**
 * Records a learner's challenge to an item (§13.2) via RPC.
 *
 * This marks evidence as 'disputed' and puts the item in a queue for review,
 * without silently destroying dependent task plans.
 */

const REASONS = new Set(['no_correct_answer', 'two_correct_answers', 'off_syllabus', 'unclear_wording', 'calculation_wrong', 'other'])

export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const body = await req.json().catch(() => ({} as any))
  const itemId: string | undefined = body.itemId
  const attemptId: string | undefined = body.attemptId
  const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
  const reasonCode = typeof body.reasonCode === 'string' && REASONS.has(body.reasonCode) ? body.reasonCode : 'other'

  if (!itemId || !attemptId) return NextResponse.json({ ok: false, error: 'Missing itemId or attemptId' }, { status: 400 })
  if (comment.length < 3) {
    return NextResponse.json({ ok: false, error: 'Say briefly what is wrong with the question' }, { status: 400 })
  }

  // One open challenge per item. Raising it twice should tell the student it is
  // already being looked at, not queue a second copy for review.
  const { data: existing } = await supabase
    .from('item_challenges').select('id')
    .eq('user_id', user.id).eq('item_id', itemId).eq('status', 'pending').maybeSingle()
  if (existing) return NextResponse.json({ ok: true, id: existing.id, alreadyRaised: true })

  const { data: challengeId, error: rpcErr } = await supabase.rpc('raise_item_challenge', {
    p_attempt_id: attemptId,
    p_item_id: itemId,
    p_comment: comment.slice(0, 2000),
    p_reason_code: reasonCode
  })

  if (rpcErr) {
    if (rpcErr.message.includes('Response not found')) {
       return NextResponse.json({ ok: false, error: 'Response not found' }, { status: 404 })
    }
    return routeFailure('challenge.open', 'Could not confirm the challenge. Check the result and try again.', rpcErr)
  }

  return NextResponse.json({ ok: true, id: challengeId })
}
