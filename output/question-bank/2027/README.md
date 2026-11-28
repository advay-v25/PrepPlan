# PrepPlan · 2027 draft question bank

Open [review.html](review.html) for offline search, filtering, and blind/answer review (`1230 unapproved drafts`, `publicationControls: false`).

- **1,230 drafts; 343 outcomes; 102 readings; 10 subjects.** `1,040` routine drafts (`0` missing outcome-tier cells) + `190` held-out mock drafts (`90` Session 1 + `90` Session 2 + `10` reserve). `bankContentHash`: `98927ecb0bb75408eb09bfec23f7d282d197e89b5171fda4b270f5bef998620b`.
- [draft-bank.json](draft-bank.json) / [draft-bank.jsonl](draft-bank.jsonl): complete quarantined drafts, keys, worked solutions, distractor explanations, and versioned lineage.
- [coverage.csv](coverage.csv) / [coverage-and-review.json](coverage-and-review.json): tier coverage, review queues, and routine depth metrics.
- Per subject: `<subject>-blind.md`, `<subject>-answers.md`, `<subject>.json`; subject codes `quant`/`econ`/`ci`/`fsa`/`eq`/`fi`/`deriv`/`alt`/`pm`/`eth`.
- [validation.json](validation.json): deterministic checks and remaining unexecuted human/software gates.
- Supporting reconciliation & audit artifacts:
  - [b1-source-qa-reconciliation.json](b1-source-qa-reconciliation.json) (48 Schweser OCR pages inspected offline; 0 human sign-offs)
  - [b2-errata-impact-register.json](b2-errata-impact-register.json) (September 2026 39-page 2027 Level I errata notice audit)
  - [c2-curriculum-manifest.json](c2-curriculum-manifest.json) (344 substantive concepts; 0 bare stubs) & [c3-support-matrix.json](c3-support-matrix.json) (1,230-item support audit: 821 strong, 248 moderate, 161 weak)
  - [d1-format-adjudication.json](d1-format-adjudication.json) (152 raw `formatRules.ts` prose-digit flags, 0 genuine format defects, 156 `>=2x` length outliers)
  - [e1-cross-pool-similarity.json](e1-cross-pool-similarity.json) (16 cross-pool pairs >= 0.45; max similarity 0.59)
  - [c6-demand-and-capacity.json](c6-demand-and-capacity.json) (policy-derived routine depth shortages `< 6` independent families on non-FSA/non-ETH outcomes)
- Current content-only scope, 5-part honesty breakdown, and human-only remainder: [C10-HUMAN-ACTION-CHECKLIST.md](C10-HUMAN-ACTION-CHECKLIST.md) and `docs/QUESTION-BANK-CONTENT-READINESS.md`.

These are **quarantined drafts** (`releaseEligible: false`, `humanApprovals: 0`). No human approvals, confirmed independent families, or commercial learner distribution authorization exist. Do not distribute this private review package as a student bank or rebuild over human review records.
