# Weekly continuity — W0: verified gaps, reader inventory, expected behaviour

**Date:** 29 Oct 2026 · **Scope:** finish one week and start the next without losing work · **Status:** W0 findings recorded; W1 design decision resolved — continuation tasks (§4). Implementation/QA completion is not implied by this decision.

## 1. Gaps — checked against the code, not assumed

| # | Claim | Result | Where |
|---|---|---|---|
| 1 | Undated tasks missing from the review | **Confirmed.** `local_date <= cycleEnd` is false for `null`, in both the service and the RPC's "unresolved" count. An unplaced sitting was never asked about and was stranded in a closed cycle. | `weeklyReview/service.ts` (old inline filter), `accept_weekly_review` |
| 2 | Ordinary unfinished study isn't carried | **Confirmed.** "Carryover" is repair threads only. Next week is rebuilt from module coverage, not from the student's unfinished tasks. | `service.ts` `carryover`; `generateWeek.ts` |
| 3 | Preview ignores the student's choices | **Confirmed.** Resolutions are never an input to `buildWeekPlanWithPaper`; the preview and the accepted plan are computed from state *before* the choices apply. | `service.ts` |
| 4 | Closure changes execution without history | **Confirmed.** The RPC updates `plan_blocks.execution` and writes no `task_events`. | `20261007_weekly_review_completed_scope_paper.sql` |
| 5 | "Observed" pace uses planned time | **Confirmed, and worse.** It summed each completed block's *planned* `duration_minutes` and added the module's whole effort band once **per block**, so a split module counted twice. | `roadmapService.ts` (old `observedMinutesPerEffortUnit`) |
| 6 | Empty week is a dead end | **Confirmed.** Service returns `next_week_empty`; RPC raises "The next week has no tasks". | `service.ts`, RPC |
| 7 | Endpoints use a weaker guard | **Confirmed**, now fixed (see §3). | `api/weekly-review/*` |
| + | **Found:** "partly done" has no option | The form offers Done / Skipped / Deferred / Don't know. A partial task must be recorded as one of those, so partial progress becomes "done", "missed" or "unknown". | `ReviewWeekForm.tsx` |
| + | **Found:** new rows lose their meaning | The RPC inserts next-week rows without `outcome_id`, `scope_group_id`, learning objective, method or completion meaning. | RPC column list |

## 2. Who reads a task's cycle? (the inventory)

`plan_blocks.cycle_id` currently means two things: "which week this is planned in" and "which week the learning happened in". Moving a task between cycles changes the second meaning for every reader below.

| Reader | Uses `cycle_id` to… | Risk if a task is moved to a new cycle |
|---|---|---|
| `tests/completedScopeService.ts` | build this week's paper scope from the **active cycle's** blocks and confirmations; treat other cycles' completed blocks as prior history (new vs revision) | **High.** A carried partial task brings last week's confirmed outcomes into the new week's paper: the double-count the plan forbids. Confirmations are keyed to `block_id`, not to when they were confirmed. |
| `planning/weeklyReview/service.ts` | recap (`byExecution`, planned count) | **High.** A closed week's recap would change after rollover unless snapshotted. |
| `signals/signals-loader.ts` | execution counts for the current cycle | Medium: last week's partial work inflates the new week's execution signal. |
| `state/operatingStateRepository.ts` (`getCycleBlocks`) | Home's Today/attention | Medium |
| `planning/pulse/redistribute.ts` | moves open study tasks within one cycle | Low, but must not redistribute carried history |
| `tests/testsOverview.ts`, `startAssessment.ts` | paper block and attempt per cycle | Low (papers are not carried) |
| `planning/classlog/service.ts` | class sessions per cycle | Low (separate table) |
| `planning/taskScopeService.ts` | group members and which cycles they sit in | Medium: group completion must not count a moved row twice |
| `activation/*`, `onboarding/planImpact.ts` | first-week activation and preview | Low |
| `task_events` joins | minutes per cycle by joining event → task → cycle | **High** for actual time: last week's minutes would attribute to the new week |

