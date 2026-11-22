/** Pure regression tests for the Home decision model: the reproduced defects, with fixed clocks and no database. */
import { buildWork, remainingPlanTime } from '../src/lib/state/homeModel'
import { selectNextAction } from '../src/lib/state/nextActionSelector'
import { computeAttentionQueue, ATTENTION_FOR_ACTION } from '../src/lib/state/attentionReducer'
import { computeWeekExecution } from '../src/lib/state/weekExecutionReducer'
import { mergeTestsBridge, type TestsBridge } from '../src/lib/signals/operatingBridge'
import type { OperatingState, PlanBlock } from '../src/lib/state/types'
import { controlForPaperTask, controlForRecheck } from '../src/lib/state/assessmentControl'
import { closureFromGate } from '../src/lib/state/closureWording'
import { clockWording, clockPolicy } from '../src/lib/tests/clockPolicy'
import { taskTimes, reportedOnDay } from '../src/lib/state/reportedTime'
import { calibrationLine, coverageLine, understandingLine } from '../src/lib/state/progressSummary'
import type { Signals } from '../src/lib/signals/signals'
import { formatStudyDate, preferredDateLocale, isCalendarDate, clockTime } from '../src/lib/format/date'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const TODAY = '2026-11-05'
const NOW = Date.parse('2026-11-05T23:30:00Z') // 23:30 UTC; timezone is UTC in these fixtures
const blk = (id: string, o: Partial<PlanBlock> = {}): PlanBlock => ({
  id, revision: 1, availability: 'available', destination: '', permittedCommands: [], title: `Task ${id}`, detail: '', taskType: 'study', origin: 'planner',
  durationMinutes: 30, placement: 'day_preferred', startsAt: null, execution: 'not_started', localDate: TODAY, ...o,
})
const base = (over: Partial<OperatingState> = {}): OperatingState => ({
  schemaVersion: 1, generatedAt: '', timezone: 'UTC', dataVersion: 1, activation: 'ready',
  identity: { userId: 'u', examDate: null, examWindowId: null, classPattern: 'none', weekAvailabilityMode: 'windows', hasKnownNextClass: false, indicativeExamDate: null, examSitting: null },
  roadmap: null, cycle: { id: 'c', revision: 0, availability: 'available', destination: '/app/calendar', permittedCommands: [], startDateLocal: '2026-11-02', endDateLocal: '2026-11-08', closureState: 'active' },
  today: { dateLocal: TODAY, blocks: [], protectedCommitments: [] }, execution: { completedMinutes: 0, partialMinutes: 0, deferredMinutes: 0, skippedMinutes: 0, unreportedMinutes: 0, deviations: [] },
  papers: { availablePapers: [], activeReservation: null }, evidence: { recentChanges: [], preparednessBand: null }, preparedness: null,
  repairs: { openThreads: [], proposals: [] }, attention: [], nextAction: null, capabilities: { canTakeDiagnostic: false, canTakeRevisionary: false, canCloseWeek: false },
  integrity: { isStale: false, activationFailed: false, insufficientPaperBank: false, crossPageInvariantFailed: false, partialServiceFailure: [] }, ...over,
})
const withWork = (blocks: PlanBlock[], over: Partial<OperatingState> = {}) => {
  const s = base({ today: { dateLocal: TODAY, blocks: blocks.filter(b => b.localDate === TODAY), protectedCommitments: [] }, work: buildWork(blocks, [], TODAY, NOW), ...over })
  s.attention = computeAttentionQueue(s)
  return s
}

