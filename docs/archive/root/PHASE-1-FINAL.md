# Phase 1 — Final: landing, auth, onboarding, and the wiring into the rest of the app

Supersedes `PHASE-1-onboarding-landing-login.md` and `ONBOARDING-SPEC.md`. Where any earlier document disagrees with this one, this one wins. `ONBOARDING-brainstorm.md` and `EFFORT-MODEL.md` remain as reasoning archives, not as specs.

**Scope.** Everything from a cold first page view to a signed-in user looking at a generated Week 1 — both channels, B2C and institute. Plus, new in this document, the complete route map, guard logic, and downstream contracts that connect onboarding to the dashboard, week calendar, syllabus, tests, materials and coach.

**Not in scope.** Week 2+ adaptive replanning, the tests tab's own design, the coach's own design, billing. Those are specified separately; this document only fixes what they are entitled to read.

---

## 1. What is wrong with what exists today

Ordered by damage, not by effort.

### 1.1 Onboarding produces a number, not a plan

`src/lib/planning/initialLoad.ts` is the entire week-1 planner:

```
demand   = stageMinutes + classPressure + examPressure + calibration
capacity = availableDays × maxSessionMinutes × 2
weekly   = clamp(120, demand, capacity)
```

It never asks how much work there is. CFA L1 is a 300–350 hour qualification and this function has no term for total hours required and no term for weeks remaining. A user on Feb 2027 with three available days and 30-minute sittings gets 120 minutes/week — two hours a week for a 300-hour exam. The number is not low, it is arithmetically disconnected from the exam. It is also unbounded upward in a way that lies: `7 × 90 × 2 = 1260 min/week` is 21 hours, roughly double what a working candidate sustains. And it returns minutes, not a schedule — nothing selects modules, orders them, or places blocks on days.

The correct output of onboarding is a **feasibility verdict plus a seeded Week 1**.

### 1.2 The topic list is from the wrong curriculum year

`OnboardingFlow.tsx` hardcodes `Corporate Issuers`, `Equity Investments`, `Portfolio Management`. The 2027 curriculum renamed these to **Corporate Finance**, **Equities**, **Portfolio Construction**. We are selling a 2027 product and the first screen shows 2026 nomenclature. A real candidate notices inside five seconds, and it costs credibility that cannot be bought back.

### 1.3 Every answer is pre-filled

```ts
{ examWindow: 'may-2027', prepMode: 'coaching', availableDays: [0,1,3,4,5],
  classDays: [2,6], maxSessionMinutes: 60, startingStage: 'in-progress',
  materialSource: 'schweser-2027', coveredTopics: ['Quantitative Methods'] }
```

A user can click Next four times and reach a dashboard built entirely from invented facts. `startingStage` and `coveredTopics` are not neutral defaults; they are claims about the user's knowledge that feed the mastery model. Defaults are fine for preferences and poison for evidence.

### 1.4 The weekday convention is undefined

The UI uses `days = ['Mon',…,'Sun']`, so index 0 is Monday. Those raw indices are written to `availability_rules.weekday` and `class_schedules.weekday`. Postgres `extract(dow)` and JS `getDay()` both use 0 = Sunday. No constant, no conversion, no comment. The first query joining plan blocks to real dates shifts everything by a day, and it will present as a scheduling bug rather than a units bug.

### 1.5 The onboarding write is not transactional

`api/onboarding/route.ts` performs six sequential writes and returns on first error. A failure at `class_schedules` leaves a profile, an onboarding session, an exam attempt and availability rules but no classes — and no way to distinguish "no classes" from "classes failed to save." `user_materials` uses `.insert()` not upsert, so re-running onboarding duplicates the row.

### 1.6 There is no graph in the database

`supabase/schema.sql` has nine tables: `profiles`, `onboarding_sessions`, `exam_attempts`, `availability_rules`, `class_schedules`, `user_materials`, `user_metrics`, `plan_blocks`, `test_records`. None of them are `learning_modules`, `lm_edges`, `user_module_state` or `questions`. The architecture — 102 LM nodes, prerequisite edges with strength, the coverage state machine, the evidence hierarchy — has zero representation. `user_metrics` is flat: `(subject_id, readiness, coverage)`.

This is blocking in Phase 1 because **onboarding's job is to write the initial state of the graph** and there is nowhere to write it.

### 1.7 `SubjectId` has five values; onboarding collects ten topics

`src/types.ts`: `SubjectId = 'fixed-income' | 'quant' | 'fsa' | 'equity' | 'ethics'`. Onboarding collects ten topics as free strings. The two systems do not connect, so the coverage a user reports cannot address anything the diagnostic engine understands.

### 1.8 Generated diagnostic questions are never persisted

`api/diagnostics/generate/route.ts` mints IDs like `${subjectId}-live-${Date.now()}-${i}` and discards them. There is no `questions` table. This breaks item-exposure tracking (the 60-day no-repeat rule), makes retest integrity impossible, and violates the provenance-log requirement. Phase 1 touches it because the placement diagnostic is the first place we generate items.

### 1.9 There is no landing page

`src/app/page.tsx` is four lines: authenticated → `/app`, otherwise → `/login`. The entire landing surface described in §5 below has no URL. Under **D1** the free pre-signup feasibility check is the only free thing we own and therefore the whole top of funnel — and it currently has nowhere to live.

### 1.10 The authenticated product is one client-side SPA with no URLs

`/app` renders `src/App.tsx`, which switches between seven views with `useState`: home, week, syllabus, tests, materials, coach, settings. There are no routes for any of them. Consequences, all of which bite Phase 1 directly:

- Nothing can deep-link. The verdict card cannot link to the week calendar. An email cannot link to a diagnostic. A block rationale cannot link to its learning module.
- Every page is client-rendered, so nothing can be fetched or guarded server-side.
- The back button does not work inside the product.
- `src/views/` is a second, competing page system coexisting with the App Router. Two page systems in one repo is a permanent tax on every subsequent feature.

### 1.11 The post-auth guard is scattered and checks the wrong thing

There is no `middleware.ts`. `/app/page.tsx` does its own inline check of `profiles.onboarding_status === 'complete'` and redirects to `/onboarding`. That is a single boolean standing in for a four-state machine (§6.1) and it cannot detect "profile complete but no plan exists," which is the exact state a user lands in after any generation failure.

---

## 2. What Phase 1 is for

Onboarding is not a settings form. It has four jobs and only one is data collection.

| Job | Why it exists | Failure mode if skipped |
|---|---|---|
| **Establish feasibility honestly** | Tell the user, before anything else, whether their time budget and exam date are compatible | They discover in week 6 that the plan was never going to work, and blame us |
| **Seed the graph with priors** | Give the mastery model a starting position so week 1 is not random | Week 1 is generic and indistinguishable from a PDF study planner |
| **Earn the right to be prescriptive** | The user must understand *why* we are going to tell them what to study | They override the plan on day 3 and we become a calendar app |
| **Collect constraints** | Availability, class times, sitting length, exam window | Blocks land at times the user cannot study |

