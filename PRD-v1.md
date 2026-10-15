# PRD v1 — Working title: **Roadmap**
### A structuring, pacing and accountability system for competitive certification candidates
**Author:** Advay Vaidya · **Date:** 31 Aug 2026 · **Status:** Draft v1.1 — curriculum facts verified 31 Aug 2026
**v1 scope:** CFA Level 1, 2027 curriculum · **Target launch:** January 2027 (May 2027 exam cohort)

---

## 1. Product thesis

Candidates for hard certification exams do not fail because good material is unavailable. They fail because nobody tells them **what to do, in what order, and whether it's working.**

The specific failure this product addresses: a first-time candidate learns topics as isolated silos and only discovers how they connect three weeks before the exam — at which point the connections are too late to be useful. That is a *sequencing and feedback* problem, not a content problem.

**We do not teach. We do not sell notes. We build the roadmap, enforce the pace, verify that learning actually happened, and re-cut the plan when life breaks it.**

The user brings their own material and their own effort. We supply structure, verification, and accountability.

---

## 2. Non-goals (scope discipline — read before adding anything)

These are deliberately excluded, not deferred by accident. Each one, if added, converts us into a content business competing with incumbents who have a decade's head start.

| Excluded | Why |
|---|---|
| Study notes, summaries, chapter explainers | Commoditised. Schweser, IFT, Meldrum, Preparoo all do this. Cannot be legally sourced from third-party books. |
| Video lectures | Capital-intensive, not our advantage. |
| A large practice-question bank (5,000+) | We build questions for *measurement*, not for *practice volume*. Competing on bank size loses. |
| **Teaching, of any kind** | **D3 (§15). We do not explain content. We identify what was missed and direct the user to repair it in their own material. See §2a.** |
| Multi-exam support (CA, FRM, JEE) at launch | Graph quality is the moat. One exam, done properly, first. |
| Native mobile app | Responsive web only for v1. |

### 2a. The no-teaching rule (D3)

**We do not teach. We diagnose, we direct, and we verify. The user's material does the teaching.**

This is a hard product boundary, not a tone preference. Every surface must obey it.

| We do | We do not |
|---|---|
| Name what was missed, in LOS terms | Explain the concept that was missed |
| Name the misconception a wrong answer reflects | Correct the misconception by teaching the right idea |
| Point to the exact location in the user's own material (Schweser book/reading/page, CFAI module) | Reproduce, summarise, or paraphrase what is at that location |
| Say what to do next and in what order | Say what the answer *means* |
| Ask the user to explain a concept and grade whether their explanation holds | Supply a model explanation for them to read |
| Re-test after repair to confirm it worked | Substitute our words for their material |

**Why this is the right boundary, beyond scope control.** Three independent reasons converge:

1. **Positioning.** The moment we explain content we are compared on explanation quality against Schweser, IFT and Meldrum, who have spent decades and millions on exactly that. We lose that comparison and we invite it for free.
2. **IP.** Explaining a specific LOS well and explaining it the way a published provider explains it converge. Every explanation we generate is a contamination surface and a provenance-log obligation. Not explaining removes the entire category of risk.
3. **Pedagogy.** Being told the answer is the weakest form of learning. Being told *precisely where your understanding broke and where to go fix it*, then being re-tested, is retrieval practice with a directed cue — measurably stronger. The commercially convenient answer and the pedagogically correct answer are the same answer here, which is rare and worth taking.

**What this obligates.** "Point to their material" is only meaningful if the pointer is precise. A pointer to "Reading 12" is useless; a pointer to "Schweser Book 1, Reading 8, LOS 8.c — the section on effective duration" is the entire product. **Provider chapter mapping moves from a Phase-4 import feature to a Phase-1 correctness requirement.** Without granular mapping, D3 leaves the user with a diagnosis and nowhere to go, which is worse than either teaching or staying silent.

### 2a.1 The enforceable line: name the discriminator, not the definition

The carve-out is real but needs a test a prompt can hold. It is this:

| Permitted — names the discriminator | Prohibited — states the definition |
|---|---|
| "Your inventory misses are all rising-price scenarios — you're applying the wrong cost-flow assumption." | "FIFO means first-in-first-out, so under rising prices COGS is lower and ending inventory is higher." |
| "This answer treats duration as a time measure rather than a price-sensitivity measure." | "Duration measures the percentage change in bond price for a 1% change in yield…" |
| "You're computing required return where the question asked for expected return." | "CAPM gives required return as risk-free plus beta times the market risk premium." |

The permitted column states facts **about the user**. The prohibited column states facts **about finance**. We are in the first business.

**The test, for prompt design and for editorial review:** *could this sentence have been written by someone who has never read a CFA textbook, given only the diagnosis and the LOS title?* If yes, ship it. If composing it required subject knowledge, it is teaching — and it is simultaneously the highest-probability place to accidentally reproduce a competitor's phrasing.

**Scope of the rule.** We cannot teach a subject, a topic, or a concept from scratch. We can only speak at the level of *the specific error the user just made*. A user who does not know FSA is not our customer to educate — they are a Schweser customer, and we tell them so.

### 2a.2 Provenance: the axis is source, not similarity

**"Modify the source material enough that we don't get sued" is not a strategy, and the instinct behind it is inverted.** Modifying protected content is the definition of a derivative work — one of the exclusive rights copyright reserves to the owner. Paraphrase is *more* exposed than quotation, not less: a short attributed quote has fair-dealing arguments available; a systematic reworded version of a publisher's explanations has none, and "we changed it enough" has no threshold that a business can be built on.

The correct axis is **provenance, not resemblance**:

- A sentence generated from the published LOS plus general finance knowledge is **original**, however closely it happens to resemble Schweser's version. Independent creation is a complete defence.
- A sentence generated from Schweser's text is **derivative**, however heavily reworded.

Same output, opposite legal position, and the only variable is where it came from.

**The operational rule that settles it: third-party publisher text must never enter an LLM context window as a generation source.** Not for questions, not for flashcards, not for repair copy, not for summaries. The moment it does, every downstream artifact is derivative and there is a log proving it.