console.log('\nPaper availability is not scope confirmation')
{
  const s = withWork([blk('a', { execution: 'completed' })], { assessment: { state: 'confirm_scope', dueDate: '2026-11-08', destination: '/app/tests#scope-h', attemptId: null, unresolvedBlocks: 1, message: '1 block needs its outcomes.' } })
  const a = selectNextAction(s)
  check('finished work awaiting confirmation offers "Confirm what you covered", not a ready paper', a.code === 'confirm_coverage' && a.title === 'Confirm what you covered', a.title)
  check('…opening the exact scope-confirmation section', a.destination === '/app/tests#scope-h')
  const bridge: TestsBridge = {
    papers: { availablePapers: [], activeReservation: null }, capabilities: { canTakeDiagnostic: false, canTakeRevisionary: false, canCloseWeek: false }, preparedness: null,
    preparednessBand: 'Insufficient evidence', repairNames: {}, insufficientPaperBank: false, signals: {} as any,
    assessment: { state: 'ready', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: null }, closure: null,
  }
  check('a startable paper before its due day is "upcoming", on its due day "ready"',
    mergeTestsBridge(base(), bridge).assessment?.state === 'upcoming' && mergeTestsBridge(base({ today: { dateLocal: '2026-11-08', blocks: [], protectedCommitments: [] } }), bridge).assessment?.state === 'ready')
  const early = base({ papers: { availablePapers: [{ id: 'weekly:x', revision: 0, availability: 'available', destination: '/app/tests', permittedCommands: [], purpose: 'diagnostic', estimatedDurationMinutes: 20, sufficientBank: true }], activeReservation: null }, assessment: { state: 'upcoming', dueDate: '2026-11-08', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: null }, work: buildWork([blk('t')], [], TODAY, NOW) })
  check('an upcoming paper does not displace today’s work', selectNextAction(early).code === 'start_preferred_task')
  const due = { ...early, assessment: { ...early.assessment!, state: 'ready' as const } }
  check('a ready, due paper does come first', selectNextAction(due).code === 'take_paper')
}

console.log('\nUnplaced work is not a free day')
{
  const s = withWork(Array.from({ length: 13 }, (_, i) => blk(`u${i}`, { localDate: null, placement: 'floating' })))
  const a = selectNextAction(s)
  check('13 unplaced tasks give a placement decision, not "all caught up"', a.code === 'place_task' && /13 unplaced/.test(a.title), a.title)
  check('…and the attention queue names them', s.attention.some(i => i.code === 'unplaced' && /13 tasks/.test(i.title)))
  const free = selectNextAction(withWork([]))
  check('a day with nothing planned is its own empty state', free.code === 'honest_empty' && /Nothing is planned/.test(free.title))
  const doneDay = selectNextAction(withWork([blk('d', { execution: 'completed' })]))
  check('a day that was worked is a different empty state', doneDay.code === 'honest_empty' && /done/.test(doneDay.title))
}

console.log('\nDeterministic, time-aware ordering')
{
  // Both belong to 5 Nov, in UTC. At 22:00 the 11pm session is still ahead and the unfinished midnight one is overdue (the audit's case).
  const late = blk('z-late', { placement: 'timed', startsAt: '2026-11-05T23:00:00Z', durationMinutes: 60 })
  const mid = blk('a-mid', { placement: 'timed', startsAt: '2026-11-05T00:00:00Z', durationMinutes: 30 })
  const at22 = buildWork([late, mid], [], TODAY, Date.parse('2026-11-05T22:00:00Z'))
  check('an unfinished midnight session is overdue and comes before the upcoming 11pm session', at22.open.map(t => `${t.id}:${t.workStatus}`).join() === 'a-mid:overdue,z-late:upcoming', at22.open.map(t => `${t.id}:${t.workStatus}`).join())
  const at2330 = buildWork([late, mid], [], TODAY, NOW)
  check('once the 11pm slot is under way it comes first (its time is running out), the overdue one next', at2330.open.map(t => `${t.id}:${t.workStatus}`).join() === 'z-late:current,a-mid:overdue')
  const same = buildWork([blk('b'), blk('a')], [], TODAY, NOW).open.map(t => t.id).join()
  check('equal tasks fall back to id, so the order never swaps between reads', same === 'a,b')
  const earlier = blk('old', { localDate: '2026-11-03' })
  const mixed = buildWork([blk('today'), earlier, blk('plan', { localDate: null, placement: 'floating' })], [], TODAY, NOW).open.map(t => `${t.id}:${t.workStatus}`).join()
  check('an earlier-day task is overdue and first; unplaced work is last', mixed === 'old:overdue,today:today,plan:unplaced', mixed)
  const a = selectNextAction(withWork([earlier, blk('today')]))
  check('the recommendation links the task’s OWN day so its week is found', a.destination.includes('week=2026-11-03') && a.timing === 'Overdue', a.destination)
  check('in-progress work outranks everything dated', selectNextAction(withWork([blk('p', { execution: 'in_progress' }), earlier])).code === 'resume_task')
}