Everything below serves one of these four. If an answer does not change the plan, it is not asked.

---

## 3. Constants

Single-sourced in `src/lib/constants.ts`. These appear in the verdict, the scheduler and the triage trigger and must not drift.

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
BRIDGE_COMPRESSION      = 0.6
REVIEW_BUDGET_EARLY     = 0.00  // weeks 1–3
REVIEW_BUDGET_MID       = 0.15  // week 4 → consolidation
REVIEW_BUDGET_FINAL     = 0.35  // consolidation phase
CONSOLIDATION_FRACTION  = 0.18  // of total window, min 2 weeks
SPACED_REVIEW_OFFSETS   = [7, 21, 56]  // days after a topic block closes

// Hard gate (D6) — impossible, not merely infeasible
UNCUTTABLE_CORE_FRACTION = 0.65 // Ethics+Quant+FRA+Equity+FI as a share of scope
HARD_GATE_HOURS          = 228  // REQUIRED_HOURS_FLOOR × UNCUTTABLE_CORE_FRACTION
HARD_GATE_MIN_WEEKS      = 4    // from a standing start

// Conventions
WEEKDAY = ISO_8601        // 1 = Monday … 7 = Sunday. NOT JS/Postgres 0-indexed.
```

`WEEKDAY` is the single most likely silent bug in the build. Name the constant, use it everywhere, never write a bare day index. Convert at the UI boundary and at the DB boundary, nowhere in between.

---

## 4. Data model

### 4.1 Onboarding output contract

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
  state: 'comfortable' | 'tight' | 'infeasible' | 'impossible'
  rate_multiplier: number
  n_observations: number              // 0 at onboarding
  chosen_resolution: 'proceed' | 'move_window' | 'find_hours' | 'triage' | null
}
```

**Note what is absent.** There is no `ModulePrior.self_report`, no topic confidence slider, no learning style, no goals free-text. Module priors come from the day-1 placement diagnostic and from observed completion, never from a survey. Confidence is collected per-question inside diagnostics so the calibration gap stays uncontaminated.

### 4.2 New tables

```sql
learning_modules   (id, topic_id, name, los_count, effort_units, difficulty_weight)
lm_edges           (from_lm, to_lm, kind, strength, rationale)
                   -- kind: prerequisite | reinforces | applied_in
user_module_state  (user_id, lm_id, coverage_state, last_verified_at,
                    planned_hours_consumed, verification_passes)
                   -- coverage_state: not_started|taught|studied|verified|decaying
user_rate_estimate (user_id, topic_id NULL, multiplier, n_obs, updated_at)
                   -- topic_id NULL = global
questions          (id, lm_id, difficulty, evidence_kind, stem, options,
                    per_option_feedback, provenance, created_at)
institutes         (id, name, ...)
class_templates    (institute_id, cohort_id, weekday, start_time, duration, topic_id)
non_negotiables    (user_id, weekday, start_time, duration_minutes, label)
onboarding_drafts  (nonce, answers jsonb, created_at, claimed_by uuid NULL)
```

`institute_id` and `institutes` ship in the first migration even with one tenant live — retrofitting a tenant column onto live user data is the migration nobody wants (D9).

### 4.3 Changes to existing tables

```sql
alter table plan_blocks
  add column lm_id text references learning_modules(id),
  add column block_type text,      -- study | bridge | review | diagnostic | class | consolidation
  add column rationale text not null default '';
-- state enum gains 'partial': ('done','partial','planned','class','risk','empty')

alter table profiles
  add column finance_background text,
  add column esl boolean default false,
  add column no_quant_background boolean default false,
  add column stage text,
  add column stage_recency_months int,
  add column institute_id uuid references institutes(id);
```

`user_metrics` is superseded by `user_module_state` aggregated at read time. Do not add columns to it; plan its deletion.

---

## 5. Landing page

One job: make a candidate who is already studying feel *seen*, and one who has not started feel *rescued*. Two different people, one page, no split.

### 5.1 The positioning sentence

We are not selling CFA material. We are selling **the answer to "am I on track, and what do I do next?"** — a question every candidate asks weekly and no current tool answers.

Working direction, not final copy:

> **You have the material. You don't have a plan that survives contact with your life.**
> Roadmap turns your CFA Level 1 syllabus into a week-by-week schedule that adapts to what you actually finished, and proves what you actually know.

The second sentence carries the two differentiators: **adapts to actual completion**, and **proves knowledge**. Neither Schweser nor a Notion template nor a coaching institute does either.

### 5.2 The three-part proof, in this order

1. **The calendar that reacts.** A week where two blocks were missed and the next week has visibly re-sequenced. The single most legible screenshot we own.
2. **The strength/weakness map.** A topic tree where Equity is red *because* WACC is red — prerequisite drag made visual. Nobody else has this; show it, do not describe it.
3. **The verification loop.** Class or self-study → diagnostic → repair → re-verify. `AuthForm.tsx` already carries this copy on its right panel; it belongs on the landing page first and the auth page second.

### 5.3 What the landing page must not do

Do not claim to teach CFA content — the moment we look like a content provider we are compared on content volume and lose to Schweser on day one. Do not lead with AI; every ed-tech landing page in India leads with AI and it now reads as a substitute for a product, so lead with the outcome and let the AI be the invisible mechanism. Do not put a pricing table above the fold before there is a price we can defend.

### 5.4 The pre-signup hook is Tier 0

The free, no-account feasibility check is not a separate landing widget. It is **Tier 0 of onboarding, rendered on the landing page** (§7.1). One implementation, one verdict computation, two entry points. Building it twice guarantees the numbers diverge, and a landing page that quotes different hours from the product is worse than no landing page.

Under D1 this is the only free surface we have and therefore the entire top of funnel.

---

## 6. Auth

Magic link primary, Google OAuth alongside it, password tertiary. A large fraction of the target user signs up on a phone, where password creation has meaningfully worse completion than OTP. This is a conversion decision, not a security one — and there is no reason to hold password hashes we do not need.

If the password path stays, either enforce something real (12 characters, or zxcvbn ≥ 3) or drop the client check and let Supabase policy govern. A rule that is easy to satisfy and easy to forget is the worst of both.

### 6.1 The post-auth state machine

Routing is **state-driven, not path-driven**, and lives in exactly one place (§12.5). Four states:

```
on authenticated session:
  no profiles row                            → /onboarding
  onboarding_sessions.completed_at is null   → /onboarding?resume=1
  no plan_blocks for the current week        → /onboarding/plan
  else                                       → /app
```

