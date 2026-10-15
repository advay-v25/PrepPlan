# The effort model — dynamic required-hours

Supersedes the fixed-310 formula in `PHASE-1-onboarding-landing-login.md` §4.

---

## 1. The error in the current formula

```
required = 310 × (1 − 0.55 × coverage_share_self_reported) × stage_multiplier
```

Three things wrong with it, in order of severity:

1. **310 is a population mean presented as a personal fact.** CFA Institute's ~300-hour figure is a self-reported survey mean across a hugely heterogeneous population. A commerce graduate working in equity research and a second-year engineering student who has never seen a balance sheet are both inside that mean. Their real requirements differ by a factor of two to three.
2. **It never learns.** The number computed at onboarding is the number forever. Every input to it is a self-report collected at the moment self-report is least reliable.
3. **It operates at the wrong granularity.** `coverage_share` is a topic-level fudge sitting on top of a system that has a 102-node module graph. The graph already knows exactly which modules are unmastered.

---

## 2. The reframe

Stop estimating *"hours to complete CFA Level 1."* Estimate **this user's hours per mastered module**, and multiply by the modules remaining.

```
required_remaining = Σ  effort_lm × rate_multiplier(user, topic)
                   lm ∈ unmastered
```

Two quantities, and only one of them is personal:

| | What it is | Where it comes from |
|---|---|---|
| `effort_lm` | Intrinsic size of a module. Global, same for everyone. | Authored once (§4) |
| `rate_multiplier` | How this user compares to the reference candidate. | Prior at cold start, learned thereafter (§5) |

All personalisation collapses into one scalar per user (later, one per topic). That is the whole trick — it makes a hard estimation problem tractable, because a single scalar is estimable from very little data.

### 2.1 Separate rate from capacity — they are different failures

Two things independently push a user behind schedule, and conflating them makes the diagnosis useless:

```
weeks_remaining_needed = (remaining_effort × rate_multiplier) / realised_weekly_capacity
                          └─────── numerator ───────┘        └──── denominator ────┘
                             how fast they learn                how much time they give
```

Both are learned from observation. "You are behind" is not actionable. **"You are behind because you delivered 8 of 12 planned hours"** and **"you are behind because FRA is costing you 1.7× baseline"** lead to completely opposite interventions — one is a scheduling problem, the other is a method problem.

The decomposition *is* the product. No free planner produces it because no free planner measures mastery.

---

## 3. Cold start — the background question

At hour zero there is nothing to learn from, so we start from the strongest available predictor. That predictor is prior finance exposure, and it belongs in the Tier 0 pre-account check (`ONBOARDING-brainstorm.md` §1) because it moves the verdict more than any other single input.

> **What's your background with finance?**
> ( ) Working in finance, or CA / CFA resit
> ( ) Finance or commerce degree
> ( ) Other degree, some exposure — internship, self-study, a few courses
> ( ) Other degree, no finance background
> ( ) Still in college, no finance background

| Bucket | Prior multiplier | Prior range |
|---|---|---|
| Finance professional / CA / resit | 0.75 | 0.6 – 1.0 |
| Commerce or finance degree | 1.00 | 0.8 – 1.3 |
| Other degree, some exposure | 1.30 | 1.0 – 1.8 |
| Other degree, none | 1.75 | 1.3 – 2.4 |
| In college, first exposure | 2.20 | 1.6 – 3.1 |

Secondary modifiers, applied on top, small and additive: English as a second language `+0.10` (real effect on FSA and Ethics reading load, and it is a reading-volume effect not an ability effect — worth saying so if we ever surface it); no quantitative background at all `+0.15`.

**Do not include "working full time" here.** That is a capacity variable, not a rate variable. It belongs in `TimeBudget`, and putting it in the multiplier double-counts it.

### 3.1 The base constant must be re-derived, not reused

If the reference bucket is the commerce graduate at 1.00× and we set its base to 310, then a population weighted across the buckets above averages far above 310 — we would have double-counted the mixture that was already inside CFA Institute's survey mean.

**Set the reference base at ~270 hours**, so the population-weighted average across our own buckets lands near 310–340. Concretely: `Σ effort_lm` over all 102 modules should total ≈ 270 for a first-time candidate at 1.00×.

Getting this wrong in the obvious direction inflates every quoted number by ~15%, which reads as scaremongering.

### 3.2 Global bounds: 350 – 1000 hours

