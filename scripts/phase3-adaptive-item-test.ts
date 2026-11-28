import assert from 'node:assert/strict'
import {
  ADAPTIVE_ITEM_POLICY,
  recomputeTierFromSteps,
  selectAdaptiveItem,
  stepAdaptiveTier,
} from '../src/lib/tests/adaptiveItemPractice'
import type { PoolItem } from '../src/lib/tests/itemPool'

const pool: PoolItem[] = [
  { id: 'e1', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'foundation', cognition: 'recall', item_form: 'direct', key_index: 0, family_id: 'fe1', item_version: 1, level: 'foundation' },
  { id: 'm1', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'standard', cognition: 'apply', item_form: 'scenario', key_index: 1, family_id: 'fm1', item_version: 1, level: 'standard' },
  { id: 'm2_other_out', lm_id: 'r032', outcome_id: 'r032-b', concept_id: 'c2', intended_difficulty: 'standard', cognition: 'apply', item_form: 'scenario', key_index: 2, family_id: 'fm2', item_version: 1, level: 'standard' },
  { id: 'h1', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'difficult', cognition: 'compare', item_form: 'scenario', key_index: 0, family_id: 'fh1', item_version: 1, level: 'difficult' },
  { id: 'h_unconfirmed', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'difficult', cognition: 'compare', item_form: 'scenario', key_index: 0, family_id: 'fhu', item_version: 1, level: null },
  { id: 'h_stretch', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'stretch', cognition: 'integrate', item_form: 'scenario', key_index: 0, family_id: 'fhs', item_version: 1, level: 'stretch' },
  { id: 'e1_sib', lm_id: 'r032', outcome_id: 'r032-a', concept_id: 'c1', intended_difficulty: 'foundation', cognition: 'recall', item_form: 'direct', key_index: 1, family_id: 'fe1', item_version: 1, level: 'foundation' },
]

function main() {
  assert.equal(ADAPTIVE_ITEM_POLICY, 'adaptive-item.1')

  // Ladder & clamps
  assert.equal(stepAdaptiveTier('foundation', 'correct'), 'standard')
  assert.equal(stepAdaptiveTier('standard', 'correct'), 'difficult')
  assert.equal(stepAdaptiveTier('difficult', 'correct'), 'difficult')
  assert.equal(stepAdaptiveTier('difficult', 'incorrect'), 'standard')
  assert.equal(stepAdaptiveTier('standard', 'incorrect'), 'foundation')
  assert.equal(stepAdaptiveTier('foundation', 'incorrect'), 'foundation')

  // Omitted / disputed / void cause no step
  for (const o of ['omitted', 'disputed', 'void'] as const) {
    assert.equal(stepAdaptiveTier('standard', o), 'standard')
  }

  // Recompute after invalidation
  assert.equal(
    recomputeTierFromSteps([
      { committed_outcome: 'correct', invalidated: true },
      { committed_outcome: 'correct', invalidated: false },
    ]),
    'standard'
  )

  // Selection excludes foreign outcome, used family, unconfirmed tier, and stretch
  const pickEasy = selectAdaptiveItem(pool, {
    readingId: 'r032',
    outcomeIds: ['r032-a'],
    targetTier: 'foundation',
    usedFamilyIds: new Set(),
    usedItemIds: new Set(),
    seed: 's1',
  })
  assert.ok(pickEasy && ['e1', 'e1_sib'].includes(pickEasy.id))

  // Sibling family excluded once fe1 is used -> null (shortage)
  const pickSib = selectAdaptiveItem(pool, {
    readingId: 'r032',
    outcomeIds: ['r032-a'],
    targetTier: 'foundation',
    usedFamilyIds: new Set(['fe1']),
    usedItemIds: new Set(['e1']),
    seed: 's2',
  })
  assert.equal(pickSib, null)

  // Foreign outcome in same reading (m2_other_out) excluded when scoped to r032-a
  const pickMed = selectAdaptiveItem(pool, {
    readingId: 'r032',
    outcomeIds: ['r032-a'],
    targetTier: 'standard',
    usedFamilyIds: new Set(['fm1']),
    usedItemIds: new Set(['m1']),
    seed: 's3',
  })
  assert.equal(pickMed, null)

  // Unconfirmed & stretch excluded at difficult
  const pickHard = selectAdaptiveItem(pool, {
    readingId: 'r032',
    outcomeIds: ['r032-a'],
    targetTier: 'difficult',
    usedFamilyIds: new Set(['fh1']),
    usedItemIds: new Set(['h1']),
    seed: 's4',
  })
  assert.equal(pickHard, null)

  console.log('Production adaptiveItemPractice unit checks passed.')
}

main()
