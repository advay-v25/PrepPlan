import { createHash, randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../supabase/admin'
import { addDays, todayInZone, weekdayOf, type Weekday } from '../studyWeek'
import { expandCommitment } from '../mutations'
import { dailyFreeRanges, minutesBetween } from '../pulse/capacity'
import { subtractOverlaps } from '../pulse/capacity'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import { SEEDED_MINUTES_PER_EFFORT_UNIT } from '../../curriculum/roadmap'
import {
  planClassConsolidation, sittingCeiling, coveredUnits, type Carryover, type Extent, type LoggedItem, type Pressure, type PlannedTask,
} from './consolidation'
import { sittingText, sittingSuffix } from './taskText'
import { readAll } from '../../supabase/readAll'
import { classEntryIdentity } from './identity'

/**
 * Class log service. Everything except `confirmClassLog` is a pure read: a
 * preview never writes. The single mutation is the apply_class_log RPC, called
 * with the caller's own session so auth.uid() is the ownership check.
 */

export type ClassKind = 'covered' | 'revision' | 'missed' | 'cancelled' | 'none'
export const CLASS_KINDS: ClassKind[] = ['covered', 'revision', 'missed', 'cancelled', 'none']

export type LogItemInput = { outcomeId: string; extent: Extent; portionNote?: string; studiedInClass?: boolean }
/** `series:<commitment>:<original date>` | `once:<commitment>` | `manual:<uuid>`. Absent = a legacy date-level entry (identity unresolved). */
export type LogInput = { classDate: string; kind: ClassKind; note?: string; items: LogItemInput[]; occurrenceKey?: string
  /** Continue/correct an EXISTING session (same class): classDate, kind and occurrence then come from the saved session, never from the request. */
  sessionId?: string }

/** One actual class. `legacy`: the day carries an older date-level log whose class was never recorded, so this one is not guessed to be it. */
export type ClassOccurrenceInfo = {
  key: string; commitmentId: string; label: string; date: string; originalDate: string; moved: boolean
  /** The class has started but its scheduled end has not passed. Reporting is allowed; whether the LOG is finished is `completed`, never the clock. */
  inProgress: boolean
  status: 'pending' | 'logged' | 'legacy'; sessionId: string | null
  /** For a logged class: its explicit completion and the version an update must name. The clock never completes a log. */
  completed: boolean | null; version: number | null
}
export const OCCURRENCE_KEY = /^(series:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}|once:[0-9a-f-]{36}|manual:[0-9a-f-]{36})$/
/** The commitment and original date a series/once key names (what the database stores beside the key). */
export function occurrenceParts(key: string | undefined): { commitmentId: string | null; date: string | null } {
  const m = key?.match(/^(?:series|once):([0-9a-f-]{36})(?::(\d{4}-\d{2}-\d{2}))?$/)
  return { commitmentId: m?.[1] ?? null, date: m?.[2] ?? null }
}

type SavedClassSession = { id: string; classDate: string; kind: ClassKind; occurrenceKey: string | null; version: number; completed: boolean; items: { outcomeId: string; extent: Extent; portionNote: string | null; studiedInClass: boolean }[] }

export type ClassLogContext =
  | { classLed: false }
  | {
      classLed: true
      cycle: { id: string; startsAt: string; endsAt: string; timezone: string } | null
      today: string
      classDates: string[]
      /** Days that still have at least one unlogged class. */
      pendingDates: string[]
      /** Every actual class so far this cycle, each with its own status: a date is not a class. */
      occurrences: ClassOccurrenceInfo[]
      sessions: SavedClassSession[]
    }

export type PreviewTask = {
  date: string; title: string; detail: string | null; minutes: number; lane: string; outcomeId: string | null; sessionId: string | null
  /** Linked sittings: position, the settled total (null while some work is still owed), and the generated meaning. */
  sitting: { index: number; count: number | null } | null
  objective: string; rationale: string; approach: string; completion: string; verification: string; reference: string
  readingId: string | null
  /** Plan-local keys: this sitting, and the sitting before it (an earlier task's id when it already exists). Order is declared, never inferred. */
  key: string | null; after: string | null; ordinal: number | null; itemKey: string | null; groupId: string | null; groupParts: number | null; groupNew: boolean
}
type ReadyClassLogPreview = {
  ok: true
  tasks: PreviewTask[]
  carryover: { title: string; reason: Carryover['reason']; remainingMinutes: number; placedMinutes: number; itemKey: string | null; classDate: string; classLabel: string | null }[]
  pressure: Pressure
  fingerprint: string
  skippedStudiedInClass: number
  /** What was proposed against what exists: the student's sitting limit, minutes placed now and minutes still owed. */
  summary: { maxSittingMinutes: number; placedMinutes: number; remainingMinutes: number; usableMinutes: number }
  update: { sessionId: string; version: number; completed: boolean; changedItems: number } | null
}
export type ClassLogPreview = ReadyClassLogPreview | { ok: false; code: 'no_cycle' | 'bad_date' | 'bad_item' | 'not_class_led'; message: string }
type PlannedClassLog = ReadyClassLogPreview & {
  cycleId: string
  plannedNew: Record<string, number>
  plannedOld: Record<string, number>
}

function taskPayloads(preview: PlannedClassLog, idFor: (key: string) => string, sessionFor: (task: PreviewTask) => string, minutesFor: (task: PreviewTask) => number) {
  return preview.tasks.map(t => ({
    id: t.key ? idFor(t.key) : `task-cl-${randomUUID().slice(0, 12)}`,
    title: t.title, detail: t.detail ?? '', task_type: t.lane === 'revision' ? 'review' : 'study', origin: 'planner',
    local_date: t.date, duration_minutes: t.minutes,
    rationale: t.rationale || (t.lane === 'revision' ? 'Revising what class went back over.' : 'Consolidating what you covered in class.'),
    session_id: sessionFor(t), outcome_id: t.outcomeId ?? '',
    lm_id: t.readingId ?? '', learning_objective: t.objective, suggested_approach: t.approach, completion_meaning: t.completion,
    verification_intent: t.verification, curriculum_reference: t.reference,
    // `after` is either an earlier sitting of this plan (a plan-local key) or an already saved task id
    dependencies: t.after ? [t.after.includes('#') ? idFor(t.after) : t.after] : [],
    group_key: t.groupNew ? t.groupId : '', group_id: t.groupId && !t.groupNew ? t.groupId : '',
    sitting_ordinal: t.ordinal ?? 1, item_planned: minutesFor(t),
    max_sitting: preview.summary.maxSittingMinutes,
  }))
}

export async function getClassLogWeek(userId: string) {
  const { data: cycle } = await createAdminClient().from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone')
    .eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError()
  return cycle ? { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt: cycle.ends_at_local as string, timezone: (cycle.timezone as string | null) ?? 'UTC' } : null
}

