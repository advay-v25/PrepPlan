/** Pure tests: result analysis, honest uncertainty, SWOT and repair priority. */
import { analyseAttempt, buildSwot, judge, prioritiseRepairs, wilson, type ItemMeta, type OutcomeStatus, type ReadingEdge, type RespRow } from '../src/lib/tests/resultAnalysis'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const R = (id: string, correct: boolean, level: RespRow['level'], o: Partial<RespRow> = {}): RespRow => ({ itemId: id, correct, level, activeSeconds: 60, interruptedSeconds: 0, changedCount: 0, flagged: false, ...o })
const M = (o: Partial<ItemMeta>): ItemMeta => ({ readingId: 'r1', subjectId: 'fsa', outcomeId: 'r1-a', conceptId: null, conceptName: null, difficulty: 'medium', form: 'mcq', cognition: 'application', errorCode: null, ...o })

console.log('\nHonest uncertainty\n')
check('the Wilson interval widens as the sample shrinks', wilson(3, 6)[1] - wilson(3, 6)[0] > wilson(30, 60)[1] - wilson(30, 60)[0])
check('fewer than four questions is "too few to judge", never weak', judge(0, 1).judgement === 'too_few' && judge(0, 3).judgement === 'too_few')
check('0 of 6 is weak; 6 of 6 is strong; a middling record is unclear', judge(0, 6).judgement === 'weak' && judge(6, 6).judgement === 'strong' && judge(3, 6).judgement === 'unclear')
check('certainty is labelled by sample size', judge(1, 2).certainty === 'very limited' && judge(3, 4).certainty === 'limited' && judge(5, 8).certainty === 'moderate')

console.log('\nWhat one attempt shows\n')
{
  const rows = [R('a', true, 'high'), R('b', false, 'high'), R('c', true, 'low'), R('d', false, 'low'), R('e', true, 'medium', { activeSeconds: 400 })]
  const meta = new Map([['a', M({})], ['b', M({ outcomeId: 'r1-b' })], ['c', M({ outcomeId: 'r1-c' })], ['d', M({ readingId: 'r2', subjectId: 'quant', outcomeId: 'r2-a' })], ['e', M({ outcomeId: 'r1-d' })]])
  const a = analyseAttempt(rows, meta)
  check('overall score and counts', a.overall.answered === 5 && a.overall.correct === 3 && a.overall.scorePercent === 60)
  check('confidence distribution with accuracy inside each level', a.overall.confidence.high.n === 2 && a.overall.confidence.high.correct === 1 && a.overall.confidence.low.n === 2 && a.overall.confidence.medium.n === 1)
  check('a correct guess is counted, not called mastery', a.patterns.correctGuesses === 1 && a.tagged.find(t => t.itemId === 'c')!.tags.includes('correct_guess'))
  check('a confident mistake is counted and tagged', a.patterns.confidentMistakes === 1 && a.tagged.find(t => t.itemId === 'b')!.tags.includes('confident_mistake'))
  check('a slow correct answer is flagged against its own type, not a flat 90 seconds', a.patterns.slowCorrect === 1 && a.tagged.find(t => t.itemId === 'e')!.tags.includes('slow_correct'))
  check('breakdowns by reading and subject carry counts', a.byReading.find(c => c.id === 'r1')!.questions === 4 && a.bySubject.find(c => c.id === 'quant')!.questions === 1)
  check('one wrong answer in a subject does NOT make it weak', a.bySubject.find(c => c.id === 'quant')!.judgement === 'too_few')
  check('the difficulty and form mix are reported per reading', a.byReading.find(c => c.id === 'r1')!.difficultyMix.medium === 4 && a.byReading.find(c => c.id === 'r1')!.formMix.mcq === 4 && a.byReading.find(c => c.id === 'r1')!.cognitionMix.application === 4)
}
{
  const rows = [R('a', false, 'high'), R('b', false, 'low'), R('c', false, 'high')]
  const meta = new Map([['a', M({ outcomeId: 'r1-a', errorCode: 'formula' })], ['b', M({ outcomeId: 'r1-a', errorCode: 'sign' })], ['c', M({ outcomeId: 'r1-b', errorCode: 'formula' })]])
  const a = analyseAttempt(rows, meta)
  check('missing the same outcome twice is a repeated misconception', a.tagged.filter(t => t.outcomeId === 'r1-a').every(t => t.tags.includes('repeated_misconception')))
  check('the same error type twice is also repeated', a.tagged.find(t => t.itemId === 'c')!.tags.includes('repeated_misconception'))
  check('error types are tallied, most common first', a.errorTypes[0].code === 'formula' && a.errorTypes[0].count === 2)
}
{
  const a = analyseAttempt([R('a', true, 'high', { activeSeconds: 30, interruptedSeconds: 200 })], new Map([['a', M({})]]))
  check('an interrupted question is labelled interrupted, not slow', !a.tagged[0].tags.includes('slow_correct') && a.tagged[0].tags.includes('interrupted'))
  const b = analyseAttempt([R('a', true, 'high', { changedCount: 2, flagged: true })], new Map([['a', M({})]]))
  check('changed answers and flags are counted', b.overall.changedAnswers === 1 && b.overall.flagged === 1)
  check('an empty attempt does not divide by zero', analyseAttempt([], new Map()).overall.scorePercent === null)
}

