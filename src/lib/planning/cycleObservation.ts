/**
 * What happened to the work a closed cycle accepted. Pure.
 *
 * Execution is measured against the ACCEPTED workload (planned minutes describe that workload; they are never study time).
 * Unknown is not missed, missing minutes are not zero, partial work earns only what the student confirmed (never a flat
 * percentage), removing or deferring work never shrinks the baseline, and extra learning stays outside it.
 * Where the records cannot settle the answer, the result is a range and the cycle is labelled incomplete.
 */
export type ObsBlock = {
  id: string
  taskType: string | null
  execution: string
  cancelled: boolean
  priority: string | null
  durationMinutes: number
  createdBy: string | null
  scopeGroupId: string | null
  continuedFromId: string | null
  learningActivityId: string | null
  isProtected: boolean
  lmId: string | null
  outcomeId: string | null
  /** Duration before any later edit, from the task's own history, when it was ever changed. */
  originalMinutes?: number | null
}

export type ObsInput = {
  cycleId: string
  startsAt: string
  endsAt: string
  /** True when the student closed the cycle through the weekly review (a receipt exists). */
  reviewed: boolean
  blocks: ObsBlock[]
  unknownTaskIds: string[]
  /** Outcomes the student confirmed per task, and how many outcomes the task's reading has. */
  confirmedOutcomes: Map<string, number>
  totalOutcomesOf: (b: ObsBlock) => number | null
}

export type ItemState = 'completed' | 'partial' | 'missed' | 'deferred' | 'removed' | 'unresolved'

export const OBSERVATION_RULES = {
  /** Study-like work that counts as accepted workload. Papers, mocks and protected commitments are not part of it. */
  workload: ['study', 'review', 'class_consolidation', 'repair', 'recheck', 'verification'],
  /** The widest gap between the proven and the possible share that still counts as a settled cycle. */
  maxSpread: 0.2,
} as const

export type CycleObservation = {
  cycleId: string
  startsAt: string
  endsAt: string
  /** 'empty' has no meaningful ratio; 'incomplete' cannot be settled from the records; 'usable' can. */
  quality: 'usable' | 'incomplete' | 'empty'
  reasons: string[]
  baselineMinutes: number
  counts: Record<ItemState, number>
  /** Share of the accepted workload the records PROVE was done, and the most it could have been. Null when empty. */
  executionLow: number | null
  executionHigh: number | null
  /** Optional work the student finished, and extra learning outside the plan: never part of the baseline. */
  extra: { count: number; minutes: number }
}

export function stateOf(b: ObsBlock, unknown: Set<string>): ItemState {
  if (unknown.has(b.id)) return 'unresolved'
  if (b.cancelled) return 'removed'
  switch (b.execution) {
    case 'completed': return 'completed'
    case 'partial': return 'partial'
    case 'skipped': return 'missed'
    case 'deferred': return 'deferred'
    default: return 'unresolved'
  }
}

export function observeCycle(input: ObsInput): CycleObservation {
  const unknown = new Set(input.unknownTaskIds)
  const counts: Record<ItemState, number> = { completed: 0, partial: 0, missed: 0, deferred: 0, removed: 0, unresolved: 0 }
  const extra = { count: 0, minutes: 0 }
  const reasons: string[] = []
  let baseline = 0, proven = 0, possible = 0, partialUnknown = 0

  for (const b of input.blocks) {
    if (b.isProtected || !b.taskType || !(OBSERVATION_RULES.workload as readonly string[]).includes(b.taskType)) continue
    // Extra learning and work the student added mid-week were never part of what was accepted. A split part and a
    // continuation were: a split only divides accepted work, and a continuation was accepted in the previous review.
    const added = b.learningActivityId || (b.createdBy === 'student' && !b.scopeGroupId && !b.continuedFromId)
    const state = stateOf(b, unknown)
    if (added || (b.priority === 'optional' && state !== 'completed' && state !== 'partial')) {
      // An optional item that was not done is not a miss; a done one is evidence of delivery beyond the baseline.
      if (added || state === 'completed') { extra.count++; extra.minutes += b.durationMinutes }
      continue
    }
    if (b.priority === 'optional') { extra.count++; extra.minutes += b.durationMinutes; continue }
    const minutes = Math.max(0, b.originalMinutes ?? b.durationMinutes)
    baseline += minutes
    counts[state]++
    if (state === 'completed') { proven += minutes; possible += minutes }
    else if (state === 'unresolved') possible += minutes
    else if (state === 'partial') {
      const done = input.confirmedOutcomes.get(b.id) ?? 0
      const total = input.totalOutcomesOf(b)
      if (done > 0 && total && done < total) { const credit = minutes * (done / total); proven += credit; possible += credit }
      else if (done > 0 && total && done >= total) { proven += minutes; possible += minutes }
      else { possible += minutes; partialUnknown++ }   // partly done, extent not confirmed: no percentage is invented
    }
  }

  if (baseline === 0) {
    return { cycleId: input.cycleId, startsAt: input.startsAt, endsAt: input.endsAt, quality: 'empty',
      reasons: ['No accepted study work, so there is nothing to compare.'], baselineMinutes: 0, counts, executionLow: null, executionHigh: null, extra }
  }
  const low = proven / baseline, high = possible / baseline
  if (counts.unresolved > 0) reasons.push(`${counts.unresolved} task${counts.unresolved === 1 ? ' was' : 's were'} never confirmed either way.`)
  if (partialUnknown > 0) reasons.push(`${partialUnknown} partly done task${partialUnknown === 1 ? ' has' : 's have'} no confirmed scope, so how much was done is not known.`)
  if (!input.reviewed) reasons.push('This week was not closed through the weekly review, so unfinished tasks were never answered.')
  const settled = high - low <= OBSERVATION_RULES.maxSpread && input.reviewed
  return { cycleId: input.cycleId, startsAt: input.startsAt, endsAt: input.endsAt, quality: settled ? 'usable' : 'incomplete',
    reasons: settled ? [] : reasons, baselineMinutes: baseline, counts,
    executionLow: Number(low.toFixed(3)), executionHigh: Number(high.toFixed(3)), extra }
}
