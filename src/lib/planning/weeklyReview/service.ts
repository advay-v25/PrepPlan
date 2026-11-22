import { ledgerFromCounts, type Ledger } from '../../tests/scoreLedger'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../supabase/admin'
import { addDays, todayInZone, zonedTimeToUtc, type StudyWeek } from '../studyWeek'
import { weekForDate } from '../schedule'
import { buildCommitRows, buildWeekPlanWithPaper, loadPlacementContext } from '../pulse/generateWeek'
import { getClassLogContext } from '../classlog/service'
import { planOwedClassWork, listOwedClassWork, type OwedLine } from '../classlog/carry'
import { isPersistedPaperScope, recheckPersistedPaper, type PaperPlan } from '../pulse/paper'
import { selectDueTasks, type DueTask } from './dueTasks'
import { displaceDuplicates, resolveDispositions } from './dispositions'
import { toLine, type RevisionLine } from '../../curriculum/revisionQueue'
import type { RevisionOutcome, WeekAdaptation } from '../pulse/generateWeek'
import { explainDisplacement, placeContinuing, type ContinuingItem, type Displaced, type Placement } from './composer'

export type { DueTask } from './dueTasks'
export type ReviewClassReport = { key: string; label: string; date: string; originalDate: string; sessionId: string | null }

/**
 * Weekly closure + the week-two loop.
 *
 * Everything here that is not `acceptWeeklyTransition` is a read or a saved draft: rendering the
 * review page, or previewing, never closes a cycle, resolves a task or creates a week.
 * The single mutation is the accept_weekly_transition command, which records the student's answers
 * in each task's history, creates continuations for unfinished work, opens the next cycle and
 * saves the receipt in one transaction. The original tasks stay in the week they happened.
 */

export type Resolution = 'completed' | 'skipped' | 'deferred' | 'unknown'
export const RESOLUTIONS: Resolution[] = ['completed', 'skipped', 'deferred', 'unknown']

export type ReviewGate =
  | { kind: 'paper_scored' }
  | { kind: 'external_mock'; reason: string; outcome: 'taken'; reportedResult: string | null; actualDate: string | null } // the student recorded what happened to an external mock; closes the week without a paper
  | { kind: 'rehearsal'; reason: string; rehearsalId: string; completedOn: string } // the student's designated PrepPlan rehearsal was finished (both sessions) inside this cycle; closes the week without a weekly paper
  | { kind: 'mock_pending'; reason: string }            // the student chose the mock as this week's assessment and has not yet recorded what happened
  | { kind: 'paper_pending'; reason: string }           // a paper exists, can still be assembled, not yet scored
  | { kind: 'no_paper_allowed'; reason: string }        // explicit no-paper closure permitted
  | { kind: 'not_ready'; reason: string }               // cycle has not reached its last day

/** What the revision queue chose for the proposed week, what is waiting and why, and the choices that would change it. */
export type RevisionPreview = { phase: string; limit: number; eligible: number; placed: RevisionLine[]; waiting: RevisionLine[]; elsewhere: RevisionLine[]; tradeoffs: string[] }

export function describeRevision(r: RevisionOutcome | null): RevisionPreview | null {
  if (!r) return null
  const tradeoffs: string[] = []
  const noRoom = r.waiting.filter(w => w.waitingReason?.startsWith('Chosen for this week')).length
  if (noRoom > 0) {
    tradeoffs.push(`${noRoom} reading${noRoom === 1 ? ' chosen' : 's chosen'} for this week did not fit your free time. ${noRoom === 1 ? 'It stays' : 'They stay'} due and ${noRoom === 1 ? 'is' : 'are'} considered again next week.`)
    tradeoffs.push('To fit more now: add study time in Calendar (availability), move or shorten something you have already planned, or accept the week as it is.')
  }
  if (r.waiting.length > noRoom) tradeoffs.push('Your other covered readings stay in the rotation for later weeks. None is dropped or marked as forgotten.')
  return { phase: r.phase, limit: r.limit, eligible: r.eligible, placed: r.placed.map(toLine), waiting: r.waiting.slice(0, 8).map(toLine), elsewhere: r.elsewhere.map(toLine), tradeoffs }
}

export type PreviewDay = { date: string; items: { title: string; taskType: string; minutes: number }[] }

