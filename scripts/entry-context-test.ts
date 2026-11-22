/**
 * Adaptive entry: the pure planning behaviour, on fixed dates. Asserts what the plan covers and why, never task counts or wording.
 * The before-state is a captured record, docs/evidence/ENTRY-SCENARIOS-BEFORE-PHASE-B.md (the script that produced it was removed: it would now run today's planner).
 */
import { buildRoadmap, type ModuleInput, type RoadmapInput } from '../src/lib/curriculum/roadmap'
import { EMPTY_ENTRY, entryToken, uncertaintyForModule, type EntryContext } from '../src/lib/curriculum/entryContext'
import { allocateDay } from '../src/lib/planning/pulse/generateWeek'
import { selectRevision, type RevisionReading } from '../src/lib/curriculum/revisionQueue'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

// Six topics of three readings. Equal weights except Equity, so a priority order is visible when something raises it.
const topics = ['Ethics', 'Quant', 'Econ', 'FSA', 'Equity', 'Fixed Income'].map((name, i) => ({ id: `t${i}`, name, weightMin: i === 4 ? 20 : 10, weightMax: i === 4 ? 25 : 15, sequence: i }))
const mk = (cov: (t: number) => ModuleInput['coverage'], ctx: EntryContext = EMPTY_ENTRY): ModuleInput[] =>
  topics.flatMap((t, ti) => [0, 1, 2].map(k => {
    const m = { id: `m${ti}${k}`, topic: t.id, name: `${t.name} ${k + 1}`, effortBand: 3, difficulty: 3, sequence: ti * 3 + k, coverage: cov(ti) }
    return { ...m, uncertainty: uncertaintyForModule(ctx, m) }
  }))
const entryOf = (ctx: EntryContext) => ({ mockDate: ctx.mock?.date ?? null, mockKind: ctx.mock?.kind ?? null, token: entryToken(ctx) })
const base = { topics, prerequisites: [], route: 'self_study' as const, weeklyCapacityMinutes: 600, startDate: '2026-11-02' }
/** The shared revision queue over modules with no recorded activity (a student whose coverage is all self-reported). */
const NOW = new Date('2026-11-02T09:00:00Z')
const queueFor = (modules: ModuleInput[], limit = 3) => selectRevision({
  now: NOW, weekStart: '2026-11-02', phase: 'first_pass', limit,
  readings: modules.map((m): RevisionReading => ({ id: m.id, name: m.name, topic: m.topic, topicName: m.topic, coverage: m.coverage, uncertainty: m.uncertainty ?? null,
    outcomeActivity: [null, null, null], reportedCurrent: false, evidence: { repair: 0, verify: 0, maintain: 0, untested: 3, latestAt: null },
    scheduled: false, continuing: false, repairOverlap: false, history: { lastPlannedAt: null, lastDeclinedAt: null } })),
}).selected
const phase = (r: ReturnType<typeof buildRoadmap>, p: string) => r.phases.find(x => x.phase === p)
const firstPassTopics = (r: ReturnType<typeof buildRoadmap>) => new Set(r.milestones.filter(m => m.phase === 'first_pass').map(m => m.topicId))

console.log('\n1. Fresh candidate, nine months: the supported first pass is unchanged')
{
  const without = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: mk(() => 'not_started') })
  const ctx: EntryContext = { ...EMPTY_ENTRY, stage: 'starting_fresh' }
  const withEntry = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: mk(() => 'not_started', ctx), entry: entryOf(ctx) })
  check('a real first pass', phase(withEntry, 'first_pass')!.weeks >= 12)
  check('not compressed', !withEntry.compressed)
  check('phases are identical with and without the entry context', JSON.stringify(without.phases) === JSON.stringify(withEntry.phases))
  check('every topic still has first-pass work', firstPassTopics(withEntry).size === 6)
  check('nothing is assumed, flagged or warned about', withEntry.assumptions.length === 0 && withEntry.warnings.length === 0 && withEntry.checkpoints.length === 0)
}

