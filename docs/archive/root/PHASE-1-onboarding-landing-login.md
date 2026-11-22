# Phase 1 — Landing, Login, Onboarding

Scope boundary: everything from first page view to the moment a signed-in user has a
usable profile and a Week 1 plan exists. Nothing about the dashboard, calendar mechanics,
tests, or coach is decided here. Where Phase 1 touches those, it is only to define the
*handoff contract* — what onboarding must hand to the planner.

---

## 0. What is wrong with what exists today

These are the defects found by reading the code. They are ordered by how much damage
they do, not by how hard they are to fix.

### 0.1 Onboarding produces a number, not a plan

`src/lib/planning/initialLoad.ts` is the entire week-1 planner. It computes:

```
demand   = stageMinutes + classPressure + examPressure + calibration
capacity = availableDays × maxSessionMinutes × 2
weekly   = clamp(120, demand, capacity)
```

Three problems, in order of severity:

1. **It never asks how much work there actually is.** CFA L1 is a 300–350 hour
   qualification. The function has no term for total hours required and no term for
   hours remaining per week between now and the exam. A user on Feb 2027 with 3
   available days and 30-minute sittings gets `120 minutes/week`. That is 2 hours a
   week for a 300-hour exam. The number is not merely low — it is *arithmetically
   disconnected from the exam*.
2. **It is unbounded upward in a way that lies.** `capacity` allows `7 days × 90 min × 2 = 1260 min/week`
   (21 hrs). Real sustained study for a working candidate is 10–13 hrs/week. We will
   happily promise a plan we know breaks.
3. **It returns minutes, not a schedule.** Nothing selects modules, nothing orders them
   by prerequisite, nothing places blocks on days. The user finishes onboarding with a
   number and an empty calendar. This is the single biggest gap between the PRD and the
   product.

The correct output of onboarding is a **feasibility verdict plus a seeded Week 1**, not
a weekly minute budget. See §5.

### 0.2 The topic list is from the wrong curriculum year

`OnboardingFlow.tsx` hardcodes `'Corporate Issuers'`, `'Equity Investments'`,
`'Portfolio Management'`. The 2027 curriculum renamed these to **Corporate Finance**,
**Equities**, **Portfolio Construction**. We are selling a 2027 product and the very
first screen a user sees shows 2026 nomenclature. A CFA candidate will notice this
within five seconds and it costs us credibility we cannot buy back.

### 0.3 Every answer is pre-filled

```ts
{ examWindow: 'may-2027', prepMode: 'coaching', availableDays: [0,1,3,4,5],
  classDays: [2,6], maxSessionMinutes: 60, startingStage: 'in-progress',
  materialSource: 'schweser-2027', coveredTopics: ['Quantitative Methods'] }
```

A user can click Next four times and land on a dashboard built entirely from invented
facts. `startingStage: 'in-progress'` and `coveredTopics: ['Quantitative Methods']` are
not neutral defaults — they are claims about the user's knowledge that will feed the
mastery graph and produce a wrong plan. Defaults are fine for *preferences*. They are
poison for *evidence*.

### 0.4 Weekday index convention is undefined

The UI uses `days = ['Mon','Tue',...,'Sun']`, so index 0 = Monday. These raw indices are
written to `availability_rules.weekday` and `class_schedules.weekday`. Postgres
`extract(dow)` and JS `Date.getDay()` both use 0 = Sunday. There is no comment, no
constant, no conversion. The first time anyone writes a query that joins plan blocks to
actual dates, everything shifts by one day and it will look like a scheduling bug rather
than a units bug.

### 0.5 The onboarding write is not transactional

`api/onboarding/route.ts` performs six sequential writes and returns early on the first
error. A failure at `class_schedules` leaves a user with a profile, an onboarding
session, an exam attempt, and availability rules — but no classes, and no way to tell
the difference between "no classes" and "classes failed to save." `user_materials` uses
`.insert()` rather than upsert, so re-running onboarding duplicates the row.

### 0.6 There is no graph in the database

