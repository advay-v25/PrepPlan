import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../supabase/admin'
import { addDays, todayInZone, type StudyWeek, type Weekday } from '../studyWeek'
import { resolvePulseWeek } from '../pulse/weekBoundary'
import { buildCommitRows, buildWeekPlanWithPaper, type DayPlan } from '../pulse/generateWeek'
import { getClassLogContext } from '../classlog/service'
import { isPersistedPaperScope, recheckPersistedPaper, type PaperPlan } from '../pulse/paper'

/**
 * Weekly closure + the week-two loop.
 *
 * Everything here that is not `acceptWeeklyReview` is a pure read: rendering
 * the review page never closes a cycle, resolves a task or creates a week.
 * The single mutation is the accept_weekly_review RPC, which closes the prior
 * cycle, applies the student's task resolutions and opens the next cycle with
 * its tasks in one transaction.
 */

export type Resolution = 'completed' | 'skipped' | 'deferred' | 'unknown'
export const RESOLUTIONS: Resolution[] = ['completed', 'skipped', 'deferred', 'unknown']

export type DueTask = { id: string; title: string; taskType: string; localDate: string | null; execution: string; durationMinutes: number }

export type ReviewGate =
  | { kind: 'paper_scored' }
  | { kind: 'paper_pending'; reason: string }           // a paper exists, can still be assembled, not yet scored
  | { kind: 'no_paper_allowed'; reason: string }        // explicit no-paper closure permitted
  | { kind: 'not_ready'; reason: string }               // cycle has not reached its last day

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
        paper: { present: boolean; scored: boolean; correct: number | null; valid: number | null }
      }
      carryover: { threadId: string; concept: string; status: string }[]
      /** Class days in this cycle with nothing logged (class-led students only). */
      unloggedClassDays: string[]
      next: {
        week: { startDate: string; endDate: string }
        days: PreviewDay[]
        paper: { kind: string; title: string | null; reason: string | null }
        fingerprint: string
        taskCount: number
      }
    }

const OPEN = ['not_started', 'in_progress', 'partial']

function fingerprintOf(days: DayPlan[]): string {
  const flat = days.flatMap(d => d.portions.map(p => [d.date, p.title, p.taskType, p.lmId ?? '', p.repairThreadId ?? '', p.durationMinutes]))
  return createHash('sha1').update(JSON.stringify(flat)).digest('hex').slice(0, 16)
}

function describePaper(paper: PaperPlan, days: DayPlan[]): WeeklyReviewStateNextPaper {
  if (paper.kind === 'none') return { kind: 'none', title: null, reason: paper.reason }
  const p = days.flatMap(d => d.portions).find(x => x.taskType === 'diagnostic')
  return { kind: paper.purpose, title: p?.title ?? null, reason: null }
}
type WeeklyReviewStateNextPaper = { kind: string; title: string | null; reason: string | null }

async function classWeekdaysOf(userId: string): Promise<Weekday[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('calendar_commitments').select('weekdays')
    .eq('user_id', userId).eq('kind', 'class').eq('status', 'active')
  return (data ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[])
}

/** The week after `cycle`, derived through the same pulse-week rule as everything else. */
export async function nextWeekFor(userId: string, cycleEnd: string, timezone: string): Promise<StudyWeek> {
  const classWeekdays = await classWeekdaysOf(userId)
  const week = resolvePulseWeek({ classWeekdays, timezone, reference: addDays(cycleEnd, 1) })
  // A cycle whose end was moved off the pulse day would otherwise overlap its
  // successor; the next week always starts strictly after the closed one ends.
  return week.startDate > cycleEnd ? week : resolvePulseWeek({ classWeekdays, timezone, reference: addDays(week.endDate, 1) })
}

/** Can a paper be started from the student's completed scope right now? (pure read) */
async function startablePaperExists(userId: string, now: Date): Promise<boolean> {
  const { getPaperPreview } = await import('../../tests/paperPreview')
  const preview = await getPaperPreview(userId, undefined, now)
  if (preview.noPaperReason || preview.blueprint.totalQuestions === 0) return false
  const short = new Map(preview.blueprint.bankShortfalls.map(x => [x.readingId, x.available]))
  const deliverable = preview.blueprint.perReading.reduce((n, r) => n + Math.min(r.questions, short.has(r.readingId) ? short.get(r.readingId)! : r.questions), 0)
  return deliverable >= 5
}

