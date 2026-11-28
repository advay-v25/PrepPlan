import { getCurrentAdaptation } from '../planning/weeklyReview/adaptationRecord'
import { createAdminClient } from '../supabase/admin'
import { tagReads } from '../ops/readTrace'
import { boundedStage } from '../ops/requestBudget'
const OPTIONAL_SECTION_MS = 12_000
import { getCurrentOperatingState } from '../state/operatingState'
import { projectCoachContext } from '../state/coachContext'
import { getCoachEvidencePack } from '../signals/coachPack'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getStudyWeekContext } from '../planning/schedule'
import { getCheckpointView, getLatestMockReport } from '../planning/checkpointService'
import { loadMockTransition } from '../exam/mockTransitionService'
import { loadRecoveryStatus } from '../planning/recovery/service'
import { getReport, listReports } from '../mocks/reportService'
import { describeScore } from '../mocks/report'
import { decideAssessment } from '../tests/assessmentDecision'
import { decideRehearsal } from '../rehearsal/service'
import { getRevisionOverview } from '../curriculum/revisionOverview'
import { checkpointTitle } from '../curriculum/mockCheckpoint'
import type { SupabaseClient } from '@supabase/supabase-js'
import { redistributeMissedTask } from '../planning/pulse/redistribute'
import { getAttemptResult } from '../tests/resultService'
import { type CoachIntent, type CoachSituation, type Proposal } from './actions'
import { clock, dayLabel, insideWindows, pickSlot, resolveDay } from './move'
import { findConflicts } from '../planning/mutations'
import { occupantsFor } from '../planning/taskService'
import { addDays, todayInZone, utcToZonedParts, weekdayOf, zonedTimeToUtc } from '../planning/studyWeek'
import { calendarTaskHref } from '../routing/calendar'
import { getClassLogContext } from '../planning/classlog/service'
import { withReadSnapshot } from '../ops/perRequest'

export type CoachWorld = {
  situation: CoachSituation
  context: ReturnType<typeof projectCoachContext> | null
  pack: Awaited<ReturnType<typeof getCoachEvidencePack>> | null
  band: string
  todayTitles: string[]
  /** Reads that failed. Said plainly in the answer: an unreadable source is never reported as empty. */
  unavailable: string[]
}

