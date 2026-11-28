/** Which tasks the weekly review must ask about. Pure, so the rule is testable without a database. */
export type ReviewBlock = {
  id: string
  title: string
  taskType: string
  /** Null for work that was never given a day (an unplaced sitting). */
  localDate: string | null
  execution: string
  durationMinutes: number
  cancelled: boolean
  isProtected?: boolean
  lmId?: string | null
  outcomeId?: string | null
  repairThreadId?: string | null
}

export type DueTask = { /** Minutes actually logged on this task (absent when none). */ loggedMinutes?: number; id: string; title: string; taskType: string; localDate: string | null; execution: string; durationMinutes: number; isProtected: boolean; lmId: string | null; outcomeId: string | null; repairThreadId: string | null }

// A task deferred earlier in the week is unfinished work too; it must be decided on, not dropped at closure.
const OPEN = ['not_started', 'in_progress', 'partial', 'deferred']

/**
 * Unfinished work in the closing cycle, including work that has no day. An unplaced sitting is
 * still unfinished: leaving it out would strand it in a cycle nobody opens again.
 * Placed work comes first in date order; unplaced work follows.
 */
export function selectDueTasks(blocks: ReviewBlock[], cycleEnd: string, paperTaskId: string | null): DueTask[] {
  return blocks
    .filter(b => !b.cancelled && !b.isProtected && b.id !== paperTaskId && OPEN.includes(b.execution) && (b.localDate === null || b.localDate <= cycleEnd))
    .map(b => ({ id: b.id, title: b.title, taskType: b.taskType, localDate: b.localDate, execution: b.execution, durationMinutes: b.durationMinutes, isProtected: false, lmId: b.lmId ?? null, outcomeId: b.outcomeId ?? null, repairThreadId: b.repairThreadId ?? null }))
    .sort((a, b) => {
      if (a.localDate === b.localDate) return 0
      if (a.localDate === null) return 1
      if (b.localDate === null) return -1
      return a.localDate.localeCompare(b.localDate)
    })
}