The third state is the one the current guard cannot see, and it is exactly where a user lands after any generation failure. Today they reach a dashboard with an empty calendar and no explanation.

### 6.2 Carry Tier 0 answers through signup

If the user completed the §7.1 check, those answers must survive the auth round-trip and pre-fill Tier 1. Asking the same question twice inside ninety seconds is the fastest way to make a product feel stupid, and it is the most avoidable churn event in the flow. Mechanism in §12.6.

### 6.3 Delete the demo bypass

`/onboarding?demo=1` with everything pre-filled is fine in dev and dangerous in prod. Gate at the route level on `NODE_ENV !== 'production'`, not in the link's visibility. `/app?demo=1` already does this correctly; copy that pattern.

---

## 7. Onboarding

### 7.1 Tier 0 — pre-account feasibility check

**One screen. Four fields. No transitions.** Every pre-account transition is a drop-off point.

| Field | Type | Validation |
|---|---|---|
| Exam window | select + "not registered yet" checkbox | window must be open for registration or already held by the user |
| Finance background | 5-option radio (§8.1) | required, no default |
| Hours per week, realistically | number | 1–70; >40 triggers a soft "are you sure" |
| Where you are now | 4-option radio; `started_stopped` reveals a recency field | required, **no default** |

Delete every pre-fill. A pre-filled answer is a wrong answer the user never notices they gave.

**Output: the verdict card.** Screenshot-clean, which costs nothing and a screenshot is a share. **No share affordance, no OG image, no public verdict URL — those are Phase 3** (D8). The consequence to hold in view: B2C has no organic acquisition mechanism at launch. Acceptable for a prototype under D4; a blocker the moment we want users we did not personally recruit.

```
21 weeks · 189 hours available · 350–520 needed
You are roughly 160 hours short.

[ Move to the May window ]  [ Find the hours — show me where ]  [ Triage: study less, deliberately ]
```

The verdict **must be allowed to say no.** An infeasible verdict pre-payment is the strongest conversion event we have — it is the thing no free planner does and no prep provider is incentivised to do.

### 7.2 The hard gate (D6)

We gate. A candidate the arithmetic cannot serve does not get a plan for that window, and we say so before they pay. A product whose claim is that it tells the truth about time must be willing to lose the sale.

**Gate the impossible, not the merely infeasible.** Collapsing the two destroys the triage machinery in §9.7:

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

- **Gate on `computed_weekly_hours`, never `declared`.** §7.4 exists because declared hours are systematically wrong. Gating a real user out on a number they mistyped is the worst available failure of this feature. Run the reconciliation *before* the gate.
- **`revision` stage bypasses the weeks floor.** A candidate four weeks out on their third pass is not a standing start, and `HARD_GATE_HOURS` still catches the genuine impossibilities.

### 7.3 Tier 1 — post-signup

Four screens. The user has committed, so the friction budget is different.

1. **Timezone.** Browser-detected, confirmed in one line. Do not skip the confirmation.
2. **Class schedule.** Weekday + start time + duration + optional topic. Days alone are useless: a class on Tuesday tells the scheduler nothing; Tuesday 18:00–21:00 tells it Tuesday evening is gone and Tuesday night is low-value. The optional topic field is what makes bridge blocks possible.
3. **Non-negotiables.** Commute, job, prayer, gym, family. Immovable. The first time we schedule over something sacred the user stops trusting the calendar and there is no recovery from that.
4. **Material source.** No default (D3). **Pointers are LOS-level (D7)** — reading number plus LOS, never a page number. If the provider is unmapped, state the degradation honestly: *"we'll point you to the reading, not the LOS."* **A fabricated pointer is worse than no pointer**, because under D3 the pointer is all we have.

Screen 4 also carries the mapping-confidence read-out, and under D3 it is mandatory rather than optional transparency: *"We matched 94 of 102 modules to your material. 8 unmatched — we'll use the standard sequence for those."* Unmatched modules are modules where we can diagnose but cannot direct, which is a dead end, and the user must know which ones before relying on us.

Onboarding must also set the D3 expectation explicitly, once, in plain words: *"We don't teach the content. Your material does that. We tell you what to study, prove whether it stuck, and show you exactly where to go when it didn't."* Saying this here prevents the week-3 complaint of "why won't it just explain this to me," which is otherwise guaranteed.

### 7.4 Declared-vs-computed reconciliation

Runs after screen 7.3.2. If `|declared_weekly_hours − computed_weekly_hours| > 2`:

> You told us 15 hours. Your days add up to 9. Which one is true?
> `[ My days are right — plan 9 ]  [ I have more time — let me redo the days ]`

Never resolve silently. This is the first moment the product demonstrates it is reading answers rather than filing them, and attention is the entire value proposition. It also catches the most destructive onboarding error there is: the aspirational hour commitment that collapses in week 2.

### 7.5 What onboarding does not ask

No module-level self-report grid. Earlier drafts specified progressive disclosure over 102 modules with a *not seen / studied / confident* control; that is superseded. Self-report is a prior we then have to discount by 45%, it adds four minutes to a funnel D1 made expensive, and the day-1 placement diagnostic produces strictly better priors from twelve questions (§10.1). Stage plus background is the whole prior; the diagnostic does the rest.

---

## 8. Required-hours computation

### 8.1 Background buckets → rate prior

| Bucket | Prior | Range |
|---|---|---|
| `finance_pro` — working in finance, CA, or CFA resit | 0.75 | 0.6 – 1.0 |
| `commerce_degree` | 1.00 | 0.8 – 1.3 |
| `some_exposure` — other degree, internship/self-study | 1.30 | 1.0 – 1.8 |
| `no_background` — other degree, none | 1.75 | 1.3 – 2.4 |
| `college_first_exposure` | 2.20 | 1.6 – 3.1 |

Additive modifiers: `esl +0.10`, `no_quant_background +0.15`.

**Do not put "works full time" here.** That is capacity, not rate. Putting it in the multiplier double-counts it against `TimeBudget`.

### 8.2 The estimate

```
required_raw = Σ  effort_lm × rate_multiplier(topic_of(lm))
             lm ∉ verified

required_full      = clamp(required_raw_all_modules, 350, 1000)
required_remaining = required_raw          // uncapped below — see 8.4
```

`effort_lm` seed, authorable in an afternoon and only ever used as a ratio:

```
effort_lm = base_unit × los_count_lm × difficulty_weight_topic
```

normalised so the 102-module total equals `REFERENCE_TOTAL_HOURS` (270). LOS counts are published facts. `difficulty_weight_topic` is a hand table in roughly [0.7, 1.4].

The base is 270 rather than 310 because CFAI's ~300-hour survey mean already contains slow candidates. Setting the 1.00× reference at 310 and then multiplying by 2.2 double-counts the same slowness twice.

