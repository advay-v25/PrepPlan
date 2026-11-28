# Question bank and background resources: scope and readiness

The owner's scope clarification is authoritative: this chat owns the **content workstream (C0–C11, Passes A–F)**—curriculum intelligence, reference preparation, concept specifications, question authoring, validation, and reviewer-ready exports. Another agent owns the application revamp and software functionality.

## Five-part readiness breakdown

1. **Source processed vs. reliable extraction:** All 16 supplied PDFs (10 official 2027 volumes, 2 prerequisite books, 4 Schweser 2027 scanned supplements) were processed. All 48 Schweser OCR pages with `meanConfidence < 0.95` were visually inspected offline ([b1-source-qa-reconciliation.json](output/question-bank/2027/b1-source-qa-reconciliation.json): raw OCR excluded, `0` bank items relying on excluded regions, `0` human sign-offs), and the September 2026 39-page 2027 Level I errata notice was audited ([b2-errata-impact-register.json](output/question-bank/2027/b2-errata-impact-register.json)).
2. **Candidate coverage vs. genuine concept coverage & sustainable depth:** `missingTierOutcomes` is `0` across all 343 outcomes (`344` substantive concepts, `0` bare stubs in [c2-curriculum-manifest.json](output/question-bank/2027/c2-curriculum-manifest.json)). However, [c6-demand-and-capacity.json](output/question-bank/2027/c6-demand-and-capacity.json) explicitly records that non-FSA/non-ETH outcomes typically carry `3` routine families (1 per tier)—enough for 1 initial diagnostic plus cross-tier repair re-check, but below the `>= 6` independent families needed for repeated same-tier adaptive sets and spaced rechecks.
3. **Proposed vs. confirmed difficulty & family independence:** All `intendedDifficulty` and `familyProposal` assignments remain **provisional** (`0` human confirmations). Offline revisions upgraded `pp-2027-c5-r023-a-hard` (`integrate`) and `pp-ref2027-r094-a-hard` (`diagnose`) and replaced 4 high-similarity cross-pool mock items (`e1-cross-pool-similarity.json`: `16` remaining pairs >= 0.45, max similarity `0.59`).
4. **Deterministic/self-check vs. independent solve & expert review:** Deterministic pipeline rebuild (`bankContentHash: 98927ecb0bb75408eb09bfec23f7d282d197e89b5171fda4b270f5bef998620b`), `tsc --noEmit --incremental false`, `c4-repair-regression-test.ts` (`1,230` items, `77` giveaway items), and `238` numeric formula checks pass. Independent CFA-qualified blind solves remain `0`.
5. **Reviewer-ready vs. approved for distribution:** [review.html](output/question-bank/2027/review.html) (`1230 unapproved drafts`, `publicationControls: false`) and all exports are reviewer-ready; `releaseEligible` is `false` (`humanApprovals: 0`, `learnerEligible: 0`, `heldOutEligible: 0`, `rights.state: "unconfirmed"`).

## Current content package (`output/question-bank/2027/`)

- **Total drafts:** **1,230** across **343 outcomes**, **102 readings**, and **10 subjects** (`bankContentHash: 98927ecb0bb75408eb09bfec23f7d282d197e89b5171fda4b270f5bef998620b`).
  - **Routine pool:** **1,040** drafts (`missingTierOutcomes: 0`).
  - **Held-out mock pool:** **190** dedicated drafts (`90` Session 1 + `90` Session 2 + `10` reserve) with **0 cross-pool family leakage**.
  - **Locked evaluation pack (`c8-evaluation-pack.json`):** Ineligible for student serving.
- **Validation & audit summary (`validation.json`, `d1-format-adjudication.json`, `c3-support-matrix.json`):**
  - **238 numeric formulas executed**, **0 identical distractor diagnoses**, **0 8-gram overlap flags**, **0 strict giveaway absolutes** (`46` contextual `"all"` phrases).
  - **152** raw `formatRules.ts` flags adjudicated as `falsePositiveDigitsInProse` (`genuineFormatDefects: 0`; `156` `>= 2x` answer-length outliers queued for optional editorial tightening).
  - **1,230** items support-audited in `c3-support-matrix.json` (`strong: 821`, `moderate: 248`, `weak: 161`).

## Software-agent integration handoff (read-only)

- **Primary export:** `output/question-bank/2027/draft-bank.json` (`schema: reference-draft-bank.2`) and `draft-bank.jsonl`
- **Offline review:** `output/question-bank/2027/review.html`, `<subject>-blind.md`, `<subject>-answers.md`, `coverage.csv`, `answer-key.csv`
- **Curriculum, demand & evaluation manifests:** `c2-curriculum-manifest.json`, `c3-support-matrix.json`, `c6-demand-and-capacity.json`, `c7-heldout-mock-blueprint.json`, `c8-evaluation-pack.json`, `c8-validation-ledger.json`, `d1-format-adjudication.json`, `e1-cross-pool-similarity.json`, `b1-source-qa-reconciliation.json`, `b2-errata-impact-register.json`, `validation.json`
- **Contract note:** `src/lib/diagnostic/formatRules.ts` (`orderingValue`) flags prose options containing digits as `FORMAT_MIXED_OPTION_TYPES` / `FORMAT_NUMERIC_ORDER`; left untouched per content-only scope.

## Human-only remainder (`C10-HUMAN-ACTION-CHECKLIST.md`)

1. Establish and record the source-input and commercial distribution rights basis (`rights.state` on the 16 sources and 343 packs).
2. Human sign-off on the 48 Schweser formula-suspect OCR pages (`b1-source-qa-reconciliation.json`), spot-check of the 161 weak machine-overlap items (`c3-support-matrix.json`), and confirmation of September 2026 errata reconciliations (`b2-errata-impact-register.json`).
3. Have CFA-qualified reviewers blind-solve `<subject>-blind.md`, verify keys/difficulty/families/scope (including `< 6` routine family capacity and 16 cross-pool pairs >= 0.45), and record exact-version approvals through the authorized review workflow.