console.log('\nPartial work')
{
  const p = blk('part', { execution: 'partial', durationMinutes: 60 })
  const w = buildWork([p], [{ task_id: 'part', event_type: 'partial', actual_duration_minutes: 20, created_at: '2026-11-05T10:00:00Z' }], TODAY, NOW)
  check('a partly done task stays open, shows what was reported, and keeps its remaining time', w.open[0].reportedMinutes === 20 && w.remainingPlannedMinutes === 40 && w.reportedMinutesToday === 20)
  const ex = computeWeekExecution([{ ...p, localDate: TODAY }] as any, [{ id: 'e', task_id: 'part', event_type: 'partial', actual_duration_minutes: 20, created_at: '2026-11-05T10:00:00Z' }], TODAY)
  check('the execution summary counts it as partial, not unreported', ex.partialMinutes === 20 && ex.unreportedMinutes === 0, JSON.stringify(ex))
}

console.log('\nDecisions are deduplicated by identity')
{
  const s = withWork([], { assessment: { state: 'scored', dueDate: '2026-11-08', destination: '/app/tests/at1/result', attemptId: 'at1', unresolvedBlocks: 0, message: null }, cycle: { ...base().cycle!, closureState: 'closure_ready' } })
  const codes = s.attention.map(i => i.code)
  check('a scored paper has a producer (scored_paper) with its result destination', s.attention.find(i => i.code === 'scored_paper')?.destination === '/app/tests/at1/result')
  check('closure is a separate decision from the result, though both could point at related pages', codes.includes('closure_ready') && codes.includes('scored_paper'))
  const next = selectNextAction(s)
  check('with nothing dated left, the scored result is recommended', next.code === 'review_scored_paper')
  check('the action’s own decision is excluded by identity, others kept', ATTENTION_FOR_ACTION[next.code] === 'scored_paper' && s.attention.filter(i => i.code !== ATTENTION_FOR_ACTION[next.code]).length === 1)
  const two = base({ attention: [{ id: 'x', code: 'unplaced', priority: 1, title: '', description: '', destination: '/app/calendar', actionLabel: '' }, { id: 'y', code: 'overdue', priority: 1, title: '', description: '', destination: '/app/calendar', actionLabel: '' }] })
  check('two decisions that share a URL both survive', two.attention.length === 2)
}

console.log('\nSeparate signals, honest wording')
{
  const sig = (o: Partial<Signals['understanding']> = {}, cal: Partial<Signals['calibration']> = {}, readings = { total: 102, covered: 102, partial: 0 }): Signals => ({
    version: 1, position: { total: 343, notStarted: 343, scheduled: 0, exposed: 0, whole: 0, partial: 0, tested: 0, verified: 0, readingsExposed: 0, readings },
    understanding: { band: 'Insufficient evidence', reasons: ['Evidence covers 1 reading; at least 2 are needed.'], validEvents: 0, scoredPapers: 0, readingsTested: 0, subjectsTested: 0, latestEvidenceAt: null, latestAttemptId: null, recent: false, verifiedShareOfTested: null, integrityWarning: null, ...o },
    execution: { completed: 0, partial: 0, postponed: 0, skipped: 0, unreported: 0, total: 0, completedMinutes: 0, postponedMinutes: 0, pressure: 'none' },
    calibration: { sureAccuracy: null, sureSample: 0, guessAccuracy: null, confidentWrong: 0, guessedRight: 0, overconfidentOutcomes: 0, underconfidentOutcomes: 0, sample: 0, reading: '', ...cal }, movement: [],
  })
  const c = coverageLine(sig())
  const partialOnly = coverageLine(sig({}, {}, { total: 102, covered: 0, partial: 31 }))
  check('partial readings never increment the covered count', partialOnly.value === '0 of 102 readings recorded as covered · 31 partly')
  const local = understandingLine(sig({ band: 'Stable', scoredPapers: 2, readingsTested: 3, latestEvidenceAt: '2026-11-04T21:15:00Z' }), TODAY, 'Asia/Kolkata')
  check('an evidence event after local midnight is from today', /latest today/.test(local.detail), local.detail)
  check('display locale follows the highest supported browser preference', preferredDateLocale('en-GB;q=0.5, en-US;q=0.9') === 'en-US' && formatStudyDate('2026-11-05', 'date', 'en-US') === 'Nov 5, 2026')
  check('date validation rejects rollover and the clock labels handle noon and midnight', !isCalendarDate('2026-02-30') && isCalendarDate('2028-02-29') && clockTime(720) === '12pm' && clockTime(1440) === '12am')
  check('the remaining-time caption can be computed from only the displayed tasks', remainingPlanTime([blk('remaining', { durationMinutes: 36 })]).remainingPlannedMinutes === 36)
  check('a first pass reported complete shows 102 readings in rotation, not "0 / 343"', /First pass recorded complete · 102 readings in revision rotation/.test(c.value) && /Tests track understanding separately/.test(c.detail), c.value)
  check('no paper yet is "No scored paper yet"', understandingLine(sig(), TODAY).value === 'No scored paper yet')
  const few = understandingLine(sig({ scoredPapers: 1, readingsTested: 1, recent: true, latestEvidenceAt: '2026-11-04T10:00:00Z' }), TODAY)
  check('after a scored paper it is "Too little evidence", never "No tests yet"', few.value === 'Too little evidence so far' && !/No tests yet/.test(few.value + few.detail), few.value)
  const stale = understandingLine(sig({ scoredPapers: 2, readingsTested: 3, recent: false, latestEvidenceAt: '2026-09-01T10:00:00Z' }), TODAY)
  check('old evidence is called out as out of date, with its age', stale.value === 'Evidence is out of date' && /65 days/.test(stale.detail), stale.detail)
  check('disputed evidence is its own state', understandingLine(sig({ integrityWarning: 'More than a fifth of the evidence is disputed.' }), TODAY).value === 'Evidence disputed')
  const small = calibrationLine(sig({}, { sample: 1, sureSample: 1, sureAccuracy: 1 }))
  check('one confident answer gets no percentage, and the sample size is stated', small.percent === null && /1 answer marked/.test(small.detail))
  const mix = calibrationLine(sig({}, { sample: 5, sureSample: 1, sureAccuracy: 1 }))
  check('five marked answers with only one "sure" still get no percentage: the denominator is the sure answers', mix.percent === null && /1 of them "sure"/.test(mix.detail) && /Too few "sure"/.test(mix.value), mix.value)
  const ok = calibrationLine(sig({}, { sample: 8, sureSample: 6, sureAccuracy: 0.5, reading: 'ok' }))
  check('five or more "sure" answers get the percentage with its real denominator', ok.percent === 50 && /6 answers you marked "sure", out of 8/.test(ok.detail), ok.detail)
}

