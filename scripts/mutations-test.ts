/**
 * Placement logic tests (C2).
 *
 * Conflict detection and slot suggestion are where a subtle error silently
 * double-books a student, and recurrence expansion is where "my class moved
 * this week" quietly corrupts every other week.
 */
import {
  expandCommitment, findConflicts, formatMinutes, overlaps, splitTask,
  suggestSlots, validateDuration, validateStart,
  type Occupant, type RecurringCommitment,
} from '../src/lib/planning/mutations'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const D = '2026-09-09'
const occ = (id: string, start: number, dur: number, isProtected = true, date = D): Occupant =>
  ({ id, title: id, date, start, durationMinutes: dur, isProtected, kind: 'class' })

console.log('\nOverlap')
check('identical blocks overlap', overlaps({ date: D, start: 600, durationMinutes: 60 }, { date: D, start: 600, durationMinutes: 60 }))
check('partial overlap counts', overlaps({ date: D, start: 600, durationMinutes: 60 }, { date: D, start: 630, durationMinutes: 60 }))
check('containment counts', overlaps({ date: D, start: 600, durationMinutes: 120 }, { date: D, start: 630, durationMinutes: 15 }))
check('touching end-to-start does NOT overlap', !overlaps({ date: D, start: 600, durationMinutes: 60 }, { date: D, start: 660, durationMinutes: 60 }))
check('touching start-to-end does NOT overlap', !overlaps({ date: D, start: 660, durationMinutes: 60 }, { date: D, start: 600, durationMinutes: 60 }))
check('different days never overlap', !overlaps({ date: D, start: 600, durationMinutes: 60 }, { date: '2026-09-10', start: 600, durationMinutes: 60 }))

console.log('\nConflict detection')
const dayOccupants = [occ('class', 18 * 60, 120), occ('work', 9 * 60, 8 * 60, false), occ('task-a', 16 * 60, 60, false)]
eq('a clean slot has no conflicts', findConflicts({ date: D, start: 15 * 60, durationMinutes: 45 }, dayOccupants, { protectedOnly: true }).length, 0)
const hit = findConflicts({ date: D, start: 18 * 60 + 30, durationMinutes: 60 }, dayOccupants, { protectedOnly: true })
eq('a clash with the class is found', hit.length, 1)
eq('and reports how much overlaps', hit[0].overlapMinutes, 60)
eq('unprotected occupants are ignored when protectedOnly', findConflicts({ date: D, start: 16 * 60, durationMinutes: 30 }, dayOccupants, { protectedOnly: true }).length, 0)
// 4pm–4:30pm sits inside both the 9–5 work block and task-a, so naming the
// occupants is clearer than counting them.
eq('unprotected occupants are found when not filtered',
  findConflicts({ date: D, start: 16 * 60, durationMinutes: 30 }, dayOccupants).map(c => c.occupant.id).sort(),
  ['task-a', 'work'])
eq('a task does not conflict with itself',
  findConflicts({ date: D, start: 16 * 60, durationMinutes: 60 }, dayOccupants, { ignoreIds: ['task-a'] }).map(c => c.occupant.id),
  ['work'])
eq('ignoring every occupant leaves nothing',
  findConflicts({ date: D, start: 16 * 60, durationMinutes: 60 }, dayOccupants, { ignoreIds: ['task-a', 'work', 'class'] }).length, 0)
const many = findConflicts({ date: D, start: 9 * 60, durationMinutes: 12 * 60 }, dayOccupants)
check('conflicts are ordered by how much they overlap', many[0].overlapMinutes >= many[many.length - 1].overlapMinutes)

console.log('\nSlot suggestion')
const classDay = [occ('class', 18 * 60, 120)]
const attempted = { date: D, start: 18 * 60 + 30, durationMinutes: 60 }
const slots = suggestSlots(attempted, classDay, { searchDays: [D], limit: 3 })
check('offers alternatives when refused', slots.length > 0, JSON.stringify(slots))
check('none of them clash with the class',
  slots.every(s => findConflicts({ date: s.date, start: s.start, durationMinutes: 60 }, classDay, { protectedOnly: true }).length === 0),
  JSON.stringify(slots))
check('the nearest is right after the class or just before it',
  slots.some(s => s.start >= 20 * 60) && slots.some(s => s.start + 60 <= 18 * 60),
  slots.map(s => formatMinutes(s.start)).join(', '))
check('suggestions are spread out, not consecutive 15-minute steps',
  slots.every((s, i) => i === 0 || s.date !== slots[i - 1].date || Math.abs(s.start - slots[i - 1].start) >= 90),
  slots.map(s => `${s.date} ${formatMinutes(s.start)}`).join(' | '))
check('each carries a human label', slots.every(s => s.label.length > 3))

// A fully booked day must push suggestions to a neighbouring day.
const fullDay = [occ('all-day', 6 * 60, 17 * 60)]
const spill = suggestSlots({ date: D, start: 12 * 60, durationMinutes: 60 }, fullDay, { limit: 2 })
check('a full day pushes suggestions to another day', spill.every(s => s.date !== D), JSON.stringify(spill))
check('and there are still options', spill.length > 0)

// Nothing fits anywhere.
const blockedEverywhere = ['2026-09-08', D, '2026-09-10'].map((d, i) => occ(`b${i}`, 6 * 60, 17 * 60, true, d))
eq('when nothing fits, no slot is invented', suggestSlots({ date: D, start: 12 * 60, durationMinutes: 60 }, blockedEverywhere).length, 0)

