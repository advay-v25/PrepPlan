import { createClient } from '../supabase/server'
import { createAdminClient } from '../supabase/admin'
import { StudyWeek, utcToZonedParts, weekdayOf } from './studyWeek'
import { expandCommitment, type CommitmentException, type RecurringCommitment } from './mutations'

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

export async function loadCalendarWeek(userId: string, week: StudyWeek): Promise<CalendarWeekData> {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: cycle } = await supabase
    .from('planning_cycles')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  // Tasks for this week: anything whose local_date falls inside it, plus
  // floating work that belongs to the cycle but has no date yet.
  // Only tasks belonging to the active accepted cycle are shown. Legacy rows
  // (cycle_id null, or a superseded cycle) stay in the database for audit but
  // never render; with no active cycle the week is empty until activation.
  const { data: blocks } = cycle ? await admin
    .from('plan_blocks')
    .select(`
      id, title, detail, task_type, origin, priority, placement, execution,
      local_date, starts_at, duration_minutes, duration, rationale,
      suggested_approach, completion_meaning, attempt_id, assessment_scope,
      is_protected_commitment, revision,
      concept:curriculum_concepts ( name )
    `)
    .eq('user_id', userId)
    .eq('cycle_id', cycle.id)
    .is('cancelled_at', null)
    .neq('execution', 'cancelled')
    .or(`and(local_date.gte.${week.startDate},local_date.lte.${week.endDate}),local_date.is.null`)
    : { data: [] as any[] }

  // One-off commitments overlapping the week only — not every one ever created.
  const weekStartUtc = new Date(`${week.startDate}T00:00:00Z`)
  const weekEndUtc = new Date(`${week.endDate}T23:59:59Z`)
  const pad = 24 * 60 * 60 * 1000 // a day either side, so timezone offsets cannot clip an edge
  const { data: commitments } = await supabase
    .from('calendar_commitments')
    .select('id, label, kind, starts_at, ends_at, is_protected, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('recurrence', 'none')
    .lte('starts_at', new Date(weekEndUtc.getTime() + pad).toISOString())
    .gte('ends_at', new Date(weekStartUtc.getTime() - pad).toISOString())

  // Recurring commitments are expanded across the week rather than rendered
  // from their anchor row, which would show a weekly class once, on whichever
  // date the series happened to start.
  const { data: seriesRows } = await supabase
    .from('calendar_commitments')
    .select('id, label, kind, is_protected, recurrence, weekdays, start_time, end_time, starts_on, ends_on')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('recurrence', 'weekly')

  const seriesIds = (seriesRows ?? []).map(r => r.id as string)
  const { data: exceptionRows } = seriesIds.length
    ? await supabase.from('commitment_exceptions').select('*').in('commitment_id', seriesIds)
    : { data: [] as any[] }

  const exceptions: CommitmentException[] = (exceptionRows ?? []).map(e => ({
    commitmentId: e.commitment_id as string,
    occurrenceDate: e.occurrence_date as string,
    kind: e.kind as 'skipped' | 'moved',
    newDate: (e.new_date ?? null) as string | null,
    newStartTime: (e.new_start_time ?? null) as string | null,
    newEndTime: (e.new_end_time ?? null) as string | null,
  }))

  const entries: CalendarEntry[] = []

  for (const b of blocks ?? []) {
    const timed = b.placement === 'timed' && b.starts_at
    const parts = timed ? utcToZonedParts(new Date(b.starts_at as string), week.timezone) : null
    const localDate = (b.local_date as string | null) ?? parts?.date ?? null

    // A floating task has no date; a dated task outside this week is skipped.
    if (localDate && (localDate < week.startDate || localDate > week.endDate)) continue

    entries.push({
      id: b.id as string,
      title: b.title as string,
      detail: (b.detail ?? null) as string | null,
      layer: layerFor(b.task_type as string | null, b.origin as string | null),
      kind: timed ? 'timed' : localDate ? 'day' : 'floating',
      localDate,
      startMinutes: parts ? parts.minutesOfDay : null,
      durationMinutes: (b.duration_minutes ?? b.duration ?? 30) as number,
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
        // One occurrence per date, so a series appears as many blocks.
        id: `${o.commitmentId}@${o.date}`,
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
    byDate[d].sort((a, b) => (a.startMinutes ?? 1441) - (b.startMinutes ?? 1441))
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
