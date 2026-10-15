# Onboarding & plan generation — build spec

Implementation-grade consolidation of `PHASE-1-onboarding-landing-login.md`, `ONBOARDING-brainstorm.md`, and `EFFORT-MODEL.md`. Where they disagree, this document wins.

Scope: everything from first landing to a generated Week 1, both channels. Not in scope: dashboard, tests tab, coach, week 2+ replanning (week 2+ depends on this and is specified separately).

---

## 1. Constants

Single-sourced. These appear in the verdict, the scheduler, and the triage trigger, and must not drift.

```ts
// Effort model
REFERENCE_TOTAL_HOURS   = 270   // Σ effort_lm at rate 1.00× for a first-time candidate
REQUIRED_HOURS_FLOOR    = 350
REQUIRED_HOURS_CEILING  = 1000
RATE_PRIOR_WEIGHT       = 5     // w, global multiplier
TOPIC_PRIOR_WEIGHT      = 3     // w, topic multiplier (shrinks toward user's global)
RATE_OBS_CLAMP          = [0.4, 3.0]

// Scheduling
WEEK1_PLAN_FRACTION     = 0.75  // of computed capacity
ONGOING_PLAN_FRACTION   = 0.85
MAX_SESSION_MINUTES     = 50    // default; user-overridable within [25, 90]
REVIEW_BUDGET_EARLY     = 0.00  // weeks 1–3
REVIEW_BUDGET_MID       = 0.15  // week 4 → consolidation
REVIEW_BUDGET_FINAL     = 0.35  // consolidation phase
CONSOLIDATION_FRACTION  = 0.18  // of total window, min 2 weeks
SPACED_REVIEW_OFFSETS   = [7, 21, 56]  // days after a topic block closes

// Hard gate (D6) — impossible, not merely infeasible
UNCUTTABLE_CORE_FRACTION = 0.65  // Ethics+Quant+FRA+Equity+FI as a share of scope
HARD_GATE_HOURS          = 228   // REQUIRED_HOURS_FLOOR × UNCUTTABLE_CORE_FRACTION
HARD_GATE_MIN_WEEKS      = 4     // from a standing start

// Conventions
WEEKDAY = ISO_8601        // 1 = Monday … 7 = Sunday. NOT JS/Postgres 0-indexed.
```

`WEEKDAY` is the single most likely silent bug in the build. The current prototype uses index-0-is-Monday, which disagrees with both JavaScript and Postgres. Name the constant, use it everywhere, never write a bare day index.

---

## 2. Data model

### 2.1 Onboarding output contract

Everything the planner is allowed to read. If the planner needs something not on this list, onboarding is incomplete.

```ts
UserProfile {
  timezone: string                    // IANA, browser-detected then confirmed
  exam_window: 'feb_2027' | 'may_2027' | 'aug_2027' | 'nov_2027'
  exam_date: Date | null              // null until CFAI publishes the user's slot
  registration_status: 'registered' | 'not_registered'
  finance_background: BackgroundBucket
  esl: boolean
  no_quant_background: boolean
  stage: 'not_started' | 'started_stopped' | 'studying' | 'revision'
  stage_recency_months: number | null // required iff stage = started_stopped
  institute_id: string | null
}

TimeBudget {
  per_weekday_minutes: number[7]      // ISO order, index 0 = Monday
  max_session_minutes: number
  declared_weekly_hours: number       // what they said
  computed_weekly_hours: number       // what their days add to
  is_hypothesis: true                 // week 2 overwrites from observation
}

ClassSchedule[] {
  weekday: 1..7
  start_time: time
  duration_minutes: number
  topic_id: string | null             // enables bridge blocks
  source: 'user' | 'institute_template'
  confirmed_by_student: boolean
}

NonNegotiable[] {
  weekday: 1..7
  start_time: time
  duration_minutes: number
  label: string
}

MaterialMapping {
  provider: 'schweser_2027' | 'cfai_curriculum' | 'institute' | 'other'
  mapping_precision: 'los' | 'reading' | 'none'   // D7: LOS is the target. 'page' removed.
  mapped_lm_count: number
  unmapped_lm_ids: string[]
}

FeasibilityVerdict {
  required_hours_low: number
  required_hours_high: number
  available_hours: number
  ratio: number
  state: 'comfortable' | 'tight' | 'infeasible'
  rate_multiplier: number
  n_observations: number              // 0 at onboarding
  chosen_resolution: 'proceed' | 'move_window' | 'find_hours' | 'triage' | null
}
```

