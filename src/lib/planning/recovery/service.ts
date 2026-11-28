import { createAdminClient } from '../../supabase/admin'
import { activeCycleRow, openingReviewRecap, ownedBlocks, profileRow } from '../../ops/sharedReads'
import { perRequest, minuteOf } from '../../ops/perRequest'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import { lastStudyDate } from '../pulse/generateWeek'
import { weekForDate } from '../schedule'
import { bookedMockDemands, savedEstimates, usableDays } from '../usableTime'
import { catchUpFit, type OwedPiece } from './catchUp'
import { forecastStudy, spokenFor, type ReadingTask } from './firstPass'
import { SEEDED_MINUTES_PER_EFFORT_UNIT } from '../../curriculum/roadmap'
import { NEW_CONTENT_DAILY_CAP_EFFORT_UNITS } from '../pulse/generateWeek'
import { addDays, daysBetween } from '../studyWeek'
import { loadExamStatus } from '../../exam/status'
import { loadClosedCycleObservations, type ClosingAnswers } from '../cycleObservationService'
import { OBSERVATION_RULES } from '../cycleObservation'
import { chainOf, terminalIds } from '../taskLineage'
import { loggedMinutesByTask } from '../loggedMinutes'
import { remainingMinutes } from '../weeklyReview/dispositions'
import { RECOVERY, recoveryStatus, type PathKey, type RecoveryInput, type RecoveryStatus } from './status'

const PATHS: PathKey[] = ['steady', 'protect_core', 'next_sitting']
const UNFINISHED = ['not_started', 'in_progress', 'deferred', 'partial']
const WORKLOAD = OBSERVATION_RULES.workload as readonly string[]

/** What the review that opened this week recorded: the recovery path chosen, and whether the student accepted a mock-led week. */
async function acceptedChoices(userId: string, cycleId: string | null): Promise<{ path: PathKey | null; mockLed: boolean }> {
  if (!cycleId) return { path: null, mockLed: false }
  const recap = await openingReviewRecap(userId, cycleId) as { recovery?: { path?: string }; mock?: { led?: boolean } } | null
  const p = recap?.recovery?.path
  return { path: PATHS.includes(p as PathKey) ? (p as PathKey) : null, mockLed: recap?.mock?.led === true }
}

/**
 * The server-owned catch-up and recovery status. One reader for Home, Calendar, the Roadmap, Weekly Review and Coach.
 * The gap is the unfinished, wanted, accepted workload counted once per continuation chain (only the newest link of a chain counts), so work carried
 * across weeks is never counted twice and finishing it, by logged completion, is what closes it.
 */
/** The recovery path accepted for the open week, if any: one narrow read, for callers that need only that. */
export async function acceptedRecoveryPath(userId: string): Promise<PathKey | null> {
  return (await acceptedChoices(userId, ((await activeCycleRow(userId))?.id as string | undefined) ?? null)).path
}

export type PreviewRecovery = {
  /** The cycle being closed: its unfinished blocks are replaced by the continuing work below. */
  closing: ClosingAnswers
  /** Work this review carries into next week or keeps for later: remaining minutes, whether that is PrepPlan's estimate, and the task it continues. */
  continuing: { minutes: number; later: boolean; estimated?: boolean; taskId?: string; title?: string; taskType?: string; readingId?: string | null }[]
  /** The recovery path and mock choice this draft would save. */
  path?: PathKey | null; mockLed?: boolean
  /** The student says the week being closed was a planned break. */
  plannedBreak?: boolean
}

/**
 * The inputs the status is computed from. With `preview`, they are what they WILL be once the review's answers are saved: the closing week is read
 * as closed and its unfinished blocks are the continuing work, so the proposal and the surfaces afterwards say the same thing.
 */
