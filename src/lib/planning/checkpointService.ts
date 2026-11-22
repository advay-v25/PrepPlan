import { formatStudyDate, isCalendarDate } from '../format/date'
import { createHash } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { MOCK_KINDS, MOCK_KIND_LABEL, type MockKind } from '../curriculum/entryContext'
import {
  ASSESSMENT_CHOICES, MOCK_OUTCOMES, missingDetails, projectCheckpoint, toMinutes,
  type AssessmentChoice, type Checkpoint, type MockOutcome, type Range, type Suggestion,
} from '../curriculum/mockCheckpoint'
import { addDays, todayInZone, utcToZonedParts, weekdayOf, zonedTimeToUtc } from './studyWeek'
import { getStudyWeekContext, weekForDate } from './schedule'
import { findConflicts, suggestSlots } from './mutations'
import { occupantsFor } from './taskService'
import { assertMockDateAllowed, SetupError } from '../onboarding/service'
import { startablePaperExists } from './weeklyReview/service'
import { getRehearsal } from '../rehearsal/service'
import { minuteOf, perRequest } from '../ops/perRequest'
import { profileTimezone } from '../ops/sharedReads'

/**
 * The mock / checkpoint as a set of COMMANDS. The record is profiles.mock_* (one checkpoint per student, with a stable id and a
 * version the database bumps on every change). Each command is applied by `checkpoint_command` in a single transaction together
 * with everything it implies (assessment-choice cleanup, outcome history, stale-draft version, receipt), serialised per student.
 *
 *  - Every command carries an idempotency `key`. Repeating a successful key returns the original receipt, even after the
 *    checkpoint was cleared; the same key with a different payload is refused.
 *  - Commands made against a checkpoint carry its id and version; an older request cannot change or clear a newer checkpoint.
 *  - External mock reports are the student's own words. They write no evidence, attempts, answers, readiness or repair threads.
 */

export class CheckpointError extends Error {
  constructor(message: string, public code: string, public status = 400, public extra: Record<string, unknown> = {}) { super(message) }
}

export type CheckpointInput = { date: string; kind: MockKind; label?: string | null; startTime?: string | null; durationMinutes?: number | null }
export type CommandMeta = { key: string; checkpointId: string | null; expectedVersion: number | null }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseMeta(body: any): CommandMeta {
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (key.length < 8 || key.length > 80) throw new CheckpointError('This request needs a request key (8–80 characters) so a retry cannot repeat it.', 'KEY_REQUIRED')
  const checkpointId = typeof body?.checkpointId === 'string' && body.checkpointId ? body.checkpointId : null
  if (checkpointId && !/^[0-9a-f-]{36}$/i.test(checkpointId)) throw new CheckpointError('That checkpoint reference is not valid.', 'INVALID')
  const v = body?.expectedVersion
  if (v != null && (!Number.isInteger(v) || v < 0)) throw new CheckpointError('That checkpoint version is not valid.', 'INVALID')
  return { key, checkpointId, expectedVersion: v ?? null }
}

export function parseCheckpointInput(body: any): CheckpointInput {
  if (!body || typeof body !== 'object') throw new CheckpointError('Send the checkpoint as an object.', 'INVALID')
  if (typeof body.date !== 'string' || !DATE.test(body.date) || !isCalendarDate(body.date)) throw new CheckpointError('That is not a real date.', 'INVALID_DATE')
  if (!(MOCK_KINDS as readonly string[]).includes(body.kind)) throw new CheckpointError('Choose what kind of mock it is.', 'INVALID_KIND')
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (label.length > 80) throw new CheckpointError('Keep the description to 80 characters.', 'INVALID_LABEL')
  const startTime = body.startTime == null || body.startTime === '' ? null : String(body.startTime)
  if (startTime && !TIME.test(startTime)) throw new CheckpointError('The start time must look like 14:30.', 'INVALID_TIME')
  let durationMinutes: number | null = null
  if (body.durationMinutes != null && body.durationMinutes !== '') {
    durationMinutes = Number(body.durationMinutes)
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw new CheckpointError('The expected length must be between 15 minutes and 8 hours.', 'INVALID_DURATION')
  }
  if (startTime && durationMinutes && toMinutes(startTime) + durationMinutes > 24 * 60) throw new CheckpointError('It has to finish by midnight. Shorten it, or start it earlier.', 'INVALID_DURATION')
  return { date: body.date, kind: body.kind as MockKind, label: label || null, startTime, durationMinutes }
}

// --------------------------------------------------------------------------------------------------------------------------
// Command plumbing
// --------------------------------------------------------------------------------------------------------------------------

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))
const hashOf = (command: string, clientPayload: unknown) => createHash('sha256').update(`${command}:${stable(clientPayload)}`).digest('hex')

