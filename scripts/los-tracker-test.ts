/**
 * LOS readiness classification — the student's own Maintain / Verify / Repair method.
 */
import {
  classifyLos, deriveProgress, countBands, sortForStudy, STALE_AFTER_DAYS, BAND_METHOD, type LosEvidenceInput,
} from '../src/lib/curriculum/losTracker'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const now = new Date('2026-09-19T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
const ev = (o: Partial<LosEvidenceInput>): LosEvidenceInput => ({
  state: 'supported', validSampleSize: 3, confidenceMismatch: false, latestAt: daysAgo(2),
  hasOpenRepair: false, repairOccurrences: 0, ...o,
})

console.log('\nBand classification\n')
check('no evidence -> untested, never maintain', classifyLos(null, now).band === 'untested')
check('zero valid observations -> untested', classifyLos(ev({ validSampleSize: 0 }), now).band === 'untested')
check('insufficient state -> untested', classifyLos(ev({ state: 'insufficient' }), now).band === 'untested')
check('needs_repair -> repair', classifyLos(ev({ state: 'needs_repair' }), now).band === 'repair')
check('an open repair thread forces repair even if the latest state reads supported',
  classifyLos(ev({ hasOpenRepair: true }), now).band === 'repair')
check('recurring errors are named as recurring', /recurring/i.test(classifyLos(ev({ state: 'needs_repair', repairOccurrences: 3 }), now).rationale))
check('a single miss is an explicit gap, not "recurring"', !/recurring/i.test(classifyLos(ev({ state: 'needs_repair', repairOccurrences: 1 }), now).rationale))
check('unstable -> verify', classifyLos(ev({ state: 'unstable' }), now).band === 'verify')
check('guessed-correct (confidence mismatch) never reads as maintain, however many were right',
  classifyLos(ev({ confidenceMismatch: true, validSampleSize: 9 }), now).band === 'verify')
check('a disputed answer -> verify', classifyLos(ev({ state: 'disputed' }), now).band === 'verify')
check('supported but a single observation is under-sampled -> verify', classifyLos(ev({ validSampleSize: 1 }), now).band === 'verify')
check(`supported evidence older than ${STALE_AFTER_DAYS} days -> verify`, classifyLos(ev({ latestAt: daysAgo(STALE_AFTER_DAYS + 1) }), now).band === 'verify')
check('exactly at the staleness limit is still fresh', classifyLos(ev({ latestAt: daysAgo(STALE_AFTER_DAYS) }), now).band === 'maintain')
check('repeatedly correct, fresh, no mismatch -> maintain', classifyLos(ev({}), now).band === 'maintain')
check('every result carries a rationale', ['untested', 'repair', 'verify', 'maintain'].length === 4 &&
  [null, ev({ state: 'needs_repair' }), ev({ state: 'unstable' }), ev({})].every(e => classifyLos(e, now).rationale.length > 10))

console.log('\nProgress (work done is never evidence)\n')
const base = { hasOpenRepair: true, hasScheduledWork: false, workCompleted: false, nextRecheckDueAt: null }
check('maintain -> complete', deriveProgress({ ...base, band: 'maintain' }, now) === 'complete')
check('untested -> not started', deriveProgress({ ...base, band: 'untested' }, now) === 'not_started')
check('untested with scheduled work -> scheduled (the band itself stays untested)', deriveProgress({ ...base, band: 'untested', hasScheduledWork: true }, now) === 'scheduled')
check('untested with completed work -> worked, awaiting a test', deriveProgress({ ...base, band: 'untested', workCompleted: true }, now) === 'in_progress')
check('untested work never reads as complete', deriveProgress({ ...base, band: 'untested', workCompleted: true, hasScheduledWork: true }, now) !== 'complete')
check('repair with nothing planned -> not started', deriveProgress({ ...base, band: 'repair' }, now) === 'not_started')
check('repair with a planned task -> scheduled', deriveProgress({ ...base, band: 'repair', hasScheduledWork: true }, now) === 'scheduled')
check('work done, retest not yet due -> in progress',
  deriveProgress({ ...base, band: 'repair', workCompleted: true, nextRecheckDueAt: new Date(now.getTime() + 86_400_000).toISOString() }, now) === 'in_progress')
check('work done, retest due -> retest due',
  deriveProgress({ ...base, band: 'repair', workCompleted: true, nextRecheckDueAt: daysAgo(1) }, now) === 'retest_due')
check('completing the work does NOT complete a repair row', deriveProgress({ ...base, band: 'repair', workCompleted: true }, now) !== 'complete')

console.log('\nOrdering, counts and method\n')
const rows = [
  { band: 'maintain' as const, importance: 'core' }, { band: 'verify' as const, importance: 'supporting' },
  { band: 'repair' as const, importance: 'supporting' }, { band: 'repair' as const, importance: 'core' },
  { band: 'untested' as const, importance: 'core' },
]
const sorted = sortForStudy(rows)
check('repair rows come before everything else', sorted[0].band === 'repair' && sorted[1].band === 'repair')
check('within a band, core comes before supporting', sorted[0].importance === 'core' && sorted[1].importance === 'supporting')
check('verify precedes untested, maintain is last', sorted[2].band === 'verify' && sorted[sorted.length - 1].band === 'maintain')
const c = countBands(rows)
check('band counts add up to the total', c.repair + c.verify + c.maintain + c.untested === c.total && c.repair === 2 && c.total === 5)
check('repair proof demands a retest and forbids guessed answers', /next-day retest/.test(BAND_METHOD.repair.proof) && /no guessed/.test(BAND_METHOD.repair.proof))
check('repair asks for more questions than verify, verify more than maintain',
  BAND_METHOD.repair.questionRange.startsWith('12') && BAND_METHOD.verify.questionRange.startsWith('6') && BAND_METHOD.maintain.questionRange.startsWith('3'))
check('method text names the concept', BAND_METHOD.verify.howToImprove('Duration').includes('Duration'))
check('no output promises a pass probability or an hours target',
  !/pass|probab|hours/i.test(Object.values(BAND_METHOD).map(m => m.proof + m.questionRange).join(' ')))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
