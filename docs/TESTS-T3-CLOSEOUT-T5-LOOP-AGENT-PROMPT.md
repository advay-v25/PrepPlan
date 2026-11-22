# Roadmap — close T3 gaps and prove the student accountability loop

Prepared 11 November 2026 after master status §9.27.

## 1. Assignment

Preserve the delivered difficulty engine and adaptive practice. Fix the specific correctness gaps below, restore the full verification command, then complete and browser-prove one connected weekly accountability loop across Tests, Curriculum, Calendar, Home and Coach.

This is the next bounded slice, combining T3 closeout with the first T5 vertical journey. It is not a new redesign or permission to rebuild the same engine. No bulk generation, human approval, rights clearance, deployment, payments, domain work or new tutoring features.

Read `AGENTS.md`, Ponytail, relevant installed framework guides, founder decisions, the master Tests brief, T3 prompt and status §§9.25–9.27. Preserve the dirty tree. Coordinate shared files; do not revert unrelated auth changes or stop another worker's server. Do not commit or push.

The reported real bank has zero approved questions, confirmed levels and authorised source packs. All content-dependent software proof must use recorded synthetic banks. Real content readiness remains external and cannot be manufactured by migrations or test reviewer accounts.

## 2. Current review evidence

The review reran `difficulty:policy:test` (45/45) and `score:ledger:test` (15/15). It also ran two focused pure probes exposing gaps not covered by those passing tests. It did not rerun the deployed-database or browser matrix.

The reported `/auth/error` verification failure is stale. On this tree, `audit:routes` fails on `/api/tests/practice-runs/x/x` extracted from `AdaptiveRunPanel.tsx`, not on auth. Both real `/next` and `/stop` endpoints exist. Do not remove the auth error page to fix it.

### Findings to reproduce before fixing

| ID | Evidence | Required behaviour |
|---|---|---|
| C1 | Current route-audit run | Dynamic `.../${runId}/${kind}` becomes a fictitious `/x/x` URL. Make finite actions explicit through the existing route helper/literal map, or teach the audit only this supported finite pattern. Retain detection of genuinely missing endpoints. No broad whitelist or disabled audit. |
| C2 | Pure probe, reproduced | Eight recent independent successes for selected outcome A correctly produce scope-based Challenge. Adding twenty newer observations for outcome B in the same reading makes A report zero evidence/Balanced. `decideReadingProfile` truncates the entire reading before selecting A. Scope selection must precede its twenty-observation cap; evaluate broader-reading fallback separately. |
| C3 | Pure probe, reproduced | History Balanced → Support → Support contains only one newly completed paper after the Support change. With strong current evidence, the function already changes back toward Balanced (`held=false`). It must hold until two newly completed relevant papers after the change, excluding the change paper itself. Test first-history-entry changes and chronological ties too. |
| C4 | Source-level gap; reproduce over endpoints | `startAdaptive` plans before resolving a request-key replay. `nextAdaptive` checks cap/closed state before replay. A successful final Continue whose response was lost can be rejected as cap reached; an older retry can also be redirected to the latest set because only `last_request_key` is retained. Resolve a successful owned operation before new-work eligibility and return that operation's original run/attempt receipt. |
| C5 | Source-level gap; reproduce | Adaptive `chain()` selects history by reading alone. Practice on outcome B can therefore raise/lower outcome A in the same reading without disclosing the substitution. Use actual relevant scope, with an explicitly labelled broader fallback only if the policy permits one. Do not silently treat reading history as outcome evidence. |
| C6 | Source-level gap; reproduce | `setStats()` uses raw responses without challenge validity and counts standard successes by family only within one set. Voided questions, missing read results and familiar families can distort advancement/downshift. Use valid scoreable observations, frozen levels and actual first-exposure provenance. Do not let invalidated or repeated questions promote/demote practice. |

The concept-level difficulty tier remains unbuilt. It may stay deferred in this slice if outcome/reading behaviour is correct and honestly labelled; do not call it concept-specific. This deferral does not excuse C2/C5 or change concept-based repair eligibility.

## 3. Pass A — focused T3 correctness closeout

### Evidence selection and hysteresis

Keep the documented policy thresholds and bounded profiles. For exact outcome scope, obtain that scope's eligible first-exposure family observations, apply the shared recency window, and cap the scoped sample at twenty. If inadequate, build and cap the separate broader-reading sample. Do not use a reading-wide limit as a prefilter that erases valid narrow history.

