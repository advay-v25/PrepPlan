/**
 * Day-by-day generation: priority order and the new-content absorption cap.
 */
import { allocateDay } from '../src/lib/planning/pulse/generateWeek'

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

// (Requires a real active roadmap + profile to test buildWeekPlan end-to-end,
// which allocateDay's pure tests above deliberately avoid. Cover this in
// scripts/e2e-calendar.ts instead, against the real E2E account — see Task 14.)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
