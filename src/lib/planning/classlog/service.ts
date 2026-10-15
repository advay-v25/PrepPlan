import { createHash, randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../../supabase/admin'
import { addDays, todayInZone, weekdayOf, type Weekday } from '../studyWeek'
import { dailyCapacityMinutes } from '../pulse/capacity'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import {
  planClassConsolidation, type Carryover, type Extent, type LoggedItem, type Pressure, type PlannedTask,
} from './consolidation'

/**
 * Class log service. Everything except `confirmClassLog` is a pure read: a
 * preview never writes. The single mutation is the apply_class_log RPC, called
 * with the caller's own session so auth.uid() is the ownership check.
 */

export type ClassKind = 'covered' | 'revision' | 'missed' | 'cancelled' | 'none'
export const CLASS_KINDS: ClassKind[] = ['covered', 'revision', 'missed', 'cancelled', 'none']

export type LogItemInput = { outcomeId: string; extent: Extent; portionNote?: string; studiedInClass?: boolean }
export type LogInput = { classDate: string; kind: ClassKind; note?: string; items: LogItemInput[] }

export type ClassLogContext =
  | { classLed: false }
  | {
      classLed: true
      cycle: { id: string; startsAt: string; endsAt: string; timezone: string } | null
      today: string
      classDates: string[]
      pendingDates: string[]
      sessions: { id: string; classDate: string; kind: ClassKind }[]
    }

export type PreviewTask = { date: string; title: string; detail: string | null; minutes: number; lane: string; outcomeId: string | null; sessionId: string | null }
export type ClassLogPreview = {
  ok: true
  tasks: PreviewTask[]
  carryover: { title: string; reason: Carryover['reason'] }[]
  pressure: Pressure
  fingerprint: string
  skippedStudiedInClass: number
} | { ok: false; code: 'no_cycle' | 'bad_date' | 'bad_item' | 'not_class_led'; message: string }

async function classWeekdays(userId: string): Promise<Weekday[]> {
  const admin = createAdminClient()
  const { data } = await admin.from('calendar_commitments').select('weekdays')
    .eq('user_id', userId).eq('kind', 'class').eq('status', 'active')
  return [...new Set((data ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[]))]
}

export async function getClassLogContext(userId: string, now = new Date()): Promise<ClassLogContext> {
  const admin = createAdminClient()
  const weekdays = await classWeekdays(userId)
  if (weekdays.length === 0) return { classLed: false }

  const { data: cycle } = await admin.from('planning_cycles')
    .select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle()
  const timezone = (cycle?.timezone as string | null) ?? 'UTC'
  const today = todayInZone(timezone, now)
  if (!cycle) return { classLed: true, cycle: null, today, classDates: [], pendingDates: [], sessions: [] }

  const starts = cycle.starts_at_local as string, ends = cycle.ends_at_local as string
  const classDates: string[] = []
  for (let d = starts; d < ends && d <= today; d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d))) classDates.push(d)

  const { data: sess } = await admin.from('class_sessions').select('id, class_date, kind')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string)
  const sessions = (sess ?? []).map(s => ({ id: s.id as string, classDate: s.class_date as string, kind: s.kind as ClassKind }))
  const logged = new Set(sessions.map(s => s.classDate))
  return {
    classLed: true,
    cycle: { id: cycle.id as string, startsAt: starts, endsAt: ends, timezone },
    today, classDates, pendingDates: classDates.filter(d => !logged.has(d)), sessions,
  }
}

type OutcomeInfo = { id: string; title: string; readingNo: number; readingTitle: string; effortPerOutcome: number }

async function loadOutcomes(ids: string[]): Promise<Map<string, OutcomeInfo>> {
  const admin = createAdminClient()
  if (ids.length === 0) return new Map()
  const { data: los } = await admin.from('reading_los').select('id, title, reading_id').in('id', ids)
  const readingIds = [...new Set((los ?? []).map(l => l.reading_id as string))]
  const [{ data: readings }, { data: counts }] = await Promise.all([
    admin.from('curriculum_readings').select('id, reading_no, title, effort_units, structure_pending').in('id', readingIds),
    admin.from('reading_los').select('reading_id').in('reading_id', readingIds),
  ])
  const perReading = new Map<string, number>()
  for (const c of counts ?? []) perReading.set(c.reading_id as string, (perReading.get(c.reading_id as string) ?? 0) + 1)
  const rmap = new Map((readings ?? []).map(r => [r.id as string, r]))
  const out = new Map<string, OutcomeInfo>()
  for (const l of los ?? []) {
    const r = rmap.get(l.reading_id as string)
    if (!r || r.structure_pending) continue
    out.set(l.id as string, {
      id: l.id as string, title: l.title as string, readingNo: r.reading_no as number, readingTitle: r.title as string,
      effortPerOutcome: Number(r.effort_units) / Math.max(1, perReading.get(r.id as string) ?? 1),
    })
  }
  return out
}

