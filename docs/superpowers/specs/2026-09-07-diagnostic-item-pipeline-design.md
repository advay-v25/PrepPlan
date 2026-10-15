# Diagnostic Item Pipeline — Pilot Design

**Status:** Draft for review
**Scope:** One module, end to end. This is the founding subsystem; everything else in the
product (planner, calendar, coach, onboarding) reads from what this produces.
**Authority:** `CFA_Diagnostic_Test_AI_Training_Manual.pdf` (referenced below as "the manual",
by section). Where this spec and the manual disagree, the manual wins and this spec is wrong.

---

## 1. Context

### What exists

The database already models most of this subsystem — 38 tables including
`curriculum_manifests`, `curriculum_concepts`, `assessment_items`, `assessment_blueprints`,
`assessment_forms`, `assessment_attempts`, `assessment_responses`, `evidence_events`,
`item_validations`, `item_challenges`, `repair_queue`, `user_module_state`. The manual's six
persistent stores (§3.1) map onto these almost one-to-one. Someone built the schema from the
manual.

The data does not exist. `learning_modules` holds three FSA modules; `assessment_items` holds a
handful of hand-written seed questions. There is no manifest, no verifier, no generator, and
no pipeline. `src/diagnosticEngine.ts` implements adaptive next-item selection but selects from
nothing.

### Why a pilot rather than a bank

The launch target is 180 items at ~90% quality. Two constraints make "generate 180 now" the
wrong first move:

1. The manual's §2.3 makes traceability to an active manifest a *publishability condition*. No
   manifest exists, so items generated now would be unverifiable by construction — precisely
   the failure the manual exists to prevent.
2. Yield and quality are unmeasured. "90% up to the mark" has no operational definition until
   there is a verifier and a release bar to measure against.

The pilot produces the manifest slice, the generator, the verifier, and a measured yield figure,
using one module. After it, 180 is a production run against a proven pipeline.

### Volume arithmetic (why the bank is finite, and why generate-ahead works)

A weekly cumulative test is 60–90 items (§4.1). Over ~36 weeks plus concept checks and repair
retests, one learner consumes 3,000+ item-exposures. But exposure is *per learner* — the
`item_ledger` (§3.1) tracks who has seen what — so the shared bank needs to reach roughly that
order of magnitude in total, not per user. That is large but finite and reachable by continuous
machine generation.

This is why generation runs **ahead of** consumption rather than at request time: it yields the
same variety and volume, but every item passes verification before a learner sees it, the bank
compounds instead of evaporating, and test latency drops. Request-time generation is reserved
for repair retests needing learner-specific surface context (§10.2).

---

## 2. Goals

1. Author a curriculum manifest slice for one module, conforming to §2.2.
2. Build a blueprint-driven generator that emits items plus hidden item cards (§11.3).
3. Build an independent verifier per §11.6, including **deterministic execution** of numerical
   checks rather than model judgment.
4. Produce **one complete, verified module diagnostic** — 20 released items, which is a
   legitimate standalone assessment scope per §4.1 ("Module or partial reading: 10–20").
   Generation runs until 20 items pass the verifier; the number drafted to get there is
   recorded, and that ratio is the measured yield.
5. Measure the run against §12.2 acceptance metrics and report actual generator yield.
6. Calibrate the release bar: establish whether the verifier's judgment matches Advay's.

## 3. Non-goals

- Any other module or topic. FSA income-statement analysis only.
- The planner, calendar, coach, syllabus view, onboarding, or any UI work.
- Fine-tuning. Per §11.1, examinability comes from the manifest, not from weights. Fine-tuning
  is reconsidered only if evaluation shows prompting has plateaued, and only using the
  defect-labelled corpus this pilot begins producing.
- Serving items to real learners. The pilot's output is inspectable files and database rows.
- A review UI. Review for the pilot is file-based.
- Psychometric calibration (§12.3). It needs response data from real learners, which does not
  exist yet.

---

## 4. Module selection

