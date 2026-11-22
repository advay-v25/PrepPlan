/**
 * Day-by-day generation: priority order and the new-content absorption cap.
 */
import { allocateDay, selectUnstableConcepts, siblingLink, type GeneratedPortion } from '../src/lib/planning/pulse/generateWeek'
import { splitIntoSittings } from '../src/lib/planning/pulse/sittings'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nDay allocation\n')

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

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
