/** Pure tests: the mock checkpoint model — timing, missing details, preparation/check-in placement, conflicts. Fixed dates, no database. */
import { ANALYSIS_MINUTES, PREP_MINUTES, checkpointTitle, describeTiming, freeRanges, missingDetails, projectCheckpoint, reservedInterval, weekStartContaining, type Checkpoint } from '../src/lib/curriculum/mockCheckpoint'
import { parseCheckpointInput, parseMeta, CheckpointError } from '../src/lib/planning/checkpointService'
import type { Occupant } from '../src/lib/planning/mutations'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const dateOnly: Checkpoint = { date: '2026-11-14', kind: 'provider_mock', label: null, startTime: null, durationMinutes: null }
const timed: Checkpoint = { ...dateOnly, label: 'Coaching mock', startTime: '10:00', durationMinutes: 180 }
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`)
const evenings = Object.fromEntries(days(1, 20).map(d => [d, [{ start: 18 * 60, end: 21 * 60 }]]))
const input = (cp: Checkpoint, o: Partial<Parameters<typeof projectCheckpoint>[0]> = {}) => projectCheckpoint({ checkpoint: cp, today: '2026-11-03', windowsByDate: evenings, occupants: [], ...o })

console.log('\nDate only versus timed')
{
  check('a date alone is a complete checkpoint with plain title and timing', checkpointTitle(dateOnly) === 'Mock from a course provider' && describeTiming(dateOnly) === 'Date only — no time set')
  check('the student’s own words become its title', checkpointTitle(timed) === 'Coaching mock')
  check('a date-only checkpoint says what is missing and reserves nothing', missingDetails(dateOnly).join() === 'start time,expected length' && reservedInterval(dateOnly) === null)
  check('a start time without a length reserves nothing and names the gap', reservedInterval({ ...dateOnly, startTime: '10:00' }) === null && missingDetails({ ...dateOnly, startTime: '10:00' }).join() === 'expected length')
  check('start and length reserve exactly that interval', JSON.stringify(reservedInterval(timed)) === JSON.stringify({ date: '2026-11-14', start: 600, durationMinutes: 180 }))
  check('timing is shown as a range', describeTiming(timed) === '10:00–13:00')
  check('a fully described checkpoint has nothing missing', missingDetails(timed).length === 0)
}

console.log('\nPreparation and check-in are proposals, placed around what exists')
{
  const r = input(dateOnly)
  const prep = r.suggestions.filter(s => s.kind === 'prepare')
  check('two preparation sessions and one check-in', prep.length === 2 && r.suggestions.length === 3)
  check('each is a real window of the right length, on a different day, before the mock', prep.every(s => s.date !== null && s.date < dateOnly.date && s.minutes === PREP_MINUTES) && new Set(prep.map(s => s.date)).size === 2)
  const analysis = r.suggestions.find(s => s.kind === 'analyse')!
  check('the check-in comes after a date-only mock (the day after, since no end time is known)', analysis.date === '2026-11-15' && analysis.minutes === ANALYSIS_MINUTES)
  check('a date-only mock produces no conflict', r.conflicts.length === 0)
  const timedR = input(timed)
  check('after a timed mock the check-in can be the same evening', timedR.suggestions.find(s => s.kind === 'analyse')!.date === '2026-11-14')
}

console.log('\nCommitments, conflicts and unplaced work')
{
  const clash: Occupant = { id: 'c1', title: 'Work shift', date: '2026-11-14', start: 12 * 60, durationMinutes: 120, isProtected: true, kind: 'commitment' }
  const r = input(timed, { occupants: [clash] })
  check('a commitment overlapping a timed mock is reported with the minutes', r.conflicts.length === 1 && r.conflicts[0].title === 'Work shift' && r.conflicts[0].overlapMinutes === 60)
  const busy: Occupant = { id: 'c2', title: 'Class', date: '2026-11-12', start: 17 * 60, durationMinutes: 240, isProtected: true, kind: 'class' }
  const prep = input(dateOnly, { occupants: [busy] }).suggestions.filter(s => s.kind === 'prepare')
  check('a protected commitment’s time is never used for preparation', prep.every(s => s.date !== '2026-11-12'))
  const none = input(dateOnly, { windowsByDate: {} })
  check('no study windows: everything is listed unplaced, with the reason and a way forward', none.suggestions.every(s => s.date === null && s.unplacedReason && /availability/i.test(s.unplacedReason)))
  const tooClose = input({ ...dateOnly, date: '2026-11-04' })
  check('a mock a day away cannot be prepared for, and says so', tooClose.suggestions.filter(s => s.kind === 'prepare').some(s => s.date === null && /too close/.test(s.unplacedReason ?? '')))
  const past = input(dateOnly, { today: '2026-11-13' })
  check('nothing is placed in the past', past.suggestions.every(s => s.date === null || s.date >= '2026-11-13'))
  const deterministic = JSON.stringify(input(timed)) === JSON.stringify(input(timed))
  check('the same inputs always give the same proposals', deterministic)
  const moved = input({ ...dateOnly, date: '2026-11-18' })
  check('moving the mock moves every proposal with it', moved.suggestions.every(s => s.date === null || s.date >= '2026-11-13' && s.date <= '2026-11-21'))
}

console.log('\nFree time arithmetic')
{
  const f = freeRanges([{ start: 540, end: 720 }], [{ date: 'd', start: 600, durationMinutes: 30 }])
  check('an occupant splits a window and the rest stays free', JSON.stringify(f) === JSON.stringify([{ start: 540, end: 600 }, { start: 630, end: 720 }]))
  check('touching intervals do not conflict', freeRanges([{ start: 540, end: 600 }], [{ date: 'd', start: 600, durationMinutes: 30 }]).length === 1)
  check('weeks are found from any week’s first day', weekStartContaining('2026-11-14', '2026-11-02') === '2026-11-09' && weekStartContaining('2026-11-14', '2026-11-23') === '2026-11-09')
}

console.log('\nWhat the server accepts')
{
  const bad = (b: unknown) => { try { parseCheckpointInput(b); return null } catch (e) { return e instanceof CheckpointError ? e.code : 'other' } }
  check('a date-only checkpoint is accepted', parseCheckpointInput({ date: '2026-11-14', kind: 'other' }).startTime === null)
  check('a timed one is accepted and normalised', parseCheckpointInput({ date: '2026-11-14', kind: 'provider_mock', label: '  Coaching mock ', startTime: '09:30', durationMinutes: 120 }).label === 'Coaching mock')
  check('not a real date, unknown type, bad time, bad length and a mock running past midnight are refused',
    bad({ date: '2026-13-45', kind: 'other' }) === 'INVALID_DATE' && bad({ date: '2026-11-14', kind: 'exam' }) === 'INVALID_KIND'
    && bad({ date: '2026-11-14', kind: 'other', startTime: '25:00' }) === 'INVALID_TIME' && bad({ date: '2026-11-14', kind: 'other', durationMinutes: 5 }) === 'INVALID_DURATION'
    && bad({ date: '2026-11-14', kind: 'other', startTime: '22:00', durationMinutes: 240 }) === 'INVALID_DURATION')
  check('an over-long description and a non-object body are refused', bad({ date: '2026-11-14', kind: 'other', label: 'x'.repeat(81) }) === 'INVALID_LABEL' && bad(null) === 'INVALID')
}

console.log('\nSuggestion scheduling follows the main planner (Phase C1)')
{
  // Sunday 15 Nov 2026 mock; Fri 13, Sat 14 ...  Self-study keeps Sunday for the paper.
  const sundayMock: Checkpoint = { ...timed, date: '2026-11-15' }
  const open = { start: '2026-11-02', end: '2026-11-08' }
  const self = projectCheckpoint({ checkpoint: sundayMock, today: '2026-11-03', windowsByDate: Object.fromEntries(days(1, 20).map(d => [d, [{ start: 18 * 60, end: 21 * 60 }]])), occupants: [], route: 'self_study', openCycle: open })
  const wd = (d: string | null) => d ? new Date(`${d}T00:00:00Z`).getUTCDay() : -1
  check('an external mock itself may fall on a Sunday, and no self-study suggestion lands on one', self.suggestions.every(s => wd(s.date) !== 0))
  check('the check-in after a timed Sunday mock moves to Monday, not the Sunday evening', self.suggestions.find(s => s.id === 'analyse')!.date === '2026-11-16')
  const classLed = projectCheckpoint({ checkpoint: sundayMock, today: '2026-11-03', windowsByDate: Object.fromEntries(days(1, 20).map(d => [d, [{ start: 18 * 60, end: 21 * 60 }]])), occupants: [], route: 'coaching', openCycle: open })
  check('a class-led student keeps every day open: the same Sunday mock gets its check-in that evening', classLed.suggestions.find(s => s.id === 'analyse')!.date === '2026-11-15')

  const short = projectCheckpoint({ checkpoint: dateOnly, today: '2026-11-03', windowsByDate: evenings, occupants: [], maxSittingMinutes: 30 })
  check('a 30-minute sitting limit shortens every proposal to fit', short.suggestions.every(s => s.minutes === 30))
  const tiny = projectCheckpoint({ checkpoint: dateOnly, today: '2026-11-03', windowsByDate: evenings, occupants: [], maxSittingMinutes: 20 })
  check('and a very short limit is respected down to a 20-minute sitting', tiny.suggestions.every(s => s.minutes === 20))

  const nowEvening = projectCheckpoint({ checkpoint: { ...dateOnly, date: '2026-11-06' }, today: '2026-11-05', windowsByDate: evenings, occupants: [], now: { date: '2026-11-05', minutes: 19 * 60 + 40 } })
  const todayOnes = nowEvening.suggestions.filter(s => s.date === '2026-11-05')
  check('nothing is proposed at a clock time that has already passed today', todayOnes.every(s => s.startMinutes !== null && s.startMinutes >= 19 * 60 + 40))
  const lateNight = projectCheckpoint({ checkpoint: { ...dateOnly, date: '2026-11-06' }, today: '2026-11-05', windowsByDate: evenings, occupants: [], now: { date: '2026-11-05', minutes: 20 * 60 + 30 } })
  check('with only 30 minutes of the window left, a 45-minute proposal does not squeeze in today', lateNight.suggestions.every(s => s.date !== '2026-11-05'))

  const fullDay = projectCheckpoint({ checkpoint: { ...dateOnly, date: '2026-11-06' }, today: '2026-11-03', windowsByDate: evenings, occupants: [],
    plannedMinutesByDate: { '2026-11-04': 180, '2026-11-05': 180, '2026-11-02': 180, '2026-11-03': 180, '2026-11-01': 180 } })
  check('a clock gap is not free time when the day is already full of accepted untimed work', fullDay.suggestions.filter(s => s.kind === 'prepare').every(s => s.date === null))
  check('and the reason says the days are full, not that there is no window', /already full/.test(fullDay.suggestions[0].unplacedReason ?? ''))

  const inCycle = projectCheckpoint({ checkpoint: { ...dateOnly, date: '2026-11-06' }, today: '2026-11-03', windowsByDate: evenings, occupants: [], openCycle: open })
  check('inside the open cycle a placed suggestion is addable', inCycle.suggestions.filter(s => s.date && s.date <= open.end).every(s => s.addable))
  const later = projectCheckpoint({ checkpoint: { ...dateOnly, date: '2026-11-13' }, today: '2026-11-03', windowsByDate: evenings, occupants: [], openCycle: open })
  check('in a later cycle it stays a visible proposal, not addable, with the reason', later.suggestions.filter(s => s.date && s.date > open.end).every(s => !s.addable && /not open yet/.test(s.laterReason ?? '')))
  check('no suggestion is addable without an open cycle', projectCheckpoint({ checkpoint: dateOnly, today: '2026-11-03', windowsByDate: evenings, occupants: [] }).suggestions.every(s => !s.addable))
}

console.log('\nCommand requests')
{
  const bad = (b: unknown) => { try { parseMeta(b); return null } catch (e) { return e instanceof CheckpointError ? e.code : 'other' } }
  check('a write without a request key is refused', bad({}) === 'KEY_REQUIRED' && bad({ key: 'short' }) === 'KEY_REQUIRED')
  check('a malformed checkpoint id or version is refused', bad({ key: 'abcdefgh1', checkpointId: 'nope' }) === 'INVALID' && bad({ key: 'abcdefgh1', expectedVersion: -2 }) === 'INVALID')
  check('a well-formed request is accepted', parseMeta({ key: 'abcdefgh1', checkpointId: '123e4567-e89b-12d3-a456-426614174000', expectedVersion: 3 }).expectedVersion === 3)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