/** The existing result owns repair preview/acceptance; the Coach links there instead of writing a second plan. */
async function currentRepairFollowUp(userId: string): Promise<CoachSituation['repairFollowUp']> {
  const admin = createAdminClient()
  const { data: threads } = await admin.from('repair_threads').select('concept_id').eq('user_id', userId)
    .in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck']).order('latest_evidence_at', { ascending: false }).limit(10).throwOnError()
  if (!threads?.length) return null
  const { data: event } = await admin.from('evidence_events').select('attempt_id').eq('user_id', userId)
    .in('concept_id', threads.map(t => t.concept_id)).eq('validity', 'valid').in('evidence_state', ['needs_repair', 'unstable'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle().throwOnError()
  return event?.attempt_id ? { label: 'Review repair follow-up', href: `/app/tests/${encodeURIComponent(event.attempt_id)}/result#proposal-h` } : null
}

/** The next accepted task: today's first open one, else the next day that has one. Resolved to ids the student's own Calendar can open. */
async function findNextTask(userId: string, today: string, openToday: { id: string; title: string; durationMinutes: number; taskType?: string }[]): Promise<CoachSituation['nextTask']> {
  if (openToday[0]) return { id: openToday[0].id, title: openToday[0].title, date: today, minutes: openToday[0].durationMinutes, type: openToday[0].taskType ?? 'study' }
  const { data } = await createAdminClient().from('plan_blocks').select('id, title, local_date, duration_minutes, task_type')
    .eq('user_id', userId).gt('local_date', today).is('cancelled_at', null).eq('execution', 'not_started').eq('is_protected_commitment', false)
    .order('local_date').order('starts_at', { nullsFirst: false }).limit(1).maybeSingle().throwOnError()
  return data ? { id: data.id as string, title: data.title as string, date: data.local_date as string, minutes: Number(data.duration_minutes ?? 0), type: data.task_type as string } : null
}

/** The latest scored paper (not practice) and what it found, from the same result service the Results page uses. */
async function loadLatestResult(userId: string, now: Date, gaps: CoachSituation['repairs'], intent: CoachIntent, attemptId?: string): Promise<CoachSituation['latestResult']> {
  // A selected paper must be the student's own, scored one; otherwise (or with none selected) the latest scored paper is used.
  const q = createAdminClient().from('assessment_attempts').select('id').eq('user_id', userId).eq('status', 'scored')
  const { data: att } = await (attemptId ? q.eq('id', attemptId) : q.neq('attempt_kind', 'practice').order('submitted_at', { ascending: false, nullsFirst: false }).limit(1)).maybeSingle().throwOnError()
  if (!att) return null
  const matching = gaps.filter(gap => gap.attemptId === att.id)
  const timingResult = intent === 'slow' ? await getAttemptResult(userId, att.id as string, now).catch(() => null) : null
  const t = timingResult?.findings.find(f => f.kind === 'timing')?.practice ?? null
  return {
    attemptId: att.id as string, href: `/app/tests/${att.id}/result`,
    headline: matching.length ? `Curriculum currently records a gap in “${matching[0].name}”. ${matching[0].worked ? 'Work is recorded; new scored evidence is pending.' : 'Open the outcome to see its follow-up.'}` : 'Open the scored result to see exactly what was checked. Curriculum shows the current outcome findings.',
    findings: matching.map(gap => ({ kind: 'tracker_gap', title: gap.name })),
    outcomeHref: matching[0]?.outcomeHref,
    timing: t ? { available: t.state === 'start' || t.state === 'resume', message: t.message, deliverable: t.deliverable, minutes: t.minutes } : null,
  }
}

/** Everything the Coach is allowed to see, gathered once per message. Read-only. */
/** A task the student selected, only if it is theirs and live. `movable` mirrors what the confirm command will accept. */
/** A reading the student selected: validated against the active curriculum. Context and a link only; notes and ticks there are self-report. */
async function loadSelectedReading(id?: string): Promise<CoachSituation['selectedReading']> {
  if (!id) return null
  const { data } = await createAdminClient().from('curriculum_readings').select('id, topic_id, reading_no, title').eq('id', id).eq('is_active', true).maybeSingle().throwOnError()
  return data ? { id: data.id as string, title: `Reading ${data.reading_no}: ${data.title}`, href: `/app/curriculum/${data.topic_id}/${data.id}` } : null
}

async function loadSelectedTask(userId: string, taskId: string): Promise<(NonNullable<CoachSituation['selectedTask']> & { startsAt: string | null }) | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('plan_blocks').select('id, title, revision, local_date, starts_at, duration_minutes, execution, is_protected_commitment, cancelled_at, learning_activity_id, task_type')
    .eq('id', taskId).eq('user_id', userId).maybeSingle().throwOnError()
  if (!data || data.cancelled_at || !data.local_date) return null
  const { data: successor } = await admin.from('plan_blocks').select('id').eq('user_id', userId).eq('continued_from_task_id', taskId).limit(1).maybeSingle().throwOnError()
  return { id: data.id as string, title: data.title as string, revision: Number(data.revision), date: data.local_date as string, minutes: Number(data.duration_minutes ?? 0), startsAt: (data.starts_at as string) ?? null,
    movable: data.execution === 'not_started' && !data.is_protected_commitment && !data.learning_activity_id && !successor && !['diagnostic', 'recheck'].includes(String(data.task_type)) }
}

/** Resolve the student's day words for the selected task: a concrete date and a free slot, or the one question to ask. */
async function resolvePlacement(userId: string, t: NonNullable<Awaited<ReturnType<typeof loadSelectedTask>>>, when: string | null, ctx: { today: string; timezone: string }, cycle: { start: string; end: string } | null): Promise<CoachSituation['placement']> {
  const r = resolveDay(when, ctx.today, t.date, cycle)
  if (!r.ok) return { state: 'ask', ask: r.ask }
  const mins = t.minutes || 30
  const { data: win } = await tagReads('windows', async () => await createAdminClient().from('availability_windows').select('weekday, start_time, end_time').eq('user_id', userId).eq('status', 'active').eq('weekday', weekdayOf(r.date)).throwOnError())
  const toMin = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))
  const windows = (win ?? []).map(w => ({ start: toMin(w.start_time as string), end: toMin(w.end_time as string) }))
  const occupants = await occupantsFor(userId, [r.date], ctx.timezone)
  const ok = (slot: number | null, windowed: boolean, exact: boolean) => slot === null
    ? { state: 'ok' as const, date: r.date, dateLabel: dayLabel(r.date), startsAt: null, startMinutes: null, timeLabel: null, windowed: false, exact: false, hasWindows: windows.length > 0 }
    : { state: 'ok' as const, date: r.date, dateLabel: dayLabel(r.date), startsAt: zonedTimeToUtc(r.date, clock(slot), ctx.timezone).toISOString(), startMinutes: slot, timeLabel: clock(slot), windowed, exact, hasWindows: windows.length > 0 }
  if (r.minutes !== null) {
    // An exact time is the student's choice: never replaced by a convenient one. If it is taken, say what is there and offer the nearest feasible time.
    const start = Math.round(r.minutes / 5) * 5
    const hit = findConflicts({ date: r.date, start, durationMinutes: mins }, occupants, { ignoreIds: [t.id] })
    if (hit.length) {
      const alt = pickSlot(occupants, r.date, mins, start, t.id, windows)
      return { state: 'ask', ask: `${clock(start)} on ${dayLabel(r.date)} is taken by “${hit[0].occupant.title}”.${alt === null ? ' I found no free slot of that length inside your study hours that day; pick another day or time.' : ` The nearest free time inside your study hours is ${clock(alt)}. Say “${clock(alt)}” to use it, or give another time.`}` }
    }
    return ok(start, insideWindows(windows, start, mins), true)
  }
  return ok(pickSlot(occupants, r.date, mins, t.startsAt ? utcToZonedParts(new Date(t.startsAt), ctx.timezone).minutesOfDay : null, t.id, windows), true, false)
}

/**
 * Intents answered from today's tasks and the selected task alone. Measured on 13 Nov 2026: the shared operating state costs ~220 database
 * reads, the evidence pack ~57, the revision queue ~56 and the tracker ~16 per message, and none of that is read by these answers.
 * The heavy sources are still loaded for every intent that uses them (next, result, mock, lighter, day_was_bad, free…).
 */
