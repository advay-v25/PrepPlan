# Pulse — the adaptive calendar engine

**Status:** draft, revised after founder review — see §0.1
**Revision note:** an independent audit of the first draft proposed a
stricter "persist only the accepted week, every change goes through a
visible proposal" model. Adopted in part: the whole week is now persisted
(§3), not just today — that part of the audit was right, and it lets Phase 1
reuse the existing `plan_drafts`/`planning_cycles` infrastructure instead of
deleting it. Its stricter automation rule was **not** adopted: small
deviations still redistribute automatically, per the founder's explicit
choice both times it was asked. Week boundaries stay derived from class
schedule, not a chosen onboarding question — also reconfirmed directly.
**Supersedes:** `src/lib/planning/composer.ts`, `generateAndCommitWeek`, the deleted `ensureWeeklyDiagnostic`, and the onboarding "which day closes your week" question.

## 0. Why this exists

Audited before writing this: **`/api/plan` — the only thing that ever generated
study work — has zero callers in the current UI.** Combined with
`ensureWeeklyDiagnostic` having been deleted from `schedule.ts` entirely, a
real student today gets no automatically-scheduled study work at all — only
what they add by hand, plus repair tasks that only appear *after* they've
already taken a diagnostic. The Calendar's own empty state claims "it will
place work around them," and nothing does.

Separately, three real bugs sit under the surface:

- `weeklyCapacityMinutes()` sizes capacity from `availability_rules.max_session_minutes`
  (capped at 180), never from the real `start_time`/`end_time` range onboarding
  captures. A 7–9am slot and a 7–7:15am slot count as identical capacity.
- `task_events.actual_duration_minutes` — the column the "adapt from what
  actually happened" requirement depends on — exists in the schema and the
  write path already accepts it, but nothing in the UI ever populates it.
- `composer.ts` generates a fixed 75/25 study/review split per module,
  ignoring the roadmap's own phases (first_pass/consolidation/revision/final),
  never schedules a mock, and the `class_consolidation` task type is declared
  in its own type union and never produced.

This spec replaces all of it with one adaptive engine. The whole week is
persisted as real, visible rows once generated — a student needs to be able
to trust what tomorrow says without it silently rewriting itself just because
they reopened the page. Adaptation happens through a bounded, explicit
redistribution operation (§3.2), not by refusing to commit to anything beyond
today.

## 1. Terminology: Pulse

"Anchor" meant fixed commitments (class, work) in the founder's vocabulary —
colliding with the codebase's existing `anchorDay`/`diagnostic_day`, which
meant something unrelated (the chosen day the study week ends). That gets
renamed and changes meaning:

**Pulse day** — the last day of the study week: the day the cumulative
review sits, and the day the following week's envelope gets computed from
what actually happened. No longer chosen at onboarding. Derived:

| Student has real class commitments (instructor_led / hybrid) | Pulse week |
|---|---|
| Yes | Runs from the earliest weekday among their recurring classes through the day before it recurs. Classes Tue/Thu → week is Tue–Mon, pulse day = Mon. |
| No (self_study / self_paced_course) | Fixed Monday–Sunday, pulse day = Sunday. |

`profiles.diagnostic_day` stops being read for week-boundary purposes (left
in place, unused, not migrated away — reading it at all for this purpose is
the bug being removed). Onboarding's S5 "which day closes your study week?"
question is deleted; S5 keeps the reminder-time and failure-mode questions.
Settings' equivalent field is removed the same way. A new pure function,
`resolvePulseWeek(commitments, timezone, reference)` in `studyWeek.ts`,
replaces `resolveStudyWeek`'s anchor-day parameter with this derivation.

## 2. The weekly envelope

Once a week's boundaries are known, the engine computes one coarse figure
before touching individual days: **how much new/review work this week should
carry**, in the roadmap's existing relative effort-units (never hours,
consistent with `roadmap.ts`'s own rule 3).

```
weeklyEnvelope =
  phaseRelevantRemainingEffort ÷ max(1, usableWeeksRemainingInPhase)
  × pacingFactor(rollingCompletionRate)
```

