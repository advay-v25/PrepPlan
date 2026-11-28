# Phase 3 Adaptive Practice Policy Contract & Test Vectors

Status: **Specification & executable test vectors only (Phase 1)**. Runtime selection in [`adaptivePractice.ts`](file:///Users/advay/Documents/Structured%20Learning%20App/src/lib/tests/adaptivePractice.ts) and [`difficultyPolicy.ts`](file:///Users/advay/Documents/Structured%20Learning%20App/src/lib/tests/difficultyPolicy.ts) is unchanged in Phase 1. Five-question-set adaptive practice, frozen scored papers, timed practice, repair re-checks, and full mocks remain on their current paths.

## 1. Policy Contract

- **Tiers & Mapping:** `Easy` (`foundation`) ↔ `Medium` (`standard`) ↔ `Hard` (`difficult`). Legacy `stretch` is excluded.
- **Initial State:** Every new item-by-item adaptive practice run starts at `targetTier = Easy` and freezes `policyVersion = 'adaptive-item.1'` on the run record.
- **Transition Rule (Server-Committed Scored Choice Only):**
  - After the server commits a scored choice (`outcome: 'correct' | 'incorrect'`):
    - `correct` → step up one tier, clamped at `Hard` (`Easy → Medium`, `Medium → Hard`, `Hard → Hard`).
    - `incorrect` → step down one tier, clamped at `Easy` (`Hard → Medium`, `Medium → Easy`, `Easy → Easy`).
  - **Non-transitioning outcomes:** `omitted`, `disputed`, `void`, or a duplicate/replayed `requestKey` for an already committed response **never** trigger a transition (`nextTier = currentTier`).
- **Feedback & Reservation Consistency:** Feedback returned to the client and the next-item reservation must read from the **same** committed outcome. No online model call decides the next question.
- **Refresh, Retry & Replay:**
  - Same-answer retry / lost-response replay with the same `requestKey` returns the original receipt and already-reserved next item without advancing the sequence or applying a second transition.
  - Page refresh reads the persisted delivered sequence and current reserved item in order; already delivered items are never reordered or replaced.
- **Invalidation Timing (Dispute / Void):**
  - **Before next item is reserved:** If an answered item is voided/disputed before the next item is reserved, the transition is recomputed from the prior valid committed state (so the voided item causes no tier step).
  - **After next item is reserved:** Already-delivered and already-reserved items remain frozen in the run's delivered sequence (no retroactive swap of the reserved question). Subsequent transitions after the invalidated item compute from the last valid scored state prior to the voided item (or hold at the current tier if no valid scored outcome occurred on that step).
- **Deterministic Target Tier vs. Item Availability:**
  - Compute `targetTier` deterministically first, independent of pool counts.
  - Eligible pool: `student_eligible_items` (human-reviewed exact current version, routine `is_held_out = false`, `difficulty_basis = 'confirmed'`, matching `difficulty_level` for `targetTier`, matching `readingId` / `outcomeIds`, fresh for this student, and `family_id` not yet used in this run).
  - Selection order: stable sort or seeded PRNG (`seededRandom`) over persisted run/pool inputs.
  - **Shortage / Exhaustion:** If `targetTier` has 0 eligible items, finish the run immediately with `status = 'finished_shortage'`, recording `shortageTargetTier` and `shortageReason`. **Never** silently widen scope, repeat a family, substitute another tier, or borrow from held-out mocks.

## 2. Executable Test Vectors (`scripts/phase3-adaptive-vectors-test.ts`)

| Vector | Input Sequence / Event | Expected `targetTier` / State |
|---|---|---|
| `V1_UPWARD_LADDER` | Start → `correct` → `correct` | `Easy` → `Medium` → `Hard` |
| `V2_UPPER_CLAMP` | At `Hard` + `correct` | `Hard` (clamped) |
| `V3_LOWER_CLAMP` | At `Easy` + `incorrect` | `Easy` (clamped) |
| `V4_WRONG_AT_HARD_AND_MEDIUM` | `Hard` + `incorrect` → `Medium` + `incorrect` | `Medium` → `Easy` |
| `V5_ALTERNATING` | `Easy` + `correct` → `incorrect` → `correct` → `incorrect` | `Medium` → `Easy` → `Medium` → `Easy` |
| `V6_OMISSION_NO_STEP` | `Medium` + `omitted` | `Medium` (unchanged) |
| `V7_VOID_OR_DISPUTE_NO_STEP` | `Medium` + `disputed` / `void` | `Medium` (unchanged) |
| `V8_DUPLICATE_COMMAND_IDEMPOTENT` | `Easy` + `correct` (key `k1`) replayed with `k1` | Single step to `Medium`, same receipt & reserved item |
| `V9_SAME_ANSWER_RETRY_CONFLICT` | `Easy` + `correct` (`k1`) then `k2` on already-scored item | Refused (`ALREADY_SCORED`), tier stays `Medium` |
| `V10_INVALIDATION_BEFORE_RESERVE` | `Easy` + `correct` → voided before next reserve | Recomputes to `Easy`; next reserve uses `Easy` |
| `V11_INVALIDATION_AFTER_RESERVE` | `Easy` + `correct` → `Medium` item `q2` reserved → `q1` voided | `q2` stays frozen in sequence; next step after `q2` ignores voided `q1` |
| `V12_EXHAUSTION_SHORTAGE` | Target `Hard`, 0 eligible `Hard` items (even if `Medium`/held-out exist) | Run finishes `finished_shortage` (`target=Hard`, no fallback) |
| `V13_REFRESH_PRESERVES_SEQUENCE` | Reload mid-run after `q1` scored & `q2` reserved | Exact `[q1, q2]` order preserved, `policyVersion` frozen |
