import { Weekday, addDays, weekdayOf } from './studyWeek'

/**
 * Placement logic for calendar editing.
 *
 * Pure functions, no database. Conflict detection and slot suggestion are the
 * two places where a subtle error silently double-books a student, so they are
 * kept where they can be tested exhaustively.
 */

export type Interval = {
  /** Local date, YYYY-MM-DD. */
  date: string
  /** Minutes from local midnight. */
  start: number
  durationMinutes: number
}

export type Occupant = Interval & {
  id: string
  title: string
  /** Protected occupants refuse overlap; everything else merely warns. */
  isProtected: boolean
  kind: 'commitment' | 'class' | 'task' | 'mock'
}

export const end = (i: Interval) => i.start + i.durationMinutes

/** Half-open overlap: a block ending at 18:00 does not conflict with one starting at 18:00. */
export function overlaps(a: Interval, b: Interval): boolean {
  if (a.date !== b.date) return false
  return a.start < end(b) && b.start < end(a)
}

export type Conflict = {
  occupant: Occupant
  overlapMinutes: number
}

export function findConflicts(
  candidate: Interval,
  occupants: Occupant[],
  options: { ignoreIds?: string[]; protectedOnly?: boolean } = {}
): Conflict[] {
  const ignore = new Set(options.ignoreIds ?? [])
  return occupants
    .filter(o => !ignore.has(o.id))
    .filter(o => (options.protectedOnly ? o.isProtected : true))
    .filter(o => overlaps(candidate, o))
    .map(o => ({
      occupant: o,
      overlapMinutes: Math.min(end(candidate), end(o)) - Math.max(candidate.start, o.start),
    }))
    .sort((a, b) => b.overlapMinutes - a.overlapMinutes)
}

// ---------------------------------------------------------------------------
// Slot suggestion
// ---------------------------------------------------------------------------

export type SlotSuggestion = {
  date: string
  start: number
  /** Why this one is being offered, in the student's terms. */
  label: string
}

const DAY_START = 6 * 60
const DAY_END = 23 * 60
const STEP = 15

function fits(candidate: Interval, occupants: Occupant[], ignoreIds: string[]): boolean {
  if (candidate.start < DAY_START || end(candidate) > DAY_END) return false
  return findConflicts(candidate, occupants, { ignoreIds, protectedOnly: true }).length === 0
}

/**
 * The nearest places a block of this length actually fits.
 *
 * Refusing a drop without saying where it could go leaves the student to hunt.
 * Candidates are ordered by how far they are from what was attempted, so the
 * first suggestion is the smallest change to their intent.
 */
export function suggestSlots(
  attempted: Interval,
  occupants: Occupant[],
  options: { ignoreIds?: string[]; searchDays?: string[]; limit?: number } = {}
): SlotSuggestion[] {
  const ignoreIds = options.ignoreIds ?? []
  const limit = options.limit ?? 3
  const days = options.searchDays ?? [attempted.date, addDays(attempted.date, 1), addDays(attempted.date, -1)]

  type Scored = SlotSuggestion & { distance: number }
  const found: Scored[] = []

  for (const date of days) {
    const dayOffset = Math.abs(daysApart(date, attempted.date))
    for (let start = DAY_START; start + attempted.durationMinutes <= DAY_END; start += STEP) {
      const candidate = { date, start, durationMinutes: attempted.durationMinutes }
      if (!fits(candidate, occupants, ignoreIds)) continue

      const minuteDistance = date === attempted.date ? Math.abs(start - attempted.start) : Math.abs(start - attempted.start) / 4
      const distance = dayOffset * 10_000 + minuteDistance
      found.push({ date, start, distance, label: describeSlot(date, start, attempted) })
    }
  }

  found.sort((a, b) => a.distance - b.distance)

  // One suggestion per contiguous free run, so three options are three real
  // choices rather than 7:00, 7:15 and 7:30.
  const spread: Scored[] = []
  for (const slot of found) {
    const tooClose = spread.some(s => s.date === slot.date && Math.abs(s.start - slot.start) < 90)
    if (!tooClose) spread.push(slot)
    if (spread.length >= limit) break
  }

  return spread.map(({ date, start, label }) => ({ date, start, label }))
}

function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000)
}