### 8.3 Learning the multiplier

```
rate = ( w × prior + Σ clamp(observed_ratio_i, 0.4, 3.0) ) / ( w + n )

observed_ratio_lm = planned_hours_consumed_before_verification(lm) / effort_lm
```

**Never use self-reported time as an input.** It is dirty in both directions. Planned hours are known exactly and re-verification passes are observable; nothing here requires trusting a stopwatch.

Topic multipliers use the same function with `w = 3`, shrinking toward the user's own global rate rather than the population prior. Do not surface a topic multiplier below `n = 3` in that topic.

Compute over **every attempted module**, not just re-verified ones — otherwise the sample is the failures and the multiplier inflates.

### 8.4 Bounds behaviour

The bounds apply to the **full-syllabus** figure only. `required_remaining` is uncapped below: a user in week 15 with four modules left sees 40 hours, not 350.

| Bound hit | Behaviour |
|---|---|
| **Floor** (raw < 350) | Quote 350. The surplus goes to **review and verification density** — more spaced re-tests, more applied items on high-weight topics. Never inflate block durations; padded blocks teach the user to distrust every estimate we give |
| **Ceiling** (raw > 1000) | 1000 hours is 48 h/week over 21 weeks. This is a **wrong-window verdict**, not a display cap. Force the triage conversation and remove scope explicitly and by name. Never clamp and silently show 1000 |

Floor binds for `finance_pro` and `commerce_degree` by design. Under-quoting is the asymmetric risk: over-quote and the user finishes early and trusts us; under-quote and the user fails and blames us.

---

## 9. Plan generation

Six layers, run in order.

**Governing principle: study is blocked, assessment is interleaved.** Users study one topic for weeks at a time — three weeks of Quant, five of FRA — and classes and providers work the same way. The scheduler must produce that shape. Topic breadth for the estimator comes from diagnostics, never from fragmenting the study plan.

### 9.1 Layer 1 — topic ordering

Derived, not hardcoded, because it changes with prior knowledge, institute order and available time.

Aggregate `lm_edges` to topic level: topic A precedes topic B if a meaningful share of B's modules have prerequisite edges into A. Then order to minimise violated edges, tie-breaking by decay risk (memory-heavy, low-transfer topics such as Ethics go late), exam weight (heavier topics get earlier, longer runs so they get more spaced review), and fan-out (high-centrality topics go early regardless of weight).

For an unconstrained from-scratch user this converges to roughly Quant → FRA → Corporate Finance → Equities → Fixed Income → Derivatives → Alternatives → Portfolio Construction, with Economics flexible and Ethics late. **Derive it; do not hardcode it** — the institute path and the revision path both produce different orders.

### 9.2 Layer 2 — block sizing

This is where "weeks 4–8 are FRA" comes from. Computed, not assumed.

```
topic_hours = Σ effort_lm × rate_multiplier(topic)   over unmastered lm in topic
topic_weeks = topic_hours / (realised_weekly_capacity × (1 − review_budget))
```

FRA at 60 effort-hours × 1.3 rate ÷ (12 h/wk × 0.85) ≈ 7.6 weeks.

### 9.3 Layer 3 — within-topic ordering

Topological order over `lm_edges` restricted to the topic. Roots first. Ties broken by exam weight.

### 9.4 Layer 4 — bridge blocks

**The mechanic that lets topic-blocked study coexist with a dependency graph, and the highest-value piece of the scheduler.**

When module `E` in the Equities block has a prerequisite `Q` scheduled later or never, do not reorder the topics and do not let the user drown. **Inject `Q` as a short bridge block immediately before `E`.**

```
for each lm in sequence:
    for each prerequisite p of lm where state(p) != verified
                                   and position(p) > position(lm):
        insert bridge_block(p) at position(lm) - 1
        bridge_block.rationale = edge.rationale
        bridge_block.duration  = effort_p × rate × BRIDGE_COMPRESSION
```

Bridge blocks are compressed because the user needs the prerequisite *for this application*, not full mastery — that comes when the topic's own block arrives.

The same mechanic resolves the B2B2C conflict: when the institute teaches Derivatives in week 3 and the graph says the user is not ready, we insert bridges rather than overriding the institute or abandoning the student. Under D2 this is a **launch blocker**, not a nicety.

### 9.5 Layer 5 — interleaved review injection

Decay is the price of topic blocking and must be paid explicitly or the structure fails in month 4.

When a topic block closes, schedule retrieval blocks at `SPACED_REVIEW_OFFSETS` = +7, +21, +56 days. Short (20–30 min), **retrieval not re-reading**, drawn from the user's own missed items where available.

Review budget: 0% weeks 1–3, 15% from week 4, 35% in consolidation. Review blocks are also where the weekly diagnostic sources its interleaved cross-topic items, which is how per-topic rate multipliers get data without fragmenting the study plan.

### 9.6 Layer 6 — consolidation

The last `CONSOLIDATION_FRACTION` (18%, minimum 2 weeks) of the window carries no new content: full mocks, weak-area repair driven by the miss profile, exam-condition simulation. If the topic blocks do not fit before consolidation starts, **triage** rather than eating the consolidation phase.

### 9.7 Triage rule

When time is short, cut by `exam_weight × graph_centrality` **ascending**.

The non-obvious consequence: **Quant has low exam weight (6–9%) but must never be cut**, because its centrality is the highest in the graph — cutting it breaks Equities, Fixed Income, Derivatives and Corporate Finance simultaneously. Alternatives (5–8%, terminal node, near-zero fan-out) is the correct first cut. Ethics (15–20%) is never cut.

Weight tells you what to *study*. Centrality tells you what is *safe to drop*. Different questions, and the naive answer gets it exactly backwards.

### 9.8 Stage-conditional behaviour

| Stage | Plan shape |
|---|---|
| `not_started` | Full topic blocks, graph order, as above |
| `started_stopped` | Plan as not-started, but the placement diagnostic runs wider. Recency drives the decay haircut on claimed coverage. **Highest-risk user: near-beginner requirement, veteran confidence** |
| `studying` | Enter at their current position in the graph; compress upstream blocks to verification-only |
| `revision` | Invert the shape — diagnostics first, blocks generated from the miss profile, review budget starts at 35% in week 1 |

Claimed prior coverage is **discounted until the placement diagnostic confirms it**: self-report reduces `topic_hours` by at most 55% of what is claimed, and the discount is released to full as modules reach `verified`.

---

## 10. Week 1

### 10.1 Composition

