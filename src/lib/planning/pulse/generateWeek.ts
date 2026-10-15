import { createAdminClient } from '../../supabase/admin'
import { StudyWeek, Weekday, weekdayOf, zonedTimeToUtc } from '../studyWeek'
import { dailyCapacityMinutes } from './capacity'
import { computeWeeklyEnvelope, completionRateOf } from './envelope'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import { currentPhase, remainingEffort, type ModuleInput, type Phase } from '../../curriculum/roadmap'
import { PAPER_START_TIME, paperTitle, planWeeklyPaper, toPersistedScope, type PaperPlan, type PersistedPaperScope } from './paper'

export const NEW_CONTENT_DAILY_CAP_EFFORT_UNITS = 6

export type GeneratedPortion = {
  title: string
  detail: string
  taskType: string
  effortUnits: number
  durationMinutes: number
  lmId: string | null
  repairThreadId: string | null
  priorityLane: 'repair' | 'unstable' | 'consolidation' | 'content'
  /** Set on the weekly paper: its purpose and the scope the bank was checked against. */
  assessmentScope?: PersistedPaperScope | null
  rationale?: string
}

export type DayPlan = { date: string; weekday: Weekday; portions: GeneratedPortion[] }

type RepairInput = { id: string; title: string; durationMinutes: number }
type UnstableInput = { conceptId: string; name: string }

/**
 * One day's portions, from a capacity budget and the priority queue (spec
 * §3.1). Pure — no DB access, so it's directly testable. Repair and
 * unstable-concept work compete for the day's capacity but never for the
 * 6-effort-unit new-content cap; new content is what gets capped, because
 * review/repair work is fine denser (it isn't first exposure).
 */
export function allocateDay(input: {
  capacityMinutes: number
  minutesPerEffortUnit: number
  repairs: RepairInput[]
  unstableConcepts: UnstableInput[]
  pendingModules: ModuleInput[]
  phase: Phase
}): DayPlan {
  const portions: GeneratedPortion[] = []
  let remainingMinutes = input.capacityMinutes

  for (const r of input.repairs) {
    if (remainingMinutes < r.durationMinutes) continue
    portions.push({
      title: r.title, detail: '', taskType: 'repair', effortUnits: 0,
      durationMinutes: r.durationMinutes, lmId: null, repairThreadId: r.id, priorityLane: 'repair',
    })
    remainingMinutes -= r.durationMinutes
  }

  const unstableMinutes = 15
  for (const c of input.unstableConcepts) {
    if (remainingMinutes < unstableMinutes) continue
    portions.push({
      title: `Re-verify: ${c.name}`, detail: 'Correct last time, but not confident — close the gap.',
      taskType: 'recheck', effortUnits: 0, durationMinutes: unstableMinutes,
      lmId: null, repairThreadId: null, priorityLane: 'unstable',
    })
    remainingMinutes -= unstableMinutes
  }

  if (input.phase === 'final') return { date: '', weekday: 0, portions } // no new content in final (spec §4)

  // plan_blocks.duration_minutes is DB-constrained to [5, 180]. A module can
  // easily need more than 180 minutes at this rate (effort_band values run
  // 2-4, i.e. 170-340 minutes at the default 85 min/unit), so a module's
  // portion is clamped to that range rather than sized to its full remaining
  // effort — a module needing more than one day's worth is picked up again
  // in a later week, since buildWeekPlan re-derives pendingModules from live
  // coverage state on every call rather than from calendar history.
  const MAX_PORTION_MINUTES = 180
  const MIN_PORTION_MINUTES = 5

  let newContentUnits = 0
  for (const mod of input.pendingModules) {
    if (newContentUnits >= NEW_CONTENT_DAILY_CAP_EFFORT_UNITS) break
    const totalMinutes = Math.round(remainingEffort(mod) * input.minutesPerEffortUnit)
    const capMinutesLeft = Math.round(
      (NEW_CONTENT_DAILY_CAP_EFFORT_UNITS - newContentUnits) * input.minutesPerEffortUnit
    )
    const minutes = Math.min(totalMinutes, MAX_PORTION_MINUTES, capMinutesLeft)
    if (minutes < MIN_PORTION_MINUTES) continue
    if (minutes > remainingMinutes) continue
    portions.push({
      title: `Study: ${mod.name}`, detail: '', taskType: 'study', effortUnits: minutes / input.minutesPerEffortUnit,
      durationMinutes: minutes, lmId: mod.id, repairThreadId: null, priorityLane: 'content',
    })
    newContentUnits += minutes / input.minutesPerEffortUnit
    remainingMinutes -= minutes
  }

  return { date: '', weekday: 0, portions }
}