function describeSlot(date: string, start: number, attempted: Interval): string {
  const time = formatMinutes(start)
  if (date === attempted.date) {
    if (start > attempted.start) return `${time}, just after`
    return `${time}, earlier that day`
  }
  const delta = daysApart(date, attempted.date)
  return delta === 1 ? `Next day, ${time}` : delta === -1 ? `Day before, ${time}` : `${date}, ${time}`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

export type SplitResult = {
  first: { durationMinutes: number }
  second: { durationMinutes: number; date: string | null; start: number | null }
}

/**
 * Splits a session in two without changing what it covers.
 *
 * Scope is preserved: the two halves together are the original task. Resizing
 * changes how long a sitting is, splitting changes how many sittings it takes —
 * neither reduces what has to be learned. Reducing scope is a separate,
 * explicit action.
 */
export function splitTask(
  task: Interval & { durationMinutes: number },
  options: { at?: number; occupants?: Occupant[]; ignoreIds?: string[] } = {}
): SplitResult {
  const total = task.durationMinutes
  if (total < 30) throw new Error('A session shorter than 30 minutes cannot usefully be split')

  const first = options.at ?? Math.floor(total / 10) * 5
  if (!Number.isInteger(first) || first < 15 || first > total - 15 || first % 5 !== 0) {
    throw new Error('Each sitting needs at least 15 minutes; use a whole 5-minute split point.')
  }
  const second = total - first
  // The student places the remaining sitting. Never invent a time or spill it
  // beyond the accepted cycle merely because a class fills today's gaps.
  return {
    first: { durationMinutes: first },
    second: {
      durationMinutes: second,
      date: null,
      start: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Recurrence expansion
// ---------------------------------------------------------------------------

export type RecurringCommitment = {
  id: string
  label: string
  kind: string
  isProtected: boolean
  recurrence: 'none' | 'weekly'
  weekdays: number[]
  startTime: string | null
  endTime: string | null
  startsOn: string | null
  endsOn: string | null
}

export type CommitmentException = {
  commitmentId: string
  occurrenceDate: string
  kind: 'skipped' | 'moved'
  newDate: string | null
  newStartTime: string | null
  newEndTime: string | null
}

export type Occurrence = {
  commitmentId: string
  label: string
  kind: string
  isProtected: boolean
  date: string
  start: number
  durationMinutes: number
  /** True when this occurrence was individually moved from its series slot. */
  moved: boolean
  /** The series slot this occurrence belongs to (its identity); equals `date` unless it was moved. */
  originalDate: string
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

/**
 * Expands a weekly commitment across a set of dates, applying exceptions.
 *
 * A skipped occurrence disappears; a moved one appears at its new date and time.
 * The series itself is never rewritten, so "this week my class is on Sunday"
 * does not corrupt every other week.
 */
export function expandCommitment(
  commitment: RecurringCommitment,
  dates: string[],
  exceptions: CommitmentException[]
): Occurrence[] {
  if (commitment.recurrence !== 'weekly') return []
  if (!commitment.startTime || !commitment.endTime) return []

  const byDate = new Map(
    exceptions.filter(e => e.commitmentId === commitment.id).map(e => [e.occurrenceDate, e])
  )

  const baseStart = timeToMinutes(commitment.startTime)
  const baseEnd = timeToMinutes(commitment.endTime)
  const baseDuration = Math.max(15, baseEnd - baseStart)

  const out: Occurrence[] = []
  const window = new Set(dates)

  // Occurrences that moved INTO this window from a date outside it still belong
  // in the week being rendered.
  const candidateDates = new Set(dates)
  for (const e of byDate.values()) {
    if (e.kind === 'moved' && e.newDate && window.has(e.newDate)) candidateDates.add(e.occurrenceDate)
  }

  for (const date of candidateDates) {
    if (!commitment.weekdays.includes(weekdayOf(date) as Weekday)) continue
    if (commitment.startsOn && date < commitment.startsOn) continue
    if (commitment.endsOn && date > commitment.endsOn) continue

    const exception = byDate.get(date)
    if (exception?.kind === 'skipped') continue

    if (exception?.kind === 'moved') {
      const movedDate = exception.newDate ?? date
      if (!window.has(movedDate)) continue
      const start = exception.newStartTime ? timeToMinutes(exception.newStartTime) : baseStart
      const finish = exception.newEndTime ? timeToMinutes(exception.newEndTime) : start + baseDuration
      out.push({
        commitmentId: commitment.id, label: commitment.label, kind: commitment.kind,
        isProtected: commitment.isProtected, date: movedDate, start,
        durationMinutes: Math.max(15, finish - start), moved: true, originalDate: date,
      })
      continue
    }

    if (!window.has(date)) continue
    out.push({
      commitmentId: commitment.id, label: commitment.label, kind: commitment.kind,
      isProtected: commitment.isProtected, date, start: baseStart,
      durationMinutes: baseDuration, moved: false, originalDate: date,
    })
  }

  return out.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Guard rails on the values themselves
// ---------------------------------------------------------------------------

export const MIN_DURATION = 5
export const MAX_DURATION = 180

export function validateDuration(minutes: number, existing?: number): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isFinite(minutes)) return { ok: false, error: 'Duration must be a number' }
  const rounded = minutes === existing && Number.isInteger(minutes) ? minutes : Math.round(minutes / 5) * 5
  if (rounded < MIN_DURATION) return { ok: false, error: `A session cannot be shorter than ${MIN_DURATION} minutes` }
  if (rounded > MAX_DURATION) return { ok: false, error: `A single sitting longer than ${MAX_DURATION} minutes is not a session — split it instead` }
  return { ok: true, value: rounded }
}

export function validateStart(minutes: number): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isFinite(minutes)) return { ok: false, error: 'Start time must be a number' }
  const rounded = Math.round(minutes / 5) * 5
  if (rounded < 0 || rounded >= 24 * 60) return { ok: false, error: 'Start time must fall within the day' }
  return { ok: true, value: rounded }
}

/** Manual changes can be exceptions to usual preferences, but never silently. Protected-time checks remain separate and cannot be overridden. */
export function manualPlacementWarnings(start: number | null, duration: number, maxSession: number | null, windows: { start: number; end: number }[]): string[] {
  const warnings: string[] = []
  if (maxSession !== null && duration > maxSession) warnings.push(`This ${duration}-minute sitting is longer than your usual ${maxSession}-minute limit.`)
  if (start !== null && !windows.some(w => start >= w.start && start + duration <= w.end)) warnings.push('This sitting is outside your saved study windows. Keep it only if you have time on this occasion.')
  else if (start === null && windows.length === 0) warnings.push('You have no saved study window on this day. Keep it only if you have time on this occasion.')
  else if (start === null && !windows.some(w => w.end - w.start >= duration)) warnings.push('No single saved study window on this day is long enough for this sitting. Keep it only if you have extra time on this occasion.')
  return warnings
}
