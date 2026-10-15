# Onboarding v2 — context capture, not qualification

Supersedes §5–§7 and §12.5 of `PHASE-1-FINAL.md`. Reverses D6. Everything else in that document stands.

---

## 1. What changed and why

Three principles now govern onboarding. Each of them invalidates something previously specified.

**P1 — We never deny access.** The hard gate is deleted. `/onboarding/blocked` is deleted. A candidate with three weeks and forty hours gets an account, a plan, and a week. Reversal of D6, recorded as **D12** below.

**P2 — We do not set the hour target.** We do not tell anyone they need 300 hours. The user declares when they are available; we fit content to that; we measure their actual rate and re-fit. Required effort becomes a derived, updating projection — never an input, never a demand.

**P3 — We commit one week at a time.** Onboarding does not produce a six-month plan. It produces enough context to build week 1, and a projection that redraws every week.

### Where these three principles are incomplete

Stating them as written leaves three holes. Each is closed by a rule, not by softening the principle.

**P1 does not mean we hide the arithmetic.** Access is unconditional; so is honesty. If someone has 40 hours available against a syllabus that typically takes 250–300, blocking them is wrong and reassuring them is worse — we would be selling a plan we know is a lie, and they discover it in February. The rule: *never block the door, never soften the number.* Show what the math says, show what a prioritised plan actually covers, let them start. This converts the gate from a wall into the product's most differentiating screen — every competitor tells them "you've got this."

**P2 does not mean we stop estimating.** If we have no estimate of how long a Learning Module takes, we cannot decide whether three or seven of them go into this week, and the plan degenerates into an undifferentiated list. The distinction that matters:

| Operation | Verdict |
| --- | --- |
| Prescribing a target ("you need 300 hours") | Deleted |
| Estimating LM effort to size and order a week | Required — nothing works without it |
| Reporting a projection ("at your pace, Quant finishes ~14 Nov") | Kept, shown as a range, updated weekly |

The 3-months-to-12-months spread is an argument for *more* per-user measurement, not less. High population variance is precisely what makes a population prior useless and a personal rate estimate essential. So: weak prior, fast convergence, always a range.

**P3 needs a horizon or the user is blind.** Committing six months of blocks is a fiction. But showing only the next seven days makes the one question every candidate has — *am I going to make it?* — unanswerable inside the product, and they will go build a spreadsheet. Two artifacts, two different contracts:

| Artifact | Granularity | Contract |
| --- | --- | --- |
| **The week** | Blocks, times, specific LMs | Committed. This is what you do. |
| **The horizon** | Topic order, estimated finish dates | Projection. Redraws every week. Never a promise. |

---

## 2. The filter for what onboarding asks

> **Does this answer change what goes into the next seven days? If no, do not ask it at onboarding.**

Everything else is captured progressively, inside the app, at the moment it becomes relevant. This resolves the tension between "maximum context" and "a funnel that does not leak" — we get maximum context *eventually*, and minimum friction *now*.

Applied to the current build and to everything previously specified:

| Question | Changes week 1? | Verdict |
| --- | --- | --- |
| Exam sitting / date | Yes — sets horizon and urgency | Ask |
| When in the week you are free | Yes — places blocks at real times | Ask |
| Fixed commitments (class, work) | Yes — blocks collide otherwise | Ask |
| Previous CFA L1 attempt | Yes — strongest single rate signal | Ask |
| Materials owned | Yes — determines whether pointers resolve at all | Ask |
| Coaching institute | Yes — overrides topic order | Ask (invite code only, per D9) |
| Weekly diagnostic day | Yes — it is the week's fixed point | Ask |
| What usually breaks your plan | Yes — selects the first intervention | Ask |
| Module-level self-report grid | No | Cut (already cut in §7.5) |
| Confidence / test-anxiety radio | No | **Cut — currently built** |
| Whole days you cannot study | No — wrong granularity, superseded by the availability grid | **Cut — currently built** |
| Target score | No | Cut |
| Why you are taking CFA | No | Cut |
| Learning style | No | Cut — and it is not a real construct |