`supabase/schema.sql` has nine tables. None of them are `learning_modules`, `edges`,
`user_module_state`, or `questions`. The PRD's entire architecture — 102 LM nodes,
prerequisite edges with strength, coverage state machine, evidence hierarchy — has zero
representation in the schema. `user_metrics` is flat: `(subject_id text, readiness, coverage)`.

This matters in Phase 1 because **onboarding's job is to write the initial state of the
graph**, and there is nowhere to write it.

### 0.7 SubjectId has 5 values; onboarding collects 10 topics

`src/types.ts`: `SubjectId = 'fixed-income' | 'quant' | 'fsa' | 'equity' | 'ethics'`.
Onboarding collects ten topics as free strings. These two systems do not connect. The
`coveredTopics` a user selects during onboarding cannot address anything the diagnostic
engine understands.

### 0.8 Generated diagnostic questions are never persisted

`api/diagnostics/generate/route.ts` mints IDs like `${subjectId}-live-${Date.now()}-${i}`
and throws them away. No `questions` table exists. This breaks item-exposure tracking
(the 60-day no-repeat rule), makes retest integrity impossible, and violates the
provenance-log requirement in PRD §14. Relevant to Phase 1 only because the *onboarding
diagnostic* (§6) is the first place we generate items.

---

## 1. What Phase 1 is actually for

Onboarding is not a settings form. It has four jobs, and only one of them is data
collection.

| Job | Why it exists | Failure mode if skipped |
| --- | --- | --- |
| **Establish feasibility honestly** | Tell the user, before they pay attention to anything else, whether their time budget and exam date are compatible | They discover in week 6 that the plan was never going to work, and blame us |
| **Seed the graph with priors** | Give the mastery model a starting position so week 1 is not random | Week 1 is generic, indistinguishable from a PDF study planner |
| **Earn the right to be prescriptive** | The user must understand *why* we are going to tell them what to study | They override the plan on day 3 and we become a calendar app |
| **Collect constraints** | Availability, class schedule, sitting length, exam window | Blocks land at times the user cannot study |

Everything below serves one of these four.

---

## 2. Landing page

The landing page has one job: make a candidate who is already studying feel *seen*, and
a candidate who has not started feel *rescued*. These are two different people and the
page must speak to both without splitting.

### 2.1 The positioning sentence

We are not selling CFA material. We are selling **the answer to "am I on track, and what
do I do next?"** — a question every candidate asks weekly and no current tool answers.

Working headline direction (not final copy, direction):

> **You have the material. You don't have a plan that survives contact with your life.**
> Roadmap turns your CFA Level 1 syllabus into a week-by-week schedule that adapts to
> what you actually finished, and proves what you actually know.

The second sentence carries the two differentiators: **adapts to actual completion** and
**proves knowledge**. Neither Schweser nor a Notion template nor a coaching institute
does either.

### 2.2 The three-part proof, in this order

1. **The calendar that reacts.** Show a week where two blocks were missed and the next
   week has visibly re-sequenced. This is the single most legible screenshot we own.
2. **The strength/weakness map.** Show a topic tree where Equity is red *because* WACC is
   red — the prerequisite drag idea made visual. This is the thing nobody else has and
   it should be shown, not described.
3. **The verification loop.** Class or self-study → Diagnostic → Repair → Re-verify.
   `AuthForm.tsx` already carries this copy on the right panel; it belongs on the landing
   page first and the auth page second.

### 2.3 What the landing page must NOT do

- Do not claim to teach CFA content. The moment we look like a content provider we are
  compared on content volume and we lose to Schweser and Kaplan on day one.
- Do not lead with AI. Every ed-tech landing page in India leads with AI and it now reads
  as a substitute for a product. Lead with the *outcome* (a plan that adapts) and let the
  AI be the invisible mechanism.
- Do not put a pricing table above the fold before we have a price we can defend.

### 2.4 The pre-signup hook — free, no-account "Am I on track?"

**This is the highest-leverage thing on the landing page and it does not exist yet.**

Three questions, no account required:
1. Which exam window? (Feb / May / Aug / Nov 2027)
2. How many hours a week can you realistically study?
3. How far along are you? (Not started / Some topics / Most topics / Revision)

Output, computed client-side in under a second:

> **You have 21 weeks and 189 available hours. CFA Level 1 needs ~310.
> You are 121 hours short. Here are your three options:**
> — move to the August window
> — find 5.8 more hours a week
> — accept a plan that prioritises the 60% of the syllabus worth 78% of the marks

That last line is the product thesis in one sentence, delivered before signup, for free.
It also does the honest-feasibility job (§1) before the user has invested anything, which
is exactly when honesty is cheapest for them and most credible from us.

Then: *"Create an account to build the plan."* Conversion is now driven by a computation
they already trust.

---

## 3. Auth

Current implementation (`AuthForm.tsx`) is structurally fine. Google OAuth → `/auth/callback?next=/app`;
email signup → `/auth/callback?next=/onboarding`. Changes needed:

### 3.1 The redirect logic is wrong

Login always goes to `/app`. But a user who signed up and abandoned onboarding halfway
will land on a dashboard with no plan. Routing must be **state-driven, not path-driven**:

```
on authenticated session:
  if no profiles row               → /onboarding
  if onboarding_sessions.completed_at is null → /onboarding?resume=1
  if no plan_blocks for current week → /onboarding/plan   (regenerate)
  else                             → /app
```

This must be a single server-side guard, not scattered client redirects.

### 3.2 Carry the landing-page answers through signup

If the user did the §2.4 feasibility check, those three answers must survive the auth
round-trip (sessionStorage keyed to a nonce, or a short-lived server-side draft row) and
pre-fill onboarding steps 1 and 2. Asking the same question twice within ninety seconds
is the fastest way to make a product feel stupid.

### 3.3 Password minimum of 8 is too weak to bother with

Either enforce something real (12 chars, or zxcvbn score ≥ 3) or drop the client check
entirely and let Supabase policy govern. A rule that is easy to satisfy and easy to
forget is the worst of both.

### 3.4 Magic link over password for the India mobile segment

A large fraction of the target user will sign up on a phone. Password creation on mobile
has meaningfully worse completion than OTP/magic link. Recommend: Google OAuth primary,
magic link secondary, password as a tertiary option. This is a conversion decision, not
a security one.

### 3.5 Delete the demo bypass before launch

`/onboarding?demo=1` with pre-filled everything is fine in dev, dangerous in prod. Gate
it on `NODE_ENV !== 'production'` at the route level, not just in the link's visibility.

---

## 4. Onboarding — redesigned

The current four steps collect the right *categories* of information and the wrong
*specifics*. Below is what each step should be, and critically, **what each answer is
used for** — because if an answer does not change the plan, it should not be asked.

### Step 0 — Frame (new, 10 seconds, no input)

One screen, before any question:

> **Four questions. Then a plan.**
> We'll ask how much time you have, when your classes are, and what you've already
> covered. Everything you tell us changes the schedule — nothing here is a preference
> setting.

This does two things: sets expectations for length (reduces abandonment), and pre-frames
every subsequent answer as consequential (improves answer quality). The current flow's
pre-filled defaults train the opposite instinct.

### Step 1 — Exam target

| Field | Current | Should be | Used for |
| --- | --- | --- | --- |
| Exam window | 4 windows, pre-filled May | 4 windows, **no default**, each showing "X weeks away" | Total time budget; feasibility verdict |
| Registration status | *missing* | Registered / Planning to / Undecided | If undecided, we soften the feasibility verdict and offer the "which window should I pick?" flow instead |
| Timezone | present | keep, auto-detect, allow override | Block placement, streak boundaries, notification timing |

**Add: window recommendation.** If the user is undecided, do not make them guess. Ask
hours-per-week first, then *tell them* which window is achievable. This inverts the
funnel in our favour — we become the authority on their timeline before we ask for
anything.

### Step 2 — Time reality

This is the step that determines whether the product works. Current implementation is
the closest to correct and still under-specifies.

| Field | Current | Should be | Used for |
| --- | --- | --- | --- |
| Prep mode | self-study / coaching | keep, add "coaching + self-study" as distinct | Whether class order overrides graph order (PRD §6.3a bridge blocks) |
| Class days | weekday multi-select | **day + start time + duration**, and which topic if known | Class blocks are fixed obstacles; without times we cannot place study blocks around them |
| Available days | weekday multi-select | keep, but ask **hours per day per day**, not just which days | A user free Sat/Sun for 5h each is a completely different plan from one free 7 days for 45min |
| Max sitting | 30/45/60/90 | keep; default 45 with a note on why | Block granularity |
| Weekly hour commitment | *derived* | **ask directly, then reconcile** | See below |

