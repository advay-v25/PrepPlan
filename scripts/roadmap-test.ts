/**
 * C3 exit test and roadmap model tests.
 *
 * The phase's stated bar: "a nine-month self-study case completes first-pass
 * scope within seven months and protects the last eight weeks."
 */
import {
  FINAL_PHASE_WEEKS, buildPhases, buildRoadmap, currentMilestone, currentPhase,
  remainingEffort, sequenceModules, type ModuleInput, type RoadmapInput,
} from '../src/lib/curriculum/roadmap'
import { EDGES, MODULES, TOPICS } from '../src/lib/curriculum/catalogue'
import { addDays, daysBetween } from '../src/lib/planning/studyWeek'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

const prerequisites = EDGES.filter(e => e.kind === 'prerequisite').map(e => ({ from: e.from, to: e.to }))
const topics = TOPICS.map(t => ({ id: t.id, name: t.name, weightMin: t.weightMin, weightMax: t.weightMax, sequence: t.sequence }))
const modules = (coverage: ModuleInput['coverage'] = 'not_started'): ModuleInput[] =>
  MODULES.map(m => ({ id: m.id, topic: m.topic, name: m.name, effortBand: m.effortBand, difficulty: m.difficulty, sequence: m.sequence, coverage }))

const START = '2026-09-07'
const base = (overrides: Partial<RoadmapInput> = {}): RoadmapInput => ({
  startDate: START,
  targetDate: addDays(START, 273), // ~9 months
  topics, modules: modules(), prerequisites, route: 'self_study',
  ...overrides,
})

// ---------------------------------------------------------------------------
console.log('\nSequencing respects prerequisites')
const order = sequenceModules(modules(), prerequisites, topics)
eq('every module is placed exactly once', order.length, MODULES.length)
eq('no duplicates', new Set(order).size, MODULES.length)

const position = new Map(order.map((id, i) => [id, i]))
const violations = prerequisites.filter(e => (position.get(e.from) ?? -1) > (position.get(e.to) ?? -1))
check('no module precedes its prerequisite', violations.length === 0,
  violations.slice(0, 4).map(v => `${v.from} after ${v.to}`).join('; '))

// A cycle must not hang the sequencer.
const cyclic = [...prerequisites, { from: 'fsa-ratios', to: 'fsa-intro' }]
const cyclicOrder = sequenceModules(modules(), cyclic, topics)
eq('a cyclic graph still returns every module', cyclicOrder.length, MODULES.length)

check('quantitative time value comes before bond pricing',
  position.get('quant-rates')! < position.get('fi-pricing')!)
check('FSA framework comes before the income statement',
  position.get('fsa-intro')! < position.get('fsa-income')!)
check('duration comes before convexity',
  position.get('fi-duration')! < position.get('fi-convexity')!)

// ---------------------------------------------------------------------------
console.log('\nPhases')
const ninety = buildPhases(START, addDays(START, 273))
const names = ninety.phases.map(p => p.phase)
eq('a nine-month horizon gets all four phases', names, ['first_pass', 'consolidation', 'revision', 'final'])
check('phases are contiguous', ninety.phases.every((p, i) => i === 0 || p.startWeek === ninety.phases[i - 1].endWeek + 1),
  JSON.stringify(ninety.phases.map(p => [p.startWeek, p.endWeek])))
const finalPhase = ninety.phases.find(p => p.phase === 'final')!
eq('the final phase is exactly eight weeks', finalPhase.weeks, FINAL_PHASE_WEEKS)
check('and it runs up to the exam', daysBetween(finalPhase.endDate, addDays(START, 273)) <= 7,
  `ends ${finalPhase.endDate}, exam ${addDays(START, 273)}`)

// ---------------------------------------------------------------------------
console.log('\nC3 exit test: nine months, self-study')
const nine = buildRoadmap(base())
const fp = nine.phases.find(p => p.phase === 'first_pass')!
const finalSpan = nine.phases.find(p => p.phase === 'final')!

const firstPassDays = daysBetween(nine.startDate, fp.endDate)
const sevenMonthsDays = 213 // 7 months
check('the first pass finishes within seven months', firstPassDays <= sevenMonthsDays,
  `first pass ends ${fp.endDate}, ${firstPassDays} days in`)
