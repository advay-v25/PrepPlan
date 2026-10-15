# Calendar reset — build status

**Date:** 8 September 2026
**Against:** *Roadmap Calendar System — End-to-End Product Plan* (7 Sep 2026)

This records what is actually built, what is verified, and what is not started.
It is written to be checked, not believed.

---

## 1. Security, resolved before anything else

### 1.1 Answer keys were world-readable

`assessment_items` carried `items_select_all ... using (true)` plus a table-level
grant to `anon` and `authenticated`. Verified against the live database using
nothing but the public URL and the public anon key: **an anonymous client could
read `key_index`, `per_option_feedback`, and `item_card` for every item in the
bank.** No sign-in required.

This is worse than the plan's §2.5 stated — it identified the
`per_option_feedback` "Correct." tell, but the newer `key_index` and `item_card`
columns leaked the key and the full worked solution outright.

It is not a leak of one question. Every diagnostic score becomes meaningless,
and evidence derived from those scores is what the entire product rests on.

Fixed in `20260908_lock_answer_keys.sql`: the policy is dropped and the grant
revoked, for `assessment_items`, `form_items`, `item_validations`, and
`rejected_item_drafts`. Every server read already used the service-role client,
so no application path depended on public access. Re-verified: all four now
return `permission denied` to an anonymous client.

One regression this caused, caught by the calendar test suite: the attempt
endpoint read `form_items` through the *user's* client, so locking it stopped
items being served. It now reads through the service role, after the ownership
check has already passed.

### 1.2 The database password was in source

The production database password appeared verbatim in six files, including
`phase-1-spec.md` in prose. It is not repeated here.
All scrubbed; the helper scripts are quarantined in `scripts/legacy/` and a
shared `scripts/db.cjs` reads credentials from the environment only.

> **This password must still be rotated in the Supabase dashboard.** It has been
> sitting in plaintext in the working tree and must be treated as compromised.
> Scrubbing the files does not undo the exposure.

---

## 2. Phase status

| Phase | State | Notes |
|---|---|---|
| **C0** Contracts and safety | **Mostly done** | Credentials removed, live schema verified, exam-window catalogue built, states defined, deterministic date/timezone tests written. Seeded demo journeys not built. |
| **C1** Real calendar shell | **Done** | Seven-day time grid, agenda view, task drawer, empty state, filters, current-time marker, `/app/calendar` canonical, `/app/week` redirects. |
| **C2** Calendar editing | **Done** | Drag, resize, split, defer, complete, create, delete; recurring commitments with per-occurrence exceptions; conflict refusal with alternatives; optimistic concurrency; full change history. See §8. |
| **C3** Long-term roadmap | **Done** | Full syllabus graph, four phases with the final eight weeks reserved first, milestone ranges, feasibility, and planned-versus-actual. See §9. |
| **C4** Weekly composer | **Not started** | No scope composition, no deviation engine. |
| **C5** Diagnostics ↔ calendar | **Substantially done** | Evidence → proposal → accepted task works end to end, with the end-of-cycle rule. Spacing is fixed rather than evidence-driven. |
| **C6** Coach control layer | **Not started** | |
| **C7** Premium sources | **Not started** | |

---

## 8. C2 — calendar editing

### 8.1 The two decisions that shaped it

**Student edits apply immediately, with undo.** §8.6 of the plan says dragging
changes placement; §8.7 lists "student edits not yet saved" as a state to show.
Direct-apply was chosen: a drag saves at once and a toast offers Undo for ten
seconds. There is no unsaved state to lose by navigating away, and every change
is still recorded, so history is complete either way.

**A drop on a protected commitment is refused, with alternatives.** Not a
warning. §8.6 is explicit that the system does not overlap protected events, and
a class you cannot skip is exactly what a student should not be allowed to
double-book by accident. The refusal names what is in the way, how much it
overlaps, and offers the nearest slots that actually fit — refusing without
saying where it could go would leave the student hunting for a gap.

A clash with another *task* is a different matter: that warns and lets the
student continue, because two study blocks in one slot is their call.

### 8.2 Concurrency — the C2 exit test

