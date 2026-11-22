import { addDays, todayInZone } from '../planning/studyWeek'

/** Scheduling default, not a retention claim: the check comes this many days after the last repair. (plan.ts re-exports it.) */
export const RECHECK_GAP_DAYS = 3

/**
 * `repair_threads.next_recheck_due_at` is a CALENDAR DATE kept in a timestamptz column, by convention midnight UTC of that date. It is never an instant:
 * read it only through this function, never `new Date(x) <= now` (that makes the check due 8 hours early in Los Angeles and 5.5 hours late in Kolkata) and
 * never `x.slice(0, 10)` (wrong for an offset string). The database writes and reads it with an explicit `at time zone 'UTC'`, so no session setting matters.
 */
export const dueDateOf = (stored: string | null | undefined): string | null => (stored ? new Date(stored).toISOString().slice(0, 10) : null)

/** The first calendar date (the student's own) on which a re-check may start: the latest of the planned day, any advertised due date, and last repair completion + the gap. */
export function repairCheckAvailableDate(planned: string | null, advertised: string[], completedAt: string, timezone: string) {
  return [planned, ...advertised, addDays(todayInZone(timezone, new Date(completedAt)), RECHECK_GAP_DAYS)].filter(Boolean).sort().at(-1)!
}

/** Eligibility is a comparison of two calendar dates in the student's zone, so it cannot depend on the server's zone. `now` is injectable. */
export function recheckEligibility(i: { planned: string | null; storedDue: (string | null | undefined)[]; completedAt: string; timezone: string; now?: Date }) {
  const today = todayInZone(i.timezone, i.now ?? new Date())
  const availableDate = repairCheckAvailableDate(i.planned, i.storedDue.flatMap(d => dueDateOf(d) ?? []), i.completedAt, i.timezone)
  return { today, availableDate, eligible: availableDate <= today }
}
