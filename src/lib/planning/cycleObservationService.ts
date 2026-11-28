import { scopeConfirmations } from '../ops/sharedReads'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { observeCycle, type CycleObservation, type ObsBlock } from './cycleObservation'
import { perRequest } from '../ops/perRequest'

/** What the student's review answers do to the cycle being closed, applied without saving anything. */
export type ClosingAnswers = { cycleId: string; actions: { taskId: string; setExecution: string | null; cancel: boolean; unknown: boolean }[] }

/**
 * Closed cycles, newest first, read from the records that already exist: the cycle, its tasks, their history, the review
 * receipt. When `closing` is given, the cycle being closed is read first, as it WILL be once these answers are saved: that
 * is the most recent evidence there is, and the proposal for the next week is made before the cycle is closed.
 */
async function loadClosedCycleObservationsUncached(userId: string, limit = 4, closing?: ClosingAnswers): Promise<CycleObservation[]> {
  const admin = createAdminClient()
  const { data: closed } = await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local')
    .eq('user_id', userId).eq('status', 'closed').not('ends_at_local', 'is', null).order('ends_at_local', { ascending: false }).limit(limit)
  const { data: open } = closing ? await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', userId).eq('id', closing.cycleId).eq('status', 'active').maybeSingle() : { data: null }
  const cycles = [...(open ? [open] : []), ...(closed ?? [])]
  if (!cycles.length) return []
  const ids = cycles.map(c => c.id as string)

  const [{ data: blocks }, { data: reviews }, confirmed, outcomes, events] = await Promise.all([
    admin.from('plan_blocks').select('id, cycle_id, task_type, execution, cancelled_at, priority, duration_minutes, created_by, scope_group_id, continued_from_task_id, learning_activity_id, is_protected_commitment, lm_id, outcome_id')
      .eq('user_id', userId).in('cycle_id', ids).throwOnError(),
    admin.from('weekly_reviews').select('cycle_id, unknown_task_ids').eq('user_id', userId).in('cycle_id', ids).throwOnError(),
    // Filtered in code rather than with a long .in() list, which would outgrow a request URL on a long-lived account.
    scopeConfirmations(userId),
    readAll<{ reading_id: string }>((a, z) => admin.from('reading_los').select('id,reading_id').order('id').range(a, z)),
    readAll<{ task_id: string; prev: string | null }>((a, z) => admin.from('task_events').select('id,task_id,prev:previous->>duration_minutes').eq('user_id', userId).not('previous->>duration_minutes', 'is', null).order('id').range(a, z)),
  ])

  const reviewOf = new Map((reviews ?? []).map(r => [r.cycle_id as string, (r.unknown_task_ids ?? []) as string[]]))
  const answers = new Map((closing?.actions ?? []).map(a => [a.taskId, a]))
  if (open) reviewOf.set(open.id as string, closing!.actions.filter(a => a.unknown).map(a => a.taskId))
  const perReading = new Map<string, number>()
  for (const o of outcomes) perReading.set(o.reading_id, (perReading.get(o.reading_id) ?? 0) + 1)
  const confirmedCount = new Map<string, number>()
  for (const c of confirmed) confirmedCount.set(c.block_id, (confirmedCount.get(c.block_id) ?? 0) + 1)
  // The earliest recorded duration is the one that was accepted; a later shortening or split must not shrink the baseline.
  // (events arrive in id order; a uuid id is not chronological, so take the largest recorded value as the original.)
  const original = new Map<string, number>()
  for (const e of events) { const v = Number(e.prev); if (Number.isFinite(v)) original.set(e.task_id, Math.max(original.get(e.task_id) ?? 0, v)) }

  return cycles.map(c => {
    const own = (blocks ?? []).filter(b => b.cycle_id === c.id)
    // A split part keeps its own length (the parts sum to the original); only an unsplit, edited task falls back to its history.
    const rows: ObsBlock[] = own.map(b => ({
      id: b.id as string, taskType: (b.task_type ?? null) as string | null, execution: (answers.get(b.id as string)?.setExecution ?? b.execution) as string, cancelled: Boolean(b.cancelled_at) || Boolean(answers.get(b.id as string)?.cancel),
      priority: (b.priority ?? null) as string | null, durationMinutes: Number(b.duration_minutes ?? 0), createdBy: (b.created_by ?? null) as string | null,
      scopeGroupId: (b.scope_group_id ?? null) as string | null, continuedFromId: (b.continued_from_task_id ?? null) as string | null,
      learningActivityId: (b.learning_activity_id ?? null) as string | null, isProtected: Boolean(b.is_protected_commitment),
      lmId: (b.lm_id ?? null) as string | null, outcomeId: (b.outcome_id ?? null) as string | null,
      originalMinutes: b.scope_group_id ? null : (original.get(b.id as string) ?? null),
    }))
    return observeCycle({
      cycleId: c.id as string, startsAt: c.starts_at_local as string, endsAt: c.ends_at_local as string,
      reviewed: reviewOf.has(c.id as string), blocks: rows, unknownTaskIds: reviewOf.get(c.id as string) ?? [],
      confirmedOutcomes: confirmedCount,
      totalOutcomesOf: b => b.outcomeId ? 1 : b.lmId ? (perReading.get(b.lmId) ?? null) : null,
    })
  })
}

export const loadClosedCycleObservations = perRequest(
  loadClosedCycleObservationsUncached,
  (userId: string, limit = 4, closing?: ClosingAnswers) =>
    `${userId}|${limit}|${closing?.cycleId ?? ''}|${(closing?.actions ?? []).map(a => `${a.taskId}:${a.setExecution ?? ''}:${a.cancel ? 1 : 0}:${a.unknown ? 1 : 0}`).join(',')}`
)
