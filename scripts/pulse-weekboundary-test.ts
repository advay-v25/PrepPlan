/**
 * Pulse week boundaries — derived, never chosen (spec §1).
 */
import { resolvePulseDay, resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'
import { permitsStudyPortions } from '../src/lib/planning/pulse/generateWeek'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nPulse week boundaries\n')

eq('no classes: pulse day is Sunday (Mon-Sat study, Sunday paper)', resolvePulseDay([]), 0)
eq('classes Tue/Thu: pulse day is Monday', resolvePulseDay([2, 4]), 1)
eq('classes Mon/Wed/Fri: pulse day is Sunday', resolvePulseDay([1, 3, 5]), 0)
eq('Sat+Sun classes: cycle starts Saturday, pulse day is Friday', resolvePulseDay([6, 0]), 5)
eq('Tue+Thu classes: pulse day is Monday', resolvePulseDay([2, 4]), 1)
eq('Mon-Fri classes: pulse day is Sunday', resolvePulseDay([1, 2, 3, 4, 5]), 0)
eq('Mon+Thu classes (gaps 3/4): cycle starts Monday, pulse day Sunday', resolvePulseDay([1, 4]), 0)
eq('Wed only: pulse day is Tuesday', resolvePulseDay([3]), 2)
const satSun = resolvePulseWeek({ classWeekdays: [6, 0], timezone: 'UTC', reference: '2026-09-18' }) // a Friday
eq('Sat+Sun cycle containing a Friday runs Sat-Fri', [satSun.startDate, satSun.endDate], ['2026-09-12', '2026-09-18'])
eq('single Saturday class: pulse day is Friday', resolvePulseDay([6]), 5)
eq('single Sunday class: pulse day is Saturday', resolvePulseDay([0]), 6)

const noClassWeek = resolvePulseWeek({ classWeekdays: [], timezone: 'UTC', reference: '2026-09-18' }) // a Friday
eq('no-class cycle runs Monday-Sunday containing the reference date', [noClassWeek.startDate, noClassWeek.endDate], ['2026-09-14', '2026-09-20'])
eq('no-class cycle has six study days and a Sunday paper day', noClassWeek.days.length, 7)

const classWeek = resolvePulseWeek({ classWeekdays: [2, 4], timezone: 'UTC', reference: '2026-09-18' }) // a Friday
eq('class week (Tue/Thu) containing a Friday runs Tue-Mon', [classWeek.startDate, classWeek.endDate], ['2026-09-15', '2026-09-21'])
eq('class week has 7 days', classWeek.days.length, 7)
eq('class week pulse day matches endDate weekday', classWeek.anchorDay, 1)
check('a recurring pattern is class-led', classWeek.classLed)
check('no classes is not class-led', !noClassWeek.classLed)

// --- Variable pattern: a confirmed one-off class anchors just this week, never a recurring pattern.
console.log('\nVariable pattern — one-off "next class" anchor')
const variableNear = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-09-24', timezone: 'UTC', reference: '2026-09-18' }) // class next Thursday, 6 days out
eq('a class 6 days out anchors this week: ends the day before it', variableNear.endDate, '2026-09-23')
eq('the anchored week is still 7 days, starting the day after the previous one', variableNear.startDate, '2026-09-17')
check('an anchored one-off week is class-led', variableNear.classLed)

const variableFar = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-10-20', timezone: 'UTC', reference: '2026-09-18' }) // over a month out
eq('a class a month out does not anchor: falls back to the default Monday-Sunday week', [variableFar.startDate, variableFar.endDate], ['2026-09-14', '2026-09-20'])
check('the default fallback is not class-led', !variableFar.classLed)

const variableTomorrow = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-09-19', timezone: 'UTC', reference: '2026-09-18' }) // tomorrow — no 7-day cycle left to build
eq('a class tomorrow is too close to anchor a week around: falls back to default', [variableTomorrow.startDate, variableTomorrow.endDate], ['2026-09-14', '2026-09-20'])

const variableStale = resolvePulseWeek({ classWeekdays: [], nextClassDate: '2026-09-10', timezone: 'UTC', reference: '2026-09-18' }) // already in the past
eq('a class date already in the past is ignored: falls back to default', [variableStale.startDate, variableStale.endDate], ['2026-09-14', '2026-09-20'])
check('no known class at all is not class-led', !resolvePulseWeek({ classWeekdays: [], nextClassDate: null, timezone: 'UTC', reference: '2026-09-18' }).classLed)

const variableWithPattern = resolvePulseWeek({ classWeekdays: [2, 4], nextClassDate: '2026-09-24', timezone: 'UTC', reference: '2026-09-18' })
eq('a one-off date is ignored once a recurring pattern exists', [variableWithPattern.startDate, variableWithPattern.endDate], [classWeek.startDate, classWeek.endDate])

check('self-study permits Saturday study', permitsStudyPortions('self_study', 6))
check('self-study reserves Sunday for the paper/checkpoint', !permitsStudyPortions('self_study', 0))
check('class-led Sunday can hold class-related work', permitsStudyPortions('coaching', 0))
check('hybrid Sunday follows its class-defined boundary', permitsStudyPortions('hybrid', 0))

{
  const w = (nextClassDate: string | null, classWeekdays: number[] = []) => resolvePulseWeek({ classWeekdays: classWeekdays as any, nextClassDate, timezone: 'Europe/London', reference: '2026-11-16' })
  eq('variable pattern: a confirmed next class 5 days out anchors the cycle to end the day before it', [w('2026-11-21').startDate, w('2026-11-21').endDate], ['2026-11-14', '2026-11-20'])
  eq('variable pattern: a class tomorrow is left to the default week', w('2026-11-17').classLed, false)
  eq('variable pattern: a class two months away is ignored', w('2027-01-20').classLed, false)
  eq('a recurring pattern ignores any one-off confirmed class date (Tue/Thu stays Tue-Mon)', [w('2026-11-21', [2, 4]).startDate, w('2026-11-21', [2, 4]).endDate], ['2026-11-10', '2026-11-16'])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
