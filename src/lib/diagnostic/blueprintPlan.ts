import { BlueprintCell, Cognition, Difficulty, ItemForm } from './types'

/**
 * Blueprint construction (§4.2, §4.3).
 *
 * The blueprint is built before any item is drafted. Its purpose is to decide
 * coverage by quota rather than by whatever the generator finds easy to write —
 * a generator left to choose its own targets produces calculation items about
 * the two or three concepts with the cleanest formulas, which is exactly the
 * sampling bias a diagnostic must not have.
 *
 * Quotas are allocated as exact integer counts, so "blueprint coverage: 100% of
 * declared quotas satisfied" (§12.2) is a fact that can be checked rather than
 * an aspiration.
 */

export type ConceptSlice = {
  id: string
  name: string
  topic: string
  module: string
  scopeNotes: string
  importance: 'core' | 'supporting' | 'peripheral'
}

/**
 * Valid cognition/item-form pairings, with the weight each carries in a module
 * diagnostic. Pairings are constrained because most combinations are incoherent:
 * a "recall" item in "calculation" form is not a recall item.
 */
const PAIR_WEIGHTS: { cognition: Cognition; itemForm: ItemForm; weight: number }[] = [
  { cognition: 'recall', itemForm: 'direct', weight: 8 },
  { cognition: 'recall', itemForm: 'exception', weight: 5 },
  { cognition: 'interpret', itemForm: 'scenario', weight: 12 },
  { cognition: 'interpret', itemForm: 'data_table', weight: 8 },
  { cognition: 'apply', itemForm: 'scenario', weight: 14 },
  { cognition: 'apply', itemForm: 'direct', weight: 6 },
  { cognition: 'calculate', itemForm: 'calculation', weight: 18 },
  { cognition: 'calculate', itemForm: 'data_table', weight: 9 },
  { cognition: 'compare', itemForm: 'scenario', weight: 7 },
  { cognition: 'compare', itemForm: 'exception', weight: 4 },
  { cognition: 'diagnose', itemForm: 'scenario', weight: 6 },
  { cognition: 'integrate', itemForm: 'integrated', weight: 3 },
]

const DIFFICULTY_WEIGHTS: { difficulty: Difficulty; weight: number }[] = [
  { difficulty: 'foundation', weight: 25 },
  { difficulty: 'standard', weight: 45 },
  { difficulty: 'difficult', weight: 25 },
  { difficulty: 'stretch', weight: 5 },
]

/**
 * Largest-remainder allocation. Guarantees the parts sum to exactly `total`,
 * which proportional rounding does not.
 */
function allocate<T>(weighted: { weight: number }[] & T[], total: number): number[] {
  const sum = weighted.reduce((acc, w) => acc + w.weight, 0)
  const exact = weighted.map(w => (w.weight / sum) * total)
  const floors = exact.map(Math.floor)
  let remaining = total - floors.reduce((a, b) => a + b, 0)

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)

  for (const { index } of order) {
    if (remaining <= 0) break
    floors[index]++
    remaining--
  }
  return floors
}

/** Deterministic PRNG so a blueprint is reproducible from its seed. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export type BlueprintQuota = {
  pairs: { cognition: Cognition; itemForm: ItemForm; count: number }[]
  difficulties: { difficulty: Difficulty; count: number }[]
  conceptCounts: Record<string, number>
  total: number
  seed: number
}

export type BlueprintPlan = {
  cells: BlueprintCell[]
  quota: BlueprintQuota
}

/**
 * Builds `total` blueprint cells across the supplied concepts.
 *
 * Concepts are assigned round-robin over a shuffled order, so with 20 items and
 * 8 concepts every concept gets two or three items and none is skipped. Core
 * concepts are entered twice in the rotation, so weight follows importance
 * without any concept dropping to zero.
 */
export function buildBlueprint(concepts: ConceptSlice[], total: number, seed = Date.now()): BlueprintPlan {
  if (concepts.length === 0) throw new Error('cannot build a blueprint with no concepts')
  if (total < 1) throw new Error('blueprint total must be at least 1')

  const random = mulberry32(seed)

  const pairCounts = allocate(PAIR_WEIGHTS as any, total)
  const difficultyCounts = allocate(DIFFICULTY_WEIGHTS as any, total)

  const pairPool: { cognition: Cognition; itemForm: ItemForm }[] = []
  PAIR_WEIGHTS.forEach((pair, i) => {
    for (let n = 0; n < pairCounts[i]; n++) pairPool.push({ cognition: pair.cognition, itemForm: pair.itemForm })
  })

  const difficultyPool: Difficulty[] = []
  DIFFICULTY_WEIGHTS.forEach((d, i) => {
    for (let n = 0; n < difficultyCounts[i]; n++) difficultyPool.push(d.difficulty)
  })

  const shuffledPairs = shuffle(pairPool, random)
  const shuffledDifficulties = shuffle(difficultyPool, random)

  // Rotation weighted by importance, but every concept appears at least once.
  const rotation: ConceptSlice[] = []
  for (const concept of concepts) {
    rotation.push(concept)
    if (concept.importance === 'core') rotation.push(concept)
  }
  const shuffledRotation = shuffle(rotation, random)

  const conceptCounts: Record<string, number> = {}
  const cells: BlueprintCell[] = []

  for (let i = 0; i < total; i++) {
    const concept = shuffledRotation[i % shuffledRotation.length]
    const pair = shuffledPairs[i]
    const difficulty = shuffledDifficulties[i]

    conceptCounts[concept.id] = (conceptCounts[concept.id] ?? 0) + 1
    cells.push({
      conceptId: concept.id,
      conceptName: concept.name,
      topic: concept.topic,
      module: concept.module,
      conceptScope: concept.scopeNotes,
      cognition: pair.cognition,
      itemForm: pair.itemForm,
      difficulty,
    })
  }

  return {
    cells,
    quota: {
      pairs: PAIR_WEIGHTS.map((p, i) => ({ cognition: p.cognition, itemForm: p.itemForm, count: pairCounts[i] })),
      difficulties: DIFFICULTY_WEIGHTS.map((d, i) => ({ difficulty: d.difficulty, count: difficultyCounts[i] })),
      conceptCounts,
      total,
      seed,
    },
  }
}

/**
 * Checks a set of released items against the quota that was declared before
 * generation. Reported by the pilot runner as the §12.2 blueprint-coverage
 * metric.
 */
export function checkCoverage(
  quota: BlueprintQuota,
  released: { cognition: Cognition; itemForm: ItemForm; difficulty: Difficulty; conceptId: string }[]
): { satisfied: boolean; shortfalls: string[] } {
  const shortfalls: string[] = []

  for (const pair of quota.pairs) {
    if (pair.count === 0) continue
    const actual = released.filter(r => r.cognition === pair.cognition && r.itemForm === pair.itemForm).length
    if (actual < pair.count) {
      shortfalls.push(`${pair.cognition}/${pair.itemForm}: wanted ${pair.count}, released ${actual}`)
    }
  }

  for (const d of quota.difficulties) {
    if (d.count === 0) continue
    const actual = released.filter(r => r.difficulty === d.difficulty).length
    if (actual < d.count) shortfalls.push(`difficulty ${d.difficulty}: wanted ${d.count}, released ${actual}`)
  }

  for (const [conceptId, wanted] of Object.entries(quota.conceptCounts)) {
    const actual = released.filter(r => r.conceptId === conceptId).length
    if (actual < wanted) shortfalls.push(`concept ${conceptId}: wanted ${wanted}, released ${actual}`)
  }

  return { satisfied: shortfalls.length === 0, shortfalls }
}
