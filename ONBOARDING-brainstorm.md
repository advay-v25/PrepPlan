# Onboarding — deep dive

Companion to `PHASE-1-onboarding-landing-login.md`. That document defined *what onboarding must do*. This one argues about *how*, screen by screen, both paths, and stress-tests the parts most likely to be wrong.

---

## 0. The reframe: onboarding is not a form, it is the first week

The current build treats onboarding as a four-step wizard that terminates in a plan. That framing is the source of most of the defects.

Under D1 the roadmap is the paid product, which means every question asked before signup is friction on a conversion funnel, and every question not asked degrades the thing we are selling. Those two pressures only reconcile if we stop treating onboarding as one event and split it by *what each answer is for*:

| Tier | When | What it collects | Why it belongs here | Budget |
|---|---|---|---|---|
| **0 — Verdict** | Pre-account, no signup | Exam window, weekly hours, current stage | Only the inputs that change the feasibility verdict | ~40 sec, one screen |
| **1 — Plan** | Post-signup, before Week 1 | Class times, non-negotiables, material source, per-day distribution, timezone | Only the inputs that change *placement* of blocks | ~3 min, four screens |
| **2 — Priors** | During Week 1, in-app | Module-level mastery, calibration, actual capacity | Collected by measurement and behaviour, never by survey | 0 sec of form |

Tier 2 is the important move. The current design collects module priors by asking the user to tick topics. That is a ten-minute wall of self-report at the exact granularity where self-report is least reliable, placed at the exact moment where drop-off is most expensive. It should not exist as a form at all. It is produced by the day-1 placement diagnostic and by observed block completion.

**Onboarding's job is to earn seven days of attention. Week 1 does the actual profiling.**

---

## 1. Tier 0 — the pre-account feasibility check

One screen. Three fields. No page transitions — every transition in a pre-account flow is a drop-off point, and there is nothing here worth splitting.

```
When are you sitting the exam?     [ Feb 2027 ▾ ]  ( ) Not registered yet
Realistically, hours per week?     [ ___ ]         hint: be honest, not aspirational
Where are you now?                 ( ) Haven't started
                                   ( ) Started, then stopped   → when did you stop? [___]
                                   ( ) Studying consistently
                                   ( ) Revising / resitting
```

### 1.1 The stage question is currently doing too much work

`not-started | in-progress | revision` collapses two different people into one bucket. Someone who did three weeks in January and stopped is nominally "in-progress" and functionally "not-started," because retention without retrieval collapses fast. Their required hours are close to a beginner's; their *confidence* is not, which makes them the highest-risk user we have.

Fix: **split "started, then stopped" out and ask for recency.** Decay is a function of elapsed time, not of self-description. The stage multiplier then becomes:

```
not_started            1.00
started_stopped        0.95 - 0.10 × recency_factor    (recency_factor → 0 as gap → 6 months)
studying_consistently  0.90
revision               0.70
```

This is also the first place the product can say something the user has not heard before, which matters more than the arithmetic: *"You studied four months ago. Most of that has decayed — we'll plan as if you're starting, and the diagnostic will tell us how much you kept."* That single sentence is a better demo of what we do than any feature list on the landing page.

### 1.2 Registration status is not a data field, it is three things at once

- **A qualifying filter.** A registered candidate has paid CFA Institute upwards of $940. They are dramatically more likely to convert than a browser.
- **A calendar item we can give away immediately.** Unregistered users have a registration deadline, and it is a real deadline with a real price step. *"Your early registration deadline is 5 Nov — 64 days. It's on your calendar."* That is a free, correct, useful thing delivered before signup.
- **A copy switch.** Unregistered users need the window recommendation *before* the feasibility verdict, because their window is still a variable rather than a constraint. Registered users need the verdict against a fixed date.

### 1.3 The hours question is a lie, and the design should say so