**`fsa-income` — Analyzing the Income Statement.**

Chosen because it is already seeded in `learning_modules` and `curriculum_concepts`, it carries
high exam weight (FSA is 11–14% of Level I), and both supplied mock papers contain
income-statement and inventory items usable as style anchors.

---

## 5. Design

### 5.1 The manifest slice

Per §2.2, each manifest record identifies the subject, reading, module, LOS, key definitions,
formulas, required interpretations, curriculum examples, **exclusions**, and source location.
The `excluded_or_superseded` field is load-bearing: it is what stops the generator drifting
into Level II material or superseded treatments.

Resolution of the existing duplicate curriculum models:

- `curriculum_manifests` + `curriculum_concepts` become the manifest. `curriculum_concepts`
  gains a real foreign key to `learning_modules` (today it hangs off `manifest_id` with
  free-text `topic`/`reading`/`module` strings).
- `learning_modules` + `lm_edges` remain the planning layer above it — the grain a study block
  covers, and the linkage graph.
- `source_references` holds pointers (Schweser location, etc.), used at authoring time for
  verification, never surfaced to learners as citations.

Authoring: drafted by Claude from Schweser 2027 scope plus general finance knowledge, reviewed
by Advay before any item generates against it. A concept with `verification_status != 'verified'`
cannot back a released item.

### 5.2 The generator

Driven by a blueprint, not by free generation. Per §4.3, the blueprint is constructed *before*
any item is drafted, sampling across four dimensions (§4.2):

| Dimension | Categories |
|---|---|
| Content | module → concept |
| Cognition | recall, interpret, apply, calculate, compare, diagnose, integrate |
| Difficulty | foundation, standard, difficult, stretch |
| Item form | direct concept, scenario, data table, calculation, exception, multi-concept |

The generator emits, per item: stem, three parallel options, key, full solution, per-distractor
rationale, and the hidden item card (§11.3). Style follows §5.1–5.3 and the acceptance
checklist in Appendix C.

**Style calibration from the supplied mock papers is structural only** (§2.4): lead-in forms
("most likely", "least likely", "closest to", "best described as"), option parallelism, stem
self-containment, and the distractor error-type taxonomy. No wording, numbers, or entities are
carried across, and the papers do not enter any training corpus.

### 5.3 The verifier

Per §11.6, the verifier is a separate pass with **no access to the generator's reasoning**. It
receives the item, the manifest concept, and nothing else. It returns PASS / REVISE / VOID /
HUMAN REVIEW with reasons (Appendix B3).

Checks, per §12.1:

| Gate | Method |
|---|---|
| Scope | Concept present in active manifest; terminology matches edition; not in `excluded_or_superseded` |
| Answer | Verifier solves the item cold from the stem and compares to the claimed key |
| Numerical | **Executed in code**, not judged by a model — see below |
| Ambiguity | Exactly one defensible best answer under stated assumptions |
| Distractors | Each wrong option maps to a named error pathway from §6.2 |
| Language | Precise professional English; options parallel in grammar, unit, specificity, length |
| Exposure | Semantic duplicate screening against the existing item ledger |

**Deterministic numerical checking.** This is the one addition to the manual, and it is the
highest-leverage reliability decision in the pilot. §6.3 describes numerical preflight as a
procedure ("solve independently at least twice, calculate every option"); implementing it as a
model judgment reproduces the failure it is meant to catch. Instead the verifier derives its own
solution path and executes it as code, asserting: the key is reproduced, every distractor value
is reproduced, the key is closest to exactly one option, and units, compounding frequency,
day-count, sign, and rounding are correct. Roughly a quarter of items in the supplied mock
papers are calculation-based, and that is where defects concentrate.

### 5.4 Storage

`assessment_items` is the item record — it already carries `stem`, `options`,
`per_option_feedback`, `provenance`, `review_status`, `difficulty`, `lm_id`,
`learning_objective`, `verification_intent`. It gains the remaining §11.3 gold-record fields
(item_version, cognitive_process, item_form, exact_numeric_values, semantic_fingerprint,
verifier result, final_status).