console.log('\nReported time: unknown stays unknown, undo reverses, days follow the report')
{
  const ev = (id: string, type: string, min: number | null, at: string, payload: any = {}) => ({ id, task_id: 't', event_type: type, actual_duration_minutes: min, created_at: at, payload })
  const t = (events: any[]) => taskTimes(events).get('t')!
  check('a partial report with no minutes is unknown, not zero', t([ev('1', 'partial', null, '2026-11-05T09:00:00Z')]).minutes === null && t([ev('1', 'partial', null, '2026-11-05T09:00:00Z')]).unknown)
  const rep = t([ev('1', 'partial', 12, '2026-11-05T09:00:00Z'), ev('2', 'partial', 8, '2026-11-05T10:00:00Z')])
  check('repeated updates add up (new minutes since the last update)', rep.minutes === 20 && !rep.unknown)
  const mixed = t([ev('1', 'partial', 12, '2026-11-05T09:00:00Z'), ev('2', 'partial', null, '2026-11-05T10:00:00Z')])
  check('a known report plus an unknown one: the known minutes, flagged as incomplete', mixed.minutes === 12 && mixed.unknown)
  const undone = t([ev('1', 'partial', 12, '2026-11-05T09:00:00Z'), ev('2', 'partial', 8, '2026-11-05T10:00:00Z'), ev('3', 'undone', null, '2026-11-05T10:05:00Z', { undid: 'partial', undid_event_id: '2' })])
  check('undo reverses exactly the report it undid', undone.minutes === 12)
  const redo = t([ev('1', 'partial', 12, '2026-11-05T09:00:00Z'), ev('2', 'undone', null, '2026-11-05T09:05:00Z', { undid: 'partial', undid_event_id: '1' }), ev('3', 'undone', null, '2026-11-05T09:06:00Z', { undid: 'undone' })])
  check('undoing an undo restores the report', redo.minutes === 12)
  const legacy = t([ev('1', 'partial', 12, '2026-11-05T09:00:00Z'), ev('2', 'completed', 5, '2026-11-05T10:00:00Z'), ev('3', 'undone', null, '2026-11-05T10:05:00Z', { undid: 'completed' })])
  check('an older undo (no event id) reverses by the type it names', legacy.minutes === 12)
  check('a deferral or skip event never counts as reported work', t([ev('1', 'deferred', 30, '2026-11-05T09:00:00Z')]).minutes === null)
  const times = taskTimes([ev('1', 'partial', 15, '2026-11-05T09:00:00Z'), { id: '9', task_id: 'old', event_type: 'completed', actual_duration_minutes: 30, created_at: '2026-11-05T11:00:00Z' }, { id: '8', task_id: 'older', event_type: 'partial', actual_duration_minutes: null, created_at: '2026-11-04T11:00:00Z' }])
  const day = reportedOnDay(times, '2026-11-05', iso => iso.slice(0, 10))
  check('late reporting on an earlier task counts on the day it was reported; earlier-day reports do not', day.minutes === 45 && day.unknownReports === 0)
  check('…and an unknown report is counted on its own day without a value', reportedOnDay(times, '2026-11-04', iso => iso.slice(0, 10)).unknownReports === 1 && reportedOnDay(times, '2026-11-04', iso => iso.slice(0, 10)).minutes === 0)
  const over = buildWork([blk('o', { execution: 'partial', durationMinutes: 30 })], [{ task_id: 'o', event_type: 'partial', actual_duration_minutes: 45, created_at: '2026-11-05T09:00:00Z', id: 'x' }], TODAY, NOW)
  check('a partly done task stays open when reported time exceeds its plan, with 0 planned minutes left and the overrun counted', over.open.length === 1 && over.remainingPlannedMinutes === 0 && over.plannedUsedButOpen === 1 && over.open[0].reportedMinutes === 45)
  const unknownPartial = buildWork([blk('u', { execution: 'partial', durationMinutes: 30 })], [{ task_id: 'u', event_type: 'partial', actual_duration_minutes: null, created_at: '2026-11-05T09:00:00Z', id: 'y' }], TODAY, NOW)
  check('partly done with no minutes keeps the whole plan remaining and reported null', unknownPartial.open[0].reportedMinutes === null && unknownPartial.remainingPlannedMinutes === 30 && unknownPartial.plannedUsedButOpen === 0 && unknownPartial.open[0].timeUnknown === true)
  const order = buildWork([blk('p', { execution: 'partial', localDate: '2026-11-04' }), blk('q', { localDate: '2026-11-03' })], [], TODAY, NOW).open.map(x => x.id).join()
  check('within overdue work the older date leads; partly done only breaks ties', order === 'q,p', order)
  const tie = buildWork([blk('b2'), blk('a2', { execution: 'partial' })], [], TODAY, NOW).open.map(x => x.id).join()
  check('on the same day and time, partly done goes first', tie === 'a2,b2')
}

