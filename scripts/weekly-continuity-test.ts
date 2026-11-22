import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectDueTasks, type ReviewBlock } from '../src/lib/planning/weeklyReview/dueTasks'
import { observedMinutesPerEffortUnitFrom, type PaceBlock, type PaceEvent } from '../src/lib/curriculum/observedPace'
import { remainingWindow } from '../src/lib/planning/pulse/capacity'
import { allocateDay, buildCommitRows, type GeneratedPortion } from '../src/lib/planning/pulse/generateWeek'
import { splitIntoSittings } from '../src/lib/planning/pulse/sittings'
import { resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'

const END = '2026-11-01'

test('new planning clips today to future local minutes and never recovers yesterday as free time', () => {
  const window = { start: '18:30', end: '21:30' }
  const now = new Date('2026-10-29T14:15:20Z') // 19:45:20 in India
  assert.equal(remainingWindow(window, '2026-10-28', 'Asia/Kolkata', now), null)
  assert.deepEqual(remainingWindow(window, '2026-10-29', 'Asia/Kolkata', now), { start: '19:46', end: '21:30' })
  assert.deepEqual(remainingWindow(window, '2026-10-30', 'Asia/Kolkata', now), window)
  assert.equal(remainingWindow(window, '2026-10-29', 'Asia/Kolkata', new Date('2026-10-29T16:00:00Z')), null)
})

test('remaining availability uses the student day across midnight, not the server calendar day', () => {
  const now = new Date('2026-10-29T20:00:00Z') // 01:30 on 30 October in India
  assert.equal(remainingWindow({ start: '18:00', end: '20:00' }, '2026-10-29', 'Asia/Kolkata', now), null)
  assert.deepEqual(remainingWindow({ start: '01:00', end: '03:00' }, '2026-10-30', 'Asia/Kolkata', now), { start: '01:30', end: '03:00' })
})

test('shorter sittings preserve the planned work, effort and guidance instead of truncating it', () => {
  const p: GeneratedPortion = { title: 'Study a reading', detail: 'Own material', taskType: 'study',
    effortUnits: 2, durationMinutes: 171, lmId: 'module', repairThreadId: null, priorityLane: 'content',
    learningObjective: 'Cover the next portion.', suggestedApproach: 'Use your own material.' }
  const parts = splitIntoSittings(p, 45)
  assert.equal(parts.length, 4)
  assert.equal(parts.reduce((n, s) => n + s.durationMinutes, 0), 171)
  assert.ok(Math.abs(parts.reduce((n, s) => n + s.effortUnits, 0) - 2) < 1e-9)
  assert.ok(parts.every(s => s.durationMinutes >= 5 && s.durationMinutes <= 45 && s.lmId === p.lmId))
  assert.ok(parts.every(s => s.suggestedApproach === p.suggestedApproach && s.completionMeaning?.includes('this sitting only')))
  assert.equal(p.durationMinutes, 171)
})

test('a small remainder is balanced into usable sittings and paper clocks are exempt', () => {
  const p: GeneratedPortion = { title: 'Repair', detail: '', taskType: 'repair', effortUnits: 0, durationMinutes: 46,
    lmId: null, repairThreadId: 'repair', priorityLane: 'repair' }
  assert.deepEqual(splitIntoSittings(p, 45).map(s => s.durationMinutes), [23, 23])
  const paper = { ...p, taskType: 'diagnostic', durationMinutes: 135 }
  assert.deepEqual(splitIntoSittings(paper, 45), [paper])
})

test('allocation respects the sitting limit for repair work even in the final phase', () => {
  const day = allocateDay({ capacityMinutes: 60, minutesPerEffortUnit: 85, maxSittingMinutes: 20,
    repairs: [{ id: 'repair', title: 'Repair a weak point', durationMinutes: 30 }], unstableConcepts: [], pendingModules: [], phase: 'final' })
  assert.deepEqual(day.portions.map(p => p.durationMinutes), [15, 15])
  assert.ok(day.portions.every(p => p.repairThreadId === 'repair'))
})

test('a same-day paper can remain untimed when its standard clock time has passed', async () => {
  const week = resolvePulseWeek({ classWeekdays: [], timezone: 'Asia/Kolkata', reference: '2026-11-01' })
  const p: GeneratedPortion = { title: 'Weekly paper', detail: '', taskType: 'diagnostic', effortUnits: 0,
    durationMinutes: 90, lmId: null, repairThreadId: null, priorityLane: 'content', dayPreferred: true }
  const rows = await buildCommitRows('owner', week, [{ date: '2026-11-01', weekday: 0, portions: [p] }])
  assert.equal(rows[0].placement, 'day_preferred')
  assert.equal(rows[0].starts_at, '')
  assert.equal(rows[0].duration_minutes, 90)
})
const blk = (id: string, extra: Partial<ReviewBlock> = {}): ReviewBlock => ({
  id, title: id, taskType: 'study', localDate: '2026-10-28', execution: 'not_started', durationMinutes: 45, cancelled: false, ...extra,
})

// --- Which tasks does the weekly review ask about? ---------------------------------------------------

test('an undated (unplaced) unfinished task is part of the review, not silently dropped', () => {
  const due = selectDueTasks([blk('floating', { localDate: null }), blk('dated')], END, null)
  assert.deepEqual(due.map(t => t.id).sort(), ['dated', 'floating'])
})

test('the unplaced sitting of a split task is asked about exactly once', () => {
  const due = selectDueTasks([blk('first', { execution: 'completed' }), blk('second', { localDate: null })], END, null)
  assert.deepEqual(due.map(t => t.id), ['second'])
})

test('partly done and earlier-deferred work is asked about; finished, skipped, cancelled, protected and the paper are not', () => {
  const due = selectDueTasks([
    blk('partial', { execution: 'partial' }), blk('done', { execution: 'completed' }), blk('skipped', { execution: 'skipped' }),
    blk('later', { execution: 'deferred' }), blk('gone', { cancelled: true }), blk('paper', { taskType: 'diagnostic' }),
    blk('class', { isProtected: true }),
  ], END, 'paper')
  assert.deepEqual(due.map(t => t.id).sort(), ['later', 'partial'])
})

test('placed work comes first in date order and unplaced work follows', () => {
  const due = selectDueTasks([blk('u', { localDate: null }), blk('b', { localDate: '2026-10-30' }), blk('a', { localDate: '2026-10-27' })], END, null)
  assert.deepEqual(due.map(t => t.id), ['a', 'b', 'u'])
})

// --- Observed study pace -----------------------------------------------------------------------------

const band = (n: number) => new Map(['m1', 'm2', 'm3', 'm4', 'm5'].map(id => [id, n]))
const done = (id: string, lmId: string): PaceBlock => ({ id, lmId, execution: 'completed', cancelled: false })
const mins = (taskId: string, actualMinutes: number | null): PaceEvent => ({ taskId, actualMinutes })
const covered = new Set(['m1', 'm2', 'm3', 'm4', 'm5'])
const fourModules = (minutes: number) => ({
  blocks: ['m1', 'm2', 'm3', 'm4'].map(m => done(`t-${m}`, m)),
  events: ['m1', 'm2', 'm3', 'm4'].map(m => mins(`t-${m}`, minutes)),
})

test('pace comes from reported minutes, never from the planned duration', () => {
  const { blocks } = fourModules(0)
  // Planned durations are not even an input; with nothing reported there is nothing to learn from.
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, [], band(3), covered), null)
})

