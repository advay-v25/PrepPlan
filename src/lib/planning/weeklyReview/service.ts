import { ledgerFromCounts, type Ledger } from '../../tests/scoreLedger'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../supabase/admin'
import { addDays, todayInZone, utcToZonedParts, zonedTimeToUtc, type StudyWeek } from '../studyWeek'
import { weekForDate } from '../schedule'
import { buildCommitRows, buildWeekPlanWithPaper, loadOpenFlexible, loadPlacementContext, loadTimedBusy } from '../pulse/generateWeek'
import { gapsAfterAccepted, subtractBusy } from '../pulse/gaps'
import { getClassLogContext } from '../classlog/service'
import { planOwedClassWork, listOwedClassWork, type OwedLine } from '../classlog/carry'
import { isPersistedPaperScope, recheckPersistedPaper, type PaperPlan } from '../pulse/paper'
import { selectDueTasks, type DueTask } from './dueTasks'
import { loggedMinutesByTask } from '../loggedMinutes'
import { displaceDuplicates, resolveDispositions } from './dispositions'
import { toLine, type RevisionLine } from '../../curriculum/revisionQueue'
import type { RevisionOutcome, WeekAdaptation } from '../pulse/generateWeek'
import { explainDisplacement, inOrder, placeContinuing, SPLITTABLE, type ContinuingItem, type Displaced, type Placement, type Sitting } from './composer'
import { activeCycleRow } from '../../ops/sharedReads'
import { withReadSnapshot } from '../../ops/perRequest'
import { loadMockTransition } from '../../exam/mockTransitionService'
import { MOCK_MINUTES } from '../../tests/limits'
import { parseEstimates } from '../../exam/mockTransition'
import { clockOf, fillWindows, parseExtraWindows } from '../extraWindows'
import { occupantsFor } from '../taskService'
import type { MockTransition } from '../../exam/mockTransition'
import { recoveryInputs } from '../recovery/service'
import { recoveryStatus, type PathKey, type RecoveryStatus } from '../recovery/status'
import type { MockWeekPlacement } from '../../exam/mockWeekPlacement'
import type { ForecastWeek, PlacedWork, WorkItem } from '../../exam/runwayForecast'

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
export type RevisionPreview = { phase: string; limit: number; eligible: number; placed: RevisionLine[]; waiting: RevisionLine[]; elsewhere: RevisionLine[]; tradeoffs: string[]; bridge?: RevisionOutcome['bridge'] }

