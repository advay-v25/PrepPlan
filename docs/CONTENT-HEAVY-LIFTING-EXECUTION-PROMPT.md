# PrepPlan · Heavy-lifting content execution and honest closeout

Continue in `/Users/advay/Documents/Structured Learning App`.

Your task is to **finish the content and background-resource work**, including the substantive audit, repairs, missing authoring, validation and complete review exports. Another agent owns the software revamp. Do the work: do not return only a plan, repeat software tests, or inherit previous completion labels without checking them.

## 1. Scope and instructions

Read `AGENTS.md`, the Ponytail full skill, and:

- `docs/CONTENT-QUESTION-BANK-MASTER-AGENT-PROMPT.md` — C0–C11 content phases and their gates.
- `docs/QUESTION-BANK-CONTENT-READINESS.md` — historical readiness claims to reconcile, not proof of completion.
- `docs/FOUNDER-PRODUCT-DECISIONS.md`.
- `docs/CONTENT-AUTHORING-WITHOUT-PUBLISHER-DEPENDENCY.md`.
- The content rules in the T2 content-pipeline, T3 difficulty and archived diagnostic training/specification documents already identified by the master prompt.

The latest owner instruction is content-only. Edit question-authoring files, private references, content-specific offline tools and content documentation/exports. Read existing application contracts when needed, but do not edit application code, routes, shared format rules, auth, migrations, environment files, shared package/config files or software test harnesses. Do not start app servers, run staging/hosted imports, grant reviewer roles, publish, deploy, commit/push, or revert another agent's work. Software Batch 1/2 results and synthetic fixture questions are irrelevant to the validity of this real draft bank.

Local authoring, local OCR and deterministic content checks may proceed. No paid/external model service, uploaded-source OCR service or fine-tuning run is authorized. If an independent external solve would need authorization, prepare the exact bounded request while continuing everything available locally. Do not substitute a self-check for an independent model or qualified human review.

## 2. Verified starting point and corrections to the previous handoff

Inspect actual files before changing anything. A closeout pass has made further **uncommitted content changes** after the reported 1,220-item milestone:

| Metric | Last observed local state; verify on arrival |
|---|---|
| Bank | **1,230 drafts**, 1,040 routine + 190 held-out candidates |
| Breadth | 343 outcomes / 102 readings; zero empty *proposed* outcome-tier cells |
| Numeric execution | 234 formula checks, not proof of every calculation or formula's correctness |
| Structural key/diagnosis check | No currently detected key labelled as a distractor; check all rows again |
| Remaining warnings | 151 items with raw format flags, 22 source-overlap hints, 100 absolute-wording hints |
| Grounding report | **Only 536 rows** in `c3-support-matrix.json`; it does not audit all 1,230 items |
| Mock allocation | Corrected current 2027 weights; one 90+90 candidate selection and ten reserve candidates |
| Approval | Zero human approvals, confirmed independent families, learner eligibility or new rights clearance |
| Current ordered hash | `6af6a82f26ba34c007acc535bfd26d641fdb93822f3da146ae93a01f108a4b9c` |

The older blanket statement “C0–C9 and C11 complete” is not a reliable verdict. There are still automatic tasks and substantive content questions. In particular, one question per tier does not establish sustainable recheck/practice depth, UUID separation does not establish independent families, and lexical source overlap does not establish semantic support. Do not put these tasks into a human-only remainder just to close the ledger.

Preserved snapshots:

- `output/question-bank/2027/baseline-2026-11-25/` — original 536-item baseline.
- `output/question-bank/2027/closeout-baseline-1220/` — snapshot before the latest closeout repairs.

Current content tools/files:

- `scripts/lib/referenceBank/c4-c9-pipeline.ts` — current expanded-bank builder.
- `scripts/lib/referenceBank/c2-c3-build.ts` — existing concept/pack tooling, with limitations below.
- `scripts/lib/referenceBank/c1-source-qa.py` and `schweser-ocr.swift`.
- `scripts/lib/referenceBank/c4-repairs.ts`, `closeout-revisions.ts`, `authorV2.ts`, and `expansion/`.
- `scripts/lib/referenceBank/expansion/closeout-mock-supplement.ts` — ten new questions filling verified 2027 mock allocation gaps.
- `scripts/reference-bank-review.cjs` — review artifact generator; inspect for outdated hardcoded counts before using it.

Do not run the old `scripts/reference-bank-build.ts` blindly: it was originally the 536-item builder and can overwrite newer output. Likewise, do not run the old C2/C3 builder blindly against updated packs or human decisions. Establish an exact, safe offline rebuild sequence first.

## 3. Pass A — Stabilize content identity and repair-index correctness

### A1. Audit the repair regression

