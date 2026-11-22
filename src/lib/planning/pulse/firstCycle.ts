import { StudyWeek, weekdayOf, shiftStudyWeek, formatWeekRange } from '../studyWeek'
import { permitsStudyPortions } from './weekBoundary'

/**
 * Which cycle a student with no cycle yet starts in. One decision for every first-week path (onboarding preview,
 * activation recovery, Calendar, roadmap start), so they cannot disagree.
 *
 * A new student is placed in the current cycle while it still has a day with real study time. When it does not
 * (Sunday evening in a Monday–Sunday cycle, a class-led cycle on its last day with the windows gone), the first
 * plan is the NEXT cycle and the reason is kept so the review can say so. It advances at most once: if the next
 * cycle has no availability either, the student stays where they are and sees unplaced work and an availability
 * action, rather than the plan hunting forward for capacity.
 *
 * This is only for a student who has never had a cycle. An existing student's accepted cycle — even a deliberately
 * empty one — is never moved by it.
 */
export type InitialCycleReason = 'current_has_time' | 'no_study_day_left' | 'no_time_left' | 'no_availability'

export type InitialCycle = {
  week: StudyWeek
  advanced: boolean
  reason: InitialCycleReason
  /** The cycle that was current before any advance. */
  fromWeek: StudyWeek
}

export function decideInitialCycle(input: {
  current: StudyWeek
  today: string
  route: 'self_study' | 'coaching' | 'hybrid'
  /** Free study minutes by local date, measured from the present moment, for the current cycle and the one after it. */
  capacity: Record<string, number>
}): InitialCycle {
  const { current, today, route, capacity } = input
  const next = shiftStudyWeek(current, 1)
  const studyDays = (w: StudyWeek) => w.days.filter(d => d >= today && permitsStudyPortions(route, weekdayOf(d)))
  const withTime = (w: StudyWeek) => studyDays(w).filter(d => (capacity[d] ?? 0) > 0)

  if (withTime(current).length > 0) return { week: current, advanced: false, reason: 'current_has_time', fromWeek: current }

  const structuralNone = studyDays(current).length === 0
  if (withTime(next).length > 0) {
    return { week: next, advanced: true, reason: structuralNone ? 'no_study_day_left' : 'no_time_left', fromWeek: current }
  }
  // Nothing anywhere. Advance only when the current cycle cannot hold study at all; never search further.
  return structuralNone
    ? { week: next, advanced: true, reason: 'no_availability', fromWeek: current }
    : { week: current, advanced: false, reason: 'no_availability', fromWeek: current }
}

/** Plain explanation shown on the review before the student accepts. */
export function initialCycleNote(c: InitialCycle): string | null {
  if (!c.advanced) return c.reason === 'no_availability' ? 'You have no study windows in this cycle yet, so work is listed without times. Add availability in Calendar to place it.' : null
  const range = formatWeekRange(c.week)
  if (c.reason === 'no_availability') return `This cycle has no study days left, so your first plan covers ${range}. You have no study windows yet: add availability in Calendar to place the work.`
  return c.reason === 'no_study_day_left'
    ? `This cycle has no study days left, so your first plan covers ${range}. You can use Calendar straight away.`
    : `There is no study time left in this cycle, so your first plan covers ${range}. You can use Calendar straight away.`
}