export type WeekPlanResult = { days: DayPlan[]; paper: PaperPlan }

/** Only self-study has a fixed Sunday paper boundary. */
export function permitsStudyPortions(route: 'self_study' | 'coaching' | 'hybrid', weekday: Weekday): boolean {
  return route !== 'self_study' || weekday !== 0
}

/** Computes the whole week's plan. Read-only — no writes happen here. */
export async function buildWeekPlan(userId: string, week: StudyWeek): Promise<DayPlan[]> {
  return (await buildWeekPlanWithPaper(userId, week)).days
}

/**
 * Same as buildWeekPlan, but also returns the weekly paper decision — including
 * the reason when no paper is scheduled — so callers can explain an honest
 * "no paper this week" instead of implying one exists.
 */
export async function buildWeekPlanWithPaper(
  userId: string, week: StudyWeek, opts: { closingCycleId?: string } = {}
): Promise<WeekPlanResult> {
  const admin = createAdminClient()
  const active = await getActiveRoadmap(userId)
  if (!active) {
    return {
      days: week.days.map(date => ({ date, weekday: weekdayOf(date), portions: [] })),
      paper: { kind: 'none', reason: 'no_scope', skipped: [] },
    }
  }

  const phaseSpan = currentPhase(active.roadmap, week.startDate)
  const phase: Phase = phaseSpan?.phase ?? 'first_pass'

  const currentWeekNumber = Math.floor(
    (new Date(week.startDate).getTime() - new Date(active.roadmap.startDate).getTime()) / (7 * 86_400_000)
  ) + 1
  const usableWeeksRemaining = phaseSpan ? Math.max(1, phaseSpan.endWeek - currentWeekNumber + 1) : 1

  const phaseModuleIds = new Set(
    active.roadmap.milestones.filter(m => m.phase === phase).flatMap(m => m.moduleIds)
  )
  const pendingModules = active.input.modules.filter(
    m => phaseModuleIds.has(m.id) && m.coverage !== 'verified'
  )
  const phaseRemainingEffort = pendingModules.reduce((s, m) => s + remainingEffort(m), 0)

  // Phase 1 has no cycles marked 'closed' yet (that lifecycle lands with the
  // pulse-day-closing trigger in a later task), so there is nothing to query
  // — priorCompletionRates stays empty, which correctly yields the
  // conservative pacing floor.
  const priorCompletionRates: number[] = []

  const weeklyEnvelope = computeWeeklyEnvelope({
    phaseRemainingEffort, usableWeeksRemainingInPhase: usableWeeksRemaining, priorCompletionRates,
  })

  const { data: repairRows } = await admin
    .from('repair_threads')
    .select('id, concept:curriculum_concepts(name)')
    .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled'])

  // A 'scheduled' thread is only truly covered while an unfinished task in an
  // active cycle carries it. Orphan tasks (cycle_id null, from before cycles)
  // stay in the database for audit but do not count, otherwise the weakness is
  // stranded: hidden from Calendar and never re-planned.
  const { data: activeCycle } = await admin.from('planning_cycles')
    .select('id').eq('user_id', userId).eq('status', 'active').maybeSingle()
  const covered = new Set<string>()
  // A cycle that is being closed no longer covers anything: its unfinished
  // repair work carries into the next week instead of hiding behind it.
  if (activeCycle && activeCycle.id !== opts.closingCycleId) {
    const { data: live } = await admin.from('plan_blocks').select('repair_thread_id, execution')
      .eq('user_id', userId).eq('cycle_id', activeCycle.id as string).not('repair_thread_id', 'is', null)
    for (const b of live ?? []) {
      if (b.execution !== 'completed' && b.execution !== 'skipped') covered.add(b.repair_thread_id as string)
    }
  }
  const repairs: RepairInput[] = (repairRows ?? []).filter(r => !covered.has(r.id as string)).map(r => ({
    id: r.id as string, title: `Repair: ${(r.concept as any)?.name ?? 'concept'}`, durationMinutes: 30,
  }))

  const { data: unstableRows } = await admin
    .from('evidence_events')
    .select('concept_id, concept:curriculum_concepts(name)')
    .eq('user_id', userId).eq('validity', 'valid').eq('evidence_state', 'unstable')
    .order('created_at', { ascending: false }).limit(10)
  const seen = new Set<string>()
  const unstableConcepts: UnstableInput[] = []
  for (const row of unstableRows ?? []) {
    const id = row.concept_id as string
    if (!id || seen.has(id)) continue
    seen.add(id)
    unstableConcepts.push({ conceptId: id, name: (row.concept as any)?.name ?? 'this concept' })
  }

  const minutesPerEffortUnit = active.input.observedMinutesPerEffortUnit ?? 85
  const remainingPool = [...pendingModules]
  const days: DayPlan[] = []
  let weekEffortBudget = weeklyEnvelope
  let repairsPlaced = false
  let unstablePlaced = false

  for (const date of week.days) {
    const weekday = weekdayOf(date)
    // Self-study is Monday–Saturday. Sunday is reserved for the weekly paper
    // (or an honest no-paper checkpoint when the item bank is insufficient).
    // Class-led weeks use their own class-defined boundary instead.
    if (!permitsStudyPortions(active.input.route, weekday)) {
      days.push({ date, weekday, portions: [] })
      continue
    }
    const capacity = await dailyCapacityMinutes(userId, weekday, date, week.timezone)
    const budgetedPool = weekEffortBudget > 0 ? remainingPool : []
    const day = allocateDay({
      capacityMinutes: capacity, minutesPerEffortUnit,
      // Keep offering repair/unstable work until it's actually placed — not
      // just on the literal first day of the week, which may have zero
      // capacity (a rest day) and would otherwise drop this priority-1 work
      // for the whole week.
      repairs: repairsPlaced ? [] : repairs,
      unstableConcepts: unstablePlaced ? [] : unstableConcepts,
      pendingModules: budgetedPool, phase,
    })
    day.date = date
    day.weekday = weekday

    if (day.portions.some(p => p.priorityLane === 'repair')) repairsPlaced = true
    if (day.portions.some(p => p.priorityLane === 'unstable')) unstablePlaced = true

    for (const p of day.portions) {
      if (p.priorityLane === 'content') {
        weekEffortBudget -= p.effortUnits
        const idx = remainingPool.findIndex(m => m.id === p.lmId)
        if (idx >= 0) remainingPool.splice(idx, 1)
      }
    }
    days.push(day)
  }

  // The weekly paper (Decisions §3). Scope is what this week actually places:
  // material not yet started is new (diagnostic); material the student has
  // already been exposed to is revisited (revisionary). Nothing is scheduled
  // unless the bank holds enough unseen, eligible items for that scope.
  const coverageById = new Map(active.input.modules.map(m => [m.id, m.coverage]))
  const placed = [...new Set(days.flatMap(d => d.portions).filter(p => p.priorityLane === 'content' && p.lmId).map(p => p.lmId as string))]
  const newModuleIds = placed.filter(id => coverageById.get(id) === 'not_started')
  const revisitedModuleIds = placed.filter(id => coverageById.get(id) !== 'not_started')
  const { plan: paper, manifestId } = await planWeeklyPaper(userId, { newModuleIds, revisitedModuleIds })

  const lastDay = days[days.length - 1]
  if (lastDay && paper.kind === 'paper' && manifestId) {
    const scope = toPersistedScope(paper, manifestId)
    const names = new Map(active.input.modules.map(m => [m.id, m.name]))
    const scopeNames = paper.sections.flatMap(sec => sec.moduleIds).map(id => names.get(id) ?? id)
    lastDay.portions.push({
      title: paperTitle(paper.purpose),
      detail: `Covers: ${scopeNames.join(', ')}. What it finds shapes next week's repair priorities.`,
      taskType: 'diagnostic',
      effortUnits: 0,
      durationMinutes: paper.estimatedMinutes,
      lmId: null,
      repairThreadId: null,
      priorityLane: 'content',
      assessmentScope: scope,
      rationale: paper.purpose === 'diagnostic'
        ? 'Closes the week: checks material you met for the first time this week.'
        : paper.purpose === 'revisionary'
          ? 'Closes the week: checks material you revisited this week.'
          : 'Closes the week: separate sections for new and revisited material.',
    })
  }

  return { days, paper }
}

