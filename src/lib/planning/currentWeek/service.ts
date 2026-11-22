import { createAdminClient } from '../../supabase/admin'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import { buildWeekPlanWithPaper, loadPlacementContext } from '../pulse/generateWeek'
import { weekForDate } from '../schedule'
import { cycleAcceptedBy } from '../cycleProvenance'
import { todayInZone, weekdayOf, type StudyWeek } from '../studyWeek'
import { getClassLogContext } from '../classlog/service'
import { toDraftTasks } from '../draftTasks'
import { ADD_STUDY_TIMES_HREF, deriveCurrentWeekPlanState, type CurrentWeekFacts, type CurrentWeekPlanState } from './state'

const PURPOSE = 'current_week_plan'

type Cycle = { id: string; starts_at_local: string; ends_at_local: string; timezone: string | null }

async function activeCycle(userId: string): Promise<Cycle | null> {
  const { data, error } = await createAdminClient().from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (error) throw new Error(`Could not read the cycle: ${error.message}`)
  return data as Cycle | null
}

/** The facts the state derives from. One place reads them, so Calendar, Home and both endpoints cannot disagree. */
export async function loadCurrentWeekFacts(userId: string, now = new Date()): Promise<{ facts: CurrentWeekFacts; cycle: Cycle | null; week: StudyWeek | null }> {
  const admin = createAdminClient()
  const cycle = await activeCycle(userId)
  const empty: CurrentWeekFacts = { hasCycle: false, cycleEnded: false, plannedTasks: 0, acceptedBy: null, planAccepted: false, availabilityMode: null, hasWindows: false, remaining: { minutes: 0, assessmentDayOnly: false, windowsLater: false }, draft: null, discardedFingerprint: null, currentHash: null }
  if (!cycle) return { facts: empty, cycle: null, week: null }
  const tz = cycle.timezone || 'UTC'
  const today = todayInZone(tz, now)

  const [blocks, profile, windows, drafts, hash, acceptedBy] = await Promise.all([
    admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('cycle_id', cycle.id).is('cancelled_at', null).is('learning_activity_id', null).neq('execution', 'cancelled'),
    admin.from('profiles').select('week_availability_mode,prep_mode,class_pattern,classes_completed_at').eq('id', userId).maybeSingle(),
    admin.from('availability_windows').select('weekday').eq('user_id', userId).eq('status', 'active'),
    admin.from('plan_drafts').select('id, revision, status, context_fingerprint, created_at').eq('user_id', userId).eq('purpose', PURPOSE).eq('cycle_id', cycle.id).order('created_at', { ascending: false }).limit(10),
    admin.rpc('current_week_source_hash', { p_user: userId, p_cycle: cycle.id }),
    cycleAcceptedBy(userId, cycle.id),
  ])
  for (const r of [blocks, profile, windows, drafts, hash]) if (r.error) throw new Error(`Could not read the week: ${r.error.message}`)

  const rows = (drafts.data ?? []) as { id: string; revision: number; status: string; context_fingerprint: string }[]
  const ready = rows.find(d => d.status === 'ready'), discarded = rows.find(d => d.status === 'discarded'), accepted = rows.find(d => d.status === 'accepted')
  let draftCurrent = true
  if (ready) {
    const validity = await admin.rpc('current_week_proposal_problem', { p_user: userId, p_draft: ready.id, p_now: now.toISOString() })
    if (validity.error) throw new Error('Could not check the saved proposal.')
    draftCurrent = validity.data === null
  }
  let classGuidance: CurrentWeekFacts['classGuidance']
  if (['instructor_led', 'self_paced_course'].includes(profile.data?.prep_mode ?? '') && profile.data?.class_pattern && profile.data.class_pattern !== 'none' && !profile.data?.classes_completed_at && (blocks.count ?? 0) === 0) {
    const covered = await admin.from('user_module_state').select('lm_id', { count: 'exact', head: true }).eq('user_id', userId).eq('coverage_state', 'studied')
    if (covered.error) throw new Error('Could not read your starting position.')
    if ((covered.count ?? 0) === 0) {
      const classes = await getClassLogContext(userId, now)
      const known = await admin.from('calendar_commitments').select('recurrence,ends_at,ends_on')
        .eq('user_id', userId).eq('status', 'active').eq('kind', 'class')
      if (known.error) throw new Error('Could not read your classes.')
      classGuidance = classes.classLed && classes.pendingDates.length > 0 ? 'log_class'
        : (known.data ?? []).some(c => c.recurrence === 'weekly' ? !c.ends_on || c.ends_on >= today : new Date(c.ends_at) > now) ? 'upcoming_class' : 'add_class'
    }
  }
  const cycleEnded = cycle.ends_at_local < today
  const week = await weekForDate(userId, cycle.starts_at_local)

  let remaining = { minutes: 0, assessmentDayOnly: false, windowsLater: false }
  if (!cycleEnded && (windows.data ?? []).length > 0) {
    const ctx = await loadPlacementContext(userId, week, now)
    const minutes = ctx.studyDates.reduce((n, d) => n + (ctx.capacity[d] ?? 0), 0)
    const left = week.days.filter(d => d >= today)
    const windowDays = new Set((windows.data ?? []).map(w => w.weekday as number))
    remaining = {
      minutes,
      assessmentDayOnly: minutes <= 0 && ctx.studyDates.length === 0 && left.length > 0 && left.every(d => weekdayOf(d) === 0),
      windowsLater: minutes <= 0 && !left.some(d => windowDays.has(weekdayOf(d))),
    }
  }
  const facts: CurrentWeekFacts = {
    hasCycle: true, cycleEnded, plannedTasks: blocks.count ?? 0, acceptedBy, planAccepted: !!accepted,
    availabilityMode: (profile.data?.week_availability_mode ?? null) as string | null, hasWindows: (windows.data ?? []).length > 0, remaining,
    draft: ready ? { id: ready.id, revision: ready.revision, fingerprint: ready.context_fingerprint, current: draftCurrent } : null,
    discardedFingerprint: discarded?.context_fingerprint ?? null, currentHash: hash.data as string, classGuidance,
  }
  return { facts, cycle, week }
}