console.log('\nSplitting')
const split = splitTask({ date: D, start: 14 * 60, durationMinutes: 90 }, { occupants: classDay })
eq('halves sum to the original', split.first.durationMinutes + split.second.durationMinutes, 90)
check('neither half is trivially short', split.first.durationMinutes >= 15 && split.second.durationMinutes >= 15)
check('the second half is placed after the first, or dated for later',
  split.second.start === null || split.second.start >= 14 * 60 + split.first.durationMinutes,
  JSON.stringify(split))
const uneven = splitTask({ date: D, start: 14 * 60, durationMinutes: 90 }, { at: 20, occupants: [] })
eq('an explicit split point is honoured', uneven.first.durationMinutes, 20)
eq('and the remainder is the rest', uneven.second.durationMinutes, 70)
const clamped = splitTask({ date: D, start: 14 * 60, durationMinutes: 40 }, { at: 2, occupants: [] })
check('a split point below the minimum is clamped, not accepted', clamped.first.durationMinutes >= 15 && clamped.second.durationMinutes >= 15, JSON.stringify(clamped))
try { splitTask({ date: D, start: 600, durationMinutes: 20 }); check('splitting a very short session is refused', false) }
catch { check('splitting a very short session is refused', true) }
// Scope preservation is the point of splitting.
for (const total of [30, 45, 60, 75, 90, 120, 180]) {
  const s = splitTask({ date: D, start: 14 * 60, durationMinutes: total }, { occupants: [] })
  check(`splitting ${total} min preserves total scope`, s.first.durationMinutes + s.second.durationMinutes === total,
    `${s.first.durationMinutes} + ${s.second.durationMinutes}`)
}

console.log('\nRecurrence expansion')
// A Wednesday class, 6–8pm.
const wed: RecurringCommitment = {
  id: 'c1', label: 'CFA class', kind: 'class', isProtected: true, recurrence: 'weekly',
  weekdays: [3], startTime: '18:00', endTime: '20:00', startsOn: null, endsOn: null,
}
const week = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09']
const base = expandCommitment(wed, week, [])
eq('a weekly class appears once in the week', base.length, 1)
eq('on the right weekday', base[0].date, '2026-09-09')
eq('at the right time', base[0].start, 18 * 60)
eq('for the right length', base[0].durationMinutes, 120)

eq('a skipped occurrence disappears',
  expandCommitment(wed, week, [{ commitmentId: 'c1', occurrenceDate: '2026-09-09', kind: 'skipped', newDate: null, newStartTime: null, newEndTime: null }]).length, 0)

const moved = expandCommitment(wed, week, [
  { commitmentId: 'c1', occurrenceDate: '2026-09-09', kind: 'moved', newDate: '2026-09-06', newStartTime: '10:00', newEndTime: '12:00' },
])
eq('a moved occurrence appears on its new date', moved.length && moved[0].date, '2026-09-06')
eq('at its new time', moved.length && moved[0].start, 10 * 60)
check('and is flagged as moved', moved[0]?.moved === true)
check('it no longer appears on the original date', !moved.some(o => o.date === '2026-09-09'))

// The series itself must be untouched: the following week is normal again.
const nextWeek = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16']
const after = expandCommitment(wed, nextWeek, [
  { commitmentId: 'c1', occurrenceDate: '2026-09-09', kind: 'moved', newDate: '2026-09-06', newStartTime: '10:00', newEndTime: '12:00' },
])
eq('the next week is unaffected by a one-off move', after.length, 1)
eq('and falls on its normal weekday', after[0].date, '2026-09-16')

// Bounds.
eq('an occurrence before the series starts is excluded',
  expandCommitment({ ...wed, startsOn: '2026-09-16' }, week, []).length, 0)
eq('an occurrence after the series ends is excluded',
  expandCommitment({ ...wed, endsOn: '2026-09-01' }, week, []).length, 0)
eq('a non-recurring commitment expands to nothing', expandCommitment({ ...wed, recurrence: 'none' }, week, []).length, 0)
eq('multiple weekdays each produce an occurrence',
  expandCommitment({ ...wed, weekdays: [1, 3, 5] }, week, []).length, 3)
eq('an exception for another commitment is ignored',
  expandCommitment(wed, week, [{ commitmentId: 'other', occurrenceDate: '2026-09-09', kind: 'skipped', newDate: null, newStartTime: null, newEndTime: null }]).length, 1)

console.log('\nValue guards')
eq('duration snaps to five minutes', validateDuration(47), { ok: true, value: 45 })
check('a two-minute session is refused', validateDuration(2).ok === false)
check('a four-hour sitting is refused', validateDuration(240).ok === false)
check('and the refusal suggests splitting', (validateDuration(240) as any).error.includes('split'))
eq('start time snaps to five minutes', validateStart(613), { ok: true, value: 615 })
check('a start beyond the day is refused', validateStart(24 * 60).ok === false)
check('a negative start is refused', validateStart(-5).ok === false)

console.log('\nTime formatting')
eq('midnight', formatMinutes(0), '12am')
eq('noon', formatMinutes(720), '12pm')
eq('morning with minutes', formatMinutes(9 * 60 + 30), '9:30am')
eq('evening on the hour', formatMinutes(19 * 60), '7pm')

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
