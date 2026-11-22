import { NextResponse } from 'next/server'
import { LEVEL_TO_NUM, withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'

export const dynamic = 'force-dynamic'

/**
 * Saves (or, before submission, changes) one answer. A confidence level is REQUIRED — the server
 * refuses an answer without one, whatever the client does. Active time is bounded by wall-clock.
 * Body: { itemId, selectedOptionIndex, confidence: 'low'|'medium'|'high', activeSeconds, interruptedSeconds, flagged? }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  const { supabase, admin } = a
  const body = await req.json().catch(() => null) as any
  const level = body?.confidence as keyof typeof LEVEL_TO_NUM
  if (!body || typeof body.itemId !== 'string' || !Number.isInteger(body.selectedOptionIndex)) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  if (typeof level !== 'string' || !Object.hasOwn(LEVEL_TO_NUM, level)) return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Choose how sure you are before moving on.' }, { status: 400 })

  const seconds = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.max(0, Math.min(2_147_483_647, Math.floor(n))) : 0
  }
  const args = {
    p_attempt: id, p_item: body.itemId, p_selected: body.selectedOptionIndex, p_confidence: LEVEL_TO_NUM[level],
    p_active: seconds(body.activeSeconds), p_interrupted: seconds(body.interruptedSeconds), p_flagged: body.flagged === true,
    p_client_seq: Number.isSafeInteger(body.clientSeq) && body.clientSeq > 0 ? body.clientSeq : null,
  }
  const save = () => supabase.rpc('save_attempt_answer', args)
  let saved = await save()
  // SQLSTATE 57014 means Postgres cancelled the transaction. A transport error
  // can be ambiguous, so leave the unchanged answer in the runner for Retry.
  if (saved.error?.code === '57014') saved = await save()
  const { data, error } = saved
  if (error?.code === 'ST409') {
    // A newer choice for this question is already saved: say what is stored so the runner shows it instead of the stale one.
    const { data: cur } = await admin.from('assessment_responses').select('selected_option_index, self_reported_confidence').eq('attempt_id', id).eq('item_id', body.itemId).maybeSingle()
    const back = (n: number | null | undefined) => n === 1 ? 'low' : n === 3 ? 'medium' : n === 5 ? 'high' : null
    return NextResponse.json({ ok: false, code: 'stale_answer', error: 'A newer answer for this question was already saved, so this older one was not applied.', current: cur ? { selected: cur.selected_option_index, confidence: back(cur.self_reported_confidence as number) } : null }, { status: 409 })
  }
  if (error) {
    const m = error.message
    if (/Confidence is required/.test(m)) return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Choose how sure you are before moving on.' }, { status: 400 })
    if (/Time is up/.test(m)) return NextResponse.json({ ok: false, code: 'time_up', error: 'Time is up. Your saved answers will be scored.' }, { status: 409 })
    if (/Session not started/.test(m)) return NextResponse.json({ ok: false, code: 'not_started', error: 'This session has not been started. Start it from the rehearsal page.' }, { status: 409 })
    if (/paused/.test(m)) return NextResponse.json({ ok: false, code: 'paused', error: 'The attempt is paused. Resume to continue.' }, { status: 409 })
    if (/Attempt is/.test(m)) return NextResponse.json({ ok: false, code: 'closed', error: 'This attempt is already submitted.' }, { status: 409 })
    if (/Item not in form|Item not found|option does not exist/.test(m)) return NextResponse.json({ ok: false, error: m }, { status: 400 })
    const requestId = crypto.randomUUID(); console.error(`[tests/answer ${requestId}] stage=commit code=${error.code ?? 'unknown'}`, m)
    if (error.code === '57014') return NextResponse.json({ ok: false, code: 'save_busy', error: 'This answer is still here. The save timed out. Retry to keep it.', requestId }, { status: 503 })
    return NextResponse.json({ ok: false, error: 'Could not confirm the save. Your answer is still here. Try again.', requestId }, { status: 500 })
  }
  return NextResponse.json({ ok: true, activeSeconds: data?.activeSeconds ?? 0 })
}