const LEAN_INTENTS: CoachIntent[] = ['move_block', 'availability', 'log_class', 'log_learning', 'exam']

function describeMockReport(report: Awaited<ReturnType<typeof getReport>>, selected: boolean): CoachSituation['mockReport'] {
  return report ? { id: report.id, takenOn: report.takenOn, scoreText: describeScore(report.score, report.scale, report.scoreMax), scope: report.scope, provider: report.provider, selected, status: report.status } : null
}

async function loadLeanWorld(userId: string, intent: CoachIntent, extra: { taskId?: string; when?: string | null; message?: string }): Promise<CoachWorld> {
  const admin = createAdminClient()
  const ctx = await tagReads('studyWeek', () => getStudyWeekContext(userId))
  const { data: cyc } = await tagReads('cycle', async () => await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError())
  const cycle = cyc ? { start: cyc.starts_at_local as string, end: cyc.ends_at_local as string } : null
  const [openRows, loadRows, sat, selectedFull, classes] = await tagReads('lean', () => Promise.all([
    cyc ? admin.from('plan_blocks').select('id, title, revision, duration_minutes, execution, task_type').eq('user_id', userId).eq('cycle_id', cyc.id).eq('local_date', ctx.today)
      .is('learning_activity_id', null).is('cancelled_at', null).not('execution', 'in', '(completed,skipped,deferred,cancelled)').throwOnError() : Promise.resolve({ data: [] as any[] }),
    cycle ? admin.from('plan_blocks').select('local_date, duration_minutes, execution').eq('user_id', userId).gte('local_date', cycle.start).lte('local_date', cycle.end).throwOnError() : Promise.resolve({ data: [] as any[] }),
    admin.from('exam_completion').select('sat_on').eq('user_id', userId).maybeSingle(),
    extra.taskId ? loadSelectedTask(userId, extra.taskId) : Promise.resolve(null),
    intent === 'log_class' ? getClassLogContext(userId).catch(() => null) : Promise.resolve(null),
  ]))
  const load: Record<string, number> = {}
  for (const b of loadRows.data ?? []) if (b.execution !== 'skipped' && b.local_date) load[b.local_date as string] = (load[b.local_date as string] ?? 0) + Number(b.duration_minutes ?? 0)
  const open = (openRows.data ?? []).map((b: any) => ({ id: b.id as string, title: b.title as string, revision: Number(b.revision), durationMinutes: Number(b.duration_minutes ?? 0), execution: b.execution as string, taskType: b.task_type as string }))
  const nextTask = await findNextTask(userId, ctx.today, open)
  const selectedTask = selectedFull ? { id: selectedFull.id, title: selectedFull.title, revision: selectedFull.revision, date: selectedFull.date, minutes: selectedFull.minutes, movable: selectedFull.movable } : null
  const placement = intent === 'move_block' && selectedFull?.movable ? await resolvePlacement(userId, selectedFull, extra.when ?? null, ctx, cycle) : null
  const taskChoices = intent === 'move_block' && !selectedTask ? open.filter(b => b.execution === 'not_started').slice(0, 3).map(b => ({ id: b.id, title: b.title, date: ctx.today })) : []
  const message = extra.message?.toLowerCase() ?? ''
  const date = /\byesterday\b/.test(message) ? addDays(ctx.today, -1) : /\btoday\b/.test(message) ? ctx.today : null
  const eligible = classes?.classLed ? classes.occurrences.filter(o => o.status !== 'legacy' && (!date || o.date === date)) : []
  const named = eligible.filter(o => o.label.length >= 3 && message.includes(o.label.toLowerCase()))
  const classChoices = (named.length ? named : eligible.filter(o => o.status === 'pending' || !o.completed))
    .slice(-3).map(o => ({ key: o.key, label: o.label, date: o.date, sessionId: o.sessionId }))
  return {
    situation: { intent, today: ctx.today, cycle, load, repairs: [], repairFollowUp: null, todayOpen: open.map(b => ({ ...b, date: ctx.today })), nextTask, latestResult: null, selectedTask, taskChoices, when: extra.when ?? null, placement,
      paper: 'none', closing: false, examSat: (sat.data?.sat_on as string | null) ?? null, adaptation: null, revision: null, checkpoint: null, classChoices },
    context: null, pack: null, band: 'Insufficient evidence', todayTitles: open.map(b => b.title), unavailable: [],
  }
}