export type WeeklyReviewState =
  | { status: 'no_active_cycle' }
  | {
      status: 'active'
      cycle: { id: string; startsAt: string; endsAt: string; timezone: string }
      gate: ReviewGate
      dueTasks: DueTask[]
      recap: {
        planned: number
        byExecution: Record<string, number>
        paper: { present: boolean; scored: boolean; correct: number | null; valid: number | null; ledger: Ledger | null }
        /** Self-reported external mock activity in this cycle (by planned or actual date). Never a score. */
        external: { outcome: 'taken' | 'postponed' | 'not_taken'; plannedDate: string; actualDate: string | null; reportedResult: string | null; countsAsAssessment: boolean; choice: string | null }[]
      }
      carryover: { threadId: string; concept: string; status: string }[]
      /** Class days in this cycle with nothing logged (class-led students only). */
      unloggedClassDays: string[]
      classReports: ReviewClassReport[]
      /** Class follow-up that has not received all its tasks (minutes planned, with a task, still to place). Carried into the next proposal, never dropped. */
      classFollowUp: OwedLine[]
      next: {
        week: { startDate: string; endDate: string }
        days: PreviewDay[]
        paper: { kind: string; title: string | null; reason: string | null }
        taskCount: number
        revision: RevisionPreview | null
        adaptation: WeekAdaptation | null
      }
      /** The answers from the student's latest saved draft for this cycle, so leaving to edit availability and coming back loses nothing. */
      saved: { choices: Record<string, unknown>; lighter: boolean; noPaperAcknowledged: boolean; unreportedClassKeys: string[] } | null
    }

function describePaper(paper: PaperPlan, rows: { task_type: string; title: string }[]): WeeklyReviewStateNextPaper {
  if (paper.kind === 'none') return { kind: 'none', title: null, reason: paper.reason }
  return { kind: paper.purpose, title: rows.find(r => r.task_type === 'diagnostic')?.title ?? null, reason: null }
}