**The reconciliation is the important move.** Ask the user directly: "Realistically, how
many hours a week?" Then compute capacity from their day-by-day availability. If they say
15 but their availability sums to 9, show them:

> You said 15 hours, but the days you marked add up to 9. Which is right?
> [My hours are right — let me fix my availability] [My days are right — 9 it is]

This catches the most common and most destructive onboarding error: aspirational hour
commitments that collapse in week 2. Better to have the argument now.

**Add: buffer preference.** "Should I plan you at 100% of your available time, or leave
slack?" Default to **85%**. Planning a human at 100% capacity guarantees failure in week
1 and week-1 failure is the single strongest predictor of churn. Explain it in one line:
*"We'll plan 85% of your time so a bad day doesn't break the week."*

**Add: non-negotiable commitments.** One free-text or a few chips — job, college, commute,
Friday evenings. We do not need to model these precisely; we need them to feel heard and
we need to not schedule over the obvious ones.

### Step 3 — Starting position

The current step conflates three different things: stage, material source, and prior
coverage. Split them.

#### 3a. Stage

`not-started / in-progress / revision`, **no default**. Used to pick the onboarding
diagnostic depth (§6) and the initial coverage prior.

#### 3b. Material source

Default `schweser-2027` — this is correct and is the "first bible" decision. Options:
- **Schweser 2027** (default, pre-mapped, zero user effort)
- **CFA Institute curriculum 2027** (pre-mapped)
- **My coaching institute's material** (upload)
- **Something else** (upload)

Upload flow with consent is already implemented. Two additions:
1. If the user uploads, **still map to Schweser as the backbone** and treat the upload as
   an overlay. We must never be in a position where an unparseable upload leaves the user
   with no curriculum structure.
2. Show what the mapping produced before proceeding: "We matched 94 of 102 modules to
   your material. 8 unmatched — we'll use the standard sequence for those." Transparency
   here buys enormous trust and costs one screen.

#### 3c. Prior coverage — replace topic checkboxes with module-level self-report

Current: ten topic checkboxes, one pre-checked. This is too coarse to be useful. "I've
covered Quantitative Methods" could mean two modules or nine, and the plan differs
completely.

Replace with a **progressive disclosure list**: ten topics collapsed; expanding one shows
its learning modules with a three-state control — *Not seen / Studied / Confident*.
Default all to Not seen. A not-started user expands nothing and clicks through in five
seconds. A revision-stage user spends four minutes and gives us a genuinely useful prior.

Critically: **self-report is a prior, not evidence.** Per PRD §5, confidence never
counts as evidence — it only feeds the calibration gap. Say this on screen:

> This helps us start in the right place. We'll verify it with a short diagnostic —
> what you tell us here doesn't affect your readiness score.

That sentence is the product's integrity in one line, and it also lowers the stakes of
answering, which improves answer honesty.

### Step 4 — Feasibility verdict (new, replaces "Review")

The current Review step summarises inputs. That is a wasted screen. Replace it with the
computation that justifies the entire product.

```
Your exam:        18 May 2027 — 37 weeks away
Your time:        11.5 hrs/week × 37 weeks × 0.85 buffer = 362 hours
CFA L1 needs:     ~310 hours for a first-time candidate at your starting point
Verdict:          Comfortable. 52 hours of slack for revision and mocks.
```

Three verdict states, each with a different next action:

| State | Condition | What we show |
| --- | --- | --- |
| **Comfortable** | capacity ≥ required × 1.1 | Slack hours, offer to add mock-exam weeks |
| **Tight** | 0.9 ≤ ratio < 1.1 | "No room for a bad month." Offer buffer reduction or an extra hour/week |
| **Not feasible** | ratio < 0.9 | The three options from §2.4: change window, find hours, or accept prioritised coverage |