`plan_blocks.revision` is incremented by a trigger, and only on a real content
change, so re-writing identical values does not invalidate another session's
read. Every write carries the revision it read, and the guard is in the `WHERE`
clause of the update, not just a pre-check — a write landing in between matches
nothing rather than winning a race.

A refused write returns 409 with the current row, so the client can show what
happened. Verified end to end: two reads at the same revision, first write wins,
second is refused, the losing value never lands, and retrying with the current
revision succeeds.

### 8.3 Recurrence

Deliberately not RFC 5545. A student's recurring commitments are classes, work,
and college: weekly, on named days, between two times. Full RRULE would add a
parser and a dependency to express something none of them need.

Local wall-clock times are stored, so a 6pm class stays at 6pm across a
daylight-saving change instead of drifting an hour.

One-off changes are exceptions against a single date — `skipped` or `moved` —
so "my class is cancelled this week" does not delete the series and "it moved to
Sunday" does not move every future Wednesday. Verified: after a one-off move,
the following week falls on its normal weekday.

### 8.4 Splitting preserves scope

Resizing changes how long a sitting is. Splitting changes how many sittings it
takes. Neither reduces what has to be learned — the two halves always sum to the
original, checked across every duration from 30 to 180 minutes. Reducing scope
is a separate, explicit action, not a side effect of dragging an edge.

### 8.5 Two bugs the browser found that tests did not

**A weekly class rendered once, on the wrong day.** `loadCalendarWeek` predated
recurrence and rendered the series' anchor row rather than expanding it, so a
Monday-and-Wednesday class appeared on the Thursday the series happened to start.

**Blocks snapped back on release.** On pointer-up the visual reverted to the last
server render until `router.refresh()` landed, so a successful move looked like a
failed one for a moment. Placement is now held optimistically until the server
render agrees, and dropped immediately if the move is refused.

A third was found by reasoning about the first: the drag commit read React state,
which is not guaranteed to have re-rendered between pointer events. A fast flick
landing in one batch would have lost the edit. The live gesture value is now
mirrored in a ref.

### 8.6 Keyboard parity

Everything dragging does is also a field in the task drawer — day, start time,
duration — plus explicit buttons for complete, partly done, defer, split, and
remove. The calendar is fully operable without a pointer.

### 8.7 What C2 does not include

- **No multi-task draft review.** The plan's §8.7 diff view is built for
  *system* proposals (the diagnostic repair flow already uses it). A student
  reshuffling several tasks does so one at a time, each applied immediately.
- **No "make this week lighter".** That is scope reduction, which belongs with
  the weekly composer in C4.
- **No cross-device live sync.** Two devices cannot silently overwrite each
  other, but the second one finds out when it writes, not before.

---

## 9. C3 — the long-term roadmap

### 9.1 The curriculum graph

Ten topics with CFA Institute's published Level I weight ranges, 63 modules, 53
dependency edges. Module names and summaries are written in our own words: the
structure is a scope reference for planning, not a reproduction of a publisher's
contents page.

Two properties per module, deliberately separate. **Effort band** (1–5) is
relative size and never claims hours — it says FSA is roughly twice Derivatives
and lets the exam date decide what that means in weeks. **Difficulty** (1–5) is
distinct, because a topic can be short and hard (derivatives pricing) or long
and gentle (alternative investment features).

Edges carry three kinds. `prerequisite` binds sequencing. `reinforces` and
`applied_in` are the linkage the product exists to make visible — that a swap is
a series of forwards, that beta is a regression slope, that free cash flow feeds
valuation.

### 9.2 Pacing without prescribing hours

VISION-CONTEXT D13 rules out prescribed hours, so the model never assigns them.
Relative effort weights are fitted to the weeks actually available, and the only
real-time inputs are **observed**: weekly capacity from availability and
commitments, and minutes-per-effort-unit from work actually completed.

Until both exist the feasibility verdict is `unknown` and says what is missing,
rather than dressing an assumption in a number. Once they exist it becomes a
real answer: comfortable, tight, or not enough time — with the gap quantified
and concrete options attached.

### 9.3 Phases, and the exit test

The final eight weeks are reserved **before** anything else is allocated, so a
drifting first pass cannot eat them.

