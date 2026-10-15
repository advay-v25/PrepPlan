import { createAdminClient } from '../supabase/admin'
import { getStudyWeekContext } from './schedule'
import { utcToZonedParts, zonedTimeToUtc } from './studyWeek'
import {
  Occupant, findConflicts, splitTask, suggestSlots, validateDuration, validateStart,
  expandCommitment, type CommitmentException, type RecurringCommitment,
} from './mutations'
import { redistributeWeek } from './pulse/redistribute'

/**
 * Task mutation, with the two guarantees C2 exists to provide:
 *
 *   1. A write carries the revision it read. If the row moved on since, the
 *      write is refused and the caller is handed the current state — two
 *      devices cannot silently overwrite each other.
 *
 *   2. Every accepted change writes a task_event recording what it was before,
 *      so history reads as a difference and an undo has something to restore.
 */

export class TaskConflictError extends Error {
  constructor(message: string, readonly conflicts: any[], readonly suggestions: any[]) {
    super(message)
    this.name = 'TaskConflictError'
  }
}

export class RevisionMismatchError extends Error {
  constructor(readonly current: any) {
    super('This task changed somewhere else while you were editing it.')
    this.name = 'RevisionMismatchError'
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

const SELECT = 'id, title, local_date, starts_at, duration_minutes, placement, execution, task_type, revision, is_protected_commitment, cycle_id, priority, origin, detail, rationale'

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
    .gte('local_date', from)
    .lte('local_date', to)

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
    .eq('user_id', userId).eq('status', 'active').eq('recurrence', 'none')
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
    .eq('user_id', userId).eq('status', 'active').eq('recurrence', 'weekly')

  const seriesIds = (series ?? []).map(s => s.id as string)
  const { data: exceptionRows } = seriesIds.length
    ? await admin.from('commitment_exceptions').select('*').in('commitment_id', seriesIds)
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

  return out
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
  if (task.revision !== input.expectedRevision) throw new RevisionMismatchError(task)

  const ctx = await getStudyWeekContext(userId)
  const timezone = ctx.timezone

  const duration = input.durationMinutes ?? task.duration_minutes ?? 30
  const validDuration = validateDuration(duration)
  if (!validDuration.ok) throw new Error(validDuration.error)

  let startsAt: string | null = null
  let placement: 'timed' | 'day_preferred' = 'day_preferred'

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
        blocking.map(c => ({ title: c.occupant.title, kind: c.occupant.kind, overlapMinutes: c.overlapMinutes })),
        suggestions
      )
    }

    if (!input.acceptWarnings) {
      const soft = findConflicts(candidate, occupants, { ignoreIds: [taskId] })
        .filter(c => !c.occupant.isProtected)
      if (soft.length > 0) {
        return {
          needsConfirmation: true as const,
          warnings: soft.map(c => ({ title: c.occupant.title, overlapMinutes: c.overlapMinutes })),
        }
      }
    }

    const time = `${String(Math.floor(validStart.value / 60)).padStart(2, '0')}:${String(validStart.value % 60).padStart(2, '0')}`
    startsAt = zonedTimeToUtc(input.date, time, timezone).toISOString()
    placement = 'timed'
  }

  const before = snapshot(task)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('plan_blocks')
    .update({
      local_date: input.date, day: input.date, starts_at: startsAt, placement,
      duration_minutes: validDuration.value, duration: String(validDuration.value),
    })
    .eq('id', taskId).eq('user_id', userId).eq('revision', input.expectedRevision)
    .select(SELECT).maybeSingle()

  if (error) throw new Error(error.message)
  // The revision guard in the WHERE clause is the real race protection: another
  // write landing between the read above and this update makes it match nothing.
  if (!data) throw new RevisionMismatchError(await loadTask(userId, taskId))

  const movedDay = before.local_date !== input.date || before.starts_at !== startsAt
  const resized = before.duration_minutes !== validDuration.value
  await recordEvent(
    userId, taskId,
    resized && !movedDay ? 'duration_changed' : 'moved',
    { local_date: input.date, starts_at: startsAt, duration_minutes: validDuration.value, placement },
    before
  )

  return { task: data, needsConfirmation: false as const }
}

export type ExecutionInput = {
  execution: 'not_started' | 'in_progress' | 'partial' | 'completed' | 'skipped' | 'deferred'
  expectedRevision: number
  actualDurationMinutes?: number
  note?: string
}

// The names task_events accepts. Reopening a completed task is recorded as
// 'undone' because the schema has no 'restored'.
const EVENT_FOR: Record<string, string> = {
  in_progress: 'started', partial: 'partial', completed: 'completed',
  skipped: 'skipped', deferred: 'deferred', not_started: 'undone',
}

/**
 * Records what actually happened to a task.
 *
 * Partial stays partial: it is not rounded up to complete, and it does not
 * become a fresh full task next week. Completing a study task deliberately
 * creates no evidence — only a diagnostic does that.
 */
