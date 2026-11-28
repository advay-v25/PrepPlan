/**
 * Day-by-day generation: priority order and the new-content absorption cap.
 */
import { allocateDay, insidePlanningHorizon, lastStudyDate, selectUnstableConcepts, siblingLink, waitingFirstPassWork, type GeneratedPortion } from '../src/lib/planning/pulse/generateWeek'
import { splitIntoSittings } from '../src/lib/planning/pulse/sittings'
import { busyFromTimed, fitTimedStart, gapsFromRanges, subtractBusy, reserveFlexible, packSittings, gapsAfterAccepted } from '../src/lib/planning/pulse/gaps'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nDay allocation\n')

const bookedCutoff = lastStudyDate({ targetDate: '2027-02-17', targetKind: 'booked' })
check('the last study day before a booked exam is usable', insidePlanningHorizon('2027-02-16', '2027-02-15', bookedCutoff))
check('the booked exam and later days of a partial week are outside the horizon', ['2027-02-17', '2027-02-21'].every(date => !insidePlanningHorizon(date, '2027-02-15', bookedCutoff)))
check('an indicative target remains usable and past days stay excluded', insidePlanningHorizon('2027-02-17', '2027-02-15', lastStudyDate({ targetDate: '2027-02-17', targetKind: 'sitting' })) && !insidePlanningHorizon('2027-02-14', '2027-02-15', bookedCutoff))

const module = (id: string, effortBand: number) => ({ id, topic: 't1', name: id, effortBand, difficulty: 3, sequence: 1, coverage: 'not_started' as const })

const result1 = allocateDay({
  capacityMinutes: 600, minutesPerEffortUnit: 60,
  repairs: [], unstableConcepts: [],
  pendingModules: [module('m1', 1), module('m2', 1), module('m3', 1), module('m4', 1), module('m5', 1), module('m6', 1), module('m7', 1)],
  phase: 'first_pass',
})
check('new-content is capped at 6 effort-units/day even with 10 hours free', result1.portions.filter(p => p.priorityLane === 'content').reduce((s, p) => s + p.effortUnits, 0) <= 6)

const result2 = allocateDay({
  capacityMinutes: 600, minutesPerEffortUnit: 60,
  repairs: [{ id: 'r1', title: 'Repair: FSA', durationMinutes: 30 }],
  unstableConcepts: [{ conceptId: 'c1', name: 'Duration' }],
  pendingModules: [module('m1', 1)],
  phase: 'first_pass',
})
eq('repair comes before unstable, which comes before new content', result2.portions.map(p => p.priorityLane), ['repair', 'unstable', 'content'])

const result3 = allocateDay({
  capacityMinutes: 15, minutesPerEffortUnit: 60,
  repairs: [], unstableConcepts: [],
  pendingModules: [module('m1', 3)],
  phase: 'first_pass',
})
eq('too little capacity for anything: empty day, not a crammed one', result3.portions, [])

const result4 = allocateDay({
  capacityMinutes: 100, minutesPerEffortUnit: 85,
  repairs: [], unstableConcepts: [],
  // m1 needs 340 minutes total, clamped to a 180-minute portion (the DB max)
  // — still bigger than the day's 100-minute capacity, so it's skipped.
  // m2 needs 85 minutes, fits despite m1 being first in the (unsequenced) list.
  pendingModules: [module('m1', 4), module('m2', 1)],
  phase: 'first_pass',
})
check('skip too-large module and place smaller one after: day gets non-zero content', result4.portions.length > 0, `got ${result4.portions.length} portions`)
check('smaller module placed even though larger one came first', result4.portions.some(p => p.lmId === 'm2'), `portions: ${JSON.stringify(result4.portions.map(p => p.lmId))}`)

// plan_blocks.duration_minutes is DB-constrained to [5, 180] — found live when
// a real module (235 min) was pushed as one oversized portion and the insert
// was rejected outright.
const result5 = allocateDay({
  capacityMinutes: 600, minutesPerEffortUnit: 85,
  repairs: [], unstableConcepts: [],
  pendingModules: [module('m1', 4)], // 340 minutes uncapped
  phase: 'first_pass',
})
check('no portion ever exceeds the DB duration cap', result5.portions.every(p => p.durationMinutes <= 180), `durations: ${JSON.stringify(result5.portions.map(p => p.durationMinutes))}`)