Earlier C4 repairs addressed options by numeric position. The larger seeded batch moved correct options, so some repairs overwrote keys or attached distractor diagnoses to the key. Observed examples included `pp-ref2027-r102-b-hard` with a “leave misleading material unchanged” key despite a corrective-action solution, and an incoherent `pp-ref2027-r094-a-hard` question.

The current offline builder attempts to preserve the 1,220-item answer placement, map C4 repairs to the original 536-item order, and constrain giveaway rewrites to wrong choices using text similarity. **Audit that resolution, especially ambiguous similarity matches.** Replace uncertain heuristic mappings with explicit reviewed option identities or a recorded deterministic mapping. Do not regard “did not overwrite the key” as proof that the wrong explanation still matches its option.

### A2. Add meaningful regression checks

Exercise, using offline content fixtures only:

- Seeded expansion changes option positions without changing an old item's meaning.
- Each wrong-option rewrite reaches its intended misconception and never the correct answer.
- Key, all feedback and diagnoses stay aligned after numeric sorting and edits.
- Exactly two distinct diagnoses identify exactly the two wrong choices.
- Changed meaning advances item version and invalidates old solve/review proof.
- Unchanged content remains stable on a rebuild; snapshots and source-use decisions are preserved.
- A known bad repair is refused rather than silently exported.

Record the results against the exact final export. Do not create new application tests or change shared validators.

**Exit:** repair mapping is reviewable and reproducible, all exact-version structural checks pass, and known wrong-key examples have correct content—not merely structurally valid indices.

## 4. Pass B — Finish source resources and official errata reconciliation

### B1. Reconcile the visual OCR pass

All 48 previously queued Schweser pages have now been visually inspected by the assistant using 24 two-page renderings. This is **agent visual inspection, not a CFA-qualified human sign-off**. Evidence and dispositions are private:

- `content/source-packs/private/reference-2027/closeout/ocr-qa/pages.reference`
- `content/source-packs/private/reference-2027/closeout/ocr-qa/pair-*.png`
- `content/source-packs/private/reference-2027/closeout/visual-qa.reference`

Raw OCR for those pages is excluded from grounding until appropriate structured checks; the original PDFs and OCR remain preserved. The latest `c1-source-qa.py` honors checksum-bound visual exclusions and detects more quiz/answer/example pages. Reconcile its generated catalogue and reports so no old “48 pages not inspected” statement survives.

Important observed source issues include:

- Quant/Economics/Corporate Finance PDF p99: an unlabelled answer-key continuation.
- The same PDF p169: inconsistent sum/product cumulative-return expressions.
- The same PDF p427: a printed two-asset variance expression missing the factor two on covariance.
- The same PDF p443: overprinted/crossed-out dense reference text.
- Fixed Income/Derivatives PDF p268: an equity replication bullet omitting subtraction of debt from the assets-plus-put position.
- Portfolio Construction/Ethics PDF pp87 and 109: quizzes/quiz continuations sharing pages with subsequent factual material.

Do not silently “correct the source” or use a publisher exercise as an original question template. Retain source issues, supply supported structured formulas from adequate official references, and record whether any bank item relied on the unreliable region. Quarantining an unused region is a valid disposition; claiming its raw extraction is correct is not. If an excluded formula is needed, complete its checked structured replacement before using it.

### B2. Official updates and weights

The official errata index was checked and its linked **September 2026, 39-page 2027 Level I notice** retrieved on 25 November 2026:

