import assert from 'node:assert/strict'

export type Tier = 'Easy' | 'Medium' | 'Hard'
export type CommittedOutcome = 'correct' | 'incorrect' | 'omitted' | 'disputed' | 'void'

export type PoolItem = {
  id: string
  familyId: string
  readingId: string
  outcomeId: string
  tier: Tier
  approvedExactVersion: boolean
  reviewerConfirmedTier: boolean
  isHeldOut: boolean
  alreadySeenByStudent: boolean
}

export type DeliveredEntry = {
  itemId: string
  familyId: string
  tier: Tier
  requestKey?: string
  outcome?: CommittedOutcome
  invalidated?: boolean
}

export type AdaptiveRunState = {
  policyVersion: 'adaptive-item.1'
  readingId: string
  outcomeIds?: string[]
  targetTier: Tier
  status: 'active' | 'finished_shortage'
  shortageTargetTier?: Tier
  shortageReason?: string
  delivered: DeliveredEntry[]
  receipts: Map<string, { payloadHash: string; itemId: string; nextTier: Tier; nextReservedItemId: string | null }>
}

const TIERS: Tier[] = ['Easy', 'Medium', 'Hard']

export function stepTier(current: Tier, outcome: CommittedOutcome): Tier {
  if (outcome === 'correct') return TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(current) + 1)]
  if (outcome === 'incorrect') return TIERS[Math.max(0, TIERS.indexOf(current) - 1)]
  return current
}

export function selectEligibleItem(run: AdaptiveRunState, pool: PoolItem[]): PoolItem | null {
  const usedFamilies = new Set(run.delivered.map(d => d.familyId))
  const allowedOutcomes = run.outcomeIds?.length ? new Set(run.outcomeIds) : null
  const eligible = pool
    .filter(
      p =>
        p.approvedExactVersion &&
        p.reviewerConfirmedTier &&
        !p.isHeldOut &&
        !p.alreadySeenByStudent &&
        p.readingId === run.readingId &&
        (!allowedOutcomes || allowedOutcomes.has(p.outcomeId)) &&
        p.tier === run.targetTier &&
        !usedFamilies.has(p.familyId)
    )
    .sort((a, b) => a.id.localeCompare(b.id))
  return eligible[0] ?? null
}

export function startRun(readingId: string, pool: PoolItem[], outcomeIds?: string[]): AdaptiveRunState {
  const run: AdaptiveRunState = {
    policyVersion: 'adaptive-item.1',
    readingId,
    ...(outcomeIds ? { outcomeIds } : {}),
    targetTier: 'Easy',
    status: 'active',
    delivered: [],
    receipts: new Map(),
  }
  const first = selectEligibleItem(run, pool)
  if (!first) {
    run.status = 'finished_shortage'
    run.shortageTargetTier = 'Easy'
    run.shortageReason = 'No eligible Easy routine item available.'
    return run
  }
  run.delivered.push({ itemId: first.id, familyId: first.familyId, tier: 'Easy' })
  return run
}

export function commitAndReserveNext(
  run: AdaptiveRunState,
  itemId: string,
  outcome: CommittedOutcome,
  requestKey: string,
  pool: PoolItem[],
  opts?: { reserveNext?: boolean }
): { ok: true; replay: boolean; nextTier: Tier; nextItemId: string | null } | { ok: false; code: 'ALREADY_SCORED' | 'RUN_CLOSED' | 'KEY_CONFLICT' } {
  const payloadHash = `${itemId}:${outcome}:${opts?.reserveNext !== false}`
  const cached = run.receipts.get(requestKey)
  if (cached) {
    if (cached.payloadHash !== payloadHash) return { ok: false, code: 'KEY_CONFLICT' }
    return { ok: true, replay: true, nextTier: cached.nextTier, nextReservedItemId: cached.nextReservedItemId } as any
  }
  if (run.status !== 'active') return { ok: false, code: 'RUN_CLOSED' }
  const entry = run.delivered.find(d => d.itemId === itemId)
  if (!entry || entry.outcome !== undefined) return { ok: false, code: 'ALREADY_SCORED' }

  entry.outcome = outcome
  entry.requestKey = requestKey
  if (outcome === 'void' || outcome === 'disputed') entry.invalidated = true

  run.targetTier = stepTier(run.targetTier, outcome)

  let nextItemId: string | null = null
  if (opts?.reserveNext !== false) {
    const next = selectEligibleItem(run, pool)
    if (!next) {
      run.status = 'finished_shortage'
      run.shortageTargetTier = run.targetTier
      run.shortageReason = `No eligible ${run.targetTier} routine item available.`
    } else {
      run.delivered.push({ itemId: next.id, familyId: next.familyId, tier: run.targetTier })
      nextItemId = next.id
    }
  }
  run.receipts.set(requestKey, { payloadHash, itemId, nextTier: run.targetTier, nextReservedItemId: nextItemId })
  return { ok: true, replay: false, nextTier: run.targetTier, nextItemId }
}