{
  const ev = (conceptId: string, state: string) => ({ conceptId, state, name: conceptId })
  const none = new Set<string>()
  check('unstable, no repair thread: planned once (a generic re-verify is legitimate)', selectUnstableConcepts([ev('c1', 'unstable'), ev('c1', 'unstable')], none).map(c => c.conceptId).join() === 'c1')
  for (const [why, owned] of [['an open or proposed repair', 'c1'], ['an accepted (scheduled/in-progress) repair', 'c1'], ['a repair awaiting its spacing', 'c1'], ['a scheduled re-check', 'c1']]) check(`${why} owns verification: no second generic obligation`, selectUnstableConcepts([ev('c1', 'unstable')], new Set([owned])).length === 0)
  check('newer supported evidence retires an older unstable event', selectUnstableConcepts([ev('c1', 'supported'), ev('c1', 'unstable')], none).length === 0)
  check('a different concept is independent of another concept\'s repair', selectUnstableConcepts([ev('c2', 'unstable'), ev('c1', 'unstable')], new Set(['c1'])).map(c => c.conceptId).join() === 'c2')
  check('repeated calls are stable (retry and rollover add nothing)', JSON.stringify(selectUnstableConcepts([ev('c2', 'unstable')], new Set(['c1']))) === JSON.stringify(selectUnstableConcepts([ev('c2', 'unstable')], new Set(['c1']))))
}
// (Requires a real active roadmap + profile to test buildWeekPlan end-to-end,
// which allocateDay's pure tests above deliberately avoid. Cover this in
// scripts/e2e-calendar.ts instead, against the real E2E account — see Task 14.)

console.log('\nWeekly splits carry explicit sibling identity and declared order\n')
{
  const portion = { title: 'Study X', detail: '', taskType: 'study', effortUnits: 3, durationMinutes: 130, lmId: 'r1', repairThreadId: null, priorityLane: 'content' } as GeneratedPortion
  const parts = splitIntoSittings(portion, 45), other = splitIntoSittings({ ...portion, title: 'Study Y' }, 45)
  const all = [...parts, ...other].map((p, i) => ({ p, id: `id${i}` }))
  const link = (i: number) => siblingLink(all[i].p, all)
  check('every sitting of one portion shares one key, 1-based index and count', new Set(parts.map(p => p.split!.key)).size === 1 && parts.every((p, i) => p.split!.index === i + 1 && p.split!.count === parts.length) && parts.length === 3)
  check('two different portions never share a key (no inference from a shared reading or title)', parts[0].split!.key !== other[0].split!.key)
  check('the first sitting follows nothing; each later one declares exactly the sitting before it', link(0).after.length === 0 && link(1).after[0] === 'id0' && link(2).after[0] === 'id1')
  check('a sibling of ANOTHER portion on the same day is never a predecessor', link(3).after.length === 0 && link(4).after[0] === 'id3')
  check('an unsplit portion carries no group and no order', siblingLink({ ...portion, durationMinutes: 30 }, []).group_key === '' && siblingLink({ ...portion, durationMinutes: 30 }, []).after.length === 0)
  check('the minutes of the split add back up exactly', parts.reduce((n, p) => n + p.durationMinutes, 0) === 130)
}

