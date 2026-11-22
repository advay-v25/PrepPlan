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

import { todayInZone } from '../planning/studyWeek'
import { dueDateOf } from '../repairs/recheckDate'

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
  // An unresolved repair is an obligation whatever its lifecycle state; with no recorded observation it still reads "Repair", but the sample stays 0.
  if (evidence?.hasOpenRepair && evidence.validSampleSize === 0) return { band: 'repair', rationale: 'A repair is open for this outcome. No valid observation of it is recorded in this view yet.' }
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
/**
 * What to do for a band, and what counts. Practice suggestions here are SUGGESTIONS: they never state a pass mark or a fixed question count, because what
 * closes a repair is the assessment policy (a fresh, eligible check that comes out supported, at the time Roadmap schedules it) and how many fresh
 * questions exist depends on the bank. Observed facts are shown separately from these suggestions.
 */
export const BAND_METHOD: Record<Exclude<LosBand, 'untested'>, {
  howToImprove: (concept: string) => string
  proof: string
  questionRange: string
}> = {
  repair: {
    howToImprove: c => `Relearn the rule, write the error in your own words, then practise it before the scheduled check. Focus: ${c}.`,
    proof: 'A repair closes when a fresh, eligible check on this outcome comes out supported. Roadmap schedules that check; practising or writing a note does not close it.',
    questionRange: 'A fresh check when one is due and questions are available',
  },
  verify: {
    howToImprove: c => `Try closed-book recall first, then check yourself with fresh questions when available. Focus: ${c}.`,
    proof: 'Confirmed by repeated correct, confident answers on fresh questions over time. One right answer is not enough.',
    questionRange: 'A short fresh set when available',
  },
  maintain: {
    howToImprove: c => `Keep it warm with a few mixed questions and a short closed-book summary. Key recall: ${c}.`,
    proof: 'Stays here while fresh answers remain correct and confident; it moves back to Verify if they are slow, unsure or wrong.',
    questionRange: 'A few mixed questions',
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
export function deriveProgress(i: ProgressInput, now: Date, timezone = 'UTC'): LosProgress {
  if (i.band === 'maintain') return 'complete'
  // An untested outcome can still be scheduled or worked (e.g. class consolidation):
  // that is progress on the *work*, and the band stays Untested until a test moves it.
  if (i.band === 'untested') return i.workCompleted ? 'in_progress' : i.hasScheduledWork ? 'scheduled' : 'not_started'
  if (i.workCompleted) {
    if (i.nextRecheckDueAt && dueDateOf(i.nextRecheckDueAt)! <= todayInZone(timezone, now)) return 'retest_due'   // a calendar date in the student's zone, the same rule the re-check start uses
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
  classReports?: { sessionId: string; label: string; date: string; extent: ClassCoverage }[]
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
