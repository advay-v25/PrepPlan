import { createAdminClient } from '../supabase/admin'
import { createClient } from '../supabase/server'
import { executeTaskCommand, ExecutionCommandError, RevisionMismatchError, type ExecutionInput } from './executionCommand'
import { taskScopeCommand } from './taskScopeCommands'
export { RevisionMismatchError } from './executionCommand'
import { getStudyWeekContext } from './schedule'
import { parseLocalDate, utcToZonedParts, zonedTimeToUtc } from './studyWeek'
import {
  Occupant, findConflicts, suggestSlots, validateDuration, validateStart,
  expandCommitment, manualPlacementWarnings, type CommitmentException, type RecurringCommitment,
} from './mutations'
import { redistributeMissedTask, reverseRedistribution } from './pulse/redistribute'
import { calendarOccupantHref, calendarTaskHref } from '../routing/calendar'

/**
 * Task mutation, with the two guarantees C2 exists to provide:
 *
 *   1. A write carries the revision it read. If the row moved on since, the
 *      write is refused and the caller is handed the current state — two
 *      devices cannot silently overwrite each other.
 *
 *   2. Execution changes commit the task and its event atomically through an
 *      owned RPC. Splits are atomic too. Move, delete and undo still use separate legacy writes;
 *      they must not be described as transactional until migrated and tested.
 */

export class TaskConflictError extends Error {
  constructor(message: string, readonly conflicts: any[], readonly suggestions: any[]) {
    super(message)
    this.name = 'TaskConflictError'
  }
}

export type TaskRow = {
  id: string
  title: string
  local_date: string | null
  starts_at: string | null
  duration_minutes: number | null
  placement: string | null
  execution: string | null
  task_type: string | null
  revision: number
  is_protected_commitment: boolean
}

const SELECT = 'id, title, local_date, starts_at, duration_minutes, placement, execution, task_type, revision, is_protected_commitment, cycle_id, priority, origin, detail, rationale, scope_group_id, continued_from_task_id, learning_activity_id'