- **Day 1: placement diagnostic.** 12 questions chosen by **graph position, not topic representativeness** — highest-fan-out prerequisite nodes (TVM, variance/SD, accounting equation, discounting, expected value). Failing TVM predicts failure across four topics at once; that is the entire reason the graph exists, and it is how 12 questions seed priors across 102 modules. Do not sample proportional to exam weight. It sits in the trial week rather than in onboarding because under D1 fifteen minutes at signup is expensive, and day 1 of the plan should feel like the product rather than more setup.
- **Committed blocks at `WEEK1_PLAN_FRACTION` = 0.75** of computed capacity. A user who finishes week 1 is dramatically more likely to be there in week 8; a user who completes 60% of week 1 has learned that our plans are fiction. Under-planning week 1 is the cheapest retention intervention available and costs about two hours of syllabus.
- **Pull-forward queue** — §10.2.
- **Every block carries a one-line rationale.** *"TVM first because eleven later modules depend on it."* Not decoration: it is the product being legible, and under D1 the difference has to be visible inside the trial week.
- **End-of-week diagnostic covers what was planned, not what was completed.** Otherwise 30% completion yields a flattering score and no signal, and readiness becomes gameable by skipping hard modules. 20–25 minutes. Under D5 this is the accountability mechanism and the paywall moment.

### 10.2 The pull-forward queue

Planning 75% and observing 75% completion teaches us only that capacity is *at least* that. Over-performance is unobservable, so capacity can only ever be revised downward — biased low forever for anyone who understated their time.

Fix: committed blocks, plus a visible queue of the next blocks in graph order, unscheduled. Finish early, pull one in. Capacity becomes uncensored, and finishing early becomes progress rather than dead time.

### 10.3 What week 1 can and cannot claim

| | State after week 1 |
|---|---|
| **Capacity** (denominator) | Near-complete. Planned hours exact, delivery observed |
| **Rate** (numerator) | n ≈ 2–4. Still 55–70% prior at w=5. Converges around week 6 |

**The week-1 read-out leads with capacity.** "You planned 12 hours, delivered 8, and lost Thursday and Friday evenings" is defensible. "You learn 1.6× slower than typical" is not, and we would have to walk it back.

Capacity is a **rolling** estimate, never locked to week 1. Week 1 is the honeymoon — peak novelty, no life intrusion — and most users over-perform in it. Calibrating weeks 5–15 against a honeymoon number over-plans, and over-planning ends in abandonment. Expect weeks 2–4 to correct downward.

### 10.4 Zero completion is a branch, not a data point

Do not re-forecast off noise. Route to a probe:

> You didn't get to any of week 1. That's common, and it's usually the plan, not you. What got in the way?
> `[ Wrong times of day ] [ Blocks too long ] [ Material wasn't ready ] [ Life ] [ Lost interest ]`

Each answer maps to a specific week-2 change. D3-safe: names a pattern, adjusts a schedule, teaches nothing.

### 10.5 Framing

Internally week 1 is a measurement. **In the UI it is week 1 of studying**, which happens to end in a read-out. Never call it a calibration week — that gives permission to underperform, corrupting the measurement, and makes the day-7 paywall read as *"pay us so we can finish measuring you."*

---

## 11. Institute path (D2)

Target: **under 90 seconds.** The institute already did the selling; a long form here reads as friction on something the student was told to use.

**Inherited:** institute identity, cohort, exam window, class timetable, default material provider.
**Asked:** hours outside class per day; non-negotiables; stage and recency.

### 11.1 Inherit, then confirm — never silently

> Your institute's schedule: Mon/Wed/Fri 18:00–21:00, Sat 10:00–14:00.
> `[ That's right ]  [ I don't attend all of these ]`

The timetable is a *template*; actual attendance is not. Silent inheritance builds a calendar around classes the student skips.

### 11.2 Topic order is given, not derived

Layer 1 (§9.1) is replaced by the institute's teaching sequence. The scheduler's job becomes fitting self-study around class order and **inserting bridge blocks wherever the class order violates the graph** (§9.4). This is the primary reason bridge blocks are a launch blocker rather than a Phase-3 refinement.

### 11.3 Unscoped dependency, flagged

Many institutes will not have machine-readable timetables — expect PDFs and photographs of whiteboards. Fallback is student-photographs-timetable → structure extraction, permitted because a schedule grid is fact, not protected expression. **This is an OCR dependency currently sitting unscoped in Phase 1.**

### 11.4 Consent

A student must know, at signup, that their institute can see their completion and readiness. That copy lives in the onboarding flow itself, not on a settings page. Under-18 students are in scope on this path in a way they are not in B2C, so DPDP consent handling is a Phase-1 item here.

### 11.5 Data model consequences

**Out of Phase 1 build scope (D9): the institute list itself.** No public dropdown, no curated list, no free-text fallback, no review queue. January entry is **invite code only** — the code resolves to an `institutes` row created by hand for that pilot. What is deferred is the acquisition surface, not the data model. Cost: every institute is a manual onboarding, which is fine at one or two pilots and breaks at five.

When the list does arrive it must be a **real list, not free text** — free text makes cohort rollups impossible, and rollups are the entire B2B2C value proposition. Class schedules are institute-owned templates a student inherits and may override, not per-student rows.

---

## 12. Routes, links and connections

This section is the wiring: what URL exists, who guards it, what onboarding writes, and which downstream page reads it. It is the part most likely to be got wrong quietly, because nothing about it fails loudly until a user is halfway through a flow.

### 12.1 What exists today

| Route | File | Status |
|---|---|---|
| `/` | `app/page.tsx` | **Not a landing page.** Redirects to `/app` or `/login` |
| `/login` | `app/login/page.tsx` | Exists |
| `/signup` | `app/signup/page.tsx` | Exists |
| `/forgot-password`, `/update-password`, `/check-email` | — | Exist |
| `/auth/callback`, `/auth/confirm`, `/auth/error` | — | Exist |
| `/privacy`, `/terms` | — | Exist |
| `/onboarding` | `app/onboarding/page.tsx` | Exists; wrong content (§1.2, §1.3) |
| `/app` | `app/app/page.tsx` → `src/App.tsx` | Exists; renders a client SPA with seven `useState` views |
| `/api/onboarding`, `/api/profile`, `/api/coach`, `/api/diagnostics/generate`, `/api/materials/analyze` | — | Exist |
| `/dashboard`, `/plan/generate` | — | **Do not exist.** Referenced by the earlier spec in error |
| `/api/plan`, `/api/feasibility` | — | Do not exist |
| `middleware.ts` | — | Does not exist |

### 12.2 D10 — the authenticated surface is `/app/*`, and the spec is amended

The earlier spec routed to `/dashboard` and `/plan/generate`. Neither has ever existed. Two ways out, and the choice is not cosmetic.

Renaming `/app` to `/dashboard` buys nothing: `/app` is already a clean namespace, it is already the OAuth `next` target in `AuthForm.tsx`, and the rename touches every existing redirect for the sake of matching a document. **The spec was wrong, not the code.** `/app` is the authenticated root and `/dashboard` is deleted from the vocabulary.

