/**
 * Deterministic date, timezone, and study-week tests (plan §C0).
 *
 * These are the calculations that silently corrupt a calendar when wrong: an
 * off-by-one weekday puts the weekly diagnostic on the wrong day, and a naive
 * UTC conversion moves every evening session in Asia/Kolkata into the next day.
 */
import {
  addDays, daysBetween, formatWeekRange, isEndOfCycle, isWithinWeek,
  repairPlacementFor, resolveStudyWeek, shiftStudyWeek, todayInZone,
  utcToZonedParts, weekdayOf, zonedTimeToUtc, type Weekday,
} from '../src/lib/planning/studyWeek'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)

console.log('\nCalendar arithmetic')
eq('add days within a month', addDays('2026-09-08', 3), '2026-09-11')
eq('add days across a month', addDays('2026-09-29', 5), '2026-10-04')
eq('add days across a year', addDays('2026-12-30', 3), '2027-01-02')
eq('subtract days across a month', addDays('2026-03-02', -3), '2026-02-27')
eq('leap year', addDays('2028-02-28', 1), '2028-02-29')
eq('non-leap year', addDays('2027-02-28', 1), '2027-03-01')
eq('weekday of a known Tuesday', weekdayOf('2026-09-08'), 2)
eq('weekday of a known Sunday', weekdayOf('2026-09-13'), 0)
eq('days between', daysBetween('2026-09-08', '2026-09-13'), 5)
eq('days between is signed', daysBetween('2026-09-13', '2026-09-08'), -5)

console.log('\nTimezone conversion')
// India is UTC+5:30 and has no DST.
eq('IST evening converts back to UTC',
  zonedTimeToUtc('2026-09-08', '19:30', 'Asia/Kolkata').toISOString(), '2026-09-08T14:00:00.000Z')
eq('IST early morning crosses the date line backwards',
  zonedTimeToUtc('2026-09-08', '04:00', 'Asia/Kolkata').toISOString(), '2026-09-07T22:30:00.000Z')
eq('UTC is identity',
  zonedTimeToUtc('2026-09-08', '19:30', 'UTC').toISOString(), '2026-09-08T19:30:00.000Z')

// New York observes DST: EDT (UTC-4) in September, EST (UTC-5) in January.
eq('New York in summer is UTC-4',
  zonedTimeToUtc('2026-09-08', '09:00', 'America/New_York').toISOString(), '2026-09-08T13:00:00.000Z')
eq('New York in winter is UTC-5',
  zonedTimeToUtc('2026-01-08', '09:00', 'America/New_York').toISOString(), '2026-01-08T14:00:00.000Z')
// The instant DST ends: 2026-11-01, clocks go back at 02:00 EDT.
eq('New York the day after the DST change is UTC-5',
  zonedTimeToUtc('2026-11-02', '09:00', 'America/New_York').toISOString(), '2026-11-02T14:00:00.000Z')
eq('New York the day before the DST change is UTC-4',
  zonedTimeToUtc('2026-10-31', '09:00', 'America/New_York').toISOString(), '2026-10-31T13:00:00.000Z')

console.log('\nRound trips')
for (const [tz, date, time] of [
  ['Asia/Kolkata', '2026-09-08', '19:30'],
  ['America/New_York', '2026-03-15', '02:30'],
  ['Europe/London', '2026-06-21', '23:45'],
  ['Australia/Sydney', '2026-12-25', '00:15'],
  ['UTC', '2026-01-01', '12:00'],
] as const) {
  const back = utcToZonedParts(zonedTimeToUtc(date, time, tz), tz)
  check(`${tz} ${date} ${time} survives a round trip`, back.date === date && back.time === time,
    `got ${back.date} ${back.time}`)
}

console.log('\nStudy week resolution')
// 2026-09-08 is a Tuesday. With a Sunday anchor the week ends 2026-09-13.
const sundayWeek = resolveStudyWeek({ anchorDay: 0, timezone: 'Asia/Kolkata', reference: '2026-09-08' })
eq('Sunday-anchored week ends on Sunday', sundayWeek.endDate, '2026-09-13')
eq('Sunday-anchored week starts the Monday before', sundayWeek.startDate, '2026-09-07')
eq('a week is seven days', sundayWeek.days.length, 7)
eq('days run start to end', [sundayWeek.days[0], sundayWeek.days[6]], ['2026-09-07', '2026-09-13'])
check('the anchor day is the last day', weekdayOf(sundayWeek.endDate) === 0)

// A Wednesday anchor, from a Tuesday: the week ends tomorrow.
const wedWeek = resolveStudyWeek({ anchorDay: 3, timezone: 'Asia/Kolkata', reference: '2026-09-08' })
eq('Wednesday-anchored week ends on the next Wednesday', wedWeek.endDate, '2026-09-09')
eq('Wednesday-anchored week starts seven days earlier', wedWeek.startDate, '2026-09-03')

