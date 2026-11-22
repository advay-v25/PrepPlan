/**
 * Weekly adaptation, pure (fixed data, no clock, no database):
 *  - closed-cycle observations: unknown is not missed, partial earns only confirmed scope, empty has no ratio,
 *    removal/deferral never shrink the baseline, splits conserve effort, extra learning stays outside the baseline;
 *  - the envelope: honest default, one unusual week, repeated overload, strong delivery (optional extra), break, lighter;
 *  - ahead/behind reconciliation (FSA and Corporate Finance).
 *   npx tsx scripts/pulse-envelope-test.ts
 */
import { observeCycle, type ObsBlock, type ObsInput, type CycleObservation } from '../src/lib/planning/cycleObservation'
import { ADAPTATION, adaptEnvelope, computeWeeklyEnvelope } from '../src/lib/planning/pulse/envelope'
import { reconcileProgress } from '../src/lib/curriculum/aheadBehind'
import { observedPaceFrom } from '../src/lib/curriculum/observedPace'
import { buildRoadmap, type ModuleInput } from '../src/lib/curriculum/roadmap'
import { EDGES, MODULES, TOPICS } from '../src/lib/curriculum/catalogue'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.005

let n = 0
const blk = (o: Partial<ObsBlock> = {}): ObsBlock => ({ id: `t${++n}`, taskType: 'study', execution: 'completed', cancelled: false, priority: 'core', durationMinutes: 60,
  createdBy: 'algorithm', scopeGroupId: null, continuedFromId: null, learningActivityId: null, isProtected: false, lmId: 'lm1', outcomeId: null, ...o })
const cycle = (blocks: ObsBlock[], o: Partial<ObsInput> = {}) => observeCycle({ cycleId: `c${++n}`, startsAt: '2026-10-05', endsAt: '2026-10-11', reviewed: true, blocks,
  unknownTaskIds: [], confirmedOutcomes: new Map(), totalOutcomesOf: () => null, ...o })

