# Phase 6 — calm Home, usable Calendar and dependable Settings

You are implementing Roadmap's next focused completion phase. Deliver Home, Calendar and Settings as three connected page packages, then prove their shared effects. Finish the whole assignment; do not stop after one page or start Phase 7.

## Context and boundaries

Read `AGENTS.md`, required Ponytail guidance, installed Next.js docs before framework changes, founder decisions, `docs/FINAL-FUNCTIONAL-COMPLETION-PHASES-2026-11-15.md`, and the latest master status through the Phase 5 owner completion. Also read:

- `docs/CURRICULUM-WORKSPACE-ROUTES.md` and the Phase 5 closeout evidence;
- `docs/SETTINGS-ACCOUNT-AND-CALENDAR-EXPORT-AGENT-PROMPT.md`, `docs/SETTINGS-CLOSEOUT-2-APPWIDE-EFFECTS-AND-ACCOUNT-SAFETY-PROMPT.md`, and `docs/SETTINGS-FINAL-ACCEPTANCE-AGENT-PROMPT.md`;
- current route/state ownership, operating-state/next-action contracts and active Calendar/weekly-review/class-change/repair commands.

Those Settings briefs contain earlier findings, many already fixed. Verify current implementation/evidence before reopening anything. Do not call an old finding a present defect without reproducing it. Preserve working account controls, exports, setup versioning, reminder preferences, note autosave, flashcard commands, scope, scoring, diagnostic eligibility and Phase 1–5 planning guarantees.

Roadmap answers **how and when to study**. No lessons, Materials/uploads, pass guarantees, imposed weekly-hours target, punitive pressure, coaching-institute product or new readiness formula. Required onboarding remains an access gate; feasibility/bank availability never denies planning access. Self-study is Monday–Saturday with the weekly paper on Sunday. Class-led cycles follow actual classes; a transition may close before the next class even when shorter than seven days. Preserve accepted cycles/history.

The real bank has zero approved questions. Use registered fixture banks for scored paths and label them. No external provider calls, emails, account/provider setup, payments, deployment, commits or pushes. The configured project is owner-authorised disposable development; do not assume there is a separate staging project.

## 0. Establish a short baseline and preserve ownership

Inspect `/app`, `/app/calendar`, `/app/settings`, `/account`, the canonical onboarding editors reused by Settings, relevant APIs and existing browser specs. Record one compact page → read/service → command → affected pages map. Trace links and query parameters; use the real routes instead of inventing a parallel API.

Capture desktop and 390px screenshots and representative query/read counts before editing. Distinguish confirmed defects, usability changes and intentional policy. Choose the smallest implementation that closes each user problem. No global design-system rewrite, new scheduling engine or duplicated operating state.

Use one owner per shared file/contract and preserve unrelated dirty changes. Any change to shared command shape must reach every caller/test in this pass. Do not run overlapping fixture-bank suites or share test users between journeys.

## 1. Home: one clear next action, with enough context

The student should understand today's priority without reading an operating report.

Target hierarchy:

1. A compact exam/phase/week orientation line.
2. One dominant **available** next action from the canonical selector, with a short reason and exact destination.
3. Today's short ordered work sequence; completed work collapsed and unplaced work discoverable.
4. At most three genuinely different decisions needing attention.
5. Compact weekly activity and demonstrated-evidence summaries. Roadmap/history/details expand on demand. Optional due-card practice stays a quiet link.

Do not change the priority policy simply to make a screenshot cleaner. Reproduce any ordering bug in the shared selector and fix its callers together. A started owned task/paper must resume correctly; a paper that is merely available early must not automatically displace today's work. Pending scope, insufficient bank, unavailable read, scored result and repair spacing must use the same assessment decision as Tests/Calendar/Coach.

Make every action work: open exact task/day, report partial work with minutes, defer, undo, place unplaced work, review a draft, open the owned result/repair/proposal, record learning and close the week. Receipts must state what actually happened. Deferral must not say rescheduled if work only waits for review. Failed/lost writes retain input and resolve by existing receipts/revisions; another-tab changes refuse cleanly.