async function loadCoachWorldUncached(userId: string, intent: CoachIntent, now = new Date(), attemptId?: string, extra: { taskId?: string; when?: string | null; readingId?: string; reportId?: string; message?: string } = {}): Promise<CoachWorld> {
  if (LEAN_INTENTS.includes(intent)) return loadLeanWorld(userId, intent, extra)
  const admin = createAdminClient()
  // A selected mock report is already the scope of the answer. Even a withdrawn report must open when weekly planning or the bank is slow.
  if (intent === 'mock' && extra.reportId) {
    const [report, { data: exam }, { data: profile }] = await Promise.all([
      getReport(userId, extra.reportId),
      admin.from('exam_completion').select('sat_on').eq('user_id', userId).maybeSingle().throwOnError(),
      admin.from('profiles').select('timezone').eq('id', userId).maybeSingle().throwOnError(),
    ])
    return {
      situation: {
        intent, today: todayInZone(profile?.timezone ?? 'UTC', now), cycle: null, load: {}, repairs: [], todayOpen: [],
        paper: 'none', closing: false, examSat: exam?.sat_on ?? null, mockReport: describeMockReport(report, true), mockReportUnavailable: !report,
      },
      context: null, pack: null, band: 'Insufficient evidence', todayTitles: [], unavailable: [],
    }
  }
  const unavailable: string[] = []
  // Optional sections have their own budget: a slow one is reported as unavailable (never as zero) while the rest of the answer is still given.
  const soft = <T,>(what: string, run: () => Promise<T>) => boundedStage(what, OPTIONAL_SECTION_MS, run).catch(() => { unavailable.push(what); return null as T | null })
  const tag = tagReads
  const [state, ctx, repairFollowUp] = await Promise.all([tag('operatingState', () => getCurrentOperatingState(userId)), tag('studyWeek', () => getStudyWeekContext(userId)), tag('repairFollowUp', () => currentRepairFollowUp(userId))])
  // Independent reads start together (measured: they were awaited one after another, ~9 s for "today").
  const checkpointP = soft('your mock or checkpoint', () => tag('checkpoint', () => getCheckpointView(userId, now)))
  const lastMockP = soft('your recorded mock', () => tag('lastMock', () => getLatestMockReport(userId)))
  const reportP = soft('your mock reports', () => tag('mockReports', () => listReports(userId)))
  // A report the student chose is read by owner and discussed AS ITSELF (active, withdrawn or unavailable); it is never replaced by the latest one.
  const selReportP = extra.reportId ? soft('the mock report you chose', () => tag('selectedReport', () => getReport(userId, extra.reportId!))) : null
  // The Roadmap owns when mocks should start; Coach only reads it (for mock questions) and links the action.
  const transitionP = intent === 'mock' ? soft('the Roadmap mock recommendation', () => tag('mockTransition', () => loadMockTransition(userId, now))) : null
  const recoveryP = ['lighter', 'next', 'day_was_bad', 'mock'].includes(intent) ? soft('your catch-up status', () => tag('recovery', () => loadRecoveryStatus(userId, now))) : null
  const revisionP = soft('your revision queue', () => tag('revision', () => getRevisionOverview(userId, now)))
  const adaptationP = soft('this week’s review record', () => tag('adaptation', () => getCurrentAdaptation(userId)))
  // One tracker load serves both the evidence pack and the repair targets.
  let tracker: Awaited<ReturnType<typeof getLosTracker>> | null = null
  try { tracker = await tag('tracker', () => getLosTracker(userId, now)) } catch { tracker = null; unavailable.push('your curriculum progress') }
  let pack: CoachWorld['pack'] = null
  try { pack = await tag('evidencePack', () => getCoachEvidencePack(userId, now, tracker ?? undefined)) } catch { pack = null; unavailable.push('your assessment evidence') }

  let repairs: CoachSituation['repairs'] = []
  try {
    if (!tracker) throw new Error('no tracker')
    const byReading = new Map<string, { subjectId: string; label: string }>()
    for (const t of tracker.topics) for (const m of t.modules) byReading.set(m.id, { subjectId: t.id, label: `Reading ${m.readingNo}: ${m.name}` })
    repairs = tracker.studyOrder.filter(r => r.band === 'repair' && r.sample > 0).flatMap(r => {
      const where = byReading.get(r.readingId)
      return where ? [{ outcomeId: r.outcomeId, name: r.name, readingId: r.readingId, subjectId: where.subjectId, readingLabel: where.label,
        attemptId: r.gapAttemptId ?? null, worked: r.progress === 'in_progress' || r.progress === 'retest_due',
        outcomeHref: `/app/curriculum/${where.subjectId}/${r.readingId}?los=${r.outcomeId}#los-${r.outcomeId}` }] : []
    })
  } catch { repairs = [] }

  const [checkpointView, revisionOverview, adaptation, lastMock, reports, selReport, transition, recovery] = await Promise.all([checkpointP, revisionP, adaptationP, lastMockP, reportP, selReportP, transitionP, recoveryP])
  const cycle = state.cycle ? { start: state.cycle.startDateLocal, end: state.cycle.endDateLocal } : null
  const load: Record<string, number> = {}
  if (cycle) {
    const { data } = await admin.from('plan_blocks').select('local_date, duration_minutes, execution')
      .eq('user_id', userId).gte('local_date', cycle.start).lte('local_date', cycle.end)
    for (const b of data ?? []) if (b.execution !== 'skipped' && b.local_date) load[b.local_date as string] = (load[b.local_date as string] ?? 0) + Number(b.duration_minutes ?? 0)
  }

  const open = state.today.blocks.filter(b => b.execution !== 'completed' && b.execution !== 'skipped' && b.execution !== 'deferred')
  const nextTask = await findNextTask(userId, ctx.today, open)
  const selectedFull = extra.taskId ? await loadSelectedTask(userId, extra.taskId) : null
  const selectedTask = selectedFull ? { id: selectedFull.id, title: selectedFull.title, revision: selectedFull.revision, date: selectedFull.date, minutes: selectedFull.minutes, movable: selectedFull.movable } : null
  const placement = intent === 'move_block' && selectedFull?.movable ? await resolvePlacement(userId, selectedFull, extra.when ?? null, ctx, cycle) : null
  const taskChoices = intent === 'move_block' && !selectedTask ? open.filter(b => b.execution === 'not_started').slice(0, 3).map(b => ({ id: b.id, title: b.title, date: ctx.today })) : []
  const latestResult = intent === 'result' || intent === 'slow' ? await loadLatestResult(userId, now, repairs, intent, attemptId) : null
  const resultSelected = !!attemptId && (intent === 'result' || intent === 'slow')
  // A selected result owns its follow-up. The account-wide "latest evidence" follow-up belongs to some other paper, so it is never offered beside a selected one (opened or not) unless it IS that paper's.
  const followUp = resultSelected && !repairFollowUp?.href.includes(`/tests/${encodeURIComponent(attemptId!)}/`) ? null : repairFollowUp
  // ONE assessment decision for every surface: the operating state's assessment (running/scored/scope/due day) and, for anything not yet decided there,
  // the authoritative preflight decision Tests and the server reservation use. The Coach adds no eligibility rule of its own.
  const asm = state.assessment
  let paperState = 'none'
  let paperDetail: NonNullable<CoachSituation['paperDetail']> = { href: asm?.destination ?? null, dueDate: asm?.dueDate ?? null, message: asm?.message ?? null, unresolved: asm?.unresolvedBlocks ?? 0 }
  if (asm?.state === 'running') paperState = 'resume'
  else if (asm?.state === 'scored') paperState = 'result'
  else if (asm?.state === 'confirm_scope') { paperState = 'confirm_scope'; paperDetail.href = '/app/tests#scope-h' }
  else {
    const d = await tag('assessmentDecision', () => decideAssessment(userId, { kind: 'weekly' })).then(r => r.decision).catch(() => null)
    if (!d) { paperState = 'none'; unavailable.push('your assessment availability') }
    else {
      paperDetail.message = d.message
      paperState = d.state === 'start' || d.state === 'stale' ? (asm?.state === 'upcoming' ? 'upcoming' : 'start')
        : d.state === 'resume' ? 'resume' : d.state === 'confirm_scope' ? 'confirm_scope'
        : d.state === 'no_scope' || d.state === 'no_cycle' ? 'no_scope'
        : d.state === 'insufficient' || d.state === 'no_bank' ? 'insufficient'
        : d.state === 'waiting' ? 'waiting' : 'none'
      if (d.state === 'resume' && d.attemptId) paperDetail.href = `/app/tests/${d.attemptId}`
    }
  }
  // A Roadmap rehearsal is offered, or explained, from the same capability decision Calendar and Tests read.
  const rehearsal = checkpointView?.checkpoint.kind === 'internal_rehearsal' ? (await tag('rehearsal', () => decideRehearsal(userId, checkpointView.checkpointId)).catch(() => null))?.decision ?? null : null
  return {
    situation: {
      intent, today: ctx.today, cycle, load, repairs: repairs.slice(0, 3), repairFollowUp: followUp, selectedResultUnavailable: resultSelected && !latestResult, selectedResultOpen: resultSelected && !!latestResult,
      todayOpen: open.map(b => ({ id: b.id, title: b.title, revision: b.revision, durationMinutes: b.durationMinutes, execution: b.execution, date: ctx.today })),
      homeNext: state.nextAction ? { code: state.nextAction.code, title: state.nextAction.title, rationale: state.nextAction.rationale, destination: state.nextAction.destination ?? null } : null,
      nextTask, latestResult, selectedTask, taskChoices, when: extra.when ?? null, placement, selectedReading: await loadSelectedReading(extra.readingId),
      paper: paperState, paperDetail, closing: state.cycle?.closureState === 'closure_ready', examSat: (await createAdminClient().from('exam_completion').select('sat_on').eq('user_id', userId).maybeSingle()).data?.sat_on as string | null ?? null,
      adaptation: adaptation ? { headline: adaptation.headline, lighter: adaptation.lighter, optionalMinutes: adaptation.optionalMinutes, waiting: adaptation.waiting } : null,
      revision: revisionOverview ? { inPlan: revisionOverview.inPlan.length, eligible: revisionOverview.eligible,
        next: revisionOverview.next.slice(0, 3).map(n => ({ name: n.name, href: `/app/curriculum/${n.topic}/${n.readingId}`, why: n.why[0] ?? '' })) } : null,
      recovery: recovery ? { level: recovery.level, headline: recovery.headline, why: recovery.why, owedHours: recovery.numbers.extraHours, weeksToClear: recovery.numbers.weeksToClear, chosen: recovery.chosen, paths: recovery.paths.map(p => p.label), tradeoff: recovery.tradeoff?.summary ?? null } : null,
      mockTransition: transition?.available ? { headline: transition.headline, verdict: transition.verdict, why: transition.why, gaps: transition.gaps.slice(0, 3).map(g => g.name), addsMock: transition.proposal.adds.length > 0, costOfWaiting: transition.costOfWaiting } : null,
      mockReport: extra.reportId ? describeMockReport(selReport, true) : describeMockReport(reports?.[0] ?? null, false),
      mockReportUnavailable: Boolean(extra.reportId) && !selReport,
      lastMock: extra.reportId ? null : lastMock ? { title: lastMock.title, date: lastMock.takenOn, reportedResult: lastMock.reportedResult, notes: lastMock.notes, href: lastMock.href } : null,
      checkpoint: checkpointView ? { title: checkpointTitle(checkpointView.checkpoint), date: checkpointView.checkpoint.date, href: checkpointView.href, choiceUnresolved: checkpointView.choiceUnresolved, appointments: checkpointView.appointments.filter(a => a.status === 'planned').length, rehearsal: rehearsal ? { state: rehearsal.state, rehearsalId: rehearsal.rehearsalId, reasons: rehearsal.reasons.slice(0, 2) } : null } : null,
    },
    context: projectCoachContext(state),
    pack,
    band: pack?.understanding.band ?? state.evidence.preparednessBand ?? 'Insufficient evidence',
    todayTitles: open.map(b => b.title),
    unavailable,
  }
}