**Note what is absent.** There is no `ModulePrior.self_report`, no topic confidence slider, no learning style, no goals free-text. Module priors are produced by the day-1 placement diagnostic and by observed completion, never by a survey. Confidence is collected per-question inside diagnostics so the calibration gap stays uncontaminated.

### 2.2 New tables required

```sql
learning_modules   (id, topic_id, name, los_count, effort_units, difficulty_weight)
lm_edges           (from_lm, to_lm, kind, strength, rationale)
                   -- kind: prerequisite | reinforces | applied_in
user_module_state  (user_id, lm_id, coverage_state, last_verified_at,
                    planned_hours_consumed, verification_passes)
                   -- coverage_state: not_started|taught|studied|verified|decaying
user_rate_estimate (user_id, topic_id NULL, multiplier, n_obs, updated_at)
                   -- topic_id NULL = global
institutes         (id, name, ...)
class_templates    (institute_id, cohort_id, weekday, start_time, duration, topic_id)
```

`institute_id` and `institutes` ship in the first migration even with one tenant live (PRD §12a).

---

## 3. B2C flow

### 3.1 Tier 0 — pre-account feasibility check

**One screen. Four fields. No transitions.** Every transition pre-account is a drop-off point.

| Field | Type | Validation |
|---|---|---|
| Exam window | select + "not registered yet" checkbox | window must be open for registration or already held by user |
| Finance background | 5-option radio (§4.1) | required, no default |
| Hours per week, realistically | number | 1–70; >40 triggers a soft "are you sure" |
| Where you are now | 4-option radio; `started_stopped` reveals a recency field | required, **no default** |

The current prototype pre-fills every answer including `stage: 'in-progress'` and `coveredTopics: ['Quantitative Methods']`. Delete all defaults. A pre-filled answer is a wrong answer the user never notices they gave.

**Output: the verdict card.** Screenshot-clean — that costs nothing and a screenshot is a share. **No share affordance, no OG image, no public verdict URL: those are Phase 3** (D8). The consequence to hold in view is that B2C has no organic acquisition mechanism at launch; acceptable for a prototype under D4, and a Phase-3 blocker the moment we want users we did not personally recruit.

```
21 weeks · 189 hours available · 350–520 needed
You are roughly 160 hours short.

[ Move to the May window ]  [ Find the hours — show me where ]  [ Triage: study less, deliberately ]
```

The verdict **must be allowed to say no.** An infeasible verdict pre-payment is the strongest conversion event we have — it is the thing no free planner does and no prep provider is incentivised to do.

#### 3.1a The hard gate (D6)

We gate. A candidate the arithmetic cannot serve does not get a plan for that window, and we say so before they pay. Selling a plan we know cannot work contradicts the positioning outright: a product whose claim is that it tells the truth about time must be willing to lose the sale.

**Gate the impossible, not the merely infeasible.** Collapsing these destroys the triage machinery in §5.7:

| | Condition | Behaviour |
|---|---|---|
| Infeasible | `available < required_low` but `available ≥ HARD_GATE_HOURS` | Verdict card, three resolutions, triage plan available |
| **Impossible** | `available < HARD_GATE_HOURS` **or** `weeks < HARD_GATE_MIN_WEEKS` from a standing start | **No plan for this window.** Next window offered, answers carried forward |

Below the uncuttable core there is no honest plan to sell, only a lottery ticket. Above it there is, and triage is exactly the machinery for saying so.

```ts
function gate(available_hours: number, weeks: number, stage: Stage) {
  if (weeks < HARD_GATE_MIN_WEEKS && stage !== 'revision') return 'impossible'
  if (available_hours < HARD_GATE_HOURS) return 'impossible'
  return null   // fall through to the normal verdict
}
```

Two constraints on the implementation:

- **Gate on `computed_weekly_hours`, never `declared`.** §3.4 exists because declared hours are systematically wrong. Gating a real user out on a number they mistyped is the worst available failure of this feature. Run the reconciliation *before* the gate, not after.
- **`revision` stage bypasses the weeks floor.** A candidate four weeks out on their third pass is not a standing start, and `HARD_GATE_HOURS` still catches the genuine impossibilities.