const NEW = 'new'

/** Pure read: what confirming this log would add to the cycle. */
export async function previewClassLog(userId: string, input: LogInput, now = new Date()): Promise<ClassLogPreview & { cycleId?: string }> {
  const ctx = await getClassLogContext(userId, now)
  if (!ctx.classLed) return { ok: false, code: 'not_class_led', message: 'Class logging is for students with a class schedule.' }
  if (!ctx.cycle) return { ok: false, code: 'no_cycle', message: 'There is no open week yet. Prepare your week in Calendar first.' }
  const { cycle, today } = ctx
  if (input.classDate < cycle.startsAt || input.classDate >= cycle.endsAt || input.classDate > today) {
    return { ok: false, code: 'bad_date', message: 'Pick a day in this cycle that has already happened.' }
  }
  if (!CLASS_KINDS.includes(input.kind)) return { ok: false, code: 'bad_item', message: 'Unknown class type.' }

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

  // Earlier sessions in this cycle: their unplaced items re-enter the plan.
  const { data: oldSessions } = await admin.from('class_sessions').select('id, class_date, kind')
    .eq('user_id', userId).eq('cycle_id', cycle.id).in('kind', ['covered', 'revision'])
  const sessionIds = (oldSessions ?? []).map(s => s.id as string)
  const { data: oldItems } = sessionIds.length
    ? await admin.from('class_session_items').select('session_id, outcome_id, extent, studied_in_class').in('session_id', sessionIds)
    : { data: [] as any[] }
  const oldOutcomes = await loadOutcomes([...new Set((oldItems ?? []).map(i => i.outcome_id as string))])
  const sessionById = new Map((oldSessions ?? []).map(s => [s.id as string, s]))

  const { data: existingTasks } = await admin.from('plan_blocks')
    .select('class_session_id, outcome_id, local_date, duration_minutes, execution, cancelled_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id)
  const alreadyPlanned = new Set<string>()
  const usedMinutes = new Map<string, number>()
  for (const t of existingTasks ?? []) {
    if (t.cancelled_at || t.execution === 'cancelled') continue
    if (t.class_session_id && t.outcome_id) alreadyPlanned.add(`${t.class_session_id}:${t.outcome_id}`)
    if (t.execution !== 'completed' && t.execution !== 'skipped' && t.local_date) {
      usedMinutes.set(t.local_date as string, (usedMinutes.get(t.local_date as string) ?? 0) + Number(t.duration_minutes ?? 0))
    }
  }

  const detailOf = new Map<string, string | null>()
  const items: LoggedItem[] = []
  let skippedStudied = 0
  for (const oi of oldItems ?? []) {
    const o = oldOutcomes.get(oi.outcome_id as string); const s = sessionById.get(oi.session_id as string)
    if (!o || !s || oi.studied_in_class) continue
    items.push({
      sessionId: s.id as string, classDate: s.class_date as string, outcomeId: o.id, moduleId: '', extent: oi.extent as Extent,
      title: `${o.title} (Reading ${o.readingNo})`, outcomeEffortUnits: o.effortPerOutcome, revision: s.kind === 'revision',
    })
  }
  for (const i of input.items) {
    if (i.studiedInClass) { skippedStudied++; continue }
    const o = outcomes.get(i.outcomeId)!
    items.push({
      sessionId: NEW, classDate: input.classDate, outcomeId: o.id, moduleId: '', extent: i.extent,
      title: `${o.title} (Reading ${o.readingNo})`, outcomeEffortUnits: o.effortPerOutcome, revision: input.kind === 'revision',
    })
    if (i.portionNote) detailOf.set(`${NEW}:${o.id}`, i.portionNote.slice(0, 300))
  }

  // Open days: from today (never the past) up to the day before the paper day.
  const earliest = today > input.classDate ? today : addDays(input.classDate, 1)
  const days: { date: string; capacityMinutes: number }[] = []
  for (let d = earliest; d < cycle.endsAt; d = addDays(d, 1)) {
    const cap = await dailyCapacityMinutes(userId, weekdayOf(d), d, cycle.timezone)
    days.push({ date: d, capacityMinutes: Math.max(0, cap - (usedMinutes.get(d) ?? 0)) })
  }

  const active = await getActiveRoadmap(userId)
  const plan = planClassConsolidation({
    items, days, repairs: [], minutesPerEffortUnit: active?.input.observedMinutesPerEffortUnit ?? 85, alreadyPlanned,
  })

  const tasks: PreviewTask[] = plan.tasks.map((t: PlannedTask) => ({
    date: t.date, title: t.title, detail: t.sessionId && t.outcomeId ? detailOf.get(`${t.sessionId}:${t.outcomeId}`) ?? null : null,
    minutes: t.minutes, lane: t.lane, outcomeId: t.outcomeId, sessionId: t.sessionId,
  }))
  const fingerprint = createHash('sha1').update(JSON.stringify([
    tasks.map(t => [t.date, t.title, t.minutes, t.outcomeId, t.sessionId]), plan.carryover.map(c => [c.title, c.reason]),
  ])).digest('hex').slice(0, 16)

  return {
    ok: true, cycleId: cycle.id, tasks, carryover: plan.carryover.map(c => ({ title: c.title, reason: c.reason })),
    pressure: plan.pressure, fingerprint, skippedStudiedInClass: skippedStudied,
  }
}

export type ConfirmResult =
  | { ok: true; sessionId: string; tasks: number; alreadyApplied: boolean }
  | { ok: false; code: 'preview_changed' | 'invalid' | 'failed' | 'no_cycle' | 'bad_date' | 'bad_item' | 'not_class_led'; message: string; preview?: ClassLogPreview }

export async function confirmClassLog(
  db: SupabaseClient, userId: string,
  input: LogInput & { idempotencyKey: string; fingerprint: string }, now = new Date(),
): Promise<ConfirmResult> {
  // Replay of an already-applied key returns the first result without recomputing.
  const admin = createAdminClient()
  const { data: existing } = await admin.from('class_sessions').select('id')
    .eq('user_id', userId).eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (existing) {
    const { count } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('class_session_id', existing.id as string)
    return { ok: true, sessionId: existing.id as string, tasks: count ?? 0, alreadyApplied: true }
  }

  const preview = await previewClassLog(userId, input, now)
  if (!preview.ok) return { ok: false, code: preview.code, message: preview.message }
  if (preview.fingerprint !== input.fingerprint) {
    return { ok: false, code: 'preview_changed', message: 'Your week changed since you previewed it. Review the update again.', preview }
  }

  const tasks = preview.tasks.map(t => ({
    id: `task-cl-${randomUUID().slice(0, 12)}`,
    title: t.title, detail: t.detail ?? '', task_type: t.lane === 'revision' ? 'review' : 'study', origin: 'planner',
    local_date: t.date, duration_minutes: t.minutes,
    rationale: t.lane === 'revision' ? 'Revising what class went back over.' : 'Consolidating what you covered in class.',
    session_id: t.sessionId && t.sessionId !== NEW ? t.sessionId : '', outcome_id: t.outcomeId ?? '',
  }))
  const { data, error } = await db.rpc('apply_class_log', {
    p_cycle_id: (preview as any).cycleId, p_idempotency_key: input.idempotencyKey, p_class_date: input.classDate,
    p_kind: input.kind, p_note: input.note ?? null,
    p_items: input.items.map(i => ({ outcome_id: i.outcomeId, extent: i.extent, portion_note: i.portionNote ?? '', studied_in_class: Boolean(i.studiedInClass) })),
    p_tasks: tasks,
  })
  if (error || !data) {
    console.error('[class-log confirm]', error?.message)
    return { ok: false, code: 'failed', message: 'Could not save the class log. Nothing was changed — try again.' }
  }
  const r = data as { session_id: string; already_applied: boolean; tasks: number }
  return { ok: true, sessionId: r.session_id, tasks: r.tasks, alreadyApplied: r.already_applied }
}

/** Catalog for the logging form: every non-pending reading with its outcomes. */
export async function getClassLogCatalog() {
  const admin = createAdminClient()
  const [{ data: topics }, { data: readings }, { data: los }] = await Promise.all([
    admin.from('topics').select('id, name, default_sequence').order('default_sequence'),
    admin.from('curriculum_readings').select('id, reading_no, topic_id, title, sequence, structure_pending').eq('is_active', true).order('sequence'),
    admin.from('reading_los').select('id, reading_id, code, title, sequence').order('sequence'),
  ])
  return (topics ?? []).map(t => ({
    id: t.id as string, name: t.name as string,
    readings: (readings ?? []).filter(r => r.topic_id === t.id && !r.structure_pending).map(r => ({
      id: r.id as string, no: r.reading_no as number, title: r.title as string,
      outcomes: (los ?? []).filter(l => l.reading_id === r.id).map(l => ({ id: l.id as string, code: l.code as string, title: l.title as string })),
    })),
  })).filter(t => t.readings.length > 0)
}