export async function getCurrentWeekPlanState(userId: string, now = new Date()): Promise<CurrentWeekPlanState> {
  return deriveCurrentWeekPlanState((await loadCurrentWeekFacts(userId, now)).facts)
}

export type CurrentWeekProposal = {
  state: CurrentWeekPlanState
  draft: { draftId: string; revision: number; tasks: ReturnType<typeof toDraftTasks>['tasks']; paper: unknown; planningDate: string; cycle: { start: string; end: string } } | null
}

const inflight = new Map<string, Promise<CurrentWeekProposal>>()

/** Prepares (or reuses) the proposal for the existing cycle. Concurrent callers for the same source state share one build. */
export async function getOrCreateCurrentWeekProposal(userId: string, now = new Date()): Promise<CurrentWeekProposal> {
  const { facts, cycle } = await loadCurrentWeekFacts(userId, now)
  const state = deriveCurrentWeekPlanState(facts)
  const plannable = ['ready_to_plan', 'proposal_ready', 'proposal_stale', 'intentionally_empty'].includes(state.kind)
  if (!plannable || !cycle) return { state, draft: null }
  const key = `${userId}:${facts.currentHash}`
  const running = inflight.get(key)
  if (running) return running
  const job = build(userId, cycle, facts.currentHash!, now).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function build(userId: string, cycle: Cycle, hash: string, now: Date): Promise<CurrentWeekProposal> {
  const admin = createAdminClient()
  const tz = cycle.timezone || 'UTC', today = todayInZone(tz, now)
  const asProposal = (d: { id: string; revision: number; draft_json: any }) => ({
    state: deriveCurrentWeekPlanState({ ...EMPTY_READY, draft: { id: d.id, revision: d.revision, fingerprint: hash }, currentHash: hash }),
    draft: { draftId: d.id, revision: d.revision, tasks: tasksOf(d.draft_json), paper: d.draft_json?.paper ?? null, planningDate: d.draft_json?.planning_date ?? today, cycle: { start: cycle.starts_at_local, end: cycle.ends_at_local } },
  })
  const existing = await admin.from('plan_drafts').select('id, revision, draft_json').eq('user_id', userId).eq('purpose', PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready').eq('context_fingerprint', hash).maybeSingle()
  if (existing.error) throw new Error('Could not read the saved proposal.')
  if (existing.data) {
    const validity = await admin.rpc('current_week_proposal_problem', { p_user: userId, p_draft: existing.data.id, p_now: now.toISOString() })
    if (validity.error) throw new Error('Could not check the saved proposal.')
    if (validity.data === null) return asProposal(existing.data as any)
  }
  // Anything else still marked ready was built from a source state that no longer exists.
  await admin.from('plan_drafts').update({ status: 'superseded' }).eq('user_id', userId).eq('purpose', PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready')

  const week = await weekForDate(userId, cycle.starts_at_local)
  const version = ((await admin.from('profiles').select('onboarding_context_version').eq('id', userId).single()).data?.onboarding_context_version ?? 1) as number
  const roadmap = await getActiveRoadmap(userId)
  if (!roadmap) throw new Error('There is no roadmap to plan from.')
  // The hash was taken BEFORE planning: an edit that lands while this runs makes the draft stale at birth, and acceptance refuses it.
  const plan = await buildWeekPlanWithPaper(userId, week, { now })
  const { count: existingPaper } = await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('cycle_id', cycle.id).eq('task_type', 'diagnostic').is('cancelled_at', null)
  const days = plan.days
    .filter(d => d.date >= today && d.date >= cycle.starts_at_local && d.date <= cycle.ends_at_local)
    .map(d => ({ ...d, portions: d.portions.filter(p => !(p.taskType === 'diagnostic' && (existingPaper ?? 0) > 0)) }))
  const { tasks, draftTasks } = toDraftTasks(days, tz)
  if (tasks.length === 0) {
    const nothing: CurrentWeekPlanState = {
      kind: 'no_usable_windows', reason: 'nothing_to_add', draft: null, title: 'Nothing to add this week',
      message: 'Roadmap found no work to place in the time that remains. You can keep the week as it is.',
      action: { label: 'Edit study times', href: ADD_STUDY_TIMES_HREF, kind: 'link' },
    }
    return { state: nothing, draft: null }
  }
  const paper = { kind: plan.paper.kind, reason: plan.paper.kind === 'none' ? plan.paper.reason : null, purpose: plan.paper.kind === 'paper' ? plan.paper.purpose : null }
  const ins = await admin.from('plan_drafts').insert({
    user_id: userId, purpose: PURPOSE, status: 'ready', revision: 1, cycle_id: cycle.id, roadmap_id: roadmap.id,
    cycle_start_date: cycle.starts_at_local, cycle_end_date: cycle.ends_at_local, timezone: tz, onboarding_context_version: version, context_fingerprint: hash,
    draft_json: { tasks: draftTasks, paper, planning_date: today, receipt: null },
  }).select('id, revision, draft_json').single()
  if (ins.error) {
    if ((ins.error as any).code === '23505') { // a concurrent preview won the unique index: use its draft
      const won = await admin.from('plan_drafts').select('id, revision, draft_json').eq('user_id', userId).eq('purpose', PURPOSE).eq('cycle_id', cycle.id).eq('status', 'ready').eq('context_fingerprint', hash).maybeSingle()
      if (won.data) return asProposal(won.data as any)
    }
    throw new Error(`Could not save the proposal: ${ins.error.message}`)
  }
  const validity = await admin.rpc('current_week_proposal_problem', { p_user: userId, p_draft: ins.data.id, p_now: now.toISOString() })
  if (validity.error) throw new Error('Could not check the prepared proposal.')
  if (validity.data !== null) {
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('id', ins.data.id).eq('user_id', userId)
    return { state: deriveCurrentWeekPlanState({ ...EMPTY_READY, draft: { id: ins.data.id, revision: ins.data.revision, fingerprint: hash, current: false }, currentHash: hash }), draft: null }
  }
  return asProposal(ins.data as any)
}

const EMPTY_READY: CurrentWeekFacts = { hasCycle: true, cycleEnded: false, plannedTasks: 0, acceptedBy: null, planAccepted: false, availabilityMode: 'windows', hasWindows: true, remaining: { minutes: 1, assessmentDayOnly: false, windowsLater: false }, draft: null, discardedFingerprint: null, currentHash: null }

function tasksOf(json: any) {
  return ((json?.tasks ?? []) as any[]).map(t => ({
    id: t.id, title: t.title, duration: t.duration_minutes, duration_minutes: t.duration_minutes, detail: t.metadata?.detail ?? '', task_type: t.metadata?.task_type ?? 'study',
    local_date: t.scheduled_date, lm_id: t.metadata?.lm_id ?? null, repair_thread_id: t.metadata?.repair_thread_id ?? null, priority: t.metadata?.priority ?? 'core',
    placement: t.metadata?.placement ?? 'day_preferred', starts_at: t.metadata?.starts_at ?? null, origin: t.metadata?.origin ?? 'planner',
    assessment_scope: t.metadata?.assessment_scope ?? null, rationale: t.metadata?.rationale ?? '', learning_objective: t.metadata?.learning_objective ?? '',
    suggested_approach: t.metadata?.suggested_approach ?? '', completion_meaning: t.metadata?.completion_meaning ?? '',
  }))
}

