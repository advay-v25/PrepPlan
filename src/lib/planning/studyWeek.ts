import { isCalendarDate } from '../format/date'

/**
 * The study week.
 *
 * A study week is not Monday-to-Sunday. It ends on the day the student chose to
 * review and be tested — `profiles.diagnostic_day` — and begins the day after.
 * Everything else in planning hangs off this: the weekly cumulative diagnostic
 * is placed on the last day, and anything that diagnostic produces belongs to
 * the *next* week, because there is no week left to schedule it into.
 *
 * All date arithmetic here is done in the student's own timezone. The previous
 * planner treated local clock values as UTC, which silently moves every task by
 * the offset — 5.5 hours for a student in Asia/Kolkata, enough to push an
 * evening session into the next day.
 */

/** 0 = Sunday, through 6 = Saturday. Matches Date#getDay and profiles.diagnostic_day. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** The day a student is assumed to review and test on, when they have not chosen one. */
export const DEFAULT_DIAGNOSTIC_DAY: Weekday = 0 // Sunday

export type StudyWeek = {
  /** Local calendar date of the first day, YYYY-MM-DD. */
  startDate: string
  /** Local calendar date of the last day — the diagnostic day. */
  endDate: string
  /** Every date in the operational cycle, in order. Always seven entries. */
  days: string[]
  timezone: string
  anchorDay: Weekday
  /** True when this week's boundary actually came from a class (recurring or a confirmed one-off), not the default Monday-Sunday fallback. */
  classLed: boolean
}

// ---------------------------------------------------------------------------
// Timezone-correct conversion, without a date library
// ---------------------------------------------------------------------------

/**
 * How far the named zone is from UTC at a given instant, in milliseconds.
 * Positive east of Greenwich.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  // Intl renders hour 24 for midnight in some engines.
  const hour = parts.hour === 24 ? 0 : parts.hour
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second)
  return asIfUtc - instant.getTime()
}

/**
 * Converts a local wall-clock date and time in `timeZone` to a real instant.
 *
 * Two passes: the offset depends on the instant, and the instant depends on the
 * offset. One pass is wrong across a DST boundary; the second settles it.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  if ([y, m, d, hh, mm].some(n => !Number.isFinite(n))) {
    throw new Error(`Invalid local datetime: "${dateStr}" "${timeStr}"`)
  }
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0)
  let instant = naive - zoneOffsetMs(new Date(naive), timeZone)
  instant = naive - zoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** The local calendar date and clock time of an instant, in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): {
  date: string
  time: string
  weekday: Weekday
  minutesOfDay: number
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const hour = parts.hour === '24' ? '00' : parts.hour
  const weekday = WEEKDAY_SHORT.indexOf(parts.weekday as any) as Weekday
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
    weekday,
    minutesOfDay: Number(hour) * 60 + Number(parts.minute),
  }
}

/** Today's local calendar date in `timeZone`. */
export function todayInZone(timeZone: string, reference: Date = new Date()): string {
  return utcToZonedParts(reference, timeZone).date
}

// ---------------------------------------------------------------------------
// Calendar-date arithmetic (no timezone involved — these are plain dates)
// ---------------------------------------------------------------------------

