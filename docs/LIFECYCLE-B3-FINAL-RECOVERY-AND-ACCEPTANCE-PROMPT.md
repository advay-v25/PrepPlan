# Roadmap — finish B3: reviewed study-work recovery and Calendar acceptance

Prepared 15 November 2026 after master status §9.38. Implement this closeout; do not return another plan or start B4/Journey C. Preserve the delivered class-edit protocol and partial-scope fixes. Journey B remains partial until its separately assigned full class-led browser journey is complete.

## 1. Scope and accepted work

Read `AGENTS.md`, Ponytail, §§9.36–9.38, the B3 prompt and the installed Next.js guides relevant to any framework changes. Preserve unrelated dirty work. Settings final acceptance is owned separately: coordinate setup versioning, classes-finished, occurrence identity and shared SQL; do not edit its account/reminder/export work or apply its pending migrations blindly.

Accept the delivered endpoint/race/browser/restore evidence as recorded. The owner review independently reran **75 scope checks, 25 learning-loop checks and 24 current-week state checks: all 124 passed**. No database or browser journey was independently rerun. Do not spend this slice proving unchanged controls again in full, or revert the dirty tree to manufacture a historical red run.

Preserve: only explicit whole coverage unlocks a class portion; conservative treatment of historical `continued`; lineage across weeks without restoring class links; pending portions and confirmation; frozen reserved/scored forms; atomic keyed class edits and conflict refusal; protected history; established class-led/self-study cycle policy.

The required work is: **one reviewed recovery draft for existing study tasks, effective-date/exception correctness for series changes, investigation of the three history failures, and the missing B3 browser proofs.** No Calendar redesign, new planning algorithm, teaching, question-bank publication or mastery-policy changes.

## 2. Build the missing recovery flow

### Why the current link is insufficient

`ClassOccurrenceDialog` labels a link to the first task “Review changes to my week.” It neither drafts a set of changes nor accounts for flexible/unplaced work. The current `deriveCurrentWeekPlanState` returns `not_applicable` when planned work exists; `getOrCreateCurrentWeekProposal` builds new tasks for empty weeks. Linking the class dialog to that empty-week path will not fix recovery and must not generate a fresh duplicate first-pass plan.

Reuse the existing draft storage, placement rules, freshness hashes and atomic task commands. Extend their supported adjustment path for existing tasks, with the smallest needed purpose/payload distinction. Do not weaken the empty-week guard globally or add a parallel scheduler.

### User flow and routes

1. A class change commits through the existing preview/PATCH protocol. Its receipt and operation key remain the authoritative outcome even if later recovery fails.
2. The success dialog says the class is saved and identifies actual affected work. **Review changes to my week** opens a review panel in Calendar bound to that student's saved class-change receipt. Use the canonical route helper, for example `/app/calendar?plan=review&change=<operationKey>`; keep task, appointment and occurrence links intact. Validate ownership and the receipt's command kind. An invalid/foreign key must not select a different change.
3. Extend the existing `/api/planning/current-week/preview`, `/accept` and `/dismiss` contracts with an allowlisted adjustment reason and receipt reference, or reuse an already suitable adjustment command. Document the exact final route/payload mapping. Preserve existing empty-week callers.
4. Preparing recovery may persist/reuse a draft, but must not move, defer, complete or duplicate live tasks. GET/render remains read-only. Repeat preparation for unchanged inputs returns the same usable proposal rather than accumulating drafts.
5. The panel lists **old placement → proposed placement**, affected task title/scope, minutes, reason, and any work that cannot fit. Show a compact summary of what remains unchanged. Distinguish a saved class change from a not-yet-accepted study adjustment.
6. The student can accept, keep the current study placements for now, or rebuild a stale proposal. Dismissal does not undo the class change. Unresolved conflicts remain discoverable on Calendar, with an appropriate Home/Coach action; never show “caught up” just because the dialog closed.
7. Acceptance is one atomic command and receipt for the reviewed task set. A reload, lost response, double click or concurrent accept returns the same durable outcome. The receipt links to the actual resulting tasks/week.

### What recovery plans

Compute from the **effective saved schedule**, current accepted-cycle bounds and remaining real study windows. Include:

