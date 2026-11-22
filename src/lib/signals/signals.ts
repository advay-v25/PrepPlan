/**
 * The four preparation signals (pure). One versioned calculation, shared by Tests, Calendar,
 * Curriculum, Home and Coach. They are deliberately NOT collapsed into one number:
 *
 *   position       — where the student is in the curriculum (exposure, not understanding)
 *   understanding  — what valid test evidence demonstrates (sample, independence, recency, integrity)
 *   execution      — what happened to planned work (done, partial, postponed, skipped, unknown)
 *   calibration    — whether confidence tracks accuracy
 *
 * Founder rules encoded here:
 *  - a completed block improves execution and makes scope eligible for a test; it never improves understanding;
 *  - a postponed block raises plan pressure and carries scope forward; it is not a wrong answer;
 *  - a scored, valid paper moves understanding; a voided question reverses its evidence;
 *  - the headline band needs several scopes, more than one paper, recent evidence and no critical integrity warning.
 */

import type { ReadingCoverageSummary } from '../curriculum/readingCoverage'
import { daysBetween, todayInZone } from '../planning/studyWeek'

export function evidenceAgeInDays(iso: string | null, today: string, timezone = 'UTC') {
  return iso ? Math.max(0, daysBetween(todayInZone(timezone, new Date(iso)), today)) : null
}

export const SIGNALS_VERSION = 1
export const RECENT_DAYS = 21
export const BAND_MIN_READINGS = 2
export const BAND_MIN_PAPERS = 2

export type OutcomeState = { outcomeId: string; readingId: string; subjectId: string; exposed: boolean; /** Whole-outcome coverage the scope engine accepts. */ whole?: boolean; /** Only part covered (or unresolved); never also whole. */ partial?: boolean; scheduled: boolean; tested: boolean; verified: boolean }
export type BlockRow = { id: string; execution: string; taskType: string; minutes: number; localDate: string | null; title: string }
export type EvidenceStats = {
  validEvents: number; voidedEvents: number; disputedEvents: number
  scoredPapers: number; readingsTested: number; subjectsTested: number; latestEvidenceAt: string | null
  /** The most recent scored paper that counted as evidence; Home links its summary to this result. */
  latestAttemptId?: string | null
  high: { n: number; correct: number }; low: { n: number; correct: number }; medium: { n: number; correct: number }
  overconfidentOutcomes: number; underconfidentOutcomes: number; markedOutcomes: number
}
export type MovementEvent = { date: string; kind: 'paper_scored' | 'evidence_voided' | 'block_completed' | 'block_postponed' | 'block_skipped'; text: string }

export type Signals = {
  version: number
  position: { total: number; notStarted: number; scheduled: number; exposed: number; /** Outcomes whose WHOLE coverage is explicitly established. exposed = whole + partial. */ whole: number; /** Outcomes only partly covered. */ partial: number; tested: number; verified: number; readingsExposed: number
    /** Reading-level coverage, kept apart from outcome exposure: what the student REPORTS having covered (setup or Settings) is not logged activity or evidence. */
    readings: ReadingCoverageSummary }
  understanding: {
    band: 'Insufficient evidence' | 'Building' | 'Developing' | 'Stable'
    reasons: string[]
    validEvents: number; scoredPapers: number; readingsTested: number; subjectsTested: number
    latestEvidenceAt: string | null; latestAttemptId: string | null; recent: boolean; verifiedShareOfTested: number | null
    integrityWarning: string | null
  }
  execution: {
    completed: number; partial: number; postponed: number; skipped: number; unreported: number; total: number
    completedMinutes: number; postponedMinutes: number; pressure: 'none' | 'building' | 'high'
  }
  calibration: {
    sureAccuracy: number | null; guessAccuracy: number | null
    /** The denominator of sureAccuracy: answers marked "sure". Five marked answers can contain only one. */
    sureSample: number
    confidentWrong: number; guessedRight: number; overconfidentOutcomes: number; underconfidentOutcomes: number; sample: number
    reading: string
  }
  movement: MovementEvent[]
}

const pct = (a: number, b: number) => (b ? a / b : null)