/** Read-only. Never writes. */
export async function getWeeklyReviewState(userId: string, now = new Date()): Promise<WeeklyReviewState> {
  const admin = createAdminClient()
  const { data: cycle } = await admin.from('planning_cycles')
    .select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (!cycle || !cycle.ends_at_local) return { status: 'no_active_cycle' }

  const timezone = (cycle.timezone as string | null) ?? 'UTC'
  const today = todayInZone(timezone, now)
  const endsAt = cycle.ends_at_local as string

  const { data: blocks } = await admin.from('plan_blocks')
    .select('id, title, task_type, local_date, execution, duration_minutes, attempt_id, assessment_scope, cancelled_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string)
  const all = (blocks ?? []).filter(b => !b.cancelled_at && b.execution !== 'cancelled')

  const paperBlock = all.find(b => b.task_type === 'diagnostic' && (b.assessment_scope as any)?.kind === 'weekly_paper') ?? null
  let scored = false, correct: number | null = null, valid: number | null = null
  // The weekly paper is whichever weekly attempt of this cycle exists: one started from completed
  // scope (linked by cycle) or the one the planner scheduled (linked by its paper block).
  const { data: cycleAttempts } = await admin.from('assessment_attempts')
    .select('id, status, correct_response_count, valid_response_count, submitted_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string).eq('attempt_kind', 'weekly').order('submitted_at', { ascending: false, nullsFirst: false })
  let attempt: { status: unknown; correct_response_count: unknown; valid_response_count: unknown } | null = (cycleAttempts ?? []).find(a => a.status === 'scored') ?? null
  if (!attempt && paperBlock?.attempt_id) {
    attempt = (await admin.from('assessment_attempts').select('status, correct_response_count, valid_response_count')
      .eq('id', paperBlock.attempt_id as string).eq('user_id', userId).maybeSingle()).data
  }
  if (attempt?.status === 'scored') {
    scored = true
    correct = (attempt.correct_response_count ?? null) as number | null
    valid = (attempt.valid_response_count ?? null) as number | null
  }
  const openWeekly = (cycleAttempts ?? []).some(a => ['ready', 'in_progress'].includes(a.status as string))

  // The closing paper gate.
  let gate: ReviewGate
  if (scored) gate = { kind: 'paper_scored' }
  else if (today < endsAt) gate = { kind: 'not_ready', reason: `Your cycle's last day is ${endsAt}. The review opens once the weekly paper is scored, or on that day.` }
  else if (openWeekly) gate = { kind: 'paper_pending', reason: 'Your weekly paper is in progress — finish it, then come back to close the week.' }
  else if (await startablePaperExists(userId, now)) gate = { kind: 'paper_pending', reason: 'Your weekly paper is ready — take it, then come back to close the week.' }
  else if (!paperBlock) gate = { kind: 'no_paper_allowed', reason: 'No paper could be assembled this week: nothing completed and mapped can be tested, or the question bank cannot support one.' }
  else if (!isPersistedPaperScope(paperBlock.assessment_scope)) gate = { kind: 'no_paper_allowed', reason: 'This paper has no recorded scope to check against the question bank.' }
  else {
    const recheck = await recheckPersistedPaper(userId, paperBlock.assessment_scope)
    gate = recheck.ok
      ? { kind: 'paper_pending', reason: 'Your weekly paper is ready — take it, then come back to close the week.' }
      : { kind: 'no_paper_allowed', reason: recheck.reason }
  }

  const dueTasks: DueTask[] = all
    .filter(b => b.id !== paperBlock?.id && OPEN.includes(b.execution as string) && (b.local_date as string) <= endsAt)
    .map(b => ({
      id: b.id as string, title: b.title as string, taskType: (b.task_type ?? 'study') as string,
      localDate: (b.local_date ?? null) as string | null, execution: b.execution as string,
      durationMinutes: (b.duration_minutes ?? 30) as number,
    }))
    .sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? ''))

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

  // Preview of next week: the same generator, read-only, with this cycle treated as closing.
  const week = await nextWeekFor(userId, endsAt, timezone)
  const { days, paper } = await buildWeekPlanWithPaper(userId, week, { closingCycleId: cycle.id as string })

  return {
    status: 'active',
    cycle: { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt, timezone },
    gate,
    dueTasks,
    recap: { planned: all.length, byExecution, paper: { present: Boolean(paperBlock), scored, correct, valid } },
    carryover,
    unloggedClassDays,
    next: {
      week: { startDate: week.startDate, endDate: week.endDate },
      days: days.map(d => ({
        date: d.date,
        items: d.portions.map(p => ({ title: p.title, taskType: p.taskType, minutes: p.durationMinutes })),
      })),
      paper: describePaper(paper, days),
      fingerprint: fingerprintOf(days),
      taskCount: days.reduce((s, d) => s + d.portions.length, 0),
    },
  }
}

export type AcceptInput = {
  cycleId: string
  resolutions: Record<string, Resolution>
  previewFingerprint: string
  /** The student's explicit acknowledgement that they are closing without a paper. */
  acknowledgeNoPaper?: boolean
}