The separate `questions` table is a competing, thinner model of the same thing. It is
superseded; `assessment_items` is the single item record. Nothing currently reads `questions`.

Verifier outcomes are written to `item_validations`, which already exists.

### 5.5 Trust tiers

The pilot establishes two tiers, which the wider system will rely on:

- **Verifier-passed** — cleared for routine use: concept checks, module diagnostics, confidence
  probes, repair retests. A defective item here is recoverable: §13.2 requires voiding it,
  recomputing the score, and not penalising the learner.
- **Reviewed (gold)** — additionally signed off by Advay. Required for anything that moves the
  mastery ledger or produces a readiness judgement (weekly cumulatives, mocks), per §12.4.

This is what keeps "only diagnostic evidence moves readiness" honest without requiring human
review of thousands of items.

---

## 6. Acceptance criteria

Release standard (§12.2) — measured on the 20 released items:

| Metric | Target |
|---|---|
| Syllabus precision | 100% traced to a verified manifest concept |
| Unique-key validity | 100% exactly one defensible best answer |
| Numerical integrity | 100% independently reproduced in code |
| Blueprint coverage | 100% of declared quotas satisfied |
| Explanation completeness | Key plus rationale for every distractor |
| Semantic originality | No near-duplicate of a supplied mock item or of another bank item |
| Answer-position balance | No material A/B/C imbalance or visible sequence |

Reported, not gated:

- **Generator yield** — released ÷ generated. The launch assumption is ~90%; this run measures it.
- **Verifier–human agreement** — of items the verifier passed, how many does Advay also accept?
  This is the pilot's most important output. A verifier that passes items Advay would reject is
  not yet fit to gate unreviewed delivery, and its failures define the next iteration.

The 90% and 100% figures are not in conflict: 90% is *generator yield* (of what is drafted, what
survives), 100% is *release standard* (of what reaches a learner, none is off-syllabus,
ambiguous, or numerically wrong). Rejected drafts are retained as the defect-labelled corpus
required by §11.2 verification training.

---

## 7. Risks

**A plausible-but-wrong item passes the verifier.** The central risk. A defective item creates a
false weakness (§7.2, flawed-item bias), which propagates into the repair queue and then into
next week's plan — the error does not stay in the test. Mitigation: the verifier–human agreement
measurement above, deterministic numerical execution, and the trust tiers, so unreviewed items
never move readiness.

**The manifest is wrong.** Everything downstream inherits a manifest error, and the verifier
cannot catch it because the manifest is its ground truth. Mitigation: Advay reviews the manifest
slice before generation; concepts default to unverified and cannot back released items.

**Yield is materially below 90%.** Then either the generator prompt or the manifest detail is
insufficient. Either is a cheap fix at pilot scale and expensive at 180.

**Copyright.** The supplied mock papers are CFA Institute material. Per §2.4 and §12.5 they are
usable as structural style calibration only — never reproduced, never near-duplicated, never
placed in a training corpus. Schweser is an authoring-time scope reference; its organisation is
not the product's structure and its wording is not stored.

---

## 8. Out of scope for this spec, sequenced after it

The wider product decomposition, in dependency order: curriculum graph across all ten topics →
long-horizon planner with deviation handling → calendar → diagnostics at full scope → analysis
and repair scheduling → AI coach → onboarding → per-page UI. Each gets its own spec. Onboarding
is designed last and shipped first, because its only job is seeding the planner.

---

## 9. Build notes

Recorded after implementation, 2026-09-07. Where the build departs from the
design above, this section is what actually shipped.

### 9.1 Additions the design did not anticipate

**The verifier must not be shown the declared key.** §5.3 said the verifier
"solves the item cold". In implementation this had to become structural rather
than instructional: the numeric pass receives the stem only — no options, no key
— and the comparison happens afterwards in code. A model told which option is
correct writes a formula that reaches it, which is precisely the failure the
pass exists to catch.

