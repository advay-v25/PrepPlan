# Class log → week planning (class-led loop) — design for approval

Part of `2026-09-19-curriculum-workspace.md` §6. Curriculum holds no question bank; it only links to chapter tests in the Diagnostics page.

## 1. The loop in one line

**Class happens → student logs what was covered (reading → outcome → how much) → Calendar plans the rest of the cycle around it → diagnostic on the last day before the next class → review closes the week and starts the next.**

## 2. The outcome list (what the student picks from)

Reading → **Outcomes (LOS)** → optional **parts**.
- Every reading has a short, original-wording outcome list (authored by us, reviewed by the founder). Roughly 5 outcomes per reading.
- An outcome can carry named parts where a class often splits it (e.g. *Income statement*: revenue recognition, expenses, EPS basic, EPS diluted). Parts are added over time; **a free-text "the part I did" field is always available**, so nothing depends on every part being authored.
- Coverage per outcome is: **Not covered · Part (with note/parts) · Full · Continued** (covered again in a later class).
- Coverage is exposure, never evidence. It never moves a verdict band.

## 3. The logging flow (Calendar)

1. When a class ends, Calendar shows "Log today's class" (in-app; no push). It never blocks anything.
2. Options: **I covered material · Class was a revision/doubt session · Class didn't happen / I missed it · Nothing to log.**
3. Covered material: pick subject → reading → tick outcomes → per outcome choose **Full / Part** and optionally name the part or type a note. Add as many readings and subjects as the day had.
4. The student sees a **plan-update preview** (what gets added, what moves) and confirms. Nothing is written to the plan until then.
5. Logs can be edited later; the plan updates by a new preview, and finished tasks are never rewritten.
6. Late logging is allowed (default window: until the cycle closes). Days already gone are not planned into.

## 4. Cycle boundary rule (needs a fix)

A class-led cycle **starts on the class day that follows the longest gap between classes and ends the day before that class**, which is the pulse day.

| Classes | Longest gap | Cycle | Diagnostic |
|---|---|---|---|
| Sat + Sun | Sun→Sat (6 days) | Sat → Fri | Friday |
| Tue + Thu | Thu→Tue (5 days) | Tue → Mon | Monday |
| Mon–Fri | Fri→Mon (3 days) | Mon → Sun | Sunday |
| Wed only | 7 days | Wed → Tue | Tuesday |

**Known defect:** `resolvePulseDay` uses the numerically smallest weekday, so Sat(6)+Sun(0) is read as starting Sunday and ending Saturday, which is wrong for your case. It needs the gap rule above. `weekBoundary.ts` belongs to the other model, so I will hand that change over with a test table rather than edit it.

## 5. How the plan is built (progressive, not one shot)

The plan for class content cannot exist before the class is logged, so the cycle fills in **as logs arrive**. Each confirmed log triggers a re-plan of the *remaining days only*.

**Sat + Sun example.** Sat evening: log EPS (Income Statements) and Corporate Issuers part → preview → Sun onward gets consolidation tasks for those. Sun evening: log Balance Sheet half and Economics part → Mon–Thu re-planned with both sets; Friday holds the diagnostic covering everything logged.

**Tue + Thu example.** Tue evening: log → Wednesday gets part of Tuesday's material. Thu evening: log → Fri–Sun get the rest and Thursday's material; Monday is the diagnostic.

Rules, in priority order:
1. **Open repairs** (from the last diagnostic) first.
2. **Unstable** items.
3. **Consolidation of the most recently logged class** — first pass the day after class (default), so the newest material is worked first.
4. **Older logged material not yet consolidated.**
5. **Second touch** on heavier items before the diagnostic (a chapter test link, not a content task).
6. Spare capacity: revision of previously verified material. **No new roadmap content for class-led students unless they choose catch-up** (see question 4).

Sizing and limits:
- Task effort = the outcome's share of the reading's effort, halved (or by parts) when only part was covered.
- Placement respects real availability windows, commitments, the daily absorption cap, and never puts work before the log time.
- **No hours target.** If the material does not fit, the plan shows calm pressure ("Tight this week"), places the highest-priority work, and lists what carries over — it never stretches days past their cap.
- The Friday/Monday paper is scoped **by logged outcomes** (new → diagnostic, revisited → revisionary, mixed → mixed). If the bank cannot support it, the existing explicit no-paper closure applies.

