import { createAdminClient } from '../supabase/admin'
import { readCanonicalState } from './service'
import { loadRoadmapInputs } from '../curriculum/roadmapService'
import { buildRoadmap } from '../curriculum/roadmap'
import { buildWeekPlanWithPaper } from '../planning/pulse/generateWeek'
import { getStudyWeekContext } from '../planning/schedule'
import { zonedTimeToUtc, todayInZone } from '../planning/studyWeek'
import { toDraftTasks } from '../planning/draftTasks'
import { trace } from '../ops/trace'

export function draftFingerprint(contextVersion: number, weekStart: string, planningDate = weekStart) {
  return `onboarding_initial_week:p2:v${contextVersion}:${weekStart}:${planningDate}`
}

const contextVersionOf = async (userId: string) =>
  ((await createAdminClient().from('profiles').select('onboarding_context_version').eq('id', userId).maybeSingle()).data?.onboarding_context_version ?? 1) as number

/** `afterInputsRead` exists for the race test only: it runs between reading the planning inputs and labelling the draft. */
export async function generatePreview(userId: string, opts: { afterInputsRead?: () => Promise<void> } = {}) {
  const admin = createAdminClient()

  // 0. The version FIRST. Every input below is read at or after this version, so a setup edit made while the preview
  // is generated can only make the draft look older than the setup, never newer (which would let it be accepted).
  const contextVersion = await contextVersionOf(userId)
  const laps: Record<string, number> = {}; let t0 = Date.now()
  const lap = (name: string) => { const n = Date.now(); laps[name] = n - t0; t0 = n }

  // 1. Read canonical state
  const state = await readCanonicalState(userId)
  lap('state')

  // 2. Fetch inputs to build the roadmap
  const input = await loadRoadmapInputs(userId)
  if (!input) throw new Error('Cannot build roadmap: missing inputs')

  // 3. Generate Roadmap Sequence
  lap('roadmap_inputs')
  const roadmap = buildRoadmap(input)

  // 4. The cycle's dates must be the same pulse week buildWeekPlan (below)
  // builds tasks for — that week includes today and ends on the student's
  // derived pulse day, not an arbitrary tomorrow-plus-six span.
  const ctx = await getStudyWeekContext(userId)
  lap('roadmap_build_and_week_context')
  const cycleStartDate = ctx.week.startDate
  const cycleEndDate = ctx.week.endDate

  // 5. Persist the roadmap BEFORE calling buildWeekPlan, so getActiveRoadmap can find it
  const { data: tempRoadmap, error: roadmapError } = await admin.from('study_roadmaps').insert({
    user_id: userId,
    exam_window_id: state.profile?.exam_window_id ?? undefined,
    // The resolved target: the exact booked date, or the start of the chosen sitting for an unregistered candidate.
    target_date: input.targetDate,
    route: input.route,
    status: 'draft',
    phases: roadmap.phases,
    inputs: input,
    feasibility: roadmap.feasibility ?? {}
  }).select().single()

  if (roadmapError || !tempRoadmap) {
    throw new Error(`Failed to create roadmap: ${roadmapError?.message || 'Unknown error'}`)
  }

  // 6. Generate first week's tasks — the real Pulse engine (spec Phase A)
  // Now buildWeekPlan's internal getActiveRoadmap() can find the persisted roadmap. The paper decision is
  // kept (not discarded) so the review screen can explain an honest "no paper" rather than guess why.
  lap('roadmap_insert')
  const { days: dayPlans, paper } = await buildWeekPlanWithPaper(userId, ctx.week)
  lap('week_plan')

  // Names for whatever the paper decision names by id, so the review screen can explain a skipped module
  // by name rather than a bare id — the same reason a student would want, not the id an engineer would.
  const skippedIds = paper.skipped.map(s => s.moduleId)
  const { data: moduleNameRows } = skippedIds.length
    ? await admin.from('learning_modules').select('id, name').in('id', skippedIds)
    : { data: [] as { id: string; name: string }[] }
  const moduleNames = new Map((moduleNameRows ?? []).map(m => [m.id as string, m.name as string]))
  const paperSummary = {
    kind: paper.kind,
    reason: paper.kind === 'none' ? paper.reason : null,
    purpose: paper.kind === 'paper' ? paper.purpose : null,
    skipped: paper.skipped.map(s => ({ ...s, name: moduleNames.get(s.moduleId) ?? s.moduleId })),
  }

  await opts.afterInputsRead?.()
  const { tasks, draftTasks } = toDraftTasks(dayPlans, ctx.timezone)

  // 7. Store preview in plan_drafts
  const { data: draft, error } = await admin.from('plan_drafts').insert({
    user_id: userId,
    purpose: 'onboarding_initial_week',
    status: 'ready',
    revision: 1,
    roadmap_id: tempRoadmap.id,
    cycle_start_date: cycleStartDate,
    cycle_end_date: cycleEndDate,
    timezone: ctx.timezone,
    // What this draft was built from: the same setup version and week always
    // resolve to the same draft, which is what makes recovery idempotent.
    onboarding_context_version: contextVersion,
    context_fingerprint: draftFingerprint(contextVersion, cycleStartDate, ctx.today),
    draft_json: {
      tasks: draftTasks,
      paper: paperSummary
    }
  }).select().single()

  if (error) {
    // Don't leave the draft roadmap created above orphaned when the draft itself is rejected.
    await admin.from('study_roadmaps').update({ status: 'superseded' }).eq('id', tempRoadmap.id).eq('status', 'draft')
    throw Object.assign(new Error(`Draft generation failed: ${error.message}`), { code: (error as any).code as string | undefined })
  }

  lap('draft_insert')
  trace('onboarding', 'preview_built', { ms: laps, tasks: tasks.length })
  // An edit that landed while this was generated makes the draft stale at birth: retire it now rather than offer it.
  if (await contextVersionOf(userId) !== contextVersion) {
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('id', draft.id).eq('status', 'ready')
    await admin.from('study_roadmaps').update({ status: 'superseded' }).eq('id', tempRoadmap.id).eq('status', 'draft')
    throw Object.assign(new Error('Your setup changed while the preview was prepared.'), { code: 'CONTEXT_CHANGED' })
  }
  return { draftId: draft.id, tasks, revision: draft.revision, paper: paperSummary }
}