eq('the last eight weeks are reserved', finalSpan.weeks, FINAL_PHASE_WEEKS)
check('nothing is planned into the final phase',
  nine.milestones.every(m => m.endWeek < finalSpan.startWeek),
  nine.milestones.filter(m => m.endWeek >= finalSpan.startWeek).map(m => m.topicName).join(', '))
check('every topic appears in the plan',
  new Set(nine.milestones.map(m => m.topicId)).size === TOPICS.length,
  `${new Set(nine.milestones.map(m => m.topicId)).size} of ${TOPICS.length}`)
check('every module is covered by a milestone',
  new Set(nine.milestones.flatMap(m => m.moduleIds)).size === MODULES.length)
check('first-pass milestones stay inside the first pass',
  nine.milestones.filter(m => m.phase === 'first_pass').every(m => m.endWeek <= fp.endWeek))
check('consolidation and revision get real milestones, not an empty band',
  nine.milestones.some(m => m.phase === 'consolidation') && nine.milestones.some(m => m.phase === 'revision'),
  nine.milestones.map(m => m.phase).join(','))
check('revisiting adds no new scope to the plan',
  nine.milestones.filter(m => m.phase !== 'first_pass').every(m => m.effortWeight === 0))
check('the heaviest topic is revisited in consolidation',
  nine.milestones.some(m => m.phase === 'consolidation' && m.topicId === 'eth'),
  nine.milestones.filter(m => m.phase === 'consolidation').map(m => m.topicId).join(','))
check('Ethics is studied first, not left to the end',
  (nine.milestones.find(m => m.phase === 'first_pass')?.topicId) === 'eth',
  nine.milestones.find(m => m.phase === 'first_pass')?.topicId)
check('milestones are in sequence order',
  nine.milestones.every((m, i) => i === 0 || m.startWeek >= nine.milestones[i - 1].startWeek))
check('the roadmap is not marked compressed', nine.compressed === false)

// ---------------------------------------------------------------------------
console.log('\nHorizons')
for (const [label, days, expectFirstPass] of [
  ['12 months', 365, true],
  ['9 months', 273, true],
  ['6 months', 182, true],
  ['3 months', 91, true],
  ['10 weeks', 70, true],
  ['8 weeks', 56, false],
  ['4 weeks', 28, false],
] as const) {
  const r = buildRoadmap(base({ targetDate: addDays(START, days) }))
  const hasFirstPass = r.phases.some(p => p.phase === 'first_pass')
  check(`${label}: ${expectFirstPass ? 'plans a first pass' : 'goes straight to final preparation'}`,
    hasFirstPass === expectFirstPass, `phases: ${r.phases.map(p => p.phase).join(' → ')}`)

  if (expectFirstPass) {
    const f = r.phases.find(p => p.phase === 'final')!
    eq(`${label}: final phase still eight weeks`, f.weeks, FINAL_PHASE_WEEKS)
    check(`${label}: first pass leaves room after it`,
      r.phases.find(p => p.phase === 'first_pass')!.endWeek < f.startWeek)
  } else {
    check(`${label}: is flagged as compressed`, r.compressed === true)
    check(`${label}: says so plainly`, r.feasibility.verdict === 'not_enough_time')
    check(`${label}: offers a way forward`, r.feasibility.options.length > 0)
  }
}

// A longer horizon must give more, not less, to consolidation and revision.
const twelve = buildRoadmap(base({ targetDate: addDays(START, 365) }))
const consolidationOf = (r: typeof twelve) => r.phases.filter(p => p.phase === 'consolidation' || p.phase === 'revision').reduce((s, p) => s + p.weeks, 0)
check('more time means more consolidation and revision, not a longer first pass',
  consolidationOf(twelve) > consolidationOf(nine),
  `12mo: ${consolidationOf(twelve)}w, 9mo: ${consolidationOf(nine)}w`)