### 3.2 Auth

- Magic link primary, password secondary. No reason to hold password hashes.
- **Carry Tier 0 answers through signup.** Losing them is the most avoidable churn event in the flow.
- **Route by state, not path:** `has_plan → /dashboard`, `has_profile → /plan/generate`, else `/onboarding`.
- Persist partial state against the pre-account session; resume via magic link.
- Delete `/onboarding?demo=1` before any external user sees the build.

### 3.3 Tier 1 — post-signup

Four screens. The user has committed, so the friction budget is different.

1. **Timezone.** Browser-detected, confirmed in one line. Do not skip the confirmation.
2. **Class schedule.** Weekday + start time + duration + optional topic. Days alone are useless — a class on Tuesday tells the scheduler nothing; Tuesday 18:00–21:00 tells it Tuesday evening is gone and Tuesday night is low-value. The optional topic field is what makes bridge blocks possible.
3. **Non-negotiables.** Commute, job, prayer, gym, family. Immovable. The first time we schedule over something sacred the user stops trusting the calendar, and there is no recovery from that.
4. **Material source.** No default (D3). **Pointers are LOS-level (D7)** — reading number plus LOS, never a page number. If the chosen provider is unmapped, state the degradation honestly — *"we'll point you to the reading, not the LOS."* **A fabricated pointer is worse than no pointer**, because under D3 the pointer is all we have.

### 3.4 Declared-vs-computed reconciliation

Runs after screen 3.3.2. If `|declared_weekly_hours − computed_weekly_hours| > 2`:

> You told us 15 hours. Your days add up to 9. Which one is true?
> `[ My days are right — plan 9 ]  [ I have more time — let me redo the days ]`

Never resolve silently. This is the first moment the product demonstrates it is reading answers rather than filing them, and attention is the entire value proposition.

---

## 4. Required-hours computation

### 4.1 Background buckets → rate prior

| Bucket | Prior | Range |
|---|---|---|
| `finance_pro` — working in finance, CA, or CFA resit | 0.75 | 0.6 – 1.0 |
| `commerce_degree` | 1.00 | 0.8 – 1.3 |
| `some_exposure` — other degree, internship/self-study | 1.30 | 1.0 – 1.8 |
| `no_background` — other degree, none | 1.75 | 1.3 – 2.4 |
| `college_first_exposure` | 2.20 | 1.6 – 3.1 |

Additive modifiers: `esl +0.10`, `no_quant_background +0.15`.

**Do not put "works full time" here.** That is capacity, not rate. Putting it in the multiplier double-counts it against `TimeBudget`.

### 4.2 The estimate

```
required_raw = Σ  effort_lm × rate_multiplier(topic_of(lm))
             lm ∉ verified

required_full = clamp(required_raw_all_modules, 350, 1000)
required_remaining = required_raw          // uncapped below — see 4.4
```

`effort_lm` seed, authorable in an afternoon and only ever used as a ratio:

```
effort_lm = base_unit × los_count_lm × difficulty_weight_topic
```

normalised so the 102-module total = `REFERENCE_TOTAL_HOURS` (270). LOS counts are published facts. `difficulty_weight_topic` is a hand table in ~[0.7, 1.4].

### 4.3 Learning the multiplier

```
rate = ( w × prior + Σ clamp(observed_ratio_i, 0.4, 3.0) ) / ( w + n )

observed_ratio_lm = planned_hours_consumed_before_verification(lm) / effort_lm
```

**Never use self-reported time as an input.** It is dirty in both directions. Planned hours are known exactly and re-verification passes are observable; nothing here requires trusting a stopwatch.

Topic multipliers use the same function with `w=3`, shrinking toward the user's own global rate rather than the population prior. Do not surface a topic multiplier below `n=3` in that topic.

Compute over **every attempted module**, not just re-verified ones — otherwise the sample is the failures and the multiplier inflates.

### 4.4 Bounds behaviour

The bounds apply to the **full-syllabus** figure only. `required_remaining` is uncapped below: a user in week 15 with four modules left sees 40 hours, not 350.

