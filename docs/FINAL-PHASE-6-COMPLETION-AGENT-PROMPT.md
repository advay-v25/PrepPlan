# Phase 6 continuation — finish Home, Calendar and Settings together

You are completing the already-authorised Phase 6 implementation. Continue working in this checkout. The order is **Home → Calendar → Settings and shared acceptance**. Do not ask the owner to choose that order again, restart completed phases, or begin Phase 7. Deliver working changes and evidence, not another proposal.

## Read the current truth first

Read `AGENTS.md`, required Ponytail guidance and the installed Next.js documentation relevant to your changes. Read:

- `docs/FINAL-PHASE-6-HOME-CALENDAR-SETTINGS-AGENT-PROMPT.md` — the original full requirements, still binding;
- the latest Phase 6 checkpoint in `docs/MASTER-STATUS-AND-COMPLETION-PLAN.md` and its evidence;
- the actual Home, Calendar, Settings and Account components, their canonical state readers and mutation commands;
- current route/state ownership, the Curriculum route map, and the Settings acceptance briefs referenced by the original prompt.

Earlier Settings findings are historical until reproduced on the current tree. Reuse passing implementations. Preserve unrelated uncommitted work; do not reset the checkout, commit or push. Identify your own processes and fixture IDs before starting. Never kill a process just because it holds a connection to your port. Preserve the owner's shared server, previously identified as PID 84412; verify current process identity rather than relying on an old PID alone.

### Starting point

The preceding slice fixed the display-name in-flight edit race, Settings checkbox wrapping at 390px, and Account's incorrect auth-grid layout. Preserve those fixes and the stronger overflow helper. The owner review additionally checks that a successful earlier name save does **not** label a newer unsaved name “Saved.” Its receipt must distinguish those states. Account's post-fix layout and exact checks are recorded in the checkpoint; read that before repeating them.

Home and Calendar have **not** been completed in Phase 6. Settings still needs the full effects/failure matrix. The three fixes are a checkpoint, not completion of the phase. Screenshots before the packages are under `docs/evidence/phase6-screens/`.

## Product rules to preserve

Roadmap guides how and when to study; it does not teach the curriculum. No Materials/source upload feature, lessons, pass guarantee, new readiness formula or prescribed weekly-hours target. Required onboarding gates entry; limited capacity or unavailable questions never denies planning access. Self-study is Monday–Saturday, with Sunday paper. Class-led cycles follow actual classes, with a short transition ending before the next class where applicable. Preserve accepted cycles, frozen papers and historical attribution.

Reported coverage, reported minutes, diagnostic understanding and confidence are different signals. Partial work stays partial; unknown minutes are not zero. External mock scores are self-reports, not concept evidence. Recall cards neither close repairs nor complete study automatically. No paper exceeds 90 questions; existing two-session rehearsal policy remains unchanged.

No real provider calls, emails, payment/deployment work, external account provisioning or content approvals. The configured database is disposable development, not a separate staging environment. Real scored inventory was zero: re-read it and label actual-bank capability separately from registered synthetic fixtures. Do not invent production readiness from fixture success.

## 1. Home package

First map each displayed section/action to its state reader, destination and mutation owner. Reproduce current defects before fixing; do not change the priority policy merely to make the layout simpler.

Deliver a calm first screen: compact exam/week context, one canonical next action with an exact destination, a short today sequence, at most three different decisions, and a compact progress summary. Completed work, roadmap and history expand on demand. Do not add duplicate widgets for the same decision.

Verify all real states: active task, active owned paper, overdue work, upcoming paper, scored result, confirmation needed, zero approved bank, waiting repair/re-check, unplaced work, deferred work, empty accepted week, no remaining room, final week and exam sat. An available-early paper must not replace today's work just because it can be opened. Failed reads must not become “caught up,” zero or an invented next action.