const STATUS: Record<string, [number, string]> = {
  CHECKPOINT_CHANGED: [409, 'Your mock changed after this page loaded (another tab or device). It has been refreshed; check it and try again.'],
  NO_CHECKPOINT: [404, 'There is no mock on your calendar to change.'],
  KEY_REUSED: [409, 'That request key was already used for a different request.'],
  PAPER_STARTED: [409, 'This week’s paper has already been started or finished, so it stays as it is. The mock can sit alongside it.'],
  PAPER_DECISION_REQUIRED: [409, 'This week already has an unstarted paper. Choose whether the mock replaces it or sits alongside it.'],
  INVALID_ACTUAL_DATE: [400, 'The date you took it cannot be in the future.'],
  INVALID_RESULT: [400, 'A result can only be noted for a mock you took.'],
  INVALID_OUTCOME: [400, 'Choose taken, postponed or not taken.'],
  INVALID_CHOICE: [400, 'Choose one of the three options.'],
  TASK_STARTED: [409, 'That task has been started or finished, so it stays where it is.'],
  REVISION_MISMATCH: [409, 'That task changed since it was shown. Refresh and try again.'],
  NOT_RELATED: [404, 'That task is not part of your mock preparation.'],
  KIND_LOCKED: [409, 'A rehearsal has already been prepared for this appointment, so its type cannot change. Cancel the rehearsal first.'],
  REHEARSAL_STARTED: [409, 'A rehearsal session has started, so this appointment cannot be cancelled. Finish or leave the rehearsal from Tests.'],
  INTERNAL_RESULT: [400, 'A PrepPlan rehearsal is completed by finishing its two sessions, not by typing a result.'],
}

/** A previous successful result for this key, if any. Checked BEFORE validation so a replay never depends on today's state. */
async function priorReceipt(userId: string, key: string, command: string, hash: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createAdminClient().from('checkpoint_commands').select('command, payload_hash, receipt').eq('user_id', userId).eq('key', key).maybeSingle()
  if (error) throw new CheckpointError('Your request could not be checked. Retrying is safe.', 'UNAVAILABLE', 503)
  if (!data) return null
  if (data.command !== command || data.payload_hash !== hash) throw new CheckpointError(STATUS.KEY_REUSED[1], 'KEY_REUSED', 409)
  return { ...(data.receipt as Record<string, unknown>), replayed: true }
}

async function apply(userId: string, meta: CommandMeta, command: string, clientPayload: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await createAdminClient().rpc('checkpoint_command', {
    p_user: userId, p_key: meta.key, p_command: command, p_hash: hashOf(command, clientPayload),
    p_args: { checkpointId: meta.checkpointId, expectedVersion: meta.expectedVersion, ...args },
  })
  // A booking that lost a race is refused inside the transaction (SQLSTATE BK409); nothing was applied and no receipt was written.
  if (error?.code === 'BK409') {
    const a = args as { date?: string; startTime?: string | null; durationMinutes?: number | null }
    throw new CheckpointError(`${error.details || 'Another booking'} is already there at that time. Nothing was changed; choose another time.`, 'SLOT_TAKEN', 409, await slotSuggestions(userId, a))
  }
  // The command is one transaction: if this is an error, none of it was applied, and the same key can simply be sent again.
  if (error || !data) throw new CheckpointError('Save not confirmed. Nothing was partly applied; send it again, or check your calendar first.', 'SAVE_UNCONFIRMED', 503)
  const r = data as Record<string, unknown>
  if (r.ok === true) return r
  const [status, message] = STATUS[String(r.code)] ?? [409, 'That could not be applied.']
  throw new CheckpointError(message, String(r.code), status, { current: { id: r.currentId ?? null, version: r.currentVersion ?? null } })
}

export type LoadedCheckpoint = Checkpoint & { timezone: string; id: string; version: number }

/** One planned appointment: the one asked for, else the NEXT one (the same one the profile projects). */
async function loadCheckpointUncached(userId: string, appointmentId?: string | null): Promise<LoadedCheckpoint | null> {
  const admin = createAdminClient()
  const p = { timezone: await profileTimezone(userId) }
  const base = admin.from('mock_appointments').select('id, version, planned_date, kind, label, start_time, duration_minutes').eq('user_id', userId).eq('status', 'planned')
  const { data: a } = appointmentId
    ? await base.eq('id', appointmentId).maybeSingle().throwOnError()
    : await base.order('planned_date').order('created_at').order('id').limit(1).maybeSingle().throwOnError()
  if (!a || !(MOCK_KINDS as readonly string[]).includes(a.kind as string)) return null
  return {
    id: a.id as string, version: (a.version ?? 1) as number, date: a.planned_date as string, kind: a.kind as MockKind, label: (a.label ?? null) as string | null,
    startTime: a.start_time ? String(a.start_time).slice(0, 5) : null, durationMinutes: (a.duration_minutes ?? null) as number | null, timezone: (p?.timezone as string) || 'UTC',
  }
}

export const loadCheckpoint = perRequest(loadCheckpointUncached, (userId, appointmentId) => `${userId}|${appointmentId ?? ''}`)

/** The week (by the same boundary rules as everything else) that holds a date. */
export async function weekContaining(userId: string, date: string) { return weekForDate(userId, date) }

// --------------------------------------------------------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------------------------------------------------------

/**
 * A timed mock holds its clock time like any other booking: it is refused over a class, a protected commitment, another mock or a task
 * the student placed, with other times offered. Nothing is moved for it. An appointment without a time or length holds the day only.
 * shortcut: checked just before the command, not inside its transaction, so a task saved in the same instant can still slip in; upgrade by
 * moving the check into checkpoint_command under scope_lock.
 */