/** Read the student's own report even after the reporting cycle or timetable changes. */
export async function getSavedClassLog(userId: string, sessionId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return null
  const admin = createAdminClient()
  const { data: row } = await admin.from('class_sessions')
    .select('id, class_date, kind, occurrence_key, version, completed_at, commitment_id, calendar_commitments(label)')
    .eq('user_id', userId).eq('id', sessionId).maybeSingle().throwOnError()
  if (!row) return null
  const items = await readAll((a, z) => admin.from('class_session_items').select('outcome_id, extent, portion_note, studied_in_class')
    .eq('session_id', sessionId).order('outcome_id').range(a, z))
  const session: SavedClassSession = {
    id: row.id, classDate: row.class_date, kind: row.kind as ClassKind, occurrenceKey: row.occurrence_key,
    version: Number(row.version), completed: Boolean(row.completed_at),
    items: items.map(i => ({ outcomeId: i.outcome_id, extent: i.extent as Extent, portionNote: i.portion_note, studiedInClass: i.studied_in_class })),
  }
  const { date } = occurrenceParts(session.occurrenceKey ?? undefined)
  const commitment = row.calendar_commitments as unknown as { label: string } | null
  const occurrence: ClassOccurrenceInfo = {
    key: session.occurrenceKey ?? `saved:${session.id}`, commitmentId: row.commitment_id ?? '',
    label: commitment?.label ?? (session.occurrenceKey?.startsWith('manual:') ? 'Manual class' : 'Saved class'),
    date: session.classDate, originalDate: date ?? session.classDate, moved: Boolean(date && date !== session.classDate),
    status: 'logged', sessionId: session.id, completed: session.completed, version: session.version, inProgress: false,
  }
  return { session, occurrence }
}

export async function listSavedClassLogs(userId: string, start: string, end: string) {
  const admin = createAdminClient()
  const rows = await readAll((a, z) => admin.from('class_sessions')
    .select('id, class_date, occurrence_key, completed_at, calendar_commitments(label)')
    .eq('user_id', userId).gte('class_date', start).lte('class_date', end).order('class_date').order('id').range(a, z))
  return rows.map(row => ({
    id: row.id as string, date: row.class_date as string, key: row.occurrence_key as string | null, finished: Boolean(row.completed_at),
    label: (row.calendar_commitments as unknown as { label: string } | null)?.label ?? (String(row.occurrence_key).startsWith('manual:') ? 'Manual class' : 'Saved class'),
  }))
}

export async function savedClassSessionForOccurrence(userId: string, key: string): Promise<string | null> {
  const { data } = await createAdminClient().from('class_sessions').select('id')
    .eq('user_id', userId).eq('occurrence_key', key).maybeSingle().throwOnError()
  return (data?.id as string | undefined) ?? null
}