Maintain exclusions for practice, invalid/disputed evidence, missing frozen confirmed levels and unconfirmed families. A repeated family success cannot replace an earlier first-exposure miss. Missing history is limited evidence, never zero ability.

Count completed papers **after** the last actual profile change. The change paper is not one of the two new papers. Derive the initial implicit Balanced state consistently when the first recorded profile differs. Test the boundary before/at/after the required count. Preserve one-step movement and historical form snapshots. If implementation behaviour changes future policy interpretation, record the appropriate patch/version rather than silently relabelling old forms.

For mixed reading profiles, use a truthful overall sentence such as “Adjusted by reading; open details for the differences.” `planDifficulty` must not describe the entire paper using whichever non-balanced reading happens to be last in an array.

### Retry receipts

Resolve a successful request-key replay before recalculating fresh inventory, evidence, cap, stopped state or current block. Bind a key to its user, operation, scope/config and original result. Reusing a key for different inputs is a conflict, not another operation.

Use the smallest durable receipt mechanism compatible with the existing practice-run schema. A lone mutable `last_request_key` is insufficient for retrying an older successful operation. A replay returns the original attempt, even after a later block exists; it does not create another set or revive a stopped run.

Required endpoint cases:

- Lost initial Start response, then first set opened/inventory exhausted, then retry.
- Lost final Continue response at a ten-question cap, then retry.
- Retry a successful earlier Continue after another set has been created.
- Retry after a later Stop; show the original success plus current run state without reopening work.
- Same key/different scope, another student's key, and concurrent same-key requests.

New-key actions still respect current revision, open-set rules, stop status, freshness and cap. Do not loosen those checks to make old-key replay succeed.

### Practice statistics

Build practice adjustment from the same challenge validity and immutable form metadata used for results. A voided item is excluded once; disputed observations cannot supply confident advancement. Insufficient or invalidated samples hold the profile. Do not equate a reduced valid set with a complete five-independent-question set merely to reach the advancement rule.

Test two sets whose apparent misses are later voided: they cannot keep driving a downward adjustment. Also test a previously qualifying pair losing valid standard-level observations through a challenge. Update future set reasoning; never mutate a reserved open set.

Filter practice history to the selected outcomes/concepts actually tested. A completed run covering several outcomes can contribute only relevant observations. An unrelated still-open run must not truncate every later completed run in the reading. Fail unavailable reads explicitly; a failed query is not a fresh learner or a smaller correct sample.

Verify two runs reserved before either is opened cannot count repeated families as independent advancement evidence. Preserve legitimate practice history and cap semantics; use a visible Resume choice if preventing duplicate active scope is the smallest coherent experience.

**Exit:** C1–C6 reproduced and fixed with narrow regressions; full verification no longer fails at the route audit. No new difficulty thresholds, score model or UI restructure.

## 4. Pass B — verify real transactional boundaries

Do not assume that a command is race-safe solely because its comparison occurs inside SQL. Check which locks its writers also hold.

`start_paper_checked` uses the student's scope lock and compares evidence/confirmed levels. Force these interleavings against the effective schema:

1. A different paper finishes scoring after the evidence comparison but before reservation commits.
2. A reviewer reclassifies a selected item after the level comparison but before the form's difficulty-freeze trigger runs.
3. A challenge adjustment or relevant scope edit lands in that interval.

The result must be an honestly pinned reviewed decision or a stale refusal with no partial reservation, never a form whose actual levels silently differ from its accepted preview. Ensure relevant writers share a consistent lock/revision protocol or an equally sound snapshot contract. Avoid unchecked compare-then-write sequences and deadlocks. Preserve the existing answer/submit, booking, repair and weekly-closure invariants.

Use a new additive migration only when required. Derive changed functions from their effective definitions and migration chain, retaining all later patches. Do not copy an early scoring function body or edit applied migrations. Verify clean install and upgrade if schema/functions change.

**Exit:** deterministic forced-interleaving proof, with the exact outcome and locks documented. If a source-level risk does not reproduce, explain why the invariant holds instead of claiming a fix.

## 5. Pass C — complete the first T5 student loop

Use existing services and canonical routes. Fix missing links/processes at their shared owner; do not add another readiness store or weekly-review tab.

### Journey 1: fresh self-study candidate, first real week