- `phaseRelevantRemainingEffort ÷ usableWeeksRemainingInPhase` first — dividing
  the whole remaining phase across the weeks actually left in it, not
  multiplying one week's slice by a factor and hoping it lands right. (An
  earlier draft of this formula multiplied remaining effort by a pacing
  factor directly, which is dimensionally wrong — it sizes one week as if it
  might absorb the entire remaining phase.)
- `pacingFactor` is then a bounded adjustment on top of that even split —
  still the adaptive part, still reading last week's actuals, never a
  prescribed hour target:
  - ≥ 90% completed → factor **1.15**
  - 60–90% → factor **1.0**
  - 30–60% → factor **0.75**
  - < 30%, or fewer than 2 prior weeks to observe → factor **0.6**
  - Computed from a **rolling window of the last 3 closed weeks** where
    available (not just the immediately prior one), so one unusual week —
    good or bad — can't swing the number on its own; falls back to the single
    prior week, then the conservative floor, as history is thinner.
- Repair-thread backlog (open `repair_threads`, and `evidence_state IN
  ('needs_repair','unstable')`) is **added on top of**, not counted against,
  the envelope — struggling work is never what gets crowded out by pacing.

## 3. Daily portions — persisted for the whole week, redistributed in place

The whole week is generated and written as real `plan_blocks` rows in one
pass — not just today. A student can look at Thursday on Monday and trust
it's real, not a guess that might repaint itself the next time they open the
page. Generation happens explicitly (§3.3 triggers), not on every page
render.

### 3.1 Generating a week

For each day, in order:

1. **Priority order**, highest first:
   1. Open repair/recheck work (`repair_threads` open + their generated
      recheck) — this is what answers "things that went wrong on the test
      must be done, not just logged."
   2. Unstable-but-correct concepts (`evidence_state = 'unstable'`) — the
      underconfident case named explicitly in the brief: answered right,
      not sure, so it isn't "done" yet even though nothing is technically
      wrong.
   3. Class consolidation, if this day follows a class occurrence this week —
      see §5.
   4. Phase-appropriate new/review content from the weekly envelope — see §4
      for how phase changes what this actually is.
2. **Capacity for the day** = sum of available-slot minutes today (real
   `start_time`–`end_time` ranges from `availability_rules`, minus anything
   overlapping a protected commitment) — this is also where the
   `weeklyCapacityMinutes()` bug gets fixed: real ranges, not
   `max_session_minutes` guesses.
3. **Absorption cap**, independent of raw capacity — this is the "don't hand
   someone a whole subject's first pass in one day" rule:
   - **First-pass (new) content**: capped at **2 effort-units per day**,
     regardless of how much raw time is available. A student with 6 free
     hours gets a well-sized portion plus something else useful (review,
     repair), not 6 hours of unbroken new material.
   - **Review/practice/repair**: capped at whatever the day's real capacity
     allows — this kind of work is fine denser, since it isn't first
     exposure.
   - If a day's share of the envelope would exceed the absorption cap, the
     surplus rolls to the next day in the same generation pass.
4. **Placement**: `day_preferred` (a date, no clock time) is the default for
   study portions — the brief is explicit that fixed time-blocks aren't
   practical. `timed` stays reserved for what genuinely needs a real slot:
   protected commitments, the pulse-day cumulative review, and mocks (§6).
   Each portion still carries an estimated duration (effort-units ×
   `observedMinutesPerEffortUnit`) for display, but that estimate is never
   the placement mechanism.

### 3.2 Redistribution, not regeneration

Reshuffling — "they did subject B before A," "a day went badly," a task got
skipped — is handled by one bounded operation, `redistributeWeek(userId,
weekId)`, not by refusing to commit to anything beyond today in the first
place:

1. Sum what's actually **done** so far this week (`completed`/`partial`
   `plan_blocks`, by effort, not count) against what the week's rows
   currently claim.
2. Recompute remaining scope for the week: original weekly envelope minus
   actual progress (not minus *planned* progress — a task done differently
   from planned still counts as progress).
3. Redistribute that remaining scope across the days from **today's
   still-available capacity onward** — rows for days already past are never
   touched (history is immutable, consistent with `task_events` elsewhere in
   this app); rows for today and future days are updated in place
   (revision-guarded, same optimistic-concurrency pattern `taskService.ts`
   already uses everywhere else), respecting the same priority order and
   absorption cap as §3.1.