export async function setExecution(userId: string, taskId: string, input: ExecutionInput) {
  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.revision !== input.expectedRevision) throw new RevisionMismatchError(task)

  const before = snapshot(task)
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('plan_blocks')
    .update({ execution: input.execution })
    .eq('id', taskId).eq('user_id', userId).eq('revision', input.expectedRevision)
    .select(SELECT).maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new RevisionMismatchError(await loadTask(userId, taskId))

  // The actual duration rides on the same event as the change. It used to be a second
  // 'partial_progress' insert, which the current CHECK constraint rejects — so it was silently
  // never recorded.
  await recordEvent(
    userId, taskId, EVENT_FOR[input.execution] ?? 'moved',
    { execution: input.execution, note: input.note ?? null },
    before,
    input.actualDurationMinutes === undefined ? undefined : Math.min(600, Math.max(0, Math.round(input.actualDurationMinutes)))
  )

  if (input.execution === 'skipped' || input.execution === 'deferred') {
    const cycleId = (data as any).cycle_id as string | null
    if (cycleId) {
      const ctx = await getStudyWeekContext(userId)
      const result = await redistributeWeek(userId, cycleId, ctx.today).catch(e => ({ applied: false, reason: e?.message ?? String(e) }))
      if (!result.applied) console.error(`[redistributeWeek] did not apply for cycle ${cycleId}:`, result.reason)
    }
  }

  return { task: data }
}

/**
 * Splits a task into two sittings, preserving scope.
 *
 * The original is shortened and a second task carries the remainder. Neither
 * covers less than the original did between them.
 */
export async function splitExisting(userId: string, taskId: string, expectedRevision: number, at?: number) {
  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.revision !== expectedRevision) throw new RevisionMismatchError(task)
  if (!task.local_date) throw new Error('A task with no date cannot be split yet — place it first')

  const ctx = await getStudyWeekContext(userId)
  const startMinutes = task.starts_at
    ? utcToZonedParts(new Date(task.starts_at as string), ctx.timezone).minutesOfDay
    : 9 * 60

  const occupants = await occupantsFor(userId, [task.local_date as string], ctx.timezone)
  const result = splitTask(
    { date: task.local_date as string, start: startMinutes, durationMinutes: (task.duration_minutes ?? 60) as number },
    { at, occupants, ignoreIds: [taskId] }
  )

  const admin = createAdminClient()
  const before = snapshot(task)

  const { data: shortened, error: shortenErr } = await admin
    .from('plan_blocks')
    .update({ duration_minutes: result.first.durationMinutes, duration: String(result.first.durationMinutes) })
    .eq('id', taskId).eq('user_id', userId).eq('revision', expectedRevision)
    .select(SELECT).maybeSingle()
  if (shortenErr) throw new Error(shortenErr.message)
  if (!shortened) throw new RevisionMismatchError(await loadTask(userId, taskId))

  const secondId = `${taskId}-b${Date.now().toString(36).slice(-4)}`
  const secondStartsAt = result.second.start !== null
    ? zonedTimeToUtc(
        result.second.date,
        `${String(Math.floor(result.second.start / 60)).padStart(2, '0')}:${String(result.second.start % 60).padStart(2, '0')}`,
        ctx.timezone
      ).toISOString()
    : null

  const { error: insertErr } = await admin.from('plan_blocks').insert({
    id: secondId,
    user_id: userId,
    cycle_id: (task as any).cycle_id ?? null,
    title: `${task.title} (part 2)`,
    detail: (task as any).detail ?? 'The remainder of a session that was split.',
    task_type: task.task_type ?? 'study',
    origin: (task as any).origin ?? 'student',
    priority: (task as any).priority ?? 'core',
    placement: secondStartsAt ? 'timed' : 'day_preferred',
    execution: 'not_started',
    local_date: result.second.date,
    day: result.second.date,
    starts_at: secondStartsAt,
    duration_minutes: result.second.durationMinutes,
    duration: String(result.second.durationMinutes),
    rationale: `Split from "${task.title}" so it fits in shorter sittings. The scope is unchanged.`,
    is_protected_commitment: false,
    created_by: 'student',
  })
  if (insertErr) throw new Error(insertErr.message)

  await recordEvent(userId, taskId, 'split',
    { splitInto: secondId, firstDuration: result.first.durationMinutes, secondDuration: result.second.durationMinutes },
    before)
  await recordEvent(userId, secondId, 'created', { splitFrom: taskId }, {})

  return { first: shortened, secondId }
}

export async function deleteTask(userId: string, taskId: string, expectedRevision: number) {
  const task = await loadTask(userId, taskId)
  if (!task) throw new Error('Task not found')
  if (task.revision !== expectedRevision) throw new RevisionMismatchError(task)

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

  return { deleted: true, task }
}

/** Reverses the most recent change to a task, using the previous values it stored. */
export async function undoLast(userId: string, taskId: string) {
  const admin = createAdminClient()
  const { data: events } = await admin
    .from('task_events')
    .select('id, event_type, previous, created_at')
    .eq('user_id', userId).eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)

  const last = events?.[0]
  if (!last) throw new Error('There is nothing to undo for this task')

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
  await recordEvent(userId, taskId, 'undone', { undid: last.event_type }, snapshot(task))
  return { task: data }
}