## 3. Shipped in this step (independent of the design decision)

- **Undated unfinished work is now part of the review** (`weeklyReview/dueTasks.ts`, pure and tested). Unplaced work is listed last and labelled "Not yet placed".
- **Pace is computed only from reported time** (`curriculum/observedPace.ts`, pure and tested): a module counts once, only when it is recorded as covered, every sitting is complete, and every sitting has reported minutes. Unreported time is skipped, not zero; fewer than four modules returns "not enough to say" and the planner keeps its transparent default of 85 min/unit.
- **Weekly-review endpoints use the shared verified-email + setup guard.**
- 12 new tests (`npm run continuity:test`, part of `verify`); full suite: 650 + 32 passing, 0 failing, `tsc` clean.

**Known interim limit:** the student is now asked about undated tasks, but until W1 they are still not carried into next week. Closing a week with an unplaced sitting no longer hides it, but it does not yet continue.

## 4. Decision: Option B — continuation tasks (decided 29 Oct 2026)

Unfinished work continues as a **new** task in the next week. The original stays in the week it happened, with its status, reported minutes, confirmations and history. Keeping the same task id was an implementation suggestion, not a product requirement; preserving the student's progress and history is. Why B over moving the row: the closed week never changes, last week's confirmations and minutes cannot be counted again, and far fewer readers change. The cost is that a carried task gets a new id, so an old `?task=<id>` link opens the original with a pointer forward.

The decision is bounded by these rules (all enforced and tested, §7):

1. The old occurrence is preserved and never marked completed by creating a continuation.
2. The successor inherits planning context only (mapping, objective, method, split group, repair link). It starts unstarted with no minutes, confirmations, attempts or scores.
3. A continuation **replaces** its predecessor as the actionable occurrence; it does not add a sitting. Only a genuine split raises the required parts.
4. Pace evaluates completion across the chain and counts each reported-time observation once.
5. A continued original cannot be completed, moved, split, confirmed, cancelled or deleted.
6. Closure, task answers with history, successors, the next week and the receipt are saved atomically; one successor per original; stale previews are refused; retries create nothing new.

## 5. Expected behaviour, per case (applies to either option)

"What happened" and "what next" are recorded separately. Recording what happened never decides what happens next.

| Case | What happened (closed week) | What next (default, editable) | Must hold |
|---|---|---|---|
| Finished | `completed`; history event | nothing carries | Stays in its week |
| Partly done | `partial`; minutes kept; confirmed outcomes kept | **Continue next week** | Never becomes "missed" because the student wants to continue; remaining work is not inferred by subtracting minutes |
| Not done, wants it | `skipped` (a real decision) | Continue / keep for later | Not a wrong answer |
| Kept for later | `deferred` | Backlog, not scheduled | Visible in Calendar, not silently placed |
| Not sure | unchanged; id recorded as unknown | Shown as "progress needs confirmation" | Never counted as done or missed |
| Unplaced sitting of a split | its real state (usually `not_started`) | Continue / keep for later | Appears exactly once next week; the group stays incomplete until genuinely finished or confirmed |
| Removed | `cancelled` with an audit event | none | History kept; objective not marked complete |
| Repair or re-check | as above | Same thread, not recreated | Appears once; a new miss updates the thread |
| Class not logged | attended / not attended / unknown | n/a | A past class is not carried as a new attendance |
| Empty next week | n/a | Accepted with an explanation and "Update availability / Place work" | Never a dead end |
| Long absence | one current recovery plan | n/a | No invented intermediate weeks |

Every execution change made at closure writes a `task_events` row.

## 6. Remaining from the original W0 list

Resolved: the reader inventory (§2) and the expected behaviour (§5) are now implemented for Option B. The only readers that needed a change were scope-group counting and the pace calculation; every history reader is unchanged because history is never rewritten.

## 7. W1 — built (29 Oct 2026)