Every hours-per-week figure collected at onboarding is optimistic. This is not a user flaw to be patched with a buffer constant; it is the planning fallacy, and it is the single most reliable finding in the literature on self-scheduling.

Three responses, in increasing order of honesty:

1. **Buffer silently** (current plan, 85%). Works, invisible, and wastes the credibility.
2. **Buffer visibly.** "You said 15. We'll plan 12 and let you pull work forward." Better — the user learns the system is not naive.
3. **Frame the number as a hypothesis.** *"We'll plan against 15 this week and measure what actually happens. Week 2's plan uses the real number, not this one."*

Take (3). It costs nothing, it is true, and it pre-sells the week-1 diagnostic — which under D5 is the accountability mechanism and the paywall moment. Onboarding should be planting that hook, not just collecting a number.

### 1.4 Declared vs. computed reconciliation

The sharpest single mechanic in the flow, and it costs almost nothing to build.

User declares 15 hours/week. Later, per-day availability sums to 9. Do **not** silently take either. Show both:

> You told us 15 hours. Your days add up to 9. Which one is true?
> `[ My days are right — plan 9 ]  [ I have more time than I mapped — let me redo the days ]`

This is the first moment the product demonstrates that it is paying attention rather than filing answers, and attention is the entire value proposition. Cheapest credibility we will ever buy.

### 1.5 The verdict, and why it must be allowed to say no

Open question from Phase 1 §11: is a "not feasible" verdict acceptable before payment? **Yes — it is the strongest conversion event available to us.**

A product that says *"you are 121 hours short, here are your three options"* is doing something no free planner does and no prep provider is incentivised to do. A product that says *"great, let's go!"* to a candidate with nine weeks and six hours a week is lying, and the user finds out in week 3, which is exactly when churn already peaks.

The three resolutions:

| Resolution | What it takes | Who it fits |
|---|---|---|
| **Move the window** | Feb → May → Aug, recomputed live | Unregistered, or registered with a deferral option |
| **Find the hours** | Show *where*: "you have four unallocated evenings and two open weekend mornings — 9 of the 121" | Users whose declared availability was conservative, not real |
| **Accept partial coverage** | Topic-weighted triage: depth sacrificed on Derivatives (5–8%) long before Ethics (15–20%), and never on high-fan-out graph roots | Committed to the date, genuinely time-constrained |

Resolution 3 is the one only we can offer, and it should be treated as the flagship. It requires topic exam-weight × graph centrality to decide what to sacrifice. A generic planner cannot produce it, and a prep provider will not, because "skip this material" contradicts their business. Build it as the visible differentiator, not as a fallback.

### 1.6 False precision in the hours number

**Stress-test on our own plan:** the 310-hour figure is CFA Institute's self-reported survey mean. Variance around it is enormous. Presenting *"you need 310 hours"* as a personal fact to a candidate who knows the number is generic is a credibility bomb — one Reddit comment away from "it just uses the same 300 hours everyone quotes."

Fix: present as a range with a visible source and a visible personalisation:

> Typical: **300–350 hours** (CFA Institute candidate survey).
> Yours: **~280**, because you've already covered Quant and FRA at a level you rate as confident.

The number being visibly *derived* matters more than the number being right.

### 1.7 The output should be shareable

Tier 0 ends in a card: *21 weeks. 189 hours available. ~280 needed. 91 short. Three ways to close it.*

Make that card screenshot-clean and give it a share affordance. CFA candidates cluster in WhatsApp and Telegram groups by exam window, and a feasibility verdict is exactly the kind of artefact that gets forwarded — it is about the sender, not about us. In a B2C channel where CAC is the structural risk (§13), this is close to free distribution, and it costs one afternoon of layout work.

---

## 2. Tier 1 — post-signup, pre-Week-1

Four screens, and the user has already committed by arriving here, so the friction budget is different.

### 2.1 Auth