console.log('\n2. Three subjects covered, uneven uncertainty: mandatory first pass shrinks; revision follows what was selected')
const ctx2: EntryContext = {
  ...EMPTY_ENTRY, stage: 'first_pass_underway',
  uncertainty: { t0: { level: 'most', lmIds: [] }, t1: { level: 'few', lmIds: [] }, t2: { level: 'none', lmIds: [] } },
}
const modules2 = mk(t => (t < 3 ? 'studied' : 'not_started'), ctx2)
const r2 = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: modules2, entry: entryOf(ctx2) })
{
  const fresh = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: mk(() => 'not_started') })
  check('the first pass is shorter than a fresh candidate\'s', phase(r2, 'first_pass')!.weeks < phase(fresh, 'first_pass')!.weeks)
  check('the first pass keeps a fresh candidate\'s pace (weeks scale with the work left)', phase(r2, 'first_pass')!.weeks === Math.ceil(phase(fresh, 'first_pass')!.weeks * 0.5))
  check('only the unfinished subjects have first-pass milestones', JSON.stringify([...firstPassTopics(r2)].sort()) === JSON.stringify(['t3', 't4', 't5']))
  check('the freed weeks go to consolidation and revision', phase(r2, 'consolidation')!.weeks + phase(r2, 'revision')!.weeks > phase(fresh, 'consolidation')!.weeks + phase(fresh, 'revision')!.weeks)
  const consolidation = r2.milestones.filter(m => m.phase === 'consolidation')
  check('a topic reported as mostly uncertain is revised first', consolidation[0]?.topicId === 't0' && consolidation[0]?.basis === 'reported_uncertainty')
  check('"nothing shaky" is not treated as uncertainty', !r2.milestones.some(m => m.topicId === 't2' && m.basis === 'reported_uncertainty'))
  check('broad answers are shown as planning assumptions, not hidden', r2.assumptions.some(a => /Quant/.test(a)) && !r2.assumptions.some(a => /Ethics:.*feels uncertain/.test(a)))

  // The week: first-pass work for the unfinished subjects plus revision for exactly what was selected.
  const byId = new Map(modules2.map(m => [m.id, m]))
  const picks = queueFor(modules2)
  const ids = picks.map(e => e.readingId)
  const targets = picks.map(e => byId.get(e.readingId)!)
  check('the places go to the uncertain topics\' readings first, ahead of "nothing shaky"', ids.length === 3 && ids.every(id => id.startsWith('m0') || id.startsWith('m1')))
  check('"most of this topic" leads, then the narrower answer', ids[0].startsWith('m0') && ids.some(id => id.startsWith('m1')))
  check('one subject cannot take every place while others are flagged', ids.filter(id => id.startsWith('m0')).length <= 2)
  const picked = { ...ctx2, uncertainty: { ...ctx2.uncertainty, t1: { level: 'several' as const, lmIds: ['m12'] } } }
  const pickedIds = queueFor(mk(t => (t < 3 ? 'studied' : 'not_started'), picked)).map(e => e.readingId)
  check('readings the student picked are the ones revised, not the topic\'s first readings', pickedIds.includes('m12') && !pickedIds.includes('m10') && !pickedIds.includes('m11'))
  const pending = modules2.filter(m => m.coverage === 'not_started' && ['t3', 't4'].includes(m.topic))
  const day = allocateDay({ capacityMinutes: 480, minutesPerEffortUnit: 85, repairs: [], unstableConcepts: [], pendingModules: pending, phase: 'first_pass', revisionTargets: targets, maxRevisionTasks: 3 })
  const types = new Set(day.portions.map(p => p.taskType))
  check('the day mixes new coverage with targeted revision', types.has('study') && types.has('review'))
  check('revision is capped for the week', day.portions.filter(p => p.taskType === 'review').length <= 3)
  check('with places to spare for flagged work, none goes to a "nothing shaky" topic', day.portions.filter(p => p.taskType === 'review').every(p => ['m0', 'm1'].some(x => p.lmId?.startsWith(x))))
  const review = day.portions.find(p => p.taskType === 'review')!
  check('the revision task names what to revisit, why, how, and what to log', !!review.title && !!review.learningObjective && /notes/i.test(review.suggestedApproach ?? '') && /Log/.test(review.completionMeaning ?? ''))
  check('revision is not a repair thread and carries no assessment scope', review.repairThreadId === null && !review.assessmentScope && review.priorityLane === 'consolidation')
  check('its provenance says it is self-reported', /self-reported/i.test(review.rationale ?? ''))
}