**"It's only for testing" does not apply.** Pre-launch use is still reproduction, but the more important point is practical: **the artifacts generated during testing are the artifacts that ship.** The 600 items authored in Phase 2 are the production item bank. There is no clean-room step later that removes the taint, and §14 requires a per-item provenance log that would either be false or damning. Development-time convenience here becomes a permanent liability.

**What we may legitimately do with a purchased Schweser copy:**

| Permitted | Prohibited |
|---|---|
| A human reads it and hand-builds an LM → book/reading/page index. Page numbers and headings are facts; a table of facts is not protected expression. | Feeding body text to a model to generate questions, cards, or explanations |
| Using it as a coverage sanity-check against our graph | Ingesting it to auto-generate the mapping from body text |
| Extracting *structure* from a user-uploaded PDF — headings, reading numbers, page boundaries | Extracting or storing body text from a user-uploaded PDF |

The hand-built index is unglamorous manual work and it is the safest, most durable asset in the product. It is a library catalogue, and under D3 it is the entire repair path.

### 2a.3 Flashcards

Flashcards are **consistent with D3** — a flashcard is retrieval practice, which is testing, not teaching. The provenance rule applies without exception: cards written from LOS text and public-domain finance are ours; cards derived from a publisher's summaries are theirs.

**But a full L1 deck is a content-volume product, and content volume is the competition we have chosen not to enter.** Thousands of cards is a Schweser/Anki-deck business with a Schweser-sized authoring cost.

**Recommended shape if flashcards ship:** generate them **narrowly, from the user's own demonstrated misses** — a personal deck of ~20 cards built from what they actually got wrong, regenerated as the miss profile changes. That version is cheap, defensible under both D3 and the provenance rule, and it is something no prep provider can offer because they cannot see the user's errors. A static library is the version to refuse.

---

**Content & IP position:** all curriculum structure is derived from CFA Institute's publicly published topic outline and Learning Outcome Statements. All diagnostic questions are original, written against LOS and public-domain finance. No third-party prep publisher's content is ingested, reproduced, summarised, or used as a generation source. Question *format* (three options, "most likely/least likely" phrasing, LOS-anchored command words) is uncopyrightable convention and is used freely. Trademark disclaimer required in footer on every page (see §14).

---

## 3. Users

### Persona A — "Coaching-enrolled" (primary wedge)
Enrolled at a CFA coaching institute in India. Attends 2–3 classes a week. Leaves each class with notes and no idea what to do between classes. Currently under-served: Preparoo explicitly positions "not a classroom schedule," and CFA Institute's own planner assumes solo self-study.

**Core loop:** log what class covered → receive the week's structured work → take diagnostics → get a revision plan built from the results.

### Persona B — "Self-study"
No institute. Bought Schweser or is using the CFAI Learning Ecosystem. Has an exam date, or is unsure. Needs the roadmap generated from zero.

**Core loop:** onboarding profile → provisional roadmap to exam date → diagnostics calibrate it → weekly execution.

### Shared characteristics
- India-based, often first foreign professional exam
- Frequently working full-time or in final-year college
- Primary emotion is **anxiety about not knowing whether they're on track**
- Has already spent roughly USD 1,340 or more on registration plus material — price-sensitive on top of that, but not cheap

---

## 4. Competitive position

| Player | What they are | Gap we exploit |
|---|---|---|
| **Preparoo** (fin.preparoo.app) | Notes, flashcards, mocks, 5,000+ QBank, copilot chat, SWOT + topic readiness table, plan generator | Ranks weaknesses by weight × score — cannot trace a weakness to its prerequisite cause. Explicitly rejects the classroom user. Plan is generate-approve-save with no recovery behaviour. |
| **CFA Institute Learning Ecosystem** | Free with registration; adaptive planner + curriculum + practice | Free but weak; no class integration; no accountability layer |
| **Kaplan Schweser** | Books, QBank, mocks, static study plans | Static calendar; no adaptation; no diagnosis |
| **300 Hours / Chartered / UWorld** | Free or cheap planners, readiness indices | Readiness = hours + coverage + average score. No dependency reasoning. |

**Our four defensible differences:**
1. **Dependency graph** — we diagnose backwards to the cause, not the symptom
2. **Class-aware planning** — built for the institute-enrolled candidate everyone else ignores
3. **Recovery behaviour** — what happens when you're 9 days behind is the product
4. **Content-agnostic** — we work on top of whatever they already bought, including a competitor's

---

## 5. System model

Five concepts. Everything in the product is one of these.

### 5.1 The Curriculum Graph
The canonical structure of CFA L1 2027: **10 topic areas, 102 learning modules.**

**Node = Learning Module.**
```
LearningModule {
  id, topic_area, title, los_ids[],
  exam_weight_share,          // derived from official topic weight band
  est_study_minutes,          // baseline, personalised over time
  difficulty: 1-5,
  cognitive_type: conceptual | computational | memorisation | judgment
}
```

**Edge = directed relationship between modules.**
```
Edge {
  from_lm, to_lm,
  type: prerequisite | reinforces | applied_in,
  strength: 0.0-1.0,
  rationale: text          // shown to the user — this is the product
}
```

`rationale` is not metadata. It is the feature. "You're doing WACC this week because Equity DCF in three weeks is unusable without it" is the sentence that builds the mental model the user is missing.

