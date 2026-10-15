import { createAdminClient } from '../supabase/admin'
import { getStudyWeekContext } from '../planning/schedule'
import { addDays, daysBetween, todayInZone, utcToZonedParts } from '../planning/studyWeek'
import {
  Milestone, Roadmap, RoadmapInput, buildRoadmap, currentMilestone, currentPhase,
  remainingEffort, type ModuleInput,
} from './roadmap'

/**
 * Loading the roadmap's inputs, persisting a plan, and comparing planned with
 * actual.
 *
 * Every input here is observed rather than assumed: coverage comes from what
 * the student has done or been tested on, capacity from their real availability
 * and commitments, and the completion rate from work actually finished.
 */

export type CoverageRow = { lmId: string; state: ModuleInput['coverage']; source: string }

/**
 * Weekly capacity, in minutes, from the student's real week.
 *
 * Availability rules are the stated ceiling; commitments are subtracted from
 * it. Returns null when there is nothing to go on — an invented figure would
 * make every downstream verdict a guess wearing a number.
 */
export async function weeklyCapacityMinutes(userId: string): Promise<number | null> {
  const admin = createAdminClient()

  const { data: windows } = await admin
    .from('availability_windows')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (windows && windows.length > 0) {
    let totalMinutes = 0
    for (const w of windows) {
      if (w.start_time && w.end_time) {
        const [sh, sm] = String(w.start_time).split(':').map(Number)
        const [eh, em] = String(w.end_time).split(':').map(Number)
        let diff = (eh * 60 + em) - (sh * 60 + sm)
        if (diff < 0) diff += 24 * 60 // cross midnight
        totalMinutes += diff
      }
    }
    return totalMinutes > 0 ? totalMinutes : null
  }

  // No stated availability: fall back to what they have actually completed over
  // the last four weeks, which is a better guide than any self-estimate.
  const { data: events } = await admin
    .from('task_events')
    .select('actual_duration_minutes, created_at')
    .eq('user_id', userId)
    .not('actual_duration_minutes', 'is', null)
    .gte('created_at', new Date(Date.now() - 28 * 86_400_000).toISOString())

  if (!events || events.length < 3) return null
  const total = events.reduce((s, e) => s + (e.actual_duration_minutes ?? 0), 0)
  return Math.round(total / 4)
}

/**
 * Minutes actually spent per unit of effort, from completed work.
 *
 * This is the number that turns a relative effort band into a real duration.
 * It is measured, never assumed, and absent until there is enough completed
 * work to mean anything.
 */
export async function observedMinutesPerEffortUnit(userId: string): Promise<number | null> {
  const admin = createAdminClient()

  const { data: done } = await admin
    .from('plan_blocks')
    .select('lm_id, duration_minutes, execution')
    .eq('user_id', userId)
    .eq('execution', 'completed')
    .not('lm_id', 'is', null)

  if (!done || done.length < 4) return null

  const lmIds = [...new Set(done.map(d => d.lm_id as string))]
  const { data: mods } = await admin
    .from('learning_modules').select('id, effort_band').in('id', lmIds)
  const effortById = new Map((mods ?? []).map(m => [m.id as string, (m.effort_band ?? 3) as number]))

  let minutes = 0
  let effort = 0
  for (const d of done) {
    const band = effortById.get(d.lm_id as string)
    if (!band) continue
    minutes += (d.duration_minutes ?? 0) as number
    effort += band
  }
  if (effort <= 0) return null
  return Math.round(minutes / effort)
}