4. Classify the result against §7: if every remaining day still fits inside
   its absorption cap, apply it automatically — no confirmation, this is the
   normal case, per the founder's explicit choice. If it doesn't, don't
   apply it — raise a Coach attention item instead (§7's "big" branch).

This runs automatically after any event that changes what's done (a task
marked complete/partial/skipped/deferred) — it's what the "small deviation"
path in §7 actually calls.

### 3.3 Generation triggers

A week's rows are (re)generated, in full, only on an explicit trigger — never
implicitly on page render (a GET must never write):

- onboarding completion (first week)
- the pulse day closing (next week, informed by this week's actual
  completion feeding §2's rolling pacing factor)
- an explicit "regenerate this week" action (exam date change, a big
  availability edit, or the student asking Coach for a heavier/lighter week)

## 4. Phase-aware content, not one generic "study" task

`composer.ts`'s fixed 75/25 split is replaced with phase-specific behaviour,
reusing the phase already computed by `currentPhase(roadmap, today)`:

| Phase | What a day's portion actually is |
|---|---|
| `first_pass` | New-module exposure (capped at 2 effort-units/day) + a short retrieval check on it |
| `consolidation` | Revisit modules flagged `decaying` or with old evidence, connections across topics |
| `revision` | Cumulative mixed practice pulled across topics already covered — never single-topic |
| `final` | Mocks (§6) + repair backlog + final checks; new first-pass content is not scheduled here at all |

## 5. Class awareness

For instructor_led/hybrid students, a day that follows a class occurrence
this week (per `calendar_commitments` with `kind: 'class'`) gets a
**consolidation** portion instead of new self-study content for whatever
modules that class's topic covers: `task_type: 'class_consolidation'`
(declared, unused until now), pulling from modules already marked
`coverage_state: 'taught'`. This is the tie the brief asked for between
"what did they do in class" and the schedule — using the signal that already
exists (`taught`) rather than inventing a new one, since nothing captures an
actual class-content summary and shouldn't pretend to.

## 6. Diagnostics and mocks

- **Weekly cumulative review** — `ensureWeeklyDiagnostic` is rebuilt (it
  existed, was deleted, is being restored properly as part of this, not
  patched back in isolation), scheduled `timed` on the pulse day at the
  student's chosen reminder time, idempotent per week exactly as before.
- **Mocks** — genuinely new. Full-length, so they're the one thing that must
  be `timed` with a real multi-hour block: the engine looks at that week's
  available slots for the **longest single contiguous window**, whichever
  day that falls on — no assumption that a weekend window beats a weekday
  one; it's a straight comparison. Cadence: one every 2 weeks starting at the
  midpoint of `revision` (the revision phase's middle week, computed the same
  way `buildPhases` already computes phase boundaries), weekly once `final`
  starts — reusing the phase's own existing purpose text ("mocks under exam
  conditions... reserved before anything else is planned"). If no window that week is long enough, the
  mock does not get force-placed — it surfaces as a Coach attention item
  instead of silently shrinking to fit (a shortened mock is a bad idea, not
  a flexible one).

## 7. Disruption handling: small vs. big

The rule from the brief: small deviations get absorbed quietly; big ones
need an actual conversation. The dividing line is principled, not a task
count: **does absorbing it keep every remaining day within its absorption
cap, §3.1 item 3)?**

- **Small** (today's shortfall redistributes without pushing any remaining
  day over its cap): `redistributeWeek` (§3.2) applies it automatically.
  Nothing asks permission for this — it's the normal case.
- **Big** (absorbing it would push a remaining day over cap, or a mock/review
  can't be placed): an `attention.items` entry is created (the mechanism
  already built for Home this session), and the *next* Coach message opens
  with it — real options, not just a warning: extend into next week, drop
  the lowest-priority portion still outstanding, or accept a heavier day.
  Nothing is silently overloaded.

## 8. Coach as a real input to the schedule, not just a reader

