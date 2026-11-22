export type CoverageState = 'not_covered' | 'partly_covered' | 'covered'
export type ReadingCoverageSummary = { total: number; covered: number; partial: number }

type TrackedReading = {
  coverage: string
  tracked: boolean
  learning: { recordedSittings: number; confirmedOutcomes: number }
  rows: { classCoverage?: string }[]
}

/** Recorded reading coverage is shared by Home and Curriculum. */
export function coverageOf(m: TrackedReading): CoverageState {
  if (m.coverage === 'studied' || m.coverage === 'verified' || m.coverage === 'decaying') return 'covered'
  if (m.tracked && m.rows.length > 0 && m.learning.confirmedOutcomes >= m.rows.length) return 'covered'
  if (m.coverage === 'taught') return m.rows.length > 0 && m.rows.every(r => r.classCoverage === 'full') ? 'covered' : 'partly_covered'
  return m.learning.recordedSittings > 0 || m.learning.confirmedOutcomes > 0 ? 'partly_covered' : 'not_covered'
}

export function readingCoverageSummary(readings: TrackedReading[]): ReadingCoverageSummary {
  const tracked = readings.filter(r => r.tracked)
  const states = tracked.map(coverageOf)
  return { total: tracked.length, covered: states.filter(state => state === 'covered').length, partial: states.filter(state => state === 'partly_covered').length }
}