- Magic link as the primary path, password as secondary. Indian mobile users abandon password creation at high rates, and we have no reason to hold password hashes.
- **Carry the Tier 0 answers through signup.** Losing them and re-asking is the single most avoidable churn event in the flow. Key partial state to the pre-account session; make it resumable by magic link if they leave.
- **Route by state, not by path.** `has_profile && has_plan → /dashboard`, `has_profile → /plan/generate`, else `/onboarding`. Path-driven routing breaks the moment a user bookmarks anything.
- Delete `/onboarding?demo=1` before any external user touches the build.

### 2.2 Timezone

Detect from the browser, then confirm in one line. Do not skip the confirmation — VPN users and travellers get silently wrong calendars, and a calendar that is wrong by hours is worse than no calendar.

### 2.3 Class schedule — times, not days

The current model stores `classDays: string[]`. Days are useless for placement. A class on Tuesday tells us nothing; a class Tuesday 18:00–21:00 tells us Tuesday evening is gone and Tuesday night is low-value.

Collect: weekday (ISO 8601, 1=Mon … 7=Sun, as a named constant — the current index-0-is-Monday convention silently disagrees with both JS and Postgres), start time, duration, and optionally the topic being taught.

The topic field is what makes bridge blocks possible (PRD §6.3a). If the institute teaches Derivatives in week 3 and the graph says the user is not ready, we insert a prerequisite bridge block rather than either overriding the institute or letting the user drown. Under D2 this is a launch blocker, not a nicety.

### 2.4 Non-negotiables

One screen, and it is the difference between a calendar the user trusts and one they abandon. Commute, job hours, prayer, gym, family obligations, one recurring thing they refuse to give up. Anything scheduled here is immovable, and the planner works around it rather than through it.

The reason this matters more than it looks: the first time the app schedules a study block during something sacred, the user stops believing the calendar, and there is no recovery from that. Cheaper to ask than to lose.

### 2.5 Material source — no default (D3 consequence)

D3 says we do not teach; we point. A pointer into material the user does not own is worthless. So this question moves from Phase-4 nicety to Phase-1 blocking, and it must not have a pre-selected answer.

```
What are you studying from?
( ) Schweser 2027            → fully mapped, pointers precise to reading
( ) CFA Institute curriculum → mapped to LOS only, pointers coarser
( ) My institute's material  → upload, we extract structure
( ) Something else / not sure → we point to LOS, you locate it
```

**And we must state the failure mode honestly at this screen.** If the user picks an unmapped provider, the correct behaviour is *"we'll point you to the LOS, but not to a page number"* — not silently emitting confident-looking garbage pointers. A wrong pointer is worse than no pointer, because it burns the one thing D3 leaves us.

Note the architectural constraint from §2a.2: for uploaded material we extract **structure** (headings, page numbers, chapter boundaries — facts) and never body text into a generation context. This is not a policy preference, it is the whole IP position.

### 2.6 What we deliberately do not ask

| Not asked | Why |
|---|---|
| Learning style | No empirical support, and it primes an expectation we will not meet |
| Goals / motivation free text | We cannot act on it. It is theatre, and users can tell |
| 102 module checkboxes | Self-report at that granularity is noise, at the point of maximum drop-off |
| Topic confidence sliders | **Contaminates the calibration measurement.** See below |

**On confidence sliders — this one is non-obvious.** The calibration gap (self-reported confidence minus measured mastery) is a genuine differentiator and a sellable output. Asking for confidence at signup, before any measurement, anchors the user's later self-assessment and pollutes the very quantity we want to measure. Collect confidence *per question, at the moment of the diagnostic* instead. That yields per-item calibration data, which is strictly better than one number per topic, and it is free — it is one tap inside a flow the user is already in.

---

## 3. The institute path (D2)

Target: **under 90 seconds**, because the institute has already done the selling and a long form here reads as friction on something the student was told to use.

Entry via institute code or a link on the institute's own portal. Inherited automatically: institute identity, cohort, exam window, class timetable, default material provider.