export type StoredMessage = {
  id: string; role: 'student' | 'coach'; body: string; intent: string | null; links: { label: string; href: string }[]
  createdAt: string
  proposals: { id: string; kind: string; title: string; reasoning: string; status: string; changes?: any }[]
}

export async function saveMessage(userId: string, role: 'student' | 'coach', body: string, intent: CoachIntent | null, links: { label: string; href: string }[] = []) {
  const admin = createAdminClient()
  const { data, error } = await admin.from('coach_messages')
    .insert({ user_id: userId, role, body: body.slice(0, 4000), intent, links }).select('id, created_at').single()
  if (error) throw new Error(error.message)
  return data as { id: string; created_at: string }
}

export async function saveProposals(userId: string, messageId: string, proposals: Proposal[], cycleId: string | null) {
  if (!proposals.length) return []
  const admin = createAdminClient()
  const rows = proposals.map(p => ({
    user_id: userId, message_id: messageId, intent: p.kind, kind: p.kind, title: p.title, reasoning: p.reasoning,
    proposed_changes: p.changes, origin: 'coach', status: 'pending', target_cycle_id: cycleId,
  }))
  const { data, error } = await admin.from('coach_proposals').insert(rows).select('id, kind, title, reasoning, status, proposed_changes')
  if (error) throw new Error(error.message)
  await admin.from('coach_messages').update({ proposal_ids: (data ?? []).map(d => d.id) }).eq('id', messageId).eq('user_id', userId)
  return (data ?? []).map(d => ({ id: d.id, kind: d.kind, title: d.title, reasoning: d.reasoning, status: d.status, changes: (d as any).proposed_changes })) as StoredMessage['proposals']
}

