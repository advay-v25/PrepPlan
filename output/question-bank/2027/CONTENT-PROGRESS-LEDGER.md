# PrepPlan 2027 Content & Question-Bank Progress Ledger

- **Baseline Snapshot:** [baseline-index.json](baseline-2026-11-25/baseline-index.json) (536 drafts, hash `721526d5ea2208470b81dba9e21fbc556dd1beaf282c05760e0a551840667726`)
- **Current Offline Package (Passes A–F):** **1,230 drafts** (**1,040 routine** + **190 held-out mock** [`90` S1 + `90` S2 + `10` reserve]), 343 outcomes, 102 readings, 10 subjects; **0 missing outcome-tier cells**; **238 numeric formulas executed**; **0 identical distractor diagnoses**; **0 8-gram overlap flags**; **0 strict giveaway absolutes** (`46` contextual `"all"` phrases); **0 genuine format defects** (`152` false-positive prose-digit flags in [d1-format-adjudication.json](d1-format-adjudication.json)); **0 cross-pool family leakage** (`16` cross-pool pairs >= 0.45, max `0.59` in [e1-cross-pool-similarity.json](e1-cross-pool-similarity.json)); `bankContentHash: 98927ecb0bb75408eb09bfec23f7d282d197e89b5171fda4b270f5bef998620b`.
- **Human-Approved Distribution Status:** **0 human approvals, 0 confirmed independent families, 0 cleared source packs (`releaseEligible: false`)**.

## Five-Part Readiness Separation

1. **Source processed vs. reliable extraction:** All 16 supplied PDFs were processed, including 48 Schweser OCR pages inspected offline ([b1-source-qa-reconciliation.json](b1-source-qa-reconciliation.json)) and the September 2026 39-page 2027 Level I errata notice audited ([b2-errata-impact-register.json](b2-errata-impact-register.json)); raw OCR exclusions remain isolated with 0 bank items relying on excluded regions, while human visual sign-off remains `0`.
2. **Candidate coverage vs. genuine concept coverage & sustainable depth:** `missingTierOutcomes` is `0` across all 343 outcomes (`344` substantive concepts, `0` bare stubs in [c2-curriculum-manifest.json](c2-curriculum-manifest.json)), but [c6-demand-and-capacity.json](c6-demand-and-capacity.json) documents that non-FSA/non-ETH outcomes typically carry `3` routine families (`< 6` independent families needed for repeated same-tier adaptive sets and spaced rechecks).
3. **Proposed vs. confirmed difficulty/family independence:** All difficulty tiers and family assignments remain `provisional` until CFA-qualified review; `pp-2027-c5-r023-a-hard` and `pp-ref2027-r094-a-hard` were upgraded offline to `integrate`/`diagnose` demand.
4. **Deterministic/self-check vs. independent solve & expert review:** Deterministic pipeline checks, `tsc --noEmit`, `c4-repair-regression-test.ts` (`1,230` items, `77` giveaway items), and `238` numeric checks pass; independent CFA-qualified blind solves remain `0`.
5. **Reviewer-ready vs. approved for distribution:** `review.html` and exports are reviewer-ready (`publicationControls: false`); `releaseEligible` is `false` pending rights clearance and human approvals.

## Phase Status

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| C0 | Baseline, ownership & ledger | `offline_complete` | `baseline-2026-11-25/`, `content-ledger.json` |
| C1 | Source intake, local Vision OCR, 48-page QA & errata audit | `offline_complete` | `source-intake.json`, `c1-extraction-qa.json`, `b1-source-qa-reconciliation.json`, `b2-errata-impact-register.json` |
| C2 | Canonical curriculum, 344 substantive concepts (0 bare stubs) & prereqs | `offline_complete` | `c2-curriculum-manifest.json`, `c2-prerequisite-map.json` |
| C3 | Multi-anchor packs & full 1,230-item support audit (821 strong / 248 mod / 161 weak) | `offline_complete` | `c3-support-matrix.json` |
| C4 | Text-anchored repairs, giveaway/overlap/difficulty fixes & regression tests | `offline_complete` | `c4-defect-register.json`, `c4-repairs.ts`, `c4-repair-regression-test.ts`, `pass-d-e-revisions.ts` |
| C5 | Substantive breadth (0 empty outcome-tier cells) | `offline_complete` | `coverage-and-review.json`, `expansion/c5-*.ts` |
| C6 | Policy-derived routine demand & `<6` family shortage register | `offline_complete` | `c6-demand-and-capacity.json` |
| C7 | Dedicated 2×90 held-out mock candidate bank (`190` items: `90+90+10` reserve) | `offline_complete` | `c7-heldout-mock-blueprint.json`, `c7-heldout-mock-1-s*.ts` |
| C8 | Validation ledger, format adjudication (`d1`), cross-pool check (`e1`), eval pack | `offline_complete` | `c8-validation-ledger.json`, `c8-evaluation-pack.json`, `d1-format-adjudication.json`, `e1-cross-pool-similarity.json` |
| C9 | Versioned JSON/JSONL, blind/answer MD, CSV, `review.html`, `validation.json` | `offline_complete` | `draft-bank.json`, `review.html`, `*-blind.md`, `validation.json` |
| C10 | Human rights & qualified expert review queues | `human_review_pending` | `C10-HUMAN-ACTION-CHECKLIST.md`, `c10-human-review-package.json` |
| C11 | Final content audit, 5-part truth table & software handoff | `offline_complete` | `docs/QUESTION-BANK-CONTENT-READINESS.md` |
