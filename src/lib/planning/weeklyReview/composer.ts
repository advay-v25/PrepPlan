/**
 * Placing continuing work in the proposed week. Pure.
 *
 * Continuing work is placed FIRST. Its minutes are then reserved, per day and from the weekly new-learning
 * budget, before new work is generated, so new work shrinks to make room instead of the week simply growing.
 * Everything here is a proposal the student sees and can change; nothing is scheduled until they accept.
 */
export type ContinuingItem = {
  taskId: string
  title: string
  taskType: string
  minutes: number
  intent: 'continue' | 'later'
  lmId: string | null
  outcomeId: string | null
  repairThreadId: string | null
  /** The day it was planned in the closing week, used only to keep earlier work first. */
  originalDate: string | null
}

export type Placement = { taskId: string; date: string | null; reason: string | null; note: string | null }

export type PlaceInput = {
  items: ContinuingItem[]
  weekDates: string[]
  /** Days new study may be placed on. The paper day (self-study) or class-boundary day is not one of them. */
  studyDates: string[]
  /** Free minutes per date, already net of the student's availability and protected commitments. */
  capacity: Record<string, number>
  maxSittingMinutes: number | null
  /** Local day when this proposal is built; even a manual placement cannot backdate new work. */
  notBeforeDate?: string
  /** The student's own choice per task: a date in the week, or 'none' to leave it unplaced. */
  overrides?: Record<string, string>
}

export type PlaceResult = {
  placements: Placement[]
  reservedByDate: Record<string, number>
  /** Placed study-like minutes: this is what the weekly new-learning budget gives up. */
  reservedStudyMinutes: number
}

const STUDY_LIKE = ['study', 'review', 'class_consolidation']
const rank = (t: string) => (t === 'repair' ? 0 : t === 'recheck' || t === 'verification' ? 2 : 1)

export function placeContinuing(input: PlaceInput): PlaceResult {
  const used: Record<string, number> = {}
  const placed = new Map<string, Placement>()
  const repairDateByThread = new Map<string, string | null>()
  const week = new Set(input.weekDates)
  const hasContinuingRepair = new Set(input.items.filter(i => i.taskType === 'repair' && i.repairThreadId).map(i => i.repairThreadId!))
  const overrides = input.overrides ?? {}

  const ordered = input.items.map((it, index) => ({ it, index })).sort((a, b) =>
    rank(a.it.taskType) - rank(b.it.taskType)
    || (a.it.originalDate ?? '9999').localeCompare(b.it.originalDate ?? '9999')
    || a.index - b.index).map(x => x.it)

  for (const it of ordered) {
    const done = (date: string | null, reason: string | null, note: string | null = null) => {
      placed.set(it.taskId, { taskId: it.taskId, date, reason, note })
      if (date) used[date] = (used[date] ?? 0) + it.minutes
      if (it.repairThreadId && it.taskType === 'repair') repairDateByThread.set(it.repairThreadId, date)
    }
    const choice = overrides[it.taskId]

    if (choice === 'none') { done(null, 'You chose to place this yourself.'); continue }
    if (choice && input.notBeforeDate && choice < input.notBeforeDate) {
      done(null, 'That day has already passed. Choose today or a later day, or leave this unplaced.'); continue
    }
    if (input.maxSittingMinutes && it.minutes > input.maxSittingMinutes) {
      done(null, `It is longer than your ${input.maxSittingMinutes}-minute sitting. Split it in Calendar to place it.`); continue
    }

    // A re-check must come after the repair it checks, never before it.
    let after: string | null = null
    if ((it.taskType === 'recheck' || it.taskType === 'verification') && it.repairThreadId && hasContinuingRepair.has(it.repairThreadId)) {
      after = repairDateByThread.get(it.repairThreadId) ?? null
      if (!after) { done(null, 'Its repair has not been placed yet, so this check waits for it.'); continue }
    }

    if (choice && week.has(choice)) {
      if (after && choice <= after) { done(null, 'A re-check has to come after its repair. Pick a later day.'); continue }
      const fuller = (used[choice] ?? 0) + it.minutes > (input.capacity[choice] ?? 0)
      const notStudyDay = !input.studyDates.includes(choice)
      done(choice, null, fuller ? 'This day is fuller than you planned.' : notStudyDay ? 'This is not one of your usual study days.' : null)
      continue
    }
    if (it.intent === 'later') { done(null, 'Kept for later, as you chose.'); continue }

    const fit = input.studyDates.find(d => (!input.notBeforeDate || d >= input.notBeforeDate)
      && (!after || d > after) && (input.capacity[d] ?? 0) - (used[d] ?? 0) >= it.minutes)
    if (fit) done(fit, null)
    else done(null, `There is no room this week: no day has ${it.minutes} free minutes after your commitments and planned work.`)
  }

  const placements = input.items.map(i => placed.get(i.taskId)!)
  const reservedByDate: Record<string, number> = {}
  let reservedStudyMinutes = 0
  for (const i of input.items) {
    const p = placed.get(i.taskId)!
    if (!p.date) continue
    reservedByDate[p.date] = (reservedByDate[p.date] ?? 0) + i.minutes
    if (STUDY_LIKE.includes(i.taskType)) reservedStudyMinutes += i.minutes
  }
  return { placements, reservedByDate, reservedStudyMinutes }
}

type PlanRow = { task_type?: unknown; lm_id?: unknown; title?: unknown; duration_minutes?: unknown }
export type Displaced = { title: string; mode: 'moved_back' | 'shortened'; minutesRemoved: number; reason: string }

/** What new work is no longer in the week, or is shorter, compared with a week that had no continuing work. */
export function explainDisplacement(baseline: PlanRow[], reduced: PlanRow[]): Displaced[] {
  const keep = new Map<string, number>()
  for (const r of reduced) if (['study', 'review'].includes(String(r.task_type)) && typeof r.lm_id === 'string' && r.lm_id) keep.set(r.lm_id, (keep.get(r.lm_id) ?? 0) + Number(r.duration_minutes ?? 0))
  const original = new Map<string, { title: string; minutes: number }>()
  for (const r of baseline) {
    if (!['study', 'review'].includes(String(r.task_type)) || typeof r.lm_id !== 'string' || !r.lm_id) continue
    const previous = original.get(r.lm_id)
    original.set(r.lm_id, { title: previous?.title ?? String(r.title ?? '').replace(/ · sitting \d+ of \d+$/, ''),
      minutes: (previous?.minutes ?? 0) + Number(r.duration_minutes ?? 0) })
  }
  const out: Displaced[] = []
  for (const [id, item] of original) {
    const was = item.minutes, now = keep.get(id) ?? 0
    if (now >= was) continue
    out.push({ title: item.title, mode: now === 0 ? 'moved_back' : 'shortened', minutesRemoved: was - now, reason: 'Continuing work from last week took this time.' })
  }
  return out
}