async function assertSlotFree(userId: string, ownId: string | null, input: CheckpointInput) {
  if (!input.startTime || !input.durationMinutes) return
  const tz = (await getStudyWeekContext(userId)).timezone
  const occ = (await occupantsFor(userId, [input.date], tz)).filter(o => o.id !== `mock:${ownId}`)
  const candidate = { date: input.date, start: toMinutes(input.startTime), durationMinutes: input.durationMinutes }
  const clash = findConflicts(candidate, occ).filter(c => c.occupant.isProtected || c.occupant.kind !== 'commitment')
  if (!clash.length) return
  throw new CheckpointError(`${clash[0].occupant.title} is already there at that time. Nothing was changed; choose another time.`, 'SLOT_TAKEN', 409, {
    conflicts: clash.map(c => ({ title: c.occupant.title, overlapMinutes: c.overlapMinutes })),
    ...(await slotSuggestions(userId, input, ownId)),
  })
}

/** Other times for a refused booking. Advisory only: the database decides at commit. */
async function slotSuggestions(userId: string, a: { date?: string; startTime?: string | null; durationMinutes?: number | null }, ownId: string | null = null) {
  if (!a.date || !a.startTime || !a.durationMinutes) return { suggestions: [] }
  const tz = (await getStudyWeekContext(userId)).timezone
  const occ = (await occupantsFor(userId, [a.date], tz).catch(() => [] as Awaited<ReturnType<typeof occupantsFor>>)).filter(o => o.id !== `mock:${ownId}`)
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return { suggestions: suggestSlots({ date: a.date, start: toMinutes(a.startTime), durationMinutes: a.durationMinutes }, occ).map(x => ({ ...x, label: fmt((x as any).start ?? 0) })) }
}

export async function saveCheckpoint(userId: string, meta: CommandMeta, input: CheckpointInput) {
  const hash = hashOf('save', { meta: { c: meta.checkpointId, v: meta.expectedVersion }, input })
  const prior = await priorReceipt(userId, meta.key, 'save', hash); if (prior) return prior
  const current = meta.checkpointId ? await loadCheckpoint(userId, meta.checkpointId) : null
  if (!current || current.date !== input.date) {
    try { await assertMockDateAllowed(userId, input.date) }
    catch (e) { if (e instanceof SetupError) throw new CheckpointError(e.message, 'DATE_NOT_ALLOWED'); throw e }
  }
  await assertSlotFree(userId, meta.checkpointId, input)
  // The week's assessment choice only goes when the mock actually LEAVES that week; moving it inside the same week keeps the decision.
  let oldWeekStart: string | null = null
  if (current && current.date !== input.date) {
    const [from, to] = await Promise.all([weekForDate(userId, current.date), weekForDate(userId, input.date)])
    if (from.startDate !== to.startDate) oldWeekStart = from.startDate
  }
  return apply(userId, meta, 'save', { meta: { c: meta.checkpointId, v: meta.expectedVersion }, input }, { ...input, oldWeekStart })
}

/** Adds ANOTHER appointment (an internal rehearsal or an external mock). The existing ones are untouched. */
export async function addAppointment(userId: string, meta: CommandMeta, input: CheckpointInput) {
  const hash = hashOf('add', { input })
  const prior = await priorReceipt(userId, meta.key, 'add', hash); if (prior) return prior
  try { await assertMockDateAllowed(userId, input.date) }
  catch (e) { if (e instanceof SetupError) throw new CheckpointError(e.message, 'DATE_NOT_ALLOWED'); throw e }
  await assertSlotFree(userId, null, input)
  return apply(userId, meta, 'add', { input }, { ...input })
}

export async function cancelCheckpoint(userId: string, meta: CommandMeta) {
  const hash = hashOf('cancel', { c: meta.checkpointId, v: meta.expectedVersion })
  const prior = await priorReceipt(userId, meta.key, 'cancel', hash)
  if (prior) return { ...prior, replacement: await replacementOffer(userId) }
  const current = await loadCheckpoint(userId, meta.checkpointId)
  if (!current) throw new CheckpointError(STATUS.NO_CHECKPOINT[1], 'NO_CHECKPOINT', 404)
  const week = await weekForDate(userId, current.date)
  const r = await apply(userId, meta, 'cancel', { c: meta.checkpointId, v: meta.expectedVersion }, { weekStart: week.startDate })
  return { ...r, replacement: await replacementOffer(userId) }
}

export async function setAssessmentChoice(userId: string, meta: CommandMeta, choice: string, paperAction?: string | null) {
  if (!ASSESSMENT_CHOICES.includes(choice as AssessmentChoice)) throw new CheckpointError(STATUS.INVALID_CHOICE[1], 'INVALID_CHOICE')
  if (paperAction != null && !['replace', 'keep'].includes(paperAction)) throw new CheckpointError('Choose replace or keep for the paper.', 'INVALID')
  const payload = { c: meta.checkpointId, v: meta.expectedVersion, choice, paperAction: paperAction ?? null }
  const prior = await priorReceipt(userId, meta.key, 'choice', hashOf('choice', payload)); if (prior) return prior
  const current = await loadCheckpoint(userId, meta.checkpointId)
  if (!current) throw new CheckpointError(STATUS.NO_CHECKPOINT[1], 'NO_CHECKPOINT', 404)
  const week = await weekForDate(userId, current.date)
  return apply(userId, meta, 'choice', payload, { weekStart: week.startDate, choice, paperAction: paperAction ?? null })
}