`/plan/generate` is worse than misnamed — it is misconceived. Plan generation is not a page the user browses to; it is a server action with a progress state. It becomes `/onboarding/plan`, which is a real route because the user can land on it directly (state 3 in §6.1) and because generation takes long enough to need a screen.

### 12.3 D11 — the SPA is decomposed into route segments

The seven `useState` views become seven route segments under `/app`. `src/views/` and `src/App.tsx` are deleted as a page system; their components move under `src/app/app/*/page.tsx` and `src/components/*`.

This is not a refactor for tidiness. Four Phase-1 requirements are impossible without it: the verdict card cannot link into the week calendar; a block rationale cannot link to its learning module; the week-1 diagnostic cannot be linked from an email or a notification; and per-page server-side guards and data fetching cannot exist. Two competing page systems in one repo is also a tax on every feature after this one, and it gets more expensive the longer it stands.

### 12.4 Target route map

**Public**

| Route | New? | Purpose | Guard |
|---|---|---|---|
| `/` | **Rewrite** | Landing page (§5) with Tier 0 embedded. Authenticated users still redirect to `/app` | none |
| `/check` | **New** | Tier 0 as its own URL, for links and ads. Same component as the landing embed | none |
| `/check/result` | **New** | Verdict card. Server-rendered from a draft nonce so it survives a refresh | none |
| `/privacy`, `/terms` | exists | — | none |

**Auth**

| Route | New? | Purpose |
|---|---|---|
| `/login`, `/signup` | exists | Magic link primary, OAuth, password tertiary (§6) |
| `/auth/callback` | **Change** | Stops hardcoding `next=/app`; calls the §6.1 resolver and claims the Tier 0 draft (§12.6) |
| `/auth/confirm`, `/auth/error`, `/check-email`, `/forgot-password`, `/update-password` | exists | — |

**Onboarding**

| Route | New? | Purpose | Guard |
|---|---|---|---|
| `/onboarding` | **Rewrite** | Tier 1, four screens (§7.3). `?resume=1` restores step | authenticated |
| `/onboarding/institute` | **New** | Invite-code entry, inherit-and-confirm (§11) | authenticated |
| `/onboarding/plan` | **New** | Runs generation, shows progress, redirects to `/app` on success. Landing state 3 in §6.1 | authenticated + has profile |
| `/onboarding/blocked` | **New** | The impossible branch (§7.2). No plan. Next window offered, answers preserved | authenticated |

**Application**

| Route | New? | Replaces |
|---|---|---|
| `/app` | **Change** | `App.tsx` view `home` — dashboard |
| `/app/week` | **New** | view `week` — the week calendar |
| `/app/syllabus` | **New** | view `syllabus` |
| `/app/syllabus/[lmId]` | **New** | nothing. Needed so a block rationale can link to a module |
| `/app/tests` | **New** | view `tests` |
| `/app/tests/[attemptId]` | **New** | `DiagnosticPage`, currently reachable only through component state |
| `/app/materials` | **New** | view `materials` |
| `/app/coach` | **New** | view `coach` |
| `/app/settings` | **New** | view `settings` |

**API**

| Route | New? | Purpose |
|---|---|---|
| `/api/feasibility` | **New** | Stateless. Tier 0 answers → `FeasibilityVerdict`, including the gate. Called pre-account |
| `/api/onboarding` | **Change** | Six sequential writes → one transactional RPC; `user_materials` upsert |
| `/api/plan` | **New** | `POST` generates, `GET` returns the current week. The scheduler's only entry point |
| `/api/diagnostics/generate` | **Change** | Must persist to `questions` before returning (§1.8) |
| `/api/profile`, `/api/coach`, `/api/materials/analyze` | exists | — |

### 12.5 One guard, in middleware

`middleware.ts` at the repo root, and the inline check inside `app/app/page.tsx` is deleted. Scattered client redirects and per-page inline checks are how the third state in §6.1 got missed in the first place.

```ts
// middleware.ts — matcher: ['/app/:path*', '/onboarding/:path*']
const user = await getUser(req)
if (!user) return redirect(`/login?next=${encodeURIComponent(path)}`)

const state = await resolveUserState(user.id)   // one query, one place
// 'no_profile' | 'onboarding_incomplete' | 'no_plan' | 'ready'

if (path.startsWith('/app')) {
  if (state === 'no_profile')           return redirect('/onboarding')
  if (state === 'onboarding_incomplete') return redirect('/onboarding?resume=1')
  if (state === 'no_plan')               return redirect('/onboarding/plan')
}
if (path === '/onboarding' && state === 'ready') return redirect('/app')
```

Three rules that are easy to break later. `resolveUserState` is the only function that reads onboarding completion — nothing else queries `onboarding_status` directly. `safeNextPath` (already in `src/lib/auth/redirect.ts`) governs every `next` parameter, including the ones middleware writes. And `/onboarding/blocked` is exempt from the `no_plan` redirect, or a gated user ping-pongs between blocked and plan generation forever.

### 12.6 Carrying Tier 0 through auth

Not sessionStorage. The user may complete Tier 0 on a phone browser and confirm a magic link in a different webview, which loses sessionStorage entirely — and magic link is the primary auth path, so this is the common case rather than the edge case.

Server-side draft, claimed on first authenticated request:

1. Tier 0 submit → `POST /api/feasibility` → row in `onboarding_drafts (nonce, answers, created_at)`; nonce returned and held in a cookie **and** appended to the magic-link `next`.
2. `/auth/callback` reads the nonce from either source, sets `claimed_by = user.id`, and copies the answers into `profiles`.
3. `/onboarding` renders with Tier 0 fields already answered and visibly so — *"You told us 12 hours a week"* with an edit affordance, not silently pre-filled. §1.3 is about invented defaults, not about the user's own answers; showing them their answer is the opposite failure mode.
4. Unclaimed drafts expire after 30 days.

### 12.7 What onboarding writes, and who reads it

The blast radius. Every row onboarding creates has a downstream consumer, and a change to any of these is a change to another page.

| Written by onboarding | Table | Read by |
|---|---|---|
| Profile, exam window, background, stage | `profiles` | `/app` header, `/api/plan` (rate prior), `/app/settings`, coach context |
| Per-weekday minutes, max session | `availability_rules` | `/api/plan` layers 2 and 5, `/app/week` capacity bar, week-1 read-out denominator |
| Class times + topic | `class_schedules` | `/api/plan` layer 4 (bridge trigger), `/app/week` rendering, institute rollups |
| Non-negotiables | `non_negotiables` | `/api/plan` placement constraints, `/app/week` |
| Provider + mapping precision | `user_materials` | `/app/materials`, every diagnostic repair pointer, `/app/tests/[id]` feedback |
| Verdict + chosen resolution | `exam_attempts` | `/app` readiness banner, mid-flight feasibility warning, triage scope |
| Initial coverage states | `user_module_state` | `/app/syllabus` tree, `/api/plan` module selection, readiness computation |
| Rate prior at n=0 | `user_rate_estimate` | `/api/plan` layer 2, week-1 read-out, all future estimates |
| Week-1 blocks | `plan_blocks` | `/app/week`, `/app` today card, completion telemetry, week-2 replanning |

