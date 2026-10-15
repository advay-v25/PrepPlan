import { createAdminClient } from '../supabase/admin'
import { createClient } from '../supabase/server'
import {
  StudyWeek, Weekday, addDays, formatWeekRange,
  isEndOfCycle, repairPlacementFor, resolveStudyWeek, shiftStudyWeek,
  todayInZone, zonedTimeToUtc,
} from './studyWeek'
import { resolvePulseWeek } from './pulse/weekBoundary'
import { determineRepairDuration, determineRepairType } from './repairPolicy'

/**
 * The bridge between diagnostics and the calendar.
 *
 * Two rules govern it:
 *
 *  1. The weekly cumulative diagnostic sits on the last day of the study week,
 *     whichever weekday that is for this student. It is a scheduled task like
 *     any other, so it appears in the calendar, can be moved, and can be seen
 *     coming.
 *
 *  2. Nothing a diagnostic produces is written straight into an accepted week.
 *     Evidence creates a *proposal*; only an accepted proposal becomes a task.
 *     A test taken on the last day of a cycle has no room left in that week, so
 *     its follow-up opens the next one.
 */

export type StudyWeekContext = {
  week: StudyWeek
  anchorDay: Weekday
  /** True when the week's boundary actually came from a class, not the default Monday-Sunday fallback. */
  classLed: boolean
  timezone: string
  today: string
  /** Default clock time for the weekly diagnostic, local. */
  diagnosticTime: string
}

