import { createAdminClient } from '../supabase/admin'
import { reportedMinutesByChain } from './taskLineage'

/**
 * Where a task came from and where it went, for the drawer and for links to earlier weeks.
 * Read-only, owner-scoped. History is never rewritten: every earlier figure here is read from the week it
 * happened in, and shown separately from this week's activity.
 */
export type OccurrenceRef = { id: string; title: string; execution: string; weekStart: string | null; weekEnd: string | null }
export type EarlierProgress = {
  /** Reported minutes across earlier occurrences. A floor when `unknown` is true. */
  minutes: number
  /** An earlier occurrence had activity but no reported time. Never guessed. */
  unknown: boolean
  occurrences: (OccurrenceRef & { minutes: number | null })[]
}
export type ContinuationInfo = {
  continuedFrom: OccurrenceRef | null
  continuedAs: OccurrenceRef | null
  carryIntent: 'continue' | 'later' | null
  estimateProvisional: boolean
  earlier: EarlierProgress | null
  classSessionId: string | null
}

type Row = { id: string; title: string; execution: string; cycle_id: string | null; continued_from_task_id: string | null; class_session_id?: string | null }
type TaskSource = { id: string; continued_from_task_id: string | null; class_session_id?: string | null; carry_intent?: string | null; estimate_provisional?: boolean | null }
const NEVER_STARTED = ['not_started', 'deferred', 'skipped']
const MAX_DEPTH = 12

async function cycleDates(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!unique.length) return new Map<string, { start: string | null; end: string | null }>()
  const { data, error } = await createAdminClient().from('planning_cycles').select('id, starts_at_local, ends_at_local').in('id', unique)
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map(c => [c.id as string, { start: (c.starts_at_local ?? null) as string | null, end: (c.ends_at_local ?? null) as string | null }]))
}

/** Every earlier occurrence of the given tasks, walking back through the chain. */
async function loadAncestors(userId: string, startIds: string[]) {
  const admin = createAdminClient()
  const known = new Map<string, Row>()
  let frontier = [...new Set(startIds)]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const { data, error } = await admin.from('plan_blocks').select('id, title, execution, cycle_id, continued_from_task_id, class_session_id').eq('user_id', userId).in('id', frontier)
    if (error) throw new Error(error.message)
    frontier = []
    for (const r of (data ?? []) as Row[]) {
      known.set(r.id, r)
      if (r.continued_from_task_id && !known.has(r.continued_from_task_id)) frontier.push(r.continued_from_task_id)
    }
  }
  return known
}

async function describe(userId: string, tasks: TaskSource[], withSuccessor: boolean) {
  const out = new Map<string, ContinuationInfo>()
  const ancestors = await loadAncestors(userId, tasks.flatMap(t => t.continued_from_task_id ? [t.continued_from_task_id] : []))
  const successors = new Map<string, Row>()
  if (withSuccessor && tasks.length) {
    const { data, error } = await createAdminClient().from('plan_blocks').select('id, title, execution, cycle_id, continued_from_task_id').eq('user_id', userId).in('continued_from_task_id', tasks.map(t => t.id))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as Row[]) successors.set(r.continued_from_task_id!, r)
  }
  const dates = await cycleDates([...ancestors.values(), ...successors.values()].map(r => r.cycle_id))
  const ref = (r: Row): OccurrenceRef => ({ id: r.id, title: r.title, execution: r.execution, weekStart: dates.get(r.cycle_id ?? '')?.start ?? null, weekEnd: dates.get(r.cycle_id ?? '')?.end ?? null })

  const chainIds = [...ancestors.keys()]
  const { data: events, error } = chainIds.length
    ? await createAdminClient().from('task_events').select('task_id, actual_duration_minutes').eq('user_id', userId).in('task_id', chainIds).not('actual_duration_minutes', 'is', null)
    : { data: [] as { task_id: string; actual_duration_minutes: number }[], error: null }
  if (error) throw new Error(error.message)
  const evs = (events ?? []).map(e => ({ taskId: e.task_id as string, actualMinutes: e.actual_duration_minutes as number }))
  const nodes = [...ancestors.values()].map(r => ({ id: r.id, continuedFromId: r.continued_from_task_id }))

  for (const t of tasks) {
    const from = t.continued_from_task_id ? ancestors.get(t.continued_from_task_id) ?? null : null
    let classSessionId = t.class_session_id ?? null
    let earlier: EarlierProgress | null = null
    if (from) {
      const r = reportedMinutesByChain(from.id, nodes, evs)
      const perId = new Map(r.byOccurrence.map(o => [o.id, o.minutes]))
      // Oldest first, each with the time reported for that occurrence alone.
      const occurrences: (OccurrenceRef & { minutes: number | null })[] = []
      for (let cur: Row | undefined = from, i = 0; cur && i < MAX_DEPTH; cur = cur.continued_from_task_id ? ancestors.get(cur.continued_from_task_id) : undefined, i++) {
        classSessionId ??= cur.class_session_id ?? null
        occurrences.unshift({ ...ref(cur), minutes: perId.get(cur.id) ?? null })
      }
      earlier = {
        minutes: r.total,
        unknown: occurrences.some(o => o.minutes === null && !NEVER_STARTED.includes(o.execution)),
        occurrences,
      }
    }
    const succ = successors.get(t.id) ?? null
    out.set(t.id, {
      continuedFrom: from ? ref(from) : null,
      continuedAs: succ ? ref(succ) : null,
      carryIntent: (t.carry_intent ?? null) as 'continue' | 'later' | null,
      estimateProvisional: Boolean(t.estimate_provisional),
      earlier,
      classSessionId,
    })
  }
  return out
}

/** For the tasks of one week: where each came from (continuations only; successors are not needed here). */
export async function loadContinuations(userId: string, tasks: TaskSource[]) {
  const continued = tasks.filter(t => t.continued_from_task_id)
  return continued.length ? describe(userId, continued, false) : new Map<string, ContinuationInfo>()
}

/** One owned task from ANY week, with its lineage in both directions. Null when it is not yours or does not exist. */
export async function getTaskLineage(userId: string, taskId: string) {
  const { data, error } = await createAdminClient().from('plan_blocks')
    .select('id, title, detail, execution, task_type, local_date, duration_minutes, cycle_id, continued_from_task_id, carry_intent, estimate_provisional, learning_objective, cancelled_at, class_session_id')
    .eq('id', taskId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const info = (await describe(userId, [data as TaskSource], true)).get(taskId)!
  const dates = await cycleDates([data.cycle_id as string | null])
  const week = dates.get(data.cycle_id as string) ?? { start: null, end: null }
  return { task: data, week, info }
}