function groupByDay(rows: { local_date: string; title: string; task_type: string; duration_minutes: number }[]): PreviewDay[] {
  const days = new Map<string, PreviewDay>()
  for (const r of rows) {
    const day = days.get(r.local_date) ?? { date: r.local_date, items: [] }
    day.items.push({ title: r.title, taskType: r.task_type, minutes: r.duration_minutes })
    days.set(r.local_date, day)
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}
type WeeklyReviewStateNextPaper = { kind: string; title: string | null; reason: string | null }

/** The week after `cycle`, derived through the same pulse-week rule as everything else. */
export async function nextWeekFor(userId: string, cycleEnd: string, timezone: string, now = new Date()): Promise<StudyWeek> {
  const after = addDays(cycleEnd, 1)
  const today = todayInZone(timezone, now)
  // A returning student needs one current recovery week, not an invented series
  // of weeks between their last recorded cycle and today.
  const week = await weekForDate(userId, after > today ? after : today)
  return week.startDate >= after ? week : { ...week, startDate: after, days: week.days.filter(day => day >= after) }
}

/** Can a paper be started from the student's completed scope right now? The same decision Tests and start use. (pure read) */
export async function startablePaperExists(userId: string, now: Date): Promise<boolean> {
  const { decideAssessment } = await import('../../tests/assessmentDecision')
  const { decision } = await decideAssessment(userId, { kind: 'weekly' }, { now })
  return decision.state === 'start'
}

/** The same canonical gate, without preparing the next week's work just to display Home's link. */
export type WeeklyReviewGateState = Extract<WeeklyReviewState, { status:'no_active_cycle' }> | Pick<Extract<WeeklyReviewState, { status:'active' }>, 'status' | 'gate'>
export function getWeeklyReviewState(userId: string, now: Date, mode: 'gate'): Promise<WeeklyReviewGateState>
export function getWeeklyReviewState(userId: string, now?: Date): Promise<WeeklyReviewState>
/** Read-only. Only the actual review/result page needs the next-week preview. */
export async function getWeeklyReviewState(userId: string, now = new Date(), mode?: 'gate'): Promise<WeeklyReviewState | WeeklyReviewGateState> {
  const admin = createAdminClient()
  const { data: cycle } = await admin.from('planning_cycles')
    .select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (!cycle || !cycle.ends_at_local) return { status: 'no_active_cycle' }

  const timezone = (cycle.timezone as string | null) ?? 'UTC'
  const today = todayInZone(timezone, now)
  const endsAt = cycle.ends_at_local as string

  const { data: blocks } = await admin.from('plan_blocks')
    .select('id, title, task_type, local_date, execution, duration_minutes, attempt_id, assessment_scope, cancelled_at, lm_id, outcome_id, repair_thread_id, is_protected_commitment')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string)
    .is('learning_activity_id',null)
  const all = (blocks ?? []).filter(b => !b.cancelled_at && b.execution !== 'cancelled')

  const paperBlock = all.find(b => b.task_type === 'diagnostic' && (b.assessment_scope as any)?.kind === 'weekly_paper') ?? null
  let scored = false, correct: number | null = null, valid: number | null = null, ledger: Ledger | null = null
  // The weekly paper is whichever weekly attempt of this cycle exists: one started from completed
  // scope (linked by cycle) or the one the planner scheduled (linked by its paper block).
  const { data: cycleAttempts } = await admin.from('assessment_attempts')
    .select('id, status, form_id, scoring_policy_version, correct_response_count, valid_response_count, submitted_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string).eq('attempt_kind', 'weekly').order('submitted_at', { ascending: false, nullsFirst: false })
  let attempt: { id?: unknown; status: unknown; form_id?: unknown; scoring_policy_version?: unknown; correct_response_count: unknown; valid_response_count: unknown } | null = (cycleAttempts ?? []).find(a => a.status === 'scored') ?? null
  if (!attempt && paperBlock?.attempt_id) {
    attempt = (await admin.from('assessment_attempts').select('id, status, form_id, scoring_policy_version, correct_response_count, valid_response_count')
      .eq('id', paperBlock.attempt_id as string).eq('user_id', userId).maybeSingle()).data
  }
  if (attempt?.status === 'scored') {
    scored = true
    correct = (attempt.correct_response_count ?? null) as number | null
    valid = (attempt.valid_response_count ?? null) as number | null
    // Factual delivered / set-aside counts come from the reserved form and the challenge rows, never from the stored legacy counts.
    const [{ count: delivered }, { data: voidedRows }] = await Promise.all([
      admin.from('form_items').select('item_id', { count: 'exact', head: true }).eq('form_id', attempt.form_id as string).throwOnError(),
      admin.from('item_challenges').select('item_id').eq('attempt_id', attempt.id as string).eq('user_id', userId).eq('status', 'resolved_voided').throwOnError(),
    ])
    ledger = ledgerFromCounts({ policy: (attempt.scoring_policy_version ?? null) as string | null, delivered: delivered ?? 0, voided: new Set((voidedRows ?? []).map(r => r.item_id as string)).size, correct: correct ?? 0, answered: valid ?? 0 })
  }
  const openWeekly = (cycleAttempts ?? []).some(a => ['ready', 'in_progress'].includes(a.status as string))

  // The closing paper gate.
  // External mock reports (the student's own, never a score). A report counts as the week's assessment ONLY when it is a "taken"
  // outcome and the student had chosen "use the mock" when they recorded it; every other combination leaves the paper rules alone.
  const cycleStart = cycle.starts_at_local as string
  const { data: outcomeRows } = await admin.from('mock_outcomes').select('id, outcome, reported_result, planned_date, actual_date, choice_at_record')
    .eq('user_id', userId).or(`and(planned_date.gte.${cycleStart},planned_date.lte.${endsAt}),and(actual_date.gte.${cycleStart},actual_date.lte.${endsAt})`)
    .order('recorded_at', { ascending: false })
  type OutcomeRow = { id: string; outcome: 'taken' | 'postponed' | 'not_taken'; reported_result: string | null; planned_date: string; actual_date: string | null; choice_at_record: string | null }
  const outcomes = (outcomeRows ?? []) as OutcomeRow[]
  const counting = outcomes.find(o => o.outcome === 'taken' && o.choice_at_record === 'use_mock' && o.planned_date >= cycleStart && o.planned_date <= endsAt)
  const external = outcomes.map(o => ({ outcome: o.outcome, plannedDate: o.planned_date, actualDate: o.actual_date, reportedResult: o.reported_result,
    countsAsAssessment: o === counting, choice: o.choice_at_record }))
  const [{ data: plannedAppts }, { data: weekChoice }, { data: designations }] = await Promise.all([
    admin.from('mock_appointments').select('id, kind, planned_date').eq('user_id', userId).eq('status', 'planned'),
    admin.from('cycle_assessment_choices').select('choice, appointment_id').eq('user_id', userId).eq('week_start', cycleStart).maybeSingle(),
    admin.from('cycle_assessment_choices').select('appointment_id').eq('user_id', userId).eq('choice', 'use_mock').not('appointment_id', 'is', null),
  ])
  // The appointment the student chose for THIS week (a legacy choice with no appointment means the week's only one).
  const inCycle = (d: string) => d >= cycleStart && d <= endsAt
  const designated = weekChoice?.appointment_id ? (plannedAppts ?? []).find(a => a.id === weekChoice.appointment_id) : null
  const mockStillAhead = weekChoice?.appointment_id ? !!designated && inCycle(designated.planned_date as string) : (plannedAppts ?? []).some(a => inCycle(a.planned_date as string))
  // A designated Roadmap rehearsal counts for the cycle in which its SECOND session was finished (whichever week it was designated for).
  let rehearsalDone: { id: string; on: string } | null = null
  const designatedIds = (designations ?? []).map(d => d.appointment_id as string)
  if (designatedIds.length) {
    const { data: doneRows } = await admin.from('mock_rehearsals').select('id, completed_at').eq('user_id', userId).eq('status', 'complete').in('appointment_id', designatedIds)
    for (const r of doneRows ?? []) {
      const on = todayInZone(timezone, new Date(r.completed_at as string))
      if (inCycle(on)) { rehearsalDone = { id: r.id as string, on }; break }
    }
  }
  let gate: ReviewGate
  if (scored) gate = { kind: 'paper_scored' }
  else if (rehearsalDone && !openWeekly) {
    gate = { kind: 'rehearsal', rehearsalId: rehearsalDone.id, completedOn: rehearsalDone.on,
      reason: `You finished both sessions of your PrepPlan rehearsal on ${rehearsalDone.on}, and you chose it as the assessment. Its scored sessions are this week’s assessment, so no weekly paper is needed.` }
  }
  else if (counting && !openWeekly) {
    gate = { kind: 'external_mock', outcome: 'taken', reportedResult: counting.reported_result, actualDate: counting.actual_date,
      reason: `You recorded that you took your mock outside the app${counting.actual_date ? ` on ${counting.actual_date}` : ''}, and you chose it as this week’s assessment. That is your own report, not a scored paper, and it closes this week.` }
  }
  else if (today < endsAt) gate = { kind: 'not_ready', reason: `Your cycle's last day is ${endsAt}. The review opens once the weekly paper is scored, or on that day.` }
  else if (openWeekly) gate = { kind: 'paper_pending', reason: 'Your weekly paper is in progress — finish it, then come back to close the week.' }
  else if (weekChoice?.choice === 'use_mock' && mockStillAhead) {
    gate = { kind: 'mock_pending', reason: 'You chose your mock as this week’s assessment. Record what happened to it in Calendar; if it was postponed or you did not take it, you can use the weekly paper or close without an assessment.' }
  }
  else if (await startablePaperExists(userId, now)) gate = { kind: 'paper_pending', reason: 'Your weekly paper is ready — take it, then come back to close the week.' }
  else if (!paperBlock) gate = { kind: 'no_paper_allowed', reason: 'No paper could be assembled this week: nothing completed and mapped can be tested, or the question bank cannot support one.' }
  else if (!isPersistedPaperScope(paperBlock.assessment_scope)) gate = { kind: 'no_paper_allowed', reason: 'This paper has no recorded scope to check against the question bank.' }
  else {
    const recheck = await recheckPersistedPaper(userId, paperBlock.assessment_scope)
    gate = recheck.ok
      ? { kind: 'paper_pending', reason: 'Your weekly paper is ready — take it, then come back to close the week.' }
      : { kind: 'no_paper_allowed', reason: recheck.reason }
  }
  // A mock that did not happen does not unlock anything by itself; it is explained, and the supported paths below it still apply.
  const skippedMock = outcomes.find(o => o.outcome !== 'taken' && o.planned_date >= cycleStart && o.planned_date <= endsAt)
  if (skippedMock && (gate.kind === 'paper_pending' || gate.kind === 'no_paper_allowed' || gate.kind === 'not_ready')) {
    gate = { ...gate, reason: `Your mock was ${skippedMock.outcome === 'postponed' ? 'postponed' : 'not taken'}, which does not replace this week’s assessment. ${gate.reason}` }
  }

  if (mode === 'gate') return { status:'active', gate }

  const dueTasks = selectDueTasks(all.map(b => ({
    id: b.id as string, title: b.title as string, taskType: (b.task_type ?? 'study') as string,
    localDate: (b.local_date ?? null) as string | null, execution: b.execution as string,
    durationMinutes: (b.duration_minutes ?? 30) as number, cancelled: false, isProtected: Boolean(b.is_protected_commitment),
    lmId: (b.lm_id ?? null) as string | null, outcomeId: (b.outcome_id ?? null) as string | null, repairThreadId: (b.repair_thread_id ?? null) as string | null,
  })), endsAt, (paperBlock?.id ?? null) as string | null)

  const byExecution: Record<string, number> = {}
  for (const b of all) byExecution[b.execution as string] = (byExecution[b.execution as string] ?? 0) + 1

  const { data: threads } = await admin.from('repair_threads')
    .select('id, status, concept:curriculum_concepts(name)')
    .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck'])
  const carryover = (threads ?? []).map(t => ({
    threadId: t.id as string, status: t.status as string, concept: ((t.concept as any)?.name ?? 'concept') as string,
  }))

  const classCtx = await getClassLogContext(userId, now)
  const unloggedClassDays = classCtx.classLed && classCtx.cycle?.id === (cycle.id as string) ? classCtx.pendingDates : []
  const classReports: ReviewClassReport[] = []
  if (classCtx.classLed && classCtx.cycle?.id === cycle.id) {
    for (const o of classCtx.occurrences) {
      if (o.status === 'pending' || (o.status === 'logged' && !o.completed)) {
        classReports.push({ key: o.key, label: o.label, date: o.date, originalDate: o.originalDate, sessionId: o.sessionId })
      }
    }
    for (const s of classCtx.sessions) {
      if (!s.completed && !classReports.some(report => report.sessionId === s.id)) {
        classReports.push({ key: s.occurrenceKey ?? `saved:${s.id}`, label: s.occurrenceKey?.startsWith('manual:') ? 'Manual class' : 'Saved class', date: s.classDate, originalDate: s.classDate, sessionId: s.id })
      }
    }
  }

  // Preview of next week: the same generator, read-only, with this cycle treated as closing.
  const week = await nextWeekFor(userId, endsAt, timezone, now)
  const { days, paper, revision, adaptation } = await buildWeekPlanWithPaper(userId, week, { closingCycleId: cycle.id as string, now })
  // Answers are server-owned: the newest unaccepted draft for this cycle, whatever became of it, holds them.
  const { data: draftRow } = await admin.from('weekly_transition_drafts').select('choices, proposal, closure_kind')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string).neq('status', 'accepted').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const dueIds = new Set(dueTasks.map(t => t.id))
  const priorRecap = (draftRow?.proposal as { recap?: { classReportsLeftUnreported?: ReviewClassReport[] } } | undefined)?.recap
  const priorClassKeys = new Set((priorRecap?.classReportsLeftUnreported ?? []).map(report => report.key))
  const saved = draftRow ? {
    choices: Object.fromEntries(Object.entries((draftRow.choices ?? {}) as Record<string, unknown>).filter(([id]) => dueIds.has(id))),
    lighter: (draftRow.proposal as any)?.adaptation?.lighter === true,
    noPaperAcknowledged: draftRow.closure_kind === 'no_paper',
    unreportedClassKeys: classReports.filter(report => priorClassKeys.has(report.key)).map(report => report.key),
  } : null

  return {
    status: 'active',
    cycle: { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt, timezone },
    gate,
    dueTasks,
    recap: { planned: all.length, byExecution, paper: { present: Boolean(paperBlock), scored, correct, valid, ledger }, external },
    carryover,
    unloggedClassDays,
    classReports,
    classFollowUp: await listOwedClassWork(userId, cycle.id as string),
    next: {
      week: { startDate: week.startDate, endDate: week.endDate },
      days: days.map(d => ({
        date: d.date,
        items: d.portions.map(p => ({ title: p.title, taskType: p.taskType, minutes: p.durationMinutes })),
      })),
      paper: describePaper(paper, days.flatMap(d => d.portions.map(p => ({ task_type: p.taskType, title: p.title })))),
      taskCount: days.reduce((s, d) => s + d.portions.length, 0),
      revision: describeRevision(revision),
      adaptation,
    },
    saved,
  }
}

