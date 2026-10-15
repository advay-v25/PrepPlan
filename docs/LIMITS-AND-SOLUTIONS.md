# Limits and solutions

Written 2026-09-20, after the Home rebuild, the Coach rebuild and the first question-bank build (Ethics).
Every limit below is one I have either hit while building or verified by reading the code. Where I have **not**
verified something, it says so. Effort figures are engineer-day estimates, not measurements.

How to read a row: **what is limited → what it costs the student → what to build → size → who owns it.**
"Founder" means the step cannot be done by code: it needs a person's judgment or a business decision.

---

## 1. The question bank

The bank is the limit that everything else waits on. Tests, the paper for each week, the diagnostic and the repair
loop all read from it.

| # | Limit | Cost to the student | Solution | Size | Owner |
|---|---|---|---|---|---|
| 1.1 | **343 outcomes across 102 readings; 89 now have items** (Ethics 36, FSA 53). Eight subjects have none. | A weekly paper cannot be built honestly for eight of ten subjects. The app already refuses (`insufficientPaperBank`), which is correct but means most of the syllabus has no test. | Build the bank subject by subject in the order the student studies (below, §1.5). | L | Eng + founder |
| 1.2 | **Human review is the only route to `reviewed`, and nothing may skip it.** 108 Ethics items are now waiting; every future subject adds hundreds. | The bank fills faster than one person can approve it, so it stalls at `verified`. Papers use only approved items. | Make review cheap, not optional: batch review by outcome, a keyboard-first review screen showing the solution, the three diagnoses and the verifier's independent answer side by side, and a "verified by two separate models + zero challenges" fast lane for a reviewer to skim. Do **not** auto-approve. | M | Eng builds, founder reviews |
| 1.3 | **Only 3 items per outcome.** `MIN_VIABLE_PER_OUTCOME = 3` is a floor for an honest paper, not a bank. The selector already excludes items a student has seen (`src/lib/tests/assembly.ts`), which is right, but means the pool drains. | After a few tests on the same outcome there is nothing unseen left, so a paper cannot be built for it, or a student is pushed to repeat. Weekly cumulative tests drain a 3-item pool almost at once. | Scale to 8–12 per outcome for core outcomes before launch; generate variants of a verified item (same reasoning, new scenario) through the existing generator and verifier; decide and build a deliberate re-serve rule for a drained outcome (oldest-seen first, and only after a gap) instead of failing. | L | Eng + content |
| 1.4 | **Numeric subjects need a stronger gate than Ethics did.** The verifier's arithmetic gate (mathjs) exists and is tested (`verifier-selftest`), but Quant, FSA, Fixed Income and Derivatives items are calculation-heavy and I have not yet run it at volume. | A wrong key on a calculation item teaches the wrong number. | Run the numeric gate on 100+ seeded calculation items before authoring in bulk; add a second, independent recomputation (different formula path) and require both to agree; store the derivation in the item card so a reviewer can re-check it. | M | Eng |
| 1.5 | **What to build first.** Not all readings matter equally, and the student studies in a sequence. | Building in curriculum order wastes review time on material the student won't reach for months. | Order = (1) subjects in the student's current cycle, then (2) by target size and how many outcomes have no item: Fixed Income (51), FSA (44), Equity (37), Quant (30), Portfolio Management (40). | – | Founder decides order |
| 1.6 | **Tiers are intended, not measured.** Easy/Medium/Hard is my judgment at authoring time. Nothing has yet confirmed a "Hard" item is harder. | Tier labels could mislead. A student who clears Medium may assume they can do Hard. | Record every response (already done: `assessment_responses`), and after ~30 responses per item compare observed correctness to the tier. Re-tier items automatically as a proposal to the reviewer; never silently. Longer term, fit a simple item-response model once there is enough data. | M, needs users | Eng, then data |
| 1.7 | **`stretch` tier and multi-step "integrated" items are not built.** The schema has both; the Ethics bank uses foundation/standard/difficult only. | The top of the range is untested. | Add stretch items for outcomes that support them (cross-standard vignettes are the natural Ethics case). Keep out of the minimum-viable count. | S–M | Content |

