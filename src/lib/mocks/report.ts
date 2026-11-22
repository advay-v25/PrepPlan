import { isCalendarDate } from '../format/date'
/**
 * Mock reports (pure). A report is the student's OWN account of a mock already taken: it is context for planning, never demonstrated evidence,
 * never a concept verdict, never a closed repair. Scales are different measurements and are never mixed: a percentage, marks out of a total and a
 * percentile are kept apart, and an unknown scale stays unknown. The database (save_mock_report) re-checks every rule here.
 */
export type Scale = 'percent' | 'marks' | 'percentile' | 'unknown'
export type MockScope = 'full' | 'partial'
export const DIFFICULTIES = {
  ran_out_of_time: 'Ran out of time',
  rushed_omissions: 'Rushed, left or skipped questions',
  changed_right_to_wrong: 'Changed right answers to wrong ones',
  calculation_errors: 'Calculation slips',
  misread_questions: 'Misread questions',
  knowledge_gaps: 'Did not know the material',
  nerves: 'Nerves or focus',
} as const
export type Difficulty = keyof typeof DIFFICULTIES
export type TopicResult = { topicId: string; value: number; scale: Scale; max?: number | null }
export type MockReportInput = { takenOn: string; provider?: string | null; scope: MockScope; scale: Scale; score?: number | null; scoreMax?: number | null; topics?: TopicResult[]; difficulties?: Difficulty[]; notes?: string | null; legacyOutcomeId?: string | null }
export type MockReport = {
  id: string; takenOn: string; provider: string | null; scope: MockScope; scale: Scale; score: number | null; scoreMax: number | null
  topics: TopicResult[]; difficulties: Difficulty[]; notes: string | null; legacyOutcomeId: string | null; status: 'active' | 'withdrawn'; version: number
  planSelection: RecoverySelection | null
}
export type RecoverySelection = { items: SelectionItem[] }
export type SelectionItem = { key: string; kind: 'review' | 'pacing' | 'answer_change'; outcomeId?: string; readingId?: string; topicId?: string; minutes: number }

/** A real calendar date: Date.parse would quietly turn 2026-02-30 into March. */
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Structural validation with plain-words errors. Returns the normalised payload the command takes. */
export function parseReportInput(raw: any, today: string): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message })
  if (!raw || typeof raw !== 'object') return bad('Nothing to save.')
  if (typeof raw.takenOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.takenOn) || !isCalendarDate(raw.takenOn)) return bad('Enter a real date for when the mock was taken.')
  if (raw.takenOn > today) return bad('A mock you have already taken cannot be dated in the future. To plan one, add it as a booking in Calendar.')
  if (raw.takenOn < '2020-01-01') return bad('That date is too far back to be a mock you are preparing from.')
  if (raw.scope !== 'full' && raw.scope !== 'partial') return bad('Say whether it was a full or a partial exam.')
  const scale: Scale = ['percent', 'marks', 'percentile', 'unknown'].includes(raw.scale) ? raw.scale : 'unknown'
  const score = raw.score === null || raw.score === undefined || raw.score === '' ? null : Number(raw.score)
  const max = raw.scoreMax === null || raw.scoreMax === undefined || raw.scoreMax === '' ? null : Number(raw.scoreMax)
  if ((score !== null && !isNum(score)) || (max !== null && !isNum(max))) return bad('Scores must be numbers.')
  if (score !== null && score < 0) return bad('A score cannot be negative.')
  if ((scale === 'percent' || scale === 'percentile') && ((score !== null && score > 100) || max !== null)) return bad('A percentage or percentile is between 0 and 100, with no total.')
  if (scale === 'marks' && ((score === null) !== (max === null) || (max !== null && (max <= 0 || score! > max)))) return bad('Marks need both what you scored and the total, and cannot exceed it.')
  if (scale === 'unknown' && max !== null) return bad('If you do not know the score type, leave the total empty.')
  const topics: TopicResult[] = []
  for (const t of Array.isArray(raw.topics) ? raw.topics : []) {
    const v = Number(t?.value), m = t?.max === null || t?.max === undefined || t?.max === '' ? null : Number(t.max), ts: Scale = ['percent', 'marks', 'percentile', 'unknown'].includes(t?.scale) ? t.scale : 'unknown'
    if (typeof t?.topicId !== 'string' || !isNum(v) || v < 0) return bad('A topic result needs a subject and a number.')
    if ((ts === 'percent' || ts === 'percentile') && v > 100) return bad('A topic percentage is between 0 and 100.')
    if (ts === 'marks' && (m === null || m <= 0 || v > m)) return bad('Topic marks need a total and cannot exceed it.')
    topics.push({ topicId: t.topicId, value: v, scale: ts, ...(ts === 'marks' ? { max: m } : {}) })
  }
  if (topics.length > 12 || new Set(topics.map(t => t.topicId)).size !== topics.length) return bad('Each subject can have one result.')
  const difficulties = [...new Set((Array.isArray(raw.difficulties) ? raw.difficulties : []) as string[])]
  if (difficulties.some(d => !(d in DIFFICULTIES))) return bad('Unknown difficulty.')
  const notes = typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null
  if (notes && notes.length > 500) return bad('Notes are limited to 500 characters.')
  const provider = typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider.trim() : null
  if (provider && provider.length > 80) return bad('The provider name is too long.')
  if (score === null && topics.length === 0 && difficulties.length === 0) return bad('Add a result, a topic result or something that went wrong, so there is something to work from.')
  return { ok: true, payload: { taken_on: raw.takenOn, provider, scope: raw.scope, scale, score, score_max: max, topics, difficulties, notes, legacy_outcome_id: raw.legacyOutcomeId ?? null } }
}

