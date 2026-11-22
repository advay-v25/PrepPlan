# Roadmap — product review and v1 decisions

**Date:** 31 Aug 2026  
**Scope:** CFA Level I, 2027 curriculum  
**Purpose:** convert the founder brief and PRD v1 into a buildable, mass-user product direction

## 1. Verdict

The strongest version of Roadmap is not another study planner, content library, or AI tutor. It is a **learning control system**:

1. It observes what the candidate was taught or studied.
2. It verifies what the candidate can actually retrieve and apply.
3. It diagnoses the smallest underlying weakness that explains the miss.
4. It changes the next plan within the candidate's real time constraints.
5. It checks whether the intervention worked.

The defensible loop is therefore:

`coverage → verification → diagnosis → intervention → re-verification`

Calendar, coach, syllabus map, imports, and dashboard are interfaces around this loop. None is the product by itself.

## 2. Immediate corrections before build

### 2.1 Canonical curriculum

The official 2027 CFA Level I outline contains 102 learning modules. The correct split is:

| Topic | Official weight | Learning modules |
|---|---:|---:|
| Quantitative Methods | 11–14% | 11 |
| Economics | 6–9% | 8 |
| Corporate Finance | 6–9% | 7 |
| Financial Statement Analysis | 11–14% | 12 |
| Equities | 11–14% | 12 |
| Fixed Income | 11–14% | 19 |
| Derivatives and Risk Management | 6–9% | 10 |
| Alternative Investments | 6–9% | 7 |
| Portfolio Construction | 8–12% | 6 |
| Ethical and Professional Standards | 10–15% | 10 |
| **Total** |  | **102** |

Schweser 2027 uses 99 numbered readings across four books. A reading is therefore not always equivalent to an official learning module. The database must use official learning modules as canonical nodes and maintain provider-specific mappings separately.

### 2.2 Content authority

- CFA Institute's public 2027 topic outline is the authority for module titles and LOS.
- Schweser is guidance for the user's private chapter mapping and study workflow, not the source for shared summaries or generated questions.
- User-uploaded notes can support private retrieval and pointers for that user only.
- Every shared diagnostic item needs original authorship, an LOS reference, a reviewer, a version, and a provenance record.

### 2.3 Preparedness is not pass probability

Call the dashboard number a **Preparedness Index**, not a predicted probability of passing. It measures evidence coverage, demonstrated mastery, recency, and prerequisite health. Until the model is calibrated against real candidate outcomes, language such as “72% chance of passing” is unjustified.

## 3. Product decisions for v1

### Decision A — primary user

Lead with the coaching-enrolled candidate. This user has a recurring, high-friction job every week: translating class coverage into effective work between classes. Self-study remains supported, but it should not force the first release to solve two different onboarding products equally well.

### Decision B — accountability

Use a **weekly commitment ritual** in v1:

- candidate chooses a realistic weekly commitment;
- app proposes the protected minimum;
- candidate accepts it;
- weekly review compares promise, execution, and learning evidence;
- next week is explicitly re-contracted.

Do not lead with peer ranking. Percentiles require scale, create unhealthy incentives, and are difficult to make honest across different exam windows and starting points. Cohorts can be tested later as an opt-in retention layer.

### Decision C — monetisation

Sell access to an exam window rather than only monthly subscriptions. Suggested test:

- Free: onboarding, syllabus map, class logging, basic week plan, one diagnostic form per selected module.
- Core exam pass: adaptive planning, full verification loop, recovery, Preparedness Index, score imports, strategy coach.
- Full exam pass: applied scenarios, explanation checks, richer misconception repair, mocks and final-phase rehearsal.

Avoid pricing features that make the free score structurally worse. Scores must remain comparable across tiers.

### Decision D — channel

Start B2C to learn quickly. Design the data model so coaching institutes can later provide class schedules and view consented cohort-level progress, but do not build institute administration in the first product. B2B2C should follow demonstrated student outcomes, not precede them.

### Decision E — coach boundary

“Not a tutor” is too restrictive for the stated user need. The coach should not become a full substitute for curriculum content, but it must perform **targeted misconception repair** after evidence of a miss.

Allowed:

- identify the broken step in the candidate's reasoning;
- ask a short Socratic probe;
- give an original analogy, memory hook, or real-world application;
- point to the candidate's own material;
- assign a small re-verification task.

Disallowed:

- reproduce or paraphrase substantial third-party material;
- generate a full course or chapter replacement;
- claim mastery from conversation alone;
- change the plan without confirmation.

## 4. Diagnostic system — the real special sauce

### 4.1 What a diagnostic must identify

A simple percentage score is insufficient. Each item should collect evidence across four tags:

1. **LOS target** — what official outcome is being tested.
2. **Cognitive operation** — recall, interpretation, calculation, judgment, or transfer.
3. **Misconception family** — the plausible wrong model represented by each distractor.
4. **Prerequisite dependency** — which earlier module could cause this miss.

The result should say more than “6/10.” Example:

> You can calculate bond price when cash flows are explicit, but you reverse the price–yield relationship and miss spot-rate discounting. Revise TVM cash-flow timing first, then retry two bond-pricing probes.

### 4.2 Diagnostic flow

For each newly taught module:

1. Serve an 8–12 item verification form with balanced LOS and cognitive coverage.
2. Record answer, confidence, time, calculator use where relevant, and selected distractor.
3. If the pattern is ambiguous, serve at most two targeted probes rather than another full test.
4. Classify the miss as one or more of:
   - knowledge gap;
   - formula selection;
   - execution/calculation;
   - language or command-word error;
   - prerequisite gap;
   - transfer/application gap;
   - careless or time-pressure error.
5. Assign one intervention.
6. Re-verify with unseen items after an appropriate delay.

### 4.3 Reliability rules

- Never infer module mastery from one item.
- Never let self-confidence increase mastery; use it only for calibration.
- Free-text explanation grades should be provisional until the grading rubric is calibrated against human ratings.
- Repeated items carry sharply reduced evidence weight.
- Question difficulty needs empirical recalibration after sufficient attempts; author labels are priors.
- Keep item statistics by version so edits do not contaminate historical comparisons.

### 4.4 Practical content strategy

Authoring 24 reviewed items for all 102 modules means 2,448 items. That is not a realistic pre-launch requirement for a small team.

Recommended launch scope:

- select 20–25 high-value modules using topic weight, graph centrality, coaching frequency, and error frequency;
- build three non-overlapping forms for those modules;
- use explanation checks and imported evidence for the remaining modules;
- label evidence confidence honestly;
- expand only where usage and failure data justify the authoring cost.

The question-authoring standard should be a separate specification before production begins.

## 5. Planning engine

The scheduler should be deterministic and operate on constraints, not prose. Inputs:

- exam window and phase;
- recurring class blocks;
- realistic availability by day;
- energy preference and maximum block length;
- module state and evidence confidence;
- prerequisites and dependents;
- due diagnostics and decay;
- missed and partial work;
- protected personal commitments.

### Priority score

Use an explainable queue, for example:

`priority = exam_weight × mastery_gap × evidence_uncertainty × urgency × graph_leverage`

Then apply hard constraints: available minutes, prerequisite order, class timing, maximum daily load, and required buffer.

### Recovery levels

| State | Trigger | Behaviour |
|---|---|---|
| Normal | plan broadly on track | preserve sequence and buffers |
| Strained | one missed block or small overload | move within week and shrink optional work |
| Behind | repeated misses or meaningful evidence gap | protect high-leverage modules, compress low-priority first passes |
| At risk | trajectory cannot fit remaining hours | present scope, intensity, and exam-window options plainly |

Every re-plan is shown as a before/after diff with the reason and Preparedness Index impact.

## 6. Core screens

### Home

Answer only three questions above the fold:

1. Am I on track?
2. What exactly do I do next?
3. Why is that the right next step?

Use the Preparedness Index, required-pace trajectory, today's protected minimum, and one weakest-link diagnosis. Avoid a dashboard full of decorative statistics.

### Week

The week is the main planning unit. Class blocks are distinct; bridge blocks explain missing prerequisites; all study blocks show a one-line reason. “Partial” completion must capture what remains, not act as a cosmetic status.

### Syllabus

Default to a clear list/heatmap. A full dependency graph is useful for exploration but too dense as the primary mobile view. Node detail shows coverage, mastery, confidence, decay, prerequisites, dependents, and next verification.

### Tests

Organise by purpose, not just cadence:

- verify new learning;
- repair a diagnosed weakness;
- retain previously verified learning;
- integrate across modules;
- rehearse exam conditions.

Daily/weekly/monthly labels can exist, but they should not determine test composition.

### Material import

