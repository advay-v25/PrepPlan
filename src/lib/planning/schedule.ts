import { createAdminClient } from '../supabase/admin'
import { createClient } from '../supabase/server'
import {
  StudyWeek, Weekday, adjacentWeek, addDays, formatWeekRange,
  isEndOfCycle, repairPlacementFor, resolveStudyWeek, shiftStudyWeek, weekdayOf,
  todayInZone, zonedTimeToUtc,
} from './studyWeek'
import { cycleStartClassDay, resolvePulseWeek } from './pulse/weekBoundary'
import { decideInitialCycle, REVIEW_BUFFER_MINUTES, USABLE_GAP_MINUTES, type InitialCycle } from './pulse/firstCycle'
import { freeRangesForDates, minutesBetween } from './pulse/capacity'
import { perRequest, minuteOf } from '../ops/perRequest'
import { profileRow } from '../ops/sharedReads'
import { weeklySeries } from '../ops/sharedReads'

/**
 * The bridge between diagnostics and the calendar.
 *
 * Two rules govern it:
 *
 *  1. The weekly cumulative diagnostic sits on the last day of the study week,
 *     whichever weekday that is for this student. It is a scheduled task like
 *     any other, so it appears in the calendar, can be moved, and can be seen
 *     coming.
 *
 *  2. Nothing a diagnostic produces is written straight into an accepted week.
 *     Evidence creates a *proposal*; only an accepted proposal becomes a task.
 *     A test taken on the last day of a cycle has no room left in that week, so
 *     its follow-up opens the next one.
 */

export type StudyWeekContext = {
  week: StudyWeek
  anchorDay: Weekday
  /** True when the week's boundary actually came from a class, not the default Monday-Sunday fallback. */
  classLed: boolean
  timezone: string
  today: string
  /** Default clock time for the weekly diagnostic, local. */
  diagnosticTime: string
  /** Set when this student has never had a cycle and the first one was chosen by `decideInitialCycle`. */
  initialCycle: InitialCycle | null
}


type ClassSeries = { weekdays: Weekday[]; starts_on: string | null; ends_on: string | null }
/** Every active weekly class series, with its own effective dates. */
async function classSeries(userId: string): Promise<ClassSeries[]> {
  const data = (await weeklySeries(userId)).filter(r => r.kind === 'class' && r.status === 'active')
  return data.map(r => ({ weekdays: (r.weekdays ?? []) as Weekday[], starts_on: r.starts_on, ends_on: r.ends_on }))
}
/** The class weekdays in force on one local date: only series whose own dates include it. */
export function effectiveWeekdays(series: ClassSeries[], date: string): Weekday[] {
  return [...new Set(series.filter(s => (!s.starts_on || s.starts_on <= date) && (!s.ends_on || s.ends_on >= date)).flatMap(s => s.weekdays))]
}
/**
 * The cycle for a date beyond every known cycle, chained forward from the end of the last accepted or current one (`known`).
 * A cycle closes the day before the next class that STARTS a cycle under the schedule in force on that class day (founder decision §19): in steady
 * state that is seven days, but the first cycle affected by a class-pattern change closes before the next class of the changed schedule even when
 * that makes it shorter than seven days. Consecutive cycles never overlap or leave a gap, and self-study (no class days) keeps Monday-start cycles.
 */
export function prospectiveWeek(series: ClassSeries[], date: string, known: string, timezone: string): StudyWeek {
  const startDayOf = (days: Weekday[]): Weekday => (days.length ? cycleStartClassDay(days) : 1)
  let start = addDays(known, 1)
  for (let guard = 0; guard < 400; guard++) {
    let end = start
    for (let n = 0; n < 40; n++, end = addDays(end, 1)) {
      const next = addDays(end, 1)
      if (weekdayOf(next) === startDayOf(effectiveWeekdays(series, next))) break
    }
    if (date <= end) {
      const weekdays = effectiveWeekdays(series, start)
      const len = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
      return { startDate: start, endDate: end, days: Array.from({ length: len }, (_, i) => addDays(start, i)), timezone, anchorDay: weekdayOf(end), classLed: weekdays.length > 0 }
    }
    start = addDays(end, 1)
  }
  throw new Error('Could not resolve the cycle for that date.')
}