export async function loadRoadmapInputs(userId: string, options: { targetDate?: string } = {}): Promise<RoadmapInput | null> {
  const admin = createAdminClient()
  const ctx = await getStudyWeekContext(userId)

  const { data: profile } = await admin
    .from('profiles')
    .select('exam_window_id, exam_year, exam_sitting, exam_date, prep_mode, study_mode, classes_completed_at')
    .eq('id', userId)
    .maybeSingle()

  let targetDate = options.targetDate ?? null
  if (!targetDate && profile?.exam_date) {
    // Exact booked date takes precedence and is already YYYY-MM-DD
    targetDate = profile.exam_date as string
  }
  if (!targetDate && profile?.exam_window_id) {
    const { data: window } = await admin
      .from('exam_windows').select('window_opens').eq('id', profile.exam_window_id).maybeSingle()
    targetDate = (window?.window_opens ?? null) as string | null
  }
  if (!targetDate) return null

  const [
    { data: topicRows },
    { data: moduleRows },
    { data: edgeRows },
    { data: coverageRows },
    capMinutes,
    obsMinutes
  ] = await Promise.all([
    admin.from('topics').select('id, name, exam_weight_min, exam_weight_max, default_sequence').order('default_sequence'),
    admin.from('learning_modules').select('id, topic_ref, name, effort_band, effort_units, difficulty_weight, sequence_hint, is_active').eq('is_active', true),
    admin.from('lm_edges').select('from_lm, to_lm, kind').eq('kind', 'prerequisite'),
    admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', userId),
    weeklyCapacityMinutes(userId),
    observedMinutesPerEffortUnit(userId)
  ])

  // A weekly class series' own ends_on is the strongest signal classes have finished — it's what the
  // student (or their course) actually scheduled. The student's own manual confirmation
  // (profiles.classes_completed_at) is a fallback for when no commitment carries an end date, but once given
  // it should not be second-guessed by a series that just hasn't been edited, so it takes precedence.
  let classesCompletedDate: string | null = (profile?.classes_completed_at as string | null) ?? null
  if (!classesCompletedDate) {
    const { data: classSeries } = await admin
      .from('calendar_commitments')
      .select('ends_on')
      .eq('user_id', userId)
      .eq('kind', 'class')
      .eq('recurrence', 'weekly')
    const series = classSeries ?? []
    // Classes count as finished only once every known weekly series has a known end date in the past — a
    // single series still running (ends_on null, or in the future) means the course as a whole is ongoing,
    // even if another series already wrapped up.
    const allEnded = series.length > 0 && series.every(r => r.ends_on && (r.ends_on as string) < ctx.week.startDate)
    if (allEnded) {
      classesCompletedDate = series.reduce((max, r) => ((r.ends_on as string) > max ? (r.ends_on as string) : max), series[0].ends_on as string)
    }
  }

  const activeIds = new Set((moduleRows ?? []).map(m => m.id as string))
  const coverage = new Map((coverageRows ?? []).map(r => [r.lm_id as string, r.coverage_state as ModuleInput['coverage']]))

  // Four preparation modes map onto three planner routes. The distinction that
  // matters is whether someone else decides what is covered when: a recorded
  // course and a live class are both "classes", but only the live one dictates
  // the order, so only it anchors the roadmap's sequence.
  const route: RoadmapInput['route'] =
    profile?.prep_mode === 'instructor_led' ? 'coaching'
    : profile?.prep_mode === 'hybrid' ? 'hybrid'
    : 'self_study'

  return {
    // The roadmap starts at the beginning of the current study week, so its
    // week numbers line up with the calendar the student already sees.
    startDate: ctx.week.startDate,
    targetDate,
    route,
    classesCompletedDate,
    topics: (topicRows ?? []).map(t => ({
      id: t.id as string, name: t.name as string,
      weightMin: Number(t.exam_weight_min), weightMax: Number(t.exam_weight_max),
      sequence: t.default_sequence as number,
    })),
    modules: (moduleRows ?? [])
      .filter(m => m.topic_ref)
      .map(m => ({
        id: m.id as string,
        topic: m.topic_ref as string,
        name: m.name as string,
        // Page-derived effort units (the roadmap sizes work in effort units; the band is only for paper sizing).
        effortBand: Number(m.effort_units ?? m.effort_band ?? 3),
        difficulty: Number(m.difficulty_weight ?? 3),
        sequence: (m.sequence_hint ?? 1) as number,
        coverage: coverage.get(m.id as string) ?? 'not_started',
      })),
    // Edges to retired modules (the pre-2027 list) are ignored.
    prerequisites: (edgeRows ?? [])
      .filter(e => activeIds.has(e.from_lm as string) && activeIds.has(e.to_lm as string))
      .map(e => ({ from: e.from_lm as string, to: e.to_lm as string })),
    weeklyCapacityMinutes: capMinutes,
    observedMinutesPerEffortUnit: obsMinutes,
  }
}

export type StoredRoadmap = {
  id: string
  status: string
  targetDate: string
  startDate: string
  route: string
  roadmap: Roadmap
  revision: number
  generatedAt: string
}

