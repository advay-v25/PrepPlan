export type CycleOutcome = { plannedEffort: number; actualEffort: number }

export function completionRateOf(outcome: CycleOutcome): number {
  if (outcome.plannedEffort <= 0) return 0
  return Math.min(1, outcome.actualEffort / outcome.plannedEffort)
}

/**
 * Bounded adjustment on the even split below — read from a rolling window
 * of the last 3 closed weeks where available, not just the immediately
 * prior one, so one unusual week can't swing the number alone (spec §2).
 */
export function pacingFactor(rollingCompletionRates: number[]): number {
  if (rollingCompletionRates.length < 2) return 0.6
  const window = rollingCompletionRates.slice(-3)
  const avg = window.reduce((s, r) => s + r, 0) / window.length
  if (avg >= 0.9) return 1.15
  if (avg >= 0.6) return 1.0
  if (avg >= 0.3) return 0.75
  return 0.6
}

/**
 * The corrected formula (spec §2): divide what's left across the weeks
 * actually left in the phase first, then apply pacing as a bounded
 * adjustment on that even split — never multiply the whole remaining
 * effort by a factor directly, which sizes one week as if it might absorb
 * the entire remaining phase.
 */
export function computeWeeklyEnvelope(input: {
  phaseRemainingEffort: number
  usableWeeksRemainingInPhase: number
  priorCompletionRates: number[]
}): number {
  const evenSplit = input.phaseRemainingEffort / Math.max(1, input.usableWeeksRemainingInPhase)
  return evenSplit * pacingFactor(input.priorCompletionRates)
}
