const COVERAGE_WEIGHT = 0.6
const DIAGNOSTIC_WEIGHT = 0.4

/**
 * Home's readiness number: coverage weighted 60%, diagnostic accuracy 40%.
 *
 * Coverage dominates early on, when a student has taken zero or one
 * diagnostics and a raw average would otherwise swing wildly. With no scored
 * diagnostics yet, readiness is coverage alone — there is nothing to blend.
 *
 * Deliberately not framed as "pass probability" anywhere this is displayed:
 * it is a study heuristic, not a claim about the exam.
 */
export function computeReadiness(coveragePercent: number, diagnosticAverage: number | null): number {
  const coverage = clamp(coveragePercent)
  if (diagnosticAverage === null) return Math.round(coverage)
  const diagnostic = clamp(diagnosticAverage)
  return Math.round(coverage * COVERAGE_WEIGHT + diagnostic * DIAGNOSTIC_WEIGHT)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value))
}