**Database** (`supabase/migrations/20261029_weekly_continuity.sql`, additive; no applied function body is altered):
- `plan_blocks.continued_from_task_id` (unique: at most one successor), `carry_intent`, `estimate_provisional`.
- Guards: lineage can be created only by the review command, forward, for the same owner; a continued original is immutable and undeletable; its confirmed outcomes are frozen. Guards stand down for cascades, so deleting a week or an account still works.
- `weekly_transition_drafts`: a saved, server-owned preview (students can read their own, never write). `weekly_source_version()` hashes everything the proposal depends on, so a change made in a second tab makes the old proposal stale.
- `accept_weekly_transition(draft)`: one guarded command. It records each answer in the task's history, creates continuations, opens the next week, writes the receipt and closes the cycle in one transaction. The old `accept_weekly_review` (which accepted task rows from the caller) is no longer callable by a signed-in student. An empty next week is accepted.

**Application**
- `weeklyReview/dispositions.ts`: the student's two answers per task (what happened / what next) become concrete actions, once, in TypeScript; the database applies exactly what was saved. Continuing work displaces equivalent new work by module or repair identity, never by title.
- `POST /api/weekly-review/preview` saves a draft and changes nothing the student can see; `POST /api/weekly-review/accept` takes only a draft id. Both use the shared verified-email + setup guard.
- Review form: separate "What happened?" and "What next?" (including **Partly done**), a preview of exactly what continues, and a retry-safe save.
- Task API refuses changes to a continued original with a clear reason, cancels (rather than erases) a continuation the student removes, and returns lineage for the drawer.
- Scope groups and pace follow chains. **Regression (passing):** 20 minutes in week one (partial) + 25 in week two (finished) = 45 reported minutes, 20/25 attributed to their weeks, module effort counted once. The 85 min/unit fallback is a single constant, worded in the UI as "a planning assumption, not your own pace".
- Calendar and activation recovery recognise a week the student accepted in a review, so an empty or unplaced-only week is not offered "Prepare this week" over it.

**Proof:** 55 new/related Node tests and `npm run verify` (650 + 55, 0 failing); 15 weekly-continuity scenarios in isolated Postgres (rollback after the successor begins, two devices, stale proposal, retry, access, immutability, cascades, empty week, split of a continuation); the earlier 22 task-command scenarios still pass with the new migration present.

**Found and fixed while building:** splitting a continuation copied its link and would have failed on the one-successor rule. A row inserted outside the review command now carries no lineage, so a split sibling is correctly a sibling.

## 8. Corrections made before W2 (from review, 29 Oct 2026)