export type OutcomeInput = { outcome: MockOutcome; actualDate?: string | null; result?: string | null; notes?: string | null; newDate?: string | null; choice?: string | null; paperAction?: string | null }

export async function recordMockOutcome(userId: string, meta: CommandMeta, input: OutcomeInput) {
  if (!MOCK_OUTCOMES.includes(input.outcome)) throw new CheckpointError(STATUS.INVALID_OUTCOME[1], 'INVALID_OUTCOME')
  const result = typeof input.result === 'string' ? input.result.trim() : ''
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (result.length > 80) throw new CheckpointError('Keep the result to 80 characters.', 'INVALID_RESULT')
  if (notes.length > 500) throw new CheckpointError('Keep the notes to 500 characters.', 'INVALID_NOTES')
  if (input.outcome !== 'taken' && (result || input.actualDate)) throw new CheckpointError(STATUS.INVALID_RESULT[1], 'INVALID_RESULT')
  if (input.choice != null && !['use_mock', 'keep_paper'].includes(input.choice)) throw new CheckpointError('Choose how it counts: as this week’s assessment, or alongside the paper.', 'INVALID_CHOICE')
  if (input.newDate && input.outcome !== 'postponed') throw new CheckpointError('A new date only applies to a postponed mock.', 'INVALID')
  const payload = { c: meta.checkpointId, v: meta.expectedVersion, ...input, result, notes }
  const prior = await priorReceipt(userId, meta.key, 'outcome', hashOf('outcome', payload))
  if (prior) return { ...prior, replacement: prior.outcome === 'taken' ? null : await replacementOffer(userId) }

  const current = await loadCheckpoint(userId, meta.checkpointId)
  if (!current) throw new CheckpointError(STATUS.NO_CHECKPOINT[1], 'NO_CHECKPOINT', 404)
  const today = todayInZone(current.timezone)
  let actualDate: string | null = null
  if (input.outcome === 'taken') {
    // The default is the student's own local today; they may correct it to the day it really happened, never to the future.
    actualDate = input.actualDate || today
    if (!DATE.test(actualDate) || !isCalendarDate(actualDate)) throw new CheckpointError('That is not a real date.', 'INVALID_ACTUAL_DATE')
    if (actualDate > today) throw new CheckpointError(STATUS.INVALID_ACTUAL_DATE[1], 'INVALID_ACTUAL_DATE')
    if (actualDate < addDays(today, -180)) throw new CheckpointError('That date is too far back to be right. Check it.', 'INVALID_ACTUAL_DATE')
  }
  if (input.outcome === 'postponed' && input.newDate) {
    // Validated BEFORE anything is recorded: a rejected date leaves the checkpoint and the history exactly as they were.
    if (!DATE.test(input.newDate) || !isCalendarDate(input.newDate)) throw new CheckpointError('That is not a real date.', 'INVALID_DATE')
    if (input.newDate === current.date) throw new CheckpointError('Choose a different date, or leave the new date empty.', 'DATE_NOT_ALLOWED')
    try { await assertMockDateAllowed(userId, input.newDate) }
    catch (e) { if (e instanceof SetupError) throw new CheckpointError(e.message, 'DATE_NOT_ALLOWED'); throw e }
  }
  const week = await weekForDate(userId, current.date)
  const r = await apply(userId, meta, 'outcome', payload, {
    outcome: input.outcome, actualDate, result, notes, newDate: input.newDate ?? null, choice: input.choice ?? null, paperAction: input.paperAction ?? null,
    weekStart: week.startDate, today,
  })
  return { ...r, replacement: input.outcome === 'taken' ? null : await replacementOffer(userId) }
}

/** Adds ONE suggestion of the current checkpoint as a task. Everything that matters is recomputed here, never read from the client. */
export async function addSuggestion(userId: string, meta: CommandMeta, suggestionId: string) {
  if (!['prepare-1', 'prepare-2', 'analyse'].includes(suggestionId)) throw new CheckpointError('That suggestion does not exist.', 'INVALID')
  const payload = { c: meta.checkpointId, v: meta.expectedVersion, suggestionId }
  const prior = await priorReceipt(userId, meta.key, 'add_suggestion', hashOf('add_suggestion', payload)); if (prior) return prior
  const state = await computeProjection(userId, new Date(), meta.checkpointId)
  if (!state) throw new CheckpointError(STATUS.NO_CHECKPOINT[1], 'NO_CHECKPOINT', 404)
  if (meta.checkpointId !== state.cp.id || meta.expectedVersion !== state.cp.version) {
    throw new CheckpointError(STATUS.CHECKPOINT_CHANGED[1], 'CHECKPOINT_CHANGED', 409, { current: { id: state.cp.id, version: state.cp.version } })
  }
  const s = state.suggestions.find(x => x.id === suggestionId)!
  if (!s.date || s.startMinutes === null) throw new CheckpointError(s.unplacedReason ?? 'That suggestion has no place right now.', 'NOT_PLACEABLE', 409)
  if (!s.addable || !state.openCycle) throw new CheckpointError(s.laterReason ?? 'That week is not open yet.', 'NOT_PLACEABLE', 409)
  // Last look at the exact interval against what is on the calendar right now (protected commitments always refuse).
  const occ = await occupantsFor(userId, [s.date], state.cp.timezone)
  const clash = findConflicts({ date: s.date, start: s.startMinutes, durationMinutes: s.minutes }, occ, { protectedOnly: true })
  if (clash.length) throw new CheckpointError(`${clash[0].occupant.title} is already there, so this suggestion no longer fits. Refresh to see a new proposal.`, 'NOT_PLACEABLE', 409)
  const hhmm = `${String(Math.floor(s.startMinutes / 60)).padStart(2, '0')}:${String(s.startMinutes % 60).padStart(2, '0')}`
  return apply(userId, meta, 'add_suggestion', payload, {
    suggestionId, title: s.title, detail: s.reason, date: s.date, minutes: s.minutes, cycleId: state.openCycle.id,
    startsAt: zonedTimeToUtc(s.date, hhmm, state.cp.timezone).toISOString(),
  })
}

