import { allowedTiers } from '../diagnostic/blueprint'
import type { WeightedBlueprint } from './weightedBlueprint'
import { loadEligibleItemPool, type PoolItem as Pool } from './itemPool'

/**
 * Turns a weighted blueprint into a concrete list of UNSEEN, approved bank items.
 * Never invents items and never fills a gap from outside the blueprint's readings:
 * whatever the bank cannot serve is reported as a shortfall.
 */

export type AssembledItem = { itemId: string; readingId: string; outcomeId: string | null; requestedOutcomeId: string | null }
export type Assembly = {
  items: AssembledItem[]
  requested: number
  delivered: number
  perReading: { readingId: string; wanted: number; delivered: number }[]
  shortfalls: { readingId: string; wanted: number; delivered: number }[]
  balance: { difficulty: Record<string, number>; cognition: Record<string, number>; form: Record<string, number>; keyPosition: Record<string, number> }
  /** Delivered items by reviewer-confirmed level; anything not confirmed is `unclassified`, never Standard. */
  mix: { foundation: number; standard: number; difficult: number; stretch: number; unclassified: number }
  mixShortfall: { foundation: number; standard: number; difficult: number }
}

/** Greedy variety: prefer the candidate whose difficulty, cognition, form and key position are least used so far. */
function shuffled<T>(input: T[], random: () => number): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function pickVaried(pool: Pool[], k: number, used: { d: Map<string, number>; c: Map<string, number>; f: Map<string, number>; k: Map<string, number> }, random: () => number): Pool[] {
  const chosen: Pool[] = []
  const rest = [...pool]
  for (let n = 0; n < k && rest.length; n++) {
    let best = -1, bestScore = Infinity
    const order = shuffled(rest.map((_, i) => i), random)
    for (const i of order) {
      const it = rest[i]
      const score = (used.d.get(it.intended_difficulty ?? '') ?? 0) + (used.c.get(it.cognition ?? '') ?? 0) + (used.f.get(it.item_form ?? '') ?? 0) + (used.k.get(String(it.key_index)) ?? 0) * 1.5
      if (score < bestScore) { bestScore = score; best = i }
    }
    const it = rest.splice(best, 1)[0]
    chosen.push(it)
    const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)
    bump(used.d, it.intended_difficulty ?? ''); bump(used.c, it.cognition ?? ''); bump(used.f, it.item_form ?? ''); bump(used.k, String(it.key_index))
  }
  return chosen
}

/** pickVaried, but never two of one known family. */
export function pickDistinct(pool: Pool[], k: number, used: Parameters<typeof pickVaried>[2], random: () => number): Pool[] {
  const fams = new Set<string>(); const out: Pool[] = []
  let rest = pool
  while (out.length < k && rest.length) {
    const [one] = pickVaried(rest, 1, used, random)
    out.push(one)
    if (one.family_id) fams.add(one.family_id)
    rest = rest.filter(i => i.id !== one.id && !(i.family_id && fams.has(i.family_id)))
  }
  return out
}

export async function assembleFromBlueprint(
  userId: string, bp: Pick<WeightedBlueprint, 'perOutcome' | 'perReading'>, purposeForTiers: Parameters<typeof allowedTiers>[0] = 'weekly_cumulative',
): Promise<Assembly> {
  const readingIds = [...new Set(bp.perReading.map(r => r.readingId))]
  const pool = await loadEligibleItemPool(userId, readingIds, purposeForTiers)
  return assembleEligiblePool(bp, pool)
}

export type LevelCounts = Record<'foundation' | 'standard' | 'difficult', number>
export type AssembleOptions = { target?: LevelCounts }
export type Mix = { foundation: number; standard: number; difficult: number; stretch: number; unclassified: number }
const famKey = (i: Pool) => i.family_id ?? `item:${i.id}`