The full-syllabus estimate is clamped to **[350, 1000]** regardless of what the multiplier produces.

**Where the bounds bite.** With base 270:

| Bucket | Raw | After clamp |
|---|---|---|
| Finance professional / CA / resit (0.75×) | 202 | **350** — floor binds |
| Commerce or finance degree (1.00×) | 270 | **350** — floor binds |
| Other degree, some exposure (1.30×) | 351 | 351 |
| Other degree, none (1.75×) | 473 | 473 |
| In college, first exposure (2.20×) | 594 | 594 |
| Worst case at the top of the prior range (3.1×) | 837 | 837 |

So the floor binds for the two strongest buckets, and the ceiling almost never binds from the prior alone — it binds when *learned* rates push a weak-start user past it around week 4–6.

**The floor binding for strong candidates is deliberate, not a bug.** Telling a CA "you need 200 hours," having them believe it, and having them fail is the single worst outcome available to us. Under-quoting is the asymmetric risk: over-quote and the user finishes early and trusts us, under-quote and the user fails and blames us. 350 is the number below which we decline to be optimistic on someone's behalf.

**Cost of the floor, stated honestly:** every user sees a low end of 350 at onboarding, so all the personalisation is carried by the *upper* bound. A finance professional sees 350–420; a first-exposure student sees 350–860. The discrimination is real but asymmetric. Acceptable, and it errs in the safe direction.

### 3.3 The clamp applies to the estimate, not to the scheduler — and the difference must go somewhere real

This is the part that breaks if implemented naively.

If the honest module sum is 202 and we quote 350, we cannot hand 350 to the scheduler and let it inflate every block by 73% — that produces a calendar full of padded blocks the user finishes in half the time, which teaches them to distrust every duration we give them.

Nor can we quote 350 and plan 202, because then the headline contradicts the calendar.

**Resolution: the surplus is real work, but it is not new content.**

| Bound hit | What happens to the difference |
|---|---|
| **Floor (est < 350)** | The extra hours go to **review and verification density** — more spaced re-tests, more re-verification passes, more applied items on high-weight topics. Not longer blocks on the same material. This is what a strong candidate should do with spare capacity anyway, so the plan stays honest. |
| **Ceiling (est > 1000)** | Scope is **removed explicitly**, never silently. Hitting the ceiling forces the triage conversation (§7): depth dropped on low-exam-weight, low-fan-out topics, named to the user, with their consent. |

Symmetric: the floor adds verification, the ceiling subtracts scope, and both are visible rather than absorbed.

### 3.4 The ceiling is a verdict, not a display cap

1000 hours over a 21-week window is 48 hours a week. Over 30 weeks it is 33. Nobody is doing either alongside a job or a degree.

So an estimate reaching the ceiling is never *just* a number to display — **it is a "wrong window" verdict, and it must trigger the feasibility conversation rather than quietly showing 1000.** If we clamp and display without acting, we have hidden the one fact the user most needs.

Same logic in reverse at the floor: a user whose raw estimate sits well below 350 should be told *"you're starting ahead of a typical candidate"* alongside the 350, rather than being shown a suspiciously round number with no explanation.

### 3.5 The bounds are on the full-syllabus figure only

`required_remaining` is uncapped below. A user in week 15 with four modules left should see the true remaining figure — 40 hours, not 350. The clamp exists to stop us mis-stating *the size of the exam*, not to stop the number shrinking as they earn it.

Concretely, the floor releases as mastery is verified. A resitter arrives with unknown retention, so at onboarding they have zero *verified* modules and correctly see 350; the placement diagnostic then converts self-belief into measured mastery and the number drops for a reason they can see. That is a better first week than quoting them 200 on day zero and being wrong.

---

## 4. Authoring `effort_lm`

102 numbers. It does not need to be precise, it needs to be *relatively* right — the model only ever uses ratios between modules.

Cheap defensible seed, buildable in an afternoon:

```
effort_lm = base_unit × los_count_lm × difficulty_weight_topic
```

LOS counts per module are published facts. `difficulty_weight_topic` is a small hand-authored table (Derivatives and FRA high, Ethics and Alternatives lower per-LOS) with values in roughly 0.7–1.4. Normalise `base_unit` so the total hits 270.

Then correct from aggregate data once there are users: a module where the *median* user across all rate buckets consistently overruns is a module whose `effort_lm` is wrong, not a module everyone is bad at. That correction only becomes available at scale, which is fine — it is a compounding data asset and worth noting as one.

