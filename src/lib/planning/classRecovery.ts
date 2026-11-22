import { createAdminClient } from '../supabase/admin'
import { getActiveRoadmap } from '../curriculum/roadmapService'
import { loadPlacementContext } from './pulse/generateWeek'
import { weekForDate } from './schedule'
import { todayInZone, utcToZonedParts } from './studyWeek'
import { occupantsFor } from './taskService'
import { planClassRecovery, type RecoveryTask } from './classRecoveryPlan'

/**
 * Reviewed recovery of EXISTING study tasks after a class change. A draft (plan_drafts, purpose below) holds old -> proposed placements and the
 * work that did not fit. Preparing it writes only the draft; the live tasks change only in accept_class_recovery (one atomic command).
 * It is bound to the student's saved class-change receipt (checkpoint_commands, command 'class_change'), which stays the authoritative outcome.
 */
export const RECOVERY_PURPOSE = 'class_change_recovery'
const KEY = /^[A-Za-z0-9_.:-]{8,80}$/

export type RecoveryDraft = {
  draftId: string; revision: number; planningDate: string; changeKey: string; label: string
  moves: ReturnType<typeof planClassRecovery>['moves']; unplaced: ReturnType<typeof planClassRecovery>['unplaced']; kept: ReturnType<typeof planClassRecovery>['kept']; unchanged: number
}
export type RecoveryResult =
  | { status: 'prepared'; draft: RecoveryDraft }
  | { status: 'nothing_to_review'; draft: null }
  | { status: 'no_cycle' | 'unknown_change' | 'stale'; draft: null }

/** The student's own saved class change, or null (foreign, malformed or another kind of command). Never selects a different change. */
export async function getClassChange(userId: string, key: unknown) {
  if (typeof key !== 'string' || !KEY.test(key)) return null
  const { data } = await createAdminClient().from('checkpoint_commands').select('key, receipt, created_at').eq('user_id', userId).eq('key', key).eq('command', 'class_change').maybeSingle().throwOnError()
  return data as { key: string; receipt: any; created_at: string } | null
}

/** The most recent saved class change, used when Calendar only knows that something overlaps. */
export async function latestClassChangeKey(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('checkpoint_commands').select('key').eq('user_id', userId).eq('command', 'class_change').order('created_at', { ascending: false }).limit(1).maybeSingle().throwOnError()
  return (data?.key as string | undefined) ?? null
}

type Cycle = { id: string; starts_at_local: string; ends_at_local: string; timezone: string | null }
async function activeCycle(userId: string): Promise<Cycle | null> {
  const { data } = await createAdminClient().from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError()
  return data as Cycle | null
}

