/**
 * The student's starting position, as the planner consumes it. Pure.
 *
 * Everything here is STUDENT-REPORTED planning context. It is stored with its timestamp and never becomes evidence:
 * it creates no completed block, no minutes, no assessment response and closes no repair thread.
 *
 * Three facts are kept apart, because "I covered it" and "I am unsure of it" are different answers:
 *  - coverage   what the student has studied before. Lives in user_module_state (source 'self_report'), per reading.
 *               A broad topic claim is expanded to that topic's readings as PLANNING SCOPE ("assume these readings
 *               were studied"); it is never turned into concept-level knowledge.
 *  - uncertainty which areas they want to revisit, whatever the coverage. A topic with no answer is "not answered";
 *               level 'none' is an explicit "nothing shaky". Neither is guessed from the other.
 *  - mock       an optional upcoming mock or checkpoint date. The exam stays the only exam date.
 */
export const UNCERTAINTY_LEVELS = ['none', 'few', 'several', 'most'] as const
export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number]
export type ReportedUncertainty = Exclude<UncertaintyLevel, 'none'>

export const MOCK_KINDS = ['provider_mock', 'school_checkpoint', 'other', 'internal_rehearsal'] as const
export type MockKind = (typeof MOCK_KINDS)[number]

export const MOCK_KIND_LABEL: Record<MockKind, string> = {
  provider_mock: 'Mock from a course provider', school_checkpoint: 'School or class checkpoint', other: 'Other mock or checkpoint', internal_rehearsal: 'Roadmap rehearsal (two timed sessions)',
}

export const UNCERTAINTY_LABEL: Record<UncertaintyLevel, string> = {
  none: 'Nothing shaky', few: 'A few areas', several: 'Several areas', most: 'Most of this topic',
}

/** How much a reported level raises a topic's revision priority. Unanswered and 'none' are equal: no reported reason to move it. */
export const UNCERTAINTY_WEIGHT: Record<UncertaintyLevel, number> = { none: 1, few: 1.5, several: 2, most: 3 }

/**
 * With no readings picked, how many of an uncertain topic's readings one week starts with. The student said "a few"
 * or "several" without saying which, so the plan starts at the front of the topic and says that it did.
 */
export const ASSUMED_READINGS_PER_WEEK: Record<ReportedUncertainty, number> = { few: 2, several: 3, most: 4 }

export type EntryContext = {
  stage: string | null
  /** The one canonical checkpoint (profiles.mock_*); timing is optional and never invented. */
  mock: { date: string; kind: MockKind; label?: string | null; startTime?: string | null; durationMinutes?: number | null } | null
  /** Keyed by topic id. A missing key means "not answered". */
  uncertainty: Record<string, { level: UncertaintyLevel; lmIds: string[] }>
  reportedAt: string | null
}

export const EMPTY_ENTRY: EntryContext = { stage: null, mock: null, uncertainty: {}, reportedAt: null }

/** What a module carries into planning: the reported level, and whether the student chose it or the plan assumed it. */
export type ModuleUncertainty = { level: ReportedUncertainty; assumed: boolean }

export function uncertaintyForModule(ctx: EntryContext, module: { id: string; topic: string }): ModuleUncertainty | null {
  const u = ctx.uncertainty[module.topic]
  if (!u || u.level === 'none') return null
  if (u.lmIds.length > 0) return u.lmIds.includes(module.id) ? { level: u.level, assumed: false } : null
  return { level: u.level, assumed: u.level !== 'most' }
}

/** A short, stable change token: planning and drafts compare it to know the context they were built from has moved. */
export function entryToken(ctx: EntryContext): string {
  const text = JSON.stringify([ctx.stage, ctx.mock, Object.keys(ctx.uncertainty).sort().map(k => [k, ctx.uncertainty[k].level, [...ctx.uncertainty[k].lmIds].sort()])])
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The reading-level states a student can set. Stored as taught/studied in user_module_state. */
export const READING_STATES = ['not_started', 'partly', 'covered'] as const
export type ReadingState = (typeof READING_STATES)[number]
