# Phase 1 final completion prompt — feasible, persistent and usable study sittings

You are completing Roadmap's existing Phase 1. Implement this assignment; do not return another proposed plan or stop after one subsection. Finish the connected feature, its affected callers and its proof before handing back.

## Context and boundaries

Roadmap helps CFA Level I students decide how and when to study. It plans around life and classes, records actual work and uses confirmed learning for assessments. It does not teach the curriculum, guarantee a pass or impose study-hour targets.

Read `AGENTS.md`, Ponytail, the relevant installed Next.js guides before framework changes, founder decisions §19, master status §9.40, and `docs/FINAL-PHASE-1-RELIABLE-STUDY-BLOCKS-AGENT-PROMPT.md`. Inspect the current dirty tree before editing. The latest code and effective database definitions take precedence over assumptions based on an older migration.

Already delivered: sitting limits, remaining-clock availability, class-follow-up instructions, partial-scope protection, class-change recovery, and the approved short transition cycle. Preserve these. After a recurring class-pattern change, the first affected unaccepted transition closes before the next relevant class even when shorter than seven days. Accepted cycles/history and frozen papers remain unchanged. Ordinary class cadence and self-study Monday–Saturday with Sunday assessment remain unchanged.

This assignment closes Phase 1 only. Do not start a redesign, question-bank expansion, poor-mock recovery, new Coach interpreter, source uploads, authentication rollout or deployment. A zero eligible live bank limits assessment availability; it must not block planning or become a reason to weaken approval rules.

## Starting evidence: verify it, then close it

The owner-side source review found:

- `classlog/consolidation.ts` uses `usedDays` and counts only one sitting per item per day. The unique `plan_blocks_class_outcome_day_idx` enforces that restriction. A pure probe with one 120-minute free window, 88 minutes owed, a 45-minute sitting limit and one effort unit places 45 and reports 43 owed with pressure `over`.
- `20261227_class_log_feasible.sql` compares incoming task minutes with `current_week_available_minutes`. That helper subtracts protected bookings and elapsed time, but not accepted study-task load. TypeScript subtracts load before the RPC; it is not protected against a concurrent write. A daily total also does not prove a contiguous sitting fits.
- `classlog/service.ts` reloads outstanding items only from the active cycle's sessions. Remaining uncreated work is recomputed during another class-log preview. Trace whether any other path durably carries it; do not assume existing continuation tasks represent minutes for which no task was created.
- Carryover is keyed by outcome alone in `remainingOf`, although the planner's item identity is session plus outcome. Two sessions covering the same outcome can collide. Expected group counts are estimates that only grow in SQL; prove they cannot leave phantom unfinished parts or prematurely complete a group.
- Weekly `splitIntoSittings` adds display text; `planning/draftTasks.ts` does not carry sibling identity/order. The Phase 1 recovery acceptance patch validates declared order, but that alone does not establish the invariant for other move paths.

The three focused suites passed during owner review: class-log planner 80, recovery planner 20 and effective-series boundary 20. Those passes do not cover the defects above. Reproduce each applicable defect with a focused regression before fixing it. Do not revert other workers' changes to manufacture a red run.

## 1. Make the reviewed allocation authoritative

Use the existing per-student scheduling lock and shared commands. Under the transaction's authoritative lock, validate the reviewed allocation against the current cycle, local clock, sitting limit, availability, classes/exceptions, protected commitments, timed mocks, and accepted study load. Every competing writer that can invalidate this calculation must participate in a coherent lock/revision protocol. Identify the actual writers rather than adding a lock to only one caller.

Requirements:

- Count overlapping windows once. Subtract each accepted obligation once, applying established execution-state rules. Do not double-subtract timed work as floating work, or shift reported minutes into planned capacity.
- Validate contiguous gaps and the combined packing of accepted day-only work plus proposed sittings. A 40-minute sitting cannot fit into two separate 20-minute gaps. Do not cut an existing unsplit sitting into fragments merely to make the arithmetic pass.
- No past placement, post-cycle/post-exam placement, protected overlap or generated sitting above the configured limit. Existing planner ceilings and explicit manual-edit policies remain distinct from the student's report of actual time.
- A change that invalidates the reviewed allocation causes a clear refusal/rebuilt preview, retained input, and no partial session/items/tasks/groups/history. Successful same-key retries return the original outcome even after the clock or cycle changes. Reject incompatible key reuse according to the existing command contract.
- Inspect the effective RPC grants and raw payload boundary. Either enforce all relevant invariants for authenticated callers or make the validated server path exclusive. A student must not forge another user's group/dependency, unrelated scope, or extra task allocation through direct RPC access. Preserve the existing access gate.