/**
 * Pure selection. Reading membership alone never authorises an uncompleted outcome.
 * Order of constraints: (1) coverage: the outcomes and reading sizes in the blueprint, with at most one question per family; (2) a requested
 * difficulty mix as a SOFT preference over reviewer-confirmed levels only; (3) cognition/form/key variety; (4) the seeded tie-break.
 * Family uniqueness is solved as a bipartite matching (slots ↔ families, augmenting paths), so an early choice never creates a false shortage.
 */
export function assembleEligiblePool(bp: Pick<WeightedBlueprint, 'perOutcome' | 'perReading'>, pool: Pool[], random: () => number = Math.random, opts: AssembleOptions = {}): Assembly {
  const requested = bp.perReading.reduce((sum, r) => sum + r.questions, 0)
  if (requested > 90 || bp.perReading.some(r => !Number.isInteger(r.questions) || r.questions < 0)
    || new Set(bp.perReading.map(r => r.readingId)).size !== bp.perReading.length
    || bp.perOutcome.some(o => !Number.isInteger(o.questions) || o.questions < 0)) throw new Error('Invalid paper allocation')

  type Slot = { reading: string; outcomes: Set<string>; requestedOutcome: string | null; order: string[] }
  const byFam = new Map<string, Pool[]>()
  for (const i of pool) byFam.set(famKey(i), [...(byFam.get(famKey(i)) ?? []), i])
  const used = { d: new Map<string, number>(), c: new Map<string, number>(), f: new Map<string, number>(), k: new Map<string, number>() }
  const slots: Slot[] = [], slotFam = new Map<number, string>(), famSlot = new Map<string, number>()
  const levelOf = (i: Pool) => i.level ?? null
  // Preference for an item given what has been chosen so far: requested level with the largest remaining need, then variety, then a seeded jitter.
  const fit = (i: Pool, got: Map<string, number>) => {
    const t = opts.target, lv = levelOf(i)
    const primary = !t ? 0 : lv && lv in t ? (t[lv as keyof LevelCounts] - (got.get(lv) ?? 0)) : -1000
    return primary * 100 - ((used.c.get(i.cognition ?? '') ?? 0) + (used.f.get(i.item_form ?? '') ?? 0) + (used.k.get(String(i.key_index)) ?? 0) * 1.5) + random() * 0.5
  }
  // Levels of the items the matching has chosen so far, so each later slot prefers the level that is still short.
  const matchedLevel = new Map<number, string | null>()
  const gotNow = () => { const m = new Map<string, number>(); for (const lv of matchedLevel.values()) if (lv) m.set(lv, (m.get(lv) ?? 0) + 1); return m }
  const orderFor = (outcomes: Set<string>, reading: string) => {
    const have = gotNow()
    const fams: { key: string; score: number }[] = []
    for (const [key, items] of byFam) {
      const hit = items.filter(i => i.lm_id === reading && i.outcome_id !== null && outcomes.has(i.outcome_id))
      if (hit.length) fams.push({ key, score: Math.max(...hit.map(i => fit(i, have))) })
    }
    return fams.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).map(f => f.key)
  }
  const tryMatch = (si: number, seen: Set<string>): boolean => {
    for (const fk of slots[si].order) {
      if (seen.has(fk)) continue
      seen.add(fk)
      const holder = famSlot.get(fk)
      if (holder === undefined || tryMatch(holder, seen)) { famSlot.set(fk, si); slotFam.set(si, fk); return true }
    }
    return false
  }
  const record = (si: number, matched: boolean) => {
    if (!matched) return false
    const sl = slots[si], cands = byFam.get(slotFam.get(si)!)!.filter(i => i.lm_id === sl.reading && i.outcome_id !== null && sl.outcomes.has(i.outcome_id))
    const have = gotNow(), best = cands.map(i => ({ i, s: fit(i, have) })).sort((a, b) => b.s - a.s)[0].i
    matchedLevel.set(si, levelOf(best)); return true
  }
  const matchedIn = (reading: string) => [...slotFam.keys()].filter(i => slots[i].reading === reading).length

  // 1. Each reading's allocation outcome by outcome; 2. the remainder from the same reading's eligible outcomes. Matched slots are never unmatched.
  for (const r of bp.perReading) {
    let n = 0
    for (const o of bp.perOutcome.filter(x => x.readingId === r.readingId)) {
      for (let k = 0; k < o.questions && n < r.questions; k++, n++) {
        slots.push({ reading: r.readingId, outcomes: new Set([o.outcomeId]), requestedOutcome: o.outcomeId, order: orderFor(new Set([o.outcomeId]), r.readingId) })
        record(slots.length - 1, tryMatch(slots.length - 1, new Set()))
      }
    }
  }
  for (const r of bp.perReading) {
    const eligible = new Set(bp.perOutcome.filter(o => o.readingId === r.readingId).map(o => o.outcomeId))
    for (let missing = r.questions - matchedIn(r.readingId); missing > 0; missing--) {
      slots.push({ reading: r.readingId, outcomes: eligible, requestedOutcome: null, order: orderFor(eligible, r.readingId) })
      if (!record(slots.length - 1, tryMatch(slots.length - 1, new Set()))) break
    }
  }

  // 3. Choose the concrete item inside each matched family, honouring the mix target with the counts chosen so far.
  const got = new Map<string, number>(), items: AssembledItem[] = [], chosen: Pool[] = []
  for (const si of [...slotFam.keys()].sort((a, b) => a - b)) {
    const sl = slots[si]
    const cands = byFam.get(slotFam.get(si)!)!.filter(i => i.lm_id === sl.reading && i.outcome_id !== null && sl.outcomes.has(i.outcome_id))
    const best = cands.map(i => ({ i, s: fit(i, got) })).sort((a, b) => b.s - a.s || (a.i.id < b.i.id ? -1 : 1))[0].i
    chosen.push(best); items.push({ itemId: best.id, readingId: sl.reading, outcomeId: best.outcome_id, requestedOutcomeId: sl.requestedOutcome })
    const lv = levelOf(best); if (lv) got.set(lv, (got.get(lv) ?? 0) + 1)
    const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)
    bump(used.d, best.intended_difficulty ?? ''); bump(used.c, best.cognition ?? ''); bump(used.f, best.item_form ?? ''); bump(used.k, String(best.key_index))
  }

  // Interleave readings so the paper is not blocked by reading, then a stable shuffle within.
  const byReading = new Map<string, AssembledItem[]>()
  for (const it of items) byReading.set(it.readingId, [...(byReading.get(it.readingId) ?? []), it])
  const queues = [...byReading.values()].map(q => shuffled(q, random))
  const ordered: AssembledItem[] = []
  for (let round = 0; ordered.length < items.length; round++) for (const q of queues) if (q[round]) ordered.push(q[round])

  const perReading = bp.perReading.map(r => ({ readingId: r.readingId, wanted: r.questions, delivered: items.filter(i => i.readingId === r.readingId).length }))
  const meta = new Map(pool.map(p => [p.id, p]))
  const count = (key: (p: Pool) => string) => { const m: Record<string, number> = {}; for (const it of ordered) { const p = meta.get(it.itemId)!; const k = key(p); m[k] = (m[k] ?? 0) + 1 } return m }
  const mix: Mix = { foundation: 0, standard: 0, difficult: 0, stretch: 0, unclassified: 0 }
  for (const p of chosen) { const lv = levelOf(p); if (lv) mix[lv]++; else mix.unclassified++ }
  const mixShortfall = { foundation: 0, standard: 0, difficult: 0 }
  if (opts.target) for (const l of ['foundation', 'standard', 'difficult'] as const) mixShortfall[l] = Math.max(0, opts.target[l] - mix[l])
  return {
    items: ordered, requested, delivered: ordered.length, perReading,
    shortfalls: perReading.filter(r => r.delivered < r.wanted),
    balance: { difficulty: count(p => p.level ?? 'unclassified'), cognition: count(p => p.cognition ?? 'unset'), form: count(p => p.item_form ?? 'unset'), keyPosition: count(p => String(p.key_index)) },
    mix, mixShortfall,
  }
}