### 1.a What the Ethics build actually delivers
- 36 outcomes (Standard-level, with the volume's own page anchors) and 108 items: 36 Easy, 36 Medium, 36 Hard.
- Every item carries a worked solution and a named error type for each wrong option, so a miss can point at a
  specific Standard and a specific reasoning slip.
- Three source checks: an 8-word overlap scan against the volume (0 hits after rewording), a balanced key-position plan
  (36/36/36), and a lint of the shape (three distinct options, no "of the above").

### 1.b Ethics-specific limits I found while building
- **The outcome list is my structure, not the curriculum's.** The volume's own learning outcomes for the Standards
  modules are generic ("evaluate practices, policies and conduct …"), so I structured by Standard sub-section
  (I(A) … VII(B)). This is a product decision the founder can change: it is one file
  (`scripts/lib/ethicsBank/structure.ts`) and re-runnable.
- **Concepts are inserted as `pending`.** The review route refuses to promote an item whose concept is unverified. So a
  human must verify the 36 concepts before any Ethics item can become `reviewed`. This is deliberate, not a bug.
- **Answer-length tell was real and I fixed most of it.** My first pass had the correct option as the longest in 88% of
  items, which lets a student score by guessing the longest. After rewriting it is 41% (chance is 33%). It is not zero,
  and the linter now reports it so it can't quietly drift back.
- **Level I Ethics questions are often short vignettes; some real ones share one scenario across questions.** The
  schema has one stem per item, so shared-scenario item sets are not supported. Costs realism, not correctness.
- **Curriculum changes yearly.** The volume is dated May 2026 and includes the 2023 changes (new I(E), revised V(B)
  and VI(A)). A future edition means re-checking the items that cite those Standards. The source map (page anchors per
  outcome) is what makes that re-check a targeted job instead of a full re-read.

### 1.c FSA build (2026-09-21): what it showed
- **159 items over all 53 FSA outcomes** (53 Easy / 53 Medium / 53 Hard), 58 of them numeric. **144 verified, 15 left as draft**.
  Numeric keys and distractors are *computed from formulas* (`scripts/lib/bankNumeric.ts`), not typed, and each wrong
  option is literally "the answer you get if you make error X".
- **First run of the arithmetic gate at volume:** 46 of 60 numeric items passed the first time. Of the 14 that did not,
  about half were real defects in my items (an ambiguous stem, a sign convention, a scope mismatch) and the rest were
  the verifier being wrong. That is the honest error rate of the whole loop, and it is why review stays human.
- **Verifier weaknesses found (these are limits of the checker, not of the items):**
  (a) it misses a standard adjustment on multi-step FIFO/LIFO restatement (`r032-c-hard`) and lets a common
  misconception through on US GAAP impairment (`r033-b-hard`); (b) its numeric gate crashes on its own variable named
  `end` (`r030-a-hard`); (c) it sometimes names the right answer in its reasoning but the wrong option number
  (`r027-b-medium`, `r035-a-medium`, `r036-c-easy`); (d) it called IFRS leases "Level II" (`r034-a-*`), which the 2027
  volume contradicts. **Solution:** fix the reserved-word bug in the numeric gate (S), add the second solver from 2.1,
  and give the verifier the concept's scope from the volume, not only the outcome title (S).
- **Policy I applied and you should keep:** items I did **not** edit stay `draft` when the verifier disagrees; I only
  re-verified items I actually changed. Re-running an unchanged failure until it passes would be shopping for a verdict.
- **One rule I could not confirm from the volume text:** that IFRS and US GAAP both bar reversing a goodwill impairment
  (`r029-b-hard`). It is true in the standards, but the reviewer should check it against the volume before approving.
- **Scope drift is real.** The verifier voided two items I wrote as calculations for outcomes about *presentation and
  disclosure*. I rewrote them as interpretation items. Numeric items belong on the outcomes that name a calculation.
- **Coverage now:** 259 approved-or-verified of 20,000 target; 254 of 343 outcomes still have no item; Ethics and FSA
  are the only fully covered subjects. Every remaining subject follows the same loader (`scripts/lib/bankLoader.ts`).

---

## 2. How much to trust the checks

| # | Limit | Solution | Size | Owner |
|---|---|---|---|---|
| 2.1 | **The automated verifier solves each item with a model and compares to the key.** It is a strong signal, but it is not independent of the author: both are language models and can share a blind spot (a wrong belief about a Standard passes both). | Add a second, different model family as a second solver; on any disagreement route to human review. Keep a small set of **known-wrong** items in every run and confirm the verifier rejects them (`verifier-selftest` covers the numeric gate; I have not checked whether it covers conceptual cases, so treat that as unbuilt). | S–M | Eng |
| 2.2 | **The overlap scan only catches copied word runs, not copied ideas.** It cannot tell whether a scenario is a close paraphrase of a curriculum example. | Human originality read on a sample per batch (the pipeline already has an `originality_reviewer` role); scenario names, numbers and settings are all invented in this bank, but a person should confirm on a sample. | S | Founder |
| 2.3 | **The source text lives outside the repo on purpose.** The scan needs a text extraction of the volume, which is candidate-use-only material. | Keep it local; document how to regenerate it (`pypdf`); never commit it. | – | – |
| 2.4 | **Nobody has taken the bank as a student.** All checks are scripted. | Founder sits one Easy, one Medium and one Hard paper on the dedicated test account and reports anything that reads wrong, is ambiguous, or feels too easy or too hard. Thirty minutes finds what scripts cannot. | S | Founder |

---

## 3. Product features not built (or not visually verified)

| # | Limit | Solution | Size | Owner |
|---|---|---|---|---|
| 3.1 | **No browser verification of Home or Coach.** All checks are HTTP-level scripts (16 + 42 + 26). They will pass through a broken layout. | Add `scripts/visual-snap.ts` (Playwright at 390 / 834 / 1440) and review images at each stage boundary. The redesign plan already calls for this. | S | Eng |
| 3.2 | **Home attention has no producers for "scored paper ready" or "draft in progress".** The reducer and destinations exist; nothing emits them. | Add two producers in `attentionReducer` fed by `papers` state, plus tests. | S | Eng |
| 3.3 | **Home has no quick-log drawer** (log a session without leaving Home). | Reuse `useTaskMutation`; one drawer, three fields. | S | Eng |
| 3.4 | **Coach's evidence pack is minimal and the model can only propose two action types** (`defer_today`, `recheck_block`). | Widen the pack (recent misses by error type, the repair thread, class coverage) and add proposals one at a time, each server-decided and confirm-gated like the existing two. Never let the model write to the plan. | M | Eng |
| 3.5 | **Timing is uncalibrated.** Planned durations use defaults; `actual_duration_minutes` now records, but nothing learns from it. | After ~3 weeks of real completions, fit minutes-per-effort-unit per subject (the Pulse spec's `observedMinutesPerEffortUnit`) and feed it back into planning. | M, needs users | Eng |
| 3.6 | **Pulse adaptive weekly engine:** modules exist with unit tests (`weekBoundary`, `redistribute`). I did not re-audit its end-to-end behavior in this session. | Re-run its suites and walk one full week on the test account before relying on it. | S | Eng |
| 3.7 | **Not built at all:** payments, product analytics, calendar export (ICS), a mobile client, reminders/nudges delivery (the reminder time is stored, nothing sends). | Sequence after the bank: analytics first (it tells you which of the others matter), then reminders, then payments. | L | Founder decides |

---

## 4. Platform and operations

| # | Limit | Solution | Size | Owner |
|---|---|---|---|---|
| 4.1 | **Not a git repository.** No history, no rollback, no review trail for content or code. I overwrote a test file by accident earlier and could not recover it. | `git init` now, commit a baseline, and commit item data (`items.json`) so every content change is a reviewable diff. Highest-value single step on this list. | XS | Founder |
| 4.2 | **Content is seeded by scripts, not migrations.** A fresh database has no Ethics structure or items until `ethics:seed` and `ethics:load` are run. | Add a `docs/RUNBOOK.md` listing the seed order, and make `verify` fail if a required subject has zero structure. | S | Eng |
| 4.3 | **LLM dependency (NVIDIA, OpenAI-compatible) for Coach prose and the verifier.** Coach falls back to a deterministic reply; the verifier returns `HUMAN_REVIEW` if the model is unreachable, which is safe but slow. | Keep the fallback; add a health check surfaced in the review screen so a reviewer knows when verification ran without the model. | S | Eng |
| 4.4 | **Production data is real.** Tests run against the same project. | Keep the dedicated `+e2e` account for all tests; never delete production rows; if a staging project is affordable, move the e2e suites there. | S–M | Founder |
| 4.5 | **Rate limits and cost:** Coach is limited to 40 messages an hour; verification is one to two model calls per item. | Fine at pilot size. Before launch, add per-user monthly caps and a cost dashboard. | S | Eng |
| 4.6 | **The weekly paper is unreachable for essentially every student right now, and this is by design, not a bug.** `planWeeklyPaper` only counts `reviewed`-tier items (§2.1's rule: readiness-moving assessments use `reviewed`, everything else may use `verified` or `reviewed`). Only 19 items in the whole bank are `reviewed` — a leftover from before this session — spread thinly across four FSA modules, none with enough to clear the 5–9-item threshold `PAPER_MIN_ITEMS_PER_MODULE` sets. Onboarding's first-week preview now explains this honestly (§2.1 traced it and wired the planner's real skip reason through instead of a guess), but the underlying fact is: **no student gets a weekly cumulative paper until you review items into that tier.** | Not a code fix — a review-throughput problem. Move review from ad hoc to routine: batch-review the FSA and Ethics banks built this session, prioritizing the modules a real cohort would hit first, so at least one subject can clear a paper. | Founder (review time), not Eng | Founder |

---

## 5. Suggested order

1. **`git init`** (4.1). Minutes.
2. **You review the Ethics bank** using the review screen and sit three papers (1.2, 2.4). This is the first real test of whether the pipeline produces items you would put in front of a student.
3. **Verify the 36 Ethics concepts** so approved items can be promoted (1.b).
4. **Second solver + known-wrong set** (2.1) before the next subject is authored, so bulk generation starts with the stronger gate.
5. **FSA, then Quant, then Fixed Income** through the same generator → verifier → review path (1.1, 1.4, 1.5).
6. **Exposure tracking and variants** (1.3) before the first weekly cumulative test goes to a real student.
7. **Visual verification** (3.1), then the small Home gaps (3.2, 3.3).
8. **Calibration** (1.6, 3.5) only once there are real responses. It cannot be built before then.

## 6. What I would not do

- **Auto-approve verified items.** It would turn the review gate into a formality and let a shared model blind spot reach students.
- **Generate thousands of items before the first subject is human-reviewed.** Review, not generation, is the bottleneck; a large unreviewed pile is a liability, not progress.
- **Reproduce or closely adapt the curriculum's own examples and practice problems.** They are candidate-use-only. Every item in this bank uses invented scenarios and names.