export function computeSignals(input: { outcomes: OutcomeState[]; blocks: BlockRow[]; evidence: EvidenceStats; movement: MovementEvent[]; today: string; timezone?: string; readings?: ReadingCoverageSummary }): Signals {
  const { outcomes, blocks, evidence: e } = input

  const position = {
    total: outcomes.length,
    notStarted: outcomes.filter(o => !o.exposed && !o.scheduled && !o.tested).length,
    scheduled: outcomes.filter(o => o.scheduled && !o.exposed && !o.tested).length,
    exposed: outcomes.filter(o => o.exposed).length,
    whole: outcomes.filter(o => o.whole).length,
    partial: outcomes.filter(o => o.partial && !o.whole).length,
    tested: outcomes.filter(o => o.tested).length,
    verified: outcomes.filter(o => o.verified).length,
    readingsExposed: new Set(outcomes.filter(o => o.exposed).map(o => o.readingId)).size,
    readings: input.readings ?? { total: 0, covered: 0, partial: 0 },
  }

  // Execution: unreported = due (past) and not marked anything.
  const learning = blocks.filter(b => !['diagnostic', 'admin'].includes(b.taskType))
  const count = (f: (b: BlockRow) => boolean) => learning.filter(f).length
  const mins = (f: (b: BlockRow) => boolean) => learning.filter(f).reduce((s, b) => s + b.minutes, 0)
  const unreportedRow = (b: BlockRow) => ['not_started', 'in_progress'].includes(b.execution) && !!b.localDate && b.localDate < input.today
  const execution = {
    completed: count(b => b.execution === 'completed'), partial: count(b => b.execution === 'partial'), postponed: count(b => b.execution === 'deferred'),
    skipped: count(b => b.execution === 'skipped'), unreported: count(unreportedRow), total: learning.length,
    completedMinutes: mins(b => b.execution === 'completed'), postponedMinutes: mins(b => b.execution === 'deferred'),
    pressure: 'none' as 'none' | 'building' | 'high',
  }
  const slipped = execution.postponed + execution.skipped + execution.unreported
  execution.pressure = learning.length === 0 ? 'none' : slipped / learning.length >= 0.4 ? 'high' : slipped > 0 ? 'building' : 'none'

  // Understanding: only test evidence counts. Blocks and self-reports are absent from this calculation by construction.
  const daysSince = evidenceAgeInDays(e.latestEvidenceAt, input.today, input.timezone)
  const recent = daysSince !== null && daysSince <= RECENT_DAYS
  const integrityWarning = e.validEvents > 0 && e.disputedEvents / (e.validEvents + e.disputedEvents) > 0.2 ? 'More than a fifth of the evidence is disputed, so no band is shown until it is resolved.' : null
  const verifiedShare = position.tested ? position.verified / position.tested : null
  const reasons: string[] = []
  if (e.readingsTested < BAND_MIN_READINGS) reasons.push(`Evidence covers ${e.readingsTested} reading${e.readingsTested === 1 ? '' : 's'}; at least ${BAND_MIN_READINGS} are needed.`)
  if (e.scoredPapers < BAND_MIN_PAPERS) reasons.push(`${e.scoredPapers} scored paper${e.scoredPapers === 1 ? '' : 's'}; at least ${BAND_MIN_PAPERS} are needed.`)
  if (!recent) reasons.push(e.latestEvidenceAt ? `The latest evidence is ${daysSince} days old; recent evidence (within ${RECENT_DAYS} days) is needed.` : 'There is no test evidence yet.')
  if (integrityWarning) reasons.push(integrityWarning)
  let band: Signals['understanding']['band'] = 'Insufficient evidence'
  if (reasons.length === 0) {
    band = verifiedShare !== null && verifiedShare >= 0.67 ? 'Stable' : verifiedShare !== null && verifiedShare >= 0.34 ? 'Developing' : 'Building'
    reasons.push(`${position.verified} of ${position.tested} tested outcomes are verified (repeated, confident, correct) across ${e.readingsTested} readings and ${e.scoredPapers} papers.`)
  }

  const cal = e.high.n + e.low.n + e.medium.n
  const confidentWrong = e.high.n - e.high.correct, guessedRight = e.low.correct
  const calibration = {
    sureAccuracy: pct(e.high.correct, e.high.n), sureSample: e.high.n, guessAccuracy: pct(e.low.correct, e.low.n), confidentWrong, guessedRight,
    overconfidentOutcomes: e.overconfidentOutcomes, underconfidentOutcomes: e.underconfidentOutcomes, sample: cal,
    reading: cal < 5 || e.high.n < 5 ? 'Too few answers to say whether your confidence tracks your accuracy.'
      : (pct(e.high.correct, e.high.n) ?? 1) >= 0.8 && confidentWrong <= 1 ? 'When you say you are sure, you are usually right.'
      : confidentWrong >= 2 ? 'You have been sure and wrong more than once — a sign of misconceptions rather than slips.'
      : 'Your confidence and accuracy roughly agree.',
  }

  return {
    version: SIGNALS_VERSION, position,
    understanding: { band, reasons, validEvents: e.validEvents, scoredPapers: e.scoredPapers, readingsTested: e.readingsTested, subjectsTested: e.subjectsTested, latestEvidenceAt: e.latestEvidenceAt, latestAttemptId: e.latestAttemptId ?? null, recent, verifiedShareOfTested: verifiedShare, integrityWarning },
    execution, calibration,
    movement: [...input.movement].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14),
  }
}

/** Which signal a kind of event is allowed to move. The whole point: activity never moves understanding. */
export const EVENT_MOVES: Record<MovementEvent['kind'], 'understanding' | 'execution'> = {
  paper_scored: 'understanding', evidence_voided: 'understanding',
  block_completed: 'execution', block_postponed: 'execution', block_skipped: 'execution',
}
