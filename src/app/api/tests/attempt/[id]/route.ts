import { NextResponse } from 'next/server'
import { NUM_TO_LEVEL, withOwnedAttempt } from '../../../../../lib/tests/attemptAccess'
import { setOfAttempt } from '../../../../../lib/tests/adaptivePractice'
import { routeFailure } from '../../../../../lib/ops/routeFailure'

export const dynamic = 'force-dynamic'

/**
 * The whole attempt for the taking screen: every question (stem and options only), the student's
 * saved answers and confidence, flags, and per-question active time. The key, the concept label
 * and the rationale are never sent while the attempt is open.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const a = await withOwnedAttempt(id)
  if (!a.ok) return a.response
  const { supabase, admin, attempt, userId } = a
  // A rehearsal session shows no question until the student has explicitly started its clock.
  const rehearsal = attempt.rehearsal_id ? { id: attempt.rehearsal_id, session: attempt.session_no, started: attempt.deadline_at !== null } : null
  if (rehearsal && !rehearsal.started && attempt.status !== 'scored') {
    return NextResponse.json({ ok: true, serverNow: new Date().toISOString(), attempt: { id: attempt.id, status: attempt.status, kind: attempt.attempt_kind, paperKind: attempt.paper_kind, timed: true, deadlineAt: null, timeLimitMinutes: attempt.time_limit_minutes, paused: false, pausedSeconds: 0, total: 0, answered: 0, rehearsal }, items: [] })
  }

  const [formRead, responseRead, progressRead] = await Promise.all([
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id).order('sequence_number'),
    supabase.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence, flagged, active_seconds, interrupted_seconds').eq('attempt_id', id),
    supabase.from('attempt_item_progress').select('item_id, active_seconds, interrupted_seconds, flagged').eq('attempt_id', id),
  ])
  const failed = formRead.error ?? responseRead.error ?? progressRead.error
  const unable = (cause: unknown) => routeFailure('paper.load', 'Your paper could not be loaded. Try again to open it with your saved answers.', cause, 503)
  if (failed) return unable(failed)
  const { data: formItems } = formRead, { data: responses } = responseRead, { data: progress } = progressRead
  const ids = (formItems ?? []).map(f => f.item_id as string)
  if (ids.length === 0) return unable(null)
  const { data: itemRows, error: itemError } = await admin.from('assessment_items').select('id, stem, options').in('id', ids)
  if (itemError || itemRows?.length !== ids.length) return unable(itemError)
  const item = new Map((itemRows ?? []).map(i => [i.id as string, i]))
  const resp = new Map((responses ?? []).map(r => [r.item_id as string, r]))
  const prog = new Map((progress ?? []).map(p => [p.item_id as string, p]))

  const items = (formItems ?? []).map(f => {
    const it = item.get(f.item_id as string), r = resp.get(f.item_id as string), p = prog.get(f.item_id as string)
    return {
      id: f.item_id as string, seq: f.sequence_number as number, stem: (it?.stem ?? '') as string, options: (it?.options ?? []) as string[],
      answer: r ? { selected: r.selected_option_index as number, confidence: NUM_TO_LEVEL(r.self_reported_confidence as number) } : null,
      flagged: Boolean(r?.flagged ?? p?.flagged),
      activeSeconds: Math.max((r?.active_seconds as number | null) ?? 0, (p?.active_seconds as number | null) ?? 0),
      interruptedSeconds: Math.max((r?.interrupted_seconds as number | null) ?? 0, (p?.interrupted_seconds as number | null) ?? 0),
    }
  })

  let adaptive
  try { adaptive = attempt.attempt_kind === 'practice' ? await setOfAttempt(userId, attempt.id) : null } catch (cause) { return unable(cause) }
  return NextResponse.json({
    ok: true, serverNow: new Date().toISOString(),
    attempt: {
      id: attempt.id, status: attempt.status, kind: attempt.attempt_kind, paperKind: attempt.paper_kind,
      timed: attempt.time_limit_minutes !== null, rehearsal, deadlineAt: attempt.deadline_at, timeLimitMinutes: attempt.time_limit_minutes,
      paused: attempt.paused_at !== null, pausedSeconds: attempt.paused_seconds,
      total: items.length, answered: items.filter(i => i.answer).length,
      adaptive,
    },
    items,
  })
}