Remaining questions, and only these:
1. Your hours outside class, per day
2. Non-negotiables
3. Stage / recency

### 3.1 Inherit, then confirm — never inherit silently

The institute's timetable is a *template*. The student's actual attendance is not. Show the inherited schedule and ask one question:

> Your institute's schedule: Mon/Wed/Fri 18:00–21:00, Sat 10:00–14:00.
> `[ That's right ]  [ I don't attend all of these ]`

Silent inheritance produces a calendar built around classes the student skips, which is a calendar built around fiction.

### 3.2 The dependency we have not scoped

The institute path assumes institutes will hand over machine-readable timetables. Many will not, and many that do will send a PDF or a photograph of a whiteboard. Fallback: the student photographs the timetable and we extract structure — permitted under §2a.2, since a schedule grid is fact, not protected expression. **That is an OCR dependency sitting in Phase 1 that is currently unscoped.** Flagging it now rather than discovering it in October.

### 3.3 Data model consequences, needed from day one

- `institute_id` on `User`, and an `Institute` entity, present in the first migration even with one tenant live (§12a).
- Institute selection is a **real list, not free text** — free text makes cohort rollups impossible and the whole B2B2C value proposition is rollups.
- Class schedules are **institute-owned templates that a student inherits and may override**, not per-student rows. Otherwise a timetable change requires editing every student.
- Under-18 students are in scope here in a way they are not in B2C. DPDP Act consent handling is a Phase-1 item on this path.

---

## 4. Week 1 — where the real profiling happens

### 4.1 Day 1 is the placement diagnostic

**I have reversed my earlier recommendation.** Phase 1 §6 put the placement diagnostic inside onboarding. Under D1 that is wrong — fifteen minutes of testing before the user has seen a single day of the product is expensive friction on a paid funnel. Move it to **day 1 of the trial week, as the first calendar block.**

Shape: 12 questions, and they are chosen by **graph position, not topic representativeness.** Highest-fan-out prerequisite nodes — time value of money, variance and standard deviation, the accounting equation, discounting, expected value. Getting TVM wrong predicts failure across Equity, Fixed Income, Corporate Finance and Derivatives simultaneously. That is the entire reason we built a dependency graph, and it is what lets 12 questions seed priors across 102 modules.

Do not sample proportionally to exam weights. Exam weights tell you what to *study*; graph centrality tells you what to *test first*.

### 4.2 Week 1 is a measurement, not a commitment

Plan to **75%** of stated capacity, not 85%. Week 1 has the highest variance of any week: the user is still forming the habit, has not felt the system's rhythm, and their hour estimate is the least reliable it will ever be. Under-planning and having them finish early builds trust; over-planning and having them fail in week 1 is unrecoverable.

Sequence from **graph roots, not syllabus order.** Every prep provider starts at Ethics because it is Reading 1. We start at whatever unblocks the most downstream modules, and we say so in the block rationale. That difference is visible on day 1, which matters because under D1 the difference has to be legible inside the trial week (§13).

Every block carries a one-line rationale. Not decoration — it is the product being legible. *"TVM first because eleven later modules depend on it."*

### 4.3 The end-of-week diagnostic tests the plan, not the completion

If we only test what the user completed, a user who did 30% of the plan gets a flattering score and no signal. The diagnostic covers **what was planned**, which means gaps show up as gaps. Under D5 this is the accountability mechanism — a consequence rather than a promise — and it is also the paywall moment, because the week-1 read-out is the first thing in the flow that is genuinely unobtainable elsewhere.

Target 20–25 minutes. Long enough to be evidence, short enough that it is always taken. A diagnostic the user skips is not an accountability mechanism.

---

### 4.4 What week 1 can and cannot diagnose

Week 1 is the calibration window, but it does not calibrate both halves of the forecast equally, and promising more than it delivers is a trap.