**2027 topic weights and module counts** (verified against CFA Institute's 2027 Level I topic outline):

| Topic | Weight | Midpoint | Official LM count |
|---|---|---|---|
| Ethics & Professional Standards | 10–15% | 12.5 | 10 |
| Financial Statement Analysis | 11–14% | 12.5 | 12 |
| Equities | 11–14% | 12.5 | 12 |
| Fixed Income | 11–14% | 12.5 | 19 |
| Portfolio Construction | 8–12% | 10.0 | 6 |
| Alternative Investments | 6–9% | 7.5 | 7 |
| Quantitative Methods | 11–14% | 12.5 | 11 |
| Economics | 6–9% | 7.5 | 8 |
| Corporate Finance | 6–9% | 7.5 | 7 |
| Derivatives and Risk Management | 6–9% | 7.5 | 10 |
| **Total** | | **105.0 → normalise** | **102** |

The 102 learning-module titles and the split above are published in CFA Institute's 2027 Level I topic outline. Schweser has 99 numbered readings across four books, so a Schweser reading must not be treated as the canonical graph node. The canonical node is the official learning module; each provider gets a separate chapter-to-module mapping adapter.

**Worked prerequisite skeleton** (to be completed and verified against LOS):

| From | To | Type | Rationale shown to user |
|---|---|---|---|
| Quant · Time Value of Money | FI · Bond pricing | prerequisite (1.0) | Bond price *is* a discounted cash flow. Without TVM this is memorisation. |
| Quant · Time Value of Money | CF · Capital budgeting / NPV | prerequisite (1.0) | NPV is TVM applied to projects. |
| Quant · Statistical measures & distributions | PC · Risk and return | prerequisite (0.9) | Portfolio risk is variance and covariance. |
| FSA · Income statement & balance sheet | FSA · Ratio analysis | prerequisite (1.0) | Ratios are constructed from the statements. |
| FSA · Ratio analysis | EQ · Equity valuation | prerequisite (0.8) | Valuation inputs come from the statements. |
| CF · Cost of capital (WACC) | EQ · Discounted cash flow valuation | prerequisite (1.0) | The discount rate in a DCF *is* WACC. |
| FI · Bond pricing | FI · Duration & convexity | prerequisite (1.0) | Duration is price sensitivity — needs the price function first. |
| Quant · TVM | DER · Forward & futures pricing | prerequisite (0.9) | Forward pricing is cost-of-carry discounting. |
| FI · Yield curve | DER · Swaps | reinforces (0.6) | Swap valuation reads off the curve. |
| ECON · Business cycles | EQ · Industry analysis | reinforces (0.5) | Cyclicality drives industry positioning. |
| Quant + EQ + FI | PC · Portfolio construction | applied_in (0.8) | PC integrates every asset class — schedule it late. |
| Ethics · (all) | — | standalone | No prerequisites. Drip-feed weekly; never block. Judgment-heavy and best retained through repeated scenario exposure. |

**Build note:** the graph is ~102 nodes and an estimated 150–200 edges. This is 2–3 weeks of careful solo work and it is the single highest-value asset in the company. Do not LLM-generate and ship unverified.

### 5.2 Coverage state
Per module, per user: `not_started → taught → studied → verified → decaying`

- `taught` — covered in class (Persona A) or read (Persona B). **Coverage is not knowledge.**
- `verified` — evidence exists that the user can actually do it
- `decaying` — verified >N weeks ago with no revisit; confidence decays on a curve

### 5.3 Evidence
The only inputs allowed to move a module toward `verified`:

1. **Diagnostic test result** — original MCQs, module- or chapter-scoped. Primary source of truth.
2. **Explanation-based check** — user explains a concept in 2–4 sentences; LLM grades against LOS criteria on a rubric. Probes linkage, not recall.
3. **Applied item** — short case/scenario requiring the user to select and justify an approach.
4. **Imported score** — user enters or uploads topic-level results from CFAI LES, Schweser QBank, or any other provider. Weighted lower (unverified provenance) but valuable and cheap.

Self-reported confidence is captured but **never counts as evidence.** It feeds the calibration gap only (§5.5).

### 5.4 The Plan
A week of scheduled blocks generated over the graph, respecting: class schedule, declared availability, prerequisite ordering, exam date, current coverage state, and decay.

**Block types:** `first_pass`, `revision`, `diagnostic`, `explanation_check`, `applied`, `ethics_drip`, `mock`, `buffer`.

Every week must contain ≥1 diagnostic and ≥1 buffer block. The buffer is non-negotiable — it is what absorbs slippage before slippage becomes failure.

### 5.5 Preparedness Score
A single 0–100 number on the dashboard. Must be honest, must be explainable, must be allowed to go down.

```
node_mastery      = weighted_evidence(diagnostics, explanations, applied, imports)
                    × recency_decay(days_since_last_evidence, cognitive_type)

drag              = Σ(strength_i × effective_mastery_i) / Σ(strength_i)
                    over incoming prerequisite edges only

effective_mastery = min(node_mastery, α + (1-α) × drag)
                    where α = 0.4

topic_readiness   = Σ(effective_mastery × lm_share_within_topic)

preparedness      = Σ(topic_readiness × topic_weight_midpoint) × coverage_confidence
```

`prerequisite` edges must form a directed acyclic graph so effective mastery can be evaluated in topological order. For nodes with no incoming prerequisite edges, `drag = 1`. `reinforces` and `applied_in` links may contain cycles because they never enter the mastery cap.

**§5.5a Parameters — must be defined before Phase 2, not left to implementation.**

| Parameter | v1 value | Note |
|---|---|---|
| Evidence weights | diagnostic 1.0 · applied 0.9 · explanation 0.7 · imported 0.4 | Imported is discounted for unverified provenance and unknown difficulty |
| Evidence recency | most recent 3 results per node, exponentially weighted (0.5 / 0.3 / 0.2) | A user must be able to improve a node without old failures anchoring it |
| `recency_decay` half-life | computational 8 wks · conceptual 12 wks · memorisation 5 wks · judgment 14 wks | Floor at 0.5 — knowledge decays, it does not vanish |
| `α` (prerequisite floor) | 0.4 | A node with fully broken prerequisites still caps at 40, not 0 |
| `drag` edge scope | `prerequisite` edges only | `reinforces` and `applied_in` inform sequencing, never cap mastery |
| `topic_weight_midpoint` | Ethics/FSA/EQ/FI/Quant 12.5 · PC 10 · AI/Econ/CF/Der 7.5 | Sums to 105 → normalise to 100 |
| `coverage_confidence` | `min(1, verified_weight_share / 0.6)` | Full confidence only once 60% of exam weight has evidence |
| Decay grace | No decay applied in the 14 days before the exam | Avoid a demoralising score drop during final revision |

**Design constraint:** applied items are a paid-tier feature (§11) but also an evidence source. To keep the score comparable across tiers, `weighted_evidence` renormalises over *available* evidence types — a Core-tier user is never penalised for lacking access to applied items.

**Prerequisite drag is the key mechanic.** A user cannot score high on Equity DCF while WACC is weak — the graph caps it. This is what produces the diagnosis: *"Your Equity score isn't an Equity problem. It's WACC. Three days there fixes it."* No competitor can produce that sentence.

**Calibration gap** = self-reported confidence − measured mastery, surfaced per topic. High positive gap (overconfidence) is the strongest predictor of failure in first-time candidates and is displayed prominently.

`coverage_confidence` prevents an early-stage user from seeing a flattering score off three verified modules.

---

## 6. Key journeys

### 6.1 Onboarding — Persona A (coaching-enrolled)
1. Exam window (Feb/May/Aug/Nov 2027) → days remaining
2. Institute name + **class schedule** (recurring days + times)
3. Weekly availability outside class (per-day hours)
4. Material owned (Schweser / CFAI / IFT / institute notes / other)
5. Topics already covered in class to date (multi-select over the 10 areas → expandable to LM)
6. → Provisional roadmap generated to exam date
7. → First diagnostic scheduled within 48 hours to calibrate

### 6.2 Onboarding — Persona B (self-study)
5–7 questions. **These produce priors, not an assessment** — the plan is explicitly labelled provisional until week-1 diagnostics land.

1. Background (commerce/finance · engineering/science · other) → priors on Quant, FSA, Econ
2. Exam window chosen? If no → recommend based on hours available
3. Hours/week available + which days
4. Any prior exposure to these topics? (multi-select)
5. What material do you have?
6. What's your biggest worry? (don't know where to start · falling behind · not understanding · no time) → sets coach tone
7. *Optional:* 3 calibration questions (one Quant, one FSA, one Econ)