test('four fully covered modules with reported time give minutes per effort unit', () => {
  const { blocks, events } = fourModules(90)
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, band(3), covered), 30)
})

test('a module split into two sittings counts its effort once, not twice', () => {
  const blocks = [...fourModules(0).blocks.slice(1), done('a', 'm1'), done('b', 'm1')]
  const events = [...fourModules(90).events.slice(1), mins('a', 40), mins('b', 50)]
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, band(3), covered), 30)
})

test('a module with an unfinished sitting is not an observation yet', () => {
  const { blocks, events } = fourModules(90)
  // Three finished modules plus a fourth with one sitting still open: only three real observations.
  const withOpen = [...blocks.slice(0, 3), done('t-m5', 'm5'), { id: 'open', lmId: 'm5', execution: 'not_started', cancelled: false }]
  assert.equal(observedMinutesPerEffortUnitFrom(withOpen, [...events.slice(0, 3), mins('t-m5', 90)], band(3), covered), null)
  // ...and once that sitting is done too, the fourth module counts.
  const finished = [...blocks.slice(0, 3), done('t-m5', 'm5'), done('open', 'm5')]
  assert.equal(observedMinutesPerEffortUnitFrom(finished, [...events.slice(0, 3), mins('t-m5', 45), mins('open', 45)], band(3), covered), 30)
})