Through the browser, report partial minutes, reload, defer and undo; follow the exact task/day, result, report, repair/proposal and review links. Receipts must match the committed state. A deferred task is not “rescheduled” unless it actually moved. Preserve input on lost/failed responses and use existing receipts/revisions for retries. Verify another-tab stale refusal without a partial write.

Acceptance: the primary action agrees with Calendar, Tests and Coach; scope/coverage matches Curriculum; reported time and history remain attributed to their original weeks. No page render creates a task or paper.

## 2. Calendar package

Implement the original Calendar requirements using existing planners/commands. Desktop must read as a week calendar; mobile as a usable agenda with current day, week navigation and unplaced work reachable without precision dragging.

Clearly distinguish clock-timed commitments/classes/mocks/study, day-only sittings, unplaced work, waiting/deferred work, history and forecast. Day-only generation is deliberate: do not invent a clock time or render those tasks at midnight. Keep current study work ahead of future-mock administration.

Every move/drag has a keyboard/drawer equivalent. Preview where the existing command requires it, accept once, and show the server result rather than optimistic success. Refusal retains the choice and explains the occupied event or ordered sibling with an exact link. Generated work must follow sitting limits, real remaining time, contiguous gaps and already-accepted load. Owner decision §20 (18 Nov 2026): an explicit manual placement may exceed the usual sitting limit or study windows after a clear one-time warning; it changes neither Settings nor later generated limits. Protected appointments, declared sibling order, cycle and exam horizon remain hard constraints. Cross-cycle work uses continuations, never relocation of historical minutes/evidence.

Exercise the connected paths rather than replacing them:

- class log with extent → feasible ordered sittings → accepted work → partial report → Home/Curriculum/Tests;
- occurrence/future-series edit → reviewed recovery draft → accept/retry/stale refusal;
- missed/unplaced work → review → one continuation in the correct next cycle;
- diagnostic result → exact repair work → completion → spaced, fresh re-check;
- external mock report → explicit bounded recovery proposal;
- revision task → reading's notes/cards → return to the same task;
- closed/future/final weeks → truthful history/forecast and no work beyond the permitted horizon.

Investigate first-week concentration with a reproducible fixture. Distinguish a presentation issue from an actual packing defect. Use feasible spreading already supported by the planner. No hidden capacity factor, new hours target or displacement of accepted work. Explain genuinely limited room and offer existing lighter/move/review choices. A conservative placement is not an exact optimum and must not be sold as one.

Preserve the separate Phase 7 same-day class identity work if it remains unbuilt; do not merge separate classes to hide that limitation. Other defects discovered in these required Phase 6 flows must be fixed here rather than reassigned to Phase 7.

## 3. Settings and account package

Produce a field-level effects table from actual controls: display name; tentative/booked/moved exam target; route/class pattern/classes finished/undo; availability and sitting limit; starting position/uncertainty/mock context; reminder choices. For each include entry route, command, version/invalidation effect, saved result, affected pages, exact recovery action and proof.

Use canonical setup editors/commands. Do not clear omitted fields, silently overwrite a newer setup, restart first pass for a mature student, or fabricate diagnostic evidence. Cosmetic name changes must not replan. Future planning uses changed boundaries; accepted work remains visible with an explicit review path where needed.

Drive success, refusal, two-tab stale edit, failed request, response lost after commit, and **successful save followed by failed impact read**. The last one remains saved and offers retry for unavailable impact, not “nothing saved.” An exact retry must not duplicate planning work or increment versions repeatedly. For editable in-flight controls, preserve the submitted snapshot and any newer draft; “Saved” must describe the actual saved value.

Classes finished/undo must preserve explicit later series edits and unrelated cancellations, and restore-conflict refusal must be atomic. Verify Home, Calendar, Curriculum, Tests and Coach agree after each consequential setting change; five successful page loads are not proof of agreement.

### Downloads, reminders and account controls

Reuse existing implementations and controlled failure seams. Cover all original requirements:

- Parse real `.ics` downloads with the installed independent parser and compare with canonical Calendar occurrences. Test timed/day-only separation, exclusions, opt-in history/classes, identity after move/exception, timezone/DST and invalid range. It is a one-way snapshot. No scores, answer keys, private notes or sensitive weakness labels.
- Personal-data export: schema coverage, all owned parent/child records, ordered paging, failed page refusing the download and no foreign/shared-bank secrets. Do not claim a point-in-time snapshot where there is none.
- Reminders: atomic partial saves, unconfigured-mail truth, failed read, saved/sync-pending, opt-out/re-opt-in, quiet hours, moved/cancelled mock, exam sat, uncertain delivery and stale worker. Dry runs only; no external messages.
- `/account` remains accessible outside completed onboarding. Test narrow/desktop layout, Cancel/Escape/focus, recent requesting-session authentication, exact email, pending protection, Auth/Storage failure, lost successful delete response, retry and protected-command refusal afterwards. Use owned disposable accounts only. Preserve unrelated storage and honest partial outcomes across external services.
- Sign-out is this device and surfaces failure. Keep provider/reset configuration truthful without provisioning it. Retention/legal policy remains explicitly owner-pending, not invented.

## 4. Evidence and final gates

Keep one requirement checklist for this continuation and the original prompt. Mark each implemented/proven/unproven, with file/route/command and evidence location. Do not turn prior HTTP proof into a new browser claim.

Drive all eight scenarios in the original acceptance matrix at desktop and 390px: fresh self-study; midway three subjects; class-led; mature February candidate with poor mock; zero/fixture-bank assessment paths; Settings effects/failure matrix; exports/reminders/account controls; closed/future/empty/final/exam-sat and long histories. Fixture setup may establish initial state, but the consequential student steps must be UI-driven and checked against database effects. Record every seed, time shift, interception and simulated service.

Measure overflow against configured viewport **and** document client width. Check keyboard equivalents, focus restore/trap, IME, zoom and reduced motion where applicable. Tighten broad console exclusions: only exact intentionally injected failures may be allowed for that scenario; a generic network/503 exclusion cannot hide a real regression. Capture relevant before/after screens and inspect them.

Measure ordinary and realistic-history read counts/page latency under comparable conditions; report samples and p50/p95 honestly. Remove proven duplicate reads with existing request-scoped readers. Do not add global student-state caching or alter freshness for a benchmark. Classify stalls rather than attributing them to machine load without evidence.

Run focused logic/HTTP/database suites for affected commands, relevant Phase 1–5 regressions and the full `npm run verify`, canonical TypeScript, route audit and migration dry-run on the **final tree**. Form/concurrency changes require these gates even if no migration was added. If a schema change is genuinely required, use a new additive migration and prove clean install, upgrade and restore; never edit applied migrations or overwrite later function patches.

Do not run shared-fixture suites concurrently or reset the owner's E2E account. Use the isolated Next wrapper and unique test output paths. Stop only your recorded processes. Remove only your recorded test users, banks, faults, locks and scratch output; restore generated types and verify the owner's server remains untouched.

## Deliverable and stopping rule

Finish the three packages and shared effects before returning. If one test finds a product defect, fix its shared cause and rerun affected gates; do not simply report a partial slice and ask which package to do next. A genuine external policy blocker does not stop independent authorised work and must be named precisely.

Deliver one master-status entry and machine-readable evidence with the field/route/connection matrix, requirement-to-proof checklist, browser artifacts, performance measurements, final command exit codes, source fingerprint, migration checksums where applicable, actual versus fixture inventory and cleanup. State unknowns without labelling them passes. Do not say “Phase 6 complete” while a required package, outcome or browser journey is missing.

The final reply should tell the owner what students can now do, which defects were reproduced and fixed, exact final gates, and only genuine external limitations. Do not begin Phase 7 or real-content production.