- unfinished timed tasks now overlapping class/protected time;
- day-preferred work whose daily load no longer fits;
- affected floating/unplaced work, retaining its identity and making any proposed placement explicit;
- existing deferred work only when the student deliberately includes it; a class change must not silently undo a prior deferral;
- started/partial/protected tasks as visible constraints and decisions, not automatically movable items.

Use existing priority, sitting limit, prerequisites, repair spacing, mock bookings, exam horizon and assessment-day constraints. Preserve task IDs when moving within the same cycle, curriculum mapping, lineage, learning objective/method, repair link, confirmations, task history and reported minutes. Do not infer completion or create assessment evidence from a placement change.

If work cannot fit, show it explicitly. Offer to leave it unplaced or keep it for weekly review using existing task semantics and an explicit student choice. Do not silently mark it completed/missed, drop it, lengthen sittings, inflate available hours or write into another cycle. Cross-week continuation remains the weekly-review command's job.

Preview/accept freshness must cover the relevant class receipt and effective occurrences, active cycle, task revisions/status, availability, commitments/exceptions, mock bookings, exam target and applicable repair constraints. Revalidate inside the transaction under the established scope-lock-first order. If any reviewed task became started/protected/changed, refuse or rebuild the proposal as a whole; no partially applied adjustment. Do not loop independent HTTP moves and call the result atomic.

Distinguish: class saved/recovery unavailable; recovery prepared/not accepted; acceptance refused/nothing moved; acceptance outcome unknown/retry same command; accepted/follow-up unavailable. Never return a generic failed-save message after a successful class change or adjustment commit. Saving the class must not depend on an optional plan-impact read succeeding.

## 3. Close series correctness gaps exposed by the new flow

### Effective dates in cycle/forecast readers

Inspect `getStudyWeekContext` and `weekForDate` in `schedule.ts`. The former reads weekly days with an end-date cutoff but no start-date boundary; the latter filters against the machine's current cutoff instead of the requested date. With an old series and a future successor both active, the readers can combine incompatible patterns or use the new one too soon. The accepted-cycle override can conceal this in the current week.

Reproduce using a future effective-date change, then make the existing cycle resolver consume the pattern effective for the requested local date. Honor both `starts_on` and `ends_on`, student timezone and classes-finished. Preserve accepted cycles and the existing class-cycle algorithm; no new boundary policy. Handle a cycle spanning a pattern transition explicitly with the established prospective-cycle rules rather than averaging weekday sets. Prove: before the effective date, on it, after it, an already accepted cycle, a historical cycle, and a forecast beyond eight weeks. No overlap/gap or premature paper-day shift caused by mixing series.

### Carried exceptions must be part of preview and commit

`class_change_preview` currently builds raw weekly ranges before considering carried skips/moves. A carried skip can falsely block a valid series edit because of a booked mock, while a carried move's real slot can be missing from the displayed conflicts/affected work. The series insert also happens before copying exceptions: inspect the effective booking triggers so a valid final schedule is not refused at that intermediate state.

Compute old/new occurrence impact from the actual exception-adjusted schedule. Validate the final transactional schedule, retaining booking race protection and scope-lock order. Do not disable guards globally or rely on a client precheck. Test carried skip over a booked mock, carried move into a booked mock, moved occurrence affecting a study task, inert exceptions with acknowledgement, and mocks beyond the displayed preview horizon. Preview and confirmation must agree; bound visual summaries can remain compact but must state their horizon.

### Moved dates and historical editability

The UI's `isPast` and SQL's `PAST_OCCURRENCE` check currently use the original occurrence date before loading the move exception. A class moved from a past original slot into the future can become uneditable even though it has not happened. Keep original date as identity, but evaluate whether move/cancel is still prospective from its actual effective occurrence and recorded history. Do not allow Restore into an elapsed original slot or rewrite an already attended/logged class. Use the same rule in UI and command; cover both sides of midnight in the student's timezone and same-day already-started/finished cases. Preserve the existing historical protection rather than relaxing every past-date check.

### Export identity boundary

A single moved occurrence must retain its original UID and deep-link identity. Prove this through the existing export reader/parser without taking over Settings. A structural future-series replacement may legitimately create new future occurrence identities; document that one-way snapshot limitation and ensure historical identities persist. Do not introduce feeds, two-way sync or a new global identity system merely to hide that limitation.