"Finish the syllabus once in seven months of nine" is a **ceiling, not a
target**. Treating it as a target produced a first pass of 30 weeks out of 31
usable — one week for consolidation and revision, which is not a plan. The
first pass now aims for 65% of the pre-final weeks and is additionally capped by
the seven-month rule.

| Horizon | First pass | Consolidation | Revision | Final |
|---|---|---|---|---|
| 12 months | 29w | 6w | 9w | 8w |
| 9 months | 20w | 4w | 7w | 8w |
| 6 months | 12w | 2w | 4w | 8w |
| 3 months | 3w | 1w | 1w | 8w |
| ≤ 8 weeks | — | — | — | all |

A student arriving inside eight weeks gets a compressed final-preparation
roadmap that says so plainly and offers a way forward, rather than a fictional
curriculum sweep or a refusal.

**Exit test passes**: a nine-month self-study case finishes its first pass 4.6
months in, well inside seven, and nothing is planned into the final eight weeks.

### 9.4 Consolidation and revision are not empty bands

A phase bar showing four phases while only one has content would be a chart
telling a lie. Consolidation revisits the topics with the highest exam weight ×
difficulty, one per week — fewer topics revisited properly beats all ten
skimmed. Revision is a cumulative sweep pairing topics across its weeks, because
by then the exam tests recall across topics rather than one at a time. Neither
adds effort weight: revisiting is not new scope and must not inflate the plan.

### 9.5 Ethics comes first

The first generated plan put Ethics last with two weeks. It is 15–20% of the
exam — the single heaviest topic, and the one that decides borderline results.
It has no prerequisites, so nothing forced it late; it was simply last in the
default teaching order. It now leads the first pass and is revisited in
consolidation.

### 9.6 Planned against actual

Measured in **effort, not module count**: finishing six easy modules is not the
same as three hard ones, and a plan that treats them as equal keeps telling a
student they are fine when they are not.

Expected progress accrues *through* a milestone rather than on entering it. The
first implementation expected all of week one's work on the first morning of
week one, and duly reported a student as a week behind before they had started.

A self-report is stored with its source and can never be `verified`. Only a
diagnostic writes that. Conflating the two is how an app tells someone they know
something because they ticked a box.

### 9.7 What reaches the calendar

Only the near-term milestone. The calendar shows which topic the week is drawing
from and the percentage of the curriculum done, and links back to Curriculum for
the rest. A nine-month plan pushed into a seven-day grid is how a schedule
becomes brittle.

`/app/curriculum` is canonical; `/app/syllabus` redirects.

### 9.8 What C3 does not include

- **Coaching-led sequencing is not built.** The route is captured and stored,
  but class order does not yet anchor the sequence (§7.4). Self-study sequencing
  is what runs today for every route.
- **No re-estimation from actual completion.** The roadmap can be rebuilt from
  current coverage, but it does not yet learn a student's pace and re-fit future
  milestone ranges. That is C4.
- **Milestones do not create tasks.** Curriculum owns the roadmap; the weekly
  composer that turns a milestone into a week's work is C4.

---

## 3. The study week

The plan's "Sunday rule" is implemented as its **general form**, because a rule
that says "Sunday" is wrong for every student whose week ends on another day.

A study week ends on `profiles.diagnostic_day` — the day the student chose to
review and be tested — and begins the day after. `src/lib/planning/studyWeek.ts`
holds the arithmetic; nothing else computes dates.

- The weekly cumulative diagnostic is scheduled on the last day of the week, at
  the student's own check-in time. It is a real calendar task: visible days
  ahead, openable, movable.
- Follow-up work from a diagnostic taken on the last day opens the **next**
  week. Taken mid-week, it lands the following day, inside the same week.
- Never same-day. A student who has just finished a cumulative test does not do
  the repair in the remaining hours.

Verified on a Wednesday-anchored account, not just a Sunday one.

### Timezone correctness

The plan flags that the old planner "treats local clock values as UTC". All
conversion now goes through a two-pass zone-offset resolution, because the
offset depends on the instant and the instant depends on the offset — one pass
is wrong across a DST boundary. Tested against Asia/Kolkata (no DST),
America/New_York (both sides of the November change), Europe/London,
Australia/Sydney, and UTC, including round trips and date-line crossings.

---

## 4. Diagnostics do not write to the calendar

