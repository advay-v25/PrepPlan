import { NextResponse } from 'next/server'
import { LEVEL_TO_NUM, withOwnedAttempt } from '../../../../../../lib/tests/attemptAccess'
import { acceptProgress, firstReportWindow } from '../../../../../../lib/tests/attemptTiming'

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
  const { supabase, admin, userId } = a
  const body = await req.json().catch(() => null) as any
  const level = body?.confidence as keyof typeof LEVEL_TO_NUM
  if (!body || typeof body.itemId !== 'string' || !Number.isInteger(body.selectedOptionIndex)) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  if (!(level in LEVEL_TO_NUM)) return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Choose how sure you are before moving on.' }, { status: 400 })

  const now = new Date()
  const { data: prev } = await admin.from('attempt_item_progress').select('active_seconds, interrupted_seconds, last_seen_at').eq('attempt_id', id).eq('item_id', body.itemId).maybeSingle()
  const wall = prev ? (now.getTime() - new Date(prev.last_seen_at as string).getTime()) / 1000 : firstReportWindow(a.attempt.started_at, now)
  const accepted = acceptProgress({ activeSeconds: (prev?.active_seconds as number) ?? 0, interruptedSeconds: (prev?.interrupted_seconds as number) ?? 0 },
    { activeSeconds: Number(body.activeSeconds), interruptedSeconds: Number(body.interruptedSeconds) }, wall)

  const { error } = await supabase.rpc('save_attempt_response', {
    p_attempt_id: id, p_item_id: body.itemId, p_selected_option: body.selectedOptionIndex, p_confidence: LEVEL_TO_NUM[level],
    p_active_seconds: accepted.activeSeconds, p_interrupted_seconds: accepted.interruptedSeconds, p_flagged: body.flagged === true,
  })
  if (error) {
    const m = error.message
    if (/Confidence is required/.test(m)) return NextResponse.json({ ok: false, code: 'confidence_required', error: 'Choose how sure you are before moving on.' }, { status: 400 })
    if (/Time is up/.test(m)) return NextResponse.json({ ok: false, code: 'time_up', error: 'Time is up. Your saved answers will be scored.' }, { status: 409 })
    if (/paused/.test(m)) return NextResponse.json({ ok: false, code: 'paused', error: 'The attempt is paused. Resume to continue.' }, { status: 409 })
    if (/Attempt is/.test(m)) return NextResponse.json({ ok: false, code: 'closed', error: 'This attempt is already submitted.' }, { status: 409 })
    if (/Item not in form|Item not found|option does not exist/.test(m)) return NextResponse.json({ ok: false, error: m }, { status: 400 })
    const requestId = crypto.randomUUID(); console.error(`[tests/answer ${requestId}]`, m)
    return NextResponse.json({ ok: false, error: 'Could not save that answer.', requestId }, { status: 500 })
  }
  await admin.from('attempt_item_progress').upsert({
    attempt_id: id, item_id: body.itemId, user_id: userId, active_seconds: accepted.activeSeconds, interrupted_seconds: accepted.interruptedSeconds,
    flagged: body.flagged === true, last_seen_at: now.toISOString(),
  }, { onConflict: 'attempt_id,item_id' })
  return NextResponse.json({ ok: true, activeSeconds: accepted.activeSeconds })
}