/** The usable time before the mock runway, on Calendar's terms, and whether the owed work fits it. */
async function usableFit(userId: string, o: { now: Date; today: string; daysToExam: number; active: NonNullable<Awaited<ReturnType<typeof getActiveRoadmap>>>; cycle: Awaited<ReturnType<typeof activeCycleRow>>; closingId?: string; owed: OwedPiece[]; revisionPerWeek: number; paperMinutes: number; spoken: Map<string, number>; path: PathKey | null; mockLed: boolean }) {
  const open = o.cycle?.ends_at_local ? String(o.cycle.ends_at_local) : null
  // A review plans from the week after the one it closes; otherwise from today, with the open week's accepted work holding its time.
  const from = o.closingId && open && addDays(open, 1) > o.today ? addDays(open, 1) : o.today
  const end = addDays(o.today, o.daysToExam - RECOVERY.reserveWeeks * 7)
  const [week, profile, estimates, repairs] = await Promise.all([
    weekForDate(userId, from), profileRow(userId), savedEstimates(userId),
    createAdminClient().from('repair_threads').select('id').eq('user_id', userId).in('status', ['open', 'proposed']).throwOnError(),
  ])
  const [usable, blocks] = await Promise.all([usableDays(userId, { from, end, today: o.today, now: o.now, timezone: week.timezone, route: o.active.input.route, horizon: lastStudyDate(o.active.roadmap), excludeCycleId: o.closingId }), ownedBlocks(userId)])
  const planned = new Set(blocks.filter(b => !b.cancelled_at).map(b => b.repair_thread_id).filter(Boolean))
  const unplanned = (repairs.data ?? []).filter(r => !planned.has(r.id as string)).length
  // Weeks with no accepted plan yet are where revision and papers are still only provisional.
  const weeks = Array.from({ length: Math.ceil(usable.days.length ? (daysBetween(from, usable.days[usable.days.length - 1].date) + 1) / 7 : 0) }, (_, n) => addDays(from, n * 7))
    .filter(start => !usable.accepted.some(b => b.local_date >= start && b.local_date <= addDays(start, 6) && !['completed', 'skipped', 'deferred', 'cancelled'].includes(b.execution)))
  const rate = o.active.input.observedMinutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  // The mock-led week is the draft's own week in a review preview, otherwise the open week.
  const classLed = o.active.input.route !== 'self_study'
  const forecast = forecastStudy({ roadmap: o.active.roadmap, modules: o.active.input.modules, from, end, minutesPerEffortUnit: rate, spoken: o.spoken,
    mockLedUntil: o.mockLed ? (o.closingId ? week.endDate : open) : null, classesRunning: classLed && !o.active.input.classesCompletedDate })
  const newStudy = { items: forecast.items, dailyMinutes: Math.round(NEW_CONTENT_DAILY_CAP_EFFORT_UNITS * rate), notCounted: forecast.notCounted, studyFrom: forecast.studyFrom }
  return catchUpFit(usable.days, [...bookedMockDemands(usable.mocks, usable.accepted, estimates), ...(unplanned ? [{ title: 'Open repairs', minutes: unplanned * 30 }] : [])],
    o.owed, { weeks, revisionPerWeek: o.revisionPerWeek, paperMinutes: o.paperMinutes }, Number(profile?.max_session_minutes ?? 180), newStudy, o.path === 'protect_core')
}