console.log('\nClosure reasons, result follow-up and clock wording')
{
  check('a scored paper, an external mock, a rehearsal and a permitted no-paper closure each have their own accurate reason',
    /weekly paper is scored/.test(closureFromGate({ kind: 'paper_scored' }).label)
    && /external mock \(58%\) closes the week without a weekly paper/.test(closureFromGate({ kind: 'external_mock', reportedResult: '58%' }).reason)
    && /rehearsal sessions were completed on 2026-11-04/.test(closureFromGate({ kind: 'rehearsal', completedOn: '2026-11-04' }).reason)
    && closureFromGate({ kind: 'no_paper_allowed', reason: 'The bank cannot support one.' }).reason === 'The bank cannot support one.')
  check('pending gates cannot close the week, and say what is pending', !closureFromGate({ kind: 'mock_pending' }).canClose && !closureFromGate({ kind: 'paper_pending', reason: 'Your weekly paper is ready.' }).canClose && /ready/.test(closureFromGate({ kind: 'paper_pending', reason: 'Your weekly paper is ready.' }).reason))
  const cyc = { ...base().cycle!, closureState: 'closure_ready' as const }
  const mock = withWorkClosure({ closure: closureFromGate({ kind: 'external_mock', reportedResult: '58%' }), cycle: cyc })
  check('Home carries the gate reason into the closure recommendation', selectNextAction(mock).code === 'complete_closure' && /external mock/.test(selectNextAction(mock).rationale))
  const scored = (pending: boolean) => withWorkClosure({ assessment: { state: 'scored', dueDate: '2026-11-08', destination: '/app/tests/at1/result', attemptId: 'at1', unresolvedBlocks: 0, message: null, followUp: { pending, reason: pending ? 'You have not opened this result yet.' : null } }, cycle: cyc, closure: closureFromGate({ kind: 'paper_scored' }) })
  check('while the result follow-up is open, the result is the recommendation', selectNextAction(scored(true)).code === 'review_scored_paper')
  check('once it is handled, the same result stops being recommended and closure takes over', selectNextAction(scored(false)).code === 'complete_closure' && !scored(false).attention.some(i => i.code === 'scored_paper'))
  check('an untimed paper says there is no limit and can be paused; a timed one says the clock cannot be paused',
    clockPolicy({ time_limit_minutes: null, deadline_at: null }) === 'untimed_pausable' && /no time limit.*pause/.test(clockWording({ time_limit_minutes: null, deadline_at: null }))
    && /Timed: 135 minutes.*cannot be paused/.test(clockWording({ time_limit_minutes: 135, deadline_at: '2026-11-05T12:00:00Z' }, 'UTC')) && /until 12:00 pm/.test(clockWording({ time_limit_minutes: 135, deadline_at: '2026-11-05T12:00:00Z' }, 'UTC')))
  const running = base({ papers: { availablePapers: [], activeReservation: { id: 'at2', revision: 0, availability: 'available', destination: '/app/tests/at2', permittedCommands: [], attemptId: 'at2', purpose: 'diagnostic', expiresAt: '' } }, assessment: { state: 'running', dueDate: '2026-11-08', destination: '/app/tests/at2', attemptId: 'at2', unresolvedBlocks: 0, message: null, clock: clockWording({ time_limit_minutes: null, deadline_at: null }) }, work: buildWork([], [], TODAY, NOW) })
  const r = selectNextAction(running)
  check('a running paper resumes first, with its real clock policy in the reason', r.code === 'take_paper' && /Resume/.test(r.title) && /no time limit/.test(r.rationale), r.rationale)
}
function withWorkClosure(o: Partial<OperatingState>) {
  const s = base({ work: buildWork([], [], TODAY, NOW), ...o }); s.attention = computeAttentionQueue(s); return s
}

