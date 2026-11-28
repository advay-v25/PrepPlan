# Question-Bank Phase 1 Closeout & Phase 2 Handoff

Date: 2026-11-24  
Scope: **Question-bank Phase 1 editorial closeout + Phase 2 (FSA `r027–r038` & Ethics `r093–r102`)**. All pilot and Phase 2 slice candidates remain **unpublished** (`published: false`, `reviewStatus: 'verified'`, `reviewerConfirmedDifficulty: null`). Runtime adaptive practice, held-out mocks, flashcards, and concurrent app-revamp files are untouched.

## 1. Four Separate Verdicts

1. **Phase 1 Editorial Closeout Verdict: PARTIAL (human approvals remain open)** — All nine revised pilot versions have recorded model blind solves matching their current keys. All six revised Phase 2 versions also have recorded matches, now included in the generated Phase 2 matrix and provenance view. These are carried-forward model checks, not fresh independent solves, human review, mapping/difficulty approval or distribution permission. All 18 pilot and 21 slice candidates pass the November 25 deterministic rerun and remain unpublished.
2. **Phase 2 Launch-Slice Engineering Verdict: PARTIAL.** The 18 pilot and 21 slice candidates pass the offline deterministic checks. The test suite covers selected SQL contracts, and the prior handoff reports public browser smoke. Authenticated app assembly, taking, scoring, and repair journeys still require proof against an isolated Auth and PostgREST stack.
3. **Phase 2 Full-Coverage Verdict: PARTIAL (`8 of 89` FSA/Ethics outcomes have new cleared-pack candidates)** — FSA `3 of 53` (`50` uncovered), Ethics `5 of 36` (`31` uncovered). Quant `r004` (`3` outcomes, `9` Phase 1 pilot items) is reported separately outside the `89`-outcome Phase 2 denominator. All `267` legacy entries (`159` FSA, `108` Ethics) have exact-version offline dispositions (`24` `replace`, `47` `revise`, `196` `keep for review`).
4. **Release-Eligibility Verdict: BLOCKED.** The November 24 handoff reported zero eligible items for its queried target. The offline rerun did not re-observe live inventory. Publishing any item requires use rights, canonical concept sign-off, and exact-version human approval for that item. Full Phase 2 coverage also requires closing gaps across the 81 outcomes with no new candidates.

## 2. Fingerprints & Manifest Reconciliation

- **Starting HEAD:** `2fdce1db829078c778cb25eeaefb4e8eb1da3c3b` (`2fdce1d`)
- **Scoped question-bank fingerprint (`node scripts/bank-fingerprint.cjs`):** `dba10c5a0c8a21d1` (`79` code/fixture files + `14` pack metadata entries; excludes private fact text).
- **Repo source fingerprint (`node scripts/source-fingerprint.cjs`):** `d5beb2654ddc65ca` (`956` files).
- **November 25 audit rerun.** `node --import tsx scripts/phase2-bank-audit.ts --offline` reproduced the 53 FSA and 36 Ethics outcomes using the pinned catalogue and the Ethics structure seed. The audit uses the live catalogue when available. `getCapacityReport()` supplies bank-wide approved versions and family totals. Student-specific fresh capacity stays `null` until it is calculated with the student's exposure and preflight rules. Candidate-family depth is hypothetical. The fingerprint values above describe the earlier handoff.

## 3. Exact-Version Revisions & Review Bundles

- **Phase 1 Pilot (`18` items, `A=5 / B=7 / C=6`):** [`scripts/fixtures/phase1-pilot-items.ts`](file:///Users/advay/Documents/Structured%20Learning%20App/scripts/fixtures/phase1-pilot-items.ts), [`phase1-pilot-matrix.json`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase1-pilot-matrix.json), [`phase1-pilot-blind-review.md`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase1-pilot-blind-review.md), [`phase1-pilot-provenance-review.md`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase1-pilot-provenance-review.md).
- **Phase 2 Slice (`21` items, `A=5 / B=9 / C=7`):** [`scripts/fixtures/phase2-slice-items.ts`](file:///Users/advay/Documents/Structured%20Learning%20App/scripts/fixtures/phase2-slice-items.ts), [`phase2-coverage-matrix.json`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase2-coverage-matrix.json), [`phase2-slice-blind-review.md`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase2-slice-blind-review.md), [`phase2-slice-provenance-review.md`](file:///Users/advay/Documents/Structured%20Learning%20App/docs/evidence/phase2-slice-provenance-review.md).
- **Phase 2 Revisions (`v1 → v2`):** `pp-2027-r095-a-hard` (`v2`), `pp-2027-r095-c-hard` (`v2`), `pp-2027-r095-d-hard` (`v2`), `pp-2027-r095-e-hard` (`v2`), `pp-2027-r032-a-fam4-hard` (`v2`, grounded in `prepplan-r032-a-lcnrv` Fact 5), `pp-2027-r095-a-fam4-hard` (`v2`).

## 4. Proof Scope (SQL Contracts vs. HTTP/Browser)

- **SQL contract scope.** The Phase 2 script passes preselected item IDs to the reservation RPC, seeds repair placement and spacing state, and submits a deliberately short item list for refusal. It asserts scope-source changes after logging, scoring evidence count, re-check spacing, reviewer refusal, and draft exclusion. The November 25 rerun stopped at Postgres `initdb` shared-memory permission before any assertions ran.
- **Public Browser Smoke (`1280×900` & `390×844`):** Verified `/`, `/demo`, `/login`, and `/app/tests` unauthenticated redirect against `next start -p 3141`.
- **Authenticated App HTTP/Browser Journeys:** **BLOCKED** (requires isolated staging Supabase Auth + PostgREST target).

## November 25 continuation

Current evidence and separate phase verdicts: `docs/PHASE-1-5-STATUS-2026-11-25.md` and `docs/evidence/phase1-5-verification-2026-11-25.json`. The local Phase 1 eligibility/frozen-paper, Phase 2 journey, Phase 3 fresh/upgrade/concurrency and Phase 4 linked-session suites now execute successfully. They remain SQL proof, not authenticated app proof. A fresh read-only live inventory audit found zero approved routine and zero approved held-out questions; the outcome matrix records `ABSENT_PACK` as the first blocker for each of the 81 uncovered outcomes.
