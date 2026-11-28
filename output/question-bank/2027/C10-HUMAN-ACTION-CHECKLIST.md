# C10 Human Action & Qualified Review Checklist

This checklist separates **genuinely human content-use and expert review decisions** from completed offline work. Do not mark any item approved without inspecting the linked exact-version artifact.

## 1. Rights & Distribution Basis (Owner / Legal Counsel)
- **Scope:** All 16 supplied PDFs (10 official 2027 volumes, 2 prerequisite books, 4 Schweser 2027 scanned supplements) and 343 private packs under `content/source-packs/private/reference-2027/packs/`.
- **Current state:** `rights.state = "unconfirmed"`, `permittedUse = "internal_authoring"`, `learnerDistributionAuthorized = false`.
- **Evidence to inspect:** [source-intake.json](source-intake.json), `content/source-packs/private/reference-2027/source-catalogue-c1.json`, and `docs/CONTENT-AUTHORING-WITHOUT-PUBLISHER-DEPENDENCY.md`.
- **Decision needed:** Confirm whether commercial learner distribution will use (a) independently authored first-party packs (`rights.state = "cleared"` with named author/assignment), or (b) licensed third-party terms.
- **How to record:** Update `rights` on new/cleared packs in `content/source-packs/` with explicit `authority`, `version`, and `contentHash` (never overwrite unconfirmed packs silently).

## 2. Source & OCR Visual QA + Errata (Content / Curriculum Reviewer)
- **Scope:**
  - All 48 formula-suspect Schweser OCR pages (`meanConfidence < 0.95`) inspected offline in [b1-source-qa-reconciliation.json](b1-source-qa-reconciliation.json) (`0` human sign-offs; raw OCR excluded; `0` bank items relying on excluded regions).
  - All `1,230` items audited in [c3-support-matrix.json](c3-support-matrix.json) (`strong: 821`, `moderate: 248`, `weak: 161`), with `ethicsStandardsCited` populated.
  - Official September 2026 39-page 2027 CFA Level I errata notice audited in [b2-errata-impact-register.json](b2-errata-impact-register.json).
- **Decision needed:** Human sign-off on the 48 inspected OCR pages, spot-check/anchor confirmation for the 161 weak machine-overlap items, and confirmation of errata reconciliations against official publisher updates.

## 3. Canonical Scope & Concept Sign-Off (CFA-Qualified Reviewer)
- **Scope:** 343 outcomes decomposed into **344 substantive concepts** (`0` bare stubs remaining; `replacedStubLineage` preserved) across 102 readings in [c2-curriculum-manifest.json](c2-curriculum-manifest.json), plus 82 prerequisite links in [c2-prerequisite-map.json](c2-prerequisite-map.json).
- **Decision needed:** Confirm that each concept boundary, IFRS/US GAAP distinction, and prerequisite separation matches examinable 2027 Level I scope.

## 4. Blind Solves, Keys, Difficulty, Families & Editorial Review (CFA-Qualified Reviewer)
- **Scope:** **1,230 quarantined drafts** (`1,040` routine + `190` held-out mock: `90` S1 + `90` S2 + `10` reserve) in [draft-bank.json](draft-bank.json) and [review.html](review.html) (`bankContentHash: 98927ecb0bb75408eb09bfec23f7d282d197e89b5171fda4b270f5bef998620b`).
- **Blind review workflow:**
  1. Solve from `<subject>-blind.md` without viewing keys.
  2. Reconcile against `<subject>-answers.md` and `answer-key.csv`.
  3. Confirm exact `itemVersion`, `intendedDifficulty` (`foundation`/`standard`/`difficult`), `familyProposal` independence (paying attention to the 16 cross-pool pairs >= 0.45 in [e1-cross-pool-similarity.json](e1-cross-pool-similarity.json) and the `< 6` routine family shortages noted in [c6-demand-and-capacity.json](c6-demand-and-capacity.json)), and `poolIntent` (`routine` vs. `held_out_mock`).
  4. Spot-check the `156` `>= 2x` answer-length outliers logged in [d1-format-adjudication.json](d1-format-adjudication.json) (`0` genuine format defects, `0` 8-gram overlap flags, `0` strict giveaway absolutes, `46` contextual `"all"` phrases).
- **How to record:** Use the authorized reviewer workflow (`/app/tests/review/[itemId]` / `/api/diagnostic/items/[id]/review`) once the software agent imports the validated package; never mark items approved offline.
