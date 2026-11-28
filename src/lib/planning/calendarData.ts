import { createClient } from '../supabase/server'
import { createAdminClient } from '../supabase/admin'
import { StudyWeek, utcToZonedParts, weekdayOf } from './studyWeek'
import { expandCommitment, type CommitmentException, type RecurringCommitment } from './mutations'
import { getScopeGroups } from './taskScopeService'
import { loadContinuations, type ContinuationInfo } from './taskLineageService'
import { inDeclaredOrder } from './declaredOrder'
import { weeklySeries } from '../ops/sharedReads'

/**
 * Everything the calendar needs for one study week, in one place.
 *
 * Placement is resolved to a local date and minute-of-day here rather than in
 * the view, so the grid never has to reason about timezones.
 */

export type CalendarLayer = 'commitment' | 'class' | 'study' | 'review' | 'diagnostic' | 'repair' | 'recheck' | 'mock' | 'other'

export type CalendarEntry = {
  id: string
  title: string
  detail: string | null
  layer: CalendarLayer
  /** 'timed' has a real clock position; 'day' belongs to a date only. */
  kind: 'timed' | 'day' | 'floating'
  localDate: string | null
  startMinutes: number | null
  durationMinutes: number
  execution: string | null
  origin: string | null
  isProtected: boolean
  rationale: string | null
  suggestedApproach: string | null
  completionMeaning: string | null
  conceptName: string | null
  attemptId: string | null
  assessmentScope: any
  taskType: string | null
  /** Sent back on every write; a mismatch means someone else changed it first. */
  revision: number
  /** Commitments are edited through their own endpoint, not the task one. */
  isTask: boolean
  isLoggedLearning?: boolean
  recordedMinutes?: number | null
  learningObjective?: string | null
  /** How the work can later be checked, or why a portion stays pending (generated class follow-ups). */
  verificationIntent?: string | null
  /** Declared sitting order: this sitting's number and the sittings it must follow (never inferred from titles). */
  sittingOrdinal?: number | null
  follows?: { id: string; title: string; date: string | null }[]
  /** Recovery work planned from a mock report: which report, the version it was planned from, and whether the report has since changed or been withdrawn. Plan history is never rewritten. */
  sourceReport?: { id: string; plannedFromVersion: number | null; status: 'active' | 'withdrawn' | 'unknown'; currentVersion: number | null } | null
  /** The reading this work is mapped to, so Curriculum and Tests links stay scoped to it. */
  reading?: { id: string; topicId: string | null; label: string } | null
  classSessionId?: string | null
  scopeProgress?: { completed: number; total: number; complete: boolean } | null
  /** Set when this task continues work from an earlier week. */
  continuation?: ContinuationInfo | null
  /** Stable identity for export: a series occurrence keeps its ORIGINAL slot date even after it is moved. */
  exportKey?: string
  /** A series occurrence: the canonical commitment and the ORIGINAL occurrence date, even when it was moved. Never derived from the title or displayed date. */
  commitmentId?: string
  originalDate?: string
  moved?: boolean
  /** Exact stored instants where they exist (tasks with a start, one-off commitments incl. overnight), so a snapshot never reconstructs them from local minutes. */
  startsAtIso?: string
  endsAtIso?: string
}

export type CalendarWeekData = {
  entries: CalendarEntry[]
  timed: CalendarEntry[]
  byDate: Record<string, CalendarEntry[]>
  floating: CalendarEntry[]
  cycleId: string | null
  earliestMinute: number
  latestMinute: number
}

function layerFor(taskType: string | null, origin: string | null): CalendarLayer {
  switch (taskType) {
    case 'diagnostic': return 'diagnostic'
    case 'repair': return 'repair'
    case 'recheck': return 'recheck'
    case 'mock': return 'mock'
    case 'review': case 'verification': return 'review'
    case 'study': case 'class_consolidation': return 'study'
    default: return origin === 'class' ? 'class' : 'other'
  }
}

