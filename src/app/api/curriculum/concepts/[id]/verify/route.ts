import { NextResponse } from 'next/server'
import { commandResponse, reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'

/**
 * Signs a manifest concept's scope off, or withdraws that sign-off (§5.1). A scope error here is invisible to every automated gate
 * downstream, so this is an explicit, attributable human decision:
 *   { decision: 'verify' | 'withdraw', expectedScopeHash, rationale, confirmScope: true, requestKey? }
 * Anything missing or malformed approves nothing. The database command (`decide_concept_signoff`) checks the reviewer role as the
 * signed-in user, refuses a scope that changed since it was shown, and records who, when, which exact scope and why with the status change.
 * A repeat with the same requestKey and the SAME request (decision, scope hash, reason, reviewer) replays the first result; the same key with anything different is a 409 and writes nothing.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const decision = body?.decision
  if (decision !== 'verify' && decision !== 'withdraw') return NextResponse.json({ ok: false, error: 'decision must be "verify" or "withdraw".' }, { status: 400 })
  if (typeof body?.expectedScopeHash !== 'string' || !body.expectedScopeHash) return NextResponse.json({ ok: false, error: 'expectedScopeHash (the scope you were shown) is required.' }, { status: 400 })
  if (decision === 'verify' && body?.confirmScope !== true) return NextResponse.json({ ok: false, error: 'Signing off needs your explicit confirmation that you read this exact scope.' }, { status: 400 })
  // Never truncated: cutting a long key or reason could turn two different requests into one.
  const key = body?.requestKey, why = typeof body?.rationale === 'string' ? body.rationale : ''
  if (key !== undefined && key !== null && (typeof key !== 'string' || key.length < 8 || key.length > 100)) return NextResponse.json({ ok: false, code: 'BAD_KEY', error: 'requestKey must be 8 to 100 characters.' }, { status: 400 })
  if (why.length > 1000) return NextResponse.json({ ok: false, code: 'RATIONALE_TOO_LONG', error: 'Keep the reason to 1000 characters; nothing was recorded.' }, { status: 400 })
  const { data, error } = await auth.supabase.rpc('decide_concept_signoff', {
    p_concept: id, p_decision: decision, p_expected_hash: body.expectedScopeHash,
    p_rationale: why, p_request_key: typeof key === 'string' ? key : null,
  })
  return commandResponse(data, error)
}
