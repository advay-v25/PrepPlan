import { packWhole, type Gap } from '../pulse/gaps'

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

/** One sitting of a carried task. `date` null = it waits, with the reason. `start` (minutes from local midnight) is set only for an added window. */
export type Sitting = { date: string | null; minutes: number; start?: number; startsAt?: string; reason?: string }
export type Placement = { taskId: string; date: string | null; reason: string | null; note: string | null; /** Set when the student added a window for it: saved timed at this instant. */ startsAt?: string; /** Present when the task is saved as more than one ordered sitting. */ sittings?: Sitting[] }

/** Study and revision may be done across ordered sittings. A repair or a re-check is one sitting; so is a timed mock. */
export const SPLITTABLE = ['study', 'review', 'class_consolidation']
export const MIN_SITTING = 15
/**
 * The next sitting to take from `need` into a gap of `room` minutes; 0 when nothing worthwhile fits. What is left is divided evenly over the fewest
 * sittings the limit allows (45 minutes at a 20-minute limit is 15 + 15 + 15), so no tiny remainder is stranded; a saved sitting is never under 5.
 */
export function nextSitting(need: number, room: number, limit: number): number {
  const even = Math.ceil(need / Math.ceil(need / limit))
  let take = Math.min(room, even)
  if (need - take > 0 && need - take < 5) take = need - 5
  return take >= Math.min(MIN_SITTING, even) ? take : 0
}
/** Why work that must stay in one sitting could not be placed, and what would take it. */
export function oneSittingReason(taskType: string, minutes: number, limit: number | null): string {
  const what = taskType === 'repair' ? 'this repair' : 'this check'
  return `No room this week: ${what} is done in one sitting, so it needs a single ${minutes}-minute opening${limit && minutes > limit ? `, longer than your ${limit}-minute study sitting` : ''}. Add a window of at least ${minutes} minutes, or free one in Calendar.`
}
/** Chronological order (waiting sittings last), the order the sittings are declared to be done in. */
export const inOrder = (list: Sitting[]) => [...list].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.start ?? -1) - (b.start ?? -1))

export type PlaceInput = {
  items: ContinuingItem[]
  weekDates: string[]
  /** Days new study may be placed on. The paper day (self-study) or class-boundary day is not one of them. */
  studyDates: string[]
  /** Free minutes per date, already net of the student's availability and protected commitments. */
  capacity: Record<string, number>
  gapsByDate?: Record<string, Gap[]>
  /** Days an EXPLICIT student choice may use. Defaults to studyDates; repairs allow any day of the week (a non-study day is allowed with a note). */
  overrideDates?: string[]
  maxSittingMinutes: number | null
  /** Local day when this proposal is built; even a manual placement cannot backdate new work. */
  notBeforeDate?: string
  /** The student's own choice per task: a date in the week, or 'none' to leave it unplaced. */
  overrides?: Record<string, string>
}