export type PreviewInput = {
  cycleId: string
  /** The student's answer per unfinished task: what happened, what next, and optionally which day. */
  choices: Record<string, unknown>
  /** The student's explicit acknowledgement that they are closing without a paper. */
  acknowledgeNoPaper?: boolean
  /** Ask for a lighter draft: the new work is reduced and what waits is shown. Kept with the draft, so it survives a return visit. */
  lighter?: boolean
  /** Class reports the student chose to leave unresolved. Does not change any attendance or learning. */
  unreportedClassKeys?: string[]
}

export type Continuing = {
  taskId: string; title: string; intent: 'continue' | 'later'; minutes: number; provisional: boolean
  /** Where it is proposed to go. `date` null means it stays unplaced, and `reason` says why. */
  placement: Placement
}

export type PreviewResult =
  | {
      ok: true
      draftId: string
      expiresAt: string
      continuing: Continuing[]
      /** New work that moved back or got shorter to make room for continuing work, with the reason. */
      displaced: Displaced[]
      /** Planned work left out because exactly the same work for the same purpose is already continuing. */
      duplicatesRemoved: number
      /** Class follow-up that never got a task: what this proposal places in the coming week, and what still waits (with the minutes). */
      classFollowUp: { placed: { title: string; date: string; minutes: number }[]; waiting: { title: string; remainingMinutes: number; reason: string }[] }
      next: {
        week: { startDate: string; endDate: string; days: string[] }
        placementDates: string[]
        days: PreviewDay[]
        taskCount: number
        paper: { kind: string; title: string | null; reason: string | null }
        revision: RevisionPreview | null
        adaptation: WeekAdaptation | null
      }
    }
  | { ok: false; code: 'no_active_cycle' | 'wrong_cycle' | 'gate_closed' | 'invalid_choices' | 'changed' | 'failed'; message: string; errors?: string[]; state?: WeeklyReviewState }