// ---------------------------------------------------------------------------
console.log('\nWork already done is not re-planned')
const partly = modules()
for (const m of partly) if (m.topic === 'quant' || m.topic === 'econ') m.coverage = 'verified'
const withProgress = buildRoadmap(base({ modules: partly }))
const quantMilestone = withProgress.milestones.find(m => m.topicId === 'quant')
check('a completed topic still appears', Boolean(quantMilestone))
check('but carries no remaining effort', (quantMilestone?.effortWeight ?? 1) === 0,
  `weight ${quantMilestone?.effortWeight}`)
check('and its modules are marked complete',
  quantMilestone?.completedModuleIds.length === quantMilestone?.moduleIds.length)

const fresh = buildRoadmap(base())
const fsaFresh = fresh.milestones.find(m => m.topicId === 'fsa')!
const fsaAfter = withProgress.milestones.find(m => m.topicId === 'fsa')!
check('remaining topics start earlier once work is done',
  fsaAfter.startWeek <= fsaFresh.startWeek,
  `${fsaAfter.startWeek} vs ${fsaFresh.startWeek}`)

eq('a fully verified module needs no further effort',
  remainingEffort({ id: 'x', topic: 't', name: 'x', effortBand: 4, difficulty: 3, sequence: 1, coverage: 'verified' }), 0)
check('a taught-but-unverified module still needs work',
  remainingEffort({ id: 'x', topic: 't', name: 'x', effortBand: 4, difficulty: 3, sequence: 1, coverage: 'taught' }) > 0)
check('decaying knowledge needs more work than studied',
  remainingEffort({ id: 'x', topic: 't', name: 'x', effortBand: 4, difficulty: 3, sequence: 1, coverage: 'decaying' }) >
  remainingEffort({ id: 'x', topic: 't', name: 'x', effortBand: 4, difficulty: 3, sequence: 1, coverage: 'studied' }))
check('a harder module of the same size takes longer',
  remainingEffort({ id: 'x', topic: 't', name: 'x', effortBand: 3, difficulty: 5, sequence: 1, coverage: 'not_started' }) >
  remainingEffort({ id: 'y', topic: 't', name: 'y', effortBand: 3, difficulty: 1, sequence: 1, coverage: 'not_started' }))

// ---------------------------------------------------------------------------
console.log('\nFeasibility')
const unknown = buildRoadmap(base())
eq('with no capacity data the verdict is unknown, not invented', unknown.feasibility.verdict, 'unknown')
check('and it says what is missing', unknown.feasibility.message.includes('study windows'))

const roomy = buildRoadmap(base({ weeklyCapacityMinutes: 900, observedMinutesPerEffortUnit: 30 }))
const tight = buildRoadmap(base({ weeklyCapacityMinutes: 420, observedMinutesPerEffortUnit: 60 }))
const impossible = buildRoadmap(base({ weeklyCapacityMinutes: 180, observedMinutesPerEffortUnit: 90 }))

check('plenty of time reads as comfortable', roomy.feasibility.verdict === 'comfortable', roomy.feasibility.verdict)
check('a squeeze reads as tight or worse', ['tight', 'not_enough_time'].includes(tight.feasibility.verdict), tight.feasibility.verdict)
check('an impossible plan says so', impossible.feasibility.verdict === 'not_enough_time', impossible.feasibility.verdict)
check('and offers concrete options', impossible.feasibility.options.length >= 2)
check('the high-pressure case offers practical choices and never instructs an hours target',
  !/\d+\s*hours?/i.test(impossible.feasibility.options.join(' ') + impossible.feasibility.message) &&
  !/does not fit/i.test(impossible.feasibility.message),
  impossible.feasibility.message)
check('every verdict is phrased as plan pressure, not a judgement of the student',
  [roomy, tight, impossible].every(r => /Plan pressure is (low|moderate|high)/.test(r.feasibility.message)))
check('no verdict ever claims hours per module',
  !JSON.stringify(roomy.milestones).includes('hours'))