test('a module not recorded as covered is not an observation, even if its block is complete', () => {
  const { blocks, events } = fourModules(90)
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, band(3), new Set(['m1', 'm2', 'm3'])), null)
})

test('unknown time stays unknown: a missing figure is skipped, not treated as zero', () => {
  const { blocks, events } = fourModules(90)
  const missing = [...events.slice(0, 3), mins('t-m4', null)]
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, missing, band(3), covered), null)
  // Add a fifth module and the pace is learned from the four that were reported.
  const five = observedMinutesPerEffortUnitFrom([...blocks, done('t-m5', 'm5')], [...missing, mins('t-m5', 90)], band(3), covered)
  assert.equal(five, 30)
})

test('time reported over several updates is added up for the same task', () => {
  const { blocks } = fourModules(0)
  const events = blocks.flatMap(b => [mins(b.id, 30), mins(b.id, 60)])
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, band(3), covered), 30)
})

test('cancelled blocks do not block or add to a module', () => {
  const { blocks, events } = fourModules(90)
  const withCancelled = [...blocks, { id: 'x', lmId: 'm1', execution: 'not_started', cancelled: true }]
  assert.equal(observedMinutesPerEffortUnitFrom(withCancelled, events, band(3), covered), 30)
})

// =====================================================================================================
// W1 — continuation tasks (Option B): history stays where it happened; logical work is counted once.
// =====================================================================================================
import { chainOf, terminalIds, reportedMinutesByChain } from '../src/lib/planning/taskLineage'
import { summarizeScopeGroups, type ScopePart } from '../src/lib/planning/taskScope'
import { resolveDispositions, type DispositionTask } from '../src/lib/planning/weeklyReview/dispositions'

test('a chain is walked oldest to newest and only its last occurrence is terminal', () => {
  const nodes = [{ id: 'a', continuedFromId: null }, { id: 'b', continuedFromId: 'a' }, { id: 'c', continuedFromId: 'b' }, { id: 'x', continuedFromId: null }]
  assert.deepEqual([...terminalIds(nodes)].sort(), ['c', 'x'])
  assert.deepEqual(chainOf('c', nodes), ['a', 'b', 'c'])
  assert.deepEqual(chainOf('x', nodes), ['x'])
})

test('a broken or looping lineage cannot hang the reader', () => {
  const loop = [{ id: 'a', continuedFromId: 'b' }, { id: 'b', continuedFromId: 'a' }]
  assert.ok(chainOf('a', loop).length <= 2)
})

const gp = (id: string, execution: string, extra: Partial<ScopePart> = {}): ScopePart => ({ id, groupId: 'g', execution, cancelled: false, cycleId: 'c1', continuedFromId: null, ...extra })

test('a continuation replaces its predecessor: it is not another sitting of the shared scope', () => {
  // Two real sittings. Sitting B was partly done in week 1 and continues in week 2.
  const parts = [gp('a', 'completed'), gp('b', 'partial'), gp('b2', 'not_started', { continuedFromId: 'b', cycleId: 'c2' })]
  const s = summarizeScopeGroups([{ id: 'g', expected: 2 }], parts).get('g')!
  assert.equal(s.expected, 2); assert.equal(s.completed, 1); assert.equal(s.complete, false)
})

test('the shared scope completes only when every logical sitting is genuinely finished', () => {
  const finished = [gp('a', 'completed'), gp('b', 'partial'), gp('b2', 'completed', { continuedFromId: 'b', cycleId: 'c2' })]
  assert.equal(summarizeScopeGroups([{ id: 'g', expected: 2 }], finished).get('g')!.complete, true)
  const cancelled = [gp('a', 'completed'), gp('b', 'partial'), gp('b2', 'not_started', { continuedFromId: 'b', cancelled: true })]
  const s = summarizeScopeGroups([{ id: 'g', expected: 2 }], cancelled).get('g')!
  assert.equal(s.complete, false); assert.equal(s.completed, 1)
})