Prove concurrent confirm versus another confirm and versus task create/move/resize, plus booking/availability changes that affect feasibility. Use deterministic two-connection barriers and both relevant lock orders, not timing sleeps alone. The final state must fit, or one operation must refuse cleanly. Replays create no duplicates.

Preserve existing deliberate manual scheduling warnings/overrides. This is a guarantee for generated and confirmed proposals, not permission to introduce a universal prohibition on a student's explicit choices.

## 2. Remove the accidental one-sitting-per-item-per-day limit

A sitting limit is a limit per sitting. Permit multiple ordered sittings for one item on the same day when real room and existing workload rules allow. Replace the old day-based uniqueness with stable logical sitting identity/idempotency protection; do not merely drop duplicate protection.

The probe above must place all 88 minutes in two sittings at or below 45 on the available day, preserving the total. Balanced 44 + 44 is appropriate there. Fragmented windows, minimum-piece rules, absorption constraints and smaller limits must still be respected. Do not introduce new mandatory breaks or hardcoded fill ratios.

**Day-only tasks are an intentional supported result.** No new timed-calendar mode is required. Say that a block has no set time, show its duration and sibling order, and prove a feasible allocation exists. Do not display an invented clock time. When a student later gives it a real time, preserve protected-time and declared-order checks.

## 3. Make uncreated remainder a durable obligation

An item that fits partly—or not at all—must remain discoverable without logging another class. Reuse existing queue/task/group contracts where possible; add only the smallest durable state necessary.

- Persist the original planned obligation and exact unallocated remainder, or an equivalent auditable scope/effort representation. A changed pace estimate must not silently erase old remainder or create new debt. Any deliberate re-estimate must be explicit and must not rewrite reported time.
- Use session-plus-outcome/item identity throughout preview, group creation, fingerprints, receipts, readers and carryover. Two classes covering the same outcome remain two distinguishable events, including two legitimate classes on the same date. A retry is still one event.
- Distinguish allocated unfinished tasks from work that never received a task. Weekly continuation must not create both a continuation and another copy of its full original obligation.
- Surface unallocated work in Calendar's existing unplaced/follow-up experience and weekly review. It survives reload, cycle closure and a week with no new class. Its next placement is reviewed and accepted through an existing authoritative command; never silently alter an accepted week.
- Preserve original class date, extent, portion note and reading/outcome provenance through the whole chain. Do not restore `class_session_id` to a weekly continuation if that would duplicate attendance or evidence.
- Define completion from real remaining work and actual group members. Estimated future member counts must not become phantom siblings. Finishing every currently allocated sitting while remainder exists must not falsely finish the obligation. Removing/defering a member must not silently assert coverage.
- Keep `part` and `continued` pending until explicit whole-outcome coverage. Completing their consolidation does not unlock the whole outcome. Frozen papers remain frozen. Scheduling or reallocating work produces no diagnostic evidence.

Add end-to-end cases for zero room, partial room, rollover without another log, two successive rollovers, changed sitting limit/pace between placements, and final placement/completion. Show planned minutes, allocated minutes, unallocated minutes and reported actual minutes separately. Prove no work disappears, doubles or becomes falsely complete.

## 4. Carry truthful split identity and enforce declared order everywhere it can change

For newly generated weekly and class-follow-up splits, preserve explicit sibling identity/order through generation, draft serialization, acceptance, persisted tasks, drawer, continuation and recovery. Use existing group/dependency contracts; do not infer learning prerequisites from a title or a shared reading ID.

Trace Calendar move/drag, the task command, Coach-confirmed moves and class-recovery acceptance to their authoritative boundaries. A move must not invert an existing declared sequence, including same-day timed placements, cross-day moves and changes of duration that create an inversion. Multi-task recovery validates the complete final arrangement, not a transient intermediate arrangement. Conflicts name the relevant sitting and leave all changes unapplied where the action is atomic.

For day-only siblings on the same day, preserve and display their explicit sequence rather than inventing times. Preserve existing semantics for completed predecessors. Unknown legacy order stays unknown; do not fabricate a historical backfill. This is an intentional compatibility rule, not a reason to omit identity from newly generated tasks.

Ensure weekly splits count their shared effort correctly for pace, coverage and test scope, including a partial original followed by a completed continuation. No duplicate attendance, evidence or actual minutes.

## 5. Complete the user journey and affected links

Reuse the existing routes and components. Verify the actual current deep-link parameters before editing. Reach at least:

| Entry/action | Required connection |
|---|---|
| `/app/calendar/log-class` | Context → read-only preview → explicit confirm → saved receipt/Calendar; preserve draft input on refusal. |
| `/api/class-log/context`, `/preview`, `/confirm` | Shared allocation, item identities, truthful counts and authoritative confirmation. |
| `/app/calendar` and its task drawer | Exact accepted sitting, order, class date/portion, method, completion and verification; visible unplaced remainder and continuation links. |
| `/api/tasks` and existing movement/recovery commands | Same declared-order and ownership guarantees at the actual write boundary. |
| `/api/weekly-review/state`, `/preview`, `/accept` | Existing tasks and uncreated obligations survive as reviewed next-week work, with original history preserved. |
| `/app` | Agrees with Calendar about open/partial/unplaced work and never says caught up while an actionable obligation is missing. Reuse current signals. |
| `/app/curriculum` and the exact reading page | Correct self-report versus evidence, partial coverage and related planned work; exact reading/outcome links. |
| `/app/tests` | Pending partial scope stays excluded, explicit whole confirmation includes only its own eligible outcome, honest bank-unavailable state. |
| `/app/coach` | Existing contextual links/move confirmations preserve task identity and declared order. No new Coach feature is required. |

Do not add a new page when the existing drawer/unplaced list/review can handle the work. Instructions must say what to attempt, what counts as done and how it can later be checked, using the student's own materials without teaching or invented book/page references.

## 6. Mandatory final proof

Finish these on the final relevant source/database state. Repair stale tests and their isolated fixtures; do not weaken assertions or report an unavailable run as passed.

1. **Pure contracts:** cap, exact minutes, multiple same-day sittings, contiguous packing, elapsed time, overlapping windows, same-outcome distinct items, durable remainder, split identity/order and short transition boundaries. Include local midnight and applicable DST cases.
2. **Database/HTTP:** atomic rollback after a forced mid-command failure; lost-response replay; concurrent capacity competition; tampered group/order/scope payloads; stale limit/booking/window; zero and partial allocation carried across weeks. Check rows, revisions, events, groups and receipts—not just response codes.
3. **Affected regressions:** class-log planner, feasible class-log HTTP, recovery planner/HTTP, class-change, rollover, Calendar integrity, scope, continuity, weekly split/acceptance and the affected task/Coach movement tests. Update and run `scripts/e2e-class-log.ts` with owned ordinary-student fixtures, not a shared-account reset. Rerun the affected Journey B class-log → follow-up → weekly-review chain. If its wider assessment leg needs inventory, use the guarded fixture-bank track and report it separately.
4. **Browser at desktop and 390px:** drive the real class form → preview → confirm → exact sitting drawer → partial reported minutes → reload → Home/Curriculum/Tests. Also drive multiple same-day sittings, no-room remainder → weekly review → accepted next-week placement, and a stale preview whose input survives. Use the delivered class-editing and follow-up specs on the final tree; verify the approved short boundary remains intact. These are interactions through the UI, with backend assertions, not API-created outcomes labelled browser journeys.
5. **Accessibility/errors:** client width within viewport, visible focus, keyboard form/drawer actions, Escape/focus return and no unexpected hydration/console errors. Any allowance must match the exact intentional cancellation, not a blanket network/console exception.
6. **Final checks:** `npm run verify` exits 0 and `tsc --noEmit` is clean. If schema changes, use new additive migrations, preserve all current effective-function patches and ACLs, verify the checksum runner, and run upgrade plus restore rehearsals. Explain any intentional change to an old one-sitting-per-day test. Do not edit an applied migration.

Use a focused regression loop while implementing; do not repeatedly run every unrelated live suite. Before completion, run the complete affected proof set once after the last relevant change. If a test fails intermittently, capture the response/state and resolve or isolate the cause with sufficient evidence; an unexplained pass on rerun is not closure for a required invariant.

## Delivery and definition of done

Register temporary resources immediately, clean exact owned IDs on failure and success, stop only your own recorded server handle, and use the isolated-run/type restoration helper. Preserve other workers' students, fixtures, servers and dirty changes. No commits, pushes, deployment, real email or owner-data edits.

Update the next master-status section and provide a compact proof artifact containing:

- Each requirement above → implementation location → named test/browser step → outcome.
- Exact commands, final exit codes and passed/failed/skipped counts; explain every skip relevant to this phase.
- A reproducible fingerprint of the tested source, including relevant untracked files, plus migration IDs/checksums and target identity. No credentials or session links.
- Browser evidence paths and database assertions for the same owned journeys.
- Cleanup confirmation and any intentionally unchanged compatibility rules, such as day-only placement and unknown legacy order.

**Phase 1 is complete only when all mandatory gates above pass with no known unresolved Phase 1 defect.** The owner will check the source and evidence before accepting that conclusion. If an external blocker prevents a mandatory check, report `Phase 1 incomplete` and the exact blocker; do not substitute a mock, mark an unrun journey passed, or bury required work under “limitations.” Do not call the whole application production-ready on this evidence.

Deliver the finished Phase 1, not another selection of which unfinished subsection to take next.