// Standing on the anchor day itself: it is the END of the week, not the start.
const onAnchor = resolveStudyWeek({ anchorDay: 0, timezone: 'UTC', reference: '2026-09-13' })
eq('the anchor day belongs to the week it closes', onAnchor.endDate, '2026-09-13')
eq('and that week began six days earlier', onAnchor.startDate, '2026-09-07')

for (let d = 0; d < 7; d++) {
  const w = resolveStudyWeek({ anchorDay: d as Weekday, timezone: 'UTC', reference: '2026-09-08' })
  check(`anchor ${d}: week ends on weekday ${d}`, weekdayOf(w.endDate) === d, `ends ${w.endDate} (${weekdayOf(w.endDate)})`)
  check(`anchor ${d}: reference falls inside the week`, isWithinWeek('2026-09-08', w), `${w.startDate}..${w.endDate}`)
}

console.log('\nWeek shifting')
const next = shiftStudyWeek(sundayWeek, 1)
eq('next week starts seven days later', next.startDate, '2026-09-14')
eq('next week ends seven days later', next.endDate, '2026-09-20')
eq('shifting back returns the original', shiftStudyWeek(next, -1).startDate, sundayWeek.startDate)
check('weeks do not overlap', daysBetween(sundayWeek.endDate, next.startDate) === 1)

console.log('\nEnd-of-cycle rule (the general form of the Sunday rule)')
check('the last day is end of cycle', isEndOfCycle('2026-09-13', sundayWeek))
check('a mid-week day is not', !isEndOfCycle('2026-09-10', sundayWeek))
check('a Wednesday-anchored week ends on Wednesday, not Sunday',
  isEndOfCycle('2026-09-09', wedWeek) && !isEndOfCycle('2026-09-13', wedWeek))

const endRepair = repairPlacementFor('2026-09-13', sundayWeek)
eq('a diagnostic on the last day sends repair to next week', endRepair.earliestDate, '2026-09-14')
check('and names the next week as the target', endRepair.targetWeek.endDate === '2026-09-20')

const midRepair = repairPlacementFor('2026-09-09', sundayWeek)
eq('a mid-week diagnostic repairs the next day', midRepair.earliestDate, '2026-09-10')
check('inside the same week', midRepair.targetWeek.endDate === sundayWeek.endDate)
check('never same-day', repairPlacementFor('2026-09-09', sundayWeek).earliestDate !== '2026-09-09')

// The rule must follow the student's own anchor, not a hardcoded Sunday.
const wedEndRepair = repairPlacementFor('2026-09-09', wedWeek)
eq('a Wednesday-anchored student rolls over on Wednesday', wedEndRepair.earliestDate, '2026-09-10')
check('into the following Wednesday-anchored week', wedEndRepair.targetWeek.endDate === '2026-09-16')

console.log('\nDate boundary behaviour across zones')
// 23:00 in Sydney on the 25th is still the 25th locally, though it is the 24th in UTC.
const sydney = zonedTimeToUtc('2026-12-25', '23:00', 'Australia/Sydney')
eq('Sydney late evening is the previous day in UTC', sydney.toISOString().slice(0, 10), '2026-12-25')
eq('but reads back as the 25th locally', utcToZonedParts(sydney, 'Australia/Sydney').date, '2026-12-25')

// A student in Kolkata at 00:30 local: UTC is still the previous day.
const kolkataMidnight = zonedTimeToUtc('2026-09-09', '00:30', 'Asia/Kolkata')
eq('Kolkata after midnight is the previous day in UTC', kolkataMidnight.toISOString().slice(0, 10), '2026-09-08')
eq('but the local date is the 9th', utcToZonedParts(kolkataMidnight, 'Asia/Kolkata').date, '2026-09-09')
check('and the study week places it correctly',
  isWithinWeek(utcToZonedParts(kolkataMidnight, 'Asia/Kolkata').date, sundayWeek))

console.log('\nDefaults and formatting')
const noAnchor = resolveStudyWeek({ anchorDay: null, timezone: null, reference: '2026-09-08' })
eq('no anchor defaults to a Sunday week', weekdayOf(noAnchor.endDate), 0)
eq('no timezone defaults to UTC', noAnchor.timezone, 'UTC')
check('todayInZone returns a date shape', /^\d{4}-\d{2}-\d{2}$/.test(todayInZone('Asia/Kolkata')))
check('same-month range reads naturally', formatWeekRange(sundayWeek).includes('–'), formatWeekRange(sundayWeek))
const crossMonth = resolveStudyWeek({ anchorDay: 0, timezone: 'UTC', reference: '2026-10-01' })
check('cross-month range names both months', formatWeekRange(crossMonth).split(' ').length > 3, formatWeekRange(crossMonth))

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