| Bound hit | Behaviour |
|---|---|
| **Floor** (raw < 350) | Quote 350. The surplus goes to **review and verification density** — more spaced re-tests, more applied items on high-weight topics. Never inflate block durations; padded blocks teach the user to distrust every estimate we give. |
| **Ceiling** (raw > 1000) | 1000 hours is 48 h/week over 21 weeks. This is a **wrong-window verdict**, not a display cap. Force the triage conversation; remove scope explicitly and by name. Never clamp and silently show 1000. |

Floor binds for `finance_pro` and `commerce_degree` by design. Under-quoting is the asymmetric risk: over-quote and the user finishes early and trusts us; under-quote and the user fails and blames us.

---

## 5. Plan generation

The core algorithm. Six layers, run in order.

**Governing principle: study is blocked, assessment is interleaved.** Users study one topic for weeks at a time — three weeks of Quant, five of FRA — and classes and providers work the same way. The scheduler must produce that shape. Topic breadth for the estimator comes from diagnostics, never from fragmenting the study plan.

### 5.1 Layer 1 — topic ordering

Not hardcoded. Derived, because it changes with prior knowledge, institute order, and available time.

Aggregate `lm_edges` to topic level: topic A precedes topic B if a meaningful share of B's modules have prerequisite edges into A. Then order to minimise violated edges, tie-breaking by:
- **decay risk** — memory-heavy, low-transfer topics (Ethics) go late
- **exam weight** — heavier topics get earlier, longer runs so they get more spaced review
- **fan-out** — high-centrality topics go early regardless of weight

For an unconstrained from-scratch CFA L1 user this converges to roughly Quant → FRA → Corporate Finance → Equity → Fixed Income → Derivatives → Alternatives → Portfolio Construction, with Economics flexible and Ethics late. **Derive it; do not hardcode it** — the institute path and the revision path both produce different orders.

### 5.2 Layer 2 — block sizing

This is where "weeks 4–8 are FRA" comes from. It is computed, not assumed.

```
topic_hours = Σ effort_lm × rate_multiplier(topic)   over unmastered lm in topic
topic_weeks = topic_hours / (realised_weekly_capacity × (1 − review_budget))
```

FRA at 60 effort-hours × 1.3 rate ÷ (12 h/wk × 0.85) ≈ 7.6 weeks.

### 5.3 Layer 3 — within-topic ordering

Topological order over `lm_edges` restricted to the topic. Roots first. Ties broken by exam weight.

### 5.4 Layer 4 — bridge blocks for cross-topic prerequisites

**This is the mechanic that lets topic-blocked study coexist with a dependency graph, and it is the highest-value piece of the scheduler.**

When module `E` in the Equity block has a prerequisite `Q` scheduled later (or never), do not reorder the topics and do not let the user drown. **Inject `Q` as a short bridge block immediately before `E`.**

```
for each lm in sequence:
    for each prerequisite p of lm where state(p) != verified
                                   and position(p) > position(lm):
        insert bridge_block(p) at position(lm) - 1
        bridge_block.rationale = edge.rationale
        bridge_block.duration = effort_p × rate × BRIDGE_COMPRESSION (0.6)
```

Bridge blocks are compressed — the user needs the prerequisite *for this application*, not full mastery, which comes when the topic's own block arrives.

Same mechanic resolves the B2B2C conflict: when the institute teaches Derivatives in week 3 and the graph says the user is not ready, we insert bridges rather than overriding the institute or abandoning the user. Under D2 this is a **launch blocker**, not a nicety.

### 5.5 Layer 5 — interleaved review injection

Decay is the price of topic blocking, and it must be paid explicitly or the whole structure fails in month 4.

When a topic block closes, schedule retrieval blocks at `SPACED_REVIEW_OFFSETS` = +7, +21, +56 days. Short (20–30 min), **retrieval not re-reading**, drawn from the user's own missed items where available.

Review budget: 0% weeks 1–3, 15% from week 4, 35% in consolidation. Review blocks are also where the weekly diagnostic sources its interleaved cross-topic items — which is where the per-topic rate multipliers get their data (§4.3) without fragmenting the study plan.

### 5.6 Layer 6 — consolidation phase

The last `CONSOLIDATION_FRACTION` (18%, min 2 weeks) of the window carries no new content: full mocks, weak-area repair driven by the miss profile, exam-condition simulation.