export async function getClassLogContext(userId: string, now = new Date()): Promise<ClassLogContext> {
  const admin = createAdminClient()
  const [{ data: commitments }, { data: exceptions }, { data: profile }, { data: changes }] = await Promise.all([
    admin.from('calendar_commitments').select('*').eq('user_id', userId).eq('kind', 'class').eq('status', 'active').throwOnError(),
    admin.from('commitment_exceptions').select('*').eq('user_id', userId).throwOnError(),
    admin.from('profiles').select('class_pattern').eq('id', userId).maybeSingle().throwOnError(),
    // The engine's own record of "this series continues as that one": the only authority for succession (labels are never identity).
    admin.from('checkpoint_commands').select('receipt').eq('user_id', userId).eq('command', 'class_change').not('receipt->>successorId', 'is', null).throwOnError(),
  ])
  if ((commitments ?? []).length === 0 && (!profile?.class_pattern || profile.class_pattern === 'none')) return { classLed: false }

  const cycle = await getClassLogWeek(userId)
  const timezone = cycle?.timezone ?? 'UTC'
  const today = todayInZone(timezone, now)
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const nowMinutes = Number(nowParts.find(x => x.type === 'hour')!.value) * 60 + Number(nowParts.find(x => x.type === 'minute')!.value)
  if (!cycle) return { classLed: true, cycle: null, today, classDates: [], pendingDates: [], occurrences: [], sessions: [] }

  const { startsAt: starts, endsAt: ends } = cycle
  const dates: string[] = []
  for (let d = starts; d < ends && d <= today; d = addDays(d, 1)) dates.push(d)
  const occurrenceExceptions = (exceptions ?? []).map(e => ({
    commitmentId: e.commitment_id, occurrenceDate: e.occurrence_date, kind: e.kind as 'skipped' | 'moved',
    newDate: e.new_date, newStartTime: e.new_start_time, newEndTime: e.new_end_time,
  }))
  const found: { key: string; commitmentId: string; label: string; date: string; originalDate: string; moved: boolean; inProgress: boolean }[] = (commitments ?? []).flatMap(c => c.recurrence === 'weekly'
    ? expandCommitment({ id: c.id, label: c.label, kind: 'class', isProtected: true, recurrence: 'weekly',
      weekdays: c.weekdays ?? [], startTime: c.start_time, endTime: c.end_time, startsOn: c.starts_on, endsOn: c.ends_on,
    }, dates, occurrenceExceptions).filter(o => o.date < today || o.start <= nowMinutes).map(o => ({ key: `series:${c.id}:${o.originalDate}`, commitmentId: c.id as string, label: c.label as string, date: o.date, originalDate: o.originalDate, moved: o.moved, inProgress: o.date >= today && o.start + o.durationMinutes > nowMinutes }))
    : c.starts_at && new Date(c.starts_at) <= now && dates.includes(todayInZone(timezone, new Date(c.starts_at)))
      ? [{ key: `once:${c.id}`, commitmentId: c.id as string, label: c.label as string, date: todayInZone(timezone, new Date(c.starts_at)), originalDate: todayInZone(timezone, new Date(c.starts_at)), moved: false, inProgress: !c.ends_at || new Date(c.ends_at) > now }] : [])

  const sess = await readAll((a, z) => admin.from('class_sessions').select('id, class_date, kind, occurrence_key, version, completed_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string).order('id').range(a, z))
  const savedItems: { session_id: string; outcome_id: string; extent: string; portion_note: string | null; studied_in_class: boolean }[] = []
  for (let i = 0; i < (sess ?? []).length; i += 100) savedItems.push(...await readAll((a, z) => admin.from('class_session_items').select('session_id, outcome_id, extent, portion_note, studied_in_class')
    .in('session_id', sess.slice(i, i + 100).map(x => x.id as string)).order('session_id').order('outcome_id').range(a, z)))
  const sessions = (sess ?? []).map(s => ({ id: s.id as string, classDate: s.class_date as string, kind: s.kind as ClassKind, occurrenceKey: (s.occurrence_key as string | null) ?? null,
    version: Number(s.version ?? 1), completed: Boolean(s.completed_at),
    items: savedItems.filter(x => x.session_id === s.id).map(x => ({ outcomeId: x.outcome_id, extent: x.extent as Extent, portionNote: x.portion_note, studiedInClass: x.studied_in_class })) }))
  const byKey = new Map(sessions.filter(x => x.occurrenceKey).map(x => [x.occurrenceKey!, x.id]))
  const legacyDates = new Set(sessions.filter(x => !x.occurrenceKey).map(x => x.classDate))
  // A "from this date" series change ends the old series the day before and starts a successor (new id, same label) ON the effective date. A class
  // already logged under the old series that day is the SAME class: follow that one engine-made succession, never a guess.
  const predecessorOf = new Map((changes ?? []).map(c => [(c.receipt as { successorId: string }).successorId, (c.receipt as { commitmentId: string }).commitmentId]))
  const loggedBeforeSuccession = (o: { commitmentId: string; originalDate: string }) => {
    for (let id = o.commitmentId, hops = 0; hops < 20; hops++) {
      const prev = predecessorOf.get(id); if (!prev) return null
      const logged = byKey.get(`series:${prev}:${o.originalDate}`); if (logged) return logged
      id = prev
    }
    return null
  }
  const sessionById = new Map(sessions.map(x => [x.id, x]))
  const loggedInfo = (id: string) => ({ status: 'logged' as const, sessionId: id, completed: sessionById.get(id)?.completed ?? null, version: sessionById.get(id)?.version ?? null })
  const occurrences: ClassOccurrenceInfo[] = found.map(o => byKey.has(o.key) ? { ...o, ...loggedInfo(byKey.get(o.key)!) }
    : loggedBeforeSuccession(o) ? { ...o, ...loggedInfo(loggedBeforeSuccession(o)!) }
    : legacyDates.has(o.date) ? { ...o, status: 'legacy' as const, sessionId: null, completed: null, version: null } : { ...o, status: 'pending' as const, sessionId: null, completed: null, version: null })
    .sort((a, b) => a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1)
  const classDates = [...new Set(occurrences.map(o => o.date))].sort()
  return {
    classLed: true,
    cycle,
    today, classDates, pendingDates: [...new Set(occurrences.filter(o => o.status === 'pending').map(o => o.date))].sort(), occurrences, sessions,
  }
}

export type OutcomeInfo = { id: string; title: string; readingId: string; readingNo: number; readingTitle: string; effortPerOutcome: number }

export async function loadOutcomes(ids: string[]): Promise<Map<string, OutcomeInfo>> {
  const admin = createAdminClient()
  if (ids.length === 0) return new Map()
  const los: { id: string; title: string; reading_id: string }[] = []
  for (let i = 0; i < ids.length; i += 100) {
    los.push(...await readAll((a, z) => admin.from('reading_los').select('id, title, reading_id').in('id', ids.slice(i, i + 100)).order('id').range(a, z)))
  }
  const readingIds = [...new Set((los ?? []).map(l => l.reading_id as string))]
  const readings: { id: string; reading_no: number; title: string; effort_units: number; structure_pending: boolean }[] = []
  const counts: { reading_id: string }[] = []
  for (let i = 0; i < readingIds.length; i += 100) {
    const batch = readingIds.slice(i, i + 100)
    const [r, c] = await Promise.all([
      readAll((a, z) => admin.from('curriculum_readings').select('id, reading_no, title, effort_units, structure_pending').in('id', batch).order('id').range(a, z)),
      readAll((a, z) => admin.from('reading_los').select('reading_id').in('reading_id', batch).order('id').range(a, z)),
    ])
    readings.push(...r); counts.push(...c)
  }
  const perReading = new Map<string, number>()
  for (const c of counts ?? []) perReading.set(c.reading_id as string, (perReading.get(c.reading_id as string) ?? 0) + 1)
  const rmap = new Map((readings ?? []).map(r => [r.id as string, r]))
  const out = new Map<string, OutcomeInfo>()
  for (const l of los ?? []) {
    const r = rmap.get(l.reading_id as string)
    if (!r || r.structure_pending) continue
    out.set(l.id as string, {
      id: l.id as string, title: l.title as string, readingId: r.id as string, readingNo: r.reading_no as number, readingTitle: r.title as string,
      effortPerOutcome: Number(r.effort_units) / Math.max(1, perReading.get(r.id as string) ?? 1),
    })
  }
  return out
}

const NEW = 'new'

/** Pure read: what confirming this log would add to the cycle. */
export async function previewClassLog(userId: string, input: LogInput, now = new Date()): Promise<PlannedClassLog | Extract<ClassLogPreview, { ok: false }>> {
  const ctx = await getClassLogContext(userId, now)
  if (!ctx.classLed && !input.sessionId) return { ok: false, code: 'not_class_led', message: 'Class logging is for students with a class schedule.' }
  const cycle = ctx.classLed ? ctx.cycle : await getClassLogWeek(userId)
  if (!cycle) return { ok: false, code: 'no_cycle', message: 'There is no open week yet. Prepare your week in Calendar first.' }
  const today = todayInZone(cycle.timezone, now)
  // Continuing a saved class: the session itself (owned, any cycle) says which class, which day and what kind it was. The timetable is NOT consulted again:
  // revisiting history after a class moved or was cancelled is allowed and never pretends a new attendance event happened.
  let upd: { id: string; version: number; completed: boolean; saved: Map<string, { extent: string; note: string; studied: boolean }> } | null = null
  if (input.sessionId) {
    const a = createAdminClient()
    const { data: sRow } = await a.from('class_sessions').select('id, class_date, kind, occurrence_key, version, completed_at').eq('id', input.sessionId).eq('user_id', userId).maybeSingle().throwOnError()
    if (!sRow) return { ok: false, code: 'bad_item', message: 'That class log could not be found.' }
    const had = await readAll<{ outcome_id: string; extent: string; portion_note: string | null; studied_in_class: boolean }>((x, z) => a.from('class_session_items').select('outcome_id, extent, portion_note, studied_in_class').eq('session_id', sRow.id as string).order('outcome_id').range(x, z))
    upd = { id: sRow.id as string, version: Number(sRow.version), completed: Boolean(sRow.completed_at), saved: new Map(had.map(h => [h.outcome_id, { extent: h.extent, note: h.portion_note ?? '', studied: h.studied_in_class }])) }
    input = { ...input, classDate: sRow.class_date as string, kind: sRow.kind as ClassKind, occurrenceKey: (sRow.occurrence_key as string | null) ?? undefined }
  }
  if (!upd && (input.classDate < cycle.startsAt || input.classDate >= cycle.endsAt || input.classDate > today)) {
    return { ok: false, code: 'bad_date', message: 'Pick a day in this cycle that has already happened.' }
  }
  if (!CLASS_KINDS.includes(input.kind)) return { ok: false, code: 'bad_item', message: 'Unknown class type.' }
  if (input.occurrenceKey && !upd) {
    // A class is named by its own identity. A timetable class must be one that happened and is still unlogged, on the day the student chose;
    // a manual session is a clearly separate entry and only needs its own fresh key.
    if (!OCCURRENCE_KEY.test(input.occurrenceKey)) return { ok: false, code: 'bad_item', message: 'That class could not be identified. Choose it again.' }
    if (!input.occurrenceKey.startsWith('manual:')) {
      const occ = ctx.classLed ? ctx.occurrences.find(o => o.key === input.occurrenceKey) : undefined
      if (!occ || occ.date !== input.classDate) return { ok: false, code: 'bad_date', message: 'That class is not one that has happened in this cycle. Choose it again.' }
      if (occ.status !== 'pending') return { ok: false, code: 'bad_date', message: occ.status === 'logged' ? 'That class has already been logged.' : 'That day already has an older entry that does not say which class it was, so this class is not logged separately.' }
    } else if (ctx.classLed && ctx.sessions.some(x => x.occurrenceKey === input.occurrenceKey)) return { ok: false, code: 'bad_date', message: 'That session has already been logged.' }
  }

  const admin = createAdminClient()
  const outcomes = await loadOutcomes([...new Set(input.items.map(i => i.outcomeId))])
  for (const i of input.items) {
    if (!outcomes.has(i.outcomeId) || !['part', 'full', 'continued'].includes(i.extent)) {
      return { ok: false, code: 'bad_item', message: 'One of the outcomes is not part of the syllabus list.' }
    }
  }
  if (input.kind !== 'covered' && input.kind !== 'revision' && input.items.length > 0) {
    return { ok: false, code: 'bad_item', message: 'A class that did not happen cannot have coverage.' }
  }

  const { data: profile } = await admin.from('profiles').select('max_session_minutes').eq('id', userId).maybeSingle().throwOnError()
  const maxSitting = sittingCeiling((profile?.max_session_minutes as number | null) ?? null)
  const mpu = (await getActiveRoadmap(userId))?.input.observedMinutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  const owed = await loadClassObligations(userId, cycle.id, mpu)
  const oldOutcomes = owed.outcomes

  const detailOf = new Map<string, string | null>()
  const meta = new Map<string, { outcome: OutcomeInfo; extent: Extent; revision: boolean; note: string | null; classDate: string; classLabel: string | null; classOriginalDate: string | null }>()
  const items: LoggedItem[] = []
  const plannedNew: Record<string, number> = {}
  const itemInfo = new Map<string, Obligation>()
  let skippedStudied = 0
  for (const ob of owed.items) {
    if (upd && ob.sessionId !== upd.id) continue // an update plans only the work that this class's report affects
    const o = oldOutcomes.get(ob.outcomeId)
    if (!o || ob.remaining <= 0) continue
    const k = `${ob.sessionId}:${ob.outcomeId}`
    items.push({
      sessionId: ob.sessionId, classDate: ob.classDate, outcomeId: ob.outcomeId, moduleId: '', extent: ob.extent,
      title: `${o.title} (Reading ${o.readingNo})`, outcomeEffortUnits: o.effortPerOutcome, revision: ob.kind === 'revision',
      requiredMinutes: ob.remaining, existing: { groupId: ob.groupId, count: ob.maxOrdinal, lastTaskKey: ob.lastId },
    })
    itemInfo.set(k, ob)
    meta.set(k, { outcome: o, extent: ob.extent, revision: ob.kind === 'revision', note: ob.note, classDate: ob.classDate, classLabel: ob.classLabel, classOriginalDate: ob.classOriginalDate })
  }
  // the class this report is about, by its own name (a new log: the chosen occurrence; an update: the saved session's commitment)
  const thisClass = await (async (): Promise<{ label: string | null; original: string | null }> => {
    if (upd) {
      const { data: r } = await createAdminClient().from('class_sessions').select('commitment_id, occurrence_date').eq('id', upd.id).maybeSingle().throwOnError()
      if (!r?.commitment_id) return { label: 'Your own session', original: null }
      const { data: c } = await createAdminClient().from('calendar_commitments').select('label').eq('id', r.commitment_id as string).maybeSingle().throwOnError()
      return { label: (c?.label as string | undefined) ?? null, original: (r.occurrence_date as string | null) ?? null }
    }
    const o = ctx.classLed && input.occurrenceKey ? ctx.occurrences.find(x => x.key === input.occurrenceKey) : null
    return o ? { label: o.label, original: o.originalDate } : { label: input.occurrenceKey?.startsWith('manual:') ? 'Your own session' : null, original: null }
  })()
  const sid = upd ? upd.id : NEW
  let changedItems = 0
  for (const i of input.items) {
    const sv = upd?.saved.get(i.outcomeId)
    // Saving the same report twice counts once: an item exactly as saved changes nothing and is not planned again.
    if (sv && sv.extent === i.extent && sv.note === (i.portionNote ?? '') && sv.studied === Boolean(i.studiedInClass)) continue
    changedItems++
    const k = `${sid}:${i.outcomeId}`
    const prior = owed.items.find(x => `${x.sessionId}:${x.outcomeId}` === k) // includes items whose planned work is already fully allocated
    // a correction replaces what was still owed for this item; work already accepted or started stays exactly as it is
    if (sv) { const at = items.findIndex(x => `${x.sessionId}:${x.outcomeId}` === k); if (at >= 0) items.splice(at, 1); itemInfo.delete(k); meta.delete(k) }
    if (i.studiedInClass) { skippedStudied++; continue }
    const o = outcomes.get(i.outcomeId)!
    const item: LoggedItem = {
      sessionId: sid, classDate: input.classDate, outcomeId: o.id, moduleId: '', extent: i.extent,
      title: `${o.title} (Reading ${o.readingNo})`, outcomeEffortUnits: o.effortPerOutcome, revision: input.kind === 'revision',
    }
    plannedNew[o.id] = Math.round(coveredUnits(item) * mpu)
    item.requiredMinutes = Math.max(0, plannedNew[o.id] - (prior?.allocated ?? 0))
    if (prior) item.existing = { groupId: prior.groupId, count: prior.maxOrdinal, lastTaskKey: prior.lastId }
    items.push(item)
    if (prior) itemInfo.set(k, { ...prior, extent: i.extent, planned: plannedNew[o.id], remaining: item.requiredMinutes })
    if (i.portionNote) detailOf.set(k, i.portionNote.slice(0, 300))
    meta.set(k, { outcome: o, extent: i.extent, revision: input.kind === 'revision', note: i.portionNote?.slice(0, 300) ?? null, classDate: input.classDate, classLabel: prior?.classLabel ?? thisClass.label, classOriginalDate: prior?.classOriginalDate ?? thisClass.original })
  }

  // Rooms: only time that still exists. Today: from now; later dates: their real windows. Each day's contiguous free ranges, less what is already
  // accepted for that date: a timed task takes its exact interval, an untimed one is packed whole (largest first) into the largest gap that holds it.
  // apply_class_log re-derives the same room under the scheduling lock (class_day_packs), so a stale preview is refused, never over-filled.
  const earliest = today > input.classDate ? today : addDays(input.classDate, 1)
  const dayTasks = await readAll((a, z) => admin.from('plan_blocks')
    .select('id, local_date, duration_minutes, execution, cancelled_at, placement, starts_at')
    .eq('user_id', userId).gte('local_date', earliest).lt('local_date', cycle.endsAt).is('cancelled_at', null).order('id').range(a, z))
  const days: { date: string; capacityMinutes: number; gaps: number[] }[] = []
  for (let d = earliest; d < cycle.endsAt; d = addDays(d, 1)) {
    const gaps = await roomOfDay(userId, d, cycle.timezone, now, (dayTasks ?? []).filter(t => t.local_date === d))
    days.push({ date: d, capacityMinutes: gaps.reduce((s, g) => s + g, 0), gaps })
  }

  const plan = planClassConsolidation({ items, days, repairs: [], minutesPerEffortUnit: mpu, alreadyPlanned: new Set(), maxSittingMinutes: maxSitting })

  // A sitting's identity is its item and ordinal (plan-local `key`), not its day: a re-plan on another day is still the same sitting. The database
  // id is derived at confirmation from the idempotency key, so two classes on one date for one outcome stay two events and a retry is one.
  const remainingOf = new Map(plan.carryover.map(c => [c.itemKey ?? `${c.sessionId}:${c.outcomeId}`, c]))
  const groupFor = new Map<string, { id: string | null; isNew: boolean; parts: number | null }>()
  const tasks: PreviewTask[] = plan.tasks.map((t: PlannedTask) => {
    const m = t.itemKey ? meta.get(t.itemKey) : undefined
    const sitting = t.sitting ?? null
    const text = m && sitting ? sittingText({
      outcomeTitle: m.outcome.title, readingNo: m.outcome.readingNo, readingTitle: m.outcome.readingTitle, classDate: m.classDate, extent: m.extent,
      revision: m.revision, portionNote: m.note, index: sitting.index, count: sitting.count, classLabel: m.classLabel, classOriginalDate: m.classOriginalDate,
    }) : null
    // One scope group per item that has, or is still owed, more than one sitting; later previews attach to it. Its size is the ACTUAL members
    // (the database recounts them); work not yet given a task is the item's owed minutes, which keep the group from completing.
    let g = t.itemKey ? groupFor.get(t.itemKey) : undefined
    if (t.itemKey && !g) {
      const prior = items.find(i => `${i.sessionId}:${i.outcomeId}` === t.itemKey)?.existing
      const placedHere = plan.tasks.filter(x => x.itemKey === t.itemKey).length
      const owedLeft = remainingOf.get(t.itemKey)?.remainingMinutes ?? 0
      g = (prior?.count ?? 0) + placedHere >= 2 || owedLeft > 0 ? { id: prior?.groupId ?? `grp-${t.itemKey}`, isNew: !prior?.groupId, parts: null } : { id: null, isNew: false, parts: null }
      groupFor.set(t.itemKey, g)
    }
    return {
      date: t.date, title: `${t.title}${sitting ? sittingSuffix(sitting.index, sitting.count) : ''}`,
      detail: t.sessionId && t.outcomeId ? detailOf.get(`${t.sessionId}:${t.outcomeId}`) ?? null : null,
      minutes: t.minutes, lane: t.lane, outcomeId: t.outcomeId, sessionId: t.sessionId, sitting,
      objective: text?.objective ?? '', rationale: text?.rationale ?? '', approach: text?.approach ?? '', completion: text?.completion ?? '', verification: text?.verification ?? '', reference: text?.reference ?? '',
      readingId: m?.outcome.readingId ?? null, key: t.key ?? null, after: t.after ?? null, ordinal: t.sitting?.index ?? null, itemKey: t.itemKey ?? null, groupId: g?.id ?? null, groupParts: g?.parts ?? null, groupNew: g?.isNew ?? false,
    }
  })
  const carry = plan.carryover.map(c => ({ title: c.title, reason: c.reason, remainingMinutes: c.remainingMinutes ?? 0, placedMinutes: c.placedMinutes ?? 0, itemKey: c.itemKey ?? null, classDate: (itemInfo.get(c.itemKey ?? '')?.classDate ?? input.classDate), classLabel: itemInfo.get(c.itemKey ?? '')?.classLabel ?? thisClass.label }))
  const placedMinutes = tasks.reduce((n, t) => n + t.minutes, 0)
  const summary = { maxSittingMinutes: maxSitting, placedMinutes, remainingMinutes: carry.reduce((n, c) => n + c.remainingMinutes, 0), usableMinutes: days.reduce((n, d) => n + d.capacityMinutes, 0) }
  const fingerprint = classLogFingerprint({ cycleId: cycle.id, verificationDate: cycle.endsAt, tasks, carryover: carry, pressure: plan.pressure, skippedStudied, maxSitting })

  return {
    ok: true, cycleId: cycle.id, tasks, carryover: carry,
    pressure: plan.pressure, fingerprint, skippedStudiedInClass: skippedStudied, summary,
    update: upd ? { sessionId: upd.id, version: upd.version, completed: upd.completed, changedItems } : null,
    // internal to confirmation; the client never sends task rows
    plannedNew, plannedOld: Object.fromEntries([...itemInfo].map(([k, o]) => [k, o.planned])),
  }
}

/**
 * EFFECT-BASED staleness: the token covers every effect the student reviewed, so a change that alters none of them (an unrelated commitment) leaves
 * the preview valid, while a change to the open week (cycle), the verification day, any task's day, length, mapping, method note or lane, the waiting
 * (carried-over) work, the load verdict or the skipped-as-studied count makes confirmation refuse with nothing written.
 */
export function classLogFingerprint(p: {
  cycleId: string; verificationDate: string
  tasks: { date: string; title: string; minutes: number; outcomeId?: string | null; sessionId?: string | null; lane?: string; detail?: string | null; key?: string | null; after?: string | null }[]
  carryover: { title: string; reason: string; remainingMinutes?: number }[]; pressure: string; skippedStudied: number
  /** The student's sitting limit: a changed limit changes what was reviewed. */
  maxSitting?: number
}) {
  return createHash('sha1').update(JSON.stringify([
    p.cycleId, p.verificationDate,
    p.tasks.map(t => [t.date, t.title, t.minutes, t.outcomeId ?? null, t.sessionId ?? null, t.lane ?? null, t.detail ?? null, t.key ?? null, t.after ?? null]),
    p.carryover.map(c => [c.title, c.reason, c.remainingMinutes ?? 0]), p.pressure, p.skippedStudied, p.maxSitting ?? null,
  ])).digest('hex').slice(0, 16)
}

export type ConfirmResult =
  | { ok: true; sessionId: string; tasks: number; alreadyApplied: boolean; version?: number; completed?: boolean; added?: number; corrected?: number }
  /** `unknown`: the request was sent but its outcome was not seen (connection lost, timeout). It may have been saved: retry with the SAME key. `version_changed`: another tab or device saved first. */
  | { ok: false; code: 'preview_changed' | 'invalid' | 'failed' | 'unknown' | 'version_changed' | 'no_cycle' | 'bad_date' | 'bad_item' | 'not_class_led'; message: string; preview?: ClassLogPreview }

/** A database error that carries a SQLSTATE was ANSWERED by the database, so the whole command rolled back. Anything else may have come after the commit. */
const answered = (error: { code?: string } | null) => /^[0-9A-Z]{5}$/.test(error?.code ?? '')
const UNKNOWN_MESSAGE = 'We could not confirm whether this was saved. Nothing is lost: press Retry to send exactly the same request. If it was saved you will get that result back, never a second copy.'

export async function confirmClassLog(
  db: SupabaseClient, userId: string,
  input: LogInput & { idempotencyKey: string; fingerprint: string; finalise?: boolean }, now = new Date(),
): Promise<ConfirmResult> {
  // Replay of an already-applied key returns the first result without recomputing, even after the clock or the cycle changed.
  // A key names ONE entry: the same key with a different date, kind or set of items is refused, not replayed.
  const admin = createAdminClient()
  const replayOf = async (): Promise<ConfirmResult | null> => {
  const { data: existing } = await admin.from('class_sessions').select('id, class_date, kind, note, occurrence_key, version')
    .eq('user_id', userId).eq('idempotency_key', input.idempotencyKey).maybeSingle().throwOnError()
  if (existing) {
    const { data: had } = await admin.from('class_session_items').select('outcome_id, extent, portion_note, studied_in_class').eq('session_id', existing.id as string).throwOnError()
    // Once the class log has been continued (version > 1) its items are no longer what the first request saved: an older retry is matched on the
    // fixed facts of that request only (day, kind, class, note), and replays the session without touching later coverage or tasks.
    const later = Number(existing.version) > 1
    const same = classEntryIdentity({ date: existing.class_date, kind: existing.kind, note: existing.note, occurrence: existing.occurrence_key,
      items: later ? [] : had.map(h => ({ outcome: h.outcome_id, extent: h.extent, note: h.portion_note, studied: h.studied_in_class })) })
      === classEntryIdentity({ date: input.classDate, kind: input.kind, note: input.note, occurrence: input.occurrenceKey,
        items: later ? [] : input.items.map(i => ({ outcome: i.outcomeId, extent: i.extent, note: i.portionNote, studied: i.studiedInClass })) })
    if (!same) return { ok: false, code: 'invalid', message: 'That request key was already used for a different class entry. Start the entry again.' }
    const { count } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('class_session_id', existing.id as string).throwOnError()
    return { ok: true, sessionId: existing.id as string, tasks: count ?? 0, alreadyApplied: true }
  }
  return null
  }
  const first = await replayOf(); if (first) return first

  const preview = await previewClassLog(userId, input, now)
  if (!preview.ok) {
    const raced = await replayOf(); if (raced) return raced
    return { ok: false, code: preview.code, message: preview.message }
  }
  if (preview.fingerprint !== input.fingerprint) {
    // A concurrent request with the SAME key may have committed between the check above and this preview: that is a replay, not a changed week.
    const raced = await replayOf(); if (raced) return raced
    return { ok: false, code: 'preview_changed', message: 'Your week changed since you previewed it. Review the update again.', preview }
  }

  const plannedNew = preview.plannedNew
  const plannedOf = new Map(Object.entries(preview.plannedOld))
  const idFor = (key: string) => `task-cl-${createHash('sha1').update(`${userId}|${key.startsWith(`${NEW}:`) ? input.idempotencyKey + '|' : ''}${key}`).digest('hex').slice(0, 16)}`
  const tasks = taskPayloads(preview, idFor, t => t.sessionId && t.sessionId !== NEW ? t.sessionId : '',
    t => t.sessionId && t.sessionId !== NEW ? plannedOf.get(`${t.sessionId}:${t.outcomeId}`) ?? 0 : 0)
  const { data, error } = await db.rpc('apply_class_log', {
    p_cycle_id: preview.cycleId, p_idempotency_key: input.idempotencyKey, p_class_date: input.classDate,
    p_kind: input.kind, p_note: input.note ?? null,
    p_items: input.items.map(i => ({ outcome_id: i.outcomeId, extent: i.extent, portion_note: i.portionNote ?? '', studied_in_class: Boolean(i.studiedInClass), planned_minutes: plannedNew[i.outcomeId] ?? 0 })),
    p_tasks: tasks,
    p_occurrence_key: input.occurrenceKey ?? null, p_commitment_id: occurrenceParts(input.occurrenceKey).commitmentId, p_occurrence_date: occurrenceParts(input.occurrenceKey).date,
    p_finalise: Boolean(input.finalise),
  })
  if (error && /OCCURRENCE_ALREADY_LOGGED/.test(error.message ?? '')) {
    const raced = await replayOf(); if (raced) return raced
    return { ok: false, code: 'invalid', message: 'That class has already been logged. Nothing was added.' }
  }
  if (error && /OCCURRENCE_(INVALID|MOVED|NOT_ENDED|NOT_STARTED)/.test(error.message ?? '')) {
    // The class was changed, cancelled or not over after the review: nothing was written, the input is kept, and the preview is rebuilt from the timetable as it is now.
    const raced = await replayOf(); if (raced) return raced
    const fresh = await previewClassLog(userId, input, new Date())
    const why = (error.message ?? '').replace(/^.*?OCCURRENCE_[A-Z_]+:\s*/, '').replace(/\s+$/, '')
    return fresh.ok ? { ok: false, code: 'preview_changed', message: `${why[0].toUpperCase()}${why.slice(1)}. Nothing was saved; review the update.`, preview: fresh } : { ok: false, code: 'invalid', message: `${why[0].toUpperCase()}${why.slice(1)}. Nothing was saved.` }
  }
  if (error && /PREVIEW_CHANGED/.test(error.message ?? '')) {
    const raced = await replayOf(); if (raced) return raced
    // The week moved between the review and the save (a window expired, a booking or the sitting limit changed): nothing was written; the input is kept.
    const fresh = await previewClassLog(userId, input, new Date())
    return { ok: false, code: 'preview_changed', message: 'Your available study time changed since you previewed it, so nothing was saved. Review the updated plan.', preview: fresh }
  }
  if (error && /IDEMPOTENCY_KEY_REUSED/.test(error.message ?? '')) return { ok: false, code: 'invalid', message: 'That request key was already used for a different class entry. Start the entry again.' }
  if (error && !answered(error)) { console.error('[class-log confirm] unknown outcome', error.message); return { ok: false, code: 'unknown', message: UNKNOWN_MESSAGE } }
  if (error || !data) {
    console.error('[class-log confirm]', error?.message)
    return { ok: false, code: 'failed', message: 'Could not save the class log. Nothing was changed — try again.' }
  }
  const r = data as { session_id: string; already_applied: boolean; tasks: number }
  return { ok: true, sessionId: r.session_id, tasks: r.tasks, alreadyApplied: r.already_applied }
}


/**
 * Continue, correct or finish a class log that already exists (the SAME session): versioned, receipted by key, one transaction with whatever follow-up
 * work it adds. A key already saved is answered from its receipt without re-planning, so a lost reply is replayed even after the week has changed.
 */
export async function confirmClassLogUpdate(
  db: SupabaseClient, userId: string,
  input: LogInput & { sessionId: string; idempotencyKey: string; fingerprint: string; expectedVersion: number; finalise: boolean }, now = new Date(),
): Promise<ConfirmResult> {
  const admin = createAdminClient()
  const itemsPayload = (planned: Record<string, number>) => input.items.map(i => ({ outcome_id: i.outcomeId, extent: i.extent, portion_note: i.portionNote ?? '', studied_in_class: Boolean(i.studiedInClass), planned_minutes: planned[i.outcomeId] ?? 0 }))
  const call = async (cycleId: string | null, planned: Record<string, number>, tasks: unknown[]): Promise<ConfirmResult> => {
    const { data, error } = await db.rpc('apply_class_log_update', {
      p_cycle_id: cycleId, p_session_id: input.sessionId, p_idempotency_key: input.idempotencyKey, p_expected_version: input.expectedVersion,
      p_finalise: input.finalise, p_items: itemsPayload(planned), p_tasks: tasks,
    })
    const msg = error?.message ?? ''
    if (error && !answered(error)) { console.error('[class-log update] unknown outcome', msg); return { ok: false, code: 'unknown', message: UNKNOWN_MESSAGE } }
    if (/VERSION_MISMATCH/.test(msg)) return { ok: false, code: 'version_changed', message: 'This class log was changed in another tab or device since you opened it. Nothing was saved by this request. Reload it to see what is saved, then make your change again.' }
    if (/IDEMPOTENCY_KEY_REUSED/.test(msg)) return { ok: false, code: 'invalid', message: 'That request key was already used for a different class update. Start the update again.' }
    if (/PREVIEW_CHANGED/.test(msg)) {
      console.warn('[class-log update] preview changed:', msg)
      const fresh = await previewClassLog(userId, input, new Date())
      return { ok: false, code: 'preview_changed', message: 'Your available study time changed since you previewed it, so nothing was saved. Review the updated plan.', preview: fresh }
    }
    if (error || !data) { console.error('[class-log update]', msg); return { ok: false, code: 'failed', message: 'Could not save the class log. Nothing was changed — try again.' } }
    const r = data as { session_id: string; already_applied: boolean; tasks: number; version: number; completed: boolean; added: number; corrected: number }
    return { ok: true, sessionId: r.session_id, tasks: r.tasks, alreadyApplied: r.already_applied, version: r.version, completed: r.completed, added: r.added, corrected: r.corrected }
  }
  const { data: receipt } = await admin.from('class_log_updates').select('idempotency_key').eq('user_id', userId).eq('idempotency_key', input.idempotencyKey).maybeSingle().throwOnError()
  if (receipt) return call(null, {}, []) // the receipt answers (or refuses a different request); nothing is re-planned

  const preview = await previewClassLog(userId, input, now)
  if (!preview.ok) return { ok: false, code: preview.code, message: preview.message }
  if (preview.fingerprint !== input.fingerprint) {
    const raced = await admin.from('class_log_updates').select('idempotency_key').eq('user_id', userId).eq('idempotency_key', input.idempotencyKey).maybeSingle()
    if (raced.data) return call(null, {}, [])
    return { ok: false, code: 'preview_changed', message: 'Your week changed since you previewed it. Review the update again.', preview }
  }
  const plannedNew = preview.plannedNew
  const plannedOf = new Map(Object.entries(preview.plannedOld))
  const idFor = (key: string) => `task-cl-${createHash('sha1').update(`${userId}|${key}`).digest('hex').slice(0, 16)}`
  const tasks = taskPayloads(preview, idFor, () => input.sessionId,
    t => plannedOf.get(`${input.sessionId}:${t.outcomeId}`) ?? plannedNew[t.outcomeId ?? ''] ?? 0)
  return call(preview.cycleId ?? null, plannedNew, tasks)
}

export type Obligation = {
  sessionId: string; outcomeId: string; classDate: string; kind: ClassKind; extent: Extent; note: string | null
  /** The follow-up effort planned when the class was logged (durable); `legacy` rows were logged before it was stored and use today's pace. */
  planned: number; legacy: boolean
  /** Which class: its name, and the day it was originally scheduled when it was moved (a date alone never names a class). */
  classLabel: string | null; classOriginalDate: string | null
  /** Minutes that have a task (cancelled ones excluded; skipped/deferred still count) and minutes that never received one. */
  allocated: number; remaining: number
  /** Highest sitting number used (cancelled included, so a new one never reuses it), the item's group and its latest sitting. */
  maxOrdinal: number; groupId: string | null; lastId: string | null
}

/**
 * Every class item whose planned follow-up effort is not fully allocated, across ALL the student's cycles. Reads only.
 * `activeCycleId` + `mpu`: an item logged before planned minutes were stored can only be priced for the open cycle, at today's pace.
 */
export async function loadClassObligations(userId: string, activeCycleId: string | null, mpu: number): Promise<{ items: Obligation[]; outcomes: Map<string, OutcomeInfo> }> {
  const admin = createAdminClient()
  const sessions = await readAll((a, z) => admin.from('class_sessions').select('id, class_date, kind, cycle_id, commitment_id, occurrence_date').eq('user_id', userId).in('kind', ['covered', 'revision']).order('id').range(a, z))
  const commitmentIds = [...new Set((sessions ?? []).map(x => x.commitment_id as string | null).filter((x): x is string => !!x))]
  const labelOf = new Map<string, string>()
  for (let i = 0; i < commitmentIds.length; i += 100) for (const c of await readAll<{ id: string; label: string }>((a, z) => admin.from('calendar_commitments').select('id, label').eq('user_id', userId).in('id', commitmentIds.slice(i, i + 100)).order('id').range(a, z))) labelOf.set(c.id, c.label)
  const byId = new Map((sessions ?? []).map(x => [x.id as string, x]))
  if (byId.size === 0) return { items: [], outcomes: new Map() }
  const ids = [...byId.keys()]
  const its: { session_id: string; outcome_id: string; extent: string; portion_note: string | null; studied_in_class: boolean; planned_minutes: number | null }[] = []
  const rows: { id: string; class_session_id: string; outcome_id: string; local_date: string | null; duration_minutes: number | null; execution: string; cancelled_at: string | null; scope_group_id: string | null; sitting_ordinal: number | null }[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const [items, tasks] = await Promise.all([
      readAll((a, z) => admin.from('class_session_items').select('session_id, outcome_id, extent, portion_note, studied_in_class, planned_minutes').in('session_id', batch).eq('studied_in_class', false).order('session_id').order('outcome_id').range(a, z)),
      readAll((a, z) => admin.from('plan_blocks').select('id, class_session_id, outcome_id, local_date, duration_minutes, execution, cancelled_at, scope_group_id, sitting_ordinal')
        .eq('user_id', userId).in('class_session_id', batch).order('id').range(a, z)),
    ])
    its.push(...items); rows.push(...tasks)
  }
  const outcomes = await loadOutcomes([...new Set((its ?? []).map(i => i.outcome_id as string))])
  const out: Obligation[] = []
  for (const it of its ?? []) {
    const s = byId.get(it.session_id as string)!, o = outcomes.get(it.outcome_id as string)
    if (!o) continue
    const mine = (rows ?? []).filter(r => r.class_session_id === it.session_id && r.outcome_id === it.outcome_id)
    const live = mine.filter(r => !r.cancelled_at && r.execution !== 'cancelled')
    const extent = it.extent as Extent
    let planned = it.planned_minutes as number | null, legacy = false
    if (planned === null) {
      if (s.cycle_id !== activeCycleId || mpu <= 0) continue
      legacy = true; planned = Math.round(coveredUnits({ extent, outcomeEffortUnits: o.effortPerOutcome }) * mpu)
    }
    const allocated = live.reduce((n, r) => n + Number(r.duration_minutes ?? 0), 0)
    const last = [...live].sort((x, y) => (Number(x.sitting_ordinal ?? 0) - Number(y.sitting_ordinal ?? 0)) || String(x.local_date ?? '').localeCompare(String(y.local_date ?? '')))
    out.push({
      sessionId: it.session_id as string, outcomeId: it.outcome_id as string, classDate: s.class_date as string, kind: s.kind as ClassKind, extent,
      note: (it.portion_note as string | null) ?? null, planned, legacy,
      classLabel: (s as any).commitment_id ? labelOf.get((s as any).commitment_id) ?? null : 'Your own session', classOriginalDate: ((s as any).occurrence_date as string | null) ?? null, allocated, remaining: Math.max(0, planned - allocated),
      maxOrdinal: Math.max(mine.length, ...mine.map(r => Number(r.sitting_ordinal ?? 0))),
      groupId: (mine.find(r => r.scope_group_id)?.scope_group_id as string | undefined) ?? null, lastId: (last[last.length - 1]?.id as string | undefined) ?? null,
    })
  }
  return { items: out, outcomes }
}

/**
 * The usable contiguous gaps of one local day for generated work, largest first: free ranges (windows less protected time, bookings and the elapsed part
 * of today), less accepted open work. A timed task takes its exact interval; an untimed one is packed WHOLE, largest first, into the largest gap that holds
 * it (one that fits nowhere consumes nothing). Mirrors class_day_packs, which re-checks this under the scheduling lock.
 */
export async function roomOfDay(
  userId: string, date: string, timezone: string, now: Date,
  tasks: { id: unknown; duration_minutes: unknown; execution: unknown; placement: unknown; starts_at: unknown; cancelled_at?: unknown }[],
): Promise<number[]> {
  let ranges = await dailyFreeRanges(userId, weekdayOf(date), date, timezone, now)
  const open = tasks.filter(t => !t.cancelled_at && !['completed', 'skipped', 'deferred', 'cancelled'].includes(t.execution as string))
  const fmt = (m: number) => `${String(Math.min(23, Math.floor(m / 60))).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  for (const t of open) {
    if (t.placement !== 'timed' || !t.starts_at) continue
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t.starts_at as string))
    const hh = p.find(x => x.type === 'hour')!.value, mm = p.find(x => x.type === 'minute')!.value
    const end = Number(hh) * 60 + Number(mm) + Number(t.duration_minutes ?? 30)
    ranges = ranges.flatMap(r => subtractOverlaps(r, [{ start: `${hh}:${mm}`, end: end >= 1440 ? '23:59' : fmt(end) }]))
  }
  let gaps = ranges.map(r => minutesBetween(r.start, r.end)).filter(g => g > 0).sort((a, b) => b - a)
  const untimed = open.filter(t => t.placement !== 'timed' || !t.starts_at)
    .map(t => ({ id: String(t.id), d: Number(t.duration_minutes ?? 30) })).sort((a, b) => b.d - a.d || a.id.localeCompare(b.id))
  for (const t of untimed) {
    // An existing unsplittable sitting still consumes the day even when changed windows no longer hold it.
    if ((gaps[0] ?? 0) < t.d) return []
    gaps[0] -= t.d; gaps = gaps.filter(g => g > 0).sort((a, b) => b - a)
  }
  return gaps
}

/** Catalog for the logging form: every non-pending reading with its outcomes. */
export async function getClassLogCatalog() {
  const admin = createAdminClient()
  const [topics, readings, los] = await Promise.all([
    readAll((a, z) => admin.from('topics').select('id, name, default_sequence').order('default_sequence').order('id').range(a, z)),
    readAll((a, z) => admin.from('curriculum_readings').select('id, reading_no, topic_id, title, sequence, structure_pending').eq('is_active', true).order('sequence').order('id').range(a, z)),
    readAll((a, z) => admin.from('reading_los').select('id, reading_id, code, title, sequence').order('sequence').order('id').range(a, z)),
  ])
  return (topics ?? []).map(t => ({
    id: t.id as string, name: t.name as string,
    readings: (readings ?? []).filter(r => r.topic_id === t.id && !r.structure_pending).map(r => ({
      id: r.id as string, no: r.reading_no as number, title: r.title as string,
      outcomes: (los ?? []).filter(l => l.reading_id === r.id).map(l => ({ id: l.id as string, code: l.code as string, title: l.title as string })),
    })),
  })).filter(t => t.readings.length > 0)
}