## 4. Investigate failing history checks and remove the shared-account test blocker

Run the three reported closed-week failures, capture the actual response/status/viewed interval and classify the cause. “I did not edit that page” does not establish they are stale assertions or unrelated.

The fixture creates its closed week as active-start minus seven days. If onboarding selected a future first cycle, that supposedly closed interval may still include today. Establish an actually elapsed historical fixture in the student's timezone, and separately test a valid closed-cycle view near a boundary. A status label alone must not make an invalid future fixture good evidence. Fix genuine product regressions; adjust fixtures/copy assertions only when their intended contract is demonstrated. Keep completed work, assessment/history summary, current-action suppression and return-to-current-week assertions. Do not delete those checks to turn the suite green.

`e2e-editing.ts` being blocked by a stale booking on the shared account is a harness issue. Run it on a freshly owned ordinary student using existing session helpers and isolated fixtures. Keep task concurrency, conflict, split, undo and class-edit assertions. Do not reset/delete the other worker's mock, grant roles or reuse a shared user's state. Update the obsolete “C2” setup/flow only as necessary to match current guarded commands.

## 5. Finish B3's browser and cross-page evidence

Extend the existing class-editing spec, not a new duplicate suite. Use separate ordinary students at desktop and 390px and verify persisted state after reload:

1. Class edit → recovery draft containing multiple affected tasks → preview writes no task changes → accept once → exact placements and one receipt. Include a flexible task and an item with no room. Confirm a task cannot be silently lost.
2. Two-tab task/class/mock/availability change after preview → refused whole adjustment, preserved choices, rebuild → accept. Lost accept response → same-request recovery with no duplicate history/minutes.
3. Class edit succeeds but recovery loading fails → truthful saved state, retry prepares recovery from the same receipt. Dismiss and rediscover the unresolved decision.
4. Future pattern with carried skip/move, prospective-cycle boundary and protected history; actual effective moved-date editing rule.
5. Partial class log through UI → retained pending portion after next-week continuation → explicit whole-outcome confirmation through UI → only that outcome becomes testable. Controlled date shifts may construct history, but must be recorded and preserve dates, lineage and minutes; no fabricated scores/evidence.
6. Home, Calendar, class-log context, Tests scope and Coach deterministic context agree on saved occurrence and scope. Compare selected dates/IDs/counts, not just successful renders. No tutoring or model-derived schedule authority.
7. IME composition, keyboard/focus/return, narrow error announcements and no horizontal overflow. Expected failure allowances apply only to the injected operation/status/time window.

The full scored class-led paper/result/repair/review browser chain is B4, not required again here. Same-day independently loggable classes remain a known separate product gap; label the current date-level logging honestly and do not claim an occurrence-level logging test when two classes share one log.

## 6. Verification and finish line

Run focused recovery/state/placement/booking/class-scope tests, real command races and the browser paths above. Then run the repaired calendar-integrity and editing suites, relevant class-log/continuity/current-week/Coach regressions, `npm run verify` and TypeScript on the final tree. Separate fixture-bank proof from actual-bank capability; this slice does not require a new bank or a real scored paper.

Preserve 20261224 as applied. Additive fixes must start from effective current functions, retain later patches/ACL/RLS and pass rollback, duplicate/concurrent accept, upgrade and restore tests. Reuse the already extended restore harness; do not repeat unchanged full rehearsals after every edit. Coordinate shared schema work with Settings.

Register fixtures/accounts immediately and clean exact owned IDs, including failures/interrupted browser runs. Stop only your owned server handle and restore generated types. Leave older accounts and other workers' bookings/processes untouched.

Update the next master-status section with final route/receipt ownership, changed task IDs and preserved history, effective-date/exception semantics, causes of the three history failures, named browser/race checks, migration results and cleanup. List actual unresolved failures, not “all functional work done” followed by missing acceptance paths.

**B3 acceptance:** a class change can lead to one reviewed, retry-safe adjustment of the existing study week; no-room work stays visible; effective dates and exceptions match Calendar, planning and booking checks; required regression and browser checks pass. Do not stop after only building the recovery panel. Keep Settings, B4, Journey C and real-bank activation separate.