If the topic blocks do not fit before consolidation starts, **triage** rather than eating the consolidation phase.

### 5.7 Triage rule

When time is short, cut by `exam_weight × graph_centrality` **ascending**.

Non-obvious consequence worth stating: **Quant has low exam weight (6–9%) but must never be cut**, because its centrality is the highest in the graph — cutting it breaks Equity, Fixed Income, Derivatives and Corporate Finance simultaneously. Alternatives (5–8%, terminal node, near-zero fan-out) is the correct first cut. Ethics (15–20%) is never cut.

Weight tells you what to *study*. Centrality tells you what is *safe to drop*. They are different questions and the naive answer gets it exactly backwards.

### 5.8 Stage-conditional behaviour

| Stage | Plan shape |
|---|---|
| `not_started` | Full topic blocks, graph order, as above |
| `started_stopped` | Plan as not-started, but the placement diagnostic runs wider. Recency drives the decay haircut on claimed coverage. **Highest-risk user: near-beginner requirement, veteran confidence.** |
| `studying` | Enter at their current position in the graph; compress upstream blocks to verification-only |
| `revision` | Invert the shape — diagnostics first, blocks generated from the miss profile, review budget starts at 35% in week 1 |

Claimed prior coverage is **discounted until the placement diagnostic confirms it.** Self-report reduces `topic_hours` by at most 55% of what is claimed, and the discount is released to full as modules reach `verified`.

---

## 6. Week 1

### 6.1 Composition

- **Day 1: placement diagnostic.** 12 questions, chosen by **graph position, not topic representativeness** — highest-fan-out prerequisite nodes (TVM, variance/SD, accounting equation, discounting, expected value). Failing TVM predicts failure across four topics at once; that is the entire reason the graph exists, and it is how 12 questions seed priors across 102 modules. Do not sample proportional to exam weight.
- **Committed blocks at `WEEK1_PLAN_FRACTION` = 0.75** of computed capacity.
- **Pull-forward queue** — see 6.2.
- Every block carries a one-line rationale. *"TVM first because eleven later modules depend on it."* Not decoration: it is the product being legible, and under D1 the difference has to be visible inside the trial week.
- **End-of-week diagnostic covers what was planned, not what was completed** — otherwise 30% completion yields a flattering score and no signal. 20–25 min. Under D5 this is the accountability mechanism and the paywall moment.

### 6.2 The pull-forward queue (fixes a censored measurement)

Planning 75% and observing 75% completion teaches us only that capacity is *at least* that. Over-performance is unobservable, so capacity can only ever be revised downward — biased low forever for anyone who understated their time.

Fix: committed blocks, plus a visible queue of the next blocks in graph order, unscheduled. Finish early, pull one in. Capacity becomes uncensored, and finishing early becomes progress rather than dead time.

### 6.3 What week 1 can and cannot claim

| | State after week 1 |
|---|---|
| **Capacity** (denominator) | Near-complete. Planned hours exact, delivery observed |
| **Rate** (numerator) | n≈2–4. Still 55–70% prior at w=5. Converges ~week 6 |

**The week-1 read-out leads with capacity.** "You planned 12 hours, delivered 8, and lost Thursday and Friday evenings" is defensible. "You learn 1.6× slower than typical" is not, and we would have to walk it back.

Capacity is a **rolling** estimate, never locked to week 1. Week 1 is the honeymoon — peak novelty, no life intrusion — and most users over-perform in it. Calibrating weeks 5–15 against a honeymoon number over-plans, and over-planning ends in abandonment. Expect weeks 2–4 to correct downward.

### 6.4 Zero completion is a branch, not a data point

Do not re-forecast off noise. Route to a probe:

> You didn't get to any of week 1. That's common, and it's usually the plan, not you. What got in the way?
> `[ Wrong times of day ] [ Blocks too long ] [ Material wasn't ready ] [ Life ] [ Lost interest ]`

Each answer maps to a specific week-2 change. D3-safe: names a pattern, adjusts a schedule, teaches nothing.

### 6.5 Framing

Internally week 1 is a measurement. **In the UI it is week 1 of studying**, which happens to end in a read-out. Never call it a calibration week — it gives permission to underperform (corrupting the measurement) and makes the day-7 paywall read as *"pay us so we can finish measuring you."*

---

## 7. Institute path (D2)