**The "not feasible" screen is the most important screen in the product.** Everyone else
in this market tells the user yes. Telling them the truth, with three concrete exits, is
the thing they will remember and repeat to other candidates.

Required-hours estimate must be a function of starting stage and self-reported coverage,
not a constant. Rough shape:

> **SUPERSEDED — see `EFFORT-MODEL.md`.** The formula below treats required-hours as a
> fixed constant discounted by self-report. It is wrong in three ways: 310 is a population
> mean masquerading as a personal fact, it never learns from observed performance, and it
> works at topic granularity when we have a 102-node module graph. Replaced by a per-module
> effort sum multiplied by a learned per-user rate. Kept here only to show what changed.

```
required = 310 × (1 − 0.55 × coverage_share_self_reported) × stage_multiplier
stage_multiplier: not-started 1.0 | in-progress 0.95 | revision 0.7
```

The 0.55 discount (not 1.0) encodes that self-reported coverage is unreliable — a user
claiming 100% coverage still needs 45% of full time. Calibrate this from real data later;
the principle is that self-report never fully discounts.

---

## 5. What onboarding must hand to the planner

The contract. Onboarding is done when it has written:

```
UserProfile        { timezone, exam_window, exam_date, registration_status }
TimeBudget         { per_weekday_minutes[7], max_session_minutes, buffer_pct,
                     declared_weekly_hours, computed_weekly_hours }
ClassSchedule[]    { weekday, start_time, duration_minutes, topic_id? }
MaterialMapping    { provider, mapped_lm_count, unmapped_lm_ids[] }
ModulePrior[]      { lm_id, self_report: not_seen|studied|confident }
FeasibilityVerdict { required_hours, available_hours, ratio, state, chosen_resolution }
```

Note what is *not* in this contract: a weekly minute budget. `computeInitialStudyLoad`'s
output has no consumer in a correct design. The planner takes the budget and the priors
and produces blocks. Delete the function or reduce it to the feasibility arithmetic.

**Weekday convention must be fixed here and documented:** use **ISO 8601, 1 = Monday
through 7 = Sunday**, as a named constant, converted at both UI and DB boundaries.
Pick it now, before there is data to migrate.

---

## 6. The onboarding diagnostic — the open question

The PRD says diagnostics are the evidence source. Onboarding collects self-report, which
is explicitly *not* evidence. So week 1 is planned on priors alone unless we diagnose
during onboarding.

Three options, and I think the third is right:

**(a) No diagnostic in onboarding.** Fastest funnel. Week 1 is planned purely on
self-report, which we just told the user is unreliable. Week 1 will be visibly generic
and week 1 is when we prove ourselves. Rejected.

**(b) Full diagnostic in onboarding.** 8–12 questions × 102 modules is absurd. Even
8–12 × 10 topics is 100 questions and 90 minutes. Nobody completes onboarding. Rejected.

**(c) Placement diagnostic — 12 questions, 15 minutes, targeted.** Select 12 items
spanning the **highest-fan-out nodes in the prerequisite graph** — the modules that most
other modules depend on (time value of money, discounting, financial statement mechanics,
basic statistics, ethics framework). Getting these right or wrong propagates the furthest
through the drag calculation, so 12 items buy far more information than 12 random ones.

Only offer it to users who report `in-progress` or `revision`. For `not-started`, there
is nothing to place — skip it and say so.

Make it skippable with an honest cost statement:

> Skip for now — your first week will be based on what you told us, and we'll calibrate
> from your first diagnostic instead.

This is also where the missing `questions` table (§0.8) becomes blocking. The placement
diagnostic must persist items and responses or it teaches us nothing durable.

---

## 7. Week 1 — the shape of the answer

Full scheduler design is Phase 3+. But Phase 1 must know what it is feeding, so here is
the shape, to be pressure-tested later.

Week 1 has a different job from week N. Week N optimises coverage. **Week 1 optimises
two things: proving the product works, and producing a clean measurement.**

Proposed structure:

- **Deliberately under-plan week 1 at ~75% of computed capacity, not 85%.** A user who
  finishes week 1 is dramatically more likely to be there in week 8. A user who completes
  60% of week 1 has learned that our plans are fiction. Under-planning week 1 is the
  cheapest retention intervention available and costs roughly 2 hours of syllabus.