console.log('\nClosed-cycle observations')
const done = cycle([blk(), blk(), blk({ execution: 'skipped' }), blk({ execution: 'deferred' })])
check('execution is the proven share of accepted minutes', near(done.executionLow, 0.5) && near(done.executionHigh, 0.5) && done.quality === 'usable', JSON.stringify(done))
const unk = blk({ execution: 'not_started' })
const unknownCycle = cycle([blk(), blk(), unk, blk({ execution: 'skipped' })], { unknownTaskIds: [unk.id] })
check('unknown activity is not counted as missed: a range, labelled incomplete', near(unknownCycle.executionLow, 0.5) && near(unknownCycle.executionHigh, 0.75) && unknownCycle.quality === 'incomplete' && unknownCycle.counts.missed === 1 && unknownCycle.counts.unresolved === 1)
const empty = cycle([blk({ taskType: 'diagnostic' }), blk({ isProtected: true })])
check('an empty cycle has no ratio and is not a failure', empty.quality === 'empty' && empty.executionLow === null && empty.baselineMinutes === 0)
const p1 = blk({ execution: 'partial' })
const partialUnknown = cycle([p1, blk()], {})
check('partial work with no confirmed scope gets no invented percentage (not 50%)', near(partialUnknown.executionLow, 0.5) && near(partialUnknown.executionHigh, 1) && partialUnknown.quality === 'incomplete')
const p2 = blk({ execution: 'partial', durationMinutes: 80 })
const partialKnown = cycle([p2, blk({ durationMinutes: 20 })], { confirmedOutcomes: new Map([[p2.id, 1]]), totalOutcomesOf: () => 4 })
check('partial work earns exactly its confirmed outcomes (1 of 4 of 80 min = 20 min)', near(partialKnown.executionLow, 0.4) && near(partialKnown.executionHigh, 0.4) && partialKnown.quality === 'usable')
const removed = cycle([blk(), blk({ cancelled: true }), blk({ execution: 'skipped' })])
check('removed work stays in the baseline, so it cannot make the plan look complete', near(removed.executionLow, 1 / 3) && removed.counts.removed === 1)
const deferred = cycle([blk({ execution: 'deferred' }), blk({ execution: 'deferred' })])
check('deferring everything leaves nothing proven done', near(deferred.executionLow, 0))
const sA = blk({ scopeGroupId: 'g1', durationMinutes: 40 }), sB = blk({ scopeGroupId: 'g1', createdBy: 'student', durationMinutes: 20, execution: 'deferred' })
const split = cycle([sA, sB])
check('a split divides accepted work and creates no extra effort (40 + 20 = 60 baseline)', split.baselineMinutes === 60 && near(split.executionLow, 40 / 60))
const edited = cycle([blk({ durationMinutes: 30, originalMinutes: 60 })])
check('the original accepted duration is the baseline, not a later shortened one', edited.baselineMinutes === 60)
const extra = cycle([blk(), blk({ learningActivityId: 'a1', durationMinutes: 90 }), blk({ createdBy: 'student', durationMinutes: 45 }), blk({ priority: 'optional', execution: 'not_started', durationMinutes: 30 })])
check('extra learning, student-added work and an unfinished optional item never change original-plan performance', extra.baselineMinutes === 60 && near(extra.executionLow, 1) && extra.extra.count === 2 && extra.extra.minutes === 135)
const unreviewed = cycle([blk()], { reviewed: false })
check('a cycle never closed through the review is not settled', unreviewed.quality === 'incomplete')
const contA = blk({ execution: 'partial', durationMinutes: 60 })
const contB = blk({ createdBy: 'student', continuedFromId: contA.id, durationMinutes: 30 })
const next = cycle([contB])
check('a continuation is accepted work in the cycle that took it; the earlier cycle keeps its own record', next.baselineMinutes === 30 && near(next.executionLow, 1) && cycle([contA]).baselineMinutes === 60)

console.log('\nThe weekly adaptation')
const obs = (...lows: (number | 'empty' | 'inc')[]): CycleObservation[] => lows.map((l, i) => ({ cycleId: `x${i}`, startsAt: '', endsAt: '', reasons: l === 'inc' ? ['two tasks were never confirmed'] : [],
  quality: l === 'empty' ? 'empty' : l === 'inc' ? 'incomplete' : 'usable', baselineMinutes: l === 'empty' ? 0 : 300, counts: { completed: 0, partial: 0, missed: 0, deferred: 0, removed: 0, unresolved: 0 },
  executionLow: typeof l === 'number' ? l : null, executionHigh: typeof l === 'number' ? l : null, extra: { count: 0, minutes: 0 } }))
const ad = (o: CycleObservation[], extraIn: { afterBreak?: boolean; lighter?: boolean } = {}) => adaptEnvelope({ observations: o, afterBreak: false, ...extraIn })