1. Mandatory onboarding supplies exam target, current position, availability and constraints. First-week estimates remain planning assumptions until reported time exists.
2. Home opens the exact next Calendar task. The student records completed, partial and missed work, including manual extra learning and an unconfirmed mapping.
3. Tests uses completed/confirmed cycle scope only. Partial/unconfirmed scope is resolved or remains explicitly pending; planned/missed work never becomes learned by assumption.
4. Weekly preview describes scope, timing, difficulty basis and bank gaps. It writes no attempt, exposure or plan. Start creates/resumes one paper.
5. A fixture paper contains a confident miss, unsure success and omitted item. Result separates paper score, confidence, timing, narrow evidence and untested scope. No subject-wide verdict from one answer.
6. Result opens its exact follow-up. “Keep for later” remains discoverable on Home/Tests/Coach; reopening it does not duplicate a repair thread.
7. Accept preview once. Calendar shows linked work with scope, reason, practical approach and completion meaning. Receipt replay creates nothing new. Accepted commitments remain protected.
8. Completing repair activity changes execution, not understanding. A fresh re-check is unavailable before work/spacing, available afterwards if inventory permits, and restricted to the intended concepts.
9. The installed resolution policy determines the thread's state. Do not enable automatic closure merely to produce a happy-path demonstration.
10. Before weekly closure, resolve all outstanding logs or explicitly mark unknown. Save a draft, inspect continuations/repairs and accept atomically.
11. Week two retains unfinished work through linked continuations; week one's minutes, evidence and history stay in week one. No duplicate scope or generated equivalent repair.

Use the real Monday–Saturday learning/Sunday test policy. Where testing elapsed time requires seeded history/test clocks, use the existing test-only mechanism and document fixture dating; never expose a production clock override or weaken spacing.

### Journey 2: midway candidate with classes

Start with three subjects reported covered and uncertainty in parts of two. Preserve prior first-pass coverage; uncertainty may schedule ordinary revision but is not fabricated diagnostic evidence. No forced restart or chapter-by-chapter baseline marathon.

Log an actual class and covered scope through the existing Calendar class-log flow. Verify the week boundary and pre-class assessment derive from the confirmed class pattern. Move/cancel a class after a proposal preview: acceptance must refuse stale assumptions, preserve inputs and offer a refreshed preview. Historical weeks never move.

Carry missed study and repair work through explicit review choices. Place new/continued work around real commitments and booked mocks. No-room cases remain unplaced/waiting or enter the next accepted cycle with choices; they cannot disappear or extend past their cycle through a drag/drop bypass.

### Journey 3: first pass complete, mock in a month

Use the existing revision/mock roadmap phase. Schedule revision, limited checks, a protected mock and debrief. Do not generate generic new first-pass Study tasks or spend the month testing every chapter sequentially.

For internal rehearsal, fixed-session policy and held-out freshness remain intact. For an external mock, provider/topic results are explicitly self-reported and cannot create internal question evidence. Both use the correct cycle's closure/credit contract.

Mock debrief identifies a manageable set of supported priorities, not one task per wrong answer. Preview repair/revision around existing work and preserve final-period boundaries. Verify no task or timed session after the exam horizon. Past Calendar is history; future Calendar is a forecast until accepted.

These entry journeys may share existing fixture helpers but must preserve their real differences. Do not turn every candidate into a fresh self-study account to simplify the test.

### Actual-bank limitation journey

Without fixture inventory, the same student sees accurate unavailable capability and a working planning/closure path. Confirm no broken diagnostic task, fake Ready state, generated-on-demand unreviewed question or access denial based on ability. The app can guide use of the student's own external practice without inventing its results.

## 6. Link and ownership contract

| Owner / event | Producers and consumers to verify |
|---|---|
| Confirmed learning | Calendar/Home capture, `/api/log-learning`, class-log context/preview/confirm, Curriculum coverage/marks → shared completed-scope service |
| Assessment capability | `/api/tests/preflight`, `/api/tests/start`, shared decision/assembly/reservation → Home, Tests, Curriculum and Calendar descriptions |
| Adaptive run | Existing run GET/next/stop routes, Practice panel, runner and result → original receipts, exact scope and correct Resume/Continue/Stop state |
| Result/evidence | Result API/page and authorised challenge resolution → Curriculum evidence/current status, Home signals, Coach selection and correct historical/as-of interpretation |
| Repair | Exact result → existing `/api/diagnostic/repair/check|preview|accept` → thread, proposal receipt and dated Calendar task |
| Calendar selection | `calendarTaskHref` carries the task's own date/week; continuation links open both historical original and successor |
| Coach | `?attempt=`, `?proposal=`, `?repair=` and their API context select the exact owned object; server chooses links and mutations |
| Weekly closure | `/app/review-week`, state/preview/accept commands → logs, saved draft, lineage, active cycle and accepted Calendar |
| Mock | Exact appointment → rehearsal start/session/hub or external result/debrief → combined result/credit → the correct cycle |