console.log('\nFit against real gaps\n')
{
  const two30 = gapsFromRanges([{ start: '09:00', end: '09:30' }, { start: '11:00', end: '11:30' }])
  const study = (id: string, band: number) => ({ id, topic: 't1', name: id, effortBand: band, difficulty: 3, sequence: 1, coverage: 'not_started' as const })
  const two = allocateDay({ capacityMinutes: 60, minutesPerEffortUnit: 30, repairs: [], unstableConcepts: [], pendingModules: [study('a', 1), study('b', 1)], phase: 'first_pass', gaps: two30 })
  eq('two 30-minute gaps hold two ordered 30-minute portions', two.portions.map(p => p.durationMinutes), [30, 30])
  const one45 = allocateDay({ capacityMinutes: 60, minutesPerEffortUnit: 45, repairs: [], unstableConcepts: [], pendingModules: [study('a', 1)], phase: 'first_pass', gaps: two30 })
  eq('45 minutes of study over two 30-minute gaps become two ordered sittings 30 + 15', one45.portions.map(p => p.durationMinutes), [30, 15])
  const oneGap = allocateDay({ capacityMinutes: 30, minutesPerEffortUnit: 45, repairs: [], unstableConcepts: [], pendingModules: [study('a', 1)], phase: 'first_pass', gaps: gapsFromRanges([{ start: '09:00', end: '09:30' }]) })
  eq('with one 30-minute gap only 30 are promised; the rest waits', oneGap.portions.map(p => p.durationMinutes), [30])
  eq('partly placed readings retain their unallocated minutes', waitingFirstPassWork([study('a', 1), study('b', 1)], [oneGap], 45), [
    { id: 'a', name: 'a', minutes: 15 }, { id: 'b', name: 'b', minutes: 45 },
  ])
  eq('fully placed readings leave no remainder', waitingFirstPassWork([study('a', 1)], [one45], 45), [])
  const split = allocateDay({ capacityMinutes: 60, minutesPerEffortUnit: 60, repairs: [], unstableConcepts: [], pendingModules: [study('a', 1)], phase: 'first_pass', maxSittingMinutes: 60, gaps: two30 })
  eq('a 60-minute portion becomes two sittings that follow the gaps, not one 60-minute sitting', split.portions.map(p => p.durationMinutes), [30, 30])
  check('those sittings stay one ordered group', split.portions.length === 2 && split.portions[0].split?.key === split.portions[1].split?.key && split.portions[1].split?.index === 2)
  const noRepairRoom = allocateDay({ capacityMinutes: 60, minutesPerEffortUnit: 60, repairs: [{ id: 'r', title: 'Repair: x', durationMinutes: 45 }], unstableConcepts: [], pendingModules: [], phase: 'first_pass', gaps: two30 })
  eq('a 45-minute repair is not promised across two 30-minute gaps', noRepairRoom.portions, [])
  eq('a 45-minute paper cannot use two fragmented 30-minute openings', fitTimedStart(two30, 45, 540, []), null)
  eq('a paper can move to the next available slot and leave room for study', fitTimedStart([{ start: 550, end: 580 }, { start: 660, end: 720 }], 45, 540, [30]), 660)
  eq('a paper cannot consume the only slot that holds existing study', fitTimedStart([{ start: 540, end: 600 }], 45, 540, [30]), null)
  eq('exact adjacency keeps both sides: busy 09:30-10:00 leaves 09:00-09:30 and 10:00-12:00', subtractBusy(gapsFromRanges([{ start: '09:00', end: '12:00' }]), [{ start: 570, end: 600 }]), [{ start: 540, end: 570 }, { start: 600, end: 720 }])
  eq('represented flexible work is taken off earliest first, never counted twice', reserveFlexible(two30, 40), [{ start: 11 * 60 + 10, end: 11 * 60 + 30 }])
  eq('a sitting shorter than the minimum is not offered', packSittings([{ start: 0, end: 4 }], 30, 60).sittings, [])
  eq('a timed paper at 10:00 BST (09:00Z) holds 10:00-11:30 on the local clock', busyFromTimed([{ local_date: '2027-06-10', starts_at: '2027-06-10T09:00:00Z', duration_minutes: 90 }], 'Europe/London'), { '2027-06-10': [{ start: 600, end: 690 }] })
  eq('the repeated autumn hour: 01:30Z on 31 Oct is 01:30 GMT, not BST', busyFromTimed([{ local_date: '2027-10-31', starts_at: '2027-10-31T01:30:00Z', duration_minutes: 30 }], 'Europe/London'), { '2027-10-31': [{ start: 90, end: 120 }] })
  eq('an instant on another local date than the task is not placed', busyFromTimed([{ local_date: '2027-06-10', starts_at: '2027-06-10T23:30:00Z', duration_minutes: 30 }], 'Europe/London'), {})
  eq('an interval is clipped at local midnight', busyFromTimed([{ local_date: '2027-06-10', starts_at: '2027-06-10T22:30:00Z', duration_minutes: 120 }], 'Europe/London')['2027-06-10'], [{ start: 1410, end: 1440 }])
  const timedGaps = subtractBusy(gapsFromRanges([{ start: '09:00', end: '12:00' }]), busyFromTimed([{ local_date: '2027-06-10', starts_at: '2027-06-10T09:00:00Z', duration_minutes: 60 }], 'Europe/London')['2027-06-10'])
  eq('accepted timed work is taken off once, leaving 09:00-10:00 and 11:00-12:00', timedGaps, [{ start: 540, end: 600 }, { start: 660, end: 720 }])
  const ninety = [{ start: 540, end: 630 }]
  eq('an accepted 30-minute sitting leaves 60 contiguous minutes of a 90-minute window, so a 60 fits and a 90 does not', gapsAfterAccepted(ninety, [], [30]), [{ start: 570, end: 630 }])
  eq('accepted sittings are packed whole, largest first: 60 then 30 fills 90 exactly', gapsAfterAccepted(ninety, [], [30, 60]), [])
  eq('an accepted sitting that fits no gap leaves no room at all', gapsAfterAccepted([{ start: 540, end: 570 }], [], [45]), [])
  eq('no windows gives an empty day', allocateDay({ capacityMinutes: 0, minutesPerEffortUnit: 60, repairs: [], unstableConcepts: [], pendingModules: [study('a', 1)], phase: 'first_pass', gaps: [] }).portions, [])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