const none = ad([])
check('no closed cycles: the honest default, labelled', none.mode === 'opening' && none.factor === ADAPTATION.opening && /No finished week/.test(none.reasons[0]))
const one = ad(obs(0.1))
check('one disrupted week: a cautious small step, never a permanent judgment', one.mode === 'cautious_lighter' && one.factor >= ADAPTATION.floor && one.factor > 0.45 && one.factor < ADAPTATION.opening && /not a trend/.test(one.reasons[0]))
check('one strong week is also only a small step up', ad(obs(0.95)).mode === 'cautious_stronger' && ad(obs(0.95)).factor <= ADAPTATION.opening + ADAPTATION.singleWeekStep + 1e-9)
const over = ad(obs(0.3, 0.35, 0.25))
check('repeated overload gives a lighter proposal', over.mode === 'lighter' && over.factor < ad(obs(0.8, 0.8)).factor && over.factor < ADAPTATION.opening)
const recovered = ad(obs(0.9, 0.2, 0.25))
check('one unusual strong week among weak ones is damped, not trusted', recovered.factor <= 0.85 && recovered.reasons.some(r => /counts for less/.test(r)))
const strong = ad(obs(0.95, 0.92))
check('strong delivery: committed work stays at the even split and the rest is optional extra', strong.mode === 'stronger' && strong.factor === 1.15 && strong.committed === 1)
const e = computeWeeklyEnvelope({ phaseRemainingEffort: 40, usableWeeksRemainingInPhase: 8, adaptation: strong })
check('the envelope divides first, then scales (5 × 1.15 total, 5 committed)', Math.abs(e.total - 5.75) < 1e-9 && e.committed === 5)
check('never divides by zero weeks', Math.abs(computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 0, adaptation: none }).total - 20 * 0.6) < 1e-9)
const unreadable = ad(obs('inc', 'inc'))
check('incomplete reporting: default load, and the explanation says what was set aside and why', unreadable.mode === 'opening' && unreadable.setAside.length === 2 && unreadable.reasons.some(r => /set aside.*never confirmed/.test(r)))
check('an empty week is set aside, not read as failure', ad(obs('empty', 0.9, 0.9)).mode === 'stronger' && ad(obs('empty', 0.9, 0.9)).setAside[0].why.includes('no accepted study work'))
const brk = ad(obs(0.95, 0.95), { afterBreak: true })
check('after a break: a manageable restart whatever the older weeks were', brk.mode === 'restart' && brk.factor === ADAPTATION.restart && brk.committed <= 0.6)
const light = ad(obs(0.8, 0.8), { lighter: true })
check('"lighter" reduces the proposal, within its own floor, and drops optional extra', light.factor < ad(obs(0.8, 0.8)).factor && light.factor >= ADAPTATION.lighterFloor && ad(obs(0.95, 0.95), { lighter: true }).factor <= 0.75 + 1e-9)
check('every explanation says it is an assumption, not understanding', [none, one, over, strong, brk, light].every(a => a.reasons.some(r => /planning assumption.*understand/.test(r))))
check('only the latest readable weeks are read', ad(obs(0.9, 0.9, 0.9, 0.1, 0.1, 0.1)).usedCycles === ADAPTATION.window)

console.log('\nObserved pace is unchanged and is not fed by these signals')
const pb = (id: string, lm: string, execution = 'completed', continuedFromId: string | null = null) => ({ id, lmId: lm, execution, cancelled: false, continuedFromId })
const effort = new Map(['a', 'b', 'c', 'd'].map(k => [k, 2]))
const covered = new Set(['a', 'b', 'c', 'd'])
const four = observedPaceFrom([pb('1', 'a'), pb('2', 'b'), pb('3', 'c'), pb('4', 'd')], ['1', '2', '3', '4'].map(t => ({ taskId: t, actualMinutes: 60 })), effort, covered)
check('four eligible modules: 60 minutes per 2 units = 30', four.minutesPerEffortUnit === 30 && four.modules === 4)
check('three modules is not enough: no observed pace', observedPaceFrom([pb('1', 'a'), pb('2', 'b'), pb('3', 'c')], ['1', '2', '3'].map(t => ({ taskId: t, actualMinutes: 60 })), effort, covered).minutesPerEffortUnit === null)
const chain = observedPaceFrom([pb('1', 'a', 'partial'), pb('1b', 'a', 'completed', '1'), pb('2', 'b'), pb('3', 'c'), pb('4', 'd')],
  [{ taskId: '1', actualMinutes: 20 }, { taskId: '1b', actualMinutes: 25 }, ...['2', '3', '4'].map(t => ({ taskId: t, actualMinutes: 45 }))], effort, covered)