export function rowToReport(r: any): MockReport {
  return { id: r.id, takenOn: r.taken_on, provider: r.provider ?? null, scope: r.scope, scale: r.scale, score: r.score === null ? null : Number(r.score), scoreMax: r.score_max === null ? null : Number(r.score_max),
    topics: (r.topics ?? []) as TopicResult[], difficulties: (r.difficulties ?? []) as Difficulty[], notes: r.notes ?? null, legacyOutcomeId: r.legacy_outcome_id ?? null, status: r.status, version: Number(r.version), planSelection: r.plan_selection ?? null }
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10))
/** A score always carries its own scale; an unknown scale is shown as entered, with that said. */
export function describeScore(score: number | null, scale: Scale, max?: number | null): string {
  if (score === null) return 'no overall result recorded'
  return scale === 'percent' ? `${n(score)}%` : scale === 'marks' ? `${n(score)} of ${n(max ?? 0)} marks` : scale === 'percentile' ? `${n(score)}th percentile` : `${n(score)} (score type not stated)`
}

/** Two reports compare ONLY when scale and scope match (and, for marks, the same total). Otherwise there is no trend, and the reasons are returned. */
export function comparable(a: MockReport, b: MockReport): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  if (a.score === null || b.score === null) reasons.push('one of them has no overall result')
  if (a.scale === 'unknown' || b.scale === 'unknown') reasons.push('a score type is not stated')
  else if (a.scale !== b.scale) reasons.push(`one is ${a.scale === 'percent' ? 'a percentage' : a.scale === 'marks' ? 'marks' : 'a percentile'} and the other is ${b.scale === 'percent' ? 'a percentage' : b.scale === 'marks' ? 'marks' : 'a percentile'}`)
  else if (a.scale === 'marks' && a.scoreMax !== b.scoreMax) reasons.push('the totals differ')
  if (a.scope !== b.scope) reasons.push('one is a partial exam and the other a full one')
  if ((a.provider ?? '').toLowerCase() !== (b.provider ?? '').toLowerCase()) reasons.push('they come from different providers or sources')
  return reasons.length ? { ok: false, reasons } : { ok: true }
}