export async function removeRelatedTask(userId: string, meta: CommandMeta, taskId: string, expectedRevision: number) {
  if (typeof taskId !== 'string' || !Number.isInteger(expectedRevision)) throw new CheckpointError('Say which task and which version.', 'INVALID')
  const payload = { taskId, expectedRevision }
  const prior = await priorReceipt(userId, meta.key, 'remove_related', hashOf('remove_related', payload)); if (prior) return prior
  return apply(userId, meta, 'remove_related', payload, payload)
}

export async function keepRelatedTask(userId: string, meta: CommandMeta, taskId: string) {
  if (typeof taskId !== 'string') throw new CheckpointError('Say which task.', 'INVALID')
  const prior = await priorReceipt(userId, meta.key, 'keep_related', hashOf('keep_related', { taskId })); if (prior) return prior
  return apply(userId, meta, 'keep_related', { taskId }, { taskId })
}

// --------------------------------------------------------------------------------------------------------------------------
// Read model
// --------------------------------------------------------------------------------------------------------------------------

export type RelatedTask = {
  taskId: string; title: string; date: string | null; execution: string; revision: number; suggestionId: string
  /** True when the task belongs to the checkpoint that is current now. */
  forCurrent: boolean
  /** Where the task actually sits (minutes from local midnight), when it has a time. */
  startMinutes: number | null
  /** What the student should decide: this task was added for a mock that has since moved, ended or been cancelled. */
  needsReview: boolean; reason: string | null; removable: boolean
}

export type AppointmentSummary = {
  id: string; version: number; date: string; kind: MockKind; title: string; startTime: string | null; durationMinutes: number | null
  status: 'planned' | 'completed' | 'cancelled' | 'postponed' | 'missed'
  weekStart: string; href: string
  /** True when THIS appointment is the one the student chose to count for its week's assessment. */
  designated: boolean
  /** Internal rehearsal only: the reserved rehearsal and where the student is in it. */
  rehearsal: { id: string; stage: string; primary: { label: string; href: string } | null } | null
  /** The student's own recorded result for a completed mock (free text and notes): their report, never evidence. */
  report?: { reportedResult: string | null; notes: string | null } | null
}

export type CheckpointView = {
  /** Every appointment on the canonical schedule (planned first, by date, then recent history). */
  appointments: AppointmentSummary[]
  /** Which of them the panel is showing. */
  selectedId: string
  /** Another appointment in this week is the one that counts; this one is not. */
  designatedElsewhere: { id: string; title: string } | null
  checkpointId: string
  version: number
  checkpoint: Checkpoint
  title: string
  missing: string[]
  week: { startDate: string; endDate: string }
  /** The one place each surface sends the student to see and edit this checkpoint. */
  href: string
  choice: AssessmentChoice | null
  /** True while a mock sits in a week that also has (or will have) a weekly paper and nothing has been decided. */
  choiceUnresolved: boolean
  paper: { onCalendar: boolean; taskId: string | null; title: string | null; date: string | null; started: boolean }
  conflicts: { title: string; overlapMinutes: number }[]
  suggestions: (Suggestion & { taskId: string | null })[]
  related: RelatedTask[]
  history: { plannedDate: string; actualDate: string | null; outcome: MockOutcome; reportedResult: string | null }[]
}

export const checkpointHref = (date: string, weekStart?: string, appointmentId?: string) => `/app/calendar?week=${weekStart ?? date}${appointmentId ? `&appointment=${appointmentId}` : ''}#checkpoint`

