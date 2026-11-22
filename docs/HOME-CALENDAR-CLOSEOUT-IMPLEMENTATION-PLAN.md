# Home and Calendar — final integration closeout

5 November 2026. Implementation handoff based on the Home report and the current checkout. This is the next build plan; it does not report these remaining tasks as completed.

## Outcome

Finish the existing Home → Calendar → Tests → result → repair → re-check → weekly review loop. Preserve the working product rules and close the remaining gaps before starting the Curriculum page audit. No replacement Home, second planning engine, new readiness percentage, deployment work or question-bank publication is part of this slice.

Roadmap organises and assesses study. It does not teach the curriculum, promise a pass, or turn reported coverage into demonstrated understanding. Self-study means Monday–Saturday learning and a Sunday paper. Class-led boundaries come from classes; an accepted cycle keeps its own dates until it is closed. New material produces a diagnostic; revision produces a revision paper. A missing bank limits assessment, not planning access.

## Start from what exists

Read `AGENTS.md`, the local Next.js guides for changed APIs, the Ponytail skill, and §9.16 onward of `docs/MASTER-STATUS-AND-COMPLETION-PLAN.md`. Check the working tree before editing: several builders' changes are uncommitted. Preserve them.

Keep these implementations: reported/unknown/remaining time, additive reports and Undo, canonical weekly-closure reasons, exact-version reviewed-item eligibility, assessment-owned task controls, result-viewed tracking, exact Coach selection, redistribution receipts, and request-scoped read sharing. Reproduce a defect before changing it.

The pasted report's statement that `20261124_current_week_consistency` is pending is superseded. The current-week work applied `20261124`, `20261125_atomic_closing_snapshot` and `20261126_current_week_profile_writers` to the owner-confirmed disposable development project `asylsxszdhlnzewhwtga`. Confirm the checksum ledger before running anything. Never edit an applied migration.

That work also fixes current-week acceptance/dismissal retries, remaining capacity validation, setup/profile write ordering, class-led empty-state guidance, Home's `weekPlan` handoff and accepted-cycle dates. Do not reimplement them.

## Slice 1 — verify the merged contracts

Run the current focused tests against the same checkout that will be browser-tested. Re-run `e2e:home` and onboarding checks after changes to shared services. Use separate ordinary disposable students; never run reset suites concurrently on one account or use a reviewer as the student.

Inspect these shared interfaces and their callers:

- `setExecution` returns an actual `outcome`; callers must not replace it with a generic rescheduled message.
- `moveTask` reopens deferred work, preserving its history and reported time.
- `state.weekPlan` supplies empty-week actions on Home and Calendar; saving availability does not accept work.
- An accepted cycle is authoritative even after class-pattern changes or when its end date passes. An ended week leads to review, not first-week activation.
- Current-week accept/dismiss, profile edits, Coach changes and repair commands share the planning lock. Review lock order before adding row locks or a new writer.

**Done:** Home and Calendar select the same active cycle, task revision, next action and assessment state. A changed setup makes an earlier proposal stale; retries return their original receipt. Loader failures offer Retry rather than fabricated empty data.

## Slice 2 — make deferred-work placement respect actual slots

Reproduce the reported limitation in `lib/planning/pulse/redistribute.ts` and `apply_redistribution`: a day can have enough total free minutes while an extended timed sitting collides with a manually placed session or commitment.

Reuse existing capacity and occurrence expansion. For a timed target, verify its entire proposed interval against study windows, fixed commitments, moved/skipped occurrences, other timed tasks, mocks, the student's local clock and sitting limit. Daily totals alone are insufficient. Day-preferred work must still fit the remaining daily budget. Keep same-reading matching and never silently displace accepted work.

Validate again inside the authoritative command, under the shared lock, including relevant input revisions. A competing placement or availability edit must cause a stale refusal or a recomputed preview, not an overlap. Preserve all-or-nothing writes, same-request replay and exact Undo receipts. Partial absorption must state the minutes still deferred; do not call partial placement complete.

Audit past-day placement before changing its policy. Recommendation: moving unfinished work chooses today or a future valid day; recording learning that actually happened earlier stays available through Log Learning. Preserve historical task links and late reports. If existing founder decisions intentionally allow retrospective placement, document and retain that exception instead of silently removing it.

**Checks:** same-day deferral with no auto-move; past missed work; two source tasks competing for one slot; manually placed timed work; a moved class; overlapping availability windows; midnight boundaries; maximum sitting length; insufficient space; stale preview; concurrent retries; Undo after a receiving task has changed. Verify Calendar drawer and Home receipts agree after refresh.

## Slice 3 — link applied repair proposals to the actual tasks

`accept_repair_proposal` already records `accept_receipt.taskIds`, while `applied_task_ids` is left null. Prefer reading the existing authoritative receipt in `lib/coach/selection.ts`. Do not create a second receipt table or infer matches from task titles.

An owned executed repair proposal must show the tasks actually created by that acceptance and link to their Calendar drawers. Continued tasks must retain access to the original record and its continuation. A deleted/unavailable task gets a truthful status rather than a broken link. Pending, dismissed, stale and executed proposals remain distinguishable; read-only opening never applies anything.