/** Builds a roadmap and stores it as a draft, superseding any earlier draft. */
export async function generateRoadmap(userId: string, options: { targetDate?: string; activate?: boolean } = {}) {
  const input = await loadRoadmapInputs(userId, options)
  if (!input) return null

  const roadmap = buildRoadmap(input)
  const admin = createAdminClient()

  await admin.from('study_roadmaps')
    .update({ status: 'superseded' })
    .eq('user_id', userId)
    .in('status', options.activate ? ['draft', 'active'] : ['draft'])

  const { data: profile } = await admin
    .from('profiles').select('exam_window_id').eq('id', userId).maybeSingle()

  const { data: stored, error } = await admin.from('study_roadmaps').insert({
    user_id: userId,
    exam_window_id: (profile?.exam_window_id ?? null) as string | null,
    target_date: roadmap.targetDate,
    route: input.route,
    status: options.activate ? 'active' : 'draft',
    phases: roadmap.phases,
    inputs: {
      startDate: roadmap.startDate,
      weeklyCapacityMinutes: input.weeklyCapacityMinutes,
      observedMinutesPerEffortUnit: input.observedMinutesPerEffortUnit,
      moduleCount: input.modules.length,
    },
    feasibility: roadmap.feasibility,
    accepted_at: options.activate ? new Date().toISOString() : null,
  }).select('id, revision, generated_at').single()

  if (error) throw new Error(`Could not save the roadmap: ${error.message}`)

  if (roadmap.milestones.length > 0) {
    const { error: msErr } = await admin.from('roadmap_milestones').insert(
      roadmap.milestones.map(m => ({
        roadmap_id: stored.id,
        user_id: userId,
        phase: m.phase,
        topic_ref: m.topicId,
        sequence: m.sequence,
        planned_start_week: m.startWeek,
        planned_end_week: m.endWeek,
        planned_start_date: m.startDate,
        planned_end_date: m.endDate,
        effort_weight: m.effortWeight,
      }))
    )
    if (msErr) throw new Error(`Could not save milestones: ${msErr.message}`)
  }

  return { id: stored.id as string, roadmap, input }
}

/** The roadmap currently in force, rebuilt from its stored inputs. */
export async function getActiveRoadmap(userId: string): Promise<{ id: string; status: string; roadmap: Roadmap; input: RoadmapInput } | null> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('study_roadmaps')
    .select('id, status, target_date, route, phases, inputs, feasibility, generated_at')
    .eq('user_id', userId)
    .in('status', ['active', 'draft'])
    .order('status', { ascending: true }) // 'active' sorts before 'draft'
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) return null

  // Rebuild from current inputs rather than replaying a stale snapshot: coverage
  // and capacity move, and a roadmap that cannot see that is decoration.
  const input = await loadRoadmapInputs(userId, { targetDate: row.target_date as string })
  if (!input) return null
  const stored = (row.inputs ?? {}) as any
  if (stored.startDate) input.startDate = stored.startDate

  return { id: row.id as string, status: row.status as string, roadmap: buildRoadmap(input), input }
}

// ---------------------------------------------------------------------------
// Planned versus actual
// ---------------------------------------------------------------------------

export type Progress = {
  weeksElapsed: number
  totalWeeks: number
  /** Effort the plan expected to be finished by now. */
  plannedEffortDone: number
  /** Effort actually finished. */
  actualEffortDone: number
  totalEffort: number
  plannedPercent: number
  actualPercent: number
  /** Positive means ahead of plan, negative means behind. */
  weeksAhead: number
  verdict: 'ahead' | 'on_track' | 'slipping' | 'behind' | 'not_started'
  message: string
  currentMilestone: Milestone | null
  currentPhaseLabel: string | null
  modulesDone: number
  modulesTotal: number
}

/**
 * Where the student actually is against where the plan said they would be.
 *
 * Deliberately measured in effort rather than module count: finishing six easy
 * modules is not the same as finishing three hard ones, and a plan that treats
 * them as equal will keep telling a student they are fine when they are not.
 */