async function computeProjection(userId: string, now = new Date(), appointmentId?: string | null) {
  const cp = await loadCheckpoint(userId, appointmentId)
  if (!cp) return null
  const admin = createAdminClient()
  const local = utcToZonedParts(now, cp.timezone)
  const week = await weekForDate(userId, cp.date)
  // Look from five days before to three after: that is where preparation and the check-in can go.
  const dates = Array.from({ length: 9 }, (_, i) => addDays(cp.date, i - 5))
  const [{ data: windowRows }, occupants, { data: profile }, { data: cycle }, { data: planned }] = await Promise.all([
    admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', userId).eq('status', 'active'),
    occupantsFor(userId, dates, cp.timezone),
    admin.from('profiles').select('prep_mode, max_session_minutes').eq('id', userId).maybeSingle(),
    admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    admin.from('plan_blocks').select('local_date, duration_minutes, execution, cancelled_at, id').eq('user_id', userId).gte('local_date', dates[0]).lte('local_date', dates[dates.length - 1]),
  ])
  // Every OTHER planned appointment with a time and length is also time the student has set aside.
  const { data: others } = await admin.from('mock_appointments').select('id, kind, label, planned_date, start_time, duration_minutes').eq('user_id', userId).eq('status', 'planned').neq('id', cp.id).in('planned_date', dates)
  for (const o of others ?? []) {
    if (!o.start_time || !o.duration_minutes) continue
    occupants.push({ id: `appt-${o.id}`, title: (o.label as string | null)?.trim() || MOCK_KIND_LABEL[o.kind as MockKind] || 'Another mock', date: o.planned_date as string, start: toMinutes(String(o.start_time).slice(0, 5)), durationMinutes: o.duration_minutes as number, isProtected: true, kind: 'commitment' })
  }
  const windowsByDate: Record<string, Range[]> = {}
  for (const d of dates) {
    windowsByDate[d] = (windowRows ?? []).filter(w => w.weekday === weekdayOf(d) && w.start_time && w.end_time)
      .map(w => ({ start: toMinutes(String(w.start_time).slice(0, 5)), end: toMinutes(String(w.end_time).slice(0, 5)) }))
  }
  // Accepted work on a day (excluding this checkpoint's own tasks, which the projection replaces) is not free time.
  const { data: mine } = await admin.from('checkpoint_suggestion_tasks').select('task_id').eq('user_id', userId).eq('checkpoint_id', cp.id)
  const own = new Set((mine ?? []).map(m => m.task_id as string))
  const plannedMinutesByDate: Record<string, number> = {}
  for (const b of planned ?? []) {
    if (b.cancelled_at || ['cancelled', 'skipped'].includes(b.execution as string) || own.has(b.id as string) || !b.local_date) continue
    plannedMinutesByDate[b.local_date as string] = (plannedMinutesByDate[b.local_date as string] ?? 0) + Number(b.duration_minutes ?? 0)
  }
  const route = profile?.prep_mode === 'instructor_led' ? 'coaching' : profile?.prep_mode === 'hybrid' ? 'hybrid' : 'self_study'
  const openCycle = cycle ? { id: cycle.id as string, start: cycle.starts_at_local as string, end: cycle.ends_at_local as string } : null
  const { suggestions, conflicts } = projectCheckpoint({
    checkpoint: cp, today: local.date, windowsByDate, occupants, route, maxSittingMinutes: (profile?.max_session_minutes ?? null) as number | null,
    now: { date: local.date, minutes: local.minutesOfDay }, plannedMinutesByDate, openCycle,
  })
  return { cp, week, suggestions, conflicts, openCycle, today: local.date }
}

/** Tasks the student added from a checkpoint's suggestions, with whether they now need a decision. */
async function loadRelated(userId: string, currentId: string | null, suggestions: Suggestion[], timezone: string, plannedIds: Set<string> = new Set(currentId ? [currentId] : [])): Promise<RelatedTask[]> {
  const admin = createAdminClient()
  const { data: maps } = await admin.from('checkpoint_suggestion_tasks').select('checkpoint_id, suggestion_id, task_id, reviewed_at, basis_date').eq('user_id', userId)
  if (!maps?.length) return []
  const [{ data: tasks }, { data: appts }] = await Promise.all([
    admin.from('plan_blocks').select('id, title, local_date, starts_at, execution, revision, cancelled_at').eq('user_id', userId).in('id', maps.map(m => m.task_id as string)),
    admin.from('mock_appointments').select('id, planned_date, status').eq('user_id', userId).in('id', [...new Set(maps.map(m => m.checkpoint_id as string))]),
  ])
  const byId = new Map((tasks ?? []).map(t => [t.id as string, t]))
  const apptById = new Map((appts ?? []).map(a => [a.id as string, a]))
  const day = (d: string) => formatStudyDate(d, 'short')
  const out: RelatedTask[] = []
  for (const m of maps) {
    const t = byId.get(m.task_id as string)
    if (!t || t.cancelled_at || t.execution === 'cancelled') continue
    const open = ['not_started', 'deferred', 'in_progress'].includes(t.execution as string)
    const appt = apptById.get(m.checkpoint_id as string)
    const live = appt?.status === 'planned' && plannedIds.has(m.checkpoint_id as string)
    // Review is asked for on an ACTUAL schedule change to this task's own appointment (any planned one, not only the next), measured against
    // the date the student last accepted or kept; or when that appointment is gone. A kept task is not asked again until it moves again.
    const reason = !live ? (m.reviewed_at ? null : 'The mock this was for has been cancelled, finished or replaced.')
      : m.basis_date && appt!.planned_date !== m.basis_date ? `The mock moved from ${day(m.basis_date as string)} to ${day(appt!.planned_date as string)}.` : null
    const needsReview = open && !!reason
    out.push({ taskId: t.id as string, title: t.title as string, date: (t.local_date ?? null) as string | null, execution: t.execution as string, revision: t.revision as number,
      suggestionId: m.suggestion_id as string, forCurrent: m.checkpoint_id === currentId, startMinutes: t.starts_at ? utcToZonedParts(new Date(t.starts_at as string), timezone).minutesOfDay : null, needsReview, reason: needsReview ? reason : null, removable: ['not_started', 'deferred'].includes(t.execution as string) })
  }
  return out
}

