import { MOCK_MINUTES, MOCK_QUESTIONS } from '../tests/limits'
import { pickDistinct } from '../tests/assembly'
import type { PoolItem } from '../tests/itemPool'

/**
 * The full Roadmap rehearsal blueprint (pure). Two linked sessions of 90 questions, each with a 135-minute clock.
 *
 * Session blueprint "rehearsal-2027-11-09.1" (official 2027 grouping):
 *   - Session 1 covers Ethics, Quantitative Methods, Economics, Financial Statement Analysis and Corporate Finance; Session 2 covers
 *     Equities, Fixed Income, Derivatives and Risk Management, Alternative Investments and Portfolio Construction.
 *   - Each session totals exactly 90. A topic's count lies inside its official whole-exam weight range (share of 180), nearest the
 *     range midpoint; ties break by topic id, so the allocation is deterministic. Forms reserved under "rehearsal-2026-11-05.1"
 *     (the same ten-topic allocation in both sessions) keep their pinned questions and are never relabelled.
 *   - Every question is a held-out, human-reviewed, exact-version-approved item the student has not seen, with a KNOWN family.
 *   - One question per family across BOTH sessions: session 2 can never contain a reworded sibling of a session 1 question.
 *
 * A bank that holds 90 approved questions "somewhere" is not enough: capability is decided per session and per topic.
 */
export const REHEARSAL_BLUEPRINT_VERSION = 'rehearsal-2027-11-09.1'
export const SESSION_TOPICS: [string[], string[]] = [['eth', 'quant', 'econ', 'fsa', 'ci'], ['eq', 'fi', 'deriv', 'alt', 'pm']]
export const SESSION_QUESTIONS = MOCK_QUESTIONS
export const SESSION_MINUTES = MOCK_MINUTES

export type TopicWeight = { id: string; min: number; max: number }

/**
 * Integer allocation of `total` questions over one session's topics. Each topic stays inside its official range
 * (the range is a share of the WHOLE 180-question exam), as close as possible to the range midpoint. Deterministic.
 */
export function sessionAllocation(topics: TopicWeight[], total = SESSION_QUESTIONS, wholeExam = 2 * SESSION_QUESTIONS): Record<string, number> {
  const ts = topics.filter(t => t.max > 0).sort((a, b) => a.id.localeCompare(b.id))
  if (!ts.length) return {}
  const lo = new Map(ts.map(t => [t.id, Math.ceil((t.min / 100) * wholeExam - 1e-9)])), hi = new Map(ts.map(t => [t.id, Math.floor((t.max / 100) * wholeExam + 1e-9)]))
  const sumLo = [...lo.values()].reduce((n, v) => n + v, 0), sumHi = [...hi.values()].reduce((n, v) => n + v, 0)
  if (sumLo > total || sumHi < total) throw new Error(`Session of ${total} cannot satisfy the official ranges (needs between ${sumLo} and ${sumHi}).`)
  const midSum = ts.reduce((n, t) => n + (t.min + t.max) / 2, 0)
  const want = new Map(ts.map(t => [t.id, ((t.min + t.max) / 2 / midSum) * total]))
  const out: Record<string, number> = Object.fromEntries(ts.map(t => [t.id, Math.min(hi.get(t.id)!, Math.max(lo.get(t.id)!, Math.round(want.get(t.id)!)))]))
  const sum = () => Object.values(out).reduce((n, v) => n + v, 0)
  while (sum() !== total) {
    const add = sum() < total
    const cand = ts.filter(t => add ? out[t.id] < hi.get(t.id)! : out[t.id] > lo.get(t.id)!)
    cand.sort((a, b) => (add ? (want.get(b.id)! - out[b.id]) - (want.get(a.id)! - out[a.id]) : (out[b.id] - want.get(b.id)!) - (out[a.id] - want.get(a.id)!)) || a.id.localeCompare(b.id))
    out[cand[0].id] += add ? 1 : -1
  }
  return out
}

/** Allocation for both sessions from the official grouping. */
export function rehearsalAllocations(topics: TopicWeight[]): [Record<string, number>, Record<string, number>] {
  return [0, 1].map(s => sessionAllocation(topics.filter(t => SESSION_TOPICS[s].includes(t.id)))) as [Record<string, number>, Record<string, number>]
}