- **Sequence from graph roots, not from the syllabus order.** Start at the highest-fan-out
  unmastered nodes. This means week 1 may start in Quant, not Ethics, and we must explain
  why on the calendar itself: *"Starting here because 14 later modules depend on it."*
  That single line is the product's entire differentiation, visible on day 1.
- **If prep mode is coaching, class order wins on timing** (PRD §6.3a) and week 1 must
  include bridge blocks for prerequisites the class is about to assume. This is the
  Persona A killer feature and week 1 is where it first shows.
- **End week 1 with a diagnostic on exactly what was planned** — not on what was
  completed. Measuring only completed work makes the score uninterpretable and lets a
  user game readiness by skipping hard modules.
- **Every block carries a one-line rationale.** Not decoration. It is what converts the
  calendar from a schedule into an argument, and an argument is what the user cannot get
  from a PDF planner.

The open sub-questions I want to resolve in the Phase 3 discussion:
1. How much of week 1 is new material vs. verification of claimed prior coverage?
2. Do we place mock/practice blocks in week 1 at all, or is week 1 purely acquisition?
3. If the user is `revision` stage with 8 weeks left, is week 1 structurally different
   (all diagnostic, no new material) — i.e. do we need a separate "endgame mode"?

---

## 8. Study-science principles that belong in Phase 1

These are the ones that constrain onboarding specifically. The broader set belongs in
later phases.

**Spacing must be planned, not remembered.** If onboarding sets a weekly budget without
reserving capacity for review of prior material, review never happens — new material
always feels more urgent. Reserve a fixed share of the budget for retrieval from week 3
onward, and disclose it at onboarding: *"About a fifth of your time will be revisiting
earlier modules. That's what makes it stick."* Setting this expectation at onboarding
prevents the week-5 complaint of "why are you making me redo Quant."

**Session length has a real ceiling.** The 30/45/60/90 options are fine but 90 should
carry a warning, not a neutral presentation. Sustained focused study degrades past ~50
minutes for most people. Default to 45 and say why.

**Planning fallacy is the default failure.** Users overestimate available time by
20–40%. The declared-vs-computed reconciliation (§Step 2) and the 85% buffer both exist
to counteract this. Do not remove either for the sake of a shorter funnel.

**Commitment beats intention.** Asking "which days" is an intention. Asking "which days,
what time, how long" is closer to an implementation intention and materially improves
follow-through. This is why class times and per-day hours are worth the extra friction.

**Calibration is a teachable skill and a sellable feature.** The gap between self-reported
confidence and measured mastery is something no competitor shows. Onboarding is where we
first collect the confidence side of it. Frame it at onboarding as a feature, not a quiz:
*"We'll also track how well you know what you know."*

---

## 9. Phase 1 build order

Ordered by dependency, not by size.

1. **Fix weekday convention** to ISO 1–7 with a named constant. Blocking everything
   downstream and cheapest to fix now.
2. **Rename topics to 2027 nomenclature** and derive them from a single source of truth,
   not a hardcoded array in a component.
3. **Add the curriculum tables** — `learning_modules`, `edges`, `user_module_state`.
   Onboarding has nowhere to write priors without these.
4. **Remove all pre-filled evidence defaults**; keep preference defaults only.
5. **Make the onboarding write transactional** (single RPC), fix `user_materials` to upsert.
6. **Replace `computeInitialStudyLoad`** with the feasibility computation from §4 Step 4.
7. **Rebuild Step 2** with per-day hours, class times, declared-vs-computed reconciliation,
   and buffer.
8. **Rebuild Step 3c** as progressive module-level self-report.
9. **Add Step 4 feasibility verdict** with three states.
10. **Add state-driven post-auth routing.**
11. **Add the landing-page pre-signup feasibility check** (reuses §6 logic; ship after the
    logic is proven inside the funnel).
12. **Add the placement diagnostic** — requires the `questions` table, so it lands last in
    Phase 1 and may slip to Phase 2.

Items 1–6 are correctness. 7–10 are the redesign. 11–12 are growth and can slip.

---

