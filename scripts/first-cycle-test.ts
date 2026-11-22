/** Pure tests: which cycle a student with no cycle yet starts in. Fixed instants, no database, no clock. */
import { resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'
import { decideInitialCycle, initialCycleNote } from '../src/lib/planning/pulse/firstCycle'
import { remainingWindow, minutesBetween } from '../src/lib/planning/pulse/capacity'
import { adjacentWeek, shiftStudyWeek, todayInZone, weekdayOf, type Weekday } from '../src/lib/planning/studyWeek'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

type Windows = Partial<Record<Weekday, [string, string]>>
const EVENINGS: Windows = { 1: ['18:00', '21:00'], 2: ['18:00', '21:00'], 3: ['18:00', '21:00'], 4: ['18:00', '21:00'], 5: ['18:00', '21:00'], 6: ['10:00', '13:00'] }

/** Same arithmetic dailyCapacityMinutes applies: the student's window, minus the part of today that has passed. */
function decide(now: string, tz: string, route: 'self_study' | 'coaching' | 'hybrid', classWeekdays: Weekday[], windows: Windows, nextClassDate: string | null = null) {
  const at = new Date(now)
  const current = resolvePulseWeek({ classWeekdays, nextClassDate, timezone: tz, reference: at })
  const today = todayInZone(tz, at)
  const next = shiftStudyWeek(current, 1)
  const capacity: Record<string, number> = {}
  for (const d of [...current.days, ...next.days]) {
    const w = windows[weekdayOf(d)]
    const left = w ? remainingWindow({ start: w[0], end: w[1] }, d, tz, at) : null
    capacity[d] = left ? minutesBetween(left.start, left.end) : 0
  }
  return { today, ...decideInitialCycle({ current, today, route, capacity }) }
}

console.log('\nSunday evening, self-study, Asia/Kolkata')
{
  const r = decide('2026-11-01T15:00:00Z', 'Asia/Kolkata', 'self_study', [], EVENINGS) // Sun 1 Nov 20:30 IST
  check('it is Sunday evening locally', r.today === '2026-11-01' && weekdayOf(r.today) === 0)
  check('the first plan is the upcoming Monday–Sunday cycle', r.advanced && r.week.startDate === '2026-11-02' && r.week.endDate === '2026-11-08')
  check('the reason is that the cycle has no study day left', r.reason === 'no_study_day_left')
  check('the review can say so, with the dates', /no study days left/.test(initialCycleNote(r) ?? '') && /2.*8 Nov 2026/.test(initialCycleNote(r) ?? ''))
}

console.log('\nThe same instant in different timezones')
{
  const instant = '2026-11-01T20:00:00Z'
  const kolkata = decide(instant, 'Asia/Kolkata', 'self_study', [], EVENINGS) // Mon 2 Nov 01:30
  const auckland = decide(instant, 'Pacific/Auckland', 'self_study', [], EVENINGS) // Mon 2 Nov 09:00
  const london = decide(instant, 'Europe/London', 'self_study', [], EVENINGS) // Sun 1 Nov 20:00
  const la = decide(instant, 'America/Los_Angeles', 'self_study', [], EVENINGS) // Sun 1 Nov 12:00
  check('their local dates differ', kolkata.today === '2026-11-02' && auckland.today === '2026-11-02' && london.today === '2026-11-01' && la.today === '2026-11-01')
  check('every one of them starts on Monday 2 November', [kolkata, auckland, london, la].every(r => r.week.startDate === '2026-11-02'))
  check('the ones already in Monday are not moved; the ones still in Sunday are', !kolkata.advanced && !auckland.advanced && london.advanced && la.advanced)
  check('Kolkata at 01:30 Monday still has the whole day ahead of it', kolkata.reason === 'current_has_time')
}

console.log('\nMidweek entry with remaining capacity')
{
  const r = decide('2026-11-04T10:00:00Z', 'Europe/London', 'self_study', [], EVENINGS) // Wed 10:00
  check('the current cycle is used, unmoved', !r.advanced && r.week.startDate === '2026-11-02' && r.reason === 'current_has_time')
  const late = decide('2026-11-04T23:30:00Z', 'Europe/London', 'self_study', [], EVENINGS) // Wed 23:30, evening window gone
  check('today’s window has passed but Thursday–Saturday have room, so it stays', !late.advanced && late.week.startDate === '2026-11-02')
  check('no note is needed when nothing moved', initialCycleNote(r) === null)
}

console.log('\nMonday entry')
{
  const early = decide('2026-11-02T06:30:00Z', 'Europe/London', 'self_study', [], EVENINGS) // Mon 2 Nov 06:30, the whole week ahead
  check('Monday morning starts the current Monday–Sunday cycle, unmoved', !early.advanced && early.week.startDate === '2026-11-02' && early.week.endDate === '2026-11-08' && early.reason === 'current_has_time')
  const late = decide('2026-11-02T22:30:00Z', 'Europe/London', 'self_study', [], EVENINGS) // Mon 22:30, evening window gone, Tue–Sat remain
  check('Monday night, today’s window gone but the week has room: still this cycle', !late.advanced && late.week.startDate === '2026-11-02')
}

console.log('\nTuesday with an upcoming variable class')
{
  const tue = '2026-11-03T10:00:00Z'
  const anchored = decide(tue, 'Europe/London', 'coaching', [], EVENINGS, '2026-11-07') // class Sat 7 Nov: the week ends the day before
  check('a class four days out ends the week the day before it', anchored.week.endDate === '2026-11-06' && anchored.week.startDate === '2026-10-31' && anchored.week.classLed)
  check('and the student keeps that week: it still has study days with time', !anchored.advanced && anchored.reason === 'current_has_time')
  const tomorrow = decide(tue, 'Europe/London', 'coaching', [], EVENINGS, '2026-11-04') // class tomorrow: too close to anchor a week
  check('a class tomorrow does not anchor: the default Monday–Sunday week', tomorrow.week.startDate === '2026-11-02' && tomorrow.week.endDate === '2026-11-08' && !tomorrow.week.classLed)
  const far = decide(tue, 'Europe/London', 'coaching', [], EVENINGS, '2026-12-01')
  check('a class a month out does not anchor either', far.week.endDate === '2026-11-08' && !far.week.classLed)
}

console.log('\nSaturday night, no time left in a cycle that still has a study day')
{
  const r = decide('2026-11-07T22:30:00Z', 'Europe/London', 'self_study', [], EVENINGS)
  check('it advances once, with the "no time left" reason', r.advanced && r.reason === 'no_time_left' && r.week.startDate === '2026-11-09')
}

console.log('\nNo usable windows')
{
  const sunday = decide('2026-11-01T15:00:00Z', 'Asia/Kolkata', 'self_study', [], {})
  check('Sunday with no availability: next cycle, work shown unplaced, an availability note', sunday.advanced && sunday.reason === 'no_availability' && /add availability/i.test(initialCycleNote(sunday) ?? ''))
  check('it advanced one cycle and no further', sunday.week.startDate === '2026-11-02')
  const wed = decide('2026-11-04T10:00:00Z', 'Europe/London', 'self_study', [], {})
  check('Wednesday with no availability: stays put, never hunts for capacity', !wed.advanced && wed.week.startDate === '2026-11-02' && wed.reason === 'no_availability')
  check('and it still points at availability', /availability/i.test(initialCycleNote(wed) ?? ''))
}

console.log('\nClass-led entry near its boundary (Tue/Thu classes: cycle Tue–Mon)')
{
  const win: Windows = { 1: ['18:00', '21:00'], 2: ['18:00', '21:00'], 3: ['18:00', '21:00'], 5: ['18:00', '21:00'] }
  const monLate = decide('2026-11-02T22:00:00Z', 'Europe/London', 'coaching', [2, 4], win) // Mon 22:00, last day of the cycle
  check('on the last day with its window gone, the next cycle starts', monLate.advanced && monLate.week.startDate === '2026-11-03' && monLate.week.endDate === '2026-11-09' && monLate.reason === 'no_time_left')
  check('the boundary is still the class-led one', monLate.week.classLed && monLate.week.anchorDay === 1)
  const monEarly = decide('2026-11-02T09:00:00Z', 'Europe/London', 'coaching', [2, 4], win) // Mon morning, evening window ahead
  check('on the same day with time still to come, it stays', !monEarly.advanced && monEarly.week.startDate === '2026-10-27')
  const hybrid = decide('2026-11-02T22:00:00Z', 'Europe/London', 'hybrid', [2, 4], win)
  check('hybrid follows the same rule', hybrid.advanced && hybrid.week.startDate === '2026-11-03')
  check('a class-led pulse day is a study day (unlike self-study Sunday)', decide('2026-11-02T09:00:00Z', 'Europe/London', 'coaching', [2, 4], win).reason === 'current_has_time')
}

console.log('\nVariable classes: the class anchor is one assertion, first-cycle advancement another')
{
  // Anchor only (pure resolver, fixed reference date): the cycle ends the day before the next confirmed class.
  const wed = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-11-11', timezone: 'Europe/London', reference: '2026-11-04' })
  check('anchor: a class 7 days out ends the cycle the day before it, class-led', wed.endDate === '2026-11-10' && wed.startDate === '2026-11-04' && wed.classLed)
  const tooFar = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-12-20', timezone: 'Europe/London', reference: '2026-11-04' })
  check('anchor: a class beyond two weeks is not an anchor (provisional Monday–Sunday)', !tooFar.classLed && tooFar.anchorDay === 0)
  const tomorrow = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-11-05', timezone: 'Europe/London', reference: '2026-11-04' })
  check('anchor: a class tomorrow leaves no seven-day cycle to build around it', !tomorrow.classLed)
  // Advancement only (fixed capacity): a Sunday-evening entry with an anchored cycle that has ended its study time.
  const sunAnchored = decide('2026-11-08T21:30:00Z', 'Europe/London', 'coaching', [], EVENINGS, '2026-11-15') // Sun 21:30, class next Sun -> cycle ends Sat 14
  check('advancement: Sunday entry with an anchored cycle still ahead does not advance', !sunAnchored.advanced && sunAnchored.week.endDate === '2026-11-14', JSON.stringify(sunAnchored.week))
  const noClass = decide('2026-11-08T21:30:00Z', 'Europe/London', 'self_study', [], EVENINGS)
  check('advancement: Sunday evening self-study enters the following Monday–Sunday cycle', noClass.advanced && noClass.week.startDate === '2026-11-09')
}

console.log('\nAdjacent periods for navigation (variable-class cycles do not follow a weekday rule)')
{
  const base = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-11-11', timezone: 'Europe/London', reference: '2026-11-04' }) // 4 Nov → 10 Nov
  const next = adjacentWeek(base, '2026-11-11')
  check('next period starts the day after the current one ends and is seven days', next.startDate === '2026-11-11' && next.endDate === '2026-11-17' && next.days.length === 7)
  const prev = adjacentWeek(base, '2026-10-28')
  check('previous period ends the day before the current one starts', prev.endDate === '2026-11-03' && prev.startDate === '2026-10-28')
  check('two ahead is contiguous with the first', adjacentWeek(base, '2026-11-18').startDate === '2026-11-18')
  check('a date inside the period returns it unchanged', adjacentWeek(base, '2026-11-06').startDate === base.startDate)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