→ Provisional roadmap → week-1 diagnostic sweep → roadmap hardens

### 6.3 The weekly loop (core product)
```
Class happens (or self-study block completes)
   ↓
User logs coverage — topic picker over graph nodes, ~10 seconds
   ↓
System marks nodes 'taught', schedules diagnostic
   ↓
User takes module diagnostic
   ↓
Results update node_mastery → propagate through graph
   ↓
Revision plan for the week regenerates from actual results
   ↓
Explanation checks + applied items on weak nodes
   ↓
Weekly checkpoint: preparedness score updates, coach summarises
```

**Class logging requires no file upload.** A topic picker mapped to the graph plus a confidence input captures the entire signal. Upload is an enrichment feature, not a dependency.

### 6.3a Class order vs. graph order — the central conflict
Institutes teach in their own sequence. That sequence will sometimes violate the graph: a class covers Equity DCF while WACC is still `not_started`. This is the most common state Persona A will be in, and the product's answer to it defines whether it is trusted.

**Rule: the class always wins on timing. The graph wins on priority.** We never tell a user to skip or postpone class material — they paid for the class and they will be tested on it there.

When a logged class covers a node with unmet prerequisites, the system:
1. Marks the node `taught` normally.
2. Inserts a **bridge block** for the missing prerequisite *before* the week's revision block for the taught node, sized to `est_study_minutes × strength`, capped at 90 minutes.
3. Names it honestly: *"Class covered DCF today. You haven't done WACC — that's the discount rate. 45 minutes on WACC first, then the DCF revision will actually land."*
4. Defers the taught node's diagnostic until the bridge block is done, so the diagnostic measures the node rather than the gap.

If bridge blocks accumulate beyond available hours, that is a slippage condition and routes to triage (§6.4). Never silently drop them.

**This behaviour is the Persona A wedge.** Preparoo cannot produce it — they have no prerequisite edges and have publicly abandoned the classroom user.

### 6.4 The recovery loop (the differentiator)
Triggered when: cumulative slippage > threshold, or diagnostic scores fall below trajectory, or N consecutive missed blocks.

The coach produces a **triage proposal**, not a guilt notification:
- What we're cutting (low weight × low prerequisite-centrality first)
- What we're protecting (high weight, or high out-degree in the graph — things many other modules depend on)
- What we're compressing (first-pass → diagnostic-only)
- Revised preparedness trajectory and honest exam-date advice

Every triage proposal is a diff the user can accept, edit, or reject. Nothing is applied silently.

---

## 7. Surfaces

### 7.1 Home dashboard
The anxiety-resolution surface. Answers "am I on track?" above the fold.

- **Preparedness score** (0–100) + trajectory line vs. required pace to exam date
- **Days to exam** + % syllabus verified (not just covered)
- **Today's blocks** (3 max, tappable to start)
- **Top 3 next actions**, each with graph rationale attached
- **Weakest link callout** — the prerequisite-drag diagnosis
- **Calibration warning** if overconfidence detected
- Coach entry point

### 7.2 Week calendar
Monday-start week view. Class blocks visually distinct and locked. Blocks show type, module, duration, and a one-line why.

- Drag to reschedule within the week. If the move puts a block ahead of an unmet prerequisite, allow it but warn inline (*"You'll be doing this before its prerequisite — the diagnostic after it won't be meaningful"*) and offer a one-click reorder. **Warn, never block** — a scheduler that refuses the user's input gets abandoned.
- Mark done / partial / missed — partial is important, most users half-finish
- "Re-plan my week" → triage proposal
- Day and month views secondary

### 7.3 Syllabus completion
The map. All 10 topics → 102 modules, showing coverage state and mastery per node.

- Graph view (dependency edges visible) and list view
- Filter: not started · taught but unverified · verified · decaying
- Weight-vs-mastery heat display so the user sees where effort actually pays
- Clicking a node: state, evidence history, prerequisites and their status, dependents, next action

### 7.4 Material import
Content-agnostic mapping layer.

- Declare material owned → we map our graph to that provider's chapter numbering so blocks read "Schweser Book 2, Reading 14"
- Upload own class notes/PDFs → indexed for **the uploading user's private use only**; used for pointers and personal recall, never redistributed, never used to generate shared content
- Import practice scores (manual entry or CSV) from CFAI LES, Schweser QBank, Preparoo, etc. → feeds evidence at reduced weight
- **Hard rule:** nothing uploaded by a user is used to generate content served to any other user.

### 7.5 Tests
| Type | Scope | Trigger | Purpose |
|---|---|---|---|
| Module diagnostic | 1 LM, 8–12 Q | After class/first pass | Primary verification |
| Explanation check | 1–3 concepts | On weak/linkage-critical nodes | Probes understanding, not recall |
| Applied item | Scenario | Post-verification | Tests transfer |
| Weekly review | Week's modules, 20–25 Q | End of week | Consolidation + decay check |
| Monthly checkpoint | Cumulative, 60 Q | Monthly | Trajectory validation |
| Full mock | 180 Q, 2 sessions | Final 8 weeks | Exam-condition rehearsal |