export async function recoveryInputs(userId: string, now = new Date(), preview?: PreviewRecovery): Promise<RecoveryInput> {
  // The cheap, already-shared reads first. A student with nothing owed (the common case on Home and Calendar) never pays for the history or capacity reads.
  let unreadable = false
  const [status, blocks, cycle, active] = await Promise.all([loadExamStatus(userId, now), ownedBlocks(userId), activeCycleRow(userId),
    getActiveRoadmap(userId).catch(() => { unreadable = true; return null })])
  // An unbooked student plans toward the sitting's target date.
  const daysToExam = status.daysToExam ?? (active ? daysBetween(status.today, active.roadmap.targetDate) : null)
  const live = blocks.filter(b => !b.cancelled_at && b.task_type && WORKLOAD.includes(b.task_type) && b.priority !== 'optional')
  const terminal = terminalIds(live.map(b => ({ id: b.id, continuedFromId: b.continued_from_task_id })))
  const closingId = preview?.closing.cycleId
  // A carried task saved as several sittings: only the first holds the continuation link, so its siblings are carried work by their split group.
  const carriedGroups = new Set(live.flatMap(b => b.continued_from_task_id && b.scope_group_id ? [b.scope_group_id] : []))
  const owed = live.filter(b => terminal.has(b.id) && UNFINISHED.includes(b.execution) && b.cycle_id !== closingId
    && ((b.local_date !== null && b.local_date < status.today) || b.continued_from_task_id !== null || (b.scope_group_id !== null && carriedGroups.has(b.scope_group_id)) || b.execution === 'deferred' || b.execution === 'partial'))
  const carried = preview?.continuing ?? []
  const nothingOwed = !preview && owed.reduce((n, b) => n + Number(b.duration_minutes ?? 0), 0) < RECOVERY.minOwedMinutes
  const weeks = nothingOwed ? [] : await loadClosedCycleObservations(userId, 4, preview?.closing)

  // Actual minutes stay where they were logged (every link of a chain); the remaining obligation is counted once, on the newest link.
  const nodes = live.map(b => ({ id: b.id, continuedFromId: b.continued_from_task_id }))
  const owedIds = [...owed.map(b => b.id), ...carried.flatMap(c => c.taskId ? [c.taskId] : [])]
  // The same read answers what has been logged on any reading, which the new-study forecast takes off.
  const readingTasks = blocks.filter(b => b.lm_id)
  const logged = nothingOwed ? new Map<string, number>() : await loggedMinutesByTask(userId, [...owedIds.flatMap(id => chainOf(id, nodes)), ...readingTasks.map(b => b.id)])
  const rows = owed.map(b => {
    const mine = logged.get(b.id) ?? 0, planned = Number(b.duration_minutes ?? 0)
    return { minutes: remainingMinutes(planned, mine), estimated: mine > 0 || Boolean(b.estimate_provisional), deferred: b.execution === 'deferred', title: b.title, taskType: b.task_type as string,
      // Work already accepted on a day still ahead holds that time; it is not asking for more.
      held: b.execution !== 'deferred' && b.local_date !== null && b.local_date >= status.today }
  })
  const sum = (l: { minutes: number }[]) => l.reduce((n, x) => n + x.minutes, 0)
  const owedMinutes = sum(rows) + sum(carried)
  const waiting = sum(rows.filter(r => r.deferred)) + sum(carried.filter(c => c.later))
  const estimatedMinutes = sum(rows.filter(r => r.estimated)) + sum(carried.filter(c => c.estimated))
  const loggedOnOwed = [...new Set(owedIds.flatMap(id => chainOf(id, nodes)))].reduce((n, id) => n + (logged.get(id) ?? 0), 0)

  const breaks = new Set<string>()
  if (weeks.length) {
    const { data } = await createAdminClient().from('weekly_reviews').select('cycle_id, recap').eq('user_id', userId).in('cycle_id', weeks.map(w => w.cycleId)).throwOnError()
    for (const r of data ?? []) if ((r.recap as { plannedBreak?: boolean } | null)?.plannedBreak === true) breaks.add(r.cycle_id as string)
    if (preview?.plannedBreak) breaks.add(preview.closing.cycleId)
  }

  // The accepted weekly revision is the closing (or open) week's own non-continued revision; a recovery path may defer it.
  const mine = live.filter(b => (closingId ? b.cycle_id === closingId : cycle && b.cycle_id === cycle.id) && b.continued_from_task_id === null)
  const revision = mine.filter(b => b.task_type === 'review').reduce((n, b) => n + Number(b.duration_minutes ?? 0), 0)

  const choices = preview || nothingOwed ? null : await acceptedChoices(userId, (cycle?.id as string | undefined) ?? null)
  // A removed task, and the closing week's unfinished ones (their remainder is the carried work), hold only what was logged on them. The links stay,
  // so an earlier part of a chain is never counted at its full plan again.
  const answers = new Map((preview?.closing.actions ?? []).map(x => [x.taskId, x]))
  const tasks: ReadingTask[] = readingTasks.map(b => {
    const closing = b.cycle_id === closingId, execution = (closing ? answers.get(b.id)?.setExecution : null) ?? b.execution
    const loggedOnly = Boolean(b.cancelled_at) || (closing && (Boolean(answers.get(b.id)?.cancel) || !['completed', 'skipped'].includes(execution)))
    return { id: b.id, readingId: b.lm_id, taskType: b.task_type, continuedFromId: b.continued_from_task_id,
      execution: loggedOnly ? 'cancelled' : execution, minutes: loggedOnly ? logged.get(b.id) ?? 0 : Number(b.duration_minutes ?? 0) }
  })
  const fit = nothingOwed || daysToExam === null || daysToExam < 0 || !active ? null : await usableFit(userId, {
    now, today: status.today, daysToExam, active, cycle, closingId,
    // Each owed piece once: what already has a future slot is accepted work above; the rest (and what this review carries) still needs room.
    owed: [...rows.filter(r => !r.held), ...carried.map(c => ({ title: c.title ?? 'Carried work', minutes: c.minutes, taskType: c.taskType ?? 'study' }))],
    revisionPerWeek: revision, paperMinutes: Number(blocks.filter(b => b.task_type === 'diagnostic' && !b.cancelled_at).sort((a, b) => (b.local_date ?? '').localeCompare(a.local_date ?? ''))[0]?.duration_minutes ?? 0),
    spoken: spokenFor(tasks, logged, carried.flatMap(c => c.readingId && ['study', 'class_consolidation'].includes(c.taskType ?? '') ? [{ readingId: c.readingId, minutes: c.minutes }] : [])),
    path: preview ? preview.path ?? null : choices?.path ?? null, mockLed: preview ? Boolean(preview.mockLed) : Boolean(choices?.mockLed),
  })

  return {
    weeks: weeks.map(w => ({ executionHigh: w.executionHigh, quality: w.quality, plannedBreak: breaks.has(w.cycleId) })),
    owedMinutes, owedItems: owed.length + carried.length, owedWaitingMinutes: waiting, owedEstimatedMinutes: estimatedMinutes, loggedOnOwedMinutes: loggedOnOwed,
    revisionMinutesPerWeek: revision, fit,
    fitMissing: fit ? undefined : unreadable ? 'unreadable' : daysToExam === null || daysToExam < 0 ? 'no_exam' : 'no_roadmap',
    weeksLeft: daysToExam === null || daysToExam < 0 ? null : Math.floor(daysToExam / 7),
    chosen: choices?.path ?? null,
  }
}

async function loadRecoveryStatusUncached(userId: string, now = new Date()): Promise<RecoveryStatus> {
  return recoveryStatus(await recoveryInputs(userId, now))
}

export const loadRecoveryStatus = perRequest(loadRecoveryStatusUncached, (u: string, n?: Date) => `${u}|${minuteOf(n)}`)