export type RehearsalItem = PoolItem & { topic_id: string }
export type SessionShortfall = { topicId: string; wanted: number; deliverable: number }
export type RehearsalPlan = {
  sessions: [string[], string[]]
  /** Per session, the topics that cannot be filled, with how many can be. Empty = that session can be assembled. */
  shortfalls: [SessionShortfall[], SessionShortfall[]]
  /** Topic counts for both sessions together (each topic belongs to exactly one session). */
  allocation: Record<string, number>
  perSessionAllocation: [Record<string, number>, Record<string, number>]
  /** Distinct fresh held-out families available per topic (the limit on how many sessions a topic can feed). */
  familiesByTopic: Record<string, number>
  ready: boolean
  perSession: [Record<string, number>, Record<string, number>]
  coverage: [Record<string, unknown>, Record<string, unknown>]
}

/** Round-robin over readings so a topic's questions come from as many of its readings as possible before any reading repeats. */
function pickForTopic(pool: RehearsalItem[], k: number, taken: Set<string>, families: Set<string>, random: () => number): RehearsalItem[] {
  const out: RehearsalItem[] = []
  const used = { d: new Map<string, number>(), c: new Map<string, number>(), f: new Map<string, number>(), k: new Map<string, number>() }
  while (out.length < k) {
    const byReading = new Map<string, RehearsalItem[]>()
    for (const i of pool) if (!taken.has(i.id) && !(i.family_id && families.has(i.family_id))) byReading.set(i.lm_id, [...(byReading.get(i.lm_id) ?? []), i])
    if (!byReading.size) break
    // The reading with the fewest questions chosen so far goes next.
    const chosenBy = (r: string) => out.filter(o => o.lm_id === r).length
    const reading = [...byReading.keys()].sort((a, b) => chosenBy(a) - chosenBy(b) || a.localeCompare(b))[0]
    const [one] = pickDistinct(byReading.get(reading)!, 1, used, random) as RehearsalItem[]
    if (!one) break
    out.push(one); taken.add(one.id); if (one.family_id) families.add(one.family_id)
  }
  return out
}

/**
 * Plans both sessions from the fresh held-out pool. Pure given `random`. Session 1 is filled first; session 2 uses only families that
 * session 1 did not, so a topic with fewer than (wanted1 + wanted2) distinct families is reported as a shortfall for session 2.
 */
export function planRehearsal(pool: RehearsalItem[], topics: TopicWeight[], random: () => number = Math.random): RehearsalPlan {
  const perSessionAllocation = rehearsalAllocations(topics)
  const allocation = { ...perSessionAllocation[0], ...perSessionAllocation[1] }
  const taken = new Set<string>(), families = new Set<string>()
  const sessions: [string[], string[]] = [[], []]
  const shortfalls: [SessionShortfall[], SessionShortfall[]] = [[], []]
  const perSession: [Record<string, number>, Record<string, number>] = [{}, {}]
  const coverage: [Record<string, unknown>, Record<string, unknown>] = [{}, {}]
  const byTopic = new Map<string, RehearsalItem[]>()
  for (const i of pool) byTopic.set(i.topic_id, [...(byTopic.get(i.topic_id) ?? []), i])
  const familiesByTopic: Record<string, number> = {}
  for (const t of Object.keys(allocation)) {
    const items = byTopic.get(t) ?? []
    familiesByTopic[t] = new Set(items.map(i => i.family_id).filter(Boolean)).size
  }
  for (const s of [0, 1] as const) {
    const items: RehearsalItem[] = []
    const sAlloc = perSessionAllocation[s]
    for (const topic of Object.keys(sAlloc).sort()) {
      const got = pickForTopic(byTopic.get(topic) ?? [], sAlloc[topic], taken, families, random)
      items.push(...got); perSession[s][topic] = got.length
      if (got.length < sAlloc[topic]) shortfalls[s].push({ topicId: topic, wanted: sAlloc[topic], deliverable: got.length })
    }
    // Interleave topics so the session is not blocked by subject.
    const queues = Object.keys(sAlloc).sort().map(t => items.filter(i => i.topic_id === t))
    const ordered: RehearsalItem[] = []
    for (let r = 0; ordered.length < items.length; r++) for (const q of queues) if (q[r]) ordered.push(q[r])
    sessions[s] = ordered.map(i => i.id)
    coverage[s] = { questions: ordered.length, perTopic: perSession[s], readings: [...new Set(ordered.map(i => i.lm_id))].length }
  }
  return { sessions, shortfalls, allocation, perSessionAllocation, familiesByTopic, ready: sessions[0].length === SESSION_QUESTIONS && sessions[1].length === SESSION_QUESTIONS && !shortfalls[0].length && !shortfalls[1].length, perSession, coverage }
}
