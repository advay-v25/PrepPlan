/** Pure tests: the four signals, their separation rules, and the operating-state bridge merge. */
import { computeSignals, EVENT_MOVES, type BlockRow, type EvidenceStats, type OutcomeState } from '../src/lib/signals/signals'
import { mergeTestsBridge, type TestsBridge } from '../src/lib/signals/operatingBridge'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const today = '2026-09-20'
const O = (id: string, reading: string, o: Partial<OutcomeState> = {}): OutcomeState => ({ outcomeId: id, readingId: reading, subjectId: 'fsa', exposed: false, scheduled: false, tested: false, verified: false, ...o })
const B = (id: string, execution: string, o: Partial<BlockRow> = {}): BlockRow => ({ id, execution, taskType: 'study', minutes: 30, localDate: '2026-09-18', title: id, ...o })
const E = (o: Partial<EvidenceStats> = {}): EvidenceStats => ({ validEvents: 0, voidedEvents: 0, disputedEvents: 0, scoredPapers: 0, readingsTested: 0, subjectsTested: 0, latestEvidenceAt: null,
  high: { n: 0, correct: 0 }, low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 }, overconfidentOutcomes: 0, underconfidentOutcomes: 0, markedOutcomes: 0, ...o })
const outcomes = [O('a', 'r1', { exposed: true, tested: true, verified: true }), O('b', 'r1', { exposed: true, tested: true }), O('c', 'r2', { exposed: true }), O('d', 'r2', { scheduled: true }), O('e', 'r3')]
const strong = E({ validEvents: 20, scoredPapers: 2, readingsTested: 2, subjectsTested: 1, latestEvidenceAt: '2026-09-18T10:00:00Z', high: { n: 8, correct: 8 }, low: { n: 4, correct: 2 }, medium: { n: 4, correct: 3 } })
const sig = (blocks: BlockRow[], evidence = strong, outs = outcomes) => computeSignals({ outcomes: outs, blocks, evidence, movement: [], today })

console.log('\nThe four signals stay separate\n')
{
  const none = sig([])
  const done = sig([B('x', 'completed'), B('y', 'completed')])
  check('completing blocks changes execution', done.execution.completed === 2 && none.execution.completed === 0)
  check('completing blocks NEVER changes demonstrated understanding', JSON.stringify(done.understanding) === JSON.stringify(none.understanding))
  const post = sig([B('x', 'deferred'), B('y', 'completed')])
  check('a postponed block adds plan pressure and is counted as postponed', post.execution.postponed === 1 && post.execution.pressure !== 'none')
  check('a postponed block does not touch understanding or tested position', JSON.stringify(post.understanding) === JSON.stringify(none.understanding) && post.position.tested === none.position.tested)
  check('lots slipping is high pressure, a little is building, nothing is none', sig([B('a', 'deferred'), B('b', 'skipped'), B('c', 'completed')]).execution.pressure === 'high' && sig([B('a', 'deferred'), B('b', 'completed'), B('c', 'completed'), B('d', 'completed')]).execution.pressure === 'building' && sig([B('a', 'completed')]).execution.pressure === 'none')
  check('a past-due block with no status is "unreported", never quietly done or missed', sig([B('a', 'not_started', { localDate: '2026-09-10' })]).execution.unreported === 1 && sig([B('a', 'not_started', { localDate: '2026-09-25' })]).execution.unreported === 0)
  check('the paper and admin blocks are not counted as learning execution', sig([B('p', 'completed', { taskType: 'diagnostic' })]).execution.total === 0)
  check('the paper of activity events: only test events may move understanding', EVENT_MOVES.paper_scored === 'understanding' && EVENT_MOVES.evidence_voided === 'understanding'
    && EVENT_MOVES.block_completed === 'execution' && EVENT_MOVES.block_postponed === 'execution' && EVENT_MOVES.block_skipped === 'execution')
}

console.log('\nCurriculum position\n')
{
  const p = sig([]).position
  check('position counts exposed, scheduled, tested and verified separately', p.total === 5 && p.exposed === 3 && p.tested === 2 && p.verified === 1 && p.scheduled === 1)
  check('an outcome nobody has touched is not started', p.notStarted === 1)
  check('exposed readings are counted', p.readingsExposed === 2)
}

