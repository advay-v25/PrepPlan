import { activeCycleId as activeCycleIdOf } from '../../ops/sharedReads'
import { randomUUID } from 'crypto'
import { SEEDED_MINUTES_PER_EFFORT_UNIT } from '../../curriculum/roadmap'
import { getActiveRoadmap as activeRoadmap } from '../../curriculum/roadmapService'
import { createAdminClient } from '../../supabase/admin'
import { sittingCeiling, planClassConsolidation, coveredUnits, type LoggedItem } from './consolidation'
import { loadClassObligations, roomOfDay, type Obligation } from './service'
import { sittingText, sittingSuffix } from './taskText'

/**
 * Class follow-up work that never received a task (a durable obligation) placed into a coming week, as proposal rows. Pure of writes: the weekly
 * review saves these rows in its draft and the weekly command inserts them atomically (accept_weekly_transition), re-checking that no more than is
 * still owed is placed. A weekly continuation keeps the minutes of the sitting it continues; this covers only minutes that never had a sitting.
 */
export type OwedLine = { sessionId: string; outcomeId: string; title: string; classDate: string; classLabel: string | null; classOriginalDate: string | null; plannedMinutes: number; allocatedMinutes: number; remainingMinutes: number }
export type CarryPlan = {
  rows: Record<string, unknown>[]
  placed: { title: string; date: string; minutes: number }[]
  waiting: { title: string; remainingMinutes: number; reason: string }[]
}

export async function listOwedClassWork(userId: string, activeCycleId?: string | null): Promise<OwedLine[]> {
  if (activeCycleId === undefined) activeCycleId = await activeCycleIdOf(userId)
  const mpu = (await activeRoadmap(userId))?.input.observedMinutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  const { items, outcomes } = await loadClassObligations(userId, activeCycleId, mpu)
  return items.filter(o => o.remaining > 0 && outcomes.has(o.outcomeId)).map(o => {
    const x = outcomes.get(o.outcomeId)!
    return { sessionId: o.sessionId, outcomeId: o.outcomeId, title: `${x.title} (Reading ${x.readingNo})`, classDate: o.classDate, classLabel: o.classLabel, classOriginalDate: o.classOriginalDate, plannedMinutes: o.planned, allocatedMinutes: o.allocated, remainingMinutes: o.remaining }
  }).sort((a, b) => a.classDate.localeCompare(b.classDate) || a.title.localeCompare(b.title))
}

export async function planOwedClassWork(input: {
  userId: string; closingCycleId: string | null; dates: string[]; timezone: string; now: Date
  /** Work already proposed for these days (generated rows and placed continuations), so room is counted once. */
  load: { date: string; minutes: number; placement?: string | null; startsAt?: string | null }[]
}): Promise<CarryPlan> {
  const admin = createAdminClient()
  const mpu = (await activeRoadmap(input.userId))?.input.observedMinutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  const { items, outcomes } = await loadClassObligations(input.userId, input.closingCycleId, mpu)
  const due = items.filter(o => o.remaining > 0 && outcomes.has(o.outcomeId))
  if (due.length === 0 || input.dates.length === 0) return { rows: [], placed: [], waiting: [] }
  const { data: profile } = await admin.from('profiles').select('max_session_minutes').eq('id', input.userId).maybeSingle().throwOnError()
  const ceiling = sittingCeiling((profile?.max_session_minutes as number | null) ?? null)

  const days: { date: string; capacityMinutes: number; gaps: number[] }[] = []
  for (const d of input.dates) {
    const tasks = input.load.filter(l => l.date === d).map((l, i) => ({ id: `load-${i}`, duration_minutes: l.minutes, execution: 'not_started', placement: l.placement ?? 'day_preferred', starts_at: l.startsAt ?? null }))
    const gaps = await roomOfDay(input.userId, d, input.timezone, input.now, tasks)
    days.push({ date: d, capacityMinutes: gaps.reduce((s, g) => s + g, 0), gaps })
  }
  const logged: LoggedItem[] = due.map((o: Obligation) => {
    const x = outcomes.get(o.outcomeId)!
    return { sessionId: o.sessionId, classDate: o.classDate, outcomeId: o.outcomeId, moduleId: '', extent: o.extent, title: `${x.title} (Reading ${x.readingNo})`,
      outcomeEffortUnits: x.effortPerOutcome, revision: o.kind === 'revision', requiredMinutes: o.remaining, existing: { groupId: o.groupId, count: o.maxOrdinal, lastTaskKey: o.lastId } }
  })
  const plan = planClassConsolidation({ items: logged, days, repairs: [], minutesPerEffortUnit: mpu, maxSittingMinutes: ceiling })

  const idOf = new Map<string, string>()
  for (const t of plan.tasks) if (t.key) idOf.set(t.key, `task-${randomUUID()}`)
  const info = new Map(due.map(o => [`${o.sessionId}:${o.outcomeId}`, o]))
  const newGroup = new Set<string>()
  const rows = plan.tasks.map(t => {
    const o = info.get(t.itemKey!)!, x = outcomes.get(o.outcomeId)!, s = t.sitting!
    const text = sittingText({ outcomeTitle: x.title, readingNo: x.readingNo, readingTitle: x.readingTitle, classDate: o.classDate, classLabel: o.classLabel, classOriginalDate: o.classOriginalDate, extent: o.extent, revision: o.kind === 'revision', portionNote: o.note, index: s.index, count: s.count })
    const left = plan.carryover.find(c => c.itemKey === t.itemKey)?.remainingMinutes ?? 0
    const grouped = o.maxOrdinal + plan.tasks.filter(y => y.itemKey === t.itemKey).length >= 2 || left > 0
    const gk = grouped && !o.groupId ? `grp-${t.itemKey}` : ''
    if (gk) newGroup.add(gk)
    return {
      id: idOf.get(t.key!)!, title: `${t.title}${sittingSuffix(s.index, s.count)}`, detail: '', task_type: t.taskType, origin: 'planner', priority: 'core',
      placement: 'day_preferred', execution: 'not_started', local_date: t.date, day: t.date, starts_at: null, duration_minutes: t.minutes, duration: String(t.minutes),
      lm_id: x.readingId, repair_thread_id: null, rationale: text.rationale, assessment_scope: null, created_by: 'algorithm', concept_id: null,
      learning_objective: text.objective, suggested_approach: text.approach, completion_meaning: text.completion,
      verification_intent: text.verification, curriculum_reference: text.reference,
      class_session_id: o.sessionId, outcome_id: o.outcomeId, sitting_ordinal: s.index,
      item_planned: o.planned,
      dependencies: t.after ? [idOf.get(t.after) ?? t.after] : [], group_key: gk, group_id: grouped && o.groupId ? o.groupId : '',
    }
  })
  const placedBy = new Map<string, number>()
  for (const t of plan.tasks) placedBy.set(t.itemKey!, (placedBy.get(t.itemKey!) ?? 0) + t.minutes)
  return {
    rows,
    placed: plan.tasks.map(t => ({ title: t.title, date: t.date, minutes: t.minutes })),
    waiting: plan.carryover.map(c => ({ title: c.title, remainingMinutes: c.remainingMinutes ?? 0, reason: c.reason === 'no_open_day' ? 'No open day in the coming week has room for it.' : 'The coming week does not have enough free time left for all of it.' })),
  }
}