test('a continuation chain of any length still counts as one logical sitting', () => {
  const parts = [gp('a', 'completed'), gp('b', 'partial'), gp('b2', 'partial', { continuedFromId: 'b' }), gp('b3', 'completed', { continuedFromId: 'b2' })]
  assert.equal(summarizeScopeGroups([{ id: 'g', expected: 2 }], parts).get('g')!.complete, true)
})

const bands = band(3)
test('REGRESSION: 20 minutes in week one (partial) + 25 in week two (finished) = 45 minutes, effort counted once', () => {
  const blocks: PaceBlock[] = [
    { id: 'wk1', lmId: 'm1', execution: 'partial', cancelled: false, continuedFromId: null },
    { id: 'wk2', lmId: 'm1', execution: 'completed', cancelled: false, continuedFromId: 'wk1' },
    ...['m2', 'm3', 'm4'].map(m => ({ id: `t-${m}`, lmId: m, execution: 'completed', cancelled: false, continuedFromId: null })),
  ]
  const events: PaceEvent[] = [mins('wk1', 20), mins('wk2', 25), mins('t-m2', 45), mins('t-m3', 45), mins('t-m4', 45)]
  // 4 modules x 45 minutes / (4 x band 3) = 15 minutes per effort unit. m1 is counted once.
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, bands, covered), 15)
  // Each week keeps its own figure; the logical work totals 45.
  const r = reportedMinutesByChain('wk2', blocks.map(b => ({ id: b.id, continuedFromId: b.continuedFromId ?? null })), events)
  assert.deepEqual(r.byOccurrence, [{ id: 'wk1', minutes: 20 }, { id: 'wk2', minutes: 25 }])
  assert.equal(r.total, 45); assert.equal(r.unknown, false)
})

test('an old partial predecessor no longer disqualifies a module once its continuation finishes', () => {
  const blocks: PaceBlock[] = [
    { id: 'p', lmId: 'm1', execution: 'partial', cancelled: false, continuedFromId: null },
    { id: 's', lmId: 'm1', execution: 'completed', cancelled: false, continuedFromId: 'p' },
    ...['m2', 'm3', 'm4'].map(m => done(`t-${m}`, m)),
  ]
  const events = [mins('p', 10), mins('s', 20), ...['m2', 'm3', 'm4'].map(m => mins(`t-${m}`, 30))]
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, bands, covered), 10)
})

test('if either occurrence of a chain has unknown time, nothing is invented', () => {
  const blocks: PaceBlock[] = [
    { id: 'p', lmId: 'm1', execution: 'partial', cancelled: false, continuedFromId: null },
    { id: 's', lmId: 'm1', execution: 'completed', cancelled: false, continuedFromId: 'p' },
    ...['m2', 'm3', 'm4'].map(m => done(`t-${m}`, m)),
  ]
  const events = [mins('s', 25), ...['m2', 'm3', 'm4'].map(m => mins(`t-${m}`, 30))]  // partial week-one time never reported
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, bands, covered), null)
  assert.equal(reportedMinutesByChain('s', [{ id: 'p', continuedFromId: null }, { id: 's', continuedFromId: 'p' }], events).unknown, true)
})

test('a predecessor that never started adds no time and does not block the module', () => {
  const blocks: PaceBlock[] = [
    { id: 'p', lmId: 'm1', execution: 'deferred', cancelled: false, continuedFromId: null },
    { id: 's', lmId: 'm1', execution: 'completed', cancelled: false, continuedFromId: 'p' },
    ...['m2', 'm3', 'm4'].map(m => done(`t-${m}`, m)),
  ]
  const events = [mins('s', 30), ...['m2', 'm3', 'm4'].map(m => mins(`t-${m}`, 30))]
  assert.equal(observedMinutesPerEffortUnitFrom(blocks, events, bands, covered), 10)
})

// --- What the student's two answers turn into ---------------------------------------------------------

const t = (id: string, execution = 'not_started', extra: Partial<DispositionTask> = {}): DispositionTask => ({
  id, title: id, taskType: 'study', execution, durationMinutes: 60, isProtected: false, ...extra,
})
const one = (task: DispositionTask, choice: any) => {
  const r = resolveDispositions([task], { [task.id]: choice })
  assert.deepEqual(r.errors, [])
  return r.actions[0]
}

