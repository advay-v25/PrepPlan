/**
 * The student's two answers per unfinished task, turned into concrete actions. Pure.
 *
 * "What happened" and "what next" are separate: recording that work was partly done never turns it into
 * "missed" just because the student wants to continue. The database applies these actions verbatim from
 * the saved draft, so the mapping lives here once and is not re-implemented in SQL.
 */
export type Happened = 'completed' | 'partial' | 'not_done' | 'unknown'
export type Next = 'continue' | 'later' | 'remove'
export const HAPPENED: Happened[] = ['completed', 'partial', 'not_done', 'unknown']
export const NEXT: Next[] = ['continue', 'later', 'remove']

/** `placeDate` is the student's own choice of day for a continuing task: a date, or 'none' to place it themselves. */
export type Choice = { happened: Happened; next?: Next; estimateMinutes?: number | null; placeDate?: string }
export type DispositionTask = { id: string; title: string; taskType: string; execution: string; durationMinutes: number; isProtected: boolean; lmId?: string | null; outcomeId?: string | null; repairThreadId?: string | null }

export type Action = {
  taskId: string
  /** New execution for the original task, or null to leave its record exactly as it is. */
  setExecution: 'completed' | 'partial' | 'skipped' | 'deferred' | null
  /** Remove the task from the plan (an audited cancel). Never used to hide progress. */
  cancel: boolean
  /** The student was not sure; the id is recorded as unknown, never counted as done or missed. */
  unknown: boolean
  /** A continuation to create in the next week, unplaced until the composer or the student places it. */
  continuation: { minutes: number; intent: 'continue' | 'later'; provisional: boolean; placement?: { date: string | null; reason: string | null; note: string | null } } | null
}

const CARRYABLE = ['study', 'review', 'class_consolidation', 'repair', 'recheck', 'verification']

export function resolveDispositions(tasks: DispositionTask[], choices: Record<string, unknown>): { actions: Action[]; errors: string[] } {
  const errors: string[] = []
  const ids = new Set(tasks.map(t => t.id))
  for (const id of Object.keys(choices)) if (!ids.has(id)) errors.push(`"${id}" is not part of this review.`)

  const actions: Action[] = []
  for (const task of tasks) {
    const raw = choices[task.id] as Partial<Choice> | undefined
    if (!raw) { errors.push(`"${task.title}" still needs an answer.`); continue }
    if (!HAPPENED.includes(raw.happened as Happened)) { errors.push(`"${task.title}" has an unknown answer.`); continue }
    if (raw.next !== undefined && !NEXT.includes(raw.next)) { errors.push(`"${task.title}" has an unknown next step.`); continue }
    if (raw.placeDate !== undefined && raw.placeDate !== 'none' && !/^\d{4}-\d{2}-\d{2}$/.test(raw.placeDate)) {
      errors.push(`"${task.title}": choose a day or leave it unplaced.`); continue
    }
    const estimate = raw.estimateMinutes
    if (estimate != null && (!Number.isInteger(estimate) || estimate < 15 || estimate > 180)) {
      errors.push(`"${task.title}": the time needed must be a whole number of minutes from 15 to 180.`); continue
    }

    const happened = raw.happened as Happened
    const wasDeferred = task.execution === 'deferred'
    const next: Next | 'none' = happened === 'completed' ? 'none' : raw.next ?? (happened === 'not_done' && wasDeferred ? 'later' : 'continue')
    const carryable = !task.isProtected && CARRYABLE.includes(task.taskType)

    let setExecution: Action['setExecution'] = null
    let cancel = false
    if (happened === 'completed') setExecution = 'completed'
    else if (happened === 'partial') setExecution = task.execution === 'partial' ? null : 'partial'
    else if (happened === 'not_done') {
      const target = next === 'remove' ? 'skipped' : 'deferred'
      setExecution = task.execution === target ? null : target
    } else if (next === 'remove') cancel = true   // not sure + remove: cancel, never claim it was skipped

    const carries = (next === 'continue' || next === 'later') && carryable
    actions.push({
      taskId: task.id, setExecution, cancel, unknown: happened === 'unknown',
      continuation: carries ? {
        minutes: estimate ?? task.durationMinutes,
        intent: next as 'continue' | 'later',
        // A reused estimate is a guess when work was started or its state is unknown; a stated one is not.
        provisional: estimate == null && (happened === 'partial' || happened === 'unknown'),
      } : null,
    })
  }
  return { actions, errors }
}

/**
 * Safety net: a generated task is dropped only when it is the SAME work for the SAME purpose as a
 * continuing one. Distinct learning, repair and verification steps always survive.
 *  - repair/re-check: same repair thread AND same task type (a continuing repair never removes its re-check);
 *  - study-like work: same module AND same task type, and only when the continuing task covers the whole
 *    module (no single outcome), because module-level study also covers the module's other outcomes.
 * The main mechanism is the composer, which reserves continuing work before new work is generated.
 */
export function displaceDuplicates<R extends { task_type?: unknown; lm_id?: unknown; repair_thread_id?: unknown }>(
  generated: R[], continuing: { taskType: string; lmId: string | null; outcomeId: string | null; repairThreadId: string | null }[],
): { rows: R[]; dropped: R[] } {
  const rows: R[] = [], dropped: R[] = []
  for (const r of generated) {
    const lm = typeof r.lm_id === 'string' && r.lm_id ? r.lm_id : null
    const thread = typeof r.repair_thread_id === 'string' && r.repair_thread_id ? r.repair_thread_id : null
    const duplicate = r.task_type !== 'diagnostic' && continuing.some(c => {
      if (c.taskType !== r.task_type) return false
      if (thread || c.repairThreadId) return Boolean(thread) && thread === c.repairThreadId
      return Boolean(lm) && lm === c.lmId && c.outcomeId === null
    })
    ;(duplicate ? dropped : rows).push(r)
  }
  return { rows, dropped }
}