Two of the three screens in the current build fail this filter.

---

## 3. What is broken in the current build

Read from `src/components/onboarding/OnboardingFlow.tsx`, `src/app/onboarding/page.tsx`, `src/app/api/onboarding/route.ts`.

**3.1 — Infinite redirect loop, launch-blocking.** `/onboarding/page.tsx` redirects to `/` when the `roadmap_tier0_nonce` cookie is absent. `/` redirects an authenticated user to `/app`. `/app` redirects to `/onboarding` when `onboarding_status !== 'complete'`. A user who signs up directly, or whose cookie is lost, ping-pongs forever with no way out. Magic-link confirmation in a different browser is the *common* path on mobile, so this is not an edge case. **Tier 0 must be optional input to onboarding, never a precondition for it.**

**3.2 — Availability is never collected.** The flow asks for days the user *cannot* study and never asks when they *can*. There is no capacity input anywhere in the system, so there is nothing to schedule against. This is the single largest gap.

**3.3 — Day granularity is the wrong unit.** "Days you absolutely cannot study" cannot express "Tuesday and Thursday evenings I have class, but mornings are free" — which is the actual shape of a working candidate's week. Blocking the whole day loses real capacity; not blocking it schedules into a class.

**3.4 — The self-report grid is still there.** Screen 2 asks which of ten topics the user knows well. §7.5 cut this: it is a prior we discount by 45%, and the placement diagnostic produces better priors from twelve questions.

**3.5 — Topic names are the 2025 curriculum.** `Corporate Issuers`, `Equity Investments`, `Portfolio Management`. The 2027 names are `Corporate Finance`, `Equities`, `Portfolio Construction`. Since the grid is being cut this matters less, but the same stale list appears elsewhere.

**3.6 — The confidence screen is a personality quiz.** "How do you usually feel during standardized tests" produces a value that no scheduler branch reads. It is also the gate on the submit button (`disabled={!confidence}`), so the least useful question is the only mandatory one.

**3.7 — Tier 0 answers are fetched and then thrown away.** `page.tsx` reads the draft and passes it to the component; the component only reads `tier0Answers.notRegistered` and posts the blob back. The user never sees what they said on the landing page and cannot correct it. This is defect §1.3, still live.

**3.8 — Everything lands in one JSON blob.** `onboarding_sessions.answers` holds the whole payload. Nothing is queryable, so the scheduler would have to parse JSON to find availability, and no other page can read a single field cheaply.

**3.9 — No resume.** `profiles.onboarding_step` exists and is only ever written as `3` at the end. Close the tab at screen 2 and you restart.

**3.10 — The progress bar renders wrong.** `.onboarding-progress` is `grid-template-columns: repeat(4, 1fr)` in `styles.css`; the component renders three pills. The fourth column stays empty, so the bar visibly under-fills at 100% completion.

**3.11 — The CSS describes a flow that was never built.** `styles.css` carries `.mode-grid`, `.sitting-grid`, `.stage-grid`, `.material-options`, `.file-drop`, `.upload-analysis`, `.analysis-result`, `.review-list`, `.timezone-field`, `.algorithm-load-note` — none referenced by any component. The design intent was substantially richer than what shipped.

**3.12 — "Generate Plan" is the wrong promise.** Under P3 the button builds a week, not a plan. The label sets an expectation the product deliberately does not meet.

---

## 4. The flow

Five screens. Target: under four minutes. Progress is saved on every screen advance.

### Screen 1 — Your exam

- **Sitting** — Feb / May / Aug / Nov 2027, as cards (`.sitting-grid`). If Tier 0 supplied one, it is pre-selected and labelled as carried over.
- **Registered?** — yes / not yet. Not a filter. It sets horizon confidence, and an unregistered user gets a nudge in-app later.
- **Exact date** — only if registered; otherwise we use the window's midpoint and refine later.

Writes `profiles.exam_sitting`, `non_negotiables(type='exam_date')`.

### Screen 2 — Your week

