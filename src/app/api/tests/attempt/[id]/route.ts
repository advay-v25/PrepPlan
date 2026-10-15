import { NextResponse } from 'next/server'
import { NUM_TO_LEVEL, withOwnedAttempt } from '../../../../../lib/tests/attemptAccess'

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
  const { supabase, admin, attempt } = a

  const [{ data: formItems }, { data: responses }, { data: progress }] = await Promise.all([
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id).order('sequence_number'),
    supabase.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence, flagged, active_seconds, interrupted_seconds').eq('attempt_id', id),
    supabase.from('attempt_item_progress').select('item_id, active_seconds, interrupted_seconds, flagged').eq('attempt_id', id),
  ])
  const ids = (formItems ?? []).map(f => f.item_id as string)
  const { data: itemRows } = await admin.from('assessment_items').select('id, stem, options').in('id', ids)
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

  return NextResponse.json({
    ok: true, serverNow: new Date().toISOString(),
    attempt: {
      id: attempt.id, status: attempt.status, kind: attempt.attempt_kind, paperKind: attempt.paper_kind,
      timed: attempt.deadline_at !== null, deadlineAt: attempt.deadline_at, timeLimitMinutes: attempt.time_limit_minutes,
      paused: attempt.paused_at !== null, pausedSeconds: attempt.paused_seconds,
      total: items.length, answered: items.filter(i => i.answer).length,
    },
    items,
  })
}