Opening pages or GET APIs changes presentation only. Explicit commands own effects. Scoring, a practice completion, a difficulty profile or a Coach explanation cannot silently rearrange accepted work. Coach explains strategy and broad curriculum/LOS priorities without teaching the chapter.

After a score/challenge/repair/closure, all affected surfaces refresh from the same committed truth. A stale or failed read is labelled/retried rather than replaced by zero. Wrong/foreign IDs show unavailable with a safe return action, never another current object as a substitute.

## 7. Proof, performance and cleanup

### Tests

- Add pure C2/C3 regressions and explicit scope-priority/holding boundaries before editing the policy implementation.
- Add endpoint C4/C5/C6 cases using synthetic reviewed levels and approved fixture commands. Keep practice evidence/repair/weekly-credit exclusion assertions.
- Test caller and database paths for foreign, unverified and incomplete-onboarding users on changed routes.
- Run the three lifecycle journeys through real endpoints. Use separate ordinary accounts and explicit routine/held-out records; assert fixture membership.
- Browser-check the primary self-study loop at desktop and 390px, including repair acceptance → exact Calendar task. Also browser-check stale scope in a second tab and insufficient-bank Week state, which have been repeatedly deferred.
- Click the reviewer-level confirmation UI and weekly difficulty details; test mobile focus, keyboard, conflict recovery and no overflow. Second-tab Continue/Stop and adaptive shortage need browser proof as well as HTTP coverage.
- Use Browser when available; otherwise installed Playwright with a recorded fallback. Capture a state assertion after each important interaction, not just a screenshot or navigation.
- Run `npm run verify` on the final tree. Record true failures rather than skipping a red audit and declaring success. Do not disable checks to pass.

### Bounded performance check

Measure only the changed critical paths and any reproduced slow request: preflight/start, run state/Continue, result/follow-up, review accept and progress. Capture sequential and limited-concurrency timings with sample sizes, status/error codes, request ID and query/stage counts. Use a realistic-history fixture in addition to a blank account.

Avoid per-set N+1 reads and silently truncated history where the new scope correction touches them. Share request-local reads when useful; no new cache platform or infrastructure without a measured need. Do not weaken access or freshness validation to reduce latency.

The earlier 29–70-second heartbeat and concurrent-suite failure remain unclassified unless reproduced and explained. A fast rerun is not a cause. Keep failures from shared fixture cleanup, session overlap and real concurrency separate.

### Cleanup and schema proof

Use exact recorded fixture/account IDs. Do not delete global test prefixes belonging to another worker. Stop only your own processes by recorded handles. Restore canonical generated types. New migrations require baseline, effective-function and install/upgrade/restore proof; no pending/checksum drift may be silently ignored.

Keep genuine source/candidate/reviewer records. None should be created, approved or removed just to make a lifecycle fixture pass. The configured development/staging files may point to the same disposable project; filenames do not provide isolation.

## 8. Handoff

Report:

1. C1–C6: reproduced cases, fixes and exact proof; distinguish pure/source/endpoint/browser evidence.
2. Which lifecycle journeys a student completed and their routes.
3. Policy compatibility, replay receipts, mark/evidence/repair integrity and historical preservation.
4. Tests, failures/skips, browser widths and any remaining unrun matrix.
5. Measured critical-path performance and unexplained issues.
6. Schema/baseline state and cleanup.
7. Actual content capacity separately from fixture correctness.

Do not call the app market-ready while real question supply is zero. Software completion and content activation are separate tracks. Source packs, documented rights, concept sign-off and named human review remain required; the agent must not perform those decisions as the owner.

After this handoff, the next prompt can address the remaining T5/T6 long-horizon cases and final cleanup/performance, rather than restarting Tests or difficulty development.