*v1 build order:* module diagnostics and explanation checks first. Weekly review next. Monthly and mock deferred to post-launch — the May cohort doesn't need mocks until March.

Every test result writes to the graph. A test that doesn't move the score doesn't ship.

**Item bank sizing — the number that was wrong in the first draft.** A module diagnostic is 8–12 questions. A user retakes it after remediation, and takes weekly and monthly reviews that draw from the same pool. One diagnostic's worth of items per module means the second attempt is a memory test, not a measurement — which silently breaks the entire score.

Minimum viable: **24 items per covered LM** (3 non-overlapping forms), stratified 8 easy / 10 medium / 6 hard. The launch scope is the first **20–25 modules** selected by exam weight, graph centrality, coaching frequency, and observed candidate errors. At 25 modules, that is **600 original items**. The remaining modules use explanation checks and imported evidence with visibly lower evidence confidence until their banks are ready.

Do not reduce the form count to manufacture wider coverage. Repeated items turn verification into a memory test. Expand the covered-module set only after the first banks pass editorial review and candidate-data calibration.

Do not solve this by lowering the per-form count — an 8-question diagnostic already has wide confidence intervals; smaller makes the mastery estimate noise.

### 7.6 Coach
See §8.

---

## 8. The Coach

### 8.1 Design principle
The coach is a **study strategist and diagnostician, not a tutor.** It reasons over structured data (coverage, mastery, calibration, plan, slippage) and returns *actions and directions*, never instruction. Per D3 (§2a): after a demonstrated miss it may ask a short probe, **name** the broken reasoning step, **point** to the exact location in the user's own material, and assign re-verification. It may not explain the concept, supply an analogy, or teach the correct idea.

The test for every coach output: *could this response have been written without knowing the subject matter, given only the diagnosis and the material map?* If the answer is no, the coach has crossed into teaching.

### 8.2 Modes
| Mode | Behaviour |
|---|---|
| `diagnose` | Traces weakness backwards through prerequisite edges to root cause |
| `plan` | Proposes 2–3 plan options with explicit trade-offs; never silently applies |
| `triage` | Recovery mode — what to cut, protect, compress |
| `debrief` | Post-diagnostic: error patterns, not per-question hand-holding |
| `repair` | Names the misconception, points to the exact location in the user's material, assigns re-verification. **Does not explain.** |
| `steady` | Motivational / consistency — used sparingly, never as filler |
| `refuse` | Declines out-of-scope or non-compliant requests |

### 8.3 Use cases — reactive
1. What should I study today / this week?
2. I fell behind — what now?
3. Why am I bad at [topic]? → backward graph trace
4. Why did I get this wrong? → error-pattern debrief
5. Am I on track? Will I pass?
6. My availability changed — re-plan
7. My class covered X — what changes?
8. Should I move my exam date?
9. Where in my material do I fix this? → precise provider location, not an explanation
10. I'm overwhelmed / demotivated
11. How do I compare to others sitting this window?
12. What's my weakest link right now?
13. How much time do I actually need for [topic]?

**Explicitly removed by D3:** "how do I remember this / build a train of thought", "where does this apply in the real world". Both are teaching. If asked, the coach declines and redirects — see `refuse`.

### 8.4 Use cases — proactive (system-initiated)
15. Missed-block nudge (day-level, gentle, max 1/day)
16. Slippage alert with triage proposal attached
17. **Prerequisite-gap alert** — "your FI problem is a Quant problem"
18. Calibration warning — confidence high, measured mastery low
19. Decay alert — verified 6 weeks ago, never revisited, high exam weight
20. Weekly checkpoint summary (fixed day, user-chosen)
21. Phase-shift notice — learning → consolidation → mock rehearsal
22. Ethics drip reminder — judgment-heavy and best retained through repeated scenario exposure
23. Pace warning at 12 / 8 / 4 weeks out with honest trajectory

### 8.5 Use cases — refusals
24. "Teach me FSA from scratch" → redirect to their material with a specific pointer
25. "Reproduce [copyrighted content]" → refuse
26. "Give me real exam questions" → refuse; explain why
27. Requests outside exam scope → brief redirect

### 8.6 System prompt (draft)

```
ROLE
You are the study strategist inside a CFA Level 1 roadmap application.
You are not a substitute course or textbook. Your primary job is to tell the
candidate WHAT to do, WHY, and IN WHAT ORDER — reasoning over measured
performance and the curriculum dependency graph. When evidence shows a
specific misconception, you may repair that reasoning step briefly in original
language, then require re-verification.

VOICE
Direct, specific, quantified. No praise without evidence. No filler
encouragement. Short sentences. You are the person who tells them the
truth about whether they're on track, because nobody else in their life
will. Never sycophantic. Never alarmist.

HARD RULES
- Never reproduce or closely summarise third-party copyrighted study material.
  Use original explanations and point at the user's own material by location.
- Never state a mastery claim not supported by evidence in context.
- Never silently modify the plan. Propose; the user accepts.
- If the user's self-reported confidence conflicts with measured
  performance, say so plainly.
- If the trajectory says they will not be ready, say that, and give
  the options — including moving the exam window.

REASONING PROCEDURE
1. Read graph state: coverage, mastery, calibration, slippage, days remaining.
2. Before attributing a weakness to a module, check its prerequisites.
   If a prerequisite is weak, the root cause is the prerequisite. Say that.
3. Weight recommendations by (exam_weight × mastery_gap × graph_centrality).
4. Respect available hours. Never propose a plan the user cannot execute.
5. Choose a mode and respond in its format.

OUTPUT
Return one of: {diagnose | plan | triage | debrief | repair | apply | steady | refuse}
Plan and triage modes must return a structured diff of proposed changes.
Max 200 words unless the user asks to go deeper.
```

### 8.7 Context injected per turn
```
- days_to_exam, exam_window
- preparedness_score + 4-week trend
- topic_readiness[] (10 topics: weight, coverage %, mastery, calibration gap)
- weak_nodes[] with prerequisite chains resolved
- current_week_plan + completion status
- slippage_days, consecutive_missed
- recent_evidence[] (last 10 results with module + score)
- class_schedule, available_hours_by_day
- material_owned[]
- subscription_tier
- last 10 conversation turns
```