/** Failed reads are unavailable, never an authoritative empty calendar (including exports). */
export async function loadCalendarWeek(userId: string, week: StudyWeek, opts: { strict?: boolean } = {}): Promise<CalendarWeekData> {
  const must = <T extends { error: { message: string } | null }>(r: T, what: string): T => { if (opts.strict !== false && r.error) throw new Error(`calendar read failed (${what}): ${r.error.message}`); return r }
  const supabase = await createClient()
  const admin = createAdminClient()

  // The displayed period decides which accepted cycles it shows, not "whichever cycle is active now". A closed week shows its own
  // cycle's work (completed included); a future week with no cycle shows none. Unplaced work belongs to its cycle and appears only
  // in the period that cycle covers, never in another week. Superseded and legacy rows stay in the database for audit.
  const { data: owning } = must(await supabase
    .from('planning_cycles')
    .select('id, status, starts_at_local, ends_at_local')
    .eq('user_id', userId)
    .in('status', ['active', 'closed'])
    .lte('starts_at_local', week.endDate)
    .gte('ends_at_local', week.startDate), 'cycles')
  const cycleIds = (owning ?? []).map(c => c.id as string)
  // Unplaced work shows once, in the display week that holds its cycle's start, or (for the cycle in progress) the week holding today.
  // A display week and a cycle can have different boundaries; the other overlapped weeks show the cycle's dated work only.
  const todayLocal = utcToZonedParts(new Date(), week.timezone).date
  const floatingCycleIds = (owning ?? []).filter(c => ((c.starts_at_local as string) >= week.startDate && (c.starts_at_local as string) <= week.endDate)
    || (c.status === 'active' && todayLocal >= week.startDate && todayLocal <= week.endDate && todayLocal >= (c.starts_at_local as string) && todayLocal <= (c.ends_at_local as string))).map(c => c.id as string)
  const cycle = (owning ?? []).find(c => c.status === 'active') ?? (owning ?? [])[0] ?? null

  const { data: blocks, error: eBlocks } = cycleIds.length ? await admin
    .from('plan_blocks')
    .select(`
      id, title, detail, task_type, origin, priority, placement, execution,
      local_date, starts_at, duration_minutes, duration, rationale,
      suggested_approach, completion_meaning, attempt_id, assessment_scope, learning_objective, verification_intent, curriculum_reference, dependencies, sitting_ordinal, lm_id, scope_group_id, continued_from_task_id, carry_intent, estimate_provisional, source_report_id, source_report_version,
      is_protected_commitment, revision, cycle_id, class_session_id,
      learning_activity_id, activity:learning_activities!plan_blocks_learning_activity_id_fkey(activity_type,duration_minutes),
      concept:curriculum_concepts ( name )
    `)
    .eq('user_id', userId)
    .in('cycle_id', cycleIds)
    .is('cancelled_at', null)
    .neq('execution', 'cancelled')
    .or(`and(local_date.gte.${week.startDate},local_date.lte.${week.endDate}),local_date.is.null`)
    : { data: [] as any[], error: null }
  must({ error: eBlocks }, 'tasks')

  // One-off commitments overlapping the week only — not every one ever created.
  const weekStartUtc = new Date(`${week.startDate}T00:00:00Z`)
  const weekEndUtc = new Date(`${week.endDate}T23:59:59Z`)
  const pad = 24 * 60 * 60 * 1000 // a day either side, so timezone offsets cannot clip an edge
  const { data: commitments, error: eComm } = await supabase
    .from('calendar_commitments')
    .select('id, label, kind, starts_at, ends_at, is_protected, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('recurrence', 'none')
    .lte('starts_at', new Date(weekEndUtc.getTime() + pad).toISOString())
    .gte('ends_at', new Date(weekStartUtc.getTime() - pad).toISOString())

  must({ error: eComm }, 'commitments')
  // Recurring commitments are expanded across the week rather than rendered
  // from their anchor row, which would show a weekly class once, on whichever
  // date the series happened to start.
  // One shared read of the few weekly series per request. A non-strict caller tolerated a failed read here, and still does; a strict one throws as before.
  const seriesRows = (await (opts.strict === false ? weeklySeries(userId).catch(() => []) : weeklySeries(userId).catch(e => { throw new Error(`calendar read failed (class series): ${e instanceof Error ? e.message : 'unknown'}`) }))).filter(r => r.status === 'active')
  const seriesIds = (seriesRows ?? []).map(r => r.id as string)
  const { data: exceptionRows, error: eExc } = seriesIds.length
    ? await supabase.from('commitment_exceptions').select('*').in('commitment_id', seriesIds)
    : { data: [] as any[], error: null }
  must({ error: eExc }, 'class exceptions')

  const exceptions: CommitmentException[] = (exceptionRows ?? []).map(e => ({
    commitmentId: e.commitment_id as string,
    occurrenceDate: e.occurrence_date as string,
    kind: e.kind as 'skipped' | 'moved',
    newDate: (e.new_date ?? null) as string | null,
    newStartTime: (e.new_start_time ?? null) as string | null,
    newEndTime: (e.new_end_time ?? null) as string | null,
  }))

  const entries: CalendarEntry[] = []
  const continuations = await loadContinuations(userId, (blocks ?? []).map(b => ({
    id: b.id as string, continued_from_task_id: (b.continued_from_task_id ?? null) as string | null,
    class_session_id: b.class_session_id as string | null,
    carry_intent: (b.carry_intent ?? null) as string | null, estimate_provisional: (b.estimate_provisional ?? null) as boolean | null,
  })))
  const reportIds = [...new Set((blocks ?? []).flatMap(b => b.source_report_id ? [b.source_report_id as string] : []))]
  const reportInfo = new Map<string, { status: string; version: number }>()
  if (reportIds.length) for (const r of (await admin.from('mock_reports').select('id, status, version').eq('user_id', userId).in('id', reportIds).throwOnError()).data ?? []) reportInfo.set(r.id as string, { status: r.status as string, version: r.version as number })
  const readingIds = [...new Set((blocks ?? []).flatMap(b => b.lm_id ? [b.lm_id as string] : []))]
  const readingTopic = new Map<string, string>()
  if (readingIds.length) for (const r of (await admin.from('curriculum_readings').select('id, topic_id').in('id', readingIds)).data ?? []) readingTopic.set(r.id as string, r.topic_id as string)
  const depIds = [...new Set((blocks ?? []).flatMap(b => Array.isArray(b.dependencies) ? (b.dependencies as unknown[]).filter((x): x is string => typeof x === 'string') : []))]
  const depRows = new Map<string, { title: string; date: string | null }>()
  if (depIds.length) for (const d of (await admin.from('plan_blocks').select('id, title, local_date').eq('user_id', userId).in('id', depIds)).data ?? []) depRows.set(d.id as string, { title: d.title as string, date: (d.local_date as string | null) ?? null })
  const scopeGroups = await getScopeGroups(userId, (blocks ?? []).flatMap(b => b.scope_group_id ? [b.scope_group_id as string] : []))

  for (const b of blocks ?? []) {
    const timed = b.placement === 'timed' && b.starts_at
    const parts = timed ? utcToZonedParts(new Date(b.starts_at as string), week.timezone) : null
    const localDate = (b.local_date as string | null) ?? parts?.date ?? null

    // A floating task shows only in the period its own cycle covers; a dated task outside this week is skipped.
    if (!b.local_date && !b.starts_at && !floatingCycleIds.includes(b.cycle_id as string)) continue
    if (localDate && (localDate < week.startDate || localDate > week.endDate)) continue

    entries.push({
      id: b.id as string,
      title: b.title as string,
      detail: (b.detail ?? null) as string | null,
      layer: (b.activity as any)?.activity_type === 'class' ? 'class' : layerFor(b.task_type as string | null, b.origin as string | null),
      kind: timed ? 'timed' : localDate ? 'day' : 'floating',
      localDate,
      startMinutes: parts ? parts.minutesOfDay : null,
      durationMinutes: b.learning_activity_id ? 0 : (b.duration_minutes ?? b.duration ?? 30) as number,
      isLoggedLearning: Boolean(b.learning_activity_id),
      recordedMinutes: b.learning_activity_id ? ((b.activity as any)?.duration_minutes ?? null) : undefined,
      execution: (b.execution ?? null) as string | null,
      origin: (b.origin ?? null) as string | null,
      isProtected: Boolean(b.is_protected_commitment),
      rationale: (b.rationale ?? null) as string | null,
      suggestedApproach: (b.suggested_approach ?? null) as string | null,
      completionMeaning: (b.completion_meaning ?? null) as string | null,
      conceptName: (b.concept as any)?.name ?? null,
      attemptId: (b.attempt_id ?? null) as string | null,
      assessmentScope: b.assessment_scope ?? null,
      taskType: (b.task_type ?? null) as string | null,
      revision: (b.revision ?? 1) as number,
      isTask: true,
      classSessionId: b.class_session_id as string | null ?? continuations.get(b.id as string)?.classSessionId ?? null,
      exportKey: b.id as string,
      startsAtIso: timed ? new Date(b.starts_at as string).toISOString() : undefined,
      endsAtIso: timed ? new Date(new Date(b.starts_at as string).getTime() + ((b.duration_minutes ?? b.duration ?? 30) as number) * 60_000).toISOString() : undefined,
      learningObjective: (b.learning_objective ?? null) as string | null,
      verificationIntent: (b.verification_intent ?? null) as string | null,
      sittingOrdinal: (b.sitting_ordinal ?? null) as number | null,
      sourceReport: b.source_report_id ? { id: b.source_report_id as string, plannedFromVersion: (b.source_report_version ?? null) as number | null, status: (reportInfo.get(b.source_report_id as string)?.status ?? 'unknown') as 'active' | 'withdrawn' | 'unknown', currentVersion: reportInfo.get(b.source_report_id as string)?.version ?? null } : null,
      follows: (Array.isArray(b.dependencies) ? (b.dependencies as unknown[]) : []).flatMap(x => typeof x === 'string' && depRows.has(x) ? [{ id: x, title: depRows.get(x)!.title, date: depRows.get(x)!.date }] : []),
      reading: b.lm_id ? { id: b.lm_id as string, topicId: readingTopic.get(b.lm_id as string) ?? null, label: (b.curriculum_reference as string | null) ?? 'Reading' } : null,
      continuation: continuations.get(b.id as string) ?? null,
      scopeProgress: b.scope_group_id ? {
        completed: scopeGroups.get(b.scope_group_id as string)?.completed ?? 0,
        total: scopeGroups.get(b.scope_group_id as string)?.expected ?? 0,
        complete: scopeGroups.get(b.scope_group_id as string)?.complete ?? false,
      } : null,
    })
  }

  for (const c of commitments ?? []) {
    const start = utcToZonedParts(new Date(c.starts_at as string), week.timezone)
    const end = utcToZonedParts(new Date(c.ends_at as string), week.timezone)
    if (start.date < week.startDate || start.date > week.endDate) continue

    const duration = Math.max(
      15,
      end.date === start.date
        ? end.minutesOfDay - start.minutesOfDay
        : 24 * 60 - start.minutesOfDay
    )

    entries.push({
      id: c.id as string,
      title: c.label as string,
      detail: null,
      layer: c.kind === 'class' ? 'class' : 'commitment',
      kind: 'timed',
      localDate: start.date,
      startMinutes: start.minutesOfDay,
      durationMinutes: duration,
      execution: null,
      origin: 'student',
      isProtected: Boolean(c.is_protected),
      rationale: null,
      suggestedApproach: null,
      completionMeaning: null,
      conceptName: null,
      attemptId: null,
      assessmentScope: null,
      taskType: null,
      revision: 1,
      isTask: false,
      exportKey: c.id as string,
      startsAtIso: new Date(c.starts_at as string).toISOString(),
      endsAtIso: new Date(c.ends_at as string).toISOString(),
    })
  }

  for (const r of seriesRows ?? []) {
    const commitment: RecurringCommitment = {
      id: r.id as string, label: r.label as string, kind: r.kind as string,
      isProtected: Boolean(r.is_protected), recurrence: 'weekly',
      weekdays: (r.weekdays ?? []) as number[],
      startTime: (r.start_time ?? null) as string | null,
      endTime: (r.end_time ?? null) as string | null,
      startsOn: (r.starts_on ?? null) as string | null,
      endsOn: (r.ends_on ?? null) as string | null,
    }
    for (const o of expandCommitment(commitment, week.days, exceptions)) {
      entries.push({
        // One block per occurrence, keyed by the date it was scheduled for: a moved occurrence can land on a date that already has one.
        id: `${o.commitmentId}@${o.originalDate}`,
        title: o.moved ? `${o.label} (moved)` : o.label,
        detail: null,
        layer: o.kind === 'class' ? 'class' : 'commitment',
        kind: 'timed',
        localDate: o.date,
        startMinutes: o.start,
        durationMinutes: o.durationMinutes,
        execution: null,
        origin: 'student',
        isProtected: o.isProtected,
        rationale: null,
        suggestedApproach: null,
        completionMeaning: null,
        conceptName: null,
        attemptId: null,
        assessmentScope: null,
        taskType: null,
        revision: 1,
        isTask: false,
        exportKey: `${o.commitmentId}@${o.originalDate}`,
        commitmentId: o.commitmentId, originalDate: o.originalDate, moved: o.moved,
      })
    }
  }

  const timed = entries.filter(e => e.kind === 'timed' && e.startMinutes !== null)
  const floating = entries.filter(e => e.kind === 'floating')

  const byDate: Record<string, CalendarEntry[]> = {}
  for (const d of week.days) byDate[d] = []
  for (const e of entries) {
    if (e.localDate && byDate[e.localDate]) byDate[e.localDate].push(e)
  }
  for (const d of week.days) {
    // Clock-timed entries by time; day-only sittings (no invented time) in their declared order: ordinal, then predecessors first.
    const sorted = byDate[d].sort((a, b) => (a.startMinutes ?? 1441) - (b.startMinutes ?? 1441) || (a.sittingOrdinal ?? Infinity) - (b.sittingOrdinal ?? Infinity) || 0)
    const dayOnly = sorted.filter(e => e.startMinutes === null)
    byDate[d] = [...sorted.filter(e => e.startMinutes !== null), ...inDeclaredOrder(dayOnly, e => e.id, e => (e.follows ?? []).map(f => f.id))]
  }

  // Bound the grid to the hours actually in use, with breathing room.
  const starts = timed.map(e => e.startMinutes as number)
  const ends = timed.map(e => (e.startMinutes as number) + e.durationMinutes)
  const earliestMinute = starts.length ? Math.max(0, Math.floor((Math.min(...starts) - 60) / 60) * 60) : 7 * 60
  const latestMinute = ends.length ? Math.min(24 * 60, Math.ceil((Math.max(...ends) + 60) / 60) * 60) : 22 * 60

  return {
    entries,
    timed,
    byDate,
    floating,
    cycleId: (cycle?.id ?? null) as string | null,
    earliestMinute: Math.min(earliestMinute, 8 * 60),
    latestMinute: Math.max(latestMinute, 21 * 60),
  }
}

export { weekdayOf }