/** Tasks added for a mock that no longer exists (cancelled, taken or moved away), for Calendar to put in front of the student. */
export async function relatedNeedingReview(userId: string): Promise<RelatedTask[]> {
  const state = await computeProjection(userId)
  const admin = createAdminClient()
  const tz = state?.cp.timezone ?? ((await admin.from('profiles').select('timezone').eq('id', userId).maybeSingle()).data?.timezone as string | undefined) ?? 'UTC'
  const { data: planned } = await admin.from('mock_appointments').select('id').eq('user_id', userId).eq('status', 'planned')
  return (await loadRelated(userId, state?.cp.id ?? null, state?.suggestions ?? [], tz, new Set((planned ?? []).map(x => x.id as string)))).filter(r => r.needsReview)
}

async function choiceRowForWeek(userId: string, weekStart: string): Promise<{ choice: AssessmentChoice; appointmentId: string | null } | null> {
  const { data } = await createAdminClient().from('cycle_assessment_choices').select('choice, appointment_id').eq('user_id', userId).eq('week_start', weekStart).maybeSingle()
  return data ? { choice: data.choice as AssessmentChoice, appointmentId: (data.appointment_id ?? null) as string | null } : null
}

/** The canonical schedule: every appointment, planned ones first by date, then recent history. One reader for Home, Calendar, Tests, Coach, Settings and the roadmap. */
async function listAppointmentsUncached(userId: string, history = 6): Promise<AppointmentSummary[]> {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('mock_appointments').select('id, version, planned_date, kind, label, start_time, duration_minutes, status').eq('user_id', userId).order('planned_date').order('created_at').throwOnError()
  const all = (rows ?? []).filter(r => (MOCK_KINDS as readonly string[]).includes(r.kind as string))
  const planned = all.filter(r => r.status === 'planned')
  const past = all.filter(r => r.status !== 'planned').sort((a, b) => String(b.planned_date).localeCompare(String(a.planned_date))).slice(0, history)
  const chosen = [...planned, ...past]
  const { data: choices } = await admin.from('cycle_assessment_choices').select('week_start, choice, appointment_id').eq('user_id', userId).eq('choice', 'use_mock')
  const { data: rehearsals } = chosen.length ? await admin.from('mock_rehearsals').select('id, appointment_id, status, created_at').eq('user_id', userId).in('appointment_id', chosen.map(c => c.id as string)).in('status', ['ready', 'in_progress', 'complete']).order('created_at', { ascending: false }) : { data: [] as any[] }
  const reports = new Map<string, { reportedResult: string | null; notes: string | null }>()
  for (let i = 0; i < chosen.length; i += 100) {
    const { data: rep } = await admin.from('mock_outcomes').select('checkpoint_id, reported_result, notes, recorded_at').eq('user_id', userId).eq('outcome', 'taken').in('checkpoint_id', chosen.slice(i, i + 100).map(c => c.id as string)).order('recorded_at').throwOnError()
    for (const x of rep ?? []) reports.set(x.checkpoint_id as string, { reportedResult: (x.reported_result ?? null) as string | null, notes: (x.notes ?? null) as string | null })
  }
  const out: AppointmentSummary[] = []
  for (const r of chosen) {
    const week = await weekForDate(userId, r.planned_date as string)
    const reh = (rehearsals ?? []).find(x => x.appointment_id === r.id)
    const state = reh ? await getRehearsal(userId, reh.id as string) : null
    const kind = r.kind as MockKind
    out.push({
      id: r.id as string, version: (r.version ?? 1) as number, date: r.planned_date as string, kind, title: (r.label as string | null)?.trim() || MOCK_KIND_LABEL[kind],
      startTime: r.start_time ? String(r.start_time).slice(0, 5) : null, durationMinutes: (r.duration_minutes ?? null) as number | null, status: r.status as AppointmentSummary['status'],
      weekStart: week.startDate, href: checkpointHref(r.planned_date as string, week.startDate, r.id as string),
      designated: (choices ?? []).some(c => c.week_start === week.startDate && (c.appointment_id === r.id || (c.appointment_id === null && planned.filter(p => p.planned_date >= week.startDate && p.planned_date <= week.endDate).length === 1))),
      rehearsal: state ? { id: state.id, stage: state.stage, primary: state.primary } : null,
      report: reports.get(r.id as string) ?? null,
    })
  }
  return out
}

export const listAppointments = perRequest(listAppointmentsUncached, (userId, history = 6) => `${userId}|${history}`)

