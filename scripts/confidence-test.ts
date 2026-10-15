/** Pure tests for the confidence engine. */
import { toLevel, observationVerdict, outcomeVerdict, checkMark, type Observation } from '../src/lib/curriculum/confidence'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const now = new Date('2026-09-20T12:00:00Z')
const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const obs = (correct: boolean, level: Observation['level'], ago = 1): Observation => ({ correct, level, at: day(ago) })

console.log('\nLevels and single observations\n')
check('1-2 is low, 3 medium, 4-5 high', toLevel(1) === 'low' && toLevel(2) === 'low' && toLevel(3) === 'medium' && toLevel(4) === 'high' && toLevel(5) === 'high')
check('missing confidence has no level', toLevel(null) === null && toLevel(undefined) === null)
check('very confident and wrong is a concept miss', observationVerdict(false, 'high') === 'concept_miss')
check('low confidence and right is a guess', observationVerdict(true, 'low') === 'guess')
check('high confidence and right is secure', observationVerdict(true, 'high') === 'secure')
check('low confidence and wrong is a known gap', observationVerdict(false, 'low') === 'known_gap')
check('medium confidence is unsettled when right', observationVerdict(true, 'medium') === 'unsettled')
check('no confidence recorded: right is unsettled, wrong is a known gap', observationVerdict(true, null) === 'unsettled' && observationVerdict(false, null) === 'known_gap')

console.log('\nOutcome verdicts\n')
check('no observations -> none', outcomeVerdict([], now).verdict === 'none')
check('one concept miss dominates earlier good results', outcomeVerdict([obs(true, 'high', 10), obs(true, 'high', 5), obs(false, 'high', 1)], now).verdict === 'concept_miss')
check('a concept miss stays dominant until three newer observations push it out', outcomeVerdict([obs(false, 'high', 9), obs(true, 'high', 5), obs(true, 'high', 2), obs(true, 'high', 1)], now).verdict === 'secure')
check('a single secure result is not enough to be secure', outcomeVerdict([obs(true, 'high', 1)], now).verdict === 'unsettled')
check('two recent secure results are secure', outcomeVerdict([obs(true, 'high', 6), obs(true, 'high', 1)], now).verdict === 'secure')
check('secure results older than 21 days fall back to unsettled', outcomeVerdict([obs(true, 'high', 40), obs(true, 'high', 30)], now).verdict === 'unsettled')
check('a latest guess is a guess even after secure results', outcomeVerdict([obs(true, 'high', 6), obs(true, 'high', 3), obs(true, 'low', 1)], now).verdict === 'guess')
check('repeated known gaps stay a known gap', outcomeVerdict([obs(false, 'low', 6), obs(false, 'low', 3), obs(true, 'medium', 1)], now).verdict === 'known_gap')
check('a latest known gap is a known gap', outcomeVerdict([obs(true, 'high', 5), obs(false, 'low', 1)], now).verdict === 'known_gap')
check('observation order does not matter', outcomeVerdict([obs(false, 'high', 1), obs(true, 'high', 5)], now).verdict === outcomeVerdict([obs(true, 'high', 5), obs(false, 'high', 1)], now).verdict)
check('every verdict carries a plain reason', ['concept_miss', 'known_gap', 'guess', 'secure', 'unsettled'].every(() => outcomeVerdict([obs(false, 'high', 1)], now).reason.length > 10))

console.log('\nVerifying the student\'s own mark\n')
check('no evidence: a marked outcome is unassessed', checkMark('solid', 'none').check === 'unassessed')
check('no mark and no evidence is unmarked', checkMark(null, 'none').check === 'unmarked')
check('solid + secure is verified', checkMark('solid', 'secure').check === 'verified')
check('solid + concept miss is overconfident and needs revision', (() => { const r = checkMark('solid', 'concept_miss'); return r.check === 'overconfident' && r.needsRevision })())
check('fairly sure + guess is overconfident', checkMark('fairly_sure', 'guess').check === 'overconfident')
check('fairly sure + unsettled is not yet assessable', checkMark('fairly_sure', 'unsettled').check === 'unassessed')
check('shaky + secure is underconfident and STILL goes to revision', (() => { const r = checkMark('shaky', 'secure'); return r.check === 'underconfident' && r.needsRevision })())
check('not started + secure is underconfident', checkMark('not_started', 'secure').check === 'underconfident')
check('shaky + known gap: the student was right about themselves', (() => { const r = checkMark('shaky', 'known_gap'); return r.check === 'verified' && !r.needsRevision })())
check('an unmarked outcome with evidence is unmarked', checkMark(null, 'secure').check === 'unmarked')

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