Target: **under 90 seconds.** The institute already did the selling; a long form here reads as friction on something the student was told to use.

**Inherited:** institute identity, cohort, exam window, class timetable, default material provider.
**Asked:** hours outside class per day; non-negotiables; stage + recency.

### 7.1 Inherit, then confirm — never silently

> Your institute's schedule: Mon/Wed/Fri 18:00–21:00, Sat 10:00–14:00.
> `[ That's right ]  [ I don't attend all of these ]`

The institute timetable is a *template*; actual attendance is not. Silent inheritance builds a calendar around classes the student skips.

### 7.2 Topic order is given, not derived

Layer 1 (§5.1) is replaced by the institute's teaching sequence. The scheduler's job becomes fitting self-study around class order and **inserting bridge blocks wherever the class order violates the graph** (§5.4). This is the primary reason bridge blocks are a launch blocker rather than a Phase-3 refinement.

### 7.3 Unscoped dependency, flagged

Many institutes will not have machine-readable timetables — expect PDFs and photographs of whiteboards. Fallback is student-photographs-timetable → structure extraction (permitted under PRD §2a.2: a schedule grid is fact, not protected expression). **This is an OCR dependency currently sitting unscoped in Phase 1.**

### 7.4 Data model consequences

- **Out of Phase 1 build scope (D9): the institute list itself.** No public dropdown, no curated list, no free-text fallback, no review queue. January entry is **invite code only** — the code resolves to an `institutes` row created by hand for that pilot. What is deferred is the acquisition surface, not the data model: `institute_id`, `institutes` and `class_templates` still ship in the first migration, because retrofitting a tenant column onto live user data is the migration nobody wants. Cost: every institute is a manual onboarding, which is fine at one or two pilots and breaks at five.
- When the list does arrive it must be a **real list, not free text** — free text makes cohort rollups impossible, and rollups are the entire B2B2C value proposition.
- Class schedules are institute-owned templates a student inherits and may override, not per-student rows.
- Under-18 students are in scope on this path in a way they are not in B2C. DPDP Act consent handling is a Phase-1 item here.

---

## 8. Failure modes

| Case | Behaviour |
|---|---|
| Exam date past / window closed | Reject at input, suggest next window |
| Zero available hours | Do not emit a plan. Say so, offer the next window |
| Exam < 4 weeks from standing start | **Gated impossible (§3.1a).** No plan for this window. `revision` stage exempt |
| Available < `HARD_GATE_HOURS` | **Gated impossible (§3.1a).** No plan; next window, answers carried |
| Declared ≫ computed hours | §3.4 reconciliation, never silent — **and it runs before the gate** |
| Invalid/expired institute code | Fall through to B2C without losing entered answers |
| Abandon mid-flow | Persist to pre-account session, resume by magic link |
| Unmapped material provider | Fall back LOS → reading. Stated plainly. **Never fabricate a pointer** |
| Institute timetable unavailable | Photo upload → structure extraction (§7.3) |
| Estimate hits ceiling | Wrong-window verdict, not a clamp (§4.4) |
| Week-1 completion ≈ 0 | Probe, not re-forecast (§6.4) |

---

## 9. Build order

**Correctness on what exists (blocking everything):**
1. `WEEKDAY` ISO 8601 constant; purge index-0-is-Monday
2. Delete all onboarding pre-fills; fix retired 2026 topic names (Corporate Issuers → Corporate Finance, Equity Investments → Equities, Portfolio Management → Portfolio Construction)
3. Wrap the six sequential onboarding writes in a transaction; `user_materials` upsert not insert

**Schema:**
4. `learning_modules`, `lm_edges`, `user_module_state`, `user_rate_estimate`, `institutes`, `class_templates`
5. Author `effort_lm` for 102 modules (§4.2 seed formula)
6. Author `lm_edges` — the irreducible human-judgment work, and the critical path

**Effort model:**
7. Required-hours computation with bounds (§4)
8. Rate estimator with shrinkage (§4.3)

**Onboarding:**
9. Tier 0 single screen + verdict card + share affordance
10. Declared-vs-computed reconciliation
11. Class times replacing class days; non-negotiables
12. Material source with honest precision states
13. State-driven post-auth routing; partial-state persistence