/** Resolves the student's study week from their profile. */
async function getStudyWeekContextUncached(
  userId: string,
  reference?: Date | string
): Promise<StudyWeekContext> {
  const admin = createAdminClient()
  const now = typeof reference === 'string' ? null : (reference ?? new Date())
  const [{ data: profile }, series, { data: nextClass }] = await Promise.all([
    profileRow(userId).then(data => ({ data })),
    classSeries(userId),
    // A variable pattern's confirmed next class — see resolvePulseWeek's anchor rule. Ignored once a
    // recurring pattern exists (the query above already found one), so it is always safe to fetch.
    admin.from('calendar_commitments').select('starts_at')
      .eq('user_id', userId).eq('kind', 'class').eq('status', 'active').eq('recurrence', 'none').eq('defines_cycle', true)
      .gt('starts_at', (now ?? new Date()).toISOString()).order('starts_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const timezone = profile?.timezone || 'UTC'
  // The pattern in force on the asked-about local day: a series bounds BOTH ways (it starts on `starts_on`, ends on `ends_on`), so an old series
  // and its successor are never combined and a future pattern does not anchor today.
  const localDate = typeof reference === 'string' ? reference : todayInZone(timezone, now ?? new Date())
  const classWeekdays = effectiveWeekdays(series, localDate)
  const nextClassDate = nextClass?.starts_at ? todayInZone(timezone, new Date(nextClass.starts_at as string)) : null
  let week = resolvePulseWeek({ classWeekdays, nextClassDate, timezone, reference })
  let initialCycle: InitialCycle | null = null

  // Only a "live" lookup (no explicit date asked for) picks the starting cycle; navigating to a date never does.
  if (now) {
    const { data: cycles } = await admin.from('planning_cycles').select('status, starts_at_local, ends_at_local, timezone')
      .eq('user_id', userId).order('starts_at_local', { ascending: false }).limit(5)
    const active = (cycles ?? []).find(c => c.status === 'active')
    if (active) {
      // An accepted cycle is the current plan until closed, even after its class pattern or the clock changes.
      week = weekFromCycle(active, week, !!profile?.class_pattern && profile.class_pattern !== 'none')
    } else if ((cycles ?? []).length === 0) {
      // Never had a cycle: the shared first-cycle decision. An existing student's cycle (even an empty one) is never moved.
      const today0 = todayInZone(timezone, now)
      const [{ data: prof2 }] = await Promise.all([admin.from('profiles').select('prep_mode').eq('id', userId).maybeSingle()])
      const route = prof2?.prep_mode === 'instructor_led' ? 'coaching' : prof2?.prep_mode === 'hybrid' ? 'hybrid' : 'self_study'
      const next = shiftStudyWeek(week, 1)
      // The same instant the first plan is fitted from (see REVIEW_BUFFER_MINUTES); the date stays the student's actual one.
      const from = new Date(now.getTime() + REVIEW_BUFFER_MINUTES * 60_000)
      const lastDay = profile?.registered && profile.exam_date ? addDays(String(profile.exam_date), -1) : null
      const capacity: Record<string, number> = {}
      const dates = [...week.days, ...next.days].filter(d => d >= today0 && (!lastDay || d <= lastDay))
      const { ranges } = await freeRangesForDates(userId, dates, timezone, from)
      for (const d of dates) {
        // Only stretches a sitting fits in count: ten free minutes tonight do not make tonight a study day.
        capacity[d] = (ranges[d] ?? []).map(r => minutesBetween(r.start, r.end)).filter(m => m >= USABLE_GAP_MINUTES).reduce((a, b) => a + b, 0)
      }
      initialCycle = decideInitialCycle({ current: week, today: today0, route, capacity })
      week = initialCycle.week
    }
  }
  const anchorDay = week.anchorDay

  // reminder_at is a time-of-day the student already chose for their weekly
  // check-in; the diagnostic sits with it rather than at an invented hour.
  const reminder = typeof profile?.reminder_at === 'string' ? profile.reminder_at.slice(0, 5) : null

  return {
    week,
    anchorDay,
    classLed: week.classLed,
    timezone: week.timezone,
    today: todayInZone(week.timezone, typeof reference === 'string' ? new Date() : reference),
    diagnosticTime: reminder || '18:00',
    initialCycle,
  }
}

function weekFromCycle(cycle: { starts_at_local: string; ends_at_local: string; timezone: string | null }, resolved: StudyWeek, configuredClasses = false): StudyWeek {
  const startDate = cycle.starts_at_local, endDate = cycle.ends_at_local
  const n = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1
  return { startDate, endDate, days: Array.from({ length: n }, (_, i) => addDays(startDate, i)), timezone: cycle.timezone || resolved.timezone,
    anchorDay: weekdayOf(endDate), classLed: configuredClasses || resolved.classLed || weekdayOf(endDate) !== 0 }
}

export const WEEKLY_DIAGNOSTIC_MINUTES = 90

/** The next study week, for previewing where rolled-over work lands. */
export function nextWeekOf(ctx: StudyWeekContext): StudyWeek {
  return shiftStudyWeek(ctx.week, 1)
}

/**
 * The cycle that holds `date`, by the same boundary rules everything else uses. An existing cycle's own dates win (a record that
 * belongs to an accepted cycle resolves to it, whatever the class pattern says now); then today's resolved week, which carries a
 * variable-pattern student's confirmed next-class anchor; only for dates beyond both does the recurring-class pattern (or the
 * Monday–Sunday default) extend forward. The anchor is deliberately not applied to a far date: it describes one week only.
 */
export const weekForDate = perRequest((userId: string, date: string) => readWeekForDate(userId, date), (userId: string, date: string) => `${userId}|${date}`)
async function readWeekForDate(userId: string, date: string): Promise<StudyWeek> {
  const admin = createAdminClient()
  const { data: cycle } = await admin.from('planning_cycles').select('starts_at_local, ends_at_local, timezone')
    .eq('user_id', userId).lte('starts_at_local', date).gte('ends_at_local', date).order('starts_at_local', { ascending: false }).limit(1).maybeSingle()
  const ctx = await getStudyWeekContext(userId)
  if (cycle?.starts_at_local && cycle.ends_at_local) {
    return weekFromCycle(cycle, ctx.week)
  }
  if (date >= ctx.week.startDate && date <= ctx.week.endDate) return ctx.week
  const series = await classSeries(userId)
  const classWeekdays = effectiveWeekdays(series, date)
  // A variable-class cycle ends on its one confirmed class, which no weekday rule can reproduce: the periods either side
  // are the adjacent seven days, so the displayed range never overlaps or skips the current one.
  if (classWeekdays.length === 0 && ctx.classLed) {
    return adjacentWeek(ctx.week, date)
  }
  if (date > ctx.week.endDate) {
    const { data: last } = await admin.from('planning_cycles').select('ends_at_local').eq('user_id', userId).order('ends_at_local', { ascending: false }).limit(1).maybeSingle()
    const known = last?.ends_at_local && (last.ends_at_local as string) > ctx.week.endDate ? last.ends_at_local as string : ctx.week.endDate
    if (date > known) return prospectiveWeek(series, date, known, ctx.timezone)
  }
  return resolvePulseWeek({ classWeekdays, timezone: ctx.timezone, reference: date })
}

/** Shared within one request (see perRequest): Home, the operating state and the bridge all ask for this. */
export const getStudyWeekContext = perRequest(getStudyWeekContextUncached, (u: string, r?: Date | string) => `${u}|${minuteOf(r)}`)