check('a continuation chain counts 20 + 25 = 45 minutes once, and the module effort once', chain.minutesPerEffortUnit === Math.round(180 / 8) && chain.modules === 4)
check('unknown time disqualifies the module', observedPaceFrom([pb('1', 'a'), pb('2', 'b'), pb('3', 'c'), pb('4', 'd')], ['2', '3', '4'].map(t => ({ taskId: t, actualMinutes: 60 })), effort, covered).minutesPerEffortUnit === null)

console.log('\nAhead of plan: FSA and Corporate Finance')
const prerequisites = EDGES.filter(x => x.kind === 'prerequisite').map(x => ({ from: x.from, to: x.to }))
const topics = TOPICS.map(t => ({ id: t.id, name: t.name, weightMin: t.weightMin, weightMax: t.weightMax, sequence: t.sequence }))
const mods = (done: Set<string>): ModuleInput[] => MODULES.map(m => ({ id: m.id, topic: m.topic, name: m.name, effortBand: m.effortBand, difficulty: m.difficulty, sequence: m.sequence, coverage: done.has(m.id) ? 'studied' : 'not_started' }))
const road = buildRoadmap({ startDate: '2026-09-07', targetDate: '2027-05-30', topics, modules: mods(new Set()), prerequisites, route: 'self_study' })
const fp = road.milestones.filter(m => m.phase === 'first_pass')
const fsa = fp.find(m => /financial statement/i.test(m.topicName))!
const cf = fp.find(m => /corporate/i.test(m.topicName))!
const earlier = new Set(fp.filter(m => m.endWeek < fsa.endWeek - 1 && m !== fsa && m.startWeek < fsa.startWeek).flatMap(m => m.moduleIds))   // everything scheduled before FSA is done
check('the plan schedules FSA before Corporate Finance, over several weeks', !!fsa && !!cf && fsa.endWeek - fsa.startWeek >= 1 && cf.startWeek > fsa.startWeek, `${fsa?.topicName} ${fsa?.startWeek}-${fsa?.endWeek}; ${cf?.topicName} ${cf?.startWeek}-${cf?.endWeek}`)
const week = fsa.endWeek - 1   // inside FSA's stretch; Corporate Finance has not opened
const finished = new Set([...earlier, ...fsa.moduleIds, ...cf.moduleIds])
const plan = fp.map(m => ({ topicId: m.topicId, topicName: m.topicName, startWeek: m.startWeek, endWeek: m.endWeek }))
const none0 = reconcileProgress({ plan, modules: mods(earlier), weekNumber: week, minutesPerEffortUnit: 85 })
const aheadR = reconcileProgress({ plan, modules: mods(finished), weekNumber: week, minutesPerEffortUnit: 85 })
check('nothing is "ahead" before anything is done', none0.ahead.length === 0 && none0.summary === null)
check('Corporate Finance covered before its weeks opened is ahead; FSA, done in its own stretch, is on schedule', aheadR.ahead.length === cf.moduleIds.length && aheadR.ahead.every(a => cf.moduleIds.includes(a.id)) && aheadR.ahead[0].plannedWeeks === `weeks ${cf.startWeek}–${cf.endWeek}` && aheadR.behind.length === 0)
check('the corresponding first-pass work no longer remains, and the numbers add up', aheadR.firstPassMinutesRemoved > 0 && aheadR.firstPassMinutesRemaining + aheadR.firstPassMinutesRemoved <= none0.firstPassMinutesRemaining + 1 && aheadR.firstPassMinutesRemaining < none0.firstPassMinutesRemaining)
check('the summary preserves history and requires review', /maintenance revision stays/.test(aheadR.summary ?? '') && /review any change before it is saved/.test(aheadR.summary ?? ''))
const unfinished = reconcileProgress({ plan, modules: mods(new Set([...earlier, ...fsa.moduleIds.slice(0, -1)])), weekNumber: fsa.endWeek + 1, minutesPerEffortUnit: 85 })
check('unfinished FSA past its weeks continues the remainder and is not reset', unfinished.behind.length === 1 && /continues; finished work is not redone/.test(unfinished.summary ?? ''))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