console.log('\nMissing logs do not outrank work that is still ahead')
{
  const cyc = { ...base().cycle!, closureState: 'closure_ready' as const }
  const ex = { completedMinutes: 0, partialMinutes: 0, deferredMinutes: 0, skippedMinutes: 0, unreportedMinutes: 60, deviations: [] }
  const ahead = withWorkClosure({ cycle: cyc, execution: ex, closure: closureFromGate({ kind: 'paper_scored' }), work: buildWork([blk('today-task')], [], TODAY, NOW) })
  check('closure ready with unreported time but a session still to do today: the session is next, not "Complete missing logs"', selectNextAction(ahead).code === 'start_preferred_task', selectNextAction(ahead).code)
  const onlyOld = withWorkClosure({ cycle: cyc, execution: ex, closure: closureFromGate({ kind: 'paper_scored' }), work: buildWork([blk('old', { localDate: '2026-11-03' })], [], TODAY, NOW) })
  check('with only overdue work left, missing logs are the next step', selectNextAction(onlyOld).code === 'complete_logs')
}

console.log('\nSystem assessment tasks are controlled, never marked done')
{
  const A = (state: any, extra: any = {}) => ({ state, dueDate: '2026-11-08', destination: state === 'running' ? '/app/tests/at1' : state === 'scored' ? '/app/tests/at1/result' : '/app/tests', attemptId: 'at1', unresolvedBlocks: 0, message: null, ...extra })
  check('running → Resume paper, with the clock policy', controlForPaperTask(A('running', { clock: 'There is no time limit. You can pause and resume.' })).label === 'Resume paper' && /no time limit/.test(controlForPaperTask(A('running', { clock: 'There is no time limit. You can pause and resume.' })).note ?? ''))
  check('scored → See result at the result page', controlForPaperTask(A('scored')).kind === 'result' && controlForPaperTask(A('scored')).href === '/app/tests/at1/result')
  check('ready → Start paper; upcoming → Start paper early (deliberate, with its due day)', controlForPaperTask(A('ready')).label === 'Start paper' && /early/.test(controlForPaperTask(A('upcoming')).label) && /2026-11-08/.test(controlForPaperTask(A('upcoming')).note ?? ''))
  check('unavailable → the actual reason and the availability link; waiting for coverage → confirm coverage', /checked questions are missing/.test(controlForPaperTask(A('unavailable')).note ?? '') && controlForPaperTask(A('confirm_scope', { destination: '/app/tests#scope-h' })).href === '/app/tests#scope-h')
  check('re-check: resume, start, waiting (with why) and unavailable', controlForRecheck({ state: 'resume', attemptId: 'c1' }, '/app/calendar?task=t').href === '/app/tests/c1' && controlForRecheck({ state: 'startable' }, '/x').kind === 'start' && controlForRecheck({ state: 'waiting', message: 'Finish the repair work first.' }, '/x').note === 'Finish the repair work first.' && controlForRecheck({ state: 'bank_insufficient', message: 'm' }, '/x').kind === 'unavailable')
  const paper = blk('paper', { taskType: 'diagnostic', placement: 'timed', startsAt: '2026-11-05T10:00:00Z' })
  const withControl = (control: any) => { const s = withWork([paper]); s.work = { ...s.work!, open: s.work!.open.map(t => ({ ...t, assessmentControl: control })) }; return s }
  const go = selectNextAction(withControl(controlForPaperTask(A('ready'))))
  check('a paper task recommends Start paper at Tests, not a generic "study session"', go.code === 'take_paper' && go.destination === '/app/tests' && /ready/.test(go.title), go.title)
  check('a waiting paper task is not the recommendation (nothing to do now)', selectNextAction(withControl(controlForPaperTask(A('none', { message: 'x' })))).code !== 'take_paper')
}