Today, `/api/coach` sends `state` as read-only context to an LLM and returns
text. This spec adds a small, closed set of recognised intents the Coach
endpoint can act on — deliberately **not** open-ended tool-calling (too large
a surface for what's needed, and riskier): the model classifies the
message against this set; anything that doesn't match is just conversation.

| Intent | Trigger example | Effect |
|---|---|---|
| `struggling(concept)` | "I'm still not getting X" | Records a **self-reported signal**, kept separate from diagnostic evidence — never written as `needs_repair`/`unstable`, which this app's evidence model reserves for what a diagnostic actually measured (the same rule that makes `coverage_state: 'verified'` diagnostic-only elsewhere in this codebase). Raises the concept's priority in the next `redistributeWeek`/generation pass, in its own lane above phase-appropriate new content but below real diagnostic-found repair work. |
| `redo(task)` | "can I redo yesterday's FSA session" | **Never reopens the completed row** — `task_events` is append-only everywhere else in this app and this shouldn't be the exception. Creates a new linked task (`parent_task_id` referencing the original) and re-enters the priority queue; the original's completion stays exactly as recorded. |
| `day_was_bad(date)` | "today just didn't happen" | Marks today's remaining portion `deferred` with a reason; triggers `redistributeWeek` and the same small/big check from §7 |

Each is applied through the same functions the automatic engine itself uses —
Coach never gets a separate, unaudited write path. A confirmation ("Moved
FSA back into tomorrow's slot") always follows a successful intent; anything
ambiguous falls back to normal conversation rather than guessing.

## 9. Data model changes

- `class_consolidation` task type: already declared, Phase A starts producing it.
- **`plan_drafts` / `planning_cycles` stay** — reused as the persistence
  layer for the whole-week generation in §3.1, not deleted. They already have
  the right shape (a cycle's worth of accepted rows); what's missing is a
  real generator writing into them, which is what Phase A is.
- `task_events.actual_duration_minutes` needs a real writer: the task
  completion UI (TaskDetailDrawer, TodayFocusCard) gains an optional "how
  long did that actually take?" prompt on marking complete — small, and the
  only new UI surface Phase A requires, but it's what makes §2's
  `pacingFactor` real instead of theoretical.
- `evidence_state` (`unstable`/`needs_repair`) already exists via
  `conceptSummary.ts` — reused, not duplicated.
- Phase B only: `plan_blocks.parent_task_id` (nullable, self-referencing) for
  the `redo` intent's retry lineage (§8); a small `learner_signals` table for
  self-reported struggling, kept structurally separate from evidence tables
  so it can never be confused with something a diagnostic measured.

## 10. What gets deleted

- `src/lib/planning/composer.ts`, `generateAndCommitWeek` — dead in practice,
  replaced outright.
- `/api/plan`, `/api/plan/accept` **routes** — dead (zero UI callers), replaced
  by Phase A's real generation/redistribution entry points. The underlying
  `plan_drafts` table and `accept_plan_draft` RPC are kept and reused (§9),
  not deleted — only the two unused HTTP handlers around them go.
- Onboarding S5's "which day closes your week" chip row; Settings' matching
  field.

## 11. Rollout

**Phase A (this plan):** §1 (Pulse), §2 (weekly envelope), §3 (whole-week
generation + redistribution, reusing `plan_drafts`), §6's diagnostic-review
restore (not mocks — mocks stay Phase B), §9's duration prompt. This is the
core adaptive engine, wired into Calendar, and it's the foundation everything
below needs.

**Phase B (follow-up, own plan):** §4's full phase-specific content variety
beyond the basic first_pass/revision split, §5 class consolidation, §6
mocks, §7/§8 full disruption handling + Coach's three intents. Each is
independently useful and independently testable once Phase A exists under
it.

## 12. Testing

Pure-function core (`weeklyEngine.ts` scope/priority/capacity math) gets a
`scripts/weeklyEngine-test.ts` in the existing RED→GREEN style, covering: the
weekly-envelope formula (remaining ÷ usable weeks, not remaining × factor),
the rolling 3-week pacing bands, the 2-effort-unit absorption cap, priority
ordering (repair > unstable > consolidation > new), and pulse-week derivation
for both class and no-class students. `scripts/e2e-calendar.ts` gets extended
for the end-to-end wiring: generating a week writes all seven days as real
rows; marking a task done and running `redistributeWeek` moves only
today-and-future rows and never touches a past day; a shortfall that would
overload a remaining day raises an attention item instead of silently
applying.
