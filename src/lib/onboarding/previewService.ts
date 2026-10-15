import { createAdminClient } from '../supabase/admin'
import { readCanonicalState } from './service'
import { loadRoadmapInputs } from '../curriculum/roadmapService'
import { buildRoadmap } from '../curriculum/roadmap'
import { buildWeekPlanWithPaper } from '../planning/pulse/generateWeek'
import { getStudyWeekContext } from '../planning/schedule'
import { zonedTimeToUtc } from '../planning/studyWeek'
import { PAPER_START_TIME } from '../planning/pulse/paper'

export function draftFingerprint(contextVersion: number, weekStart: string) {
  return `onboarding_initial_week:v${contextVersion}:${weekStart}`
}

export async function generatePreview(userId: string) {
  const admin = createAdminClient()

  // 1. Read canonical state
  const state = await readCanonicalState(userId)

  // 2. Fetch inputs to build the roadmap
  const input = await loadRoadmapInputs(userId)
  if (!input) throw new Error('Cannot build roadmap: missing inputs')

  // 3. Generate Roadmap Sequence
  const roadmap = buildRoadmap(input)

  // 4. The cycle's dates must be the same pulse week buildWeekPlan (below)
  // builds tasks for — that week includes today and ends on the student's
  // derived pulse day, not an arbitrary tomorrow-plus-six span.
  const ctx = await getStudyWeekContext(userId)
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
  const { days: dayPlans, paper } = await buildWeekPlanWithPaper(userId, ctx.week)

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

  const { data: profileRow } = await admin.from('profiles').select('reminder_at, onboarding_context_version').eq('id', userId).maybeSingle()
  const contextVersion = (profileRow?.onboarding_context_version ?? 1) as number
  const reviewTime = PAPER_START_TIME // the weekly paper is always a morning sitting

  const tasks = dayPlans.flatMap(day => day.portions.map(p => {
    const isReview = p.taskType === 'diagnostic'
    return {
      id: crypto.randomUUID(),
      title: p.title,
      duration: p.durationMinutes,
      duration_minutes: p.durationMinutes,
      detail: p.detail,
      task_type: p.taskType,
      local_date: day.date,
      lm_id: p.lmId,
      repair_thread_id: p.repairThreadId,
      priority: 'core',
      // The weekly cumulative review needs a real clock time (spec §6);
      // everything else stays day-preferred, matching commitWeekPlan.
      placement: isReview ? 'timed' : 'day_preferred',
      starts_at: isReview ? zonedTimeToUtc(day.date, reviewTime, ctx.timezone).toISOString() : null,
      origin: isReview ? 'diagnostic' : 'planner',
      assessment_scope: p.assessmentScope ?? null,
      rationale: p.rationale ?? '',
    }
  }))

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
    context_fingerprint: draftFingerprint(contextVersion, cycleStartDate),
    draft_json: {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        purpose: 'learning',
        scheduled_date: t.local_date,
        duration_minutes: t.duration_minutes,
        is_floating: false,
        metadata: {
          detail: t.detail,
          task_type: t.task_type,
          lm_id: t.lm_id,
          repair_thread_id: t.repair_thread_id,
          priority: t.priority,
          placement: t.placement,
          starts_at: t.starts_at,
          origin: t.origin,
          assessment_scope: t.assessment_scope,
          rationale: t.rationale
        }
      })),
      paper: paperSummary
    }
  }).select().single()

  if (error) {
    // Don't leave the draft roadmap created above orphaned when the draft itself is rejected.
    await admin.from('study_roadmaps').update({ status: 'superseded' }).eq('id', tempRoadmap.id).eq('status', 'draft')
    throw Object.assign(new Error(`Draft generation failed: ${error.message}`), { code: (error as any).code as string | undefined })
  }

  return { draftId: draft.id, tasks, revision: draft.revision, paper: paperSummary }
}

import { createClient } from '../supabase/server'

export async function confirmPreview(userId: string, draftId: string, expectedRevision: number) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('accept_onboarding_preview', {
    p_draft_id: draftId,
    p_expected_revision: expectedRevision
  })
  
  if (error) throw error
  return data
}
