# Question-Bank Phase 1 — Authoring Pilot & Codex Handoff

Date: 2026-11-24  
Scope: **Question-bank Phase 1 only**. Every pilot item remains **unpublished** (`published: false`, `reviewStatus: 'verified'`, `reviewerConfirmedDifficulty: null`). Runtime selection and shared planning/logging/Tests/Curriculum/deployment files are unchanged.

## 1. Baseline & Inventory

- **Starting HEAD:** `2fdce1db829078c778cb25eeaefb4e8eb1da3c3b` (`2fdce1d`)
- **Pre-edit source fingerprint:** `ac1e5ca10f063cb2` (948 files)
- **Post-edit source fingerprint:** `6a159a7b587dc384` (951 files via `node scripts/source-fingerprint.cjs`)
- **Concurrent revamp worktree:** Preserved all existing modified and untracked files untouched.
- **Read-only live inventory (`npm run bank:capacity`, `npm run bank:matrix -- --topic fsa`, `npm run bank:matrix -- --topic quant`):**
  - Edition: `2027 v1.0` (manifest `11111111-1111-1111-1111-111111111111`)
  - Candidates: `0 raw · 0 automatically checked · 0 quarantined · 0 provisional families`
  - Published by exact-version approval: `0 routine (0 confirmed independent families) · 0 held-out (0 families) · 0 rejected/retired`
  - Servable: `0 of 102 readings · 0 of 0 concepts · 0 full mock(s)` · `343` outcomes below 3-family minimum.
  - Note: Dated Nov 20 audit (`docs/BANK-COVERAGE-2027.md`) recorded `303 raw · 260 auto-checked · 303 quarantined · 0 approved`. Current live DB (`itemsCount: 0, conceptsCount: 0, mapCount: 0, batchesCount: 0`) has 0 rows; Nov 20 audit is retained as historical reference.
- **Canonical target IDs confirmed from `curriculum_readings` and `reading_los`:**
  - `r032` (`fsa`, Reading 32: *Analysis of Inventories*): `r032-a`, `r032-b`, `r032-c`
  - `r004` (`quant`, Reading 4: *The Time Value of Money in Finance*): `r004-a`, `r004-b`, `r004-c`

## 2. Rights & Source-Pack Matrix

- **Quarantined legacy packs (untouched):** `content/source-packs/private/fsa-r032-{a-lcnrv,b-methods,c-disclosure}.json` (`rights.state: "unconfirmed"`, source `CFA Institute 2027 Level I Curriculum, Volume 4...`).
- **Cleared first-party PrepPlan packs (private, git-ignored under `content/source-packs/private/prepplan/`):**

| Pack ID | Outcome | Edition / Version | `factsHash` (prefix) | Rights State & Authority | Permitted Use |
|---|---|---|---|---|---|
| `prepplan-r032-a-lcnrv` | `r032-a` | `2027` / `v1` | `6e0d2e6a338b` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |
| `prepplan-r032-b-methods` | `r032-b` | `2027` / `v1` | `30552b93a7bf` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |
| `prepplan-r032-c-disclosure` | `r032-c` | `2027` / `v1` | `4511f098f5c2` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |
| `prepplan-r004-a-pv` | `r004-a` | `2027` / `v1` | `2eae9e8b75e0` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |
| `prepplan-r004-b-implied` | `r004-b` | `2027` / `v1` | `b143a8561bc2` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |
| `prepplan-r004-c-additivity` | `r004-c` | `2027` / `v1` | `ddfa2bcd97ea` | `cleared` — PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24) | `internal_authoring` |

- **Legacy `r032` item dispositions (`scripts/lib/fsaBank/items-r030-r033.ts`, all `item_version: 1`):** All 9 legacy `r032` items (`q-fsa-r032-{a,b,c}-{easy,medium,hard}`) are marked **`replace`** (mapped to unconfirmed CFAI-derived packs; replaced with 9 independent-family candidates grounded in cleared first-party PrepPlan packs; old definitions untouched).

## 3. Authoring Pilot Package & Codex Review Views

- **Candidate package:** `scripts/fixtures/phase1-pilot-items.ts` — 18 items (3 outcomes × 2 readings × 3 tiers: `foundation`/Easy, `standard`/Medium, `difficult`/Hard; legacy `stretch` untouched). Balanced answer positions: `A=6, B=6, C=6`. All `estimatedSeconds <= 90`.
- **Verifier & artifact generator:** `scripts/phase1-pilot-verify.ts`
- **Per-item matrix:** `docs/evidence/phase1-pilot-matrix.json`
- **Blind review view (stem & options only):** `docs/evidence/phase1-pilot-blind-review.md`
- **Answer & provenance view:** `docs/evidence/phase1-pilot-provenance-review.md`
- **Actual vs. skipped checks:** Deterministic grounding packet, format rules, stem/input defects, key & distractor `mathjs` formula evaluation, rounding/precision separation, near-match family check, and answer-position balance all ran offline (`PASS`). Live LLM writer/blind-solver calls (`generateItemDraft` / `verifyItem` editorial/numeric LLM calls) were **not** run (`skipped` in offline mode; no provider spend).

## 4. Phase 3 Adaptive Practice Contract & Vectors

- **Contract & fixture table:** `docs/PHASE-3-ADAPTIVE-PRACTICE-CONTRACT.md`
- **Executable test vectors:** `scripts/phase3-adaptive-vectors-test.ts` (13 vectors covering upward ladder, both clamps, wrong at Hard/Medium, alternating results, omission/dispute/void/duplicate command, same-answer retry, invalidation before vs. after reserve, exhaustion/shortage, and refresh sequence preservation).

## 5. Verdict

- **Question-Bank Phase 1:** **PASS (software, authoring pilot, deterministic verification, and Phase 3 vectors complete; all 18 candidates remain unpublished awaiting Codex review gate).**
