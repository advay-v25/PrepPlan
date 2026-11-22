import type { DayPlan } from './pulse/generateWeek'
import { zonedTimeToUtc } from './studyWeek'
import { PAPER_START_TIME } from './pulse/paper'
import { siblingLink } from './pulse/generateWeek'

/**
 * One mapping from the planner's portions to a draft's tasks, shared by the first-week preview and the current-week proposal so a task
 * looks, is stored and is accepted the same way whichever flow prepared it.
 */
export function toDraftTasks(dayPlans: DayPlan[], timezone: string) {
  const links: { group: string; after: string }[] = []
  const tasks = dayPlans.flatMap(day => { const ids = day.portions.map(p => ({ p, id: crypto.randomUUID() })); return day.portions.map((p, i) => {
    const l = siblingLink(p, ids); links.push({ group: l.group_key, after: l.after[0] ?? '' })
    const isReview = p.taskType === 'diagnostic'
    const timedReview = isReview && !p.dayPreferred // the weekly paper needs a real clock time (spec §6); everything else stays day-preferred
    return {
      id: ids[i].id, title: p.title, duration: p.durationMinutes, duration_minutes: p.durationMinutes, detail: p.detail,
      task_type: p.taskType, local_date: day.date, lm_id: p.lmId, repair_thread_id: p.repairThreadId, priority: 'core',
      placement: timedReview ? 'timed' : 'day_preferred',
      starts_at: timedReview ? zonedTimeToUtc(day.date, PAPER_START_TIME, timezone).toISOString() : null,
      origin: isReview ? 'diagnostic' : 'planner', assessment_scope: p.assessmentScope ?? null, rationale: p.rationale ?? '',
      learning_objective: p.learningObjective ?? '', suggested_approach: p.suggestedApproach ?? '', completion_meaning: p.completionMeaning ?? '',
    }
  }) })
  const draftTasks = tasks.map((t, i) => ({
    id: t.id, title: t.title, purpose: 'learning', scheduled_date: t.local_date, duration_minutes: t.duration_minutes, is_floating: false,
    metadata: {
      detail: t.detail, task_type: t.task_type, lm_id: t.lm_id, repair_thread_id: t.repair_thread_id, priority: t.priority, placement: t.placement,
      starts_at: t.starts_at, origin: t.origin, assessment_scope: t.assessment_scope, rationale: t.rationale, learning_objective: t.learning_objective,
      suggested_approach: t.suggested_approach, completion_meaning: t.completion_meaning, split_group: links[i].group, split_after: links[i].after,
    },
  }))
  return { tasks, draftTasks }
}