**Unit-scale reconciliation.** The verifier solves in whatever unit the
arithmetic naturally produces — `0.35` for a margin whose options read `35.0%`.
Treated literally this voids correct items, and it did: the first live run
rejected a sound item on exactly this. Matching is now scale-aware, but only
along scalings the options themselves license (percent signs, "million",
"thousand"), so an unrelated value cannot be rescaled into a false match.

**A per-attempt deadline.** Some NVIDIA endpoints accept a request and never
answer. Per-request timeouts bound one call, but an attempt makes up to four
across two models. A run stalled 25 minutes on a single cell before this was
added.

**Manifest sign-off is a screen, not an offline step.** §5.1 assumed the
manifest would be reviewed before generation. Nothing in the product could
express that, so every generated item was permanently blocked from gold with no
way forward. `/app/tests/manifest` is where a concept's scope is read and signed
off; item approval refuses until it has been.

### 9.2 Trust tiers as implemented

`assessment_items.review_status` now carries four values rather than three:

| Value | Meaning |
|---|---|
| `draft` | generated, not yet through the verifier |
| `verified` | verifier PASS, no human sign-off — routine testing only (tier 1) |
| `reviewed` | human-signed gold — required for readiness-moving assessments (tier 2) |
| `deprecated` | rejected or voided |

Purpose determines which tiers may be drawn on: `weekly_cumulative` takes
`reviewed` only; module diagnostics, concept checks, and repair re-checks also
take `verified`.

### 9.3 Resolved data models

`curriculum_concepts` gained a real `lm_id` foreign key to `learning_modules`,
plus `scope_notes`, `excluded_or_superseded`, and `verification_status` — the
fields that make a concept something a generator can be held to and a verifier
can check against.

The legacy `questions` table is confirmed superseded: it holds zero rows and no
code path reads or writes it. It is left in place rather than dropped, since
dropping it is a separate decision from this phase.

**A second, older generation stack is still in the tree and should go.** It is
`src/components/DiagnosticFlow.tsx` (rendered by no route) →
`/api/diagnostics/generate` → `src/lib/diagnostics/blueprint.ts` — note the
plural directory, one letter away from the pipeline this spec describes. It
carries its own hardcoded model default and its own item schema, and it is
entirely unreachable: nothing imports `DiagnosticFlow`. Two competing pipelines
one letter apart is how the original confusion happened. It was left in place
only because this repository has no version control, so a deletion cannot be
undone; it should be removed once that is in place.

### 9.4 Defect corpus

`rejected_item_drafts` stores every draft the verifier turned away, with its
defect codes — and also every generation failure, which the first implementation
dropped on the floor. Generation failures are the most informative rejections
available, because they say the generator could not produce a well-formed item
at all.

### 9.5 What is verified, and how

- `npm run verifier:test` — 62 offline checks over option parsing, formula
  execution and its sandbox, unit-scale reconciliation, JSON recovery,
  fingerprinting, and blueprint quota allocation.
- `npm run verifier:test -- --online` — feeds the verifier a sound item and the
  same item with a corrupted key, and asserts it separates them. A verifier that
  passes both is worthless whatever else it reports.
- `npm run e2e -- --reset` — 47 checks driving the real HTTP endpoints:
  assembly, answering, answer locking, scoring, evidence, the result page,
  challenges, the manifest gate, and the guard rails.

### 9.6 Still open

- **Verifier–human agreement is not yet measured.** It is the metric §6 names as
  the pilot's most important output, and it requires review decisions that only
  a person can make. The surface for it exists; the number does not.
- `REVIEWER_EMAILS` is unset, so any signed-in account can promote items to
  gold. That must change before anyone else uses the app.
- The eight `fsa-income` concepts are drafted, not signed off. Until they are,
  no item can reach tier 2 and no weekly cumulative can be assembled beyond the
  six hand-written seed items.