test('partly done stays partly done and continues by default; it is never turned into missed', () => {
  const a = one(t('p', 'in_progress'), { happened: 'partial' })
  assert.equal(a.setExecution, 'partial'); assert.equal(a.cancel, false)
  assert.deepEqual(a.continuation, { minutes: 60, intent: 'continue', provisional: true })
})

test('minutes already spent never shrink the estimate on their own; a stated estimate is respected and is not provisional', () => {
  const a = one(t('p', 'partial'), { happened: 'partial', estimateMinutes: 25 })
  assert.deepEqual(a.continuation, { minutes: 25, intent: 'continue', provisional: false })
  assert.equal(a.setExecution, null)  // already partial: nothing to rewrite
})

test('done creates no continuation and needs no next choice', () => {
  const a = one(t('d'), { happened: 'completed', next: 'continue' })
  assert.equal(a.setExecution, 'completed'); assert.equal(a.continuation, null)
})

test('not done + keep for later is deferred with an unplaced continuation; the estimate is the original (nothing was done)', () => {
  const a = one(t('n'), { happened: 'not_done', next: 'later' })
  assert.equal(a.setExecution, 'deferred')
  assert.deepEqual(a.continuation, { minutes: 60, intent: 'later', provisional: false })
})

test('not done + remove is recorded as skipped, with no continuation and nothing cancelled', () => {
  const a = one(t('n'), { happened: 'not_done', next: 'remove' })
  assert.equal(a.setExecution, 'skipped'); assert.equal(a.continuation, null); assert.equal(a.cancel, false)
})

test('not sure leaves the record exactly as it was, is flagged unknown, and keeps the work visible', () => {
  const a = one(t('u'), { happened: 'unknown' })
  assert.equal(a.setExecution, null); assert.equal(a.unknown, true)
  assert.deepEqual(a.continuation, { minutes: 60, intent: 'continue', provisional: true })
})

test('not sure + remove cancels the plan item without claiming it was skipped', () => {
  const a = one(t('u'), { happened: 'unknown', next: 'remove' })
  assert.equal(a.setExecution, null); assert.equal(a.cancel, true); assert.equal(a.continuation, null)
})

test('partly done + remove keeps the progress and drops the remainder; the task is not cancelled', () => {
  const a = one(t('p', 'partial'), { happened: 'partial', next: 'remove' })
  assert.equal(a.cancel, false); assert.equal(a.continuation, null)
})

test('work already deferred this week defaults to "keep for later" rather than vanishing', () => {
  const r = resolveDispositions([t('x', 'deferred')], { x: { happened: 'not_done' } })
  assert.equal(r.actions[0].continuation?.intent, 'later'); assert.equal(r.actions[0].setExecution, null)
})

test('every unfinished task must be answered, and nothing outside the review can be answered', () => {
  assert.equal(resolveDispositions([t('a'), t('b')], { a: { happened: 'completed' } }).errors.length, 1)
  assert.equal(resolveDispositions([t('a')], { a: { happened: 'completed' }, ghost: { happened: 'completed' } }).errors.length, 1)
  assert.equal(resolveDispositions([t('a')], { a: { happened: 'nonsense' } }).errors.length, 1)
})

test('protected commitments and papers are never carried', () => {
  const r = resolveDispositions([t('pc', 'not_started', { isProtected: true })], { pc: { happened: 'not_done', next: 'continue' } })
  assert.equal(r.actions[0].continuation, null)
})

// --- Duplicate removal matches scope AND purpose ------------------------------------------------------
import { displaceDuplicates } from '../src/lib/planning/weeklyReview/dispositions'

const gen = (id: string, extra: Record<string, unknown> = {}) => ({ id, task_type: 'study', lm_id: '', repair_thread_id: '', ...extra })
const cont1 = (extra: Record<string, unknown> = {}) => ({ taskType: 'study', lmId: 'm1', outcomeId: null, repairThreadId: null, ...extra }) as any

test('the same module-level study is not generated twice', () => {
  const { rows, dropped } = displaceDuplicates([gen('a', { lm_id: 'm1' }), gen('b', { lm_id: 'm2' })], [cont1()])
  assert.deepEqual(rows.map(r => r.id), ['b']); assert.deepEqual(dropped.map(r => r.id), ['a'])
})