// ---------------------------------------------------------------------------
console.log('\nOnly the near-term milestone feeds weekly planning')
const now = currentMilestone(nine, START)
check('there is a current milestone at the start', Boolean(now))
check('it is the first in sequence', now?.sequence === 1, `sequence ${now?.sequence}`)
const later = currentMilestone(nine, addDays(START, 60))
check('it advances as weeks pass', (later?.sequence ?? 0) > 1, `sequence ${later?.sequence}`)
const phaseNow = currentPhase(nine, START)
eq('the current phase at the start is the first pass', phaseNow?.phase, 'first_pass')
const phaseLate = currentPhase(nine, addDays(START, 266))
eq('and final preparation near the exam', phaseLate?.phase, 'final')

// ---------------------------------------------------------------------------
console.log('\nMilestones are ranges, not false exact dates')
check('every milestone spans at least one week', nine.milestones.every(m => m.endWeek >= m.startWeek))
check('every milestone has real dates', nine.milestones.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(m.endDate)))
check('dates agree with week numbers',
  nine.milestones.every(m => m.startDate === addDays(nine.startDate, (m.startWeek - 1) * 7)))
check('heavier topics get more weeks than lighter ones', (() => {
  const fsa = nine.milestones.find(m => m.topicId === 'fsa')
  const deriv = nine.milestones.find(m => m.topicId === 'deriv')
  if (!fsa || !deriv) return false
  return (fsa.endWeek - fsa.startWeek) >= (deriv.endWeek - deriv.startWeek)
})())

// ---------------------------------------------------------------------------
console.log('\nClass-led routes converge on the same post-class structure as self-study')

// Self-study ignores classesCompletedDate entirely — it has no class period to finish.
const selfStudyWithStrayDate = buildRoadmap(base({ classesCompletedDate: START }))
eq('self-study is unaffected by a stray classesCompletedDate',
  selfStudyWithStrayDate.phases.map(p => [p.phase, p.weeks]), nine.phases.map(p => [p.phase, p.weeks]))

// Class-led, classes still ongoing (no classesCompletedDate): first_pass still reserves its span (so
// currentPhase() resolves and the UI has a label) but gets no self-sequenced milestones — the class, not the
// planner, decides what is covered during that time.
const classLedOngoing = buildRoadmap(base({ route: 'coaching' }))
const ongoingFirstPass = classLedOngoing.phases.find(p => p.phase === 'first_pass')
check('an ongoing class-led route still reserves a first_pass span', Boolean(ongoingFirstPass))
check('but it carries no milestones of its own',
  classLedOngoing.milestones.every(m => m.phase !== 'first_pass'),
  classLedOngoing.milestones.filter(m => m.phase === 'first_pass').map(m => m.topicId).join(','))
check('consolidation and revision still get real milestones while classes run',
  classLedOngoing.milestones.some(m => m.phase === 'consolidation') && classLedOngoing.milestones.some(m => m.phase === 'revision'))

// Class-led, classes confirmed done: first_pass collapses to zero weeks (not even reserved), and the whole
// pre-final span goes to consolidation then revision — the same split self-study reaches after its own
// first pass, just starting from week 1 instead of after it.
const classLedDone = buildRoadmap(base({ route: 'coaching', classesCompletedDate: addDays(START, -7) }))
check('a finished class-led route has no first_pass phase at all',
  classLedDone.phases.every(p => p.phase !== 'first_pass'),
  classLedDone.phases.map(p => p.phase).join(','))
check('the whole pre-final span instead goes to consolidation and revision',
  classLedDone.phases.some(p => p.phase === 'consolidation') && classLedDone.phases.some(p => p.phase === 'revision'))
check('consolidation starts in week 1, same as self-study starting its first pass in week 1',
  classLedDone.phases.find(p => p.phase === 'consolidation')?.startWeek === 1,
  String(classLedDone.phases.find(p => p.phase === 'consolidation')?.startWeek))
check('every topic still appears in the plan once classes are done',
  new Set(classLedDone.milestones.map(m => m.topicId)).size === TOPICS.length)
check('feasibility is assessed over the pre-final span, not reported as zero usable weeks',
  classLedDone.feasibility.usableWeeks > 0, String(classLedDone.feasibility.usableWeeks))
check('a hybrid route behaves the same way once its classes are done',
  buildRoadmap(base({ route: 'hybrid', classesCompletedDate: addDays(START, -7) })).phases.every(p => p.phase !== 'first_pass'))

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