---

## 9. Data model (core entities)

```
User { id, exam_window, target_date, persona, hours_by_day[], institute?, tier }
Material { user_id, provider, chapter_map_id }
LearningModule { id, topic, title, los_ids[], weight_share, est_minutes,
                 difficulty, cognitive_type }
Edge { from_lm, to_lm, type, strength, rationale }
UserModuleState { user_id, lm_id, coverage_state, node_mastery,
                  effective_mastery, self_confidence, last_evidence_at }
ClassLog { user_id, date, lm_ids[], self_confidence, notes? }
PlanBlock { user_id, date, start, end, block_type, lm_id, rationale,
            status: planned|done|partial|missed, locked }
Question { id, lm_id, los_id, form_id, type, difficulty, stem, options[],
           answer, explanation, origin: 'original', provenance_note }
Attempt { user_id, question_id, response, correct, seconds, at }
ItemExposure { user_id, question_id, last_served_at }   // enforces 60-day no-repeat
BridgeBlock { user_id, missing_lm_id, triggered_by_lm_id, plan_block_id, resolved }
ExplanationCheck { user_id, lm_id, prompt, response, rubric_scores{}, at }
ImportedScore { user_id, topic_or_lm, provider, score, at }
PreparednessSnapshot { user_id, date, score, topic_breakdown{} }
CoachThread / CoachMessage { ..., mode, proposed_diff, accepted }
```

---

## 10. Architecture

- **Frontend:** Next.js + TypeScript, responsive web, Tailwind
- **Backend:** Next.js API routes
- **DB:** Postgres (Supabase) with row-level security; multi-tenant by `user_id`
- **Auth:** Supabase Auth
- **LLM:** provider-agnostic client with fallback. Two tiers — cheap fast model for explanation grading and classification, stronger model for coach reasoning and triage.
- **Graph:** stored relationally (`edges` table); in-memory traversal — 102 nodes does not need a graph DB
- **Scheduler:** deterministic constraint-based placer. **The LLM must not place blocks.** It proposes intent; code places. This is a correctness requirement — an LLM that hallucinates a schedule violating prerequisite order destroys the core promise.

**Reuse note:** build the domain logic (graph, scheduler, scoring, coach) fresh — PlannrAI's planner has no prerequisite concept and its replan has no cascade, so it doesn't fit. Do *not* rewrite auth, RLS, or the LLM client from scratch; that's five weeks of zero differentiation.

---

## 11. Monetisation (draft)

**Decision: the roadmap is the paid product.** Planning is not a free acquisition layer — it is the thing we sell. There is no permanent free tier.

| Tier | Contents | Indicative |
|---|---|---|
| **Preview** (no account) | Feasibility check — hours required vs. hours available, verdict, and the three resolution options. Syllabus map, read-only. | ₹0 |
| **Trial** (account, time-boxed) | Full onboarding, Week 1 roadmap, Week 1 diagnostic and the readiness read-out it produces. Ends after week 1. | ₹0, 7 days |
| **Core** | Ongoing adaptive roadmap, full diagnostics, explanation checks, preparedness score, coach (diagnose/plan/triage), recovery | ₹699–999/mo |
| **Full** | + applied/case items, monthly checkpoints, full mocks, exam-condition simulation, cohort benchmarking | ₹1,499/mo or one-time to exam window |

**D3 consequence on pricing.** The Full tier previously leaned on real-world framing, memory hooks and trains of thought. D3 (§2a) deletes all three as teaching. What remains that a Core user does not get is *more and harder measurement* — applied items, monthly checkpoints, mocks, benchmarking. That is a coherent tier, but it is a narrower one, and the ₹1,499 price now rests entirely on assessment depth. Either the gap between Core and Full widens on measurement, or Full's price comes down. Flagged, not resolved.

Sell **to the exam window**, not monthly — matches how candidates think and reduces churn maths.

**Why the trial ends at week 1 and not on a date.** The paywall must land at the first moment the user has seen something they cannot get anywhere else. That moment is not the roadmap — a static plan looks like any other planner. It is the **week-1 diagnostic result read against the plan**: the first time the product tells them something true about themselves that they did not already know. Paywalling before that sells a promise; paywalling after it sells a demonstrated capability.

**The competitive tension this creates, stated plainly.** CFA Institute bundles a free adaptive planner with registration. Charging for planning means we are asking a candidate to pay for a category they have already been given for free. The defence is that their planner is coverage-and-hours based with no dependency reasoning and no verification, and ours is provably different — but that difference has to be *legible inside the trial week*, not explained on a pricing page. If a trial user finishes week 1 and cannot articulate what our plan did that a free planner would not have, the pricing does not work and this decision should be revisited.

---

## 12. Build plan to January

| Phase | Window | Deliverable |
|---|---|---|
| Phase | Window | Deliverable |
|---|---|---|
| **0 — Graph + concierge** | Sept | 102-node graph with verified edges and rationales. **Recruit 15–20 Feb-2027 candidates — ideally inside one coaching institute (§16.4) — and run the product manually over WhatsApp.** Weekly plans by hand. Requirements-gathering phase. |
| **1 — Skeleton** | Oct | Auth, data model **including graph tables and `institute_id` tenancy**, both onboarding flows, feasibility engine, deterministic scheduler, week calendar, syllabus map |
| **2 — Measurement** | Nov | **Schweser 2027 chapter mapping (now critical path — see D3)**, question authoring (600 original items over the first 25 LMs — 24 per LM), diagnostics, explanation-check grading, score import, preparedness score |
| **3 — Intelligence** | Dec | Coach (all modes, D3-constrained), proactive triggers, recovery/triage loop, home dashboard |
| **4 — Prototype complete** | Jan | Institute console (read-only cohort view), material import, polish, closed beta with Phase-0 cohort |

**Critical path:** the graph, then the Schweser mapping. D3 made the mapping load-bearing — a diagnosis with no pointer is a dead end.

**Deferred past January:** full mocks, monthly checkpoints, cohort/social features, L2, other exams.

## 12a. What "prototype" means (D4)