The screen that does not currently exist and that everything downstream depends on.

**The availability grid.** Seven columns × three rows (morning / afternoon / evening). Tap to mark a slot as realistically available. Not a number — a shape. People systematically over-promise when asked "how many hours per week," and a grid is answered from memory of an actual week rather than from aspiration.

```
        Mon  Tue  Wed  Thu  Fri  Sat  Sun
Morning  ·    ·    ·    ·    ·    ●    ●
Afternoon·    ·    ·    ·    ·    ●    ·
Evening  ●    ●    ●    ●    ·    ·    ●
```

Below the grid, live and non-judgmental: **"9 slots — roughly 13–18 hours a week."** A range, because slot length varies. No target to compare it against. No red text.

**The honesty discount.** One question underneath: *"In a normal week, how many of these do you actually use?"* → `nearly all` / `most of them` / `about half` / `it varies a lot`. This seeds `capacity_factor` (1.0 / 0.85 / 0.6 / 0.5), the denominator of the effort model. It converges fast from real data, so a rough start is fine — and asking it explicitly is far better than discovering in week 3 that we planned to a fiction.

**Fixed commitments.** Add rows: type (class / work / travel / other), day, start, end. This is where class schedules live, at slot granularity — replacing the blocked-days selector. Institute classes entered here also drive the topic-order override.

Writes `availability_rules` (structured rows, one per slot), `class_schedules`, `profiles.capacity_factor`.

### Screen 3 — Where you're starting

- **Have you sat CFA L1 before?** — never / once / twice or more. The strongest single predictor of rate, and honestly answered because there is no penalty attached.
- **Background** — multi-select chips, no wrong answers: finance or accounting degree · work in finance · comfortable with maths and stats · studied in English · none of these. Each maps to a small rate multiplier and, more importantly, to *which* bridge blocks get injected.
- **Materials you have** — Schweser 2027 · CFA Institute curriculum · coaching institute material · nothing yet (`.material-options`). Determines whether LOS pointers resolve to anything the user can open. "Nothing yet" is a valid answer and produces material-agnostic pointers.
- **Studying with a coaching institute?** — invite code field, optional (D9: no institute directory in Phase 1).

Writes `profiles.prior_attempts`, `profiles.background[]`, `user_materials`, `profiles.institute_id`.

### Screen 4 — How we keep you honest

The accountability contract. Currently absent entirely, and it is the product's differentiator (D5).

- **Weekly diagnostic day** — pick one. Framed as the week's fixed point, not homework: *"Every week, on this day, a short test. It's how we find out what actually stuck — and it's the only way the plan stays honest."*
- **Reminder time and channel.**
- **What usually breaks your study plan?** — single select: *I fall behind and can't catch up* · *I study but don't retain it* · *I avoid the topics I find hard* · *I can't tell if I'm actually ready*. This selects which intervention the coach leads with, and it is the only "how do you feel" question that changes product behaviour. It replaces the confidence radio.

Writes `profiles.diagnostic_day`, `profiles.reminder_*`, `profiles.failure_mode`.

### Screen 5 — Check this

Every answer, grouped, each with an inline edit control (`.review-list`). **Tier 0 answers appear here as ordinary editable rows** — visible and correctable, closing §3.7 and defect §1.3.

Below the list, the honest read — always shown, never blocking:

> Your week has about 14 hours in it, and 21 weeks to your sitting. That is on the tight side of what candidates typically use for a first pass. We will lead with the highest-weight material and tell you every week exactly where you stand.

Three registers, chosen by the arithmetic, all ending in the same button:

| Situation | Read |
| --- | --- |
| Comfortable | "You have room. We'll use some of it for review rather than pushing ahead." |
| Tight | As above — lead with weight, report weekly. |
| Very tight | "This is less time than a full first pass usually takes. We'll cover the highest-weight material properly rather than covering everything thinly, and we'll show you what's being left out." |

Button: **Build my first week.** Never "Generate plan."

---

## 5. Progressive capture