console.log('\nEmpty-week handoff')
{
  const s = withWork([], { weekPlan: { kind: 'ready_to_plan', title: 'Review a plan for this week', message: 'Your study times are saved.',
    action: { label: 'Review the plan', href: '/app/calendar?plan=review', kind: 'preview' }, reason: null, draft: null } })
  const a = selectNextAction(s)
  check('Home offers the saved-times planning action and its exact destination', a.code === 'review_current_week' && a.destination === '/app/calendar?plan=review' && a.actionLabel === 'Review the plan')
  check('the planning decision can be deduplicated by identity', ATTENTION_FOR_ACTION[a.code] === 'current_week_plan')
  const classEntry = withWork([], { identity: { ...s.identity, classPattern: 'variable' }, weekPlan: { ...s.weekPlan!, kind: 'awaiting_class_input', title: 'Add your next class', action: { label: 'Add next class', kind: 'link', href: '/app/calendar?action=add-next-class' } } })
  const classAction = selectNextAction(classEntry)
  check('the class-led handoff replaces the older duplicate next-class decision', classEntry.attention.filter(item => item.code !== ATTENTION_FOR_ACTION[classAction.code]).length === 0)
  s.weekPlan = { ...s.weekPlan!, kind: 'intentionally_empty' }
  check('an intentionally empty week stays calm with planning offered as a secondary decision', selectNextAction(s).code === 'honest_empty' && computeAttentionQueue(s).some(a => a.code === 'current_week_plan'))
}

console.log('\nDeclared sitting order beats id order on the same day (Phase 6)')
{
  // ids chosen so that plain id order would put sitting 3 first
  const s1 = blk('zz-1', { title: 'Study X · sitting 1 of 3', follows: [] }), s2 = blk('mm-2', { title: 'Study X · sitting 2 of 3', follows: ['zz-1'] }), s3 = blk('aa-3', { title: 'Study X · sitting 3 of 3', follows: ['mm-2'] })
  const w = buildWork([s3, s2, s1], [], TODAY, NOW)
  check('the first sitting leads, then the second, then the third', w.open.map(t => t.id).join() === 'zz-1,mm-2,aa-3', w.open.map(t => t.id).join())
  const st = withWork([s3, s2, s1])
  check('the next action is the first open sitting, not the third', selectNextAction(st).id === 'zz-1', String(selectNextAction(st).id))
  const done = buildWork([s3, s2, { ...s1, execution: 'completed' }], [], TODAY, NOW)
  check('once the predecessor is finished, the next sitting leads', done.open[0].id === 'mm-2')
  const ord = buildWork([blk('b', { sittingOrdinal: 2 }), blk('a', { sittingOrdinal: 3 }), blk('c', { sittingOrdinal: 1 })], [], TODAY, NOW)
  check('with no declared dependency, sitting ordinal breaks the tie before the id', ord.open.map(t => t.id).join() === 'c,b,a', ord.open.map(t => t.id).join())
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
