
/** Depth rule shared by the audit and the capacity report. Counting lives in capacityReport.ts (the one canonical reader). */
/** Minimum viable coverage before raw volume matters: approved items per examinable outcome. */
export const MIN_VIABLE_PER_OUTCOME = 3
/** Outcomes with fewer than MIN_VIABLE_PER_OUTCOME INDEPENDENT families. Three variants of one family are one family; an unknown family is not counted as independent. */
export function shallowOutcomes(outcomes: string[], familiesByOutcome: Map<string, Set<string>>, min = MIN_VIABLE_PER_OUTCOME): string[] {
  return outcomes.filter(o => (familiesByOutcome.get(o)?.size ?? 0) < min)
}