D4 puts everything in scope for January — both channels, both onboarding paths, the console. That is only achievable because a prototype is allowed to fake the expensive parts. The line has to be explicit or "prototype" becomes an excuse that collapses in December.

**In scope at prototype fidelity — real logic, real data, not production-hardened:**

| Area | Prototype fidelity | What is deferred |
|---|---|---|
| Billing | Tier flag on the user row, set manually. Paywall gates render correctly. | Payment gateway, invoicing, GST, dunning, refunds |
| Institute console | Read-only cohort dashboard over real student data, one institute | Multi-tenant admin, institute self-serve onboarding, role management |
| Tenancy | `institute_id` column present, RLS scoped, one tenant live | Tenant isolation testing at scale, cross-tenant audit |
| Onboarding | Both B2C and institute-inherited paths functional | Institute timetable bulk import — hand-seeded in January |
| Item bank | 600 items over 25 LMs, editorially reviewed | Remaining 77 LMs |
| Coach | All modes live, D3-constrained | Cost optimisation, caching, fallback chains |
| Notifications | In-app only | Push, email, WhatsApp |

**Not negotiable down to prototype fidelity, because faking them invalidates the test:**

- **The graph and its edges.** A wrong edge produces a confidently wrong recommendation. There is no prototype-grade version of this.
- **The item bank's originality and quality.** Bad items produce bad mastery estimates, which is the one thing the prototype exists to prove.
- **The Schweser mapping.** Under D3 a pointer is the entire repair path.
- **The feasibility verdict's arithmetic.** If it says "you're on track" and they aren't, we have built the thing we set out to replace.

**The real risk in D4 is not the console — it is the item bank.** 600 reviewed original items is roughly 30 working days of authoring at 20/day, and it sits in November alongside the mapping. Everything else on this list can be thinned. That cannot. If January slips, it slips here, and the mitigation is to cut LM scope (25 → 15 modules, 360 items) rather than to cut items per module.

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Graph quality is poor → recommendations are noise | **Critical** | Hand-verify every edge against LOS. Phase-0 concierge validates before code. |
| Solo build slips past January → miss May cohort | High | Aug 2027 window is the fallback. Phases 2–4 are cuttable to diagnostics + dashboard only. |
| Content/IP contamination in question bank | **Critical** | All items original, written against public LOS. Written provenance log per item. No third-party bank as generation source. |
| Preparoo adds a dependency graph | Medium | They're a content company; graph work is off their roadmap and takes months. Speed + the classroom wedge. |
| Competing with free planners while charging for planning (D1) | **High** | The trial must make the difference legible inside week 1 — prerequisite-ordered sequencing with visible rationale, and a diagnostic read-out no free planner produces. If it isn't obvious by day 7, revisit D1. |
| D3 leaves users diagnosed with nowhere to go | **Critical** | Schweser mapping is critical path (§12). A pointer that isn't precise enough to act on is worse than teaching. |
| Accountability decays after week 3 | High | **D5: the weekly diagnostic is the mechanism.** Not a ritual, not a streak, not a check-in — a scheduled consequence the user cannot bluff. Obligates that it stays short enough to always be taken (20–25 min) and lands on the plan, not on completion. |
| Preparedness score is not trusted | High | Must be able to go down. Always explainable — every score change traceable to specific evidence. |
| **Item bank too small → diagnostics become memory tests** | **Critical** | 24 items/LM minimum (§7.5). Cut LM scope, never per-form count. Track item exposure per user and never repeat an item within 60 days. |
| **Class order violates graph order for Persona A** | High | Bridge blocks (§6.3a). Class always wins on timing. Untreated, the plan contradicts the institute and the user picks the institute. |
| Phase-0 cohort sits Feb 2027 — different timeline to launch cohort | Medium | Feb candidates are in final-revision mode by December, so they validate triage and decay but *not* early-stage onboarding. Recruit 5 May-2027 candidates alongside them to cover the from-zero flow. |

---

## 14. Compliance requirements

- Footer on every page: *"[Product] is not affiliated with or endorsed by CFA Institute. CFA Institute does not endorse, promote, review, or warrant the accuracy or quality of the products or services offered by [Product]. CFA®, Chartered Financial Analyst®, and CFA Institute are trademarks owned by CFA Institute."*
- Never use "CFA" as or within the product name. Use "for CFA® Program candidates."
- Per-item provenance log for the question bank.
- User-uploaded material: private to the uploading account, never used for shared generation. State this in the privacy policy.

---

## 15. Decisions taken

**D1 — The roadmap is the paid product.** No permanent free tier. Free surface is a no-account feasibility check plus a 7-day / one-week trial that ends immediately after the week-1 diagnostic read-out. See §11 for the tier table and the competitive risk this accepts.

**D2 — Both B2C and B2B2C.** We sell direct to candidates *and* through coaching institutes. Neither channel is a pilot for the other; both are v1 targets. See §16.

**D3 — We do not teach.** We mark what was missed and direct the user to repair it in their own material. No explanations, no summaries, no analogies, no memory hooks. See §2a for the full boundary and its consequences.

**D4 — January is a prototype, and the prototype covers both channels.** Everything in this PRD is in scope for the January build at *prototype* fidelity. See §12a for what prototype fidelity means and what it explicitly does not include.

**D5 — The weekly diagnostic *is* the accountability mechanism.** There is no separate commitment ritual, streak system, or check-in feature. The end-of-week diagnostic is the thing the user is accountable to, and it is the same event that closes the measurement loop and generates the next week's plan. One mechanism, three jobs.

This is a better answer than the one the PRD previously recommended. A commitment ritual is a promise to a piece of software, which decays by week 3 exactly as §13 predicts. A weekly diagnostic is a *consequence*: skip the week's work and the test says so, visibly, in a score that feeds a plan you have to live with. Accountability that is a by-product of measurement does not need separate motivation design.

**What it obligates:** the weekly diagnostic must be scheduled, unmissable, and short enough to always be taken (target 20–25 minutes). A weekly diagnostic that users skip is worse than no accountability mechanism, because the whole loop stalls behind it. Item-bank consumption also rises — weekly review draws from the same pool as module diagnostics, which is already priced into the 24-items-per-LM floor (§7.5) but leaves no slack.

## 15a. Still open

