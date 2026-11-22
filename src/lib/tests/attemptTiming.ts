import { REFERENCE_SECONDS_PER_QUESTION } from './limits'

/**
 * Timing rules for the taking flow (pure).
 *
 * The client reports ACTIVE solving seconds (tab visible, focused, online, not paused).
 * The server never trusts it blindly: active time is monotonic and can grow no faster than
 * wall-clock since the last report, so a tampered client cannot inflate or shrink evidence.
 */

/** Slack for network jitter and timer granularity. */
const JITTER_SECONDS = 3

export type ProgressUpdate = { activeSeconds: number; interruptedSeconds: number }

export function acceptProgress(prev: ProgressUpdate, reported: ProgressUpdate, wallSecondsSinceLast: number): ProgressUpdate {
  const clean = (n: unknown) => (Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : 0)
  const rep = { activeSeconds: clean(reported.activeSeconds), interruptedSeconds: clean(reported.interruptedSeconds) }
  const allowed = Math.max(0, Math.floor(wallSecondsSinceLast)) + JITTER_SECONDS
  // Active + interrupted together cannot exceed the wall-clock that passed.
  const room = allowed
  const active = Math.min(rep.activeSeconds, prev.activeSeconds + room)
  const interrupted = Math.min(rep.interruptedSeconds, prev.interruptedSeconds + Math.max(0, room - Math.max(0, active - prev.activeSeconds)))
  return { activeSeconds: Math.max(prev.activeSeconds, active), interruptedSeconds: Math.max(prev.interruptedSeconds, interrupted) }
}

/** Per-item-type expectation, in seconds, around the 90-second exam average. */
const TYPE_FACTOR: Record<string, number> = {
  recall: 0.6, definition: 0.6, recognition: 0.6,
  application: 1.0, calculation: 1.5, computation: 1.5, interpretation: 1.1, analysis: 1.3, scenario: 1.4, vignette: 1.4,
}
/** Canonical cognition values map exactly; older free-text labels fall back to a substring match. These are planning references, not norms. */
const CANONICAL: Record<string, number> = { recall: 0.6, apply: 1.0, calculate: 1.5, interpret: 1.1, analyse: 1.3, analyze: 1.3 }
export function expectedSeconds(cognitionOrForm: string | null | undefined): number {
  const key = (cognitionOrForm ?? '').toLowerCase()
  const factor = CANONICAL[key] ?? Object.entries(TYPE_FACTOR).find(([k]) => key.includes(k))?.[1] ?? 1
  return Math.round(REFERENCE_SECONDS_PER_QUESTION * factor)
}

export type TimingClass = 'quick' | 'reasonable' | 'slow' | 'untimed_or_interrupted'
/**
 * Judged against the item's own expectation, never a flat 90 seconds. An interrupted or
 * resumed question is labelled and not held against the student.
 */
export function timingClass(activeSeconds: number | null, interruptedSeconds: number, cognitionOrForm: string | null | undefined): TimingClass {
  if (activeSeconds === null) return 'untimed_or_interrupted'
  if (interruptedSeconds > 0 && interruptedSeconds >= activeSeconds) return 'untimed_or_interrupted'
  const exp = expectedSeconds(cognitionOrForm)
  if (activeSeconds <= exp * 0.4) return 'quick'
  if (activeSeconds >= exp * 2) return 'slow'
  return 'reasonable'
}

/** The four confidence/correctness readings the report distinguishes (levels: low = guessing, high = sure). */
export type Reading = 'stronger_evidence' | 'possible_recognition' | 'confident_misconception' | 'knowledge_gap' | 'unsettled'
export function readAnswer(correct: boolean, level: 'low' | 'medium' | 'high'): Reading {
  if (level === 'medium') return 'unsettled'
  if (correct) return level === 'high' ? 'stronger_evidence' : 'possible_recognition'
  return level === 'high' ? 'confident_misconception' : 'knowledge_gap'
}

/**
 * With no earlier heartbeat there is no last-seen time. The room granted is the time since the
 * attempt began, or a short fixed window if it has not begun — never an hour.
 */
export function firstReportWindow(startedAt: string | null, now: Date): number {
  if (!startedAt) return 120
  return Math.max(0, Math.min(3600, (now.getTime() - new Date(startedAt).getTime()) / 1000))
}