export async function loadHistory(userId: string, limit = 40): Promise<StoredMessage[]> {
  const admin = createAdminClient()
  const { data: msgs, error } = await admin.from('coach_messages').select('id, role, body, intent, links, created_at, proposal_ids')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)   // an unreadable history is "unavailable", never an empty conversation
  const rows = (msgs ?? []).reverse()
  const ids = rows.flatMap(m => (m.proposal_ids ?? []) as string[])
  const { data: props, error: pErr } = ids.length
    ? await admin.from('coach_proposals').select('id, kind, title, reasoning, status, proposed_changes').eq('user_id', userId).in('id', ids)
    : { data: [] as any[], error: null }
  if (pErr) throw new Error(pErr.message)
  const byId = new Map(((props ?? []) as any[]).map(p => [p.id as string, p] as const))
  return rows.map(m => ({
    id: m.id as string, role: m.role as 'student' | 'coach', body: m.body as string, intent: (m.intent as string) ?? null,
    links: (m.links ?? []) as StoredMessage['links'], createdAt: m.created_at as string,
    proposals: ((m.proposal_ids ?? []) as string[]).map(i => byId.get(i)).filter(Boolean).map((p: any) => ({ ...p, changes: p.proposed_changes, proposed_changes: undefined })) as StoredMessage['proposals'],
  }))
}

export async function clearHistory(userId: string) {
  // One transaction under the per-student turn lock: pending proposals are rejected and the conversation deleted together.
  // A proposal confirmed first is already executed (the row lock orders them) and stays as the record of what changed.
  const { error } = await createAdminClient().rpc('coach_clear_history', { p_user: userId })
  if (error) throw new Error(error.message)
}

export type Effects = { deferred: number; placedTasks: number; placedMinutes: number; placement?: { taskId: string; toDate: string; startsAt: string | null; href: string } }
/** What actually happened, from durable records: a confirmed placement, tasks deferred, and minutes placed on another day (the redistribution receipt). */
async function effectsOf(userId: string, changes: any): Promise<Effects> {
  const rc = changes?.receipt
  if (rc?.kind === 'placement') return { deferred: 0, placedTasks: 1, placedMinutes: 0, placement: { taskId: rc.taskId, toDate: rc.toDate, startsAt: rc.startsAt ?? null, href: calendarTaskHref(rc.taskId, rc.toDate) } }
  const ids = ((rc?.events ?? []) as { taskId: string }[]).map(e => e.taskId)
  if (!ids.length) return { deferred: Number(changes?.applied ?? 0), placedTasks: 0, placedMinutes: 0 }
  const { data } = await createAdminClient().from('redistribution_receipts').select('placed_minutes').eq('user_id', userId).in('source_task_id', ids).is('reversed_at', null)
  const placed = (data ?? []).filter(r => Number(r.placed_minutes) > 0)
  return { deferred: ids.length, placedTasks: placed.length, placedMinutes: placed.reduce((n, r) => n + Number(r.placed_minutes), 0) }
}