async function sourceVersion(userId: string, cycleId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc('weekly_source_version', { p_user: userId, p_cycle: cycleId })
  if (error || typeof data !== 'string') { console.error('[weekly-review] source version', error?.message); return null }
  return data
}

/**
 * Builds the proposal for the student to review and saves it as a server-owned draft. This changes nothing
 * the student can see: no task, cycle or week is touched until the draft is accepted.
 *
 * Order matters. Continuing work is PLACED first (around real availability, commitments and the sitting
 * limit); its time is reserved; only then is new work generated around it, so new work shrinks to make room.
 * The change token is read before anything else and checked again at the end: if the week moved while this
 * was being prepared, nothing is saved. The placements saved here are exactly what acceptance writes.
 */
export async function previewWeeklyTransition(userId: string, input: PreviewInput, now = new Date()): Promise<PreviewResult> {
  const admin = createAdminClient()
  const before = await sourceVersion(userId, input.cycleId)
  if (!before) return { ok: false, code: 'failed', message: 'Could not prepare the review. Nothing was changed.' }

  const state = await getWeeklyReviewState(userId, now)
  if (state.status !== 'active') return { ok: false, code: 'no_active_cycle', message: 'There is no open week to close.' }
  if (state.cycle.id !== input.cycleId) return { ok: false, code: 'wrong_cycle', message: 'That week is no longer the open one.', state }
  const classKeys = new Set(input.unreportedClassKeys ?? [])
  const unreportedClasses = state.classReports.filter(report => classKeys.has(report.key))
  if (input.unreportedClassKeys && (unreportedClasses.length !== classKeys.size || unreportedClasses.length !== state.classReports.length)) {
    return { ok: false, code: 'invalid_choices', message: 'Finish the open class reports or choose “Leave unreported” for each one. Refresh the review if a class has changed.', state }
  }

  let closureKind: 'paper_scored' | 'no_paper'
  let noPaperReason: string | null = null
  if (state.gate.kind === 'paper_scored') closureKind = 'paper_scored'
  else if (state.gate.kind === 'external_mock') {
    // The recorded outcome is the explicit statement; it is stored as the (existing) no-paper closure, labelled as external and self-reported.
    closureKind = 'no_paper'
    noPaperReason = `External mock (self-reported): taken${state.gate.actualDate ? ` on ${state.gate.actualDate}` : ''}${state.gate.reportedResult ? `, result noted: ${state.gate.reportedResult}` : ''}`
  }
  else if (state.gate.kind === 'rehearsal') {
    closureKind = 'no_paper'
    noPaperReason = `PrepPlan rehearsal (both sessions scored) finished on ${state.gate.completedOn}`
  }
  else if (state.gate.kind === 'no_paper_allowed' && input.acknowledgeNoPaper) { closureKind = 'no_paper'; noPaperReason = state.gate.reason }
  else {
    // Captured so an unexplained refusal can be diagnosed: the gate the server saw, the cycle, the clock and the request's flags.
    console.warn('[weekly-review] gate_closed', JSON.stringify({ gate: state.gate, cycleId: input.cycleId, stateCycle: state.cycle.id, now: now.toISOString(), acknowledgeNoPaper: Boolean(input.acknowledgeNoPaper) }))
    return { ok: false, code: 'gate_closed', message: state.gate.kind === 'no_paper_allowed'
      ? 'Confirm that you are closing this week without a paper.' : (state.gate as { reason: string }).reason, state }
  }

  const { actions, errors } = resolveDispositions(state.dueTasks, input.choices)
  if (errors.length > 0) return { ok: false, code: 'invalid_choices', message: errors[0], errors, state }

  const week = await nextWeekFor(userId, state.cycle.endsAt, state.cycle.timezone, now)
  const byId = new Map(state.dueTasks.map(t => [t.id, t]))
  const items: ContinuingItem[] = actions.flatMap(a => {
    if (!a.continuation) return []
    const t = byId.get(a.taskId)!
    return [{ taskId: t.id, title: t.title, taskType: t.taskType, minutes: a.continuation.minutes, intent: a.continuation.intent,
      lmId: t.lmId, outcomeId: t.outcomeId, repairThreadId: t.repairThreadId, originalDate: t.localDate }]
  })

  // 1. Place continuing work around what the student actually has free.
  const context = await loadPlacementContext(userId, week, now)
  const overrides = Object.fromEntries(items.flatMap(i => {
    const d = (input.choices[i.taskId] as { placeDate?: string } | undefined)?.placeDate
    return d ? [[i.taskId, d]] : []
  }))
  const placed = placeContinuing({ items, weekDates: week.days, ...context, overrides })

  // 2. Generate new work around it, and compare with a week that had no continuing work.
  const reserved = { byDate: placed.reservedByDate, studyMinutes: placed.reservedStudyMinutes,
    repairThreadIds: items.filter(i => i.taskType === 'repair' && i.repairThreadId).map(i => i.repairThreadId!),
    // One entry per READING: two sittings of one reading continuing is one reading-level obligation, not two.
    revisionReadingIds: [...new Set(items.filter(i => i.taskType === 'review' && i.lmId && !i.outcomeId).map(i => i.lmId!))] }
  const closingAnswers = { cycleId: state.cycle.id, actions: actions.map(a => ({ taskId: a.taskId, setExecution: a.setExecution, cancel: a.cancel, unknown: a.unknown })) }
  const [baselinePlan, reducedPlan] = await Promise.all([
    buildWeekPlanWithPaper(userId, week, { closingCycleId: state.cycle.id, closingAnswers, now, lighter: input.lighter }),
    buildWeekPlanWithPaper(userId, week, { closingCycleId: state.cycle.id, closingAnswers, reserved, now, lighter: input.lighter }),
  ])
  const baselineRows = await buildCommitRows(userId, week, baselinePlan.days)
  const generated = await buildCommitRows(userId, week, reducedPlan.days)
  const { rows, dropped } = displaceDuplicates(generated, items.map(i => ({ taskType: i.taskType, lmId: i.lmId, outcomeId: i.outcomeId, repairThreadId: i.repairThreadId })))
  const displaced = explainDisplacement(baselineRows, rows)

  // 2b. Class follow-up that never received a task is a durable obligation: it is proposed here as ordinary reviewed next-week work (never silently).
  const today = todayInZone(week.timezone, now)
  const carried = await planOwedClassWork({
    userId, closingCycleId: state.cycle.id, timezone: week.timezone, now,
    dates: context.studyDates.filter(d => d >= today && week.days.includes(d)),
    load: [
      ...rows.map(r => ({ date: String(r.local_date), minutes: Number(r.duration_minutes), placement: r.placement as string | null, startsAt: (r.starts_at as string | null) ?? null })),
      ...placed.placements.flatMap(pl => pl.date ? [{ date: pl.date, minutes: items.find(i => i.taskId === pl.taskId)!.minutes }] : []),
    ],
  })
  const allRows = [...rows, ...carried.rows] as typeof rows

  // 3. Fold each placement into the action the database will apply verbatim.
  const placementOf = new Map(placed.placements.map(p => [p.taskId, p]))
  const finalActions = actions.map(a => a.continuation
    ? { ...a, continuation: { ...a.continuation, placement: { date: placementOf.get(a.taskId)!.date, reason: placementOf.get(a.taskId)!.reason, note: placementOf.get(a.taskId)!.note } } }
    : a)
  const continuing: Continuing[] = finalActions.flatMap(a => a.continuation ? [{
    taskId: a.taskId, title: byId.get(a.taskId)!.title, intent: a.continuation.intent, minutes: a.continuation.minutes,
    provisional: a.continuation.provisional, placement: placementOf.get(a.taskId)!,
  }] : [])

  // Anything this read has moved since the start? Then the answers and the plan could disagree.
  if ((await sourceVersion(userId, state.cycle.id)) !== before) {
    return { ok: false, code: 'changed', message: 'Your week changed while this was being prepared. Nothing was saved; try again.' }
  }

  const proposal = {
    next: { starts_at_local: week.startDate, ends_at_local: week.endDate, timezone: week.timezone, anchor_day: week.anchorDay, rows: allRows },
    actions: finalActions,
    // The receipt keeps what the proposal rested on, so a later week can read it back without guessing.
    adaptation: { lighter: Boolean(input.lighter) },
    recap: { ...state.recap, classReportsLeftUnreported: unreportedClasses, carryover: state.carryover.length, nextWeek: state.next.week, summary: { continuing, displaced, classFollowUp: { placed: carried.placed, waiting: carried.waiting } },
      adaptation: reducedPlan.adaptation && {
        mode: reducedPlan.adaptation.mode, factor: reducedPlan.adaptation.factor, usedCycles: reducedPlan.adaptation.usedCycles, lighter: Boolean(input.lighter),
        optionalMinutes: reducedPlan.adaptation.optionalMinutes, headline: reducedPlan.adaptation.headline, reasons: reducedPlan.adaptation.reasons,
        waiting: reducedPlan.adaptation.waiting.length, ahead: reducedPlan.adaptation.reconciliation?.summary ?? null } },
  }
  const base = {
    user_id: userId, cycle_id: state.cycle.id, closure_kind: closureKind, no_paper_reason: noPaperReason,
    choices: input.choices, proposal, source_version: before,
    // A draft prepared today must not place newly created work yesterday after
    // a midnight acceptance. Keep the existing three-hour lifetime as a ceiling.
    expires_at: new Date(Math.min(now.getTime() + 3 * 3600_000,
      zonedTimeToUtc(addDays(todayInZone(week.timezone, now), 1), '00:00', week.timezone).getTime())).toISOString(),
  }
  // Only one draft per week is ready at a time; a new preview replaces the previous one.
  let inserted: { id: string; expires_at: string } | null = null
  for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
    await admin.from('weekly_transition_drafts').update({ status: 'superseded' }).eq('cycle_id', state.cycle.id).eq('status', 'ready')
    const { data, error } = await admin.from('weekly_transition_drafts').insert(base).select('id, expires_at').single()
    if (!error) inserted = data as { id: string; expires_at: string }
    else if (error.code !== '23505') { console.error('[weekly-review preview] save', error.message); break }
  }
  if (!inserted) return { ok: false, code: 'failed', message: 'Could not save the review. Nothing was changed.' }

  return {
    ok: true, draftId: inserted.id, expiresAt: inserted.expires_at, continuing, displaced, duplicatesRemoved: dropped.length,
    next: {
      week: { startDate: week.startDate, endDate: week.endDate, days: week.days },
      placementDates: week.days.filter(d => d >= todayInZone(week.timezone, now)),
      days: groupByDay(allRows), taskCount: allRows.length, paper: describePaper(reducedPlan.paper, rows), revision: describeRevision(reducedPlan.revision), adaptation: reducedPlan.adaptation,
    },
    classFollowUp: { placed: carried.placed, waiting: carried.waiting },
  }
}

