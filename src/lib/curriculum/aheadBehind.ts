import { firstPassEffort, isFirstPassPending, type ModuleInput } from './roadmap'

/**
 * Where first-pass COVERAGE stands against the plan's own schedule, for the weekly proposal. Pure.
 * Coverage only: it says nothing about time spent or understanding. The stored plan and the task history are
 * untouched; this is a reading of them, and changing future accepted work still needs the student's review.
 */
export type Reconciliation = {
  /** Readings covered although their scheduled stretch has not opened yet. */
  ahead: { id: string; name: string; topic: string; plannedWeeks: string }[]
  /** Readings whose scheduled stretch has passed but whose first pass is not finished. They continue, not restart. */
  behind: { id: string; name: string; topic: string; plannedWeeks: string }[]
  /** First-pass minutes that no longer remain because of work done ahead of schedule. */
  firstPassMinutesRemoved: number
  firstPassMinutesRemaining: number
  summary: string | null
}

/** One topic's first-pass stretch in the plan the student accepted. */
export type PlannedStretch = { topicId: string; topicName: string; startWeek: number; endWeek: number }

/**
 * The schedule compared against is the ORIGINAL plan's stored stretches: a roadmap rebuilt from today's coverage moves
 * covered readings out of its weeks, so it could never say what was ahead of schedule.
 */
export function reconcileProgress(input: { plan: PlannedStretch[]; modules: ModuleInput[]; weekNumber: number; minutesPerEffortUnit: number }): Reconciliation {
  const ahead: Reconciliation['ahead'] = [], behind: Reconciliation['behind'] = []
  let removed = 0
  for (const ms of input.plan) {
    const span = ms.startWeek === ms.endWeek ? `week ${ms.startWeek}` : `weeks ${ms.startWeek}–${ms.endWeek}`
    for (const m of input.modules.filter(x => x.topic === ms.topicId)) {
      const id = m.id
      const row = { id, name: m.name, topic: ms.topicName, plannedWeeks: span }
      if (!isFirstPassPending(m) && ms.startWeek > input.weekNumber) { ahead.push(row); removed += firstPassEffort({ ...m, coverage: 'not_started' }) * input.minutesPerEffortUnit }
      else if (isFirstPassPending(m) && ms.endWeek < input.weekNumber) behind.push(row)
    }
  }
  const remaining = input.modules.filter(isFirstPassPending).reduce((n, m) => n + firstPassEffort(m) * input.minutesPerEffortUnit, 0)
  const names = (rows: { name: string }[]) => rows.slice(0, 3).map(r => r.name).join(', ') + (rows.length > 3 ? ` and ${rows.length - 3} more` : '')
  const parts: string[] = []
  if (ahead.length) parts.push(`You have covered ${ahead.length} reading${ahead.length === 1 ? '' : 's'} before ${ahead.length === 1 ? 'its' : 'their'} scheduled weeks (${names(ahead)}), so about ${Math.round(removed)} minutes of first-pass work no longer remains. Their maintenance revision stays in the rotation.`)
  if (behind.length) parts.push(`${behind.length} reading${behind.length === 1 ? ' is' : 's are'} past ${behind.length === 1 ? 'its' : 'their'} scheduled weeks and still unfinished (${names(behind)}). The remaining part continues; finished work is not redone.`)
  return { ahead, behind, firstPassMinutesRemoved: Math.round(removed), firstPassMinutesRemaining: Math.round(remaining),
    summary: parts.length ? `${parts.join(' ')} Your original plan and history are unchanged; you review any change before it is saved.` : null }
}