```
weeks_needed = (remaining_effort × rate) / realised_capacity
                                  ↑              ↑
                         weak read in wk 1   strong read in wk 1
```

| | Convergence | Why |
|---|---|---|
| **Capacity** — hours actually delivered | Near-complete after week 1 | Planned hours are known exactly; delivery is directly observed. "You delivered 8 of the 12 you planned" is defensible after seven days |
| **Rate** — hours per mastered module | Barely started after week 1 | Week 1 yields n≈2–4 verified modules. Against prior weight w=5 the estimate is still 55–70% prior. Meaningful convergence takes ~6 weeks |

**So the week-1 read-out should lead with capacity, not rate.** "You learn 1.6× slower than typical" after four modules is a claim we cannot support and will have to walk back. "You planned 12 hours and delivered 8, and the four hours you lost were all Thursday and Friday evenings" is true, actionable, and lands harder anyway.

If we promise "we'll know your number after week 1" and the number then moves by 4%, we look like we did nothing. Promise the direction, not the destination.

### 4.5 The censoring problem — don't let the plan be the ceiling

Planning at 75% and observing 75% completion teaches us only that capacity is *at least* that. Over-performance is unobservable, so the capacity estimate can only ever be revised **down**. That is a censored measurement and it will bias every forecast downward for users who actually have more time than they claimed.

Fix: **committed blocks plus a pull-forward queue.**

- Week 1 schedules 75% of computed capacity as committed blocks.
- Beyond them sits a visible queue of the next blocks in graph order, unscheduled.
- Finish early, pull the next one in.

Now observed capacity is uncensored — an 11-hour week from a 9-hour plan is visible. It also converts finishing early from dead time into progress, which is the correct reward and costs nothing to build.

### 4.6 Week 1 is the honeymoon — do not lock capacity to it

The counterintuitive risk is not that users underperform in week 1. It is that they **over**perform. Novelty and motivation are at their maximum and life has not yet intruded. Calibrating weeks 5–15 against a honeymoon number systematically over-plans, and over-planning is the failure mode that ends in abandonment.

So: week 1 sets a *working* capacity number, not a locked one. Use a rolling estimate that weights recent weeks, and expect weeks 2–4 to correct week 1 downward on average. Weeks 2–4 are the representative sample; week 1 is the loudest one.

### 4.7 ~~Week 1 must span topics~~ — WRONG, retracted

The original version of this section required week 1 to span two or three topics so that per-topic rate multipliers would have data to split on.

**That is backwards.** Real candidates study in topic blocks — three weeks of Quant, then five of FRA — and so do classes and prep providers. Forcing topic breadth into the study plan so that our estimator gets a nicer sample is optimising the user's schedule for our telemetry. Wrong trade, every time.

**The correct resolution: study is blocked, assessment is interleaved.**

Topic breadth for the estimator comes from assessment, not from block sequencing:

- The **day-1 placement diagnostic** already spans topics by construction, because graph roots sit across Quant, FRA, Equity and Fixed Income.
- **Weekly diagnostics** carry a minority of items from topics studied in earlier blocks — which is spaced retrieval, which we want regardless for decay tracking.

So the topic multipliers get their data from retrieval that we were already scheduling, and the study plan stays blocked.

This is also the pedagogically correct split: blocked practice for acquisition, interleaved retrieval for retention. The structurally convenient answer and the learning-science answer agree again.

### 4.8 Zero completion is its own branch, not a data point

If week 1 completion is at or near zero, do not re-forecast. The model has no signal and forecasting off noise produces a number that is both alarming and meaningless.

Zero completion is a signal about **the plan or the setup**, not about the user's ability. Route it to a short probe with concrete options rather than a verdict:

> You didn't get to any of week 1. That's common, and it's usually the plan, not you. What got in the way?
> `[ Wrong times of day ]  [ Blocks too long ]  [ Didn't have the material ready ]  [ Life ]  [ Lost interest ]`