---

## 5. Learning the multiplier

### 5.1 What actually counts as evidence

Ranked by trustworthiness, which is nearly the inverse of how easy each is to collect:

| Signal | Weight | Why |
|---|---|---|
| **Diagnostic score on a module vs. planned hours spent on it** | High | The only signal where the outcome is measured rather than claimed |
| **Number of re-verification passes before a module holds** | High | Directly observable, hard to game |
| **Placement diagnostic on graph roots (day 1)** | High, and earliest | Available before any study hours exist |
| **Block completion rate** | Low | Measures compliance, not learning |
| **Self-reported time spent** | Zero | Not used. See below |

**Do not use self-reported actual time as a model input.** It is dirty in both directions — users forget to mark blocks, mark them done without doing them, and misremember duration. Use **planned** hours, which are known exactly, gated by the completion signal. The formulation that survives contact with real data is:

```
observed_ratio_lm = planned_hours_consumed_before_verification(lm) / effort_lm
```

If a module took two planned blocks plus one re-verification block to reach `verified`, and `effort_lm` said one block, the ratio is ~3.0. Nothing about that requires trusting a stopwatch.

### 5.2 The estimator

Naive `observed / baseline` after two modules is violently noisy — one bad week and we tell someone they need 900 hours. Shrink toward the prior:

```
rate_multiplier = ( w × prior_multiplier + Σ clamp(observed_ratio_i, 0.4, 3.0) )
                  / ( w + n )

w = 5        prior weight — data reaches parity at 5 verified modules, dominates by ~20
clamp        one catastrophic module cannot move the estimate more than one good one
```

This is a shrinkage mean with a conjugate-style prior. Cheap to compute, trivial to explain to a user, and it degrades gracefully — with `n = 0` it returns the prior exactly, which is what onboarding needs.

### 5.3 Per-topic multipliers

A commerce graduate may run 0.7× on FRA and 1.6× on Quant. An engineer, the reverse. One global scalar averages away the most useful thing we know.

Same function, applied twice:

```
global_multiplier = shrink(all observed ratios,      prior_from_background, w=5)
topic_multiplier  = shrink(observed ratios in topic, global_multiplier,     w=3)
```

The topic level shrinks toward the user's own global rate rather than toward the population prior — that is what makes it stable on three observations instead of needing thirty.

**Do not surface a topic multiplier to the user below n = 3 in that topic.** Internally it is fine (it is mostly the global value anyway); shown to a user it reads as a confident claim built on one bad Tuesday.

Once it *is* stable, `"you're running 1.5× on FRA and 0.8× on Quant"` is a genuinely sellable output and a thing no competitor produces.

### 5.4 The confound worth naming

A user at 1.8× is either learning slowly or studying badly — same number, opposite interventions. Partial separation: if diagnostic score per completed block is low **and** retention across spaced re-tests is normal, that is a rate story; if retention is also poor, that is an attention/method story.

Probably too subtle to automate in v1. Better handled as a coach probe than as a model inference — one question beats a guess, and the coach asking it is exactly the kind of thing D3 permits (it names a pattern, it does not teach).

### 5.4a Capacity and rate converge at very different speeds

Worth stating separately because it constrains what week 1 is allowed to claim.

| | n after week 1 | State of the estimate |
|---|---|---|
| **Realised capacity** (denominator) | 1 full week | Near-complete. Planned hours are exact, delivery is observed |
| **Rate multiplier** (numerator) | 2–4 verified modules | Still 55–70% prior at w=5. Converges around week 6 |

Consequence: the week-1 read-out leads with capacity. Rate claims wait until n≥8, roughly week 3, and topic-level rate claims until n≥3 in that topic (§5.3).

Second consequence: capacity should be a **rolling** estimate, not locked after week 1. Week 1 is the honeymoon week and over-states capacity for most users — see `ONBOARDING-brainstorm.md` §4.6.

### 5.5 Selection effect to avoid

Computing hours-to-mastery only over modules that required re-verification inflates the multiplier, because those are by definition the failures. **Compute over every attempted module**, including the ones that verified first pass at below baseline.

---

## 6. Presentation — where this goes wrong

The estimate moving is honest. The estimate *jumping* destroys trust. Show 280 on Monday and 410 on Friday and the user concludes we were guessing — correctly, but fatally.

### 6.1 A range that narrows, never a point that jumps