console.log('\n3. First pass complete, a mock in a month: no mandatory first pass; the mock shapes priorities')
{
  const ctx: EntryContext = { ...EMPTY_ENTRY, stage: 'revising_or_mocks', mock: { date: '2026-12-02', kind: 'provider_mock' } }
  const mods = mk(() => 'studied', ctx)
  const r = buildRoadmap({ ...base, targetDate: '2027-02-22', modules: mods, entry: entryOf(ctx) })
  const plain = buildRoadmap({ ...base, targetDate: '2027-02-22', modules: mk(() => 'studied', EMPTY_ENTRY), entry: entryOf({ ...EMPTY_ENTRY, stage: 'revising_or_mocks' }) })
  check('no first-pass weeks and no first-pass milestones', !phase(r, 'first_pass') && !r.milestones.some(m => m.phase === 'first_pass'))
  check('not treated as behind: not compressed, and the verdict is not "not enough time"', !r.compressed && r.feasibility.verdict === 'comfortable')
  check('the plan says nothing is left for a first pass', r.feasibility.remainingEffort === 0 && /No first-pass work/.test(r.feasibility.message))
  check('the mock is a dated checkpoint in week 5, not another exam date', r.checkpoints.length === 1 && r.checkpoints[0].week === 5 && r.targetDate === '2027-02-22')
  const order = (x: typeof r) => x.milestones.filter(m => m.phase === 'revision').map(m => m.topicName).join('|')
  check('with a mock the revision sweep starts with the highest-weighted topic', order(r).startsWith('Equity'))
  check('without a mock it stays in curriculum order', order(plain).startsWith('Ethics'))
  check('weeks before the mock are labelled as mock preparation', r.milestones.some(m => m.basis === 'mock_preparation' && m.startWeek <= 5))
  check('the exam stretch has focus weeks rather than an empty Calendar', r.milestones.filter(m => m.phase === 'final').length >= 6)
  check('a mock after the exam is ignored with a plain note', (() => { const x = buildRoadmap({ ...base, targetDate: '2027-02-22', modules: mods, entry: { ...entryOf(ctx), mockDate: '2027-03-01' } }); return x.checkpoints.length === 0 && x.warnings.length === 1 })())
  check('a mock that has passed is ignored with a plain note', (() => { const x = buildRoadmap({ ...base, targetDate: '2027-02-22', modules: mods, entry: { ...entryOf(ctx), mockDate: '2026-10-01' } }); return x.checkpoints.length === 0 && /passed/.test(x.warnings[0] ?? '') })())
  check('a very close mock produces a calm note and does not block planning', (() => { const x = buildRoadmap({ ...base, targetDate: '2027-02-22', modules: mods, entry: { ...entryOf(ctx), mockDate: '2026-11-06' } }); return x.checkpoints.length === 1 && /promises/.test(x.warnings[0] ?? '') })())
}

console.log('\n   Short horizon, first pass complete: prioritisation, not a verdict on the candidate')
{
  const ctx: EntryContext = { ...EMPTY_ENTRY, stage: 'revising_or_mocks', uncertainty: { t3: { level: 'most', lmIds: [] } } }
  const mods = mk(() => 'studied', ctx)
  const r = buildRoadmap({ ...base, targetDate: '2026-11-23', modules: mods, entry: entryOf(ctx) })
  check('compressed to final preparation', r.compressed && r.phases.length === 1 && r.phases[0].phase === 'final')
  check('the verdict is moderate pressure with choices, not "not enough time"', r.feasibility.verdict === 'tight' && r.feasibility.options.length > 0 && !/not realistic/.test(r.feasibility.message))
  check('it does not promise readiness', /guarantee/i.test(r.feasibility.message))
  check('the flagged topic leads the final weeks', r.milestones.find(m => m.phase === 'final')?.topicId === 't3')
  const day = allocateDay({ capacityMinutes: 240, minutesPerEffortUnit: 85, repairs: [], unstableConcepts: [], pendingModules: mods.filter(m => m.topic === 't3'), phase: 'final', maxRevisionTasks: 4 })
  check('a final-stretch day with no repairs still has revision work, and no new first-pass study', day.portions.length > 0 && day.portions.every(p => p.taskType === 'review'))
  const unfinished = buildRoadmap({ ...base, targetDate: '2026-11-23', modules: mk(() => 'not_started') })
  check('an unfinished syllabus in the same horizon keeps the existing pressure message', unfinished.feasibility.verdict === 'not_enough_time')
}

console.log('\n4. A covered topic whose questions are not reviewed: planning does not consult the bank')
{
  const mod = mk(() => 'studied', { ...EMPTY_ENTRY, uncertainty: { t1: { level: 'most', lmIds: [] } } }).find(m => m.id === 'm10')!
  const day = allocateDay({ capacityMinutes: 120, minutesPerEffortUnit: 85, repairs: [], unstableConcepts: [], pendingModules: [], phase: 'revision', revisionTargets: [mod] })
  check('a revision task is still planned', day.portions.length === 1 && day.portions[0].taskType === 'review')
  check('it promises no assessment (no scope, no question count)', !day.portions[0].assessmentScope)
}