**Scheduler:**
14. Layers 1–3 (topic order, block sizing, within-topic order)
15. Layer 4 bridge blocks
16. Layers 5–6 (review injection, consolidation) + triage rule
17. Pull-forward queue

**Then:**
18. Institute path — **invite-code entry only** (needs 4, 14–16). No list, no dropdown (D9)
19. Day-1 placement diagnostic (needs 6 + item bank)

**Explicitly out of Phase 1:** institute list/dropdown and its review queue (D9); share affordance, OG image and public verdict URL (D8). Both are Phase 3.

Items 1–3 are a day. Item 6 is the schedule risk, not the code. **D7 moves item 6's sibling — the Schweser mapping — from a page-level job to an LOS-level one**, which is the difference between owning the books and reading a contents page.

---

## 10. Acceptance criteria

The build is done when, for a synthetic user with no finance background, 21 weeks, 12 declared hours/week and Tue/Thu classes 18:00–21:00:

1. The verdict quotes a range, not a point, and the range respects [350, 1000].
2. The generated plan is **topic-blocked** — contiguous multi-week runs per topic, not interleaved topics.
3. Block sizes per topic are *derived* from `Σ effort_lm × rate ÷ capacity`, and changing the background bucket visibly changes the block lengths.
4. At least one bridge block appears where a cross-topic prerequisite would otherwise be violated, carrying its edge rationale as user-visible text.
5. No block overlaps a class or a non-negotiable.
6. Week 1 totals ≤ 75% of computed capacity, and a pull-forward queue is present and non-empty.
7. Spaced review blocks appear at +7/+21/+56 days after each topic block closes.
8. A consolidation phase of ≥2 weeks exists before the exam date.
9. Every block carries a non-empty rationale string.
10. Setting available hours to 4/week produces an **infeasible** verdict with three named resolutions — and the triage option cuts Alternatives before it cuts Quant.
11. Setting available hours to 2/week (≈42h total, below `HARD_GATE_HOURS`) produces **no plan at all** — the impossible branch, next window offered, Tier 0 answers preserved through the redirect.
12. A user who declares 15h/week but whose per-day entries sum to 3h/week is **reconciled before the gate fires**, not gated on the declared figure and not gated on the computed one until they have seen the mismatch and chosen.

Criterion 10 is the one most likely to be silently wrong, and it is the one that proves the graph is doing real work. Criterion 12 is the one most likely to lose a real user if it regresses.

---

## 11. Decisions and open questions

### Settled here

| | Decision | Consequence |
|---|---|---|
| **D6** | Tier 0 **hard-gates** — but on *impossible*, not *infeasible* (§3.1a) | Two thresholds, not one. Gate runs on computed hours, after reconciliation |
| **D7** | Schweser pointers are **LOS-level** (reading + LOS), never page | Mapping is a contents-page job, not a page-by-page one; survives edition changes; cleaner under PRD §2a.2 since LOS numbering is CFAI's public outline, not Schweser's expression |
| **D8** | Shareable feasibility card is **Phase 3** | Card stays screenshot-clean; no share affordance ships. B2C has no organic acquisition at launch |
| **D9** | Institute list is **out of Phase 1 scope** | Invite-code entry only; tables still ship in the first migration |

D7's one cost: an LOS pointer is less immediately actionable than a page number — the user has to look it up. Mitigation is to always emit reading *and* LOS together, which is still fact rather than protected expression, and which lands the user within a few pages anyway.

### Still open

1. **Does the background question hurt Tier 0 conversion?** Fourth field on a three-field screen, and mildly status-loaded. Testable only with traffic.
2. **Is "350–780" too wide to be useful at n=0?** Honest but possibly useless-feeling. The alternative is a point estimate with a caveat, which converts better and is dishonest. Leaning honest, since the positioning rests on being the product that tells the truth about time.
3. **Overrun threshold before a mid-flight feasibility warning fires** (`EFFORT-MODEL.md` §7). Too tight and it fires in week 2; too loose and the early-warning value institutes buy evaporates.
4. **Is `UNCUTTABLE_CORE_FRACTION = 0.65` right?** It is currently an exam-weight estimate. It should be recomputed from `lm_edges` centrality once the graph exists (§5.7), and `HARD_GATE_HOURS` moved with it. Until then the gate threshold is the softest number in the constants block.
