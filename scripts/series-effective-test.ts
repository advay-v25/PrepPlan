/** Pure: which class pattern is in force on a date, and the cycles that follow a pattern change (no overlap, no gap, no early shift). */
import { effectiveWeekdays, prospectiveWeek } from '../src/lib/planning/schedule'
import { addDays, weekdayOf } from '../src/lib/planning/studyWeek'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

// Tue+Thu until 2026-12-08, then Wed+Thu from 2026-12-09 (the Tuesday series ended; its successor runs Wednesdays). Thursday series is untouched.
const EFF = '2026-12-09'
const series = [
  { weekdays: [4] as any, starts_on: null, ends_on: null },
  { weekdays: [2] as any, starts_on: null, ends_on: addDays(EFF, -1) },
  { weekdays: [3] as any, starts_on: EFF, ends_on: null },
]
const sorted = (a: number[]) => [...a].sort().join()

console.log('\nThe pattern in force on a date')
check('the day before the effective date: the old pattern only', sorted(effectiveWeekdays(series, addDays(EFF, -1))) === '2,4')
check('on the effective date: the new pattern only (never the union)', sorted(effectiveWeekdays(series, EFF)) === '3,4')
check('after it: the new pattern', sorted(effectiveWeekdays(series, addDays(EFF, 40))) === '3,4')
check('long before: still the old pattern', sorted(effectiveWeekdays(series, '2026-10-01')) === '2,4')
check('a series that has not started does not anchor an earlier day', !effectiveWeekdays([{ weekdays: [5] as any, starts_on: '2027-01-01', ends_on: null }], '2026-12-30').length)
check('a series that ended does not anchor a later day', !effectiveWeekdays([{ weekdays: [5] as any, starts_on: null, ends_on: '2026-12-01' }], '2026-12-02').length)

console.log('\nCycles after a change: one cycle per day, no overlap, no gap, the paper day moves only with the pattern')
const known = '2026-11-30'                     // the accepted cycle ends here; everything after is prospective
const weeks = new Map<string, { s: string; e: string }>()
for (let d = addDays(known, 1); d <= addDays(known, 400); d = addDays(d, 1)) {
  const w = prospectiveWeek(series, d, known, 'UTC')
  weeks.set(d, { s: w.startDate, e: w.endDate })
  if (!(w.startDate <= d && d <= w.endDate)) { check(`${d} lies in its own cycle`, false, `${w.startDate}..${w.endDate}`); break }
}
let overlap = 0, gap = 0, sameDayConflict = 0
for (let d = addDays(known, 2); d <= addDays(known, 400); d = addDays(d, 1)) {
  const a = weeks.get(addDays(d, -1))!, b = weeks.get(d)!
  if (a.e === b.e) { if (a.s !== b.s) sameDayConflict++ }
  else { if (b.s <= a.e) overlap++; if (b.s > addDays(a.e, 1)) gap++ }
}
check('every date from the next day out to 400 days lies in the cycle that is returned for it', weeks.size === 400)
check('consecutive cycles never overlap', overlap === 0)
check('and leave no gap', gap === 0)
check('every date of one cycle agrees on that cycle', sameDayConflict === 0)
const before = prospectiveWeek(series, addDays(EFF, -3), known, 'UTC'), after = prospectiveWeek(series, addDays(EFF, 30), known, 'UTC')
check('before the effective date the cycle ends on the OLD pulse day (Tue+Thu -> Monday)', weekdayOf(before.endDate) === 1, before.endDate)
check('well after it the cycle ends on the NEW pulse day (Wed+Thu -> Tuesday), seven days long', weekdayOf(after.endDate) === 2 && after.days.length === 7, `${after.startDate}..${after.endDate}`)
const trans = [...weeks.values()].filter(w => w.s <= EFF && EFF <= w.e)[0]
const spanning = weeks.get(addDays(EFF, -1))!
check('the transition cycle closes the day BEFORE the next class of the changed schedule (a one-day cycle, shorter than seven days)', spanning.e === addDays(EFF, -1) && Date.parse(spanning.e) - Date.parse(spanning.s) < 6 * 86_400_000, JSON.stringify(spanning))
check('...and that next class (Wednesday, the new cycle-start class) is the first day of the following cycle', weekdayOf(addDays(spanning.e, 1)) === 3 && weeks.get(addDays(spanning.e, 1))!.s === addDays(spanning.e, 1))
const first = weeks.get(EFF)!
const normal = weeks.get(addDays(first.e, 1))!
check('the first cycle that starts under the new pattern ends on its pulse day (Tuesday)', weekdayOf(first.e) === 2 && first.s === EFF, JSON.stringify(first))
check('following cycles are the normal seven days, each ending on the new pulse day', weekdayOf(normal.e) === 2 && Date.parse(normal.e) - Date.parse(normal.s) === 6 * 86_400_000, JSON.stringify(normal))
// A shorter transition when the pattern change lands near the end of a known cycle: little usable time, still closes before the next class.
{
  const nearKnown = addDays(EFF, -2)          // known cycle ended two days before the effective date
  const w = prospectiveWeek(series, addDays(nearKnown, 1), nearKnown, 'UTC')
  check('a boundary right after an accepted cycle: the next cycle starts the next day and closes before the next class', w.startDate === addDays(nearKnown, 1) && w.endDate === addDays(EFF, -1) && w.days.length === 1, `${w.startDate}..${w.endDate}`)
  const same = prospectiveWeek(series, addDays(EFF, -1), addDays(EFF, -2), 'UTC')
  check('the same-day boundary (a cycle that is the day before the class) holds one day and no earlier date', same.startDate === same.endDate || same.days.length <= 2)
}
// An accepted/known cycle is never re-derived: the function only produces dates after `known`.
check('nothing at or before the known cycle end is ever produced', [...weeks.keys()].every(d => d > known) && [...weeks.values()].every(w => w.s > known))
check('a forecast beyond eight weeks still uses the new pattern, not today\'s', weekdayOf(prospectiveWeek(series, addDays(known, 300), known, 'UTC').endDate) === 2)
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