async function loadTask(userId: string, taskId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('plan_blocks').select(SELECT).eq('id', taskId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Everything already occupying the days a change touches: protected
 * commitments (including expanded recurrences) and other timed tasks.
 */
/** The task that continues this one in a later week, if any. */
async function successorOf(userId: string, taskId: string) {
  const { data, error } = await createAdminClient().from('plan_blocks')
    .select('id, title, cycle_id, local_date, execution').eq('user_id', userId).eq('continued_from_task_id', taskId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/** A task that has been continued is history. Refuse to change it, with a reason a student can act on. */
async function assertNotContinued(userId: string, taskId: string) {
  const task = await loadTask(userId,taskId)
  if (task?.learning_activity_id) throw new ExecutionCommandError('This is recorded learning. Remove an incorrect log and record it again.',409,'RECORDED_LEARNING')
  if (await successorOf(userId, taskId)) {
    throw new ExecutionCommandError('This task continues in a later week and can no longer be changed here. Open the continuation instead.', 409, 'CONTINUED')
  }
}

export async function occupantsFor(userId: string, dates: string[], timezone: string): Promise<Occupant[]> {
  const admin = createAdminClient()
  const out: Occupant[] = []
  if (dates.length === 0) return out

  const from = dates.slice().sort()[0]
  const to = dates.slice().sort()[dates.length - 1]

  const { data: tasks } = await admin
    .from('plan_blocks')
    .select('id, title, local_date, starts_at, duration_minutes, placement, is_protected_commitment')
    .eq('user_id', userId)
    .is('cancelled_at', null)   // a cancelled task no longer holds its time
    .gte('local_date', from)
    .lte('local_date', to).throwOnError()

  for (const t of tasks ?? []) {
    if (t.placement !== 'timed' || !t.starts_at) continue
    const parts = utcToZonedParts(new Date(t.starts_at as string), timezone)
    out.push({
      id: t.id as string,
      title: t.title as string,
      date: (t.local_date as string) ?? parts.date,
      start: parts.minutesOfDay,
      durationMinutes: (t.duration_minutes ?? 30) as number,
      isProtected: Boolean(t.is_protected_commitment),
      kind: 'task',
    })
  }

  // One-off commitments.
  const { data: oneOffs } = await admin
    .from('calendar_commitments')
    .select('id, label, kind, starts_at, ends_at, is_protected, recurrence')
    .eq('user_id', userId).eq('status', 'active').eq('recurrence', 'none').throwOnError()
  for (const c of oneOffs ?? []) {
    const s = utcToZonedParts(new Date(c.starts_at as string), timezone)
    const e = utcToZonedParts(new Date(c.ends_at as string), timezone)
    if (!dates.includes(s.date)) continue
    out.push({
      id: c.id as string, title: c.label as string, date: s.date, start: s.minutesOfDay,
      durationMinutes: Math.max(15, e.date === s.date ? e.minutesOfDay - s.minutesOfDay : 24 * 60 - s.minutesOfDay),
      isProtected: Boolean(c.is_protected), kind: c.kind === 'class' ? 'class' : 'commitment',
    })
  }

  // Recurring commitments, expanded across the affected dates.
  const { data: series } = await admin
    .from('calendar_commitments')
    .select('id, label, kind, is_protected, recurrence, weekdays, start_time, end_time, starts_on, ends_on')
    .eq('user_id', userId).eq('status', 'active').eq('recurrence', 'weekly').throwOnError()

  const seriesIds = (series ?? []).map(s => s.id as string)
  const { data: exceptionRows } = seriesIds.length
    ? await admin.from('commitment_exceptions').select('*').in('commitment_id', seriesIds).throwOnError()
    : { data: [] as any[] }

  const exceptions: CommitmentException[] = (exceptionRows ?? []).map(e => ({
    commitmentId: e.commitment_id as string,
    occurrenceDate: e.occurrence_date as string,
    kind: e.kind as 'skipped' | 'moved',
    newDate: (e.new_date ?? null) as string | null,
    newStartTime: (e.new_start_time ?? null) as string | null,
    newEndTime: (e.new_end_time ?? null) as string | null,
  }))

  for (const s of series ?? []) {
    const commitment: RecurringCommitment = {
      id: s.id as string, label: s.label as string, kind: s.kind as string,
      isProtected: Boolean(s.is_protected), recurrence: 'weekly',
      weekdays: ((s.weekdays ?? []) as number[]),
      startTime: (s.start_time ?? null) as string | null,
      endTime: (s.end_time ?? null) as string | null,
      startsOn: (s.starts_on ?? null) as string | null,
      endsOn: (s.ends_on ?? null) as string | null,
    }
    for (const o of expandCommitment(commitment, dates, exceptions)) {
      out.push({
        id: `${o.commitmentId}@${o.date}`, title: o.label, date: o.date, start: o.start,
        durationMinutes: o.durationMinutes, isProtected: o.isProtected,
        kind: o.kind === 'class' ? 'class' : 'commitment',
      })
    }
  }

  // A booked mock or rehearsal with a clock time holds that time (protected: a task cannot be put over it). One without a time holds the day only.
  const { data: mocks } = await admin
    .from('mock_appointments')
    .select('id, label, kind, planned_date, start_time, duration_minutes')
    .eq('user_id', userId).eq('status', 'planned').gte('planned_date', from).lte('planned_date', to).not('start_time', 'is', null).throwOnError()
  for (const m of mocks ?? []) {
    if (!dates.includes(m.planned_date as string)) continue
    const [h, mi] = String(m.start_time).split(':').map(Number)
    out.push({
      id: `mock:${m.id}`, title: (m.label as string | null) ?? 'Your mock', date: m.planned_date as string, start: h * 60 + mi,
      durationMinutes: (m.duration_minutes ?? 180) as number, isProtected: true, kind: 'mock',
    })
  }

  return out
}

/**
 * Work belongs to the cycle it was planned in. A date outside that cycle's own dates is a different week's plan: it is carried through the
 * weekly review (a new linked task), never by editing the date here, so history and the closed week stay as they were.
 */
export async function assertDateInCycle(userId: string, cycleId: string | null, date: string) {
  if (!parseLocalDate(date)) throw new Error('Choose a valid date.')
  if (!cycleId) return
  const { data: cycle } = await createAdminClient().from('planning_cycles').select('starts_at_local, ends_at_local').eq('id', cycleId).eq('user_id', userId).maybeSingle()
  if (cycle?.starts_at_local && cycle.ends_at_local && (date < cycle.starts_at_local || date > cycle.ends_at_local)) {
    throw new Error(`That day is outside this plan (${cycle.starts_at_local} to ${cycle.ends_at_local}). To carry the task into another week, use the weekly review.`)
  }
}

async function recordEvent(
  userId: string, taskId: string, eventType: string,
  payload: Record<string, unknown>, previous: Record<string, unknown>,
  actualDurationMinutes?: number
) {
  const admin = createAdminClient()
  const { error } = await admin.from('task_events').insert({
    user_id: userId, task_id: taskId, event_type: eventType, payload, previous,
    ...(actualDurationMinutes === undefined ? {} : { actual_duration_minutes: actualDurationMinutes }),
  })
  // Loud, not silent. History that quietly stops recording is indistinguishable
  // from a task that was never touched — and undo depends on it.
  if (error) console.error(`[task_events] could not record "${eventType}":`, error.message)
}

/** The values an undo would restore, captured before a write. */
function snapshot(task: any) {
  return {
    local_date: task.local_date, starts_at: task.starts_at,
    duration_minutes: task.duration_minutes, placement: task.placement,
    execution: task.execution, revision: task.revision,
  }
}

export type MoveInput = {
  /** Local date, YYYY-MM-DD. */
  date: string
  /** Minutes from local midnight; null makes the task day-preferred. */
  startMinutes: number | null
  durationMinutes?: number
  expectedRevision: number
  /** Set once the student has seen a non-protected conflict and chosen to continue. */
  acceptWarnings?: boolean
}

/**
 * Moves and/or resizes a task.
 *
 * Refuses to overlap a protected commitment, and says where it could go
 * instead. A clash with another *task* is a warning, not a refusal — the
 * student may legitimately want two things in one slot and then fix it.
 */
export async function moveTask(userId: string, taskId: string, input: MoveInput) {
  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  await assertNotContinued(userId, taskId)
  if (task.revision !== input.expectedRevision) throw new RevisionMismatchError(task)

  const ctx = await getStudyWeekContext(userId)
  const timezone = ctx.timezone
  if (input.date !== task.local_date) await assertDateInCycle(userId, task.cycle_id as string | null, input.date)

  // Unfinished work is placed today or later. Learning that already happened is recorded through Log learning, not by dragging an open task
  // into the past (the founder rules forbid inventing past Calendar tasks or time). A task that is already dated earlier may be resized or
  // kept where it is; its history and links stay as they were.
  if (task.execution !== 'completed' && input.date < ctx.today && input.date !== task.local_date) {
    throw new Error('Choose today or a later day for unfinished work. If this already happened, record it with Log learning.')
  }

  const duration = input.durationMinutes ?? task.duration_minutes ?? 30
  const validDuration = validateDuration(duration, task.duration_minutes)
  if (!validDuration.ok) throw new Error(validDuration.error)

  let startsAt: string | null = null
  let placement: 'timed' | 'day_preferred' = 'day_preferred'
  const warnings: { title: string; overlapMinutes: number }[] = []

  if (input.startMinutes !== null) {
    const validStart = validateStart(input.startMinutes)
    if (!validStart.ok) throw new Error(validStart.error)

    const candidate = { date: input.date, start: validStart.value, durationMinutes: validDuration.value }
    const occupants = await occupantsFor(userId, [input.date], timezone)

    const blocking = findConflicts(candidate, occupants, { ignoreIds: [taskId], protectedOnly: true })
    if (blocking.length > 0) {
      const suggestions = suggestSlots(candidate, occupants, { ignoreIds: [taskId] })
      throw new TaskConflictError(
        `${blocking[0].occupant.title} is already there, and it is protected.`,
        blocking.map(c => ({ title: c.occupant.title, kind: c.occupant.kind, overlapMinutes: c.overlapMinutes, href: calendarOccupantHref(c.occupant.id, c.occupant.kind, c.occupant.date) })),
        suggestions
      )
    }

    if (!input.acceptWarnings) {
      const soft = findConflicts(candidate, occupants, { ignoreIds: [taskId] })
        .filter(c => !c.occupant.isProtected)
      warnings.push(...soft.map(c => ({ title: c.occupant.title, overlapMinutes: c.overlapMinutes })))
    }

    const time = `${String(Math.floor(validStart.value / 60)).padStart(2, '0')}:${String(validStart.value % 60).padStart(2, '0')}`
    startsAt = zonedTimeToUtc(input.date, time, timezone).toISOString()
    placement = 'timed'
  }

  if (!input.acceptWarnings) {
    warnings.push(...await windowWarnings(userId, input.date, startsAt ? utcToZonedParts(new Date(startsAt), timezone).minutesOfDay : null, validDuration.value))
    if (warnings.length) return { needsConfirmation: true as const, warnings }
  }

  // The write, its protected-time and mock checks and its history event are ONE database command under the per-student scope lock
  // (apply_task_move, shared with the Coach's confirmation). The TypeScript checks above only produce suggestions and the soft warning.
  const { data: res, error } = await createAdminClient().rpc('apply_task_move', {
    p_user: userId, p_task: taskId, p_revision: input.expectedRevision, p_date: input.date, p_starts: startsAt, p_minutes: validDuration.value, p_strict: false, p_source: 'calendar',
  })
  if (error) throw new Error(error.message)
  const r = res as { ok: boolean; code?: string; title?: string; start?: string; end?: string; task?: any; reopened?: boolean }
  if (!r.ok) {
    if (r.code === 'REVISION' || r.code === 'NOT_FOUND') throw new RevisionMismatchError(await loadTask(userId, taskId))
    if (r.code === 'PROTECTED' || r.code === 'MOCK') {
      const occ = await occupantsFor(userId, [input.date], timezone)
      const cand = { date: input.date, start: input.startMinutes ?? 0, durationMinutes: validDuration.value }
      const conflicts = findConflicts(cand, occ, { ignoreIds: [taskId], protectedOnly: true }).map(c => ({ title: c.occupant.title, kind: c.occupant.kind, overlapMinutes: c.overlapMinutes, href: calendarOccupantHref(c.occupant.id, c.occupant.kind, c.occupant.date) }))
      throw new TaskConflictError(`${r.title || 'Your mock'} is already there, and it is protected.`, conflicts.length ? conflicts : [{ title: r.title || 'Protected time', kind: r.code === 'MOCK' ? 'mock' : 'commitment', overlapMinutes: 0 }], suggestSlots(cand, occ, { ignoreIds: [taskId] }))
    }
    if (r.code === 'RECORDED') throw new ExecutionCommandError('This is recorded learning. Remove an incorrect log and record it again.', 409, 'RECORDED_LEARNING')
    if (r.code === 'CONTINUED') throw new ExecutionCommandError('This task continues in a later week and can no longer be changed here. Open the continuation instead.', 409, 'CONTINUED')
    if (r.code === 'ORDER') throw new ExecutionCommandError(`That would break the order you planned: ${r.title}. Move the other sitting first, or choose a different day.`, 409, 'SITTING_ORDER', calendarTaskHref(taskId, task.local_date ?? undefined))
    if (r.code === 'OUTSIDE_CYCLE') throw new Error(`That day is outside this plan (${r.start} to ${r.end}). To carry the task into another week, use the weekly review.`)
    if (r.code === 'PAST') throw new Error('Choose today or a later day for unfinished work. If this already happened, record it with Log learning.')
    throw new Error(r.code === 'CANCELLED' ? 'This task was cancelled.' : 'That placement is no longer valid. Reload the calendar and try again.')
  }
  const data = r.task, reopen = Boolean(r.reopened)
  // Having chosen its own time, the work no longer needs the minutes that were added elsewhere to carry it: take back exactly those.
  const reversal = reopen ? await reverseRedistribution(userId, taskId) : null

  return { task: data, needsConfirmation: false as const, reopened: reopen, outcome: reopen ? { message: `Placed on ${input.date} and open again.${reversal?.message ? ' ' + reversal.message : ''}` } : null }
}

export type { ExecutionInput } from './executionCommand'

/**
 * Records what actually happened to a task.
 *
 * Partial stays partial: it is not rounded up to complete, and it does not
 * become a fresh full task next week. Completing a study task deliberately
 * creates no evidence — only a diagnostic does that.
 */
export async function setExecution(userId: string, taskId: string, input: ExecutionInput) {
  await assertNotContinued(userId, taskId)
  // Request-scoped JWT: ownership, verified email and setup are enforced again
  // inside the RPC. Never fall back to separate admin writes if it is missing.
  const result = await executeTaskCommand(await createClient(), userId, taskId, input)

  // What actually happened, in words the student can act on: the receipt reports only what was committed.
  let outcome: { message: string; redistribution: { applied: boolean; reason: string | null; placedMinutes?: number; changes?: unknown[] } | null } | null = null
  if (!result.replayed && (input.execution === 'skipped' || input.execution === 'deferred')) {
    const verb = input.execution === 'skipped' ? 'skipped' : 'deferred'
    try {
      const r = await redistributeMissedTask(userId, taskId)
      outcome = {
        redistribution: { applied: r.applied, reason: r.reason, placedMinutes: r.placed, changes: r.changes },
        message: r.applied
          ? `Saved as ${verb}. ${r.message} Undo takes that back.`
          : `Saved as ${verb}. ${r.message}${input.execution === 'deferred' ? ' You can choose another time for it.' : ''}`,
      }
    } catch {
      console.error('[redistribute] Task saved; the week was not adjusted.')
      outcome = { redistribution: { applied: false, reason: 'The adjustment failed.' }, message: `Saved as ${verb}. Calendar could not adjust the rest of the week, so nothing moved.` }
    }
  }
  return { ...result, outcome }
}

/**
 * Splits a task into two sittings, preserving scope.
 *
 * The original is shortened and a second task carries the remainder. Neither
 * covers less than the original did between them.
 */
export async function splitExisting(userId: string, taskId: string, expectedRevision: number, at?: number) {
  await assertNotContinued(userId, taskId)
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || (at !== undefined && !Number.isInteger(at))) throw new Error('Use a valid revision and whole-minute split point.')
  const result = await taskScopeCommand(await createClient(), 'split_study_task', {
    p_user_id: userId, p_task_id: taskId, p_expected_revision: expectedRevision, p_first_minutes: at ?? null,
  })
  return { first: result.task, secondId: result.secondId }
}

export async function deleteTask(userId: string, taskId: string, expectedRevision: number) {
  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.revision !== expectedRevision) throw new RevisionMismatchError(task)
  if (task.learning_activity_id) {
    const {data,error} = await (await createClient()).rpc('cancel_learning_sitting',{p_task_id:taskId,p_expected_revision:expectedRevision})
    if(error)throw new ExecutionCommandError('Could not confirm removal. Refresh this sitting before trying again.',503,'SAVE_UNCONFIRMED')
    if(data?.code==='REVISION_MISMATCH')throw new RevisionMismatchError(data.current)
    if(!data?.ok)throw new ExecutionCommandError('Could not confirm removal.',503,'SAVE_UNCONFIRMED')
    return {deleted:false,cancelled:true as const,task:await loadTask(userId,taskId)}
  }
  await assertNotContinued(userId, taskId)

  // A continuation carries the lineage of earlier weeks, so it is removed from the plan rather than erased:
  // the earlier occurrence must never look like the only record, and the history stays explainable.
  if ((task as any).continued_from_task_id) {
    const { data, error } = await createAdminClient().from('plan_blocks')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', taskId).eq('user_id', userId).eq('revision', expectedRevision).select(SELECT).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new RevisionMismatchError(await loadTask(userId, taskId))
    await recordEvent(userId, taskId, 'cancelled', { reason: 'removed_from_plan' }, snapshot(task))
    return { deleted: false, cancelled: true as const, task: data }
  }

  const admin = createAdminClient()
  // Record before deleting: task_events cascades on task deletion, so the
  // history row is written against a task that is about to disappear. It is
  // kept in the deleted payload instead.
  await admin.from('coach_proposals').insert({
    user_id: userId,
    intent: 'task_deleted',
    origin: 'coach',
    reasoning: `Removed "${task.title}" from the calendar.`,
    proposed_changes: { taskId, task },
    status: 'executed',
    executed_at: new Date().toISOString(),
  })

  const { error } = await admin
    .from('plan_blocks').delete()
    .eq('id', taskId).eq('user_id', userId).eq('revision', expectedRevision)
  if (error) throw new Error(error.message)

  return { deleted: true, cancelled: false as const, task }
}

/** Reverses the most recent change to a task, using the previous values it stored. */
export async function undoLast(userId: string, taskId: string) {
  await assertNotContinued(userId, taskId)
  const admin = createAdminClient()
  const { data: events } = await admin
    .from('task_events')
    .select('id, event_type, payload, previous, created_at')
    .eq('user_id', userId).eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)

  const last = events?.[0]
  if (!last) throw new Error('There is nothing to undo for this task')
  if (last.event_type === 'split') throw new Error('Both sittings share one learning task. Move the remaining sitting rather than undoing only one half of the split.')
  if (last.payload?.kind === 'scope_confirmation') throw new Error('Review the covered outcomes in Tests to change this confirmation.')

  const previous = (last.previous ?? {}) as Record<string, any>
  if (Object.keys(previous).length === 0) {
    throw new Error('That change cannot be undone automatically')
  }

  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')

  const { data, error } = await admin
    .from('plan_blocks')
    .update({
      local_date: previous.local_date ?? null,
      day: previous.local_date ?? task.local_date,
      starts_at: previous.starts_at ?? null,
      duration_minutes: previous.duration_minutes ?? task.duration_minutes,
      duration: String(previous.duration_minutes ?? task.duration_minutes ?? 30),
      placement: previous.placement ?? task.placement,
      execution: previous.execution ?? task.execution,
    })
    .eq('id', taskId).eq('user_id', userId)
    .select(SELECT).maybeSingle()

  if (error) throw new Error(error.message)
  // Name the exact event undone, so reported time reverses precisely that report (and an undo of an undo restores it).
  await recordEvent(userId, taskId, 'undone', { undid: last.event_type, undid_event_id: last.id }, snapshot(task))
  // Undoing a deferral or skip takes back exactly the minutes it had added to later sessions, and says so.
  const reversal = ['deferred', 'skipped', 'placed'].includes(last.event_type) ? await reverseRedistribution(userId, taskId) : null
  return { task: data, outcome: reversal?.message ? { message: reversal.message } : null }
}

/** The one-time "outside your usual windows / above your usual limit" warning, shared by move and creation. Never blocks; protected time is separate. */
async function windowWarnings(userId: string, date: string, startMinutes: number | null, duration: number) {
  const admin = createAdminClient(), weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const [profile, windows] = await Promise.all([
    admin.from('profiles').select('max_session_minutes').eq('id', userId).single().throwOnError(),
    admin.from('availability_windows').select('start_time,end_time').eq('user_id', userId).eq('weekday', weekday).eq('status', 'active').throwOnError(),
  ])
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return manualPlacementWarnings(startMinutes, duration, profile.data.max_session_minutes, windows.data.map(w => ({ start: minutes(w.start_time), end: minutes(w.end_time) }))).map(title => ({ title, overlapMinutes: 0 }))
}

/**
 * Adds a task the student chose to add: ONE database command (apply_task_create) writes the task and its history together, idempotent per key.
 * Only ordinary study/revision/admin work; repairs, re-checks and mocks have their own commands.
 */
export async function createManualTask(userId: string, input: {
  key: string; title: string; detail?: string; taskType?: string; priority?: string; date: string; startMinutes: number | null; durationMinutes: number; acceptWarnings?: boolean
}) {
  const ctx = await getStudyWeekContext(userId), timezone = ctx.timezone, admin = createAdminClient()
  if (!parseLocalDate(input.date)) throw new ExecutionCommandError('Choose a valid day.', 400, 'BAD_DATE')
  const duration = validateDuration(input.durationMinutes)
  if (!duration.ok) throw new ExecutionCommandError(duration.error, 400, 'BAD_DURATION')
  let startsAt: string | null = null
  if (input.startMinutes !== null) {
    const start = validateStart(input.startMinutes)
    if (!start.ok) throw new ExecutionCommandError(start.error, 400, 'BAD_START')
    startsAt = zonedTimeToUtc(input.date, `${String(Math.floor(start.value / 60)).padStart(2, '0')}:${String(start.value % 60).padStart(2, '0')}`, timezone).toISOString()
  }
  // A key that already has this student's receipt is a replay: the command decides it, before any check of today's calendar or warnings.
  const { data: receipt } = await admin.from('task_create_receipts').select('key').eq('key', input.key).eq('user_id', userId).maybeSingle().throwOnError()
  if (!receipt) {
    if (input.date < ctx.today) throw new ExecutionCommandError('Choose today or a later day. If this already happened, record it with Log learning.', 400, 'PAST')
    const conflict = await protectedConflict(userId, input.date, input.startMinutes, duration.value, timezone)
    if (conflict) throw conflict
    if (!input.acceptWarnings) {
      const warnings = await windowWarnings(userId, input.date, input.startMinutes === null ? null : Math.round(input.startMinutes / 5) * 5, duration.value)
      if (warnings.length) return { needsConfirmation: true as const, warnings }
    }
  }
  const { data: res, error } = await admin.rpc('apply_task_create', {
    p_user: userId, p_id: input.key, p_title: input.title, p_detail: input.detail ?? null, p_type: input.taskType ?? 'study', p_priority: input.priority ?? 'core',
    p_date: input.date, p_starts: startsAt, p_minutes: duration.value,
  })
  // The command is atomic: an error the database ANSWERED with (a SQLSTATE) rolled everything back. Anything else (connection lost, timeout, gateway) may have
  // come after the commit, so it is reported as unknown, never as "nothing was added"; retrying under the same key returns the saved result.
  if (error) {
    if (/^[0-9A-Z]{5}$/.test(error.code ?? '')) throw new Error(error.message)
    throw new ExecutionCommandError('We could not confirm whether the task was saved. Press Retry: if it was saved you will get it back, never a second copy.', 502, 'OUTCOME_UNKNOWN')
  }
  const r = res as { ok: boolean; code?: string; title?: string; start?: string; end?: string; task?: any; current?: any; replayed?: boolean }
  if (!r.ok) {
    if (r.code === 'PROTECTED' || r.code === 'MOCK') {
      // Lost a race to a booking made after the preflight: rebuild the same actionable links the preflight gives.
      const conflict = await protectedConflict(userId, input.date, input.startMinutes, duration.value, timezone).catch(() => null)
      throw conflict ?? new TaskConflictError(`${r.title || 'Protected time'} is already there, and it is protected.`, [{ title: r.title || 'Protected time', kind: r.code === 'MOCK' ? 'mock' : 'commitment', overlapMinutes: 0 }], [])
    }
    if (r.code === 'PAST') throw new ExecutionCommandError('Choose today or a later day. If this already happened, record it with Log learning.', 400, 'PAST')
    if (r.code === 'NO_CYCLE') throw new ExecutionCommandError('You have no accepted plan week right now. Prepare your week from the Calendar first, then add the task.', 409, 'NO_CYCLE')
    if (r.code === 'OUTSIDE_CYCLE') throw new ExecutionCommandError(`That day is outside this plan (${r.start} to ${r.end}). To carry work into another week, use the weekly review.`, 400, 'OUTSIDE_CYCLE')
    if (r.code === 'BAD_TYPE') throw new ExecutionCommandError('Repairs, re-checks and mocks are created by their own steps, not added by hand.', 400, 'BAD_TYPE')
    if (r.code === 'KEY_REUSED') throw new ExecutionCommandError('That request was already used for a different task. Reload and add it again.', 409, 'KEY_REUSED')
    if (r.code === 'NO_RECEIPT') throw new ExecutionCommandError('This task was added before PrepPlan kept a record of the original request, so it cannot be confirmed as the same one. It is already on your Calendar; nothing was added.', 409, 'NO_RECEIPT')
    throw new ExecutionCommandError('That task could not be added. Nothing was changed.', 400, r.code ?? 'REFUSED')
  }
  return { needsConfirmation: false as const, task: r.task, current: r.current ?? null, replayed: Boolean(r.replayed) }
}

/** A protected booking over the chosen time as a conflict with links and nearby free slots, or null. */
async function protectedConflict(userId: string, date: string, startMinutes: number | null, durationMinutes: number, timezone: string) {
  if (startMinutes === null) return null
  const candidate = { date, start: startMinutes, durationMinutes }
  const occupants = await occupantsFor(userId, [date], timezone)
  const blocking = findConflicts(candidate, occupants, { protectedOnly: true })
  if (!blocking.length) return null
  return new TaskConflictError(`${blocking[0].occupant.title} is already there, and it is protected.`,
    blocking.map(c => ({ title: c.occupant.title, kind: c.occupant.kind, overlapMinutes: c.overlapMinutes, href: calendarOccupantHref(c.occupant.id, c.occupant.kind, c.occupant.date) })), suggestSlots(candidate, occupants))
}