export async function computeProgress(userId: string, roadmap: Roadmap, preloadedInput?: RoadmapInput | null): Promise<Progress> {
  const ctx = await getStudyWeekContext(userId)
  const today = todayInZone(ctx.timezone)
  const input = preloadedInput || await loadRoadmapInputs(userId, { targetDate: roadmap.targetDate })

  const modules = input?.modules ?? []
  const byId = new Map(modules.map(m => [m.id, m]))

  // Total effort is measured against a clean slate, so "50% done" means half
  // the curriculum, not half of whatever is left today.
  const totalEffort = modules.reduce(
    (s, m) => s + remainingEffort({ ...m, coverage: 'not_started' }), 0
  )
  const actualEffortDone = modules.reduce(
    (s, m) => s + (remainingEffort({ ...m, coverage: 'not_started' }) - remainingEffort(m)), 0
  )

  // Fractional, not whole weeks. Rounding to whole weeks makes the plan expect
  // all of week one's work on the first morning of week one, which then reports
  // a student as a week behind before they have started.
  const elapsedWeeks = Math.max(0, daysBetween(roadmap.startDate, today) / 7)
  const weeksElapsed = Math.floor(elapsedWeeks)

  // What the plan expected finished by now: milestones that have closed in
  // full, plus how far through the one in progress today falls.
  let plannedEffortDone = 0
  for (const m of roadmap.milestones) {
    const milestoneEffort = m.moduleIds.reduce(
      (s, id) => s + (byId.has(id) ? remainingEffort({ ...byId.get(id)!, coverage: 'not_started' }) : 0), 0
    )
    // A milestone covering weeks 3–5 occupies elapsed-week 2 up to 5.
    const opensAt = m.startWeek - 1
    const closesAt = m.endWeek
    const span = Math.max(1, closesAt - opensAt)
    const through = Math.min(1, Math.max(0, (elapsedWeeks - opensAt) / span))
    plannedEffortDone += milestoneEffort * through
  }

  const firstPass = roadmap.phases.find(p => p.phase === 'first_pass')
  const effortPerWeek = firstPass && firstPass.weeks > 0 ? totalEffort / firstPass.weeks : 0
  const weeksAhead = effortPerWeek > 0 ? (actualEffortDone - plannedEffortDone) / effortPerWeek : 0

  const modulesDone = modules.filter(m => m.coverage === 'verified').length
  const plannedPercent = totalEffort > 0 ? Math.round((plannedEffortDone / totalEffort) * 100) : 0
  const actualPercent = totalEffort > 0 ? Math.round((actualEffortDone / totalEffort) * 100) : 0

  let verdict: Progress['verdict']
  let message: string
  // Nothing meaningful to compare in the first week of a nine-month plan.
  if (actualEffortDone === 0 && elapsedWeeks < 1) {
    verdict = 'not_started'
    message = 'The plan has not started yet. Nothing to compare.'
  } else if (weeksAhead >= 1) {
    verdict = 'ahead'
    message = `You are roughly ${Math.round(weeksAhead)} week${Math.round(weeksAhead) === 1 ? '' : 's'} ahead of the plan. That is worth spending on consolidation rather than racing further forward.`
  } else if (weeksAhead > -1) {
    verdict = 'on_track'
    message = 'You are close to where the plan expected you to be.'
  } else if (weeksAhead > -3) {
    verdict = 'slipping'
    message = `You are about ${Math.abs(Math.round(weeksAhead))} week${Math.abs(Math.round(weeksAhead)) === 1 ? '' : 's'} behind. Still recoverable without touching the exam date.`
  } else {
    verdict = 'behind'
    message = `You are around ${Math.abs(Math.round(weeksAhead))} weeks behind the plan. This is the point to change something deliberately rather than hope for a good month.`
  }

  const phase = currentPhase(roadmap, today)

  return {
    weeksElapsed, totalWeeks: roadmap.totalWeeks,
    plannedEffortDone: Number(plannedEffortDone.toFixed(1)),
    actualEffortDone: Number(actualEffortDone.toFixed(1)),
    totalEffort: Number(totalEffort.toFixed(1)),
    plannedPercent, actualPercent,
    weeksAhead: Number(weeksAhead.toFixed(1)),
    verdict, message,
    currentMilestone: currentMilestone(roadmap, today),
    currentPhaseLabel: phase?.phase ?? null,
    modulesDone, modulesTotal: modules.length,
  }
}

export { addDays }