1. **Duplicate removal is precise.** A generated task is dropped only when it is the same work for the same purpose: a repair thread matches only a repair (a continuing repair never removes its re-check); module-level study matches only module-level study, and only when the continuing task covers the whole module (a task for one outcome does not remove study that covers the module's other outcomes). The main mechanism is now the composer, which reserves continuing work before new work exists.
2. **Preview consistency.** The change token is read **before** anything else and checked again before the draft is saved; if the week moved in between, nothing is saved. At acceptance the closing week's tasks are locked **first** and the token compared **after**, so a change committed while acceptance waits for the lock makes the proposal stale (tested with a real concurrent transaction). Availability and commitments are locked against edits for the same window. The token now hashes each evidence event's validity, reason and supersession, so a voided or disputed answer is noticed, not only a new one.
3. **Meaning is preserved for every accepted task.** Generated tasks now carry an objective, a method and a completion meaning (guidance, never a lesson), and re-checks keep their concept; the closure command writes `concept_id`, `learning_objective`, `suggested_approach` and `completion_meaning` for new work as well as continuations.
4. **Checked against the actual development schema** (read-only inspection, then the final migration and a full closure inside a transaction that is always rolled back; `npm run continuity:schema:rehearse`). It found three real problems, all fixed:
   - `plan_blocks.day` is **text NOT NULL**, so the old "null it if nullable" logic would have left a stale date. It is now always the placed date, or the new week's first day when unplaced.
   - `evidence_event_id` and `class_session_id` are real foreign keys. A whole-row copy would have attached last week's **evidence and class occurrence** to the new task. These, plus the attempt, the paper scope and any cancellation, are now reset. Planning context (mapping, objective, method, guidance, focus, verification intent, curriculum reference, dependencies, source pointer, concept, policy) carries over.
   - The project allows **one active cycle per learner**, and the command opened the next week before closing the old one. It would have failed on every real closure. The old cycle is now closed first. The test fixture now carries the same constraint so the suite can catch this class of error.

## 9. W2 (placement) and W3 (connected interface) — built

**Behaviour**

| Work | What happens |
|---|---|
| Continue next week | Placed on the earliest study day with enough **real free time** (availability minus protected commitments), within the sitting limit; repairs claim time before ordinary study; a re-check goes strictly after its repair and waits if the repair could not be placed. |
| Keep for later | Never scheduled automatically; stays visible and unplaced with its reason. The student can still choose a day. |
| New learning | Generated **after** continuing work is placed. Continuing time comes off each day's capacity **and** the week's new-learning budget, so new work shrinks to make room instead of the week growing. The preview shows what moved back or got shorter, and why. Repairs already continuing are not generated again. |
| Cannot fit | Stays unplaced with a plain reason (no room, longer than the sitting, waiting for its repair) and choices: pick a day, leave it for Calendar, or update availability. |
| Weekly paper | Unchanged: the self-study / class-led boundary decides which days take study, and the paper's questions still come from eligible completed learning when it is started. |

**Placement is part of the saved preview.** Acceptance writes exactly those dates; no scheduler runs afterwards. The student can change any day in the preview (or leave it unplaced), which rebuilds the proposal.

**Interface (W3, focused)**
- Task drawer: **Continued from…** with a link to the earlier record, earlier progress shown separately ("20 min reported… stays with that week"), a first-guess note, and a "kept for later" note.
- Old links: `?task=<id>` for a task from another week now opens that record read-only, with **Continued as…** pointing forward, instead of "not available".
- After saving: a summary of what was saved (continuing and placed, waiting, new work that moved), read from the review's own record.
- Entry points: Home ("Review this week"), Calendar and Tests (existing "Complete weekly closure" once a paper is scored), and now the **Tests result page**.
- Curriculum and Coach need no change to stay correct: continuations are ordinary current-week tasks, history is never rewritten, and scope/pace were already made chain-aware. Neither screen yet *mentions* the review.

**Proof:** `npm run verify` (650 + 72 passing, 0 failing); `npm run build` passes; 21 weekly-continuity scenarios and the earlier 22 task-command scenarios in isolated Postgres; 11 real-schema checks on the development project (rolled back; project confirmed unchanged afterwards).

## 10. Still not done, or not verified

- **Applied (29 Oct 2026) to the app's database, `asylsxszdhlnzewhwtga`.** Verified read-only afterwards: all 52 migration files are recorded in the ledger with no checksum drift; every object from the script exists; the deployed functions are the final versions; the closure command was exercised end to end on the deployed objects (rolled back). Note `.env.staging.local` and `.env.local` point to **the same project**: there is no separate staging database, so "apply in staging first" cannot protect anything here.
- **Not exercised end to end:** the preview service (it reads the roadmap, availability and evidence and calls the generator twice), the review page and Calendar rendering, and PostgREST/RLS access from a real session. That is W4. `scripts/e2e-weekly-review.ts` and `scripts/e2e-integration.ts` still call the removed accept flow and must be rewritten first.
- **Placement is by day, not time of day**, like the generated tasks (`day_preferred`). The student sets a time in the drawer.
- **Concurrency limit:** the closing week's tasks, availability and commitments are locked, but a brand-new commitment or window inserted in the same instant is not blocked; the next review sees it.
- **The first-week activation command (`commit_pulse_week`) still writes tasks without objective/method/meaning.** The weekly review path is fixed; first-week activation is a separate command.
- **Next-week capacity is read at preview time.** If availability changes after previewing, the token makes the preview stale and it must be rebuilt (your answers are kept).
