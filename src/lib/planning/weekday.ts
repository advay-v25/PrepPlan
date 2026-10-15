import { Weekday, WEEKDAY_NAMES, WEEKDAY_SHORT } from './studyWeek'

/**
 * One weekday convention, and the conversions in and out of it.
 *
 * Three conventions were in use in tables a single onboarding screen writes to:
 * `availability_rules.weekday` was ISO (Monday = 1), while
 * `calendar_commitments.weekdays` and `profiles.diagnostic_day` were Sunday = 0.
 * Everything is now Sunday = 0, matching `Date#getDay` and `studyWeek.ts`.
 *
 * Raw weekday arithmetic belongs here and nowhere else. A `% 7` scattered
 * through feature code is how the three conventions diverged in the first place.
 */

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** ISO (Mon=1 … Sun=7) to the app's convention (Sun=0 … Sat=6). */
export function fromIso(iso: number): Weekday {
  if (!Number.isInteger(iso) || iso < 1 || iso > 7) {
    throw new RangeError(`Not an ISO weekday: ${iso}`)
  }
  return (iso % 7) as Weekday
}

/** The app's convention back to ISO, for anything that still speaks it. */
export function toIso(day: number): IsoWeekday {
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new RangeError(`Not a weekday: ${day}`)
  }
  return (day === 0 ? 7 : day) as IsoWeekday
}

export function isWeekday(value: unknown): value is Weekday {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6
}

/** Parses anything a form or API might send, or returns null. */
export function parseWeekday(value: unknown): Weekday | null {
  const n = typeof value === 'string' ? Number(value) : value
  return isWeekday(n) ? (n as Weekday) : null
}

export function weekdayName(day: Weekday): string {
  return WEEKDAY_NAMES[day]
}

export function weekdayShort(day: Weekday): string {
  return WEEKDAY_SHORT[day]
}

/**
 * The week in display order, starting Monday.
 *
 * Storage is Sunday-first because that is what `Date#getDay` returns, but a
 * study week reads better starting Monday, so the two are kept separate rather
 * than compromising on one that suits neither.
 */
export const DISPLAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

// ---------------------------------------------------------------------------
// Day parts
// ---------------------------------------------------------------------------

export type DayPart = 'morning' | 'afternoon' | 'evening'

export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening']

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

/**
 * The concrete window a day part is assumed to mean, before the student
 * confirms it.
 *
 * These are proposals, not preferences turned into facts. Onboarding shows them
 * on a confirm screen and lets every one be edited — the plan's rule is that a
 * preference may never silently become a timestamp.
 */
export const DAY_PART_DEFAULT_WINDOW: Record<DayPart, { start: string; end: string }> = {
  morning: { start: '07:00', end: '09:00' },
  afternoon: { start: '14:00', end: '17:00' },
  evening: { start: '18:00', end: '21:00' },
}

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

/**
 * A deliberately wide range for the weekly readout.
 *
 * Shown as "roughly 13–18 hours", never as a target and never with anything to
 * compare against. D13: the product does not prescribe hours, and a single
 * number invites a student to treat it as one.
 */
export function capacityRange(totalMinutes: number): { lowHours: number; highHours: number } {
  return {
    lowHours: Math.max(0, Math.floor((totalMinutes * 0.75) / 60)),
    highHours: Math.ceil(totalMinutes / 60),
  }
}