Per §10, Tests emits a result and a proposal request; it never mutates an
accepted week.

- `GET /api/diagnostic/repair?attemptId=…` previews: what would be added, which
  study week it lands in, and why, in plain language.
- `POST` applies it, after the student has seen that preview.
- Applying twice is refused rather than duplicating the set.
- Tasks land as **day-preferred**: the date is known, the hour is not. A
  preference does not become a timestamp.

The previous endpoint wrote `coach_proposals` rows that nothing ever executed —
so a repair never reached a calendar at all — and used `task_type: 'repair'`,
which the `plan_blocks` check constraint would have rejected on insert. Both
fixed; the constraint now carries `repair`, `recheck`, `mock`, and `admin`.

---

## 5. Corrections to the plan's §2.5 audit

Several findings described the build before 7 September and are no longer true.
Stated with what replaced them:

| Audit finding | Now |
|---|---|
| Generator fixed to one FSA calculation pattern, no schema validation | Blueprint-driven across 8 concepts × 7 cognitions × 6 item forms × 4 difficulties, with structural validation before the verifier sees a draft |
| Distractor formulas calculated but results not checked | Checked. Plus unique-key (exactly one option matches), percent/comma/currency parsing, and unit-scale reconciliation |
| Script target is one item, increments before confirming the insert | Target 20; an insert error throws before the item counts as released |
| Fixed module and placeholder concept identifier | Real concept ids from the manifest slice |
| Item selection is a simple database limit | Concept-balanced with per-learner exposure exclusion. Still fixed-form, not adaptive — that part of the finding stands |
| Scoring infers correctness from "Correct." text | `key_index` column, with the text convention kept only as a legacy fallback |
| Confidence sent as low/medium/high into a numeric field | Mapped to 1/3/5 at the API boundary |
| `answered_count` vs `answeredItems` | Fixed |
| Challenge Item not connected | Built, with a reason taxonomy and de-duplication |
| Repair uses a task type not in the contract | Fixed, above |
| No accepted proposal creates a calendar task | Fixed, above |
| Sunday rule not encoded | Encoded as the general end-of-cycle rule |

Findings that **stand**:

- **"Checks internal numerical consistency, not independent curriculum
  correctness."** Correct, and it is the honest limit of the current verifier.
  It derives its own solution from the stem — but the generator wrote the stem.
  A wrong premise survives. The editorial gate checks scope against the manifest,
  which is independent of the draft, but the manifest itself is drafted, not yet
  signed off.
- **"Should not yet be described as a secure sandbox."** Also correct. mathjs is
  hardened by a denylist (`import`, `createUnit`, `evaluate`, `parse`, `simplify`,
  `derivative`, `resolve`) with the real evaluator captured beforehand, and it
  refuses unknown symbols and non-finite results. That is not an allowlist, and
  there is no complexity or execution-time limit. It should be called a
  restricted evaluator, not a sandbox.
- **Item selection is not adaptive.** True.

---

## 6. How to verify any of this

```
npm run verify                   # typecheck + verifier + study-week + placement + roadmap + routes
npm run e2e -- --reset           # 47 checks: the tests tab, end to end
npm run e2e:calendar -- --reset  # 36 checks: calendar and the diagnostic link
npm run e2e:editing -- --reset   # 40 checks: the C2 exit test
npm run e2e:roadmap -- --reset   # 41 checks: the C3 exit test
npm run seed:curriculum          # (re)seed the syllabus graph
```

Current: **430 checks passing**, production build clean, all internal links
resolve to one of 54 routes.

`--reset` clears the test account's own diagnostic history. Exposure control
means a learner never sees an item twice, so without it a suite can only run
once before the bank is used up.

---

## 7. What is deliberately not built

Naming these so they are not mistaken for oversights:

- **There is no weekly composer.** Nothing generates a week's scope; the
  calendar shows what diagnostics and the weekly-diagnostic rule put there.
- **Onboarding is unchanged.** The exam-window catalogue and the four-sitting
  constraint exist in the database, but the onboarding flow does not yet use
  them, still has an upload step, and still collects day-parts rather than
  exact windows.
- **`REVIEWER_EMAILS` is unset**, so any signed-in account can promote items to
  gold.