Keep reported coverage, reported time, adherence and valid diagnostic understanding distinct. Unknown minutes are not zero; partial stays open; a recalled card is not diagnostic evidence. Show sample size/freshness/dispute where relevant, no fabricated percentage or “all caught up” when cycle work remains.

Handle empty accepted week, no useful windows, first baseline week, midway entry, full revision, poor external mock, final week and exam-sat history. A failed optional section must show a retry/unavailable state without turning the entire day into a false empty state. Critical truth failures must never produce a fabricated next action.

## 2. Calendar: the student's actual week, with usable detail

Keep a real desktop week/calendar and a readable mobile agenda, with obvious Today/previous/next controls and labelled timezone/date range. Preserve supported view/date deep links and the exact task drawer. Avoid putting future mock administration before current study work.

Separate visually and semantically:

- timed appointments/classes/commitments at their actual clock times;
- timed study work, when explicitly placed;
- day-only study sittings, clearly labelled without an invented midnight/start time;
- unplaced work and deferred/waiting follow-up;
- completed/history and future forecasts.

Day-only generated tasks are an existing intentional policy. Do not silently convert them into timed appointments. The mobile page must make the selected day's tasks and the week's unplaced decisions easy to find without requiring precision dragging or horizontal scrolling through the whole app.

### Task actions and capacity

Open → understand scope/why/method/done meaning → report work or explicitly move/review it. Keep actual minutes separate from estimates. Splits/continuations retain declared order, curriculum mapping, repair/report provenance and historical links. Cross-cycle movement uses the weekly continuation flow, not a date overwrite.

All drag/drop operations need equivalent keyboard/drawer controls. Preview/confirm where required by the existing command; no optimistic success before the server accepts. On conflict, restore the visible accepted state and preserve the attempted choice. Explain the occupied slot or ordered sibling with an exact link. Respect sitting length, remaining clock time, contiguous gaps, accepted load, protected commitments, booked mocks and exam horizon. Never move a class/mock or protected life commitment to make a study task fit.

Review concentration of first-week work into two/three days against real availability, prerequisites and declared sibling order. If it is a UI grouping issue, fix the grouping. If distribution is feasible but intentionally packed, show why and use existing lighter/move choices. Do not add a hidden fill ratio, hours prescription or auto-displace accepted work. Any true packing defect needs a red fixture and a shared-planner correction, not a page-only shuffle.

### Classes, assessments and recovery

The Calendar is the operational home for Log class/Log learning, class occurrence versus future-series edits, reviewed recovery of affected work, mocks, report debriefs and weekly closure. Keep those existing paths reachable from the relevant event/task. Do not rebuild them.

- Log class → explicit taught extent → feasible ordered follow-up preview → accept. Partial/continued portions remain pending for testing until explicitly confirmed whole.
- Missed/partial work → honest current action → weekly review → one continuation with its own week/time and original history intact.
- Scored paper → exact repair proposal/task → completion → spaced fresh re-check. Preserve transactional re-check date checks and no automatic repair closure from study completion.
- External mock/report → bounded opt-in review proposal; report is self-report and does not create demonstrated evidence.
- Revision task → that reading's cards/notes → exact Back to task. Recall practice alone completes no task or outcome.
- Historical week → its work/results/reports, read as history. Future week → forecast, not an accepted plan. Unknown/foreign task or appointment link says unavailable rather than selecting a different object.

Booking races, stale class-change/recovery previews, lost accepts, replay and undo must still work. Preserve the transactional conflict commands and same-day class-occurrence identities. Independent same-day class logging, if still missing, belongs to Phase 7; do not conceal it by merging classes in the UI.

## 3. Settings: saved changes have truthful app-wide effects

Settings should be a short list of understandable sections with canonical editors and explicit outcomes. Use progressive detail for account/export/privacy actions. Fix any remaining overflow against **390px viewport and document client width**; do not accept an expanded `innerWidth` as proof.

Build a field-level matrix from the actual controls/routes. At minimum:

| Change | What must agree afterwards |
| --- | --- |
| Display name | Home/account identity changes; no plan/context version bump solely for a cosmetic name. |
| Target month/year, tentative → booked date, moved exam | Home/Coach target, Curriculum roadmap phases and Calendar horizon; affected draft freshness; existing forms/scores/history preserved. |
| Route/class pattern/classes finished and undo | Prospective class occurrences, cycle anchor and test timing; accepted current cycle and attendance/log history unchanged. |
| Availability or maximum sitting | New previews use the boundary; accepted work stays visible with an explicit review action where needed; no invented weekly target. |
| Reported starting position/coverage/uncertainty/mock context | Future planning/revision context changes; no fabricated timed work/evidence, no first-pass restart for mature entry. |
| Reminder choices/time/quiet periods | Saved preferences and actual delivery capability are separate; pending sync is visible; source edits/cancellation/opt-out respected. |

Use existing checked/versioned setup commands and impact wrappers. A stale overlapping edit must refuse or merge only an established compatible case. Do not clear omitted fields. An authoritative committed save remains Saved if the optional impact read fails: show saved version plus “impact unavailable” and a retry. A refused command says nothing saved. Exact lost-response retry must not duplicate roadmap/cycle work or increment setup versions repeatedly.

One source observation to reproduce: `DisplayNameForm` leaves its input editable while saving, then assigns the earlier submitted name back on success. A newer typed edit can disappear, and onChange resets the saving state. Protect the submitted snapshot or preserve the newer draft, and prevent overlapping contradictory saves. Apply the same test to other edited Settings controls rather than blindly disabling all app inputs.

Classes-finished/undo must preserve newer explicit series edits, account for newly added/archived series, and refuse a restore over a booked mock atomically. Do not revive unrelated cancellations or equate classes finished with syllabus mastery.

## 4. Account controls, reminders and downloads: finish acceptance, reuse implementation

Keep `/account` available to a signed-in person outside the completed-study gate for export/delete. No need to provision Google OAuth, SMTP, a domain or a paywall in this phase. Preserve existing reset/provider routing; if a provider is not configured, explain that capability accurately and leave user state intact.

### Calendar and personal-data export

Settings/Calendar `.ics` is a **one-way snapshot**, not a live sync. Preview the range/counts before download. Reuse Calendar's canonical schedule: timed events have correct zone/DST times; day-only work is a non-blocking all-day reminder; unplaced/deferred work is excluded and counted. Classes/completed history remain explicit options. Re-export after a move keeps the established identity rule; exceptions, historical classes and future series changes follow the current identity contract.

Parse the downloaded file with the installed independent parser and compare it to the selected Calendar view. Never export diagnostic answers, scores, private notes or sensitive weakness labels into external calendar titles.

Personal-data export includes all owned current-schema records and parent-owned children, including new card commands/draft quota records where applicable, with complete ordered paging and honest snapshot limitations. Failed pages fail the download. No cross-account records, secrets or shared-bank answer keys.

### Reminders

Preserve atomic partial preference patches, explicit Save and input recovery. No key/configuration means no mail is sent, not “connected.” A committed preference with failed follow-up is saved/sync pending. Verify quiet hours, moved/cancelled mocks, exam-sat, opt-out/re-opt-in revival, uncertain delivery and stale worker behaviour through dry runs/controlled providers only. No real messages.

### Delete/sign-out

Use disposable accounts only. Keep exact email confirmation, recent authentication from the requesting session, pending-dialog protection, explicit this-device sign-out and surfaced failures. Deleted/expired sessions must not keep using protected app commands.

Prove failure and lost-response paths with the existing test seams: Auth deletion failure, any already-removed owned Storage objects, successful deletion with a lost response, and retry/session recovery. Report the actual phase outcome; do not promise an atomic transaction across external Storage and Auth. Only declared owned prefixes may be cleaned; preserve another account's files and nested/paginated storage handling. A failed audit write must not turn successful deletion into a false failure.

Do not invent retention promises or final legal copy. Preserve owner-pending policy as clearly labelled beta text and list the exact remaining decision separately.

## 5. Connections, responsive design and performance

Use the existing visual language/components and plain short copy. One page's main action should be visibly stronger than secondary administration. Avoid nested cards, long explanatory paragraphs everywhere, redundant readiness widgets and new jargon. Keep detail available through exact links/expansion, not deletion of useful history.