export type DecisionResult =
  | { ok: true; status: 'executed' | 'rejected'; already?: boolean; applied?: number; taskId?: string; effects?: Effects }
  | { ok: false; code: 'NOT_FOUND' | 'STALE' | 'INVALID'; error: string; nextUrl?: string }

/** The only place a Coach proposal turns into a change, and only when the student says so. */
export async function decideProposal(db: SupabaseClient, userId: string, proposalId: string, decision: 'accept' | 'reject'): Promise<DecisionResult> {
  const admin = createAdminClient()
  const { data: p } = await admin.from('coach_proposals').select('*').eq('id', proposalId).eq('user_id', userId).maybeSingle()
  if (!p) return { ok: false, code: 'NOT_FOUND', error: 'That suggestion no longer exists.' }
  if (p.status === 'executed') return { ok: true, status: 'executed', already: true, applied: Number(p.proposed_changes?.applied ?? 0), effects: await effectsOf(userId, p.proposed_changes) }
  if (p.status === 'rejected') return decision === 'reject' ? { ok: true, status: 'rejected', already: true } : { ok: false, code: 'STALE', error: 'You dismissed this suggestion. Ask again for a fresh one.' }
  if (p.status === 'stale') return { ok: false, code: 'STALE', error: 'The plan changed since this was suggested. Ask again for a fresh one.' }

  const now = new Date().toISOString()
  if (decision === 'reject') {
    // One conditional write: only a still-pending proposal can be dismissed. If it lost a race, say what actually happened.
    const { data: won } = await admin.from('coach_proposals').update({ status: 'rejected', decided_at: now }).eq('id', proposalId).eq('user_id', userId).eq('status', 'pending').select('id')
    if (won?.length) return { ok: true, status: 'rejected' }
    const { data: now2 } = await admin.from('coach_proposals').select('status, proposed_changes').eq('id', proposalId).eq('user_id', userId).maybeSingle()
    if (now2?.status === 'executed') return { ok: false, code: 'STALE', error: 'That was already confirmed, so it cannot be dismissed. Check Calendar if you want to undo it.' }
    return now2?.status === 'rejected' ? { ok: true, status: 'rejected', already: true } : { ok: false, code: 'NOT_FOUND', error: 'That suggestion no longer exists.' }
  }

  if (p.kind === 'recheck_block') {
    await admin.from('coach_proposals').update({ status: 'stale', decided_at: now }).eq('id', proposalId).eq('user_id', userId).eq('status', 'pending').throwOnError()
    return { ok: false, code: 'STALE', error: 'This older suggestion cannot add a repair. Review the current follow-up and confirm its plan there.', nextUrl: (await currentRepairFollowUp(userId))?.href ?? '/app/tests' }
  }

  // One transaction: validate every reviewed task, apply them through the existing atomic task command, write the receipt.
  // A repeat returns the same receipt; a stale proposal changes nothing. The student's own session is used, so ownership is enforced inside.
  const { data, error } = await db.rpc(p.kind === 'move_task' ? 'confirm_coach_move' : 'confirm_coach_proposal', { p_proposal_id: proposalId })
  if (error) {
    console.error('[coach confirm]', error.message)
    return { ok: false, code: 'INVALID', error: 'That could not be confirmed, and nothing was changed. Check Calendar, then ask again.' }
  }
  const r = data as any
  if (r?.ok) {
    if (!r.replayed && r.applied > 0 && p.kind !== 'move_task') {
      // Each deferred task is absorbed at most once into later sessions of the same reading (best effort; the committed receipt does not depend on it).
      for (const e of (r.receipt?.events ?? []) as { taskId: string }[]) { try { await redistributeMissedTask(userId, e.taskId) } catch { console.error('[coach confirm] redistribution needs retry') } }
    }
    return { ok: true, status: 'executed', already: Boolean(r.replayed), applied: r.applied, effects: await effectsOf(userId, { receipt: r.receipt, applied: r.applied }) }
  }
  if (r?.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', error: 'That suggestion no longer exists.' }
  if (r?.code === 'STALE' && r.reason === 'sitting_order') {
    // The authoritative refusal, explained and linked; nothing moved and nothing was placed instead.
    const mv = (p.proposed_changes as any)?.move
    return { ok: false, code: 'STALE', error: `That would break the order you planned${r.orderTitle ? `: it must stay in sequence with “${r.orderTitle}”` : ''}. Nothing was moved. Open the task in Calendar to see its sittings and move the other one first, or choose a different day.`,
      ...(mv?.id && mv?.fromDate ? { nextUrl: calendarTaskHref(mv.id, mv.fromDate) } : {}) }
  }
  if (r?.code === 'STALE' && r.reason === 'no_room') {
    const mv = (p.proposed_changes as any)?.move
    return { ok: false, code: 'STALE', error: 'That day no longer has one free stretch long enough for it, so nothing was moved. Pick another day, or open the task in Calendar to see what the day holds.',
      ...(mv?.id && mv?.fromDate ? { nextUrl: calendarTaskHref(mv.id, mv.fromDate) } : {}) }
  }
  if (r?.code === 'STALE') return { ok: false, code: 'STALE', error: p.kind === 'move_task' ? 'The task or that time changed since this was suggested, so nothing was moved. Ask again for a fresh preview.' : 'The plan changed since this was suggested, so nothing was changed. Ask again for a fresh suggestion.' }
  return { ok: false, code: 'INVALID', error: 'This kind of suggestion is not supported.' }
}


export type TurnBegin = { state: 'new' | 'resume' | 'replay' | 'limited' | 'conflict' | 'busy'; studentId?: string; coachId?: string; token?: string }
/** Records (or finds) the student's message for this turn, binds the key to the original payload, takes the lease and applies the hourly allowance once. */
export async function beginTurn(userId: string, key: string, body: string, intent: CoachIntent, limit: number, hash: string, leaseSecs = 45): Promise<TurnBegin> {
  const { data, error } = await createAdminClient().rpc('coach_turn_begin', { p_user: userId, p_key: key, p_body: body, p_intent: intent, p_limit: limit, p_hash: hash, p_lease_secs: leaseSecs })
  if (error) throw new Error(error.message)
  return data as TurnBegin
}

/** One outbound provider request, reserved BEFORE it is sent (so retries and fallbacks count). `fenced` = this worker no longer owns the turn. */
export async function reserveModelCall(userId: string, key: string, token: string, limit: number): Promise<{ ok: true; callId: number } | { ok: false; reason: 'fenced' | 'budget' }> {
  const { data, error } = await createAdminClient().rpc('coach_model_reserve', { p_user: userId, p_key: key, p_token: token, p_limit: limit })
  if (error) throw new Error(error.message)
  return data as any
}
export async function settleModelCall(userId: string, callId: number, state: 'succeeded' | 'failed' | 'indeterminate') {
  await createAdminClient().rpc('coach_model_settle', { p_user: userId, p_call: callId, p_state: state })
}

export type TurnMeta = { interpreter: string; prompt: string | null; fallback: boolean; fallbackReason: string | null; source: 'deterministic' | 'model_interpreted' | 'model_reply'; pending?: PendingContext | null; timings?: Record<string, number> }
/** What a short follow-up ("the second one", "Friday", "no, not tomorrow") refers to. Stored with the answer so a reload keeps it. */
export type PendingContext = { intent: CoachIntent; taskChoices?: string[]; taskId?: string | null; when?: string | null; asked: string }

/** Writes the answer and its proposals as one unit; a repeat returns the first. A worker that lost its lease is fenced. */
export async function finishTurn(userId: string, key: string, token: string, reply: string, intent: CoachIntent, links: { label: string; href: string }[], cycleId: string | null, drafts: Proposal[], meta: TurnMeta) {
  const { data, error } = await createAdminClient().rpc('coach_turn_finish', { p_user: userId, p_key: key, p_token: token, p_body: reply, p_intent: intent, p_links: links, p_cycle: cycleId, p_proposals: drafts, p_meta: meta })
  if (error) throw new Error(error.message)
  return data as { coachId?: string; replayed?: boolean; error?: 'NO_TURN' | 'FENCED' }
}

/** One stored turn's answer fetched by its own id: independent of how many newer turns exist. */
export async function loadTurnAnswer(userId: string, coachId: string): Promise<(StoredMessage & { meta: TurnMeta | null }) | null> {
  const admin = createAdminClient()
  const { data: m, error } = await admin.from('coach_messages').select('id, role, body, intent, links, created_at, proposal_ids, turn_meta').eq('id', coachId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!m) return null
  const ids = (m.proposal_ids ?? []) as string[]
  const { data: props, error: pErr } = ids.length ? await admin.from('coach_proposals').select('id, kind, title, reasoning, status, proposed_changes').eq('user_id', userId).in('id', ids) : { data: [] as any[], error: null }
  if (pErr) throw new Error(pErr.message)
  const byId = new Map(((props ?? []) as any[]).map(p => [p.id as string, p] as const))
  return {
    id: m.id as string, role: m.role as 'coach', body: m.body as string, intent: (m.intent as string) ?? null, links: (m.links ?? []) as StoredMessage['links'], createdAt: m.created_at as string,
    proposals: ids.map(i => byId.get(i)).filter(Boolean).map((p: any) => ({ ...p, changes: p.proposed_changes, proposed_changes: undefined })) as StoredMessage['proposals'],
    meta: (m.turn_meta ?? null) as TurnMeta | null,
  }
}

/** The most recent coach answer still awaiting a short reply (a clarification or a pending proposal), if it is recent enough to be what "yes" means. */
export async function loadLastTurn(userId: string, maxAgeMs = 30 * 60_000): Promise<(StoredMessage & { meta: TurnMeta | null }) | null> {
  const { data, error } = await createAdminClient().from('coach_messages').select('id, created_at').eq('user_id', userId).eq('role', 'coach').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || Date.now() - new Date(data.created_at as string).getTime() > maxAgeMs) return null
  return loadTurnAnswer(userId, data.id as string)
}

/**
 * The Coach's read-only context build. A route handler has no per-render cache, so every loader here used to re-read its own copy of the same rows
 * (a deterministic turn made ~286 database calls). Inside one read snapshot they share the per-request reads. Nothing that writes runs inside it, and the
 * lean world used to preview a move, and every confirmation, keep their own fresh reads.
 */
export const loadCoachWorld: typeof loadCoachWorldUncached = (...args) => withReadSnapshot(() => loadCoachWorldUncached(...args))