console.log('\nThe headline band needs enough evidence\n')
{
  check('with strong evidence across two readings and two papers there is a band', sig([]).understanding.band !== 'Insufficient evidence')
  const one = sig([], E({ ...strong, readingsTested: 1 }))
  check('one reading is not enough', one.understanding.band === 'Insufficient evidence' && one.understanding.reasons.some(r => /reading/.test(r)))
  const oneP = sig([], E({ ...strong, scoredPapers: 1 }))
  check('one paper is not enough', oneP.understanding.band === 'Insufficient evidence' && oneP.understanding.reasons.some(r => /paper/.test(r)))
  const stale = sig([], E({ ...strong, latestEvidenceAt: '2026-08-01T10:00:00Z' }))
  check('stale evidence is not enough, and says how old it is', stale.understanding.band === 'Insufficient evidence' && stale.understanding.reasons.some(r => /days old/.test(r)) && !stale.understanding.recent)
  check('no evidence at all says so', sig([], E()).understanding.reasons.some(r => /no test evidence/i.test(r)))
  const disputed = sig([], E({ ...strong, disputedEvents: 10 }))
  check('a critical integrity warning withholds the band', disputed.understanding.band === 'Insufficient evidence' && !!disputed.understanding.integrityWarning)
  check('each missing requirement is explained, not hidden', sig([], E({ validEvents: 2, scoredPapers: 1, readingsTested: 1, latestEvidenceAt: '2026-01-01T00:00:00Z' })).understanding.reasons.length >= 3)
  const low = sig([], strong, [O('a', 'r1', { tested: true }), O('b', 'r1', { tested: true }), O('c', 'r2', { tested: true }), O('d', 'r2', { tested: true, verified: true })])
  const high = sig([], strong, [O('a', 'r1', { tested: true, verified: true }), O('b', 'r1', { tested: true, verified: true }), O('c', 'r2', { tested: true, verified: true }), O('d', 'r2', { tested: true })])
  check('the band follows the verified share of tested outcomes, and stops at Stable', low.understanding.band === 'Building' && high.understanding.band === 'Stable')
}

console.log('\nA voided question reverses its evidence\n')
{
  const before = sig([], strong)
  const after = sig([], E({ ...strong, validEvents: 6, scoredPapers: 2, readingsTested: 1 }))
  check('when evidence is voided and the sample falls below the threshold, the band is withdrawn', before.understanding.band !== 'Insufficient evidence' && after.understanding.band === 'Insufficient evidence')
}

console.log('\nConfidence calibration\n')
{
  check('too few answers: no claim', sig([], E({ high: { n: 1, correct: 1 }, low: { n: 1, correct: 0 }, medium: { n: 0, correct: 0 } })).calibration.reading.startsWith('Too few'))
  check('sure and mostly right reads as well calibrated', /usually right/.test(sig([]).calibration.reading))
  const mis = sig([], E({ ...strong, high: { n: 8, correct: 4 } }))
  check('sure and wrong more than once reads as misconceptions', /misconceptions/.test(mis.calibration.reading) && mis.calibration.confidentWrong === 4)
  check('correct guesses are counted', sig([]).calibration.guessedRight === 2)
  check('overconfident outcomes are carried through', sig([], E({ ...strong, overconfidentOutcomes: 3 })).calibration.overconfidentOutcomes === 3)
}

console.log('\nOperating-state bridge\n')
{
  const state: any = {
    schemaVersion: 1, cycle: null, today: { dateLocal: '2026-11-05', blocks: [], protectedCommitments: [] }, papers: { availablePapers: [], activeReservation: null }, capabilities: { canTakeDiagnostic: false, canTakeRevisionary: false, canCloseWeek: false },
    preparedness: null, evidence: { recentChanges: [], preparednessBand: null }, repairs: { openThreads: [{ id: 't1', conceptName: 'uuid-1234' }, { id: 't2', conceptName: 'uuid-5678' }], proposals: [] },
    integrity: { isStale: false, activationFailed: false, insufficientPaperBank: false, crossPageInvariantFailed: false, partialServiceFailure: [] }, attention: [], nextAction: null,
  }
  const frozen = JSON.stringify(state)
  const bridge: TestsBridge = {
    papers: { availablePapers: [{ id: 'weekly:x', revision: 0, availability: 'available', destination: '/app/tests', permittedCommands: ['start_paper'], purpose: 'diagnostic', estimatedDurationMinutes: 12, sufficientBank: true }], activeReservation: null },
    capabilities: { canTakeDiagnostic: true, canTakeRevisionary: false, canCloseWeek: false }, preparedness: null, preparednessBand: 'Insufficient evidence', repairNames: { t1: 'Diluted EPS' }, insufficientPaperBank: false, signals: sig([]),
    assessment: { state: 'ready', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: null }, closure: null,
  }
  const merged = mergeTestsBridge(state, bridge)
  check('the bridge fills papers and capabilities', merged.papers.availablePapers.length === 1 && merged.capabilities.canTakeDiagnostic === true)
  check('the bridge replaces uuid repair names with concept names, keeping unknown ones', merged.repairs.openThreads[0].conceptName === 'Diluted EPS' && merged.repairs.openThreads[1].conceptName === 'uuid-5678')
  check('the bridge sets the evidence band without touching other evidence', merged.evidence.preparednessBand === 'Insufficient evidence' && merged.evidence.recentChanges.length === 0)
  check('merging never mutates the original state', JSON.stringify(state) === frozen)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
