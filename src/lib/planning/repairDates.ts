import { addDays } from './studyWeek'

/** Dates are suggestions, not reserved capacity. A re-check follows the LAST repair. */
export function repairDates(firstSuggested: string, today: string, count: number, cycle: { start: string; end: string } | null) {
  const first = firstSuggested < today ? today : firstSuggested
  const repairs = Array.from({ length: count }, (_, i) => addDays(first, Math.floor(i / 2)))
  const recheck = addDays(repairs.at(-1) ?? first, 3)
  const dates = [...repairs, recheck]
  return {
    repairs, recheck, start: first, end: recheck,
    requiresWeeklyReview: !cycle || dates.some(d => d < cycle.start || d > cycle.end),
  }
}