/** How many unfinished timed study tasks in the active cycle overlap protected time or a booked mock right now (read-only). */
export async function countRecoveryOverlaps(userId: string, now = new Date()): Promise<number> {
  const cycle = await activeCycle(userId)
  if (!cycle) return 0
  const { data, error } = await createAdminClient().rpc('class_recovery_overlaps', { p_user: userId, p_cycle: cycle.id, p_now: now.toISOString() })
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

const inflight = new Map<string, Promise<RecoveryResult>>()

/** Prepares (or reuses) the recovery draft for one saved class change. Concurrent callers with the same inputs share one build. */
export async function getOrCreateClassRecovery(userId: string, changeKey: string, now = new Date()): Promise<RecoveryResult> {
  const change = await getClassChange(userId, changeKey)
  if (!change) return { status: 'unknown_change', draft: null }
  const cycle = await activeCycle(userId)
  if (!cycle) return { status: 'no_cycle', draft: null }
  const admin = createAdminClient()
  const { data: hash, error } = await admin.rpc('current_week_source_hash', { p_user: userId, p_cycle: cycle.id })
  if (error || typeof hash !== 'string') throw new Error('Could not read your week.')
  const id = `${userId}:${changeKey}:${hash}`
  const running = inflight.get(id)
  if (running) return running
  const job = build(userId, cycle, changeKey, change.receipt, hash, now).finally(() => inflight.delete(id))
  inflight.set(id, job)
  return job
}

const asDraft = (d: { id: string; revision: number; draft_json: any }): RecoveryResult => ({
  status: 'prepared',
  draft: { draftId: d.id, revision: d.revision, planningDate: d.draft_json.planning_date, changeKey: d.draft_json.change_key, label: d.draft_json.label ?? 'your class',
    moves: d.draft_json.moves ?? [], unplaced: d.draft_json.unplaced ?? [], kept: d.draft_json.kept ?? [], unchanged: d.draft_json.unchanged ?? 0 },
})

async function build(userId: string, cycle: Cycle, changeKey: string, receipt: any, hash: string, now: Date): Promise<RecoveryResult> {
  const admin = createAdminClient()
  const tz = cycle.timezone || 'UTC', today = todayInZone(tz, now)
  const existing = await admin.from('plan_drafts').select('id, revision, draft_json').eq('user_id', userId).eq('purpose', RECOVERY_PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready').eq('context_fingerprint', hash).eq('draft_json->>change_key', changeKey).maybeSingle()
  if (existing.error) throw new Error('Could not read the saved proposal.')
  const valid = async (draftId: string) => {
    const v = await admin.rpc('class_recovery_problem', { p_user: userId, p_draft: draftId, p_now: now.toISOString() })
    if (v.error) throw new Error('Could not check the saved proposal.')
    return v.data === null
  }
  if (existing.data && await valid(existing.data.id)) return asDraft(existing.data as any)
  // Anything else still marked ready was built from a source state that no longer exists.
  await admin.from('plan_drafts').update({ status: 'superseded' }).eq('user_id', userId).eq('purpose', RECOVERY_PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready')

  const week = await weekForDate(userId, cycle.starts_at_local)
  const placement = await loadPlacementContext(userId, week, now)
  const [blocks, windows, overlaps] = await Promise.all([
    admin.from('plan_blocks').select('id, title, revision, local_date, starts_at, duration_minutes, placement, execution, task_type, priority, lm_id, is_protected_commitment, assessment_scope, learning_activity_id, dependencies')
      .eq('user_id', userId).eq('cycle_id', cycle.id).is('cancelled_at', null).neq('execution', 'cancelled').not('local_date', 'is', null).throwOnError(),
    admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', userId).eq('status', 'active').throwOnError(),
    admin.rpc('class_recovery_overlaps', { p_user: userId, p_cycle: cycle.id, p_now: now.toISOString() }),
  ])
  if (overlaps.error) throw new Error('Could not check your week.')
  const rows = (blocks.data ?? []) as any[]
  const continued = new Set<string>()
  if (rows.length) {
    const kids = await admin.from('plan_blocks').select('continued_from_task_id').eq('user_id', userId).in('continued_from_task_id', rows.map(r => r.id)).throwOnError()
    for (const k of kids.data ?? []) continued.add(k.continued_from_task_id as string)
  }
  const tasks: RecoveryTask[] = rows.filter(r => !r.learning_activity_id).map(r => ({
    id: r.id, title: r.title, revision: r.revision, date: r.local_date, startsAt: r.starts_at, minutes: r.duration_minutes ?? 30, placement: r.placement ?? 'day_preferred',
    execution: r.execution, taskType: r.task_type ?? 'study', priority: r.priority ?? 'core', lmId: r.lm_id,
    fixed: !!r.is_protected_commitment || !!r.assessment_scope || continued.has(r.id),
    after: Array.isArray(r.dependencies) ? (r.dependencies as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  }))
  const dates: string[] = []
  for (let d = today < cycle.starts_at_local ? cycle.starts_at_local : today; d <= cycle.ends_at_local; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dates.push(d)
  const occupants = await occupantsFor(userId, dates, tz)
  const available: Record<string, number> = {}
  await Promise.all(dates.map(async d => {
    const r = await admin.rpc('current_week_available_minutes', { p_user: userId, p_date: d, p_zone: tz, p_now: now.toISOString() })
    if (r.error) throw new Error('Could not read your study time.')
    available[d] = r.data as number
  }))
  const local = utcToZonedParts(now, tz)
  const plan = planClassRecovery({
    tasks, overlaps: Object.fromEntries((overlaps.data ?? []).map((o: any) => [o.task_id, o.source_title])), today, cycleEnd: cycle.ends_at_local, timezone: tz,
    studyDates: placement.studyDates, available,
    windows: (windows.data ?? []).map(w => ({ weekday: w.weekday as number, start: toMin(w.start_time as string), end: toMin(w.end_time as string) })),
    blockers: occupants.filter(o => o.kind !== 'task').map(o => ({ date: o.date, start: o.start, end: o.start + o.durationMinutes })),
    earliestToday: local.minutesOfDay,
  })
  if (plan.moves.length + plan.unplaced.length + plan.kept.length === 0) return { status: 'nothing_to_review', draft: null }

  const roadmap = await getActiveRoadmap(userId)
  const version = ((await admin.from('profiles').select('onboarding_context_version').eq('id', userId).single()).data?.onboarding_context_version ?? 1) as number
  const lab = await admin.from('calendar_commitments').select('label').eq('user_id', userId).eq('id', (receipt?.successorId ?? receipt?.commitmentId) as string).maybeSingle()
  const label = (lab.data?.label as string | undefined) ?? 'your class'
  const ins = await admin.from('plan_drafts').insert({
    user_id: userId, purpose: RECOVERY_PURPOSE, status: 'ready', revision: 1, cycle_id: cycle.id, roadmap_id: roadmap?.id ?? null,
    cycle_start_date: cycle.starts_at_local, cycle_end_date: cycle.ends_at_local, timezone: tz, onboarding_context_version: version, context_fingerprint: hash,
    draft_json: { kind: 'class_recovery', change_key: changeKey, label, planning_date: today, moves: plan.moves, unplaced: plan.unplaced, kept: plan.kept, unchanged: plan.unchanged, receipt: null },
  }).select('id, revision, draft_json').single()
  if (ins.error) {
    if ((ins.error as any).code === '23505') { // a concurrent preparation won the unique index: use its draft
      const won = await admin.from('plan_drafts').select('id, revision, draft_json').eq('user_id', userId).eq('purpose', RECOVERY_PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready').eq('context_fingerprint', hash).eq('draft_json->>change_key', changeKey).maybeSingle()
      if (won.data) return asDraft(won.data as any)
    }
    throw new Error(`Could not save the proposal: ${ins.error.message}`)
  }
  if (!(await valid(ins.data.id))) {
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('id', ins.data.id).eq('user_id', userId)
    return { status: 'stale', draft: null }
  }
  return asDraft(ins.data as any)
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
