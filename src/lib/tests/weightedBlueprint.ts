import { MAX_ASSESSMENT_QUESTIONS, WEEKLY_PAPER_SOFT_MAX_QUESTIONS, clampQuestions, estimatedMinutes } from './limits'
import type { CompletedCycleScope, ScopeKind } from './completedScope'

/**
 * Weighted, broad allocation of a paper's questions across COMPLETED scope (pure).
 *
 *  1. every eligible reading is enumerated;
 *  2. a breadth floor gives each eligible reading at least one question, so no
 *     high-weight subject crowds out the rest (if there are more readings than
 *     questions, the highest-priority readings are sampled and the rest become a
 *     visible rolling-coverage obligation);
 *  3. the remainder is shared across SUBJECTS by exam-weight midpoint, normalised
 *     over the subjects actually in scope; ties on weight go to the subject with
 *     more completed reading pages;
 *  4. within a subject, by completed reading pages moderated by how many outcomes
 *     are eligible (page count only ranks — it never adds content outside scope);
 *  5. questions inside a reading are spread across its eligible outcomes.
 *
 * Nothing outside `scope.targets` can receive a question. No paper exceeds 90.
 */

export type SubjectWeight = { id: string; min: number; max: number }

export type WeightedInput = {
  scope: Pick<CompletedCycleScope, 'targets' | 'readings'>
  subjects: SubjectWeight[]
  /** Which scope kinds this paper may test (weekly diagnostic: new; revisionary: revision; mixed: both). */
  kinds: ScopeKind[]
  /** Wall-clock the student can give this paper; sets the routine ceiling (never above 90). */
  minutesBudget?: number
  /** Outcomes to add from the student's prior weak/unstable history; only a limited, explicit section. */
  carriedOutcomeIds?: string[]
  /** Force the paper size (a mock is always 90); still clamped to the shared ceiling. */
  totalOverride?: number
  /** Readings the item bank cannot yet serve: named as shortfalls, never silently narrowed. */
  bankCountByReading?: Map<string, number>
}

export type OutcomeAllocation = { outcomeId: string; readingId: string; subjectId: string; questions: number; kind: ScopeKind | 'carried' }
export type ReadingAllocation = { readingId: string; subjectId: string; questions: number; pages: number }
export type SubjectAllocation = { subjectId: string; questions: number; weightMid: number; pages: number }

export type WeightedBlueprint = {
  totalQuestions: number
  estimatedMinutes: number
  perOutcome: OutcomeAllocation[]
  perReading: ReadingAllocation[]
  perSubject: SubjectAllocation[]
  sections: { kind: ScopeKind | 'carried'; questions: number }[]
  /** Eligible outcomes that got no question in this paper — carried as a rolling-coverage obligation. */
  rollingCoverage: string[]
  /** Readings where the bank holds fewer items than the blueprint wants. */
  bankShortfalls: { readingId: string; wanted: number; available: number }[]
  policy: { breadthFloor: number; ceiling: number; certainty: 'full' | 'reduced'; note: string }
}

const CARRIED_SHARE = 0.15

const mid = (w: SubjectWeight) => (w.min + w.max) / 2
/** Reading rank: pages, moderated by how many outcomes are eligible (1..5+). */
const readingScore = (pages: number, outcomes: number) => Math.max(1, pages) * (0.5 + 0.5 * Math.min(1, outcomes / 5))

/** Largest-remainder apportionment; deterministic (ties by key). */
export function apportion(total: number, shares: { key: string; weight: number }[]): Map<string, number> {
  const out = new Map(shares.map(s => [s.key, 0]))
  const sum = shares.reduce((s, x) => s + Math.max(0, x.weight), 0)
  if (total <= 0 || sum <= 0) return out
  const raw = shares.map(s => ({ key: s.key, exact: (Math.max(0, s.weight) / sum) * total }))
  let given = 0
  for (const r of raw) { const f = Math.floor(r.exact); out.set(r.key, f); given += f }
  raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || b.exact - a.exact || a.key.localeCompare(b.key))
  for (let i = 0; given < total && i < raw.length; i++, given++) out.set(raw[i].key, out.get(raw[i].key)! + 1)
  return out
}

/** How many questions this scope deserves: adaptive, capped, never automatically 90. */
export function targetQuestionCount(eligibleOutcomes: number, eligibleReadings: number, minutesBudget = 90): number {
  const routineCeiling = Math.min(WEEKLY_PAPER_SOFT_MAX_QUESTIONS, Math.floor(minutesBudget / 1.5), MAX_ASSESSMENT_QUESTIONS)
  if (eligibleOutcomes === 0) return 0
  const wanted = Math.max(eligibleReadings, Math.ceil(eligibleOutcomes * 1.5))
  return clampQuestions(Math.min(routineCeiling, wanted))
}

