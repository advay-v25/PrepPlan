/**
 * LOS readiness tracker — the pure classification behind the Curriculum page's
 * per-learning-outcome view.
 *
 * Bands follow the student's own working method:
 *   maintain — demonstrated: repeatedly correct, nothing adverse
 *   verify   — isolated uncertainty, or too little evidence to call it secure
 *   repair   — recurring error or an explicit weakness
 *   untested — no valid evidence yet (never presented as "maintain")
 *
 * Guessed-correct and slow-refreshed answers do not count as mastery: a
 * correct answer given with low confidence is a confidence mismatch, which
 * keeps a row at "verify" no matter how many were right.
 *
 * Nothing here reads the database, and nothing here is a prediction of the
 * exam result — it classifies what the student has demonstrated.
 */

export type LosBand = 'repair' | 'verify' | 'maintain' | 'untested'
export type EvidenceStateLike = 'insufficient' | 'needs_repair' | 'unstable' | 'supported' | 'disputed'
export type LosProgress = 'not_started' | 'scheduled' | 'in_progress' | 'retest_due' | 'complete'

/** Evidence older than this is treated as needing a fresh look. */
export const STALE_AFTER_DAYS = 21
/** Minimum valid observations before "supported" may read as demonstrated. */
export const MIN_SAMPLE_FOR_MAINTAIN = 2

export type LosEvidenceInput = {
  state: EvidenceStateLike
  validSampleSize: number
  confidenceMismatch: boolean
  latestAt: string | null
  hasOpenRepair: boolean
  repairOccurrences: number
}

export type BandResult = {
  band: LosBand
  /** Plain-language reason, shown beside the row. */
  rationale: string
}

export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

export function classifyLos(evidence: LosEvidenceInput | null, now: Date): BandResult {
  if (!evidence || evidence.validSampleSize === 0 || evidence.state === 'insufficient') {
    return { band: 'untested', rationale: 'No valid diagnostic evidence yet — not enough to classify.' }
  }

  if (evidence.state === 'needs_repair' || evidence.hasOpenRepair) {
    const recurring = evidence.repairOccurrences > 1
    return {
      band: 'repair',
      rationale: recurring
        ? 'Recurring error across diagnostics.'
        : 'A diagnostic answer here was wrong — an explicit gap to close.',
    }
  }

  if (evidence.state === 'disputed') {
    return { band: 'verify', rationale: 'An answer here is under challenge; re-check it once the challenge is resolved.' }
  }

  if (evidence.state === 'unstable' || evidence.confidenceMismatch) {
    return {
      band: 'verify',
      rationale: evidence.confidenceMismatch
        ? 'Confidence and accuracy disagreed (a right answer you were unsure of, or a wrong one you were sure of). Guessed-correct does not count as mastery.'
        : 'Correct, but not confidently — isolated uncertainty.',
    }
  }

  const age = daysSince(evidence.latestAt, now)
  if (age !== null && age > STALE_AFTER_DAYS) {
    return { band: 'verify', rationale: `Last checked ${age} days ago — worth a fresh look before relying on it.` }
  }

  if (evidence.validSampleSize < MIN_SAMPLE_FOR_MAINTAIN) {
    return { band: 'verify', rationale: 'Correct so far, but only one observation — too little to call it secure.' }
  }

  return { band: 'maintain', rationale: 'Repeatedly correct with no adverse signal; retain through spaced mixed practice.' }
}

/** What to do, and what proves it — the student's own method, per band. */
export const BAND_METHOD: Record<Exclude<LosBand, 'untested'>, {
  howToImprove: (concept: string) => string
  proof: string
  questionRange: string
}> = {
  repair: {
    howToImprove: c => `Relearn the rule, write a one-page error note, then work 12–15 fresh questions on: ${c}.`,
    proof: '≥90% on 12 fresh questions with no guessed-correct answers, and ≥90% on a differently worded next-day retest.',
    questionRange: '12–15 fresh questions + next-day retest',
  },
  verify: {
    howToImprove: c => `Closed-book recall first, then 6–8 fresh questions; explain why every wrong option fails. Focus: ${c}.`,
    proof: '≥85% on 6–8 fresh questions with correct reasoning and no formula or convention lookup.',
    questionRange: '6–8 fresh questions',
  },
  maintain: {
    howToImprove: c => `3–5 mixed questions and a 60-second closed-book summary. Key recall: ${c}.`,
    proof: '≥90% on maintenance questions with immediate recall; move to Verify if slow or guessed.',
    questionRange: '3–5 mixed questions',
  },
}

export type ProgressInput = {
  band: LosBand
  hasOpenRepair: boolean
  /** A planned task exists for this row and is not yet done. */
  hasScheduledWork: boolean
  /** Work was done (a linked task completed) since the last evidence. */
  workCompleted: boolean
  nextRecheckDueAt: string | null
}

/** Progress of the *improvement*, never of understanding: work done is not evidence. */
export function deriveProgress(i: ProgressInput, now: Date): LosProgress {
  if (i.band === 'maintain') return 'complete'
  // An untested outcome can still be scheduled or worked (e.g. class consolidation):
  // that is progress on the *work*, and the band stays Untested until a test moves it.
  if (i.band === 'untested') return i.workCompleted ? 'in_progress' : i.hasScheduledWork ? 'scheduled' : 'not_started'
  if (i.workCompleted) {
    if (i.nextRecheckDueAt && new Date(i.nextRecheckDueAt).getTime() <= now.getTime()) return 'retest_due'
    return 'in_progress'
  }
  if (i.hasScheduledWork) return 'scheduled'
  return 'not_started'
}

export type ClassCoverage = 'none' | 'part' | 'full'

export type ManualOverride = { band: LosBand; reason: string; at: string }

export type TrackerRow = {
  /** The 2027 learning outcome this row is about (reading_los.id). */
  outcomeId: string
  readingId: string
  classCoverage: ClassCoverage
  /** How the evidence reads (concept miss, guess, ...) and the student's own mark checked against it. */
  verdict: import('./confidence').ObsVerdict | 'none'
  selfMark: import('./confidence').SelfMark | null
  markCheck: import('./confidence').MarkCheck
  needsRevision: boolean
  /** A manual change by the student. Display only: it never alters the evidence band or the counts. */
  override: ManualOverride | null
  los: string
  name: string
  importance: string
  scopeNote: string | null
  band: LosBand
  rationale: string
  progress: LosProgress
  sample: number
  lastCheckedAt: string | null
  confidenceMismatch: boolean
  howToImprove: string | null
  proof: string | null
  questionRange: string | null
}

export type BandCounts = Record<LosBand, number> & { total: number }

export function countBands(rows: { band: LosBand }[]): BandCounts {
  const c: BandCounts = { repair: 0, verify: 0, maintain: 0, untested: 0, total: rows.length }
  for (const r of rows) c[r.band]++
  return c
}

const BAND_ORDER: Record<LosBand, number> = { repair: 0, verify: 1, untested: 2, maintain: 3 }
const IMPORTANCE_ORDER: Record<string, number> = { core: 0, supporting: 1 }

/** Repair first, then Verify — the "complete every Repair row before broad rereading" rule. */
export function sortForStudy<T extends { band: LosBand; importance: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
    (IMPORTANCE_ORDER[a.importance] ?? 2) - (IMPORTANCE_ORDER[b.importance] ?? 2))
}