export function describeRevision(r: RevisionOutcome | null): RevisionPreview | null {
  if (!r) return null
  const tradeoffs: string[] = []
  const noRoom = r.waiting.filter(w => w.waitingReason?.startsWith('Due for recall.')).length
  if (noRoom > 0) {
    tradeoffs.push(`${noRoom} reading${noRoom === 1 ? ' chosen' : 's chosen'} for this week did not fit your free time. ${noRoom === 1 ? 'It stays' : 'They stay'} due and ${noRoom === 1 ? 'is' : 'are'} considered again next week.`)
    tradeoffs.push('Keep this mix, try a lighter proposal with less new study, or open Calendar to change your available time.')
  }
  if (r.waiting.length > noRoom) tradeoffs.push('Your other covered readings stay in the rotation for later weeks. None is dropped or marked as forgotten.')
  return { phase: r.phase, limit: r.limit, eligible: r.eligible, placed: r.placed.map(toLine), waiting: r.waiting.slice(0, 8).map(toLine), elsewhere: r.elsewhere.map(toLine), tradeoffs, ...(r.bridge ? { bridge: r.bridge } : {}) }
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
type WeeklyReviewPreviewState = Extract<WeeklyReviewState, { status: 'no_active_cycle' }>
  | Pick<Extract<WeeklyReviewState, { status: 'active' }>, 'status' | 'cycle' | 'gate' | 'dueTasks' | 'classReports' | 'recap' | 'carryover'>
export function getWeeklyReviewState(userId: string, now: Date, mode: 'gate'): Promise<WeeklyReviewGateState>
export function getWeeklyReviewState(userId: string, now: Date, mode: 'preview'): Promise<WeeklyReviewPreviewState>
export function getWeeklyReviewState(userId: string, now?: Date): Promise<WeeklyReviewState>
/** Read-only. Only the actual review/result page needs the next-week preview. */
export async function getWeeklyReviewState(userId: string, now = new Date(), mode?: 'gate' | 'preview'): Promise<WeeklyReviewState | WeeklyReviewGateState | WeeklyReviewPreviewState> {
  const admin = createAdminClient()
  const cycle = await activeCycleRow(userId)
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
  const logged = await loggedMinutesByTask(userId, dueTasks.map(t => t.id))
  for (const t of dueTasks) if (logged.has(t.id)) t.loggedMinutes = logged.get(t.id)

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

  const byExecution: Record<string, number> = {}
  for (const b of all) byExecution[b.execution as string] = (byExecution[b.execution as string] ?? 0) + 1

  const { data: threads } = await admin.from('repair_threads')
    .select('id, status, concept:curriculum_concepts(name)')
    .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck'])
  const carryover = (threads ?? []).map(t => ({
    threadId: t.id as string, status: t.status as string, concept: ((t.concept as any)?.name ?? 'concept') as string,
  }))
  const review = {
    status: 'active' as const, cycle: { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt, timezone },
    gate, dueTasks, classReports, carryover,
    recap: { planned: all.length, byExecution, paper: { present: Boolean(paperBlock), scored, correct, valid, ledger }, external },
  }
  if (mode === 'preview') return review

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
    ...review,
    unloggedClassDays,
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
  /** The student chose to keep broad revision this week instead of the recommended mock. The recommendation is still shown. */
  declineMock?: boolean
  /** A formal recovery path the student chose. Honoured only while recovery is actually offered. */
  recoveryPath?: PathKey | null
  /** The student's own debrief and follow-up estimates ({ debrief, followUp } minutes). Saved with the accepted review. */
  mockEstimates?: unknown
  /** One-off windows added to the proposed week only: [{ date, start: 'HH:MM', end: 'HH:MM' }]. Recurring availability is not changed. */
  extraWindows?: unknown
  /** Offer what is left of the added windows to eligible new study or revision, after the carried work and the mock. Default true. */
  useLeftover?: boolean
  /** The week being closed was a planned break: its unfinished work is still owed, but it does not count as a shortfall. */
  plannedBreak?: boolean
  /** Class reports the student chose to leave unresolved. Does not change any attendance or learning. */
  unreportedClassKeys?: string[]
}

/** The Roadmap's mock recommendation as this proposal applies it: what was placed, what waits, and whether the student turned it off. */
export type MockProposal = {
  verdict: string; headline: string; why: string[]; costOfWaiting: string | null; declined: boolean; keepsBroadRevision: boolean
  tradeoff: string; confidenceNote: string | null; externalRoute: string | null
  estimates: { debrief: number; followUp: number }
  work: { placed: PlacedWork[]; waiting: WorkItem[]; weeks: ForecastWeek[] }
  gaps: { kind: string; name: string; href: string; when: string }[]
  placed: Pick<MockWeekPlacement, 'mock' | 'debrief' | 'followUp'> | null
  waits: { title: string; reason: string }[]
}
const describeMock = (t: MockTransition | null, declined: boolean, placed: MockWeekPlacement | null | undefined): MockProposal | null => !t?.available ? null : ({
  verdict: t.verdict, headline: t.headline, why: t.why, costOfWaiting: t.costOfWaiting, declined, keepsBroadRevision: t.proposal.keepsBroadRevision,
  tradeoff: t.tradeoff, confidenceNote: t.confidence.note, externalRoute: t.externalRoute, estimates: t.estimates,
  work: { placed: t.broadRevision.placed.slice(0, 8), waiting: t.broadRevision.waiting.slice(0, 4), weeks: t.broadRevision.weeks },
  gaps: t.gaps.map(g => ({ kind: g.kind, name: g.name, href: g.href, when: g.when })),
  placed: declined || !placed ? null : { mock: placed.mock, debrief: placed.debrief, followUp: placed.followUp },
  waits: declined ? [] : [...t.proposal.waits.filter(w => !(placed && w.title === 'Part of the mock sequence')), ...(placed?.waits ?? []).map(w => ({ title: `${w.title} (${w.minutes} min)`, reason: w.reason }))],
})

/** Catch-up and recovery as this proposal applies it: the status, what is carried, split or still waiting, and the path chosen. */
export type RecoveryProposal = {
  status: RecoveryStatus
  chosenPath: PathKey | null
  fits: { placedMinutes: number; waitingMinutes: number; carried: { title: string; minutes: number; date: string }[]; split: { title: string; minutes: number; reason: string }[]; waiting: { title: string; minutes: number; reason: string }[] }
}

/** Time added to this week only: what each window takes, what still waits and what that means for revision and mocks. */
export type ExtraTime = {
  windows: { date: string; start: string; end: string; items: { title: string; minutes: number; start: string; /** New study or revision offered for leftover time (optional work). */ isNew: boolean }[]; unusedMinutes: number }[]
  /** Whether leftover time is being offered to new work. */
  useLeftover: boolean
  waiting: { title: string; minutes: number; reason: string }[]
  impact: string[]
}

export type Continuing = {
  taskId: string; title: string; intent: 'continue' | 'later'; minutes: number; provisional: boolean
  /** Where it is proposed to go. `date` null means it stays unplaced, and `reason` says why. */
  placement: Placement
  /** The ordered sittings when the task is saved as more than one; their minutes add up to `minutes`. */
  sittings: Sitting[] | null
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
        mock: MockProposal | null
        recovery: RecoveryProposal | null
        extraTime: ExtraTime | null
        plannedBreak: boolean
      }
    }
  | { ok: false; code: 'no_active_cycle' | 'wrong_cycle' | 'gate_closed' | 'invalid_choices' | 'changed' | 'failed'; message: string; errors?: string[]; state?: WeeklyReviewPreviewState }

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
/** One read snapshot per preview: it writes only the draft at its end, and the source-version check before and after is never cached. */
export const previewWeeklyTransition = (userId: string, input: PreviewInput, now = new Date()): Promise<PreviewResult> => withReadSnapshot(() => prepareWeeklyTransition(userId, input, now))
async function prepareWeeklyTransition(userId: string, input: PreviewInput, now: Date): Promise<PreviewResult> {
  const admin = createAdminClient()
  const before = await sourceVersion(userId, input.cycleId)
  if (!before) return { ok: false, code: 'failed', message: 'Could not prepare the review. Nothing was changed.' }

  const state = await getWeeklyReviewState(userId, now, 'preview')
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
  const estimates = input.mockEstimates === undefined || input.mockEstimates === null ? null : parseEstimates(input.mockEstimates)
  if (input.mockEstimates && !estimates) return { ok: false, code: 'invalid_choices', message: 'Estimates are whole minutes from 15 to 240.', state }
  const [context, timedBusy, openFlexible, recommended, occupants] = await Promise.all([loadPlacementContext(userId, week, now), loadTimedBusy(userId, week), loadOpenFlexible(userId, week), loadMockTransition(userId, now, estimates).catch(() => null),
    Array.isArray(input.extraWindows) && input.extraWindows.length ? occupantsFor(userId, week.days, week.timezone) : []])
  const busy: Record<string, { start: number; end: number; title: string }[]> = {}
  for (const o of occupants) (busy[o.date] ??= []).push({ start: o.start, end: o.start + o.durationMinutes, title: o.title })
  const clockNow = utcToZonedParts(now, week.timezone)
  ;(busy[clockNow.date] ??= []).push({ start: 0, end: clockNow.minutesOfDay, title: 'Time that has already passed' })
  const extra = parseExtraWindows(input.extraWindows, week.days, clockNow.date, busy)
  if (extra.errors.length) return { ok: false, code: 'invalid_choices', message: extra.errors[0], errors: extra.errors, state }
  // The week turns mock-led when the recommendation says to start with gaps, the student keeps it, and a mock can actually go in.
  const mockLed = !input.declineMock && recommended?.available === true && recommended.verdict === 'start_with_gaps'
    && (recommended.feasibility.mockOpening || extra.windows.some(w => w.end - w.start >= MOCK_MINUTES))
  // The catch-up and recovery status as it WILL stand once these answers are saved: the closing week is read as closed, its unfinished work is the carried work.
  const closingAnswers = { cycleId: state.cycle.id, actions: actions.map(a => ({ taskId: a.taskId, setExecution: a.setExecution, cancel: a.cancel, unknown: a.unknown })) }
  const statusWith = async (held: 'protect_core' | null) => recoveryStatus(await recoveryInputs(userId, now, { closing: closingAnswers, plannedBreak: input.plannedBreak === true, path: held, mockLed,
    continuing: actions.flatMap(a => a.continuation ? [{ taskId: a.taskId, minutes: a.continuation.minutes, later: a.continuation.intent === 'later', estimated: a.continuation.provisional, title: byId.get(a.taskId)!.title, taskType: byId.get(a.taskId)!.taskType, readingId: items.find(i => i.taskId === a.taskId)?.lmId ?? null }] : []) }))
  let recStatus = await statusWith(input.recoveryPath === 'protect_core' ? 'protect_core' : null)
  // A path applies only while it is on offer; whether it is offered does not depend on the path.
  if (input.recoveryPath === 'protect_core' && recStatus.level !== 'recovery_offered') recStatus = await statusWith(null)
  const path: PathKey | null = recStatus.level === 'recovery_offered' && (input.recoveryPath === 'steady' || input.recoveryPath === 'protect_core') ? input.recoveryPath : null
  // An added window is reserved for what goes into it, so it is taken out of the regular room first and nothing can be booked there twice.
  const gapsByDate = Object.fromEntries(week.days.map(date => [date, subtractBusy(gapsAfterAccepted(context.gapsByDate[date] ?? [], timedBusy[date] ?? [], openFlexible[date] ?? []), extra.windows.filter(w => w.date === date))]))
  const overrides = Object.fromEntries(items.flatMap(i => {
    const d = (input.choices[i.taskId] as { placeDate?: string } | undefined)?.placeDate
    return d ? [[i.taskId, d]] : []
  }))
  const placed = placeContinuing({ items, weekDates: week.days, ...context, gapsByDate, overrides })
  // What regular room could not hold goes into the added windows FIRST (this is the work the student opened the proposal to recover), in its priority
  // order. Study and revision continue across sittings; a check or repair stays whole. A re-check still waits for its repair.
  const placementFor = new Map(placed.placements.map(p => [p.taskId, p]))
  const owedStill = (i: ContinuingItem) => { const p = placementFor.get(i.taskId)!; return p.sittings ? p.sittings.filter(x => !x.date).reduce((n, x) => n + x.minutes, 0) : p.date ? 0 : i.minutes }
  const waitingItems = items.filter(i => i.intent === 'continue' && overrides[i.taskId] !== 'none' && owedStill(i) > 0 && !/^Its repair/.test(placementFor.get(i.taskId)!.reason ?? ''))
  const carriedFill = fillWindows(extra.windows, waitingItems.map(i => ({ key: i.taskId, title: i.title, minutes: owedStill(i), splittable: SPLITTABLE.includes(i.taskType), kind: SPLITTABLE.includes(i.taskType) ? 'continuing' as const : 'single' as const })), context.maxSittingMinutes)
  for (const item of waitingItems) {
    const filled = carriedFill.placed.filter(f => f.key === item.taskId)
    if (!filled.length) continue
    const p = placementFor.get(item.taskId)!
    const kept: Sitting[] = p.sittings ? p.sittings.filter(x => x.date) : []
    const added: Sitting[] = filled.map(f => ({ date: f.date, minutes: f.minutes, start: f.start, startsAt: zonedTimeToUtc(f.date, clockOf(f.start), week.timezone).toISOString() }))
    const rest = carriedFill.waiting.find(w => w.key === item.taskId)
    const list = inOrder([...kept, ...added, ...(rest ? [{ date: null, minutes: rest.minutes, reason: rest.reason }] : [])])
    const first = list[0]
    Object.assign(p, { date: first.date, reason: null, startsAt: first.startsAt, note: first.startsAt ? `In the window you added, ${clockOf(first.start!)}.` : null, sittings: list.length > 1 ? list : undefined })
    if (['study', 'review', 'class_consolidation'].includes(item.taskType)) placed.reservedStudyMinutes += added.reduce((n, x) => n + x.minutes, 0)
  }
  /** Every sitting of every carried task, whether it is one or several. */
  const sittingsOfTask = (taskId: string) => { const p = placementFor.get(taskId)!; return p.sittings ?? [{ date: p.date, minutes: items.find(i => i.taskId === taskId)!.minutes, startsAt: p.startsAt, reason: p.reason ?? undefined } as Sitting] }

  // 2. Generate new work around it, and compare with a week that had no continuing work.
  const reserved = { byDate: placed.reservedByDate, gapsAfterContinuations: placed.gapsAfterContinuations, studyMinutes: placed.reservedStudyMinutes,
    repairThreadIds: items.filter(i => i.taskType === 'repair' && i.repairThreadId).map(i => i.repairThreadId!),
    // One entry per READING: two sittings of one reading continuing is one reading-level obligation, not two.
    revisionReadingIds: [...new Set(items.filter(i => i.taskType === 'review' && i.lmId && !i.outcomeId).map(i => i.lmId!))] }
  // Protecting core coverage defers revision and lets the carried work lead; a mock still goes ahead only when waiting for it would cost the mock itself.
  const holdMock = path === 'protect_core' && !(recommended?.available && recommended.verdict === 'start_with_gaps')
  const planOptions = { closingCycleId: state.cycle.id, closingAnswers, now, lighter: input.lighter || path === 'protect_core', deferRevision: path === 'protect_core', mock: input.declineMock || holdMock ? null : recommended, mockWindows: carriedFill.remaining, blockedWindows: extra.windows, fillLeftover: input.useLeftover !== false }
  const baseline = buildWeekPlanWithPaper(userId, week, planOptions)
  const [baselinePlan, reducedPlan] = await Promise.all([
    baseline,
    items.length ? buildWeekPlanWithPaper(userId, week, { ...planOptions, reserved }) : baseline,
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
      ...items.flatMap(i => sittingsOfTask(i.taskId).flatMap(x => x.date ? [{ date: x.date, minutes: x.minutes }] : [])),
    ],
  })
  const allRows = [...rows, ...carried.rows] as typeof rows

  // 3. Fold each placement into the action the database will apply verbatim.
  const placementOf = placementFor
  const finalActions = actions.map(a => {
    if (!a.continuation) return a
    const p = placementOf.get(a.taskId)!
    const placement = { date: p.date, reason: p.reason, note: p.note, ...(p.startsAt ? { startsAt: p.startsAt } : {}) }
    if (!p.sittings) return { ...a, continuation: { ...a.continuation, placement } }
    // Several ordered sittings: the first continues the task, the rest follow it. Their minutes add up to what is still owed.
    const label = (n: number) => `${byId.get(a.taskId)!.title} · part ${n + 1} of ${p.sittings!.length}`
    const [first, ...rest] = p.sittings
    return { ...a, continuation: { ...a.continuation, minutes: first.minutes, title: label(0), placement: { ...placement, reason: first.reason ?? null },
      rest: rest.map((x, n) => ({ minutes: x.minutes, title: label(n + 1), date: x.date, startsAt: x.startsAt ?? null })) } }
  })
  const continuing: Continuing[] = finalActions.flatMap(a => a.continuation ? [{
    taskId: a.taskId, title: byId.get(a.taskId)!.title, intent: a.continuation.intent, minutes: items.find(i => i.taskId === a.taskId)!.minutes,
    provisional: a.continuation.provisional, placement: placementOf.get(a.taskId)!,
    sittings: placementOf.get(a.taskId)!.sittings ?? null,
  }] : [])

  // Anything this read has moved since the start? Then the answers and the plan could disagree.
  if ((await sourceVersion(userId, state.cycle.id)) !== before) {
    return { ok: false, code: 'changed', message: 'Your week changed while this was being prepared. Nothing was saved; try again.' }
  }

  const mockProposal = describeMock(recommended, Boolean(input.declineMock) || holdMock, reducedPlan.mock)
  const allSittings = continuing.flatMap(c => sittingsOfTask(c.taskId).map(x => ({ ...x, title: c.title, taskId: c.taskId, reason: x.reason ?? c.placement.reason ?? 'Kept for later.' })))
  const minutesOf = (l: { minutes: number }[]) => l.reduce((n, x) => n + x.minutes, 0)
  const recovery: RecoveryProposal | null = recStatus.level === 'on_track' ? null : {
    status: recStatus, chosenPath: path,
    fits: {
      placedMinutes: minutesOf(allSittings.filter(x => x.date)), waitingMinutes: minutesOf(allSittings.filter(x => !x.date)),
      carried: allSittings.filter(x => x.date).map(x => ({ title: x.title, minutes: x.minutes, date: x.date as string })),
      split: continuing.filter(c => c.sittings).map(c => ({ title: c.title, minutes: c.minutes, reason: `${c.sittings!.length} ordered sittings: ${c.sittings!.map(x => `${x.minutes} min ${x.date ? `on ${x.date}` : 'waiting'}`).join(', ')}.` })),
      waiting: allSittings.filter(x => !x.date).map(x => ({ title: x.title, minutes: x.minutes, reason: x.reason })),
    },
  }
  const mockSlots = reducedPlan.mock ? [
    ...(reducedPlan.mock.mock?.window ? [{ title: 'Mock sitting', ...reducedPlan.mock.mock }] : []),
    ...reducedPlan.mock.debrief.filter(x => x.start !== undefined).map(x => ({ title: 'Debrief the mock', date: x.date, minutes: x.minutes, start: x.start! })),
    ...reducedPlan.mock.followUp.filter(x => x.start !== undefined).map(x => ({ title: 'Follow up on what the mock found', date: x.date, minutes: x.minutes, start: x.start! })),
  ] : []
  const stillWaiting = [
    ...allSittings.filter(x => !x.date).map(x => ({ title: x.title, minutes: x.minutes, reason: x.reason, type: byId.get(x.taskId)!.taskType })),
    ...(input.declineMock || holdMock ? [] : reducedPlan.mock?.waits ?? []).map(w => ({ title: w.title, minutes: w.minutes, reason: w.reason, type: w.kind })),
  ]
  const hoursOf = (m: number) => `${Math.round((m / 60) * 10) / 10} h`
  const waitingWork = stillWaiting.filter(x => !['mock', 'debrief', 'follow_up'].includes(x.type)), waitingMock = stillWaiting.filter(x => ['mock', 'debrief', 'follow_up'].includes(x.type))
  const waitingRevision = (reducedPlan.revision?.waiting.length ?? 0)
  // New work offered for leftover window time, named; and the new work that still waits.
  const offered = reducedPlan.days.flatMap(d => d.portions.filter(p => p.addedTimeNew).map(p => ({ title: p.title, minutes: p.durationMinutes, date: d.date, start: Number(p.paperStart!.slice(0, 2)) * 60 + Number(p.paperStart!.slice(3)), isNew: true })))
  const newWaiting = [
    ...(reducedPlan.adaptation?.waiting ?? []).slice(0, 3).map(w => ({ title: `New study: ${w.name}`, minutes: w.minutes, reason: 'Not in this week’s proposal; it stays in the Roadmap.' })),
    ...(reducedPlan.revision?.waiting ?? []).slice(0, 3).map(r => ({ title: `Revision: ${r.name}`, minutes: 0, reason: 'Due, and waiting for room.' })),
  ]
  const extraTime: ExtraTime | null = !extra.windows.length && !stillWaiting.length ? null : {
    useLeftover: input.useLeftover !== false,
    windows: extra.windows.map(w => {
      const items = [...carriedFill.placed.map(p => ({ ...p, isNew: false })), ...mockSlots.map(m => ({ ...m, isNew: false })), ...offered].filter(p => p.date === w.date && p.start >= w.start && p.start < w.end).sort((a, b) => a.start - b.start)
      return { date: w.date, start: clockOf(w.start), end: clockOf(w.end), items: items.map(i => ({ title: i.title, minutes: i.minutes, start: clockOf(i.start), isNew: i.isNew })), unusedMinutes: w.end - w.start - minutesOf(items) }
    }),
    waiting: [...stillWaiting.map(({ title, minutes, reason }) => ({ title, minutes, reason })), ...(extra.windows.length ? newWaiting : [])],
    impact: [
      waitingWork.length ? `${hoursOf(minutesOf(waitingWork))} of carried work still waits. It stays owed and returns in your next review.` : 'All carried work fits.',
      waitingRevision ? `Revision: ${waitingRevision} due reading${waitingRevision === 1 ? '' : 's'} wait${waitingRevision === 1 ? 's' : ''} for a later week.` : 'Revision: nothing due is pushed back by this.',
      waitingMock.length ? `Mocks: ${hoursOf(minutesOf(waitingMock))} of the mock, debrief or follow-up wait${recommended?.available && recommended.verdict === 'start_with_gaps' ? ', which shortens the time left to act on what a mock finds' : ''}.` : 'Mocks: nothing in the mock sequence waits.',
    ],
  }
  const proposal = {
    next: { starts_at_local: week.startDate, ends_at_local: week.endDate, timezone: week.timezone, anchor_day: week.anchorDay, rows: allRows },
    actions: finalActions,
    // The receipt keeps what the proposal rested on, so a later week can read it back without guessing.
    adaptation: { lighter: Boolean(input.lighter), mock: mockProposal },
    recap: { ...state.recap, plannedBreak: input.plannedBreak === true, mock: mockProposal ? { verdict: mockProposal.verdict, estimates: mockProposal.estimates, declined: mockProposal.declined, led: mockLed } : estimates ? { estimates } : null, extraWindows: extra.windows, recovery: recStatus.level === 'on_track' ? null : { path, level: recStatus.level, owedMinutes: recStatus.numbers.owedMinutes, owedItems: recStatus.numbers.owedItems }, classReportsLeftUnreported: unreportedClasses, carryover: state.carryover.length, nextWeek: { startDate: week.startDate, endDate: week.endDate }, summary: { continuing, displaced, classFollowUp: { placed: carried.placed, waiting: carried.waiting } },
      adaptation: reducedPlan.adaptation && {
        mode: reducedPlan.adaptation.mode, factor: reducedPlan.adaptation.factor, usedCycles: reducedPlan.adaptation.usedCycles, lighter: Boolean(input.lighter),
        optionalMinutes: reducedPlan.adaptation.optionalMinutes, headline: reducedPlan.adaptation.headline, reasons: reducedPlan.adaptation.reasons,
        waiting: reducedPlan.adaptation.waiting.length, waitingWork: reducedPlan.adaptation.waiting.slice(0, 8),
        ahead: reducedPlan.adaptation.reconciliation?.summary ?? null } },
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
      days: groupByDay(allRows), taskCount: allRows.length, paper: describePaper(reducedPlan.paper, rows), revision: describeRevision(reducedPlan.revision), adaptation: reducedPlan.adaptation, mock: mockProposal, recovery, extraTime, plannedBreak: input.plannedBreak === true,
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