export function allocateWeighted(input: WeightedInput): WeightedBlueprint {
  const eligible = input.scope.targets.filter(t => input.kinds.includes(t.kind))
  const weightOf = new Map(input.subjects.map(s => [s.id, s]))
  const readingsInScope = input.scope.readings.filter(r => eligible.some(t => t.readingId === r.readingId))
  const empty = (note: string): WeightedBlueprint => ({
    totalQuestions: 0, estimatedMinutes: 0, perOutcome: [], perReading: [], perSubject: [], sections: [], rollingCoverage: [],
    bankShortfalls: [], policy: { breadthFloor: 0, ceiling: MAX_ASSESSMENT_QUESTIONS, certainty: 'full', note },
  })
  if (eligible.length === 0) return empty('Nothing completed and mapped falls in this paper, so there is nothing to test.')

  const pagesKnown = readingsInScope.every(r => r.pageCount > 0)
  const carried = (input.carriedOutcomeIds ?? []).filter(id => !eligible.some(t => t.outcomeId === id))
  let total = input.totalOverride !== undefined ? clampQuestions(input.totalOverride) : targetQuestionCount(eligible.length, readingsInScope.length, input.minutesBudget)
  const carriedQ = carried.length ? Math.min(carried.length, Math.floor(total * CARRIED_SHARE)) : 0
  const scopeQ = total - carriedQ

  const readingInfo = new Map(readingsInScope.map(r => {
    const els = eligible.filter(t => t.readingId === r.readingId)
    return [r.readingId, { r, outcomes: els, score: readingScore(r.pageCount, els.length), pages: r.pageCount }]
  }))
  const subjectIds = [...new Set(readingsInScope.map(r => r.subjectId))]
  const subjectPages = new Map(subjectIds.map(s => [s, readingsInScope.filter(r => r.subjectId === s).reduce((n, r) => n + r.pageCount, 0)]))

  // --- breadth floor: one question per reading, or the best-ranked readings if questions are fewer
  const ranked = [...readingInfo.values()].sort((a, b) =>
    mid(weightOf.get(b.r.subjectId) ?? { id: '', min: 0, max: 0 }) - mid(weightOf.get(a.r.subjectId) ?? { id: '', min: 0, max: 0 })
    || b.pages - a.pages || a.r.readingId.localeCompare(b.r.readingId))
  const floorReadings = ranked.slice(0, Math.min(scopeQ, ranked.length))
  const floorMap = new Map(floorReadings.map(x => [x.r.readingId, 1]))
  const remaining = scopeQ - floorReadings.length

  // --- subject shares by exam-weight midpoint over subjects in scope; equal weights tie-break on pages
  const subjShares = subjectIds.map(id => {
    const w = weightOf.get(id); const base = w ? mid(w) : 0
    return { key: id, weight: base + (subjectPages.get(id) ?? 0) * 1e-6 }
  })
  const subjQ = apportion(remaining, subjShares.filter(s => floorReadings.some(f => f.r.subjectId === s.key)))

  // --- within a subject, by moderated reading pages
  const readingQ = new Map<string, number>()
  for (const [rid, n] of floorMap) readingQ.set(rid, n)
  for (const sid of subjectIds) {
    const rs = floorReadings.filter(f => f.r.subjectId === sid)
    const part = apportion(subjQ.get(sid) ?? 0, rs.map(x => ({ key: x.r.readingId, weight: x.score })))
    for (const [rid, n] of part) readingQ.set(rid, (readingQ.get(rid) ?? 0) + n)
  }

  // --- spread each reading's questions across its eligible outcomes (partial coverage counts half)
  const perOutcome: OutcomeAllocation[] = []
  for (const [rid, q] of readingQ) {
    const info = readingInfo.get(rid)!
    const spread = apportion(q, info.outcomes.map(t => ({ key: t.outcomeId, weight: t.weight })))
    for (const t of info.outcomes) {
      const n = spread.get(t.outcomeId) ?? 0
      if (n > 0) perOutcome.push({ outcomeId: t.outcomeId, readingId: rid, subjectId: t.subjectId, questions: n, kind: t.kind })
    }
  }
  for (const id of carried.slice(0, carriedQ)) perOutcome.push({ outcomeId: id, readingId: '', subjectId: '', questions: 1, kind: 'carried' })

  total = perOutcome.reduce((s, o) => s + o.questions, 0)
  const perReading: ReadingAllocation[] = [...readingQ].filter(([, q]) => q > 0).map(([rid, q]) => ({ readingId: rid, subjectId: readingInfo.get(rid)!.r.subjectId, questions: q, pages: readingInfo.get(rid)!.pages }))
    .sort((a, b) => a.readingId.localeCompare(b.readingId))
  const perSubject: SubjectAllocation[] = subjectIds.map(sid => ({
    subjectId: sid, questions: perReading.filter(r => r.subjectId === sid).reduce((s, r) => s + r.questions, 0),
    weightMid: weightOf.get(sid) ? mid(weightOf.get(sid)!) : 0, pages: subjectPages.get(sid) ?? 0,
  })).sort((a, b) => a.subjectId.localeCompare(b.subjectId))

  const sampled = new Set(perOutcome.map(o => o.outcomeId))
  const bankShortfalls = input.bankCountByReading
    ? perReading.map(r => ({ readingId: r.readingId, wanted: r.questions, available: input.bankCountByReading!.get(r.readingId) ?? 0 })).filter(x => x.available < x.wanted)
    : []
  const sections = (['new', 'revision', 'carried'] as const).map(k => ({ kind: k, questions: perOutcome.filter(o => o.kind === k).reduce((s, o) => s + o.questions, 0) })).filter(s => s.questions > 0)

  return {
    totalQuestions: total, estimatedMinutes: estimatedMinutes(total), perOutcome, perReading, perSubject, sections,
    rollingCoverage: eligible.filter(t => !sampled.has(t.outcomeId)).map(t => t.outcomeId).sort(),
    bankShortfalls,
    policy: {
      breadthFloor: floorReadings.length, ceiling: MAX_ASSESSMENT_QUESTIONS, certainty: pagesKnown ? 'full' : 'reduced',
      note: pagesKnown
        ? 'Questions follow completed scope: a floor per reading, then subject exam-weight midpoints, then completed reading pages.'
        : 'Some reading page counts are missing, so within-subject weighting used a declared fallback (reduced certainty).',
    },
  }
}
