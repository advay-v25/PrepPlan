import { createAdminClient } from '../supabase/admin'
import { allowedTiers } from '../diagnostic/blueprint'
import type { WeightedBlueprint } from './weightedBlueprint'

/**
 * Turns a weighted blueprint into a concrete list of UNSEEN, approved bank items.
 * Never invents items and never fills a gap from outside the blueprint's readings:
 * whatever the bank cannot serve is reported as a shortfall.
 */

type Pool = {
  id: string; lm_id: string; outcome_id: string | null; concept_id: string | null
  intended_difficulty: string | null; cognition: string | null; item_form: string | null; key_index: number | null
}
export type AssembledItem = { itemId: string; readingId: string; outcomeId: string | null; requestedOutcomeId: string | null }
export type Assembly = {
  items: AssembledItem[]
  requested: number
  delivered: number
  perReading: { readingId: string; wanted: number; delivered: number }[]
  shortfalls: { readingId: string; wanted: number; delivered: number }[]
  balance: { difficulty: Record<string, number>; cognition: Record<string, number>; form: Record<string, number>; keyPosition: Record<string, number> }
}

/** Greedy variety: prefer the candidate whose difficulty, cognition, form and key position are least used so far. */
function pickVaried(pool: Pool[], k: number, used: { d: Map<string, number>; c: Map<string, number>; f: Map<string, number>; k: Map<string, number> }): Pool[] {
  const chosen: Pool[] = []
  const rest = [...pool]
  for (let n = 0; n < k && rest.length; n++) {
    let best = -1, bestScore = Infinity
    const order = rest.map((_, i) => i).sort(() => Math.random() - 0.5)
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

export async function assembleFromBlueprint(
  userId: string, bp: Pick<WeightedBlueprint, 'perOutcome' | 'perReading'>, purposeForTiers: Parameters<typeof allowedTiers>[0] = 'weekly_cumulative',
): Promise<Assembly> {
  const admin = createAdminClient()
  const readingIds = [...new Set(bp.perReading.map(r => r.readingId))]
  const empty: Assembly = { items: [], requested: 0, delivered: 0, perReading: [], shortfalls: [], balance: { difficulty: {}, cognition: {}, form: {}, keyPosition: {} } }
  if (readingIds.length === 0) return empty

  const [{ data: seenRows }, { data: itemRows }] = await Promise.all([
    admin.from('assessment_responses').select('item_id').eq('user_id', userId),
    admin.from('assessment_items').select('id, lm_id, outcome_id, concept_id, intended_difficulty, cognition, item_form, key_index')
      .in('lm_id', readingIds).in('review_status', allowedTiers(purposeForTiers)),
  ])
  const seen = new Set((seenRows ?? []).map(r => r.item_id as string))
  const pool = ((itemRows ?? []) as Pool[]).filter(i => !seen.has(i.id))

  const used = { d: new Map<string, number>(), c: new Map<string, number>(), f: new Map<string, number>(), k: new Map<string, number>() }
  const taken = new Set<string>()
  const items: AssembledItem[] = []

  // 1. Each reading's allocation, outcome by outcome; 2. any remainder from the same reading.
  for (const r of bp.perReading) {
    const outs = bp.perOutcome.filter(o => o.readingId === r.readingId)
    let deliveredHere = 0
    for (const o of outs) {
      const cands = pool.filter(i => i.lm_id === r.readingId && i.outcome_id === o.outcomeId && !taken.has(i.id))
      const got = pickVaried(cands, o.questions, used)
      for (const g of got) { taken.add(g.id); items.push({ itemId: g.id, readingId: r.readingId, outcomeId: g.outcome_id, requestedOutcomeId: o.outcomeId }); deliveredHere++ }
    }
    const missing = r.questions - deliveredHere
    if (missing > 0) {
      const cands = pool.filter(i => i.lm_id === r.readingId && !taken.has(i.id))
      const got = pickVaried(cands, missing, used)
      for (const g of got) { taken.add(g.id); items.push({ itemId: g.id, readingId: r.readingId, outcomeId: g.outcome_id, requestedOutcomeId: null }); deliveredHere++ }
    }
  }

  // Interleave readings so the paper is not blocked by reading, then a stable shuffle within.
  const byReading = new Map<string, AssembledItem[]>()
  for (const it of items) byReading.set(it.readingId, [...(byReading.get(it.readingId) ?? []), it])
  const queues = [...byReading.values()].map(q => q.sort(() => Math.random() - 0.5))
  const ordered: AssembledItem[] = []
  for (let round = 0; ordered.length < items.length; round++) for (const q of queues) if (q[round]) ordered.push(q[round])

  const perReading = bp.perReading.map(r => ({ readingId: r.readingId, wanted: r.questions, delivered: items.filter(i => i.readingId === r.readingId).length }))
  const meta = new Map(pool.map(p => [p.id, p]))
  const count = (key: (p: Pool) => string) => { const m: Record<string, number> = {}; for (const it of ordered) { const p = meta.get(it.itemId)!; const k = key(p); m[k] = (m[k] ?? 0) + 1 } return m }
  return {
    items: ordered, requested: bp.perReading.reduce((s, r) => s + r.questions, 0), delivered: ordered.length, perReading,
    shortfalls: perReading.filter(r => r.delivered < r.wanted),
    balance: { difficulty: count(p => p.intended_difficulty ?? 'unset'), cognition: count(p => p.cognition ?? 'unset'), form: count(p => p.item_form ?? 'unset'), keyPosition: count(p => String(p.key_index)) },
  }
}