Two of these are the ones that will bite. `user_module_state` is where `SubjectId`'s five values collide with the ten topics onboarding collects (§1.7) — the syllabus tree and the diagnostic engine are on opposite sides of that mismatch, and it must be resolved before either is built. And `plan_blocks` needs `lm_id`, `block_type`, `rationale` and a `partial` state (§4.3) before the week calendar can render anything the scheduler produces; without `rationale` the calendar is a schedule rather than an argument, which is the whole differentiation.

### 12.8 Navigation edges that must exist

Forward path, cold to plan:

```
/  →  Tier 0  →  /check/result
                     ├─ impossible → /onboarding/blocked
                     └─ otherwise  → /signup?next=/onboarding&draft=<nonce>
                                        → /auth/callback → /onboarding
                                        → /onboarding/plan → /app
```

Institute path: invite link → `/onboarding/institute` → `/onboarding` (short form) → `/onboarding/plan` → `/app`.

Backward links, and these are the ones that get forgotten:

- Every block on `/app/week` → `/app/syllabus/[lmId]`, carrying the block's rationale as the link's context.
- Every bridge block → the prerequisite module *and* the module it unblocks. A bridge with only one end visible looks like a scheduling mistake.
- Week-1 diagnostic block → `/app/tests/[attemptId]`, linkable from a notification.
- Diagnostic result item → the LOS pointer in `/app/materials` (D7: reading + LOS, never a page).
- Verdict banner on `/app` → `/app/settings` for the hours that produced it, so the user can change the input rather than argue with the output.
- `/app/coach` reads `user_rate_estimate` and `exam_attempts.verdict` and must never contradict the banner. Two different honest-sounding numbers on two pages is worse than one wrong number.

### 12.9 What changes elsewhere

Four Phase-1 decisions reach outside Phase 1, and each one is a defect in another page until it is done.

The ISO weekday constant (§3) changes `availability_rules`, `class_schedules`, `plan_blocks` and every calendar render — do it before there is data to migrate. The topic identifier unification (§1.7) changes `types.ts`, the diagnostic engine, the syllabus tree and `user_metrics`, and it is the prerequisite for `/app/syllabus` existing at all. Persisting questions (§1.8) changes `/api/diagnostics/generate` and unblocks item-exposure tracking, retest integrity and the provenance log. And the `plan_blocks` extension (§4.3) is what `/app/week` renders — without it the calendar has no rationale to show and no way to distinguish a bridge from a study block.

---

## 13. Study-science principles that constrain Phase 1

**Spacing must be planned, not remembered.** If onboarding sets a weekly budget without reserving capacity for review, review never happens — new material always feels more urgent. Reserve the share explicitly (§9.5) and disclose it at onboarding: *"About a fifth of your time will be revisiting earlier modules. That's what makes it stick."* Setting the expectation here prevents the week-5 complaint of "why are you making me redo Quant."

**Session length has a real ceiling.** Sustained focused study degrades past roughly 50 minutes for most people. Default to 50, allow 25–90, and let 90 carry a warning rather than a neutral presentation.

**Planning fallacy is the default failure.** Users overestimate available time by 20–40%. The declared-vs-computed reconciliation (§7.4) and the 75/85% planning fractions both exist to counteract it. Do not remove either for a shorter funnel.

**Commitment beats intention.** "Which days" is an intention. "Which days, what time, how long" is closer to an implementation intention and materially improves follow-through. This is why class times and per-day hours are worth the extra friction.

**Calibration is a teachable skill and a sellable feature.** The gap between self-reported confidence and measured mastery is something no competitor shows. Frame it at onboarding as a feature, not a quiz: *"We'll also track how well you know what you know."* Then collect confidence only per-question inside diagnostics, so the gap stays measurable.

---

## 14. Failure modes

| Case | Behaviour |
|---|---|
| Exam date past / window closed | Reject at input, suggest next window |
| Zero available hours | No plan. Say so, offer the next window |
| Exam < 4 weeks from a standing start | **Gated impossible (§7.2).** `revision` stage exempt |
| Available < `HARD_GATE_HOURS` | **Gated impossible (§7.2).** Next window, answers carried |
| Declared ≫ computed hours | §7.4 reconciliation, never silent — **and it runs before the gate** |
| Invalid/expired institute code | Fall through to B2C without losing entered answers |
| Abandon mid-flow | Persist to `onboarding_drafts`, resume by magic link |
| Draft nonce lost between browsers | Re-ask Tier 0 rather than proceeding on nothing. Four fields is a recoverable cost |
| Unmapped material provider | Fall back LOS → reading. Stated plainly. **Never fabricate a pointer** |
| Institute timetable unavailable | Photo upload → structure extraction (§11.3) |
| Estimate hits ceiling | Wrong-window verdict, not a clamp (§8.4) |
| Plan generation fails after profile write | State 3 in §6.1 → `/onboarding/plan` with a retry, never an empty `/app` |
| Week-1 completion ≈ 0 | Probe, not re-forecast (§10.4) |

---

## 15. Build order

Ordered by dependency.

**Correctness on what exists — blocking everything, roughly a day**

1. `WEEKDAY` ISO 8601 constant; purge index-0-is-Monday
2. Delete all onboarding pre-fills; fix retired 2026 topic names, from a single source of truth rather than a hardcoded array
3. Wrap the six onboarding writes in one transactional RPC; `user_materials` upsert

**Schema**

4. `learning_modules`, `lm_edges`, `user_module_state`, `user_rate_estimate`, `questions`, `non_negotiables`, `onboarding_drafts`, `institutes`, `class_templates`
5. `plan_blocks` and `profiles` extensions (§4.3)
6. Author `effort_lm` for 102 modules (§8.2 seed formula)
7. **Author `lm_edges`** — the irreducible human-judgment work and the critical path. Not code; schedule risk

**Effort model**

8. `/api/feasibility`: required-hours with bounds (§8) and the gate (§7.2)
9. Rate estimator with shrinkage (§8.3)

**Routing skeleton — do this before the UI work, not after**

10. `middleware.ts` with `resolveUserState` (§12.5); delete the inline check in `app/app/page.tsx`
11. Decompose `src/App.tsx` into `/app/*` segments; delete `src/views/` as a page system (D11)
12. `/onboarding/plan` and `/onboarding/blocked`
13. `onboarding_drafts` + nonce claim in `/auth/callback` (§12.6)