Apply existing field styling and touch-target conventions consistently to shared forms; do not leave new controls at raw browser sizing. Preserve the Curriculum hierarchy and its save/recovery protections rather than starting another Curriculum redesign.

Validate breadcrumbs, return links, anchors, desktop/mobile navigation and keyboard/focus order. Drawers/dialogs trap and restore focus; Escape/back behaviour must not silently discard a submitted save. Test IME, zoom, long labels, empty/loading/error, narrow widths and reduced motion if animations exist. Do not add decorative motion or dependencies as a substitute for functional work.

Measure ordinary and long-history accounts using fixed comparable conditions: request/read counts and page/API p50/p95 where meaningful. Remove duplicate reads using existing per-request ownership-aware readers before introducing caching. Never cache one student's state globally or trade freshness/correctness for a low query count. Keep Home's essential action usable if optional details fail; do not fabricate a successful empty state.

Document exact implemented links, query parameters, command owners and invalidation across Home/Calendar/Curriculum/Tests/Coach/Settings. Fix stale callers at the shared cause. Preserve deliberate redirects/410 compatibility until callers are migrated; no blanket cleanup of dirty files or evidence.

## 6. End-to-end acceptance matrix

Browser if available; otherwise record why and use installed Playwright. Run desktop and 390px journeys with ordinary owned students. Label fixture setup, simulated providers and UI actions. Use separate output directories for simultaneous browser runs, and avoid shared-fixture concurrency.

Required scenarios:

1. Fresh self-study baseline: accepted week, primary Home action → Calendar work → partial minutes → reload → defer/undo → review/continuation.
2. Midway three subjects covered: relevant existing work and uncertainty, no beginner restart, no diagnostic evidence from self-report.
3. Class-led: class log/edit → reviewed recovery → Home/Calendar/Tests agree; transition closes before next class even if short.
4. First pass/revision complete, upcoming February exam and poor external mock: concise recovery actions, exact report, relevant revision, final-week horizon and no invented chapter diagnosis from overall score.
5. Zero bank and fixture-bank controls: unavailable state keeps planning useful; owned active paper/result/repair/re-check links work on a registered bank. Never count actual-bank unavailability as a passing scored journey.
6. Settings field matrix above, with two tabs, stale draft, lost save response and failed impact read; no split-brain state across pages.
7. Exports parsed and compared, reminder recovery, sign-out and disposable account deletion/error/lost-response paths.
8. Closed/future/empty/no-room weeks, final exam date and exam-sat history; long histories and failed later reads.

Assertions must cover resulting database/state changes and exact return routes, not only visible toasts. All page renders remain read-only. No broad console allowances or renamed assertions to hide failures. Investigate a returning hydration error with full context, not a “machine load” waiver.

Run meaningful focused tests for changed logic and existing relevant suites; `npm run verify`, canonical TypeScript, route audit and migration dry-run on the final tree. If schema changes, use additive migrations and run clean install, upgrade and restore against effective final definitions/ACLs. Do not edit applied migrations or skip later trust patches.

## Completion and cleanup

Deliver one master-status section plus machine-readable evidence: requirement → implementation → proof; page/field/route matrix; before/after screenshots; real inventory versus fixture capability; provider/delivery configuration truth; query measurements; seeded versus UI steps; migration hashes and remaining external policy decisions.

One final set of tests per unchanged final tree is enough; do not keep repeating already-passing unrelated suites. A required failing/unproven outcome remains partial until addressed. Finish all independent authorised work before asking about a real policy blocker.

Stop only processes you started, by recorded handles. Use the isolated Next wrapper and restore canonical generated types. Delete only owned test users/banks/locks/output; do not reset shared accounts, delete other workers' fixtures or kill a process merely because it has a connection to your port. Preserve the existing shared server and uncommitted work. No commits, deployment, payments, real model/email calls or external account operations.

Phase 6 closes when the three page packages and their shared effects are usable, correct and proven. Phase 7 owns the final whole-lifecycle matrix, remaining independent same-day-class identity work where needed, and broader release cleanup; do not silently move a Phase 6 defect there to call this phase complete.
