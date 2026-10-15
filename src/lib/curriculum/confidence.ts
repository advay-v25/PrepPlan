/**
 * Confidence engine (pure).
 *
 * Every answer carries a 3-level confidence (low / medium / high). Combined
 * with correctness that gives an observation verdict; several observations give
 * an outcome verdict; and the student's own overall mark is then VERIFIED
 * against that evidence. Nothing here reads the database, and nothing here
 * predicts an exam result.
 *
 *   high  + wrong   -> concept_miss   (sure and wrong: a misconception; repair, retest differently worded)
 *   low   + right   -> guess          (right without knowing it: verify, never counted as mastery)
 *   high  + right   -> secure
 *   low   + wrong   -> known_gap      (the student knew: repair)
 *   medium + any    -> unsettled
 */

export type Level = 'low' | 'medium' | 'high'
export type ObsVerdict = 'secure' | 'concept_miss' | 'guess' | 'known_gap' | 'unsettled'
export type SelfMark = 'not_started' | 'shaky' | 'fairly_sure' | 'solid'
export type MarkCheck = 'verified' | 'overconfident' | 'underconfident' | 'unassessed' | 'unmarked'

export const SELF_MARKS: SelfMark[] = ['not_started', 'shaky', 'fairly_sure', 'solid']
export const STALE_DAYS = 21

/** Existing diagnostics record 1-5; the product scale is three levels. */
export function toLevel(raw: number | null | undefined): Level | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null
  if (raw <= 2) return 'low'
  if (raw === 3) return 'medium'
  return 'high'
}

export function observationVerdict(correct: boolean, level: Level | null): ObsVerdict {
  if (level === 'medium' || level === null) return correct ? 'unsettled' : 'known_gap'
  if (level === 'high') return correct ? 'secure' : 'concept_miss'
  return correct ? 'guess' : 'known_gap'
}

export type Observation = { correct: boolean; level: Level | null; at: string }

export type OutcomeVerdict = { verdict: ObsVerdict | 'none'; reason: string }

const REASON: Record<ObsVerdict | 'none', string> = {
  concept_miss: 'You were sure and wrong — a misconception, not a slip. It needs relearning and a differently worded retest.',
  known_gap: 'You were unsure and wrong — a gap you already suspected. Close it before broad revision.',
  guess: 'Right, but with low confidence — a guess does not count as mastery. Verify it under fresh wording.',
  unsettled: 'Only medium confidence so far — not enough to call it secure.',
  secure: 'Confident and correct, more than once, and recently.',
  none: 'No test evidence yet.',
}

/** Recent, repeated misses outrank one good result; a stale or single result is never "secure". */
export function outcomeVerdict(observations: Observation[], now: Date): OutcomeVerdict {
  if (observations.length === 0) return { verdict: 'none', reason: REASON.none }
  const sorted = [...observations].sort((a, b) => a.at.localeCompare(b.at))
  const recent = sorted.slice(-3).map(o => observationVerdict(o.correct, o.level))
  const latest = recent[recent.length - 1]

  if (recent.includes('concept_miss')) return { verdict: 'concept_miss', reason: REASON.concept_miss }
  if (latest === 'known_gap') return { verdict: 'known_gap', reason: REASON.known_gap }
  if (recent.filter(v => v === 'known_gap').length >= 2) return { verdict: 'known_gap', reason: REASON.known_gap }
  if (latest === 'guess') return { verdict: 'guess', reason: REASON.guess }

  const lastAt = new Date(sorted[sorted.length - 1].at).getTime()
  const ageDays = Math.floor((now.getTime() - lastAt) / 86_400_000)
  const secureCount = sorted.filter(o => observationVerdict(o.correct, o.level) === 'secure').length
  if (latest === 'secure' && secureCount >= 2 && ageDays <= STALE_DAYS) return { verdict: 'secure', reason: REASON.secure }
  if (latest === 'secure' && ageDays > STALE_DAYS) return { verdict: 'unsettled', reason: `Last checked ${ageDays} days ago — worth a fresh look.` }
  return { verdict: 'unsettled', reason: REASON.unsettled }
}

/**
 * The student's own overall mark, verified against the evidence.
 * An underconfident student who scores well is still put down for revision.
 */
export function checkMark(mark: SelfMark | null, verdict: ObsVerdict | 'none'): { check: MarkCheck; needsRevision: boolean } {
  if (verdict === 'none') return { check: mark ? 'unassessed' : 'unmarked', needsRevision: false }
  if (!mark) return { check: 'unmarked', needsRevision: false }
  const confident = mark === 'fairly_sure' || mark === 'solid'
  if (confident && (verdict === 'concept_miss' || verdict === 'known_gap' || verdict === 'guess')) return { check: 'overconfident', needsRevision: true }
  if (confident && verdict === 'unsettled') return { check: 'unassessed', needsRevision: false }
  if (confident && verdict === 'secure') return { check: 'verified', needsRevision: false }
  // not_started / shaky
  if (verdict === 'secure') return { check: 'underconfident', needsRevision: true }
  return { check: 'verified', needsRevision: false } // shaky and the evidence agrees
}

export const MARK_LABEL: Record<SelfMark, string> = {
  not_started: 'Not started', shaky: 'Shaky', fairly_sure: 'Fairly sure', solid: 'Solid',
}
export const VERDICT_LABEL: Record<ObsVerdict | 'none', string> = {
  concept_miss: 'Concept miss', known_gap: 'Known gap', guess: 'Guess', unsettled: 'Unsettled', secure: 'Secure', none: 'No evidence',
}
export const CHECK_LABEL: Record<MarkCheck, string> = {
  verified: 'Evidence agrees', overconfident: 'Evidence says less', underconfident: 'Evidence says more', unassessed: 'Not enough evidence', unmarked: 'Not marked',
}