**Onboarding**

14. Tier 0 single screen + verdict card, embedded at `/` and standalone at `/check`
15. Declared-vs-computed reconciliation
16. Class times replacing class days; non-negotiables
17. Material source with honest precision states and the mapping read-out
18. Landing page (§5) around the Tier 0 embed

**Scheduler**

19. `/api/plan`; layers 1–3
20. Layer 4 bridge blocks
21. Layers 5–6 and the triage rule
22. Pull-forward queue

**Then**

23. Institute path — **invite-code entry only** (needs 4, 19–21). No list, no dropdown (D9)
24. Day-1 placement diagnostic (needs 7 and an item bank; `/api/diagnostics/generate` must persist first)

**Explicitly out of Phase 1:** institute list, dropdown and review queue (D9); share affordance, OG image and public verdict URL (D8); module-level self-report grid (§7.5). All Phase 3.

Items 10–13 look like plumbing and are sequenced early on purpose. Every one of them is cheap now and expensive after the onboarding UI is built against the wrong route shape.

---

## 16. Acceptance criteria

For a synthetic user with no finance background, 21 weeks, 12 declared hours/week, Tue/Thu classes 18:00–21:00:

1. The verdict quotes a range, not a point, and the range respects [350, 1000].
2. The plan is **topic-blocked** — contiguous multi-week runs per topic, not interleaved.
3. Block sizes per topic are *derived* from `Σ effort_lm × rate ÷ capacity`, and changing the background bucket visibly changes the block lengths.
4. At least one bridge block appears where a cross-topic prerequisite would otherwise be violated, carrying its edge rationale as user-visible text.
5. No block overlaps a class or a non-negotiable.
6. Week 1 totals ≤ 75% of computed capacity, and a pull-forward queue is present and non-empty.
7. Spaced review blocks appear at +7/+21/+56 days after each topic block closes.
8. A consolidation phase of ≥ 2 weeks exists before the exam date.
9. Every block carries a non-empty rationale string.
10. Setting available hours to 4/week produces an **infeasible** verdict with three named resolutions — and the triage option cuts Alternatives before it cuts Quant.
11. Setting available hours to 2/week (≈42h total, below `HARD_GATE_HOURS`) produces **no plan at all** — the impossible branch, next window offered, Tier 0 answers preserved through the redirect.
12. A user who declares 15h/week but whose per-day entries sum to 3h/week is **reconciled before the gate fires** — not gated on the declared figure, and not gated on the computed one until they have seen the mismatch and chosen.

Routing and wiring:

13. Completing Tier 0 on `/check`, signing up by magic link, and confirming **in a different browser** lands on `/onboarding` with the Tier 0 answers visibly present and editable.
14. Deleting every `plan_blocks` row for the current week and navigating to `/app` redirects to `/onboarding/plan`, not to an empty dashboard.
15. `/app/week`, `/app/tests/[attemptId]` and `/app/syllabus/[lmId]` are all directly linkable and load server-side with the guard applied; the browser back button works between them.
16. A block on `/app/week` links to its module, and a bridge block links to both the prerequisite and the module it unblocks.
17. An unauthenticated request to `/app/week` redirects to `/login?next=/app/week` and returns there after auth.

Criterion 10 is the one most likely to be silently wrong and the one that proves the graph does real work. Criterion 12 is the one most likely to lose a real user if it regresses. Criterion 13 is the one most likely to be skipped because it is annoying to test, and it is the common path for magic-link auth on mobile.

---

## 17. Decisions

| | Decision | Consequence |
|---|---|---|
| **D1** | The roadmap is the paid product; no permanent free tier | Free surface is Tier 0 plus a one-week trial ending at the week-1 diagnostic read-out. Every onboarding question costs a conversion we now charge for |
| **D2** | Both B2C and B2B2C | Two onboarding paths. Bridge blocks become a launch blocker, not a refinement |
| **D3** | We do not teach — name the discriminator, not the definition | Material source becomes load-bearing and cannot be defaulted through. The mapping read-out is mandatory |
| **D4** | January is a prototype covering both channels | Billing stubbed as a tier flag. The feasibility engine and graph priors are *not* prototype-grade — they are what the prototype exists to test |
| **D5** | The weekly diagnostic *is* the accountability mechanism | It is also the paywall moment, and it must cover what was planned, not what was completed |
| **D6** | Tier 0 **hard-gates** — on *impossible*, not *infeasible* (§7.2) | Two thresholds. The gate runs on computed hours, after reconciliation |
| **D7** | Schweser pointers are **LOS-level** (reading + LOS), never page | Mapping is a contents-page job, not page-by-page; survives annual re-pagination; cleaner on IP, since LOS numbering is CFAI's public outline rather than Schweser's expression |
| **D8** | Shareable feasibility card is **Phase 3** | Card stays screenshot-clean; no share affordance ships. B2C has no organic acquisition at launch |
| **D9** | Institute list is **out of Phase 1 scope** | Invite-code entry only; tables still ship in the first migration |
| **D10** | The authenticated surface is `/app/*`; `/dashboard` and `/plan/generate` are deleted from the spec | The spec was wrong, not the code. Generation becomes `/onboarding/plan` |
| **D11** | The client SPA is decomposed into route segments; `src/views/` is retired | Prerequisite for deep links, server-side guards, and the block-to-module link that carries the differentiation |

D7's one cost: an LOS pointer is less immediately actionable than a page number, so always emit reading *and* LOS together. That is still fact rather than protected expression, and it lands the user within a few pages anyway.

### Still open

1. **Does the background question hurt Tier 0 conversion?** A fourth field on a three-field screen, and mildly status-loaded. Testable only with traffic.
2. **Is "350–780" too wide to be useful at n=0?** Honest but possibly useless-feeling. The alternative is a point estimate with a caveat, which converts better and is dishonest. Leaning honest, since the positioning rests on being the product that tells the truth about time.
3. **Overrun threshold before a mid-flight feasibility warning fires.** Too tight and it fires in week 2; too loose and the early-warning value institutes buy evaporates.
4. **Is `UNCUTTABLE_CORE_FRACTION = 0.65` right?** Currently an exam-weight estimate standing in for a centrality calculation. Recompute from `lm_edges` once the graph exists, and move `HARD_GATE_HOURS` with it. Until then it is the softest number in the constants block.
5. **Registration status as a qualifying filter.** Do we serve undecided candidates, or is "registered for a specific window" the filter? Under D1 this is a paid-conversion question, not a data question.
6. **`blueprint.ts` `feedbackPerOption: true` against D3.** Per-option feedback must name the misconception and point to material, not teach. Unaudited, and it is the place D3 is most likely to be violated by accident.