Example: first-exposure college student, 2.20× prior.

| | Estimate shown | Width |
|---|---|---|
| Onboarding (n=0) | **430 – 780 hours** | prior range, wide and honest |
| End of week 1 (n≈2) | 480 – 700 | |
| End of week 3 (n≈7) | 540 – 640 | |
| End of week 6 (n≈15) | 575 – 610 | |

Same user, strong-start case (commerce graduate, 1.00×): onboarding shows **350 – 420**, floor-bound at the low end per §3.2, narrowing to something like 355 – 380 by week 6.

Both bounds stay live throughout — a learned rate that pushes the upper figure past 1000 triggers §3.4 rather than being clamped and shown.

Convergence is visually reassuring *and* it is literally what is happening. It also sets the correct expectation on day one: we are telling you we do not know yet, and telling you when we will.

### 6.2 Never revise silently, always attribute

> Your estimate moved from 340 to 390 hours.
> FRA is taking you about 1.6× longer than typical — Quant is running slightly faster than expected.
> We've moved two FRA modules earlier and pulled one Derivatives block back to week 9.

Every revision names its cause and shows its consequence. A number that moves with a reason is the product working. A number that moves without one is a bug.

### 6.3 Revise weekly, not continuously

Re-forecast at the weekly diagnostic (D5) and nowhere else. Continuous re-forecasting produces anxiety and noise, and it means bad news can arrive at 11pm on a Wednesday. Once a week, at a moment the user is already braced for, attached to evidence they just generated.

---

## 7. Second-order consequence: feasibility becomes a recurring verdict

This is the part most likely to be missed.

If required-hours is dynamic, **feasibility is dynamic**. A user who was feasible at onboarding can become infeasible in week 4. The one-time gate in `ONBOARDING-brainstorm.md` §1.5 has to become a standing evaluation.

Which is good, because it is exactly the thing the institute channel buys (PRD §16.1 — *"a student who stops completing blocks in week 3 is a student who drops in week 7"*). Same three resolutions as onboarding, delivered mid-flight and early:

> Week 4. At your current rate and delivered hours, you finish 6 weeks after the exam.
> `[ Move to the May window ]  [ Find 4 more hours a week — here's where ]  [ Triage: drop depth on Derivatives and Alternatives ]`

Rules that keep this from becoming a nag:

- Only at the weekly diagnostic.
- Only when the projected overrun exceeds a threshold *and* has persisted two consecutive weeks — one bad week is noise.
- Always with the decomposition (§2.1): rate problem or capacity problem, never just "behind."
- The triage option must be computed from exam weight × graph centrality, not from what is left over.

---

## 8. What changes elsewhere

| Document | Change |
|---|---|
| `PHASE-1` §4 formula | Replaced by §2 here |
| `PHASE-1` §4/§5 `FeasibilityVerdict` | `required_hours` → `required_hours_low` / `required_hours_high` / `rate_multiplier` / `n_observations` |
| `ONBOARDING-brainstorm.md` §1 Tier 0 | Fourth question: finance background. Still one screen |
| `ONBOARDING-brainstorm.md` §1.6 | The range is now derived from the prior bucket, not hand-waved |
| PRD §12a "not negotiable" list | `effort_lm` authoring joins the graph and the item bank as prototype-blocking |
| Schema | `user_rate_estimate` table: `(user_id, topic_id nullable, multiplier, n_obs, updated_at)`; `learning_modules.effort_units` |
| Constants | `REQUIRED_HOURS_FLOOR = 350`, `REQUIRED_HOURS_CEILING = 1000`, named and single-sourced — these appear in the verdict, the scheduler's surplus allocation, and the triage trigger, and must not drift between them |

---

## 9. Open

1. **Does the background question hurt Tier 0 conversion?** It is a fourth field on a screen designed for three, and it asks something mildly status-loaded. Testable, but not before we have traffic.
2. **How wide is too wide at n=0?** "430–780 hours" is honest and may read as useless. The alternative — a point estimate with a caveat — is dishonest but converts better. I lean honest, because the whole positioning rests on being the product that tells the truth about time.
3. **What is the overrun threshold in §7** before we surface a feasibility warning? Too tight and it fires constantly in week 2; too loose and the early-warning value that institutes buy evaporates.
4. **`effort_lm` correction at scale** — worth building the telemetry for now even though the correction is unusable until there are hundreds of users, because retrofitting the logging later means throwing away the first cohort's data.
