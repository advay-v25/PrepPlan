/**
 * The Home readiness score — RED first, per TDD.
 *
 * A blend of curriculum coverage (how much you've worked through) and
 * diagnostic accuracy (how well you do when actually tested), weighted 60/40
 * toward coverage per the approved design. Deliberately not "pass
 * probability" — that's a claim this data cannot support.
 */
import { computeReadiness } from '../src/lib/state/readiness'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, a === b, `got ${a}, wanted ${b}`)

console.log('\nHome readiness score\n')

eq('with no diagnostics yet, readiness is pure coverage', computeReadiness(40, null), 40)
eq('coverage weighs 60%, diagnostics 40%', computeReadiness(80, 60), Math.round(80 * 0.6 + 60 * 0.4))
eq('perfect on both is 100', computeReadiness(100, 100), 100)
eq('zero on both is 0', computeReadiness(0, 0), 0)
eq('rounds to the nearest integer', computeReadiness(33, 67), Math.round(33 * 0.6 + 67 * 0.4))
eq('a diagnostic average worse than coverage pulls the score down', computeReadiness(90, 10) < 90, true)
eq('a diagnostic average better than coverage pulls the score up', computeReadiness(30, 90) > 30, true)
check('coverage is clamped to 0-100 even if given a stray out-of-range value', computeReadiness(150, null) === 100)
check('never negative', computeReadiness(-10, -20) >= 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