/** Resolves the student's study week from their profile. */
export async function getStudyWeekContext(
  userId: string,
  reference?: Date | string
): Promise<StudyWeekContext> {
  const admin = createAdminClient()
  const [{ data: profile }, { data: classes }, { data: nextClass }] = await Promise.all([
    admin.from('profiles').select('timezone, reminder_at').eq('id', userId).maybeSingle(),
    admin.from('calendar_commitments').select('weekdays')
      .eq('user_id', userId).eq('kind', 'class').eq('status', 'active').eq('recurrence', 'weekly'),
    // A variable pattern's confirmed next class — see resolvePulseWeek's anchor rule. Ignored once a
    // recurring pattern exists (the query above already found one), so it is always safe to fetch.
    admin.from('calendar_commitments').select('starts_at')
      .eq('user_id', userId).eq('kind', 'class').eq('status', 'active').eq('recurrence', 'none').eq('defines_cycle', true)
      .gt('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const timezone = profile?.timezone || 'UTC'
  const classWeekdays = (classes ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[])
  const nextClassDate = nextClass?.starts_at ? todayInZone(timezone, new Date(nextClass.starts_at as string)) : null
  const week = resolvePulseWeek({ classWeekdays, nextClassDate, timezone, reference })
  const anchorDay = week.anchorDay

  // reminder_at is a time-of-day the student already chose for their weekly
  // check-in; the diagnostic sits with it rather than at an invented hour.
  const reminder = typeof profile?.reminder_at === 'string' ? profile.reminder_at.slice(0, 5) : null

  return {
    week,
    anchorDay,
    classLed: week.classLed,
    timezone,
    today: todayInZone(timezone, typeof reference === 'string' ? new Date() : reference),
    diagnosticTime: reminder || '18:00',
  }
}

export const WEEKLY_DIAGNOSTIC_MINUTES = 90

function taskId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}


// ---------------------------------------------------------------------------
// Diagnostic → calendar
// ---------------------------------------------------------------------------

export type RepairProposalTask = {
  title: string
  detail: string
  taskType: string
  durationMinutes: number
  conceptId: string | null
  repairThreadId: string | null
  rationale: string
  earliestDate: string
  suggestedApproach: string | null
}

export type RepairProposal = {
  attemptId: string
  takenOn: string
  targetWeekLabel: string
  targetWeekStart: string
  targetWeekEnd: string
  rolledOver: boolean
  reason: string
  tasks: RepairProposalTask[]
}

/**
 * Builds the follow-up work a scored attempt implies, without writing anything.
 *
 * The output is a proposal for the student to accept. §10 of the plan is
 * explicit that Tests may emit a result and a proposal request, never a direct
 * calendar mutation.
 */
export async function buildRepairProposal(
  userId: string,
  attemptId: string
): Promise<RepairProposal | null> {
  const admin = createAdminClient()

  const { data: attempt } = await admin
    .from('assessment_attempts')
    .select('id, status, completed_at, started_at')
    .eq('id', attemptId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!attempt || attempt.status !== 'scored') return null

  const ctx = await getStudyWeekContext(userId)
  const completedAt = new Date((attempt.completed_at ?? attempt.started_at) as string)
  const takenOn = todayInZone(ctx.timezone, completedAt)

  // Which study week did the attempt actually fall in? Not necessarily today's.
  const attemptWeek = resolveStudyWeek({ anchorDay: ctx.anchorDay, timezone: ctx.timezone, reference: takenOn })
  const placement = repairPlacementFor(takenOn, attemptWeek)

  const { data: evidence } = await admin
    .from('evidence_events')
    .select('concept_id, error_code')
    .eq('attempt_id', attemptId)
    .eq('user_id', userId)
    .eq('validity', 'valid')
    .in('evidence_state', ['needs_repair', 'unstable'])

  const evRows = evidence ?? []
  if (evRows.length === 0) return null
  
  const conceptIds = Array.from(new Set(evRows.map(e => e.concept_id).filter(Boolean) as string[]))
  
  const { data: threads } = await admin
    .from('repair_threads')
    .select('id, concept_id, status, severity, occurrence_count, concept:curriculum_concepts ( name, scope_notes )')
    .eq('user_id', userId)
    .in('status', ['open', 'proposed'])
    .in('concept_id', conceptIds)

  const rows = threads ?? []
  if (rows.length === 0) return null

  // We need error_code from evidence to enrich rationale
  const errorMap = new Map<string, string | null>()
  for (const e of evRows) if (e.concept_id && e.error_code) errorMap.set(e.concept_id as string, e.error_code as string)

  const tasks: RepairProposalTask[] = []
  let offset = 0
  for (const t of rows) {
    const concept = t.concept as any
    const name = concept?.name ?? 'this concept'
    const unstable = t.severity === 'unstable'
    const errCode = errorMap.get(t.concept_id as string)
    
    const duration = determineRepairDuration(t.occurrence_count)
    // 'focus' and 'workshop' are repair *intensities*, not task types: a concept
    // missed repeatedly earns a heavier session. They are not values
    // plan_blocks.task_type accepts, and using them there both failed the check
    // constraint and would have cost the task its repair styling in the
    // calendar, which colours by task type.
    const intensity = determineRepairType(t.occurrence_count)
    const repeated = intensity === 'workshop'

    tasks.push({
      title: `Repair: ${name}`,
      detail: repeated
        ? `This has come back wrong more than once, so this is a longer working session rather than a review — go through it actively rather than re-reading.`
        : unstable
          ? `You answered this correctly but were not sure. Close the gap between knowing and being certain.`
          : `This came back wrong on your last diagnostic. Work through it before it compounds.`,
      taskType: 'repair',
      durationMinutes: duration,
      conceptId: t.concept_id as string,
      repairThreadId: t.id as string,
      rationale: unstable
        ? `Correct answer, low confidence, on ${takenOn}. Unstable recall, not a gap in understanding.`
        : `Missed on the diagnostic of ${takenOn}${errCode ? ` — ${errCode}` : ''}.`,
      earliestDate: addDays(placement.earliestDate, Math.floor(offset / 2)),
      suggestedApproach: concept?.scope_notes
        ? `Focus on: ${String(concept.scope_notes).slice(0, 220)}`
        : null,
    })
    offset++
  }

  // A single recheck covering everything repaired, spaced a few days out so it
  // measures retention rather than short-term recall.
  tasks.push({
    title: `Re-check: ${rows.length} repaired concept${rows.length === 1 ? '' : 's'}`,
    detail: 'A short probe on exactly what you repaired. This is what turns a repair into evidence.',
    taskType: 'recheck',
    durationMinutes: 15,
    conceptId: null,
    repairThreadId: null,
    rationale: 'Spaced three days after the repair so it tests retention, not the session you just finished.',
    earliestDate: addDays(placement.earliestDate, 3),
    suggestedApproach: null,
  })

  const target = placement.targetWeek
  return {
    attemptId,
    takenOn,
    targetWeekLabel: formatWeekRange(target),
    targetWeekStart: target.startDate,
    targetWeekEnd: target.endDate,
    rolledOver: isEndOfCycle(takenOn, attemptWeek),
    reason: placement.reason,
    tasks,
  }
}

/**
 * Writes an accepted proposal into the calendar.
 *
 * Tasks land as day-preferred, not timed: the earliest date is known, but no
 * exact window has been confirmed, and inventing a clock time from a preference
 * is the failure the plan calls out explicitly.
 */
export async function applyRepairProposal(
  userId: string,
  proposal: RepairProposal,
  cycleId: string | null
): Promise<{ created: number; taskIds: string[] }> {
  const admin = createAdminClient()

  const rows = proposal.tasks.map(t => ({
    // A UUID, not a readable slug: apply_diagnostic_repair_proposal casts these
    // to uuid, so a prefixed id fails the insert even though plan_blocks.id is
    // text. The weekly diagnostic keeps its slug because nothing casts it.
    id: crypto.randomUUID(),
    cycle_id: cycleId,
    title: t.title,
    detail: t.detail,
    task_type: t.taskType,
    origin: 'diagnostic',
    priority: 'core',
    placement: 'day_preferred',
    execution: 'not_started',
    local_date: t.earliestDate,
    day: t.earliestDate,
    duration_minutes: t.durationMinutes,
    duration: String(t.durationMinutes),
    repair_thread_id: t.repairThreadId,
    // Provenance the task drawer reads for "see the result that caused this".
    // The thread says which concept is being repaired; the attempt and concept
    // say which diagnostic found it, and that link was lost.
    attempt_id: proposal.attemptId,
    concept_id: t.conceptId,
    rationale: t.rationale,
    suggested_approach: t.suggestedApproach,
    completion_meaning:
      t.taskType === 'recheck'
        ? 'Completed the re-check and saw the result.'
        : 'Worked through the concept and can explain where the mistake came from.',
  }))

  // Persist the proposal before applying, using attemptId as a 1:1 mapping
  const { data: proposalRow, error: propErr } = await admin.from('coach_proposals').upsert({
    id: proposal.attemptId,
    user_id: userId,
    intent: 'diagnostic_repair',
    origin: 'diagnostic',
    reasoning: proposal.reason,
    proposed_changes: { attemptId: proposal.attemptId, targetWeek: proposal.targetWeekStart, tasks: proposal.tasks },
    // 'pending' is what the coach_proposals check constraint calls this state;
    // 'proposed' is not one of its values and every apply failed on it.
    status: 'pending',
    proposal_version: '1.0'
  }).select('id').single()

  if (propErr) throw new Error(`Could not persist proposal: ${propErr.message}`)

  // Called with the user's own client, not the service role: the function
  // authorises on auth.uid(), which is null for a service-role connection and
  // made every apply fail with "Unauthorized".
  const userClient = await createClient()
  const { data: taskIds, error } = await userClient.rpc('apply_diagnostic_repair_proposal', {
    p_proposal_id: proposal.attemptId,
    p_tasks: rows
  })

  if (error) {
    throw new Error(`Could not add the repair work: ${error.message}`)
  }

  return { created: rows.length, taskIds: taskIds as string[] }
}

/** The next study week, for previewing where rolled-over work lands. */
export function nextWeekOf(ctx: StudyWeekContext): StudyWeek {
  return shiftStudyWeek(ctx.week, 1)
}