export function invalidateItem(run: AdaptiveRunState, itemId: string): void {
  const idx = run.delivered.findIndex(d => d.itemId === itemId)
  if (idx < 0) return
  run.delivered[idx].invalidated = true
  // Recompute targetTier from valid scored entries only; never mutate already-delivered/reserved entries.
  let tier: Tier = 'Easy'
  for (const d of run.delivered) {
    if (!d.invalidated && d.outcome) tier = stepTier(tier, d.outcome)
  }
  run.targetTier = tier
}

function makePool(): PoolItem[] {
  return [
    { id: 'e1', familyId: 'fe1', readingId: 'r032', outcomeId: 'r032-a', tier: 'Easy', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'e2', familyId: 'fe2', readingId: 'r032', outcomeId: 'r032-b', tier: 'Easy', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'e3', familyId: 'fe3', readingId: 'r032', outcomeId: 'r032-c', tier: 'Easy', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'm1', familyId: 'fm1', readingId: 'r032', outcomeId: 'r032-a', tier: 'Medium', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'm2', familyId: 'fm2', readingId: 'r032', outcomeId: 'r032-b', tier: 'Medium', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'h1', familyId: 'fh1', readingId: 'r032', outcomeId: 'r032-a', tier: 'Hard', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'h2', familyId: 'fh2', readingId: 'r032', outcomeId: 'r032-b', tier: 'Hard', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    // Ineligible controls (must never be selected)
    { id: 'h_heldout', familyId: 'fhh', readingId: 'r032', outcomeId: 'r032-c', tier: 'Hard', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: true, alreadySeenByStudent: false },
    { id: 'h_unapproved', familyId: 'fhu', readingId: 'r032', outcomeId: 'r032-c', tier: 'Hard', approvedExactVersion: false, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'h_unconfirmed', familyId: 'fhnc', readingId: 'r032', outcomeId: 'r032-c', tier: 'Hard', approvedExactVersion: true, reviewerConfirmedTier: false, isHeldOut: false, alreadySeenByStudent: false },
    { id: 'hz_dup_fam', familyId: 'fh1', readingId: 'r032', outcomeId: 'r032-c', tier: 'Hard', approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
  ]
}

function runVectors() {
  const pool = makePool()

  // V1-V4: Upward ladder, upper clamp, wrong at Hard & Medium, lower clamp
  assert.equal(stepTier('Easy', 'correct'), 'Medium')
  assert.equal(stepTier('Medium', 'correct'), 'Hard')
  assert.equal(stepTier('Hard', 'correct'), 'Hard')
  assert.equal(stepTier('Hard', 'incorrect'), 'Medium')
  assert.equal(stepTier('Medium', 'incorrect'), 'Easy')
  assert.equal(stepTier('Easy', 'incorrect'), 'Easy')

  // V5: Alternating results
  let t: Tier = 'Easy'
  for (const out of ['correct', 'incorrect', 'correct', 'incorrect'] as CommittedOutcome[]) t = stepTier(t, out)
  assert.equal(t, 'Easy')

  // V6-V7: Omission, dispute, void cause no step
  for (const out of ['omitted', 'disputed', 'void'] as CommittedOutcome[]) {
    assert.equal(stepTier('Medium', out), 'Medium')
  }

  // V8-V9: Duplicate command idempotency & same-answer retry conflict
  const r1 = startRun('r032', pool)
  assert.equal(r1.policyVersion, 'adaptive-item.1')
  assert.equal(r1.delivered[0].itemId, 'e1')
  const c1 = commitAndReserveNext(r1, 'e1', 'correct', 'k1', pool)
  assert.equal(c1.ok, true)
  if (c1.ok) {
    assert.equal(c1.nextTier, 'Medium')
    assert.equal(c1.nextItemId, 'm1')
  }
  const replay = commitAndReserveNext(r1, 'e1', 'correct', 'k1', pool)
  assert.equal(replay.ok, true)
  if (replay.ok) assert.equal(replay.replay, true)
  assert.equal(r1.delivered.length, 2)

  const conflict = commitAndReserveNext(r1, 'e1', 'correct', 'k2', pool)
  assert.deepEqual(conflict, { ok: false, code: 'ALREADY_SCORED' })
  assert.equal(r1.targetTier, 'Medium')

  // V10: Invalidation BEFORE next question is reserved
  const r2 = startRun('r032', pool)
  commitAndReserveNext(r2, 'e1', 'correct', 'k1', pool, { reserveNext: false })
  assert.equal(r2.targetTier, 'Medium')
  invalidateItem(r2, 'e1')
  assert.equal(r2.targetTier, 'Easy')
  const nextAfterVoid = selectEligibleItem(r2, pool)
  assert.equal(nextAfterVoid?.id, 'e2')

  // V11: Invalidation AFTER next question is reserved (already-reserved m1 stays frozen; next step recomputes)
  const r3 = startRun('r032', pool)
  commitAndReserveNext(r3, 'e1', 'correct', 'k1', pool)
  assert.deepEqual(r3.delivered.map(d => d.itemId), ['e1', 'm1'])
  invalidateItem(r3, 'e1')
  assert.deepEqual(r3.delivered.map(d => d.itemId), ['e1', 'm1'])
  assert.equal(r3.targetTier, 'Easy')

  // V12-V13: Exhaustion / shortage (never falls back to held-out, unapproved, unconfirmed, or duplicate family) + refresh sequence preservation
  const r4 = startRun('r032', pool)
  commitAndReserveNext(r4, 'e1', 'correct', 'k1', pool) // -> m1
  commitAndReserveNext(r4, 'm1', 'correct', 'k2', pool) // -> h1
  commitAndReserveNext(r4, 'h1', 'correct', 'k3', pool) // -> h2
  const exhaust = commitAndReserveNext(r4, 'h2', 'correct', 'k4', pool) // -> shortage at Hard!
  assert.equal(exhaust.ok, true, `exhaust failed: ${JSON.stringify(exhaust)} delivered=${JSON.stringify(r4.delivered)}`)
  assert.equal(r4.status, 'finished_shortage')
  assert.equal(r4.shortageTargetTier, 'Hard')
  assert.deepEqual(r4.delivered.map(d => d.itemId), ['e1', 'm1', 'h1', 'h2'])

  // V14: Foreign outcome in the same reading (run scoped to r032-a only; r032-b Medium m2 is excluded -> shortage)
  const r5 = startRun('r032', pool, ['r032-a'])
  assert.equal(r5.delivered[0].itemId, 'e1')
  const c5 = commitAndReserveNext(r5, 'e1', 'correct', 'k1', pool) // reserves m1 (r032-a)
  assert.equal(c5.ok, true)
  if (c5.ok) assert.equal(c5.nextItemId, 'm1')
  const r5b = startRun('r032', pool.filter(p => p.id !== 'm1'), ['r032-a'])
  const c5b = commitAndReserveNext(r5b, 'e1', 'correct', 'k1', pool.filter(p => p.id !== 'm1'))
  assert.equal(c5b.ok, true)
  assert.equal(r5b.status, 'finished_shortage') // m2 is in r032-b (same reading, foreign outcome), never selected!

  // V15: Previously exposed sibling family (e1_sibling shares family fe1 with e1 -> excluded even if unseen item id)
  const poolWithSibling = [
    ...pool.filter(p => p.id === 'e1'),
    { id: 'e1_sib', familyId: 'fe1', readingId: 'r032', outcomeId: 'r032-a', tier: 'Easy' as const, approvedExactVersion: true, reviewerConfirmedTier: true, isHeldOut: false, alreadySeenByStudent: false },
  ]
  const r6 = startRun('r032', poolWithSibling)
  commitAndReserveNext(r6, 'e1', 'incorrect', 'k1', poolWithSibling) // stays Easy, must NOT pick e1_sib (same family fe1)
  assert.equal(r6.status, 'finished_shortage')

  // V16: Mutated payload with a reused request key -> KEY_CONFLICT
  const r7 = startRun('r032', pool)
  commitAndReserveNext(r7, 'e1', 'correct', 'k1', pool)
  const mutated = commitAndReserveNext(r7, 'e1', 'incorrect', 'k1', pool)
  assert.deepEqual(mutated, { ok: false, code: 'KEY_CONFLICT' })
  assert.equal(r7.targetTier, 'Medium')

  // V17: Second attempt to score the same question with a different request key -> ALREADY_SCORED
  const secondScore = commitAndReserveNext(r7, 'e1', 'incorrect', 'k2', pool)
  assert.deepEqual(secondScore, { ok: false, code: 'ALREADY_SCORED' })
  assert.equal(r7.targetTier, 'Medium')

  console.log('All 17 Phase 3 adaptive practice vectors passed.')
}

runVectors()