export type AcceptResult =
  | { ok: true; closedCycleId: string; nextCycleId: string; alreadyClosed: boolean }
  | { ok: false; code: 'no_active_cycle' | 'wrong_cycle' | 'gate_closed' | 'unresolved_tasks' | 'preview_changed' | 'next_week_empty' | 'invalid' | 'failed'; message: string; state?: WeeklyReviewState }

/**
 * The one mutation. `db` must be the caller's own session client so the RPC's
 * auth.uid() ownership check is the real guard; the plan is recomputed here so
 * the client can never supply task rows.
 */
export async function acceptWeeklyReview(db: SupabaseClient, userId: string, input: AcceptInput): Promise<AcceptResult> {
  // Idempotent replay: a cycle that already has a review returns its result.
  const admin = createAdminClient()
  const { data: existing } = await admin.from('weekly_reviews')
    .select('cycle_id, next_cycle_id').eq('user_id', userId).eq('cycle_id', input.cycleId).maybeSingle()
  if (existing) {
    return { ok: true, closedCycleId: existing.cycle_id as string, nextCycleId: existing.next_cycle_id as string, alreadyClosed: true }
  }

  for (const v of Object.values(input.resolutions)) {
    if (!RESOLUTIONS.includes(v)) return { ok: false, code: 'invalid', message: 'Unknown task resolution.' }
  }

  const state = await getWeeklyReviewState(userId)
  if (state.status !== 'active') return { ok: false, code: 'no_active_cycle', message: 'There is no open week to close.' }
  if (state.cycle.id !== input.cycleId) return { ok: false, code: 'wrong_cycle', message: 'That week is no longer the open one.', state }

  let closureKind: 'paper_scored' | 'no_paper'
  let noPaperReason: string | null = null
  if (state.gate.kind === 'paper_scored') closureKind = 'paper_scored'
  else if (state.gate.kind === 'no_paper_allowed' && input.acknowledgeNoPaper) { closureKind = 'no_paper'; noPaperReason = state.gate.reason }
  else {
    return { ok: false, code: 'gate_closed', message: state.gate.kind === 'no_paper_allowed'
      ? 'Confirm that you are closing this week without a paper.' : (state.gate as any).reason, state }
  }

  const missing = state.dueTasks.filter(t => !input.resolutions[t.id])
  if (missing.length > 0) {
    return { ok: false, code: 'unresolved_tasks', message: `${missing.length} task${missing.length === 1 ? '' : 's'} still need an answer: completed, skipped, deferred or unknown.`, state }
  }
  if (state.next.fingerprint !== input.previewFingerprint) {
    return { ok: false, code: 'preview_changed', message: 'Next week changed since you previewed it. Review it again before confirming.', state }
  }
  if (state.next.taskCount === 0) {
    return { ok: false, code: 'next_week_empty', message: 'The planner has no work to place next week yet, so there is nothing to activate.', state }
  }

  // Only resolutions for tasks that are actually due are sent.
  const dueIds = new Set(state.dueTasks.map(t => t.id))
  const resolutions = Object.fromEntries(Object.entries(input.resolutions).filter(([id]) => dueIds.has(id)))

  const week = await nextWeekFor(userId, state.cycle.endsAt, state.cycle.timezone)
  const { days } = await buildWeekPlanWithPaper(userId, week, { closingCycleId: state.cycle.id })
  const rows = await buildCommitRows(userId, week, days)

  const { data, error } = await db.rpc('accept_weekly_review', {
    p_cycle_id: state.cycle.id,
    p_closure_kind: closureKind,
    p_no_paper_reason: noPaperReason,
    p_resolutions: resolutions,
    p_recap: { ...state.recap, carryover: state.carryover.length, nextWeek: state.next.week },
    p_next: {
      starts_at_local: week.startDate, ends_at_local: week.endDate, timezone: week.timezone,
      anchor_day: week.anchorDay, rows,
    },
  })
  if (error || !data) {
    const msg = error?.message ?? ''
    if (/Unresolved tasks/.test(msg)) return { ok: false, code: 'unresolved_tasks', message: 'Some due tasks still need an answer.' }
    if (/not been scored|Unauthorized|not active|no-paper|scored; close/.test(msg)) return { ok: false, code: 'gate_closed', message: 'This week can no longer be closed that way.' }
    console.error('[weekly-review accept]', msg)
    return { ok: false, code: 'failed', message: 'Could not close the week. Nothing was changed — try again.' }
  }
  const r = data as { closed_cycle_id: string; next_cycle_id: string; already_closed: boolean }
  return { ok: true, closedCycleId: r.closed_cycle_id, nextCycleId: r.next_cycle_id, alreadyClosed: r.already_closed }
}