/** Read model for every surface. Read-only: nothing is written, nothing is added to the week. */
async function getCheckpointViewUncached(userId: string, now = new Date(), appointmentId?: string | null): Promise<CheckpointView | null> {
  const state = await computeProjection(userId, now, appointmentId)
  if (!state) return null
  const admin = createAdminClient()
  const { cp, week, suggestions, conflicts } = state
  const [choiceRow, related, { data: history }, paperRaw, appointments] = await Promise.all([
    choiceRowForWeek(userId, week.startDate),
    loadRelated(userId, cp.id, suggestions, cp.timezone, new Set(((await admin.from('mock_appointments').select('id').eq('user_id', userId).eq('status', 'planned')).data ?? []).map(x => x.id as string))),
    admin.from('mock_outcomes').select('planned_date, actual_date, outcome, reported_result').eq('user_id', userId).order('recorded_at', { ascending: false }).limit(5),
    admin.rpc('checkpoint_week_paper', { p_user: userId, p_week_start: week.startDate }),
    listAppointments(userId),
  ])
  const thisOnes = choiceRow && (choiceRow.appointmentId === null || choiceRow.appointmentId === cp.id)
  const choice = thisOnes ? choiceRow!.choice : null
  const elsewhereRow = choiceRow?.choice === 'use_mock' && choiceRow.appointmentId && choiceRow.appointmentId !== cp.id ? appointments.find(a => a.id === choiceRow.appointmentId) : null
  const p = paperRaw.data as { taskId: string; started: boolean } | null
  let paper: CheckpointView['paper'] = { onCalendar: false, taskId: null, title: null, date: null, started: false }
  if (p?.taskId) {
    const { data: t } = await admin.from('plan_blocks').select('title, local_date').eq('id', p.taskId).maybeSingle()
    paper = { onCalendar: true, taskId: p.taskId, title: (t?.title ?? 'Weekly paper') as string, date: (t?.local_date ?? null) as string | null, started: p.started }
  }
  const taskOf = new Map(related.filter(r => r.forCurrent).map(r => [r.suggestionId, r]))
  return {
    appointments, selectedId: cp.id, designatedElsewhere: elsewhereRow ? { id: elsewhereRow.id, title: elsewhereRow.title } : null,
    checkpointId: cp.id, version: cp.version,
    checkpoint: { date: cp.date, kind: cp.kind, label: cp.label, startTime: cp.startTime, durationMinutes: cp.durationMinutes },
    title: cp.label?.trim() || '', missing: missingDetails(cp),
    week: { startDate: week.startDate, endDate: week.endDate },
    href: checkpointHref(cp.date, week.startDate, cp.id),
    choice, choiceUnresolved: (choice === null || choice === 'later') && !elsewhereRow,
    paper, conflicts,
    // An added suggestion shows where its task really is, not a fresh proposal computed around the task itself.
    suggestions: suggestions.map(s => { const t = taskOf.get(s.id); return t ? { ...s, taskId: t.taskId, date: t.date, startMinutes: t.startMinutes } : { ...s, taskId: null } }),
    related,
    history: (history ?? []).map(h => ({ plannedDate: h.planned_date as string, actualDate: (h.actual_date ?? null) as string | null, outcome: h.outcome as MockOutcome, reportedResult: (h.reported_result ?? null) as string | null })),
  }
}

export const getCheckpointView = perRequest(getCheckpointViewUncached, (userId, now, appointmentId) => `${userId}|${minuteOf(now)}|${appointmentId ?? ''}`)

/**
 * What can replace a cancelled or postponed mock as the week's assessment. Honest about the bank: when no paper can be
 * assembled from completed work, say so, and the week can still be closed without a paper.
 */
export async function replacementOffer(userId: string, now = new Date()): Promise<{ paperAvailable: boolean; message: string }> {
  const available = await startablePaperExists(userId, now)
  return available
    ? { paperAvailable: true, message: 'Your normal weekly paper can still be your assessment this week. Check Tests to see what it would cover.' }
    : { paperAvailable: false, message: 'The question bank cannot support a paper from the work completed so far, so there is no replacement to offer. You can still close the week without a paper.' }
}

/**
 * The student's most recent COMPLETED mock, whether or not anything is booked next: "no upcoming mock" is not "no mock history".
 * Everything here is the student's own report (a free-text result and notes); it is context and a link, never test evidence.
 * `href` is null when the appointment was since deleted; the report itself is kept and still named.
 */
export type MockReport = { appointmentId: string | null; plannedDate: string; takenOn: string; kind: MockKind; title: string; reportedResult: string | null; notes: string | null; href: string | null }
export async function getLatestMockReport(userId: string): Promise<MockReport | null> {
  const admin = createAdminClient()
  const { data: rows } = await admin.from('mock_outcomes').select('checkpoint_id, planned_date, actual_date, kind, label, reported_result, notes, recorded_at')
    .eq('user_id', userId).eq('outcome', 'taken').order('actual_date', { ascending: false, nullsFirst: false }).order('planned_date', { ascending: false }).order('recorded_at', { ascending: false }).limit(1).throwOnError()
  const r = rows?.[0]
  if (!r || !(MOCK_KINDS as readonly string[]).includes(r.kind as string)) return null
  const id = (r.checkpoint_id ?? null) as string | null
  const exists = id ? Boolean((await admin.from('mock_appointments').select('id').eq('user_id', userId).eq('id', id).maybeSingle().throwOnError()).data) : false
  const kind = r.kind as MockKind, date = (r.actual_date ?? r.planned_date) as string
  return {
    appointmentId: exists ? id : null, plannedDate: r.planned_date as string, takenOn: date, kind, title: (r.label as string | null)?.trim() || MOCK_KIND_LABEL[kind],
    reportedResult: (r.reported_result ?? null) as string | null, notes: (r.notes ?? null) as string | null,
    href: exists ? checkpointHref(r.planned_date as string, (await weekForDate(userId, r.planned_date as string)).startDate, id!) : null,
  }
}