- [Official errata index](https://www.cfainstitute.org/programs/candidate-resources/submit-errata)
- [Official 2027 Level I notice](https://www.cfainstitute.org/sites/default/files/docs/programs/cfa-program/candidate-resources/2027-cfa-program-level-1-notice.pdf)
- Private cached PDF/text: `content/source-packs/private/reference-2027/closeout/official-errata-september-2026.pdf` and `official-errata.reference`.
- [Official Level I topic/session weights](https://www.cfainstitute.org/programs/cfa-program/candidate-resources/level-i-exam).

Confirm that the current official index still points to that issue. Reconcile every relevant correction with facts, formulas, prerequisites, specifications and affected bank items. Use an impact register with exact affected IDs/versions and clear `not_applicable`, `already_consistent`, `revised` or `unresolved` outcomes. Do not claim merely downloading the PDF completes the errata work. Exclude corrected publisher exercises from drafting context; use their corrections only to identify concept/formula risks.

Pay particular attention to FCFE treatment of shareholder financing/distribution decisions, cash-conversion-cycle direction, portfolio variance/standard deviation, empirical duration, semiannual yield/convexity conventions, incentive fee ordering/high-water marks, and suitability/mandate language. Where the notice itself appears inconsistent or extraction garbles a formula, inspect the actual PDF and record the uncertainty rather than treating corrupted text as authority.

The older mock report used 2026 weights despite a 2027 blueprint label. Current content weights and candidate allocation are:

| Session | Topic | 2027 weight | Candidate questions |
|---|---|---:|---:|
| 1 | Ethics | 10–15% | 22 |
| 1 | Quant | 11–14% | 21 |
| 1 | Economics | 6–9% | 13 |
| 1 | FSA | 11–14% | 21 |
| 1 | Corporate Finance (`ci`) | 6–9% | 13 |
| 2 | Equities | 11–14% | 23 |
| 2 | Fixed Income | 11–14% | 23 |
| 2 | Derivatives | 6–9% | 13 |
| 2 | Alternatives | 6–9% | 13 |
| 2 | Portfolio Construction (`pm`) | 8–12% | 18 |

Keep stable internal IDs. There are 190 held-out **candidates**, of which 180 are selected and ten reserves. Do not call all 190 one completed form or edit runtime blueprint code.

**Exit:** all 16 source roles and exclusions are accounted for, raw OCR reliability is explicit, actual question dependencies are checked, and official errata impacts are resolved or precisely blocked.

## 5. Pass C — Repair the curriculum and grounding claims

### C1. Concept specifications must be substantive

The reported 378 concepts were produced partly by splitting outcome titles. At least one resulting title is literally **“Describe, compare”** (`r001-a:c1`), which is not an assessable concept. Audit all records. Repair incomplete fragments, arbitrary core/supporting assignments, generic framework boilerplate and unsupported decomposition.

Each genuine concept needs a meaningful scope, supported facts/formulas, assumptions, exceptions, misconceptions, prerequisites and exact anchors. Retain lineage when merging or replacing invalid stubs. Do not preserve the number 378 at the expense of validity. Do not modify canonical application records; prepare reconciled content manifests and a mapping handoff.

### C2. Audit all current items

Expand `c3-support-matrix.json` to the entire final bank, including C5/C7 and closeout additions. Keep lexical retrieval quality distinct from semantic support. Inspect the 23 weak-anchor items individually; many existing top-ranked pages are irrelevant despite keyword overlap.

For Ethics application scenarios, cite the actual relevant standard as well as the application scope where appropriate. Check specific claims such as dissociation, correcting known misrepresentation, competence limits, supervision, fact/opinion, record ownership, transaction priority and fair allocation. For FSA, check agent net-revenue recognition, inventory signals, debt disclosures/covenants and collection ratios against actual relevant passages. A weak token score alone is not a failure, and a high score is not a semantic pass.

Where a question is mapped to the wrong concept/reading, repair its content mapping with lineage or quarantine it. Do not force a supporting citation into the nominal reading to make a report green. Record every material source-to-claim relationship and unresolved gap.

**Exit:** every retained exact-version item has appropriate supporting references and an honest support disposition; scope records contain real concepts rather than completed-looking placeholders.

## 6. Pass D — Substantive bank-wide editorial and answer audit

### D1. Complete all outstanding warning queues

Individually resolve the current overlap, absolute-wording and raw format flags. Distinguish common technical expressions from borrowed phrasing. Do not cosmetically paraphrase copied exercises or erase flags without evidence.

The shared `formatRules.ts` extracts digits from prose, producing false mixed-type/order flags. **Leave it untouched.** Add a content-specific adjudication report that recognizes genuinely numeric choices separately from prose mentioning a number, standard or year. Retain raw flags and exact per-item decisions. Run a separate answer-length/parallelism audit even when the shared rule's numeric branch masks length cues.

Do not replace “always” with “usually” mechanically: that can turn a wrong option into another correct answer. Rewrite the actual misconception or record why a universal statement is relevant to the tested distinction. Reassess overly obvious wrong options and avoid key-length, grammar and certainty cues.

### D2. Finish numerical validation

The current 234 executed checks are not all numerical questions. Audit untagged arithmetic in prose-authored items. Known examples needing separate recomputation include:

- `pp-mock1-r012-e-medium-1` — top-three concentration ratio and consistent percentage options.
- `pp-2027-c5-r019-a-hard` — correct bid side of a two-leg currency conversion.
- `pp-mock1-r019-a-medium-1` — cross-rate multiplication.
- `pp-mock1-r019-b-hard-1` — forward points versus outright forward, correct sign and currency convention.
- `pp-2027-c5-r019-b-medium` — covered interest parity.
- `pp-mock1-r088-b-medium-1` — CML interpolation.
- `pp-mock1-r090-c-medium-1` — explicitly additive spending/inflation/fee objective.

Check calculations from stem inputs and validate the finance formula, not just that exported choices match an author-supplied expression. Preserve matching units, compounding and rounding. Do not use a broad tolerance that can accept a nearby wrong option. Verify solution intermediates and each claimed misconception calculation.

### D3. Correct difficulty and solve records

Some “hard” items are direct definition/standard recall. Reassess proposed difficulty, cognition and form from actual demand. If an honest reclassification creates a tier gap, author a genuinely appropriate replacement rather than preserving a false tag or claiming breadth complete. Explain level-specific reasoning in each item.

Blind solving must hide keys, solutions and suggestive metadata. Record actual solver/method, exposure limitations and disagreements. A same-assistant pass is a self-check. Do not fabricate independent external solves or qualified expert sign-off. Preserve historical records only for their exact unchanged versions.

**Exit:** structural correctness, semantic key/solution consistency, numerical verification, ambiguity and editorial queues have exact-version dispositions. No high-level pass label hides known bad questions.

## 7. Pass E — Genuine routine depth, held-out independence and evaluation

Read `c6-demand-and-capacity.json` critically: it explicitly acknowledges a depth backlog despite the previous C6 completion label. Derive concrete demand scenarios from existing policies read-only: initial diagnostic, fresh adaptive practice, repair and spaced rechecks, including required tiers/concepts. Measure shortfalls and author the missing independent constructions. Do not assume three tiers mean three interchangeable rechecks of the same concept.

Compare construction/error pathways across the whole bank and across pools. The current zero cross-pool count compares family UUIDs, which does **not** prove semantic independence. Group siblings, flag cross-pool construction reuse, and resolve it with genuinely new content or an honest reduced-capacity report. Retain provisional family status pending qualified confirmation.

Recheck all mock topic allocations, distinct constructions, source support, proposed fixed difficulty and intended scope. Keep reserve items separate from the selected 180-question form. Demonstrate the actual declared number of disjoint complete candidate forms; do not invent a multi-mock guarantee from a single form and reserves.

Audit the four candidate gold anchors and six negative examples for leakage and usefulness. Evaluation-only content must stay outside serving pools. Lock evaluation artifacts before using them for tuning; do not claim a tiny unreviewed set establishes gold quality or psychometric calibration.

**Exit:** declared routine/mock candidate objectives have real supported content and tested construction assumptions, with remaining human confirmation explicit. Additional automatically feasible authoring cannot be relabelled a human-only task.

## 8. Pass F — Reproducible package, truthful ledger and content handoff

Produce one consistent final package: full JSON/JSONL, subject files, blind sets, answer companions, coverage, support/curriculum/family manifests, selected mock/reserve lists, evaluation pack, validation, revisions, source QA, human queues and offline review HTML. Remove outdated hardcoded counts and reconcile all hashes/version references. Keep private excerpts/OCR images in ignored private locations.

Prove unchanged-input rebuild stability, preserve snapshots and check exact-version identity. Verify the offline review artifact's search, filters, blind/answer separation, keys, warnings, links and desktop/phone layout when changed. This is artifact QA, not software revamp testing.

Update `docs/QUESTION-BANK-CONTENT-READINESS.md`, `CONTENT-PROGRESS-LEDGER.md`, `content-ledger.json`, `validation.json`, `README.md` and `C10-HUMAN-ACTION-CHECKLIST.md` consistently. Mark phases honestly; do not retain “offline_complete” for genuinely unfinished automatic work. Differentiate:

1. Source processed versus reliable fact/formula extraction.
2. Candidate coverage versus genuine concept coverage and sustainable depth.
3. Proposed versus confirmed difficulty/family independence.
4. Deterministic/self-check versus independent solve and expert review.
5. Reviewer-ready versus approved for distribution.

Prepare an exact content-only handoff for the software agent: artifact paths, schema, stable IDs, versions/hashes, constraints and unresolved integration contracts. Do not import or change their software. Do not send messages without the owner's instruction.

The human-only checklist must specify actual authority/expertise, exact source/item/version, evidence to open, decision needed and existing recording workflow. Rights clearance and qualified exact-version approval cannot be manufactured by this agent. OCR processing, errata research, source matching, ordinary drafting and scriptable checks remain agent work wherever feasible.

## 9. Execution and stopping rule

Proceed in bounded batches, validate each, and save exact subject/concept/task cursors. Continue other tasks when one source or human decision is blocked. Preserve all concurrent work; do not use Git resets or global cleanup. Provide short progress updates on substantive findings and completed artifacts, not repeated waiting messages.

Do not stop after an audit, a few fixes, a higher count, zero schema errors or one nominal mock. Complete all feasible content passes. If independent provider authorization or human rights/expert decisions are the only real remainder, say so precisely and supply review-ready evidence. If automatable work is still unfinished, list it explicitly rather than claiming end-to-end completion.

Start with the option-repair/key regression and the stale 536-row support audit. Then complete source/errata/curriculum checks and sustainable content depth before issuing a final readiness verdict.