If an additional persisted field is genuinely necessary, populate it in the existing acceptance transaction with an additive migration. Backfill only from verified receipts, not guessed matches. Continue to use the repair object for concept status and re-check eligibility.

**Checks:** exact proposal and repair links, accepted retry, two different proposals with similar titles, cross-account/missing identifiers, continuation links, expired proposal, zero changes, and refusal leaving no partial task links.

## Slice 4 — finish the actual browser journeys

Use the Browser plugin on desktop and 390px, with ordinary students and an explicitly test-only reviewed fixture bank. Keep fixture evidence separate from actual-bank capability; do not approve or publish real questions to make a test pass.

| Journey | Visible result required |
|---|---|
| Actual bank cannot serve the scope | Home/Calendar/Tests agree; no Start promise, broken paper task or access gate; planning and permitted weekly closure remain available. |
| Paper available before due | Secondary early-start option in Tests; today's study remains primary. |
| Running paper | Home resumes the same attempt; refresh preserves answers and the clock; confidence remains mandatory where required. |
| Submitted paper | One score/evidence update; Home opens its exact result; result-viewed state persists without suppressing unresolved repair decisions. |
| Result → repair | Show the finding and its observations, preview, dismiss, accept, then open the exact Calendar tasks. No change before confirmation. |
| Repairs → re-check | Refuse while unfinished or before spacing; when eligible, place once and start the intended concept scope. No unsupported family-independence claim. |
| Week closure | Scored paper, external mock, rehearsal and permitted no-paper routes all show the correct reason. Logs are resolved before accepting the next week. |
| Interrupted connection | Lost response after commit, refresh, same-request retry; one receipt and no duplicate tasks or attempts. |
| Changed classes | Current accepted week retains its dates; pending class logging and next-class actions open a useful destination. Check a next class outside the current displayed week as well. |

Include keyboard focus, Escape/return focus, tab order, phone overflow and a second-tab stale edit with typed input preserved. Save screenshots and record the tested student type, viewport and outcome. Distinguish not run, blocked and failed from passed. Capture response bodies for unexpected refusals; a transient 503 is not a successful business rejection.

**Done:** the paper → result → repair → Calendar → eligible re-check → review loop is clicked in the browser, not only proven by HTTP or fixtures in a pure reducer.

## Slice 5 — focused performance and cleanup

Measure Home with the existing `scripts/home-measure.ts` and tracing before changing reads. Share repeated commitments, profile and cycle reads within one server request where arguments and clock match. Preserve owner, cycle and time keys; no cross-user cache, persistent cache of mutable planning state or reused pre-mutation snapshot.

Report request counts and timings with the same fixture and conditions. Prioritise correctness over an arbitrary latency target; do not add a second backend solely to reduce repeated reads.

Remove helpers/imports or duplicate logic made obsolete by these fixes only after checking every caller. Keep useful legacy redirects. Run the route/link audit. Regenerate the beta baseline from the verified migration chain in an isolated database, and prove a fresh installation has the current functions and privileges. This is local build consistency work; deployment, domains, OAuth, payments and email delivery remain deferred.

## Routes that must stay connected

| Student action | Destination / command |
|---|---|
| Home | `/app` |
| Add study times | `/onboarding/week?returnTo=%2Fapp%2Fcalendar` |
| Review current-week proposal | `/app/calendar?plan=review` → `POST /api/planning/current-week/preview` |
| Accept / keep empty | `POST /api/planning/current-week/accept` / `dismiss`, with `draftId` and `expectedRevision` |
| Log a class / add next class | `/app/calendar/log-class` / `/app/calendar?action=add-next-class` |
| Open or move a task | `/app/calendar?view=agenda&week=<date>&task=<id>`; existing guarded task command |
| Papers and attempts | `/app/tests` → `/app/tests/<attemptId>` → `/app/tests/<attemptId>/result` |
| Record a viewed result | `POST /api/tests/attempt/<attemptId>/viewed` |
| Exact Coach object | `/app/coach?proposal=<id>` / `/app/coach?repair=<id>` |
| Confirm Coach / accept repair | `POST /api/coach/proposals/<id>` / `/api/diagnostic/repair/accept` |
| Close the week | `/app/review-week`; current preview → saved draft → accept contract |
| Revise setup | `/app/settings` → appropriate onboarding edit step with a safe return route |

Use existing route helpers and ownership guards. Check the current route inventory rather than inventing new paths.

## Completion and handoff

Run `npm run verify`, the focused transaction/HTTP regressions affected by the patch, a clean isolated build and migration dry-run. Update the existing master status section with changed behaviour, exact checks, actual-bank versus fixture results and any remaining limitations. Stop only processes started by this agent using recorded handles; delete only recorded disposable fixture IDs. Restore generated types through the existing wrapper. No commit or push unless requested.

Then start the next page: a Curriculum audit from first study through partial coverage, uncertain prior learning, a completed first pass, revision rotation, mocks, weakness repair and the final week. First map its current actions and their effects on Calendar, Tests, Coach and Home. Produce the small proposed additions/modifications/deletions before redesigning it. Do not rebuild the stable Home again.