export type AcceptResult =
  | { ok: true; closedCycleId: string; nextCycleId: string; alreadyClosed: boolean; continued: number }
  | { ok: false; code: 'stale' | 'unavailable' | 'already_closed' | 'access' | 'not_found' | 'invalid' | 'failed'; message: string }

/**
 * The one mutation. `db` must be the caller's own session client so the command's auth.uid() checks are the
 * real guard. The request names a saved draft; it never carries task rows.
 */
export async function acceptWeeklyTransition(db: SupabaseClient, draftId: string): Promise<AcceptResult> {
  let response: Awaited<ReturnType<typeof db.rpc>>
  try { response = await db.rpc('accept_weekly_transition', { p_draft_id: draftId }) }
  catch { return { ok: false, code: 'failed', message: 'Save not confirmed. Check your current week before trying again.' } }
  const { data, error } = response
  if (error) {
    if (error.code === '42501') return { ok: false, code: 'access', message: error.message }
    if (error.code === 'P0002') return { ok: false, code: 'not_found', message: 'That review could not be found. Prepare it again.' }
    if (error.code === '22023') return { ok: false, code: 'invalid', message: error.message }
    if (['PGRST202', '42883'].includes(error.code ?? '')) return { ok: false, code: 'failed', message: 'Closing a week is temporarily unavailable while a database update is pending. Nothing was saved.' }
    console.error('[weekly-review accept]', error.message)
    return { ok: false, code: 'failed', message: 'Save not confirmed. Check your current week before trying again.' }
  }
  const r = data as { ok?: boolean; code?: string; closedCycleId?: string; nextCycleId?: string; alreadyClosed?: boolean; continued?: number } | null
  if (r?.ok && r.closedCycleId && r.nextCycleId) {
    return { ok: true, closedCycleId: r.closedCycleId, nextCycleId: r.nextCycleId, alreadyClosed: Boolean(r.alreadyClosed), continued: r.continued ?? 0 }
  }
  if (r?.code === 'STALE_PROPOSAL') return { ok: false, code: 'stale', message: 'Your week changed after this was prepared. Review it again; your answers are kept.' }
  if (r?.code === 'DRAFT_UNAVAILABLE') return { ok: false, code: 'unavailable', message: 'This review has expired. Prepare it again.' }
  if (r?.code === 'ALREADY_CLOSED') return { ok: false, code: 'already_closed', message: 'This week was already closed with a different review.' }
  return { ok: false, code: 'failed', message: 'Save not confirmed. Check your current week before trying again.' }
}