Each answer maps to a specific week-2 change. This is D3-safe — it names a pattern and adjusts a schedule, it teaches nothing.

### 4.9 Do not call it a calibration week in the UI

Internally week 1 is a measurement. To the user it is week 1 of studying, which happens to end in a read-out.

Framing it as "your calibration week" does two bad things: it gives permission to underperform, which corrupts the very measurement we need; and it makes the paywall at day 7 read as *"pay us so we can finish measuring you."* Under D5 the week-1 diagnostic is the conversion moment — it has to feel like a result, not like the end of setup.

### 4.10 What each onboarding answer sets in week 1

| Onboarding input | What it determines |
|---|---|
| Finance background bucket | Rate prior → block durations and how much content fits in week 1 |
| Declared hours + per-day availability | How many committed blocks, and where they go |
| Class times | Hard exclusions, and placement of low-intensity blocks after long class days |
| Non-negotiables | Hard exclusions, never scheduled over |
| Stage + recency | Ratio of new content to review; how much of the claimed prior counts before the placement diagnostic |
| Material source + mapping precision | Pointer precision inside each block; whether a block can name a page or only an LOS |
| Exam window | Whether triage is already active at week 1, or the plan is unconstrained |
| Timezone | Everything, silently, and wrongly if unconfirmed |

Nothing here requires the graph to be complete. Week 1 is buildable against a partial graph covering the root modules only, which matters for sequencing against the January prototype.

---

## 5. Failure modes to design now, not discover later

| Case | Correct behaviour |
|---|---|
| Exam date in the past, or window closed | Reject at input, suggest the next window |
| Zero available hours (all class) | Do not emit a plan. Say so, and offer the next window |
| Exam in under 4 weeks from a standing start | Hard "not feasible." Offer the next window's plan, and offer the current window as explicit triage-only |
| Declared hours ≫ mapped hours | §1.4 reconciliation, never silent resolution |
| Invalid / expired institute code | Fall through to the B2C path without losing entered answers |
| Abandon mid-flow | Persist partial state to the pre-account session; resume by magic link |
| Unmapped material provider | Coarser pointers, stated plainly. Never fabricate a page number |
| Institute timetable unavailable | Photo upload → structure extraction (§3.2) |

---

## 6. The contract onboarding hands to the planner

Unchanged from Phase 1 §5, with three additions from this pass:

```
UserProfile        { timezone, exam_window, exam_date, registration_status,
                     institute_id?, stage, stage_recency_months? }
TimeBudget         { per_weekday_minutes[7], max_session_minutes, buffer_pct,
                     declared_weekly_hours, computed_weekly_hours,
                     is_hypothesis: true }              ← new: week 2 overwrites this
ClassSchedule[]    { weekday, start_time, duration_minutes, topic_id?,
                     source: 'user' | 'institute_template',
                     confirmed_by_student: boolean }    ← new
NonNegotiable[]    { weekday, start_time, duration_minutes, label }
MaterialMapping    { provider, mapping_precision: 'reading'|'los'|'none',
                     mapped_lm_count, unmapped_lm_ids[] }   ← new: precision, not just count
ModulePrior[]      { lm_id, source: 'placement_diagnostic' | 'observed' }
                     — no self_report field; see §2.6
FeasibilityVerdict { required_hours_low, required_hours_high, available_hours,
                     ratio, state, chosen_resolution }
```

`is_hypothesis` is the flag that makes §1.3 real rather than rhetorical. `mapping_precision` is what stops us fabricating pointers under D3. `confirmed_by_student` is what stops §3.1 from silently building a calendar around fiction.

---

## 7. Build order for this section