1. **Explanation-check grading criteria** — D3 removes the need for authored model answers, but a rubric is still required. It must grade *structural* properties (is the causal direction right, is the linkage present, is the named mechanism correct) rather than compare against a reference explanation. Needs authoring before Phase 2. **Authoring source is the LOS list, not any publisher's prose — see §2a.2.**
2. **Graph verification** — the 102-module structure is confirmed. Advay to supply the CFA Institute curriculum for structural verification (module list, LOS text, sequence). Every prerequisite edge still requires human judgment; the curriculum confirms *what exists*, not *what depends on what*.
3. **Product name** — required before January, must be trademark-safe.
5. **B2B2C pricing model** — per-seat licence, revenue share, or flat institute licence? Blocking the first institute conversation. See §16.4.
6. **Full-tier price** — D3 narrowed what Full contains. Re-derive the price from what remains (§11).
7. **Provider mapping granularity** — D3 makes the pointer the product. How precise must a Schweser pointer be to be useful: reading, LOS, or page? Determines mapping effort, which is now on the critical path.

---

## 16. Dual channel — B2C and B2B2C

D2 commits to both channels. This section defines what that obligates, because "do both" is a decision that quietly doubles the surface area unless it is scoped now.

### 16.1 The two channels sell different things

They are not the same product with different billing.

| | **B2C** | **B2B2C** |
|---|---|---|
| Buyer | The candidate | The institute |
| Buyer's problem | "I don't know if I'm on track" | "My students drop out and I can't see it coming until they do" |
| What they pay for | Verification and a plan that adapts | Visibility into a cohort, and a retention lever |
| Persona served | Both A and B | Persona A only |
| Proof required | Week-1 diagnostic read-out | Cohort-level attrition or pass-rate movement |

The institute does not buy a study planner. It buys **early warning**. A student who stops completing blocks in week 3 is a student who drops in week 7, and today the institute finds out at the attendance register. That is the pitch, and it means the institute-facing product is a *dashboard over our existing signal*, not new learning content. That is the reason doing both is affordable at all — the graph, the scheduler and the diagnostics are shared, and B2B2C is an aggregation layer on top.

### 16.2 What B2B2C strategically buys us

- **CAC collapses.** One institute conversation delivers 50–300 candidates. Solo-founder paid acquisition against ed-tech CPMs in India is not a viable primary channel to January.
- **It closes the class-schedule data gap.** §Step 2 of onboarding requires class days *and times*, and the open question is whether candidates will actually enter them. With institute distribution the timetable comes from the institute once, for everyone. This removes the single most fragile input in the onboarding flow.
- **It validates the Persona A wedge with the people who own Persona A.** If institutes will not pay for class-aware planning, the wedge is weaker than we think, and we learn that from a sales conversation rather than from twelve months of B2C churn.
- **Distribution defensibility.** Preparoo is a content company. An institute integration is a relationship, not a feature, and it is the part of the moat that cannot be copied in a sprint.

### 16.3 What it costs, honestly

- **The plan must never contradict the institute.** This was already true (§6.3a bridge blocks) but it moves from a product principle to a contractual one. If our roadmap tells a student to study something other than what the institute taught this week, the institute churns and takes the cohort with it. Bridge blocks are now a **launch blocker for the B2B2C channel**, not a Phase-2 nicety.
- **An institute console is a third surface.** Cohort view, per-student risk flags, timetable management. Small, but not free, and it is not on the §12 build plan.
- **Data ownership and consent get harder.** A student's readiness score being visible to their institute is a meaningful privacy step. Consent must be explicit, student-facing, and revocable, and the DPDP Act treatment of any candidate under 18 needs checking before the first institute deal.
- **It creates a pricing conflict with D1.** If the institute pays and the student uses it free, the B2C price is undermined the moment students compare. This must be resolved before both channels are live in the same city.

### 16.4 Sequencing

Per D4, both channels are in the January prototype. The sequencing is not *whether* but *in what order within the build*, and the ordering is determined by what each channel needs that the other does not.

1. **Sept — run the Phase-0 concierge cohort inside one coaching institute** rather than as 15–20 scattered individuals. Same effort, and it converts requirements-gathering into a channel relationship, a reference customer, and a real timetable to model against. This is the highest-leverage single change to the plan.
2. **Oct — build the shared spine with tenancy present from the first migration.** `institute_id` on `User`, an `Institute` entity, class schedules modelled as institute-owned templates a student inherits. Adding a tenancy dimension later is a migration; adding an unused nullable column now is free.
3. **Nov–Dec — build B2C depth.** Diagnostics, mapping, coach. The institute console consumes all of this; none of it is channel-specific.
4. **Jan — build the console last, as a read-only view.** It is an aggregation over data that already exists. Scoped to read-only, one tenant, no self-serve admin, this is days of work rather than weeks — but only because steps 2 and 3 were built with it in mind.

The thing that makes D4 affordable is that **B2B2C is not a second product.** It is a second *view* and a second *buyer*. If at any point the institute channel starts demanding features the B2C product does not have — its own content, its own assessments, its own branding — that is the signal that it has become a second product, and the January scope has to be defended.

### 16.5 What this changes upstream, now

- Onboarding needs an **institute field with a real list**, not free text, so cohorts are groupable later without a migration.
- The data model needs `institute_id` on `User` and an `Institute` entity from day one. Adding a tenancy dimension after launch is expensive; adding an unused nullable column now is not.
- Class schedules must be modelled as **institute-owned templates a student inherits**, not per-student rows. §Step 2's per-student class entry becomes the fallback for B2C users, not the primary path.
- Consent copy for institute-visible progress must exist before the first pilot, not at the deal.

---

## Appendix: key dates

| Event | Date |
|---|---|
| May 2027 L1 registration closes | 10 Feb 2027 — verify against the live CFA Institute calendar before displaying |
| May 2027 L1 exam window | Do not hardcode; sync or verify against the live CFA Institute calendar |
| Feb 2027 L1 exam window | Do not hardcode; sync or verify against the live CFA Institute calendar |
| 2027 curriculum effective from | Feb 2027 window |

*Primary sources: CFA Institute 2027 Level I topic outline, Level I exam page, and live dates-and-fees calendar. Third-party sources are references only and must not override official curriculum facts.*