Start with provider declaration, chapter mapping, and manual score import. PDF upload is operationally expensive because it adds OCR quality, privacy, retention, copyright, and retrieval problems. Treat uploads as a later enrichment feature unless interviews prove they are essential to the weekly loop.

## 7. Coach architecture

The coach should be a tool-using policy layer over structured product state.

1. A router selects `plan`, `diagnose`, `debrief`, `repair`, `apply`, `triage`, `steady`, or `refuse`.
2. The system supplies compact facts and resolved prerequisite chains.
3. Deterministic services calculate schedule feasibility and score changes.
4. The model explains, asks probes, and proposes actions.
5. The user approves any plan mutation.
6. The response is logged with inputs, mode, proposal, and acceptance for evaluation.

The prompt alone is not the safety or quality system. Each mode needs a typed response schema, tool permissions, examples, offline evaluation cases, and fallbacks.

## 8. Mass-user design requirements

- Support 15-minute, 30-minute, 60-minute, and 90-minute blocks.
- Design for working candidates, college candidates, and candidates with irregular shifts.
- Use local timezone and Monday/Sunday week preference.
- Make weak connectivity survivable for test attempts.
- Preserve interrupted attempts and explain sync state.
- Keep the core interaction usable on a low-cost phone.
- Avoid shame language, streak loss, and fabricated urgency.
- Support accessibility, including keyboard navigation and screen readers.
- Let users export their plan, evidence history, and uploaded content.
- Make deletion and retention controls understandable.

## 9. MVP build order

### Phase 0 — concierge validation

Run the loop manually with 15–20 candidates for four weeks. Include both February candidates in revision mode and May candidates starting from zero. Measure whether root-cause diagnoses change what they do next.

### Phase 1 — closed product loop

Build only:

- coaching onboarding;
- official curriculum model and first verified dependency subgraph;
- class logging;
- deterministic weekly planner;
- diagnostics for the first module set;
- result debrief and re-plan;
- simple Home, Week, Syllabus, and Tests surfaces.

### Phase 2 — adaptive intelligence

Add:

- explanation checks;
- targeted probes;
- Preparedness Index and calibration gap;
- recovery levels;
- coach modes;
- manual/CSV score import.

### Phase 3 — breadth and distribution

Add more modules, self-study onboarding, optional uploads, institute pilots, applied cases, and final-phase mocks based on evidence from the first cohort.

## 10. Success metrics

### North-star metric

**Verified learning actions completed per active candidate per week.**

This connects activity to evidence. Hours logged, blocks scheduled, and coach messages do not prove the product works.

### Supporting metrics

- activation: first class/study log and first diagnostic completed within 48 hours;
- plan realism: planned minutes versus completed minutes;
- recovery success: users returning to normal/strained within seven days of a behind state;
- diagnostic utility: proportion of debriefs followed by the recommended intervention and successful re-verification;
- calibration improvement: reduction in confidence–mastery gap;
- retention: active in weeks 2, 4, 8, and final revision phase;
- trust: percentage of recommendations accepted, edited, or rejected, with reason;
- outcome learning: change in unseen-item performance, not repeated-item performance.

## 11. Decisions still requiring founder input

1. Provide 3–5 examples of the diagnostic tests from the earlier CFA Level I work, including what made their language and reasoning good. That context is not available in this workspace.
2. Choose whether v1 ships first for coaching-enrolled candidates only, or whether self-study onboarding must be launch-complete.
3. Confirm the proposed coach boundary: targeted misconception repair is included, while full curriculum teaching remains excluded.
4. Decide whether PDF uploads are truly launch-critical after interviews; the recommended default is provider mapping plus score import first.
5. Select the initial 20–25 diagnostic modules using real class schedules and candidate error data, not exam weight alone.

## 12. Sources used in this review

- CFA Institute, [2027 Level I Topic Outlines](https://www.cfainstitute.org/sites/default/files/2027levelitopicoutline_online.pdf)
- CFA Institute, [Level I exam topic weights and question conventions](https://www.cfainstitute.org/programs/cfa-program/candidate-resources/level-i-exam)
- CFA Institute, [2027 curriculum update](https://www.cfainstitute.org/about/press-room/2026/cfa-institute-announces-updates-to-cfa-program-curriculum)
- Preparoo, [current public product surface](https://fin.preparoo.app/)
- Kaplan SchweserNotes 2027 books supplied by the founder, used only to inspect structure and private provider mapping
