import { Weekday, StudyWeek, addDays, daysBetween, todayInZone, weekdayOf } from '../studyWeek'

/**
 * Pulse day — the last day of the study week, and where the cumulative
 * review sits. Never chosen: derived from class schedule.
 *
 * Class-going student: the cycle starts on the class day that follows the
 * LONGEST gap between classes and ends the day before that class recurs, so
 * the pulse day is the day right before the cycle's first class. Tue/Thu ->
 * gap Thu->Tue is longest, cycle Tue-Mon, pulse day Mon. Sat/Sun -> gap
 * Sun->Sat is longest, cycle Sat-Fri, pulse day Fri. (Comparing raw weekday
 * numbers would read Sun(0) as the earliest class and get Sat/Sun wrong.)
 * Ties go to the class earliest in a Monday-first week.
 *
 * No classes: the self-study cycle runs Monday-Saturday and the closing
 * paper sits on Sunday. Sunday belongs to the cycle as its verification and
 * closure day, but it is not another new-content study day.
 */
export function resolvePulseDay(classWeekdays: Weekday[]): Weekday {
  if (classWeekdays.length === 0) return 0
  const start = cycleStartClassDay(classWeekdays)
  return ((start - 1 + 7) % 7) as Weekday
}

/** The class day that follows the longest gap between classes (Monday-first tie-break). */
export function cycleStartClassDay(classWeekdays: Weekday[]): Weekday {
  const days = [...new Set(classWeekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Mon..Sun order
  let best = days[0], bestGap = -1
  for (let i = 0; i < days.length; i++) {
    const prev = days[(i - 1 + days.length) % days.length]
    const gap = days.length === 1 ? 7 : ((days[i] - prev + 7) % 7) || 7
    if (gap > bestGap) { best = days[i]; bestGap = gap }
  }
  return best
}

/**
 * A variable-pattern student has no recurring weekday to derive a boundary from — only whichever next class
 * date they last confirmed (see "Add next class", calendar_commitments.defines_cycle). That single date
 * anchors this one week only, the same way a recurring class anchors every week: the cycle ends the day
 * before it. It is not treated as the start of a new recurring pattern.
 *
 * The anchor is only used when the class is roughly within the next two weeks — close enough that it
 * actually matters where the paper falls. A class known two months out would otherwise leave a gap of
 * undefined weeks between now and then; the default Monday-Sunday cadence fills that time instead, and the
 * real class is picked up once it is close enough. A class tomorrow or today is also left to the default
 * week: there is no seven-day cycle left to build around it.
 */
function variableClassAnchor(nextClassDate: string | null | undefined, today: string): string | null {
  if (!nextClassDate) return null
  const until = daysBetween(today, nextClassDate)
  if (until < 2 || until > 13) return null
  return addDays(nextClassDate, -1)
}

/** Same shape as resolveStudyWeek, but the anchor is derived, not passed in. */
export function resolvePulseWeek(options: {
  classWeekdays: Weekday[]
  /** A variable-pattern student's next confirmed class date (YYYY-MM-DD), if any. Ignored once a recurring pattern exists. */
  nextClassDate?: string | null
  timezone: string
  reference?: Date | string
}): StudyWeek {
  const today = typeof options.reference === 'string'
    ? options.reference
    : todayInZone(options.timezone, options.reference ?? new Date())

  const cycleLength = 7
  const hasRecurringPattern = options.classWeekdays.length > 0
  const anchor = hasRecurringPattern ? null : variableClassAnchor(options.nextClassDate, today)

  const endDate = anchor ?? addDays(today, (resolvePulseDay(options.classWeekdays) - weekdayOf(today) + 7) % 7)
  const startDate = addDays(endDate, -(cycleLength - 1))

  return {
    startDate,
    endDate,
    days: Array.from({ length: cycleLength }, (_, i) => addDays(startDate, i)),
    timezone: options.timezone,
    anchorDay: weekdayOf(endDate),
    classLed: hasRecurringPattern || anchor !== null,
  }
}

/** Only self-study has a fixed Sunday paper boundary. */
export function permitsStudyPortions(route: 'self_study' | 'coaching' | 'hybrid', weekday: Weekday): boolean {
  return route !== 'self_study' || weekday !== 0
}