Everything cut from onboarding is still collected — later, in context, where the answer is cheap and more accurate.

| Context | Captured | Replaces |
| --- | --- | --- |
| First block completed | Actual vs. planned duration | Any self-reported pace estimate |
| Day 1–3, offered not forced | 12-question placement diagnostic | The module self-report grid |
| Block marked skipped | One-tap reason (no time / too hard / not in the mood / did something else) | Nothing — this is new, and it is the real capacity signal |
| End of week 1 | "Was that about right?" — three options | The honesty discount, now measured |
| First time a topic is scheduled | Materials check for that topic only | The full materials audit |
| After each diagnostic | Measured mastery | All self-reported knowledge |

The principle: **onboarding buys the right to start; the product earns the rest.**

---

## 6. What onboarding hands to the scheduler

```ts
type OnboardingOutput = {
  horizon:      { sitting: string; exam_date: string; weeks_remaining: number; registered: boolean }
  capacity:     { slots: Slot[]; hours_low: number; hours_high: number; capacity_factor: number }
  commitments:  Commitment[]        // class | work | travel | other, recurring
  rate_prior:   { prior_attempts: 0|1|2; background: string[]; multiplier: number }  // weak, wide
  materials:    { provider: string[]; pointers_resolve: boolean }
  contract:     { diagnostic_day: number; reminder_at: string; failure_mode: string }
  institute:    { id: string | null }
}
```

`rate_prior.multiplier` carries a deliberately wide interval. It is a starting guess that the first two weeks overwrite. Nothing in this object is a commitment to the user about total hours.

---

## 7. Data model changes

```sql
alter table profiles
  add column exam_sitting text,
  add column registered boolean default false,
  add column capacity_factor numeric default 0.85,
  add column prior_attempts int default 0,
  add column background text[] default '{}',
  add column diagnostic_day int,          -- ISO 1..7
  add column reminder_at time,
  add column failure_mode text,
  add column institute_id uuid references institutes(id);

-- availability at slot granularity, replacing blocked-day rows
create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),   -- ISO
  slot text not null check (slot in ('morning','afternoon','evening')),
  available boolean not null default true
);

-- resume support
alter table onboarding_sessions
  add column current_screen int default 1,
  add column partial jsonb default '{}'::jsonb;
```

`non_negotiables(type='blocked_day')` is no longer written. Existing rows migrate to three `availability_rules` rows each, all `available = false`.

---

## 8. Route changes

| Route | Change |
| --- | --- |
| `/onboarding` | Tier 0 nonce becomes optional. Missing nonce → start at screen 1 with nothing pre-filled. **Never redirects to `/`.** |
| `/onboarding/blocked` | Deleted (D12). |
| `/onboarding/plan` | Renamed in intent: builds week 1, not a horizon plan. |
| `/check/result` | The `impossible` branch is deleted. Every path leads to signup. |
| `middleware.ts` | The `no_plan` state redirects to `/onboarding/plan`; there is no longer a gated state to exempt. |

---

## 9. Decisions

**D12 — supersedes D6.** No hard gate, ever. Any candidate, any timeline, gets an account and a plan. The feasibility arithmetic is still computed and still shown verbatim; it informs, it never blocks. *Reason: gating is a product decision disguised as a safety feature. Our job is to help someone use the time they have, not to rule on whether they deserve to try.*

**D13.** We do not prescribe an hours target. Effort estimation continues internally for sizing and ordering; user-facing output is a projection with a range, updated weekly, never a demand.

**D14.** Onboarding commits one week. The horizon exists as a redrawing projection, explicitly labelled as such.

**D15.** Onboarding asks only what changes the next seven days. Everything else moves to progressive capture.

### Open

1. Slot length — fixed 90 min, or learned per user from actual block durations? Leaning learned, seeded at 90.
2. Does the placement diagnostic get offered *during* onboarding as an optional sixth screen, or only inside week 1? Currently week 1, to protect the funnel.
3. `capacity_factor` starts at 0.85 by default — confirm against real data once week-1 telemetry exists.
