import { buildLedger, combineLedgers, ledgerFromCounts, isSupportedPolicy, PAPER_SCORE_POLICY } from '../src/lib/tests/scoreLedger'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const ids = (n: number) => Array.from({ length: n }, (_, i) => `q${i + 1}`)
const P = PAPER_SCORE_POLICY

// 1 correct, 7 omitted (the reproduced T-A1 case)
const a = buildLedger({ policy: P, delivered: ids(8), responses: [{ itemId: 'q1', isCorrect: true }] })
ok('1 correct + 7 omitted: paper score 12.5%', a.paperScore === 0.125, a)
ok('…answered accuracy 100%, completion 12.5%, 7 omissions', a.answeredAccuracy === 1 && a.completion === 0.125 && a.omitted === 7, a)
// legacy label keeps answered-only denominator
const legacy = buildLedger({ policy: '1.0', delivered: ids(8), responses: [{ itemId: 'q1', isCorrect: true }] })
ok('legacy policy keeps the answered-only score (100%) and says so', legacy.paperScore === 1 && legacy.policy === '1.0', legacy)
// all omitted
const none = buildLedger({ policy: P, delivered: ids(8), responses: [] })
ok('all omitted: 0% paper score, unknown answered accuracy', none.paperScore === 0 && none.answeredAccuracy === null && none.omitted === 8, none)
// all voided
const voidAll = buildLedger({ policy: P, delivered: ids(3), responses: [{ itemId: 'q1', isCorrect: true }], voided: ids(3) })
ok('all voided: no scoreable items, score unavailable (null, not 0)', voidAll.scoreable === 0 && voidAll.paperScore === null && voidAll.completion === null, voidAll)
// disputed stays in the denominator
const disp = buildLedger({ policy: P, delivered: ids(2), responses: [{ itemId: 'q1', isCorrect: true }, { itemId: 'q2', isCorrect: true }], disputed: ['q2'] })
ok('two correct, one disputed: 100% never 200%, denominator kept, provisional flagged', disp.paperScore === 1 && disp.scoreable === 2 && disp.provisional === 1, disp)
// voided exactly once, even when also disputed / listed twice
const once = buildLedger({ policy: P, delivered: ids(4), responses: ids(4).map(itemId => ({ itemId, isCorrect: itemId !== 'q4' })), voided: ['q4', 'q4'], disputed: ['q4'] })
ok('a voided item is removed exactly once', once.scoreable === 3 && once.correct === 3 && once.incorrect === 0 && once.provisional === 0, once)
// response for an item not on the form cannot inflate the score
const stray = buildLedger({ policy: P, delivered: ids(2), responses: [{ itemId: 'zz', isCorrect: true }, { itemId: 'q1', isCorrect: false }] })
ok('a response outside the form is ignored', stray.correct === 0 && stray.incorrect === 1 && stray.omitted === 1, stray)
// combined mock sums counts
const s1 = buildLedger({ policy: P, delivered: ids(90), responses: ids(90).slice(0, 45).map(itemId => ({ itemId, isCorrect: true })) })
const s2 = buildLedger({ policy: P, delivered: ids(90), responses: ids(90).slice(0, 90).map(itemId => ({ itemId, isCorrect: true })) })
const both = combineLedgers([s1, s2])!
ok('combined: 135/180 by counts (75%), completion 75%', both.correct === 135 && both.scoreable === 180 && both.paperScore === 0.75 && both.completion === 0.75, both)
ok('mixed policies are never blended', combineLedgers([s1, buildLedger({ policy: '1.0', delivered: ids(2), responses: [] })]) === null)
ok('only the two real policies are supported; an unknown version is not read as legacy (a missing one is legacy)', isSupportedPolicy('1.0') && isSupportedPolicy(PAPER_SCORE_POLICY) && isSupportedPolicy(null) && !isSupportedPolicy('paper-score.9'))

// recap/card ledger from counts: the eight-item form that loses one voided item keeps delivered 8, scoreable 7, omissions, and its policy label
const rc = ledgerFromCounts({ policy: P, delivered: 8, voided: 1, correct: 1, answered: 1 })
ok('counts ledger: 8 delivered, 1 voided → 1 of 7 scoreable, 6 omitted; paper score 14%, answered accuracy 100%', rc.delivered === 8 && rc.scoreable === 7 && rc.omitted === 6 && Math.round(rc.paperScore! * 100) === 14 && rc.answeredAccuracy === 1 && rc.completion === 1 / 7, rc)
const rl = ledgerFromCounts({ policy: '1.0', delivered: 8, voided: 1, correct: 2, answered: 2 })
ok('counts ledger, legacy: score stays answered-only (100%) while factual scoreable is 7 and omissions 5', rl.paperScore === 1 && rl.scoreable === 7 && rl.omitted === 5 && rl.policy === '1.0', rl)
const same = buildLedger({ policy: P, delivered: ids(8), responses: [{ itemId: 'q1', isCorrect: true }], voided: ['q8'] })
ok('counts ledger agrees with the per-item ledger', same.scoreable === rc.scoreable && same.omitted === rc.omitted && same.paperScore === rc.paperScore && same.completion === rc.completion, [same, rc])
ok('no denominator is null, never zero', ledgerFromCounts({ policy: P, delivered: 3, voided: 3, correct: 0, answered: 0 }).paperScore === null)

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