## 10. Decisions landed, and what they change here

Four decisions were taken on the PRD (D1–D4, PRD §15). Three of them reshape onboarding.

### D1 — The roadmap is the paid product

No permanent free tier. Free surface is the no-account feasibility check plus a one-week
trial ending after the week-1 diagnostic read-out.

**What this changes in onboarding:**

- The §2.4 pre-signup feasibility check moves from "nice growth idea" to **the only free
  thing we have**. It is now the entire top of funnel and deserves proportionate care.
- Onboarding must be **fast enough to reach week 1 inside the trial**. Every question
  added is a question that costs us a conversion we are now charging for. The placement
  diagnostic (§6) becomes harder to justify at signup — see the revised position below.
- The end of onboarding is no longer "here is your plan." It is **"here is your plan,
  and in seven days you'll see something no free planner can show you."** The trial's
  terminal event must be set up *at onboarding*, not discovered later.

### D2 — Both B2C and B2B2C

**This answers the hardest open question in Step 2.** Class days *and times* were the
most fragile input in the flow — the question of whether a student would know or bother
to enter their timetable. Through the institute channel, the timetable comes from the
institute once, for the whole cohort.

**What this changes in onboarding:**

- There are now **two onboarding paths**, not one. An institute-referred student inherits
  timetable, provider material, and cohort — and should skip most of Step 2 entirely.
  Their onboarding should be under 90 seconds.
- The institute field must be a **real list, not free text**, from day one, so cohorts
  group without a migration.
- Class schedules are modelled as **institute-owned templates a student inherits**.
  Per-student manual entry becomes the B2C fallback, not the primary path.
- Consent copy for institute-visible progress must exist in the onboarding flow itself.
  A student must know, at signup, that their institute can see their completion and
  readiness. This is not a settings-page detail.

### D3 — We do not teach

We name what was missed and point to the exact location in the user's own material.

**What this changes in onboarding — and it is more than it first appears:**

- **Material source stops being a preference and becomes load-bearing.** Under D3 the
  repair path *is* a pointer into their book. If we do not know precisely which book they
  own, we cannot produce a repair instruction at all. Step 3b moves from "nice to know"
  to **required, cannot be defaulted through**.
- Schweser 2027 remains the default backbone, but the onboarding copy must change from
  passive to active: not "which material do you have?" but **"we'll point you to exact
  pages when you get something wrong — which book will you be holding?"** That reframes
  the question as a benefit rather than a form field, and materially improves answer
  accuracy.
- The mapping-confidence screen (§3b, "we matched 94 of 102 modules") is now
  **mandatory, not optional transparency**. Unmatched modules are modules where we can
  diagnose but cannot direct — a dead end under D3 — and the user must be told which ones
  before they rely on us.
- Onboarding must set the expectation explicitly: *"We don't teach the content. Your
  material does that. We tell you what to study, prove whether it stuck, and show you
  exactly where to go when it didn't."* Saying this at onboarding prevents the week-3
  complaint of "why won't it just explain this to me," which is otherwise guaranteed.

### D4 — January is a prototype covering both channels

Onboarding must ship both paths (B2C full, institute-inherited short) by January, with
billing stubbed as a tier flag. The feasibility engine and the graph priors are *not*
prototype-grade — they must be real, because they are what the prototype exists to test.

---

## 11. Still open

1. **Registration status** — do we serve undecided candidates, or is "registered for a
   specific window" the qualifying filter? Under D1 this is now a paid-conversion
   question, not just a data question.
2. **Placement diagnostic in onboarding** — D1 makes 15 minutes at signup expensive.
   Revised recommendation: **move it out of onboarding and into day 1 of the trial
   week**, as the first calendar block. Same information, no funnel cost, and it makes
   day 1 feel like the product rather than more setup.
3. **The "not feasible" verdict** — still unanswered and now higher-stakes under D1. Are
   we willing to tell a user their date is not achievable before they have paid? I think
   yes — it is the most credible thing we can do and it is what gets repeated to other
   candidates — but it has direct revenue consequences and it is your call.
4. **Institute list** — which institutes do we seed the dropdown with, and is the
   Phase-0 concierge cohort's institute the first entry?
