/** Explicit study activity is independent of diagnostic understanding. No coverage is guessed from a reading title. */
export type StudyActivityBlock = {
  id: string; outcome_id: string | null; lm_id: string | null; execution: string; task_type: string
  cancelled_at: string | null; local_date: string | null; cycle_id: string | null
  title: string; revision: number; scope_group_id: string | null
  learning_activity_id?: string | null
  activityKind?: string | null
}
/** Where an activity's date comes from: a study date the student gave when logging, or the moment completion was recorded. */
export type ActivityDateKind = 'study_date' | 'recorded'
export type ActivityObservation = { blockId: string; outcomeId: string; at: string | null; atKind?: ActivityDateKind | null }
export const STUDY_TYPES = new Set(['study', 'review', 'class_consolidation', 'verification'])

export function confirmedActivity(
  blocks: StudyActivityBlock[], confirmations: Map<string, string[]>,
  outcomes: Map<string, string>, pendingGroups: Set<string>, completedAt: Map<string, string>, completedKind?: Map<string, ActivityDateKind>,
): ActivityObservation[] {
  const observations: ActivityObservation[] = []
  for (const b of blocks) {
    if (b.cancelled_at || !STUDY_TYPES.has(b.task_type) || !['completed', 'partial'].includes(b.execution)) continue
    const explicit = confirmations.get(b.id) ?? []
    const fullDirect = b.execution === 'completed' && b.outcome_id && (!b.scope_group_id || !pendingGroups.has(b.scope_group_id))
    const ids = fullDirect ? [b.outcome_id!] : explicit
    for (const id of new Set(ids)) {
      const reading = outcomes.get(id)
      if (!reading || (b.outcome_id ? b.outcome_id !== id : reading !== b.lm_id)) continue
      observations.push({ blockId: b.id, outcomeId: id, at: completedAt.get(b.id) ?? null, atKind: completedAt.has(b.id) ? completedKind?.get(b.id) ?? 'recorded' : null })
    }
  }
  return observations
}