import { createClient } from '../supabase/server'

export async function confirmPreview(userId: string, draftId: string, expectedRevision: number) {
  const supabase = await createClient()
  const [draft, profile] = await Promise.all([
    supabase.from('plan_drafts').select('status,context_fingerprint,onboarding_context_version,cycle_start_date,timezone').eq('id', draftId).eq('user_id', userId).maybeSingle().throwOnError(),
    supabase.from('profiles').select('onboarding_context_version').eq('id', userId).maybeSingle().throwOnError(),
  ])
  if (draft.data?.status === 'ready') {
    // The cycle a preview names is part of what the student agreed to. If the shared first-cycle decision now
    // lands elsewhere (availability, classes or the clock moved on), the preview is stale rather than silently moved.
    const now = await getStudyWeekContext(userId)
    if (now.week.startDate !== draft.data.cycle_start_date) {
      throw Object.assign(new Error('Your preview is out of date. Reopen the review to prepare a current plan.'), { code: 'STALE_PREVIEW' })
    }
    const expected = draftFingerprint(profile.data?.onboarding_context_version ?? 1, draft.data.cycle_start_date,
      todayInZone(draft.data.timezone ?? 'UTC'))
    if (draft.data.context_fingerprint !== expected) {
      throw Object.assign(new Error('Your preview is out of date. Reopen the review to prepare a current plan.'), { code: 'STALE_PREVIEW' })
    }
  }
  const { data, error } = await supabase.rpc('accept_onboarding_preview', {
    p_draft_id: draftId,
    p_expected_revision: expectedRevision
  })
  
  if (error) {
    if (error.message?.includes('STALE_PREVIEW')) throw Object.assign(new Error('Your setup changed after this preview was prepared. Rebuild the preview to continue.'), { code: 'STALE_PREVIEW' })
    throw error
  }
  return data as { roadmap_id: string | null; cycle_id: string }
}