1. ISO 8601 weekday constant, replacing the current index-0-is-Monday convention (correctness, 20 min, blocks everything else)
2. Kill the pre-filled onboarding defaults and the 2026 topic names
3. Feasibility engine — required-hours range, available-hours computation, verdict states
4. Tier 0 single-screen pre-account check with the shareable card
5. Declared-vs-computed reconciliation
6. Class times replacing class days; non-negotiables
7. Material source screen with honest precision states
8. State-driven post-auth routing; partial-state persistence
9. Institute path — inherit-and-confirm, `institute_id` in the first migration
10. Day-1 placement diagnostic (depends on graph + item bank)

Items 1–3 are correctness on what exists. 4–8 are the redesign. 9–10 depend on work outside this section.

---

## 8. Resolved, and still open

### Resolved

**D6 — Tier 0 hard-gates.** We gate. A candidate the arithmetic cannot serve does not get a plan for that window, and we say so before they pay. Not gating would mean selling a plan we know cannot work, which contradicts the entire positioning: the product's claim is that it tells the truth about time, and a product that tells the truth about time must be willing to lose the sale.

But **gate the impossible, not the merely infeasible.** These are different populations and collapsing them destroys the triage machinery:

| | Condition | Behaviour |
|---|---|---|
| Infeasible | Short of hours, but ≥ the uncuttable core | Verdict card, three resolutions, triage plan available |
| **Impossible** | Below the uncuttable core, or <4 weeks from a standing start | **No plan for this window.** Next window offered |

The uncuttable core is Ethics + Quant + FRA + Equity + Fixed Income — roughly 65% of the syllabus by weight and effectively all of it by graph centrality. Below `0.65 × 350 ≈ 230` hours there is no honest plan to sell, only a lottery ticket. Above it there is, and §5.7's triage rule is exactly the machinery for saying so.

The gate must fire on **computed** hours, never declared. §1.4 exists because declared hours are systematically wrong, and gating a real user out on a number they mistyped is the worst possible failure of this feature.

**Institute list — out of Phase 1 build scope.** No public dropdown, no curated institute list, no free-text fallback, no review queue. Institute entry in January is by invite code only: the code resolves to an `institutes` row we created by hand for that pilot. The tables and `institute_id` still ship in the first migration (PRD §12a) — retrofitting a tenant column onto live user data is the migration nobody wants. What we are deferring is the *acquisition surface*, not the *data model*.

Worth naming the cost: this means B2B2C has no self-serve entry point at launch, so every institute is a manual onboarding. That is fine at one or two pilots and breaks at five.

**Shareable feasibility card — Phase 3.** Keep the verdict card screenshot-clean, because that costs nothing and a screenshot is a share. Build no share affordance, no OG image, no public verdict URL until Phase 3. The reasoning that argued for early — it is our only near-free CAC — is an argument about acquisition, and D4 already settled that January is a prototype rather than a growth attempt.

Consequence to hold in view: B2C therefore has **no organic acquisition mechanism at launch**. Acceptable for a prototype, and a Phase-3 blocker the moment we want users we did not personally recruit.

**D7 — pointers are precise to the LOS.** Reading number plus LOS, never a page number. `mapping_precision` drops `'page'` from its union entirely; the only degradation path is LOS → reading → none.

This is better than page on three axes, not just effort. Mapping becomes a contents-page job rather than one that requires owning and paginating the books. It survives Schweser's annual re-pagination, so the mapping does not rot every edition. And it is cleaner under PRD §2a.2, because LOS numbering is CFAI's public curriculum outline — fact — whereas a page number is a coordinate into Schweser's protected expression.

The cost is that an LOS pointer is less immediately actionable than a page: the user has to look it up. Mitigation is to always emit reading *and* LOS together, which is still fact rather than expression and lands the user within a few pages regardless.

### Still open

1. **Is the uncuttable core really 65% of scope?** D6's gate threshold currently rests on an exam-weight estimate. It should be recomputed from `lm_edges` centrality once the graph exists, and `HARD_GATE_HOURS` moved with it. Until then it is the softest number in the constants block.