export type PlaceResult = {
  placements: Placement[]
  reservedByDate: Record<string, number>
  gapsAfterContinuations?: Record<string, Gap[]>
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
  const gaps = input.gapsByDate && { ...input.gapsByDate }
  const room = (date: string, minutes: number) => gaps
    ? packWhole(gaps[date] ?? [], minutes) !== null
    : (input.capacity[date] ?? 0) - (used[date] ?? 0) >= minutes

  const ordered = input.items.map((it, index) => ({ it, index })).sort((a, b) =>
    rank(a.it.taskType) - rank(b.it.taskType)
    || (a.it.originalDate ?? '9999').localeCompare(b.it.originalDate ?? '9999')
    || a.index - b.index).map(x => x.it)

  for (const it of ordered) {
    const done = (date: string | null, reason: string | null, note: string | null = null) => {
      placed.set(it.taskId, { taskId: it.taskId, date, reason, note })
      if (date) {
        used[date] = (used[date] ?? 0) + it.minutes
        if (gaps) gaps[date] = packWhole(gaps[date] ?? [], it.minutes) ?? []
      }
      if (it.repairThreadId && it.taskType === 'repair') repairDateByThread.set(it.repairThreadId, date)
    }
    const choice = overrides[it.taskId]

    if (choice === 'none') { done(null, 'You chose to place this yourself.'); continue }
    if (choice && input.notBeforeDate && choice < input.notBeforeDate) {
      done(null, 'That day has already passed. Choose today or a later day, or leave this unplaced.'); continue
    }
    const splittable = SPLITTABLE.includes(it.taskType)
    const limit = input.maxSittingMinutes
    const tooLong = Boolean(limit && it.minutes > limit)
    if (tooLong && !splittable) { done(null, oneSittingReason(it.taskType, it.minutes, limit)); continue }

    // A re-check must come after the repair it checks, never before it.
    let after: string | null = null
    if ((it.taskType === 'recheck' || it.taskType === 'verification') && it.repairThreadId && hasContinuingRepair.has(it.repairThreadId)) {
      after = repairDateByThread.get(it.repairThreadId) ?? null
      if (!after) { done(null, 'Its repair has not been placed yet, so this check waits for it.'); continue }
    }

    const chosen = choice && week.has(choice) ? choice : null
    if (chosen) {
      if (after && chosen <= after) { done(null, 'A re-check has to come after its repair. Pick a later day.'); continue }
      const fuller = !room(chosen, it.minutes)
      const notStudyDay = !input.studyDates.includes(chosen), notAllowed = !(input.overrideDates ?? input.studyDates).includes(chosen)
      if (gaps && notAllowed) { done(null, 'That day is outside this week’s study schedule. Choose another day or leave this unplaced.'); continue }
      if (!tooLong && !(gaps && fuller)) { done(chosen, null, fuller ? 'This day is fuller than you planned.' : notStudyDay ? 'This is not one of your usual study days.' : null); continue }
      if (!splittable || !gaps) { done(null, `That day has no single ${it.minutes}-minute opening. Choose another day or leave this unplaced.`); continue }
    }
    if (!chosen && it.intent === 'later') { done(null, 'Kept for later, as you chose.'); continue }

    const days = chosen ? [chosen] : input.studyDates.filter(d => (!input.notBeforeDate || d >= input.notBeforeDate) && (!after || d > after))
    const fit = !chosen && !tooLong ? days.find(d => room(d, it.minutes)) : undefined
    if (fit) { done(fit, null); continue }

    // Study and revision continue across ordered sittings: what fits is proposed, the rest waits.
    if (splittable && gaps) {
      const cap = limit ?? it.minutes
      const sittings: Sitting[] = []
      let need = it.minutes
      for (const d of days) {
        for (let i = 0; need > 0 && i < (gaps[d] ?? []).length && sittings.length < 12;) {
          const g = gaps[d][i], take = nextSitting(need, g.end - g.start, cap)
          if (!take) { i++; continue }
          gaps[d] = gaps[d].map((x, k) => k === i ? { start: x.start + take, end: x.end } : x)
          sittings.push({ date: d, minutes: take }); need -= take
        }
      }
      if (sittings.length) {
        if (need > 0) sittings.push({ date: null, minutes: need, reason: chosen ? 'The chosen day has no room for the rest.' : 'No further opening this week; it stays owed.' })
        for (const x of sittings) if (x.date) used[x.date] = (used[x.date] ?? 0) + x.minutes
        placed.set(it.taskId, sittings.length === 1 ? { taskId: it.taskId, date: sittings[0].date, reason: null, note: null } : { taskId: it.taskId, date: sittings[0].date, reason: null, note: null, sittings })
        continue
      }
    }
    done(null, splittable ? 'There is no room this week: no opening is long enough for even a short sitting after your commitments and planned work.' : oneSittingReason(it.taskType, it.minutes, limit))
  }

  const placements = input.items.map(i => placed.get(i.taskId)!)
  const reservedByDate: Record<string, number> = {}
  let reservedStudyMinutes = 0
  for (const i of input.items) {
    const p = placed.get(i.taskId)!
    for (const x of p.sittings ?? [{ date: p.date, minutes: i.minutes }]) {
      if (!x.date) continue
      reservedByDate[x.date] = (reservedByDate[x.date] ?? 0) + x.minutes
      if (STUDY_LIKE.includes(i.taskType)) reservedStudyMinutes += x.minutes
    }
  }
  return { placements, reservedByDate, reservedStudyMinutes, gapsAfterContinuations: gaps }
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