console.log('\n5. Class-led student: class timing stays authoritative')
{
  const ctx: EntryContext = { ...EMPTY_ENTRY, stage: 'first_pass_underway' }
  const mods = mk(t => (t < 3 ? 'studied' : 'not_started'), ctx)
  const running = buildRoadmap({ ...base, route: 'coaching', targetDate: '2027-08-02', modules: mods, entry: entryOf(ctx) })
  const fresh = buildRoadmap({ ...base, route: 'coaching', targetDate: '2027-08-02', modules: mk(() => 'not_started') })
  check('while classes run the planner does not self-sequence first-pass content', !running.milestones.some(m => m.phase === 'first_pass'))
  check('the class period keeps its full length whatever was claimed', phase(running, 'first_pass')!.weeks === phase(fresh, 'first_pass')!.weeks)
  const done = buildRoadmap({ ...base, route: 'coaching', classesCompletedDate: '2026-10-30', targetDate: '2027-08-02', modules: mods, entry: entryOf(ctx) })
  check('finishing classes is what ends the first pass, as before', !phase(done, 'first_pass'))
}

console.log('\n6. Existing student with none of the new fields')
{
  const m = { id: 'm00', topic: 't0' }
  check('no uncertainty is invented', uncertaintyForModule(EMPTY_ENTRY, m) === null)
  check('an explicit "nothing shaky" is not an invented concern', uncertaintyForModule({ ...EMPTY_ENTRY, uncertainty: { t0: { level: 'none', lmIds: [] } } }, m) === null)
  const a = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: mk(t => (t < 2 ? 'studied' : 'not_started')) })
  const b = buildRoadmap({ ...base, targetDate: '2027-08-02', modules: mk(t => (t < 2 ? 'studied' : 'not_started')), entry: entryOf(EMPTY_ENTRY) })
  check('an empty context plans exactly like no context (except the exam-stretch focus weeks)', JSON.stringify(a.phases) === JSON.stringify(b.phases) && JSON.stringify(a.milestones) === JSON.stringify(b.milestones.filter(x => x.phase !== 'final')))
  check('the change token is stable, and moves with each kind of edit', entryToken(EMPTY_ENTRY) === entryToken({ ...EMPTY_ENTRY })
    && entryToken(EMPTY_ENTRY) !== entryToken({ ...EMPTY_ENTRY, mock: { date: '2026-12-01', kind: 'other' } })
    && entryToken(EMPTY_ENTRY) !== entryToken({ ...EMPTY_ENTRY, uncertainty: { t0: { level: 'few', lmIds: [] } } })
    && entryToken({ ...EMPTY_ENTRY, uncertainty: { t0: { level: 'few', lmIds: [] } } }) !== entryToken({ ...EMPTY_ENTRY, uncertainty: { t0: { level: 'none', lmIds: [] } } }))
}

console.log('\n7. Ten topics, three covered: the other seven stay available for first-pass planning')
{
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, name: `Topic ${i + 1}`, weightMin: 8, weightMax: 12, sequence: i }))
  const mods = (covered: (t: number) => boolean): ModuleInput[] => ten.flatMap((t, ti) => [0, 1, 2].map(k => ({
    id: `x${ti}${k}`, topic: t.id, name: `${t.name} reading ${k + 1}`, effortBand: 3, difficulty: 3, sequence: ti * 3 + k, coverage: (covered(ti) ? 'studied' : 'not_started') as ModuleInput['coverage'],
  })))
  const tenBase = { ...base, topics: ten, targetDate: '2027-08-02' }
  const fresh = buildRoadmap({ ...tenBase, modules: mods(() => false) })
  const three = buildRoadmap({ ...tenBase, modules: mods(t => t < 3) })
  const idsOf = (r: ReturnType<typeof buildRoadmap>) => new Set(r.milestones.filter(m => m.phase === 'first_pass').flatMap(m => m.moduleIds))
  const planned = idsOf(three)
  check('exactly the seven uncovered topics are planned for the first pass', new Set([...planned].map(id => id.slice(0, 2))).size === 7 && [...planned].every(id => Number(id[1]) >= 3))
  check('every reading of those seven topics is available (21 of 21)', planned.size === 21)
  check('none of the three covered topics is in the mandatory first pass', ![...planned].some(id => Number(id[1]) < 3))
  check('the first pass shrinks in proportion to the work left (seven tenths), not to a third', phase(three, 'first_pass')!.weeks === Math.ceil(phase(fresh, 'first_pass')!.weeks * 0.7))
  const day = allocateDay({ capacityMinutes: 480, minutesPerEffortUnit: 85, repairs: [], unstableConcepts: [], pendingModules: mods(t => t < 3).filter(m => m.coverage === 'not_started'), phase: 'first_pass' })
  check('a day of first-pass study draws only from the seven', day.portions.length > 0 && day.portions.every(p => p.taskType === 'study' && Number(p.lmId![1]) >= 3))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