console.log('\nEvidence-led SWOT\n')
const O = (id: string, reading: string, verdict: OutcomeStatus['verdict'], askedHere: number, correctHere: number): OutcomeStatus =>
  ({ outcomeId: id, readingId: reading, subjectId: 'fsa', title: `Outcome ${id}`, verdict, band: 'x', askedHere, correctHere })
const edges: ReadingEdge[] = [
  { from: 'r1', to: 'r2', kind: 'prerequisite', basis: 'sequence' }, { from: 'r3', to: 'r4', kind: 'prerequisite', basis: 'concept_link' },
  { from: 'r3', to: 'r5', kind: 'prerequisite', basis: 'sequence' }, { from: 'r1', to: 'r6', kind: 'prerequisite', basis: 'concept_link' },
]
const name = (id: string) => `Reading ${id}`
{
  const s = buildSwot({ outcomes: [O('o1', 'r1', 'concept_miss', 2, 0), O('o2', 'r3', 'secure', 3, 3), O('o3', 'r7', 'unsettled', 1, 1), O('o4', 'r8', 'guess', 1, 1), O('o5', 'r9', 'known_gap', 1, 0)], edges, readingName: name })
  check('a repeated confident-and-correct outcome is a strength', s.strengths.some(x => x.outcomeId === 'o2'))
  check('a single correct answer is an observed success, NOT a strength', s.observedSuccesses.some(x => x.outcomeId === 'o3') && !s.strengths.some(x => x.outcomeId === 'o3'))
  check('a correct guess needs verifying and is not a strength', s.toVerify.some(x => x.outcomeId === 'o4') && !s.strengths.some(x => x.outcomeId === 'o4'))
  check('a confident miss and a known gap are weaknesses with their reasons', s.weaknesses.length === 2 && s.weaknesses.every(w => w.basis === 'evidence' && w.support.length > 10))
  check('threats are readings that build on a weakness, labelled inferred', s.threats.length > 0 && s.threats.every(t => t.basis === 'inferred' && !!t.readingId && !t.outcomeId))
  check('a threat says it was not tested here', s.threats.every(t => /not been tested|you have not been tested/i.test(t.support)))
  check('opportunities come from strengths, labelled inferred, and never assume competence', s.opportunities.length > 0 && s.opportunities.every(o => o.basis === 'inferred' && /not evidence that you already know/.test(o.support)))
  check('concept links rank above plain reading order', s.opportunities[0].readingId === 'r4')
  check('nothing tested = an empty SWOT, not an invented one', buildSwot({ outcomes: [O('x', 'r1', 'concept_miss', 0, 0)], edges, readingName: name }).weaknesses.length === 0)
  check('a reading with a weakness is never offered as an opportunity', !buildSwot({ outcomes: [O('a', 'r3', 'secure', 3, 3), O('b', 'r4', 'concept_miss', 2, 0)], edges, readingName: name }).opportunities.some(o => o.readingId === 'r4'))
}

console.log('\nRepair priority\n')
{
  const reps = prioritiseRepairs([
    { outcomeId: 'g', readingId: 'r1', title: 'Guess', verdict: 'guess', repeated: false, unseenAvailable: 5 },
    { outcomeId: 'k', readingId: 'r1', title: 'Gap', verdict: 'known_gap', repeated: false, unseenAvailable: 5 },
    { outcomeId: 'm', readingId: 'r1', title: 'Miss', verdict: 'concept_miss', repeated: false, unseenAvailable: 5 },
    { outcomeId: 'mr', readingId: 'r1', title: 'Repeated miss', verdict: 'concept_miss', repeated: true, unseenAvailable: 5 },
    { outcomeId: 's', readingId: 'r1', title: 'Fine', verdict: 'secure', repeated: false, unseenAvailable: 5 },
  ])
  check('confident misses come first, repeated ones before single ones, guesses last', reps.map(r => r.outcomeId).join() === 'mr,m,k,g')
  check('secure outcomes are never proposed for repair', !reps.some(r => r.outcomeId === 's'))
  check('priorities are numbered 1..n', reps.every((r, i) => r.priority === i + 1))
  check('every repair states its reason, method and an independent retest', reps.every(r => r.reason.length > 10 && r.method.length > 10 && r.retest.independent))
  const thin = prioritiseRepairs([{ outcomeId: 'm', readingId: 'r1', title: 'Miss', verdict: 'concept_miss', repeated: false, unseenAvailable: 0 }])[0]
  check('with no unseen question the re-check waits rather than reusing one', /waits/.test(thin.retest.note))
  const short = prioritiseRepairs([{ outcomeId: 'm', readingId: 'r1', title: 'Miss', verdict: 'concept_miss', repeated: false, unseenAvailable: 1 }])[0]
  check('with few unseen questions the re-check is honestly short', /short/.test(short.retest.note))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