## 6. Scenarios the design must handle

| # | Scenario | Behaviour |
|---|---|---|
| 1 | Both class days logged on time | Two progressive re-plans, as above |
| 2 | Log a day late | Plan from the logging moment; past days untouched |
| 3 | Class cancelled / missed | Logged as such; no content added; optional catch-up offer from the roadmap |
| 4 | Revision or doubt class | Logged as revisionary; feeds the revisionary paper, not new content |
| 5 | Same outcome continued next class | Coverage merges; only the new increment is planned; prompt "Did you finish it?" |
| 6 | Several subjects in one class | Supported (multiple entries per day) |
| 7 | Class moved or extra class | Log attaches to the actual date; the cycle pattern is unchanged for this cycle |
| 8 | Nothing logged at all | Weekly review shows the unlogged class days; the student logs, or says "nothing to log" explicitly |
| 9 | No classes this cycle (holiday) | Falls back to self-study planning from the roadmap for that cycle |
| 10 | Schedule changed mid-cycle | Current cycle keeps its boundary; new pattern applies from the next cycle |
| 11 | Too much material for the week | Prioritised placement, carryover list, "Tight" pressure state, no extra hours |
| 12 | Edited log after tasks were done | New preview; finished tasks stay; only open superseded tasks are cancelled with a reason |
| 13 | Two devices confirming at once | One transaction, idempotent per log; second is a no-op |
| 14 | Onboarded mid-cycle | Partial first cycle; self-reported current position treated as revisited, not new |
| 15 | Class content ahead of / behind the roadmap | Class coverage wins for those readings; roadmap shifts, never fights it |
| 16 | Revision phase near the exam | Class logs may be revision-only; mock exam work takes priority |
| 17 | Paper scope has partly-covered outcomes | Only the logged part is tested; unlogged parts are excluded |
| 18 | DST / timezone boundary | Dates resolved in the student's zone; covered by tests |

## 7. Performance coaching hooks

- The diagnostic result feeds the next cycle: misses become repair tasks on the outcome (not the whole reading), placed first in the next cycle.
- A **Coach proposal** (confirmation-gated) can suggest moving load when a student keeps missing the same outcome or is repeatedly over capacity.
- The Curriculum reading page shows for each outcome: covered in class (date, extent), consolidated (tasks done), tested (verdict), so the whole path is visible.

## 8. Data and services (additive)

- `reading_outcomes` (id, module_id, seq, title, parts jsonb) — the authored list.
- `class_sessions` (user, date, commitment link, status: covered/revision/missed/cancelled/none, logged_at, idempotency key).
- `class_session_items` (session, outcome, extent part|full|continued, parts[], note).
- `user_outcome_coverage` — derived rollup; manual changes tagged.
- Pure planner `planClassConsolidation(...)` reusing `allocateDay`, capacity and paper classification.
- Atomic RPC `apply_class_log`: saves the log, updates coverage, cancels superseded open tasks (with reason) and inserts the new tasks in the **active cycle**, idempotently, checking `auth.uid()`.
- Preview endpoint (pure read) and confirm endpoint (POST only). Nothing writes on render.

## 9. Testing (heavy, as required)

1. **Table-driven scenario tests** for the 18 scenarios above with a fixed clock.
2. **Invariant checks on every generated plan**: no day beyond its cap; no task before the log time; the paper sits on the pulse day; no duplicate tasks; every logged outcome is either placed or listed as carryover; applying the same log twice changes nothing.
3. **Boundary table test** for the cycle rule (the four rows above plus irregular patterns).
4. **Multi-week simulation harness**: log → plan → complete/skip → paper → weekly review → next cycle, over several weeks and random student behaviour (late logs, misses, cancelled classes, edits), asserting the invariants throughout.
5. **Live e2e on the dedicated `+e2e` account** for both the Sat/Sun and Tue/Thu stories, end to end, including concurrency and replay.

## 10. Phases

1. Fix the cycle-boundary rule (hand-off) and author the outcome lists.
2. Coverage data model + logging flow + preview (no planning yet).
3. `planClassConsolidation` + `apply_class_log` + invariants tests.
4. Paper scoping by logged outcomes; weekly review reads unlogged class days.
5. Multi-week simulation and live e2e; tune capacity and pressure copy.
6. Curriculum reading page shows the covered → consolidated → tested path.