test('a continuing task for ONE outcome does not remove module-level study that covers other outcomes', () => {
  const { rows } = displaceDuplicates([gen('whole-module', { lm_id: 'm1' })], [cont1({ outcomeId: 'los-1' })])
  assert.deepEqual(rows.map(r => r.id), ['whole-module'])
})

test('a different purpose in the same module survives: review is not study, a re-check is not a repair', () => {
  const rows = [gen('rev', { task_type: 'review', lm_id: 'm1' }), gen('chk', { task_type: 'recheck', lm_id: 'm1' })]
  assert.equal(displaceDuplicates(rows, [cont1()]).rows.length, 2)
})

test('a continuing repair removes only the generated repair for that thread, not its re-check', () => {
  const rows = [gen('rep', { task_type: 'repair', repair_thread_id: 't1' }), gen('chk', { task_type: 'recheck', repair_thread_id: 't1' }), gen('other', { task_type: 'repair', repair_thread_id: 't2' })]
  const { rows: kept } = displaceDuplicates(rows, [cont1({ taskType: 'repair', lmId: null, repairThreadId: 't1' })])
  assert.deepEqual(kept.map(r => r.id).sort(), ['chk', 'other'])
})

test('the weekly paper is never displaced', () => {
  assert.equal(displaceDuplicates([gen('paper', { task_type: 'diagnostic', lm_id: 'm1' })], [cont1()]).rows.length, 1)
})

// =====================================================================================================
// W2 — placing continuing work in the proposed week
// =====================================================================================================
import { placeContinuing, explainDisplacement, type ContinuingItem } from '../src/lib/planning/weeklyReview/composer'

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const STUDY = WEEK.slice(0, 6)                                   // self-study: the seventh day is the paper day
const cap = (n: number, over: Record<string, number> = {}) => Object.fromEntries(WEEK.map(d => [d, d === WEEK[6] ? 0 : n])) as Record<string, number> & typeof over
const item = (taskId: string, extra: Partial<ContinuingItem> = {}): ContinuingItem => ({
  taskId, title: taskId, taskType: 'study', minutes: 45, intent: 'continue', lmId: 'm1', outcomeId: null, repairThreadId: null, originalDate: null, ...extra,
})
const place = (items: ContinuingItem[], o: Record<string, unknown> = {}) =>
  placeContinuing({ items, weekDates: WEEK, studyDates: STUDY, capacity: cap(120), maxSittingMinutes: 90, ...o } as any)
const where = (r: ReturnType<typeof place>, id: string) => r.placements.find(p => p.taskId === id)!

test('continuing work is placed on the earliest study day with room', () => {
  const r = place([item('a')])
  assert.equal(where(r, 'a').date, '2026-11-02'); assert.equal(where(r, 'a').reason, null)
  assert.equal(r.reservedByDate['2026-11-02'], 45); assert.equal(r.reservedStudyMinutes, 45)
})

test('recovery work cannot be placed on a past day, even with an explicit override', () => {
  const automatic = place([item('a')], { notBeforeDate: '2026-11-05' })
  assert.equal(where(automatic, 'a').date, '2026-11-05')
  const manual = place([item('a')], { notBeforeDate: '2026-11-05', overrides: { a: '2026-11-03' } })
  assert.equal(where(manual, 'a').date, null)
  assert.match(where(manual, 'a').reason!, /already passed/)
})

test('a day is never filled past its real free time; the next item moves to the next day', () => {
  const r = place([item('a', { minutes: 80 }), item('b', { minutes: 60 })], { capacity: cap(100) })
  assert.equal(where(r, 'a').date, '2026-11-02'); assert.equal(where(r, 'b').date, '2026-11-03')
})

test('work kept for later is never scheduled automatically and says why', () => {
  const r = place([item('a', { intent: 'later' })])
  assert.equal(where(r, 'a').date, null); assert.match(where(r, 'a').reason!, /kept for later/i)
  assert.equal(r.reservedStudyMinutes, 0)
})

test('work longer than the student\'s comfortable sitting stays unplaced with a practical reason', () => {
  const r = place([item('a', { minutes: 120 })])
  assert.equal(where(r, 'a').date, null); assert.match(where(r, 'a').reason!, /sitting/i)
})

