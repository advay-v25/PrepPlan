/**
 * redistributeWeek's classification: small deviations absorb automatically,
 * big ones don't touch the calendar and raise an attention item instead
 * (spec §3.2, §7).
 */
import { classifyRedistribution } from '../src/lib/planning/pulse/redistribute'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

console.log('\nRedistribution classification\n')

const small = classifyRedistribution({
  remainingEffortToPlace: 1,
  remainingDays: [
    { date: '2026-09-19', capacityMinutes: 180, alreadyPlannedContentUnits: 0.5, targetRowDurationMinutes: 30 },
    { date: '2026-09-20', capacityMinutes: 180, alreadyPlannedContentUnits: 0.5, targetRowDurationMinutes: 30 },
  ],
  minutesPerEffortUnit: 60,
})
check('fits within every remaining day\'s absorption cap: classified small', small.size === 'small')

const big = classifyRedistribution({
  remainingEffortToPlace: 10,
  remainingDays: [
    { date: '2026-09-19', capacityMinutes: 60, alreadyPlannedContentUnits: 1.9, targetRowDurationMinutes: 30 },
  ],
  minutesPerEffortUnit: 60,
})
check('would push a remaining day over its cap: classified big', big.size === 'big')

const noRoom = classifyRedistribution({
  remainingEffortToPlace: 3,
  remainingDays: [],
  minutesPerEffortUnit: 60,
})
check('no remaining days at all: classified big (nowhere to absorb it)', noRoom.size === 'big')

// Found live: a day's overall effort cap has room, but the single row that
// absorbs the addition (plan_blocks.duration_minutes is DB-constrained to
// [5, 180]) would be pushed over that per-row limit even though the day-level
// check passes. capacityMinutes is the placeholder 9999 real callers use
// (redistribute.ts doesn't re-check per-day capacity, only the row cap).
const rowOverflow = classifyRedistribution({
  remainingEffortToPlace: 0.88,
  remainingDays: [
    { date: '2026-09-18', capacityMinutes: 9999, alreadyPlannedContentUnits: 2, targetRowDurationMinutes: 170 },
  ],
  minutesPerEffortUnit: 85,
})
check('would push the target row past the 180-minute DB cap even though the day fits: classified big',
  rowOverflow.size === 'big', JSON.stringify(rowOverflow))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