/** The plan_blocks rows a generated week commits as (shared by every atomic writer). */
export async function buildCommitRows(_userId: string, week: StudyWeek, days: DayPlan[]) {
  const reviewTime = PAPER_START_TIME
  return days.flatMap(day => day.portions.map(p => commitRowFor(day.date, p, reviewTime, week.timezone)))
}

function commitRowFor(date: string, p: GeneratedPortion, reviewTime: string, timezone: string) {
  const day = { date }
  const week = { timezone }
  const isReview = p.taskType === 'diagnostic'
  return {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: p.title,
    detail: p.detail,
    task_type: p.taskType,
    origin: isReview ? 'diagnostic' : 'planner',
    priority: 'core', // Phase 1 doesn't yet differentiate optional work
    placement: isReview ? 'timed' : 'day_preferred',
    execution: 'not_started',
    local_date: day.date,
    day: day.date,
    starts_at: isReview ? zonedTimeToUtc(day.date, reviewTime, week.timezone).toISOString() : '',
    duration_minutes: p.durationMinutes,
    duration: String(p.durationMinutes),
    lm_id: p.lmId ?? '',
    repair_thread_id: p.repairThreadId ?? '',
    rationale: p.rationale
      ?? (p.priorityLane === 'repair' ? 'Open repair work, prioritised ahead of new content.'
      : p.priorityLane === 'unstable' ? 'Answered correctly last time but not confidently — worth re-verifying.'
      : `Part of this week's ${p.taskType} scope.`),
    assessment_scope: p.assessmentScope ?? null,
    created_by: 'algorithm',
  }
}

/** Writes a generated week as real plan_blocks rows in one pass (spec §3.1). */
export async function commitWeekPlan(
  userId: string, week: StudyWeek, days: DayPlan[]
): Promise<{ cycleId: string; taskIds: string[] }> {
  if (!days.some(d => d.portions.length > 0)) return { cycleId: '', taskIds: [] }
  const admin = createAdminClient()
  const rows = await buildCommitRows(userId, week, days)

  // Cycle creation and task insertion happen in one transaction (see the
  // migration's comment) so a rejected row — e.g. a duration_minutes check
  // constraint violation — can never leave an orphaned, empty "active" cycle
  // that permanently blocks this user's future generation via
  // planning_cycles_active_user_idx.
  const { data, error } = await admin.rpc('commit_pulse_week', {
    p_user_id: userId,
    p_starts_at_local: week.startDate,
    p_ends_at_local: week.endDate,
    p_timezone: week.timezone,
    p_rows: rows,
  })
  if (error || !data) throw new Error(`Could not commit the week: ${error?.message}`)

  return { cycleId: (data as { cycle_id: string }).cycle_id, taskIds: rows.map(r => r.id) }
}