/** A real calendar date inside a navigable range (2020–2100): "2026-02-30", "not-a-date" and "9999-12-31" are all refused. */
export function parseLocalDate(value: unknown): string | null {
  if (!isCalendarDate(value)) return null
  const y = Number(value.slice(0, 4))
  if (y < 2020 || y > 2100) return null
  return value
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function weekdayOf(dateStr: string): Weekday {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday
}

export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

// ---------------------------------------------------------------------------
// The study week itself
// ---------------------------------------------------------------------------

/**
 * The study week containing `reference`.
 *
 * The week ends on `anchorDay` and begins the day after the previous one. A
 * reference date that falls on the anchor day is the *last* day of its week,
 * not the first — the student still has that day's diagnostic ahead of them.
 */
export function resolveStudyWeek(options: {
  anchorDay?: Weekday | null
  timezone?: string | null
  reference?: Date | string
}): StudyWeek {
  const timezone = options.timezone || 'UTC'
  const anchorDay = (options.anchorDay ?? DEFAULT_DIAGNOSTIC_DAY) as Weekday

  const today = typeof options.reference === 'string'
    ? options.reference
    : todayInZone(timezone, options.reference ?? new Date())

  // Days forward from today to the next occurrence of the anchor (0 if today).
  const forward = (anchorDay - weekdayOf(today) + 7) % 7
  const endDate = addDays(today, forward)
  const startDate = addDays(endDate, -6)

  return {
    startDate,
    endDate,
    days: Array.from({ length: 7 }, (_, i) => addDays(startDate, i)),
    timezone,
    anchorDay,
    // This function only ever takes a fixed weekday (it reconstructs a week from a stored anchor, such as a
    // past attempt's week), so a non-default anchor is the only signal available that a class set it.
    classLed: anchorDay !== DEFAULT_DIAGNOSTIC_DAY,
  }
}

/** The same week, moved `n` weeks forward (or back, for negative n). */
export function shiftStudyWeek(week: StudyWeek, n: number): StudyWeek {
  const startDate = addDays(week.startDate, n * 7)
  const cycleLength = week.days.length
  return {
    ...week,
    startDate,
    endDate: addDays(startDate, cycleLength - 1),
    days: Array.from({ length: cycleLength }, (_, i) => addDays(startDate, i)),
  }
}

/** The seven-day period (of the same length and boundary as `week`) that holds `date`, counted outwards from `week` so periods never overlap or skip. */
export function adjacentWeek(week: StudyWeek, date: string): StudyWeek {
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
  return shiftStudyWeek(week, date > week.endDate ? Math.ceil(days(week.endDate, date) / 7) : date < week.startDate ? -Math.ceil(days(date, week.startDate) / 7) : 0)
}

export function studyWeekContaining(dateStr: string, anchorDay: Weekday, timezone: string): StudyWeek {
  return resolveStudyWeek({ anchorDay, timezone, reference: dateStr })
}

export function isWithinWeek(dateStr: string, week: StudyWeek): boolean {
  return dateStr >= week.startDate && dateStr <= week.endDate
}

/**
 * Is this date the last day of its study week?
 *
 * This is the general form of the "Sunday rule": work produced by a diagnostic
 * taken on the final day has no room left in the current week, so it belongs to
 * the next one. Encoding it as "Sunday" would be wrong for any student whose
 * week ends on another day.
 */
export function isEndOfCycle(dateStr: string, week: StudyWeek): boolean {
  return dateStr === week.endDate
}

/**
 * Where follow-up work from a diagnostic taken on `takenOn` should land.
 *
 * Returns the earliest date the repair may be scheduled, and the week it falls
 * in. Same-day repair is never proposed: a student who has just finished a
 * cumulative test does not do their repair in the remaining hours of that day.
 */
export function repairPlacementFor(takenOn: string, week: StudyWeek): {
  earliestDate: string
  targetWeek: StudyWeek
  reason: string
} {
  if (isEndOfCycle(takenOn, week)) {
    const next = shiftStudyWeek(week, 1)
    return {
      earliestDate: next.startDate,
      targetWeek: next,
      reason: `This diagnostic closed the study week ending ${takenOn}, so its follow-up work opens the next one.`,
    }
  }
  const nextDay = addDays(takenOn, 1)
  return {
    earliestDate: nextDay,
    targetWeek: week,
    reason: `There are still ${daysBetween(takenOn, week.endDate)} day(s) left in this study week, so the follow-up fits inside it.`,
  }
}

/** Human-readable range, e.g. "8–14 Sep 2026". */
export function formatWeekRange(week: StudyWeek, locale = 'en-GB'): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, dd] = d.split('-').map(Number)
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, dd)))
  }
  const sameMonth = week.startDate.slice(0, 7) === week.endDate.slice(0, 7)
  return sameMonth
    ? `${fmt(week.startDate, { day: 'numeric' })}–${fmt(week.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${fmt(week.startDate, { day: 'numeric', month: 'short' })} – ${fmt(week.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