test('with no day able to hold it, work stays visibly unplaced', () => {
  const r = place([item('a', { minutes: 60 })], { capacity: cap(30) })
  assert.equal(where(r, 'a').date, null); assert.match(where(r, 'a').reason!, /room/i)
})

test('the paper day and other non-study days receive no automatic placement', () => {
  const r = place([item('a')], { capacity: { ...cap(0), '2026-11-08': 500 } })
  assert.equal(where(r, 'a').date, null)
})

test('the student can choose the day; a fuller day is allowed but flagged', () => {
  const r = place([item('a', { minutes: 80 })], { capacity: cap(60), overrides: { a: '2026-11-04' } })
  assert.equal(where(r, 'a').date, '2026-11-04'); assert.match(where(r, 'a').note!, /fuller/i)
})

test('the student can leave an item unplaced; a date outside the week is ignored', () => {
  assert.equal(where(place([item('a')], { overrides: { a: 'none' } }), 'a').date, null)
  assert.equal(where(place([item('a')], { overrides: { a: '2030-01-01' } }), 'a').date, '2026-11-02')
})

test('repair study comes before its re-check; both keep their thread', () => {
  const r = place([item('chk', { taskType: 'recheck', repairThreadId: 't', minutes: 15 }), item('rep', { taskType: 'repair', repairThreadId: 't', minutes: 30 })])
  assert.ok(where(r, 'rep').date! < where(r, 'chk').date!)
})

test('a re-check whose continuing repair could not be placed waits instead of running first', () => {
  const r = place([item('rep', { taskType: 'repair', repairThreadId: 't', minutes: 120 }), item('chk', { taskType: 'recheck', repairThreadId: 't', minutes: 15 })])
  assert.equal(where(r, 'rep').date, null); assert.equal(where(r, 'chk').date, null); assert.match(where(r, 'chk').reason!, /repair/i)
})

test('a re-check with no continuing repair is placed normally', () => {
  assert.ok(where(place([item('chk', { taskType: 'recheck', repairThreadId: 't', minutes: 15 })]), 'chk').date)
})

test('repairs claim time ahead of ordinary study', () => {
  const r = place([item('study'), item('rep', { taskType: 'repair', repairThreadId: 't', minutes: 30 })], { capacity: cap(50) })
  assert.equal(where(r, 'rep').date, '2026-11-02'); assert.equal(where(r, 'study').date, '2026-11-03')
})

test('only study-like minutes reduce the new-learning budget', () => {
  const r = place([item('s', { minutes: 45 }), item('rep', { taskType: 'repair', repairThreadId: 't', minutes: 30 })])
  assert.equal(r.reservedStudyMinutes, 45); assert.equal(Object.values(r.reservedByDate).reduce((a, b) => a + b, 0), 75)
})

// --- Saying what new work moved, and why ---------------------------------------------------------------
const row = (lm: string, minutes: number, title = `Study: ${lm}`) => ({ task_type: 'study', lm_id: lm, title, duration_minutes: minutes })

test('new work that disappears is reported as moved back, and shorter work as shortened, with the reason', () => {
  const baseline = [row('a', 90), row('b', 60), row('c', 45)]
  const reduced = [row('a', 60), row('c', 45)]
  const out = explainDisplacement(baseline, reduced)
  assert.deepEqual(out.map(d => [d.title, d.mode, d.minutesRemoved]), [['Study: a', 'shortened', 30], ['Study: b', 'moved_back', 60]])
  assert.ok(out.every(d => /continuing/i.test(d.reason)))
})

test('nothing is reported when nothing moved', () => {
  assert.deepEqual(explainDisplacement([row('a', 60)], [row('a', 60)]), [])
})

test('displacement compares total module minutes across sittings and reports the change once', () => {
  const before = [row('a', 30, 'Study: a · sitting 1 of 2'), row('a', 30, 'Study: a · sitting 2 of 2')]
  const after = [row('a', 20), row('a', 20)]
  assert.deepEqual(explainDisplacement(before, after).map(d => [d.title, d.mode, d.minutesRemoved]), [['Study: a', 'shortened', 20]])
  assert.deepEqual(explainDisplacement(before, []).map(d => [d.title, d.mode, d.minutesRemoved]), [['Study: a', 'moved_back', 60]])
})
