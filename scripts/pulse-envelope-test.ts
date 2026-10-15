/**
 * Weekly envelope — remaining effort divided across usable weeks, adjusted
 * by a rolling pacing factor. Never remaining × factor directly (spec §2).
 */
import { pacingFactor, computeWeeklyEnvelope, completionRateOf } from '../src/lib/planning/pulse/envelope'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, a === b, `got ${a}, wanted ${b}`)

console.log('\nWeekly envelope\n')

eq('no history: conservative floor', pacingFactor([]), 0.6)
eq('one week of history under 2-week minimum: conservative floor', pacingFactor([0.95]), 0.6)
eq('two strong weeks: high band', pacingFactor([0.95, 0.92]), 1.15)
eq('two steady weeks: steady band', pacingFactor([0.75, 0.8]), 1.0)
eq('two weak weeks: ease-off band', pacingFactor([0.4, 0.5]), 0.75)
eq('two very weak weeks: floor', pacingFactor([0.1, 0.2]), 0.6)
eq('three weeks averages the rolling window, not just the latest', pacingFactor([0.95, 0.95, 0.2]), pacingFactor([0.95, 0.95, 0.2]))
check('a strong recent week pulls a weak history up, not just copies the latest', pacingFactor([0.2, 0.95, 0.95]) > pacingFactor([0.2, 0.2, 0.2]))

eq('even split: remaining ÷ weeks, ignoring pacing at factor 1.0', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 4, priorCompletionRates: [0.75, 0.8] }), 5)
eq('never divides by zero weeks', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 0, priorCompletionRates: [] }), 20 * 0.6)
eq('pacing scales the even split, not the whole remaining effort', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 4, priorCompletionRates: [0.95, 0.95] }), 5 * 1.15)

eq('completion rate is actual/planned, capped at 1', completionRateOf({ plannedEffort: 10, actualEffort: 8 }), 0.8)
eq('completion rate caps at 1 even when they did more than planned', completionRateOf({ plannedEffort: 10, actualEffort: 15 }), 1)
eq('completion rate is 0 when nothing was planned', completionRateOf({ plannedEffort: 0, actualEffort: 0 }), 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
