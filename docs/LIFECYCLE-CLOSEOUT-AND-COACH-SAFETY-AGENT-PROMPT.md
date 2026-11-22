# Roadmap — connected lifecycle proof and Coach safety closeout

Prepared 13 November 2026, following Coach slice 2 and master status §9.30.

## Assignment and scope

Build and prove the three connected student journeys: fresh self-study, joining midway with classes, and first pass complete near a mock. Fix the bounded Coach/Calendar gaps below first, then complete the journeys and their browser matrix. Do not return another list of existing disconnected suites as proof of the loop.

Read `AGENTS.md`, Ponytail, the founder decisions, master status §§9.28–9.30, and the two preceding Coach prompts. Read installed Next.js guidance before framework edits. Preserve the dirty tree, current approvals, access guards, scoring/difficulty policies and existing atomic commands. No commits, pushes, deployment, payments, domain/auth setup, staff-role grants or wholesale redesign.

The configured project is the owner's disposable development project; do not imply that an environment filename makes it a separate staging environment. Validate the target through existing test/migration guards. Keep tests off real student data.

This slice ends with a connected, browser-proven product loop and fixed placement/interpretation defects. Private source packs and the input-use permission gate are the next separate content slice. Do not generate a large question batch, approve legacy questions or bypass the exact-version human-approval rule here. Zero eligible real-bank inventory does not block fixture-based software proof, and fixtures do not establish real diagnostic coverage.

## 1. Accepted work and review findings

Preserve the delivered model interpreter, actual move proposal, turn payload binding, worker lease, outbound-call reservation, atomic Clear and exact-turn replay. Do not rebuild them. The owner-review pass reran 90 interpretation checks and 44 response/evaluation cases successfully. The deterministic 48-case hold-out ran successfully under its current gates, with 43/46 routing matches. These are not a fresh database or browser certification.

The following need focused reproduction and closure:

| Finding | What must be true after this slice |
|---|---|
| Confirmation ignores newly changed classes/commitments | A protected occurrence or unavailable interval added after preview cannot be overlapped by confirmation. Validate inside the transaction with the existing schedule-lock discipline. Test both race orders. |
| Slot picker is not personalised | `pickSlot` searches 08:00–21:30 and knows only occupants. It must use the student's actual allowed windows and existing constraints; a student free only 06:00–07:00 must not be offered 08:00. |
| Date/time clarification can dead-end | `resolveDay('2026-11-14', ...)` cannot resolve the date. The current same-day refusal asks “what time?” without a complete time-rescheduling path. Support the exact date/time through existing helpers or a real picker; no repeated unusable question. |
| Calendar and Coach moves can diverge | Calendar's `moveTask` remains read-then-write while Coach uses a separate SQL command. Share the mutation/validation boundary and run a parity matrix, preserving intentional soft-overlap warnings. |
| Model-only exclusions are lost | An excluded-only description fails `requests.min(1)`. A valid mixed description whose teaching span falls outside the regex grammar loses its teaching flag in `toInterpretation`. Safely retain semantic exclusions without reintroducing false refusals of study-method help. |
| Complex matched requests skip semantic review | The model runs only when primary intent is `free`. A keyword match must not suppress clarification of a complex, negated or multi-clause command. Preserve zero-model fast paths for genuinely clear requests. |
| Selected context remains incomplete | Repair/proposal cards are not sufficient if chat answers from an unrelated latest result. Complete relevant repair/proposal/appointment/rehearsal/LOS context through page → client → API → loader where these journeys use it. |
| “What next?” still differs and is expensive | Coach's task selection must agree with Home's canonical priority. Measure the current heavy path and remove demonstrably duplicate/per-item reads without changing the state contract or hiding errors. |

These are source observations and pure-helper probes. Reproduce endpoint effects before changing code. If a current trigger already protects an invariant, demonstrate it and reuse it. Do not duplicate the same rule in another unconnected layer.

## 2. Gate A — close placement and interpretation integrity

### One scheduling mutation boundary

Trace Calendar drag/edit, Coach preview/confirm, commitment/class edits and booked mocks. Use the existing booking and scope locks consistently; do not merely compare in TypeScript immediately before an unlocked write.

The committed move must validate the task's current owner, revision, execution, continuation status, cycle, exam horizon, target local date/time, protected time and relevant setup changes. Task update, history event, proposal outcome and receipt must commit together. Started/partial work and historical minutes must retain their established semantics.

Preview slot suggestions inside the saved study windows, after recurring commitments, occurrence exceptions, classes, mocks and current tasks are considered. Respect existing sitting limits and prior placement preferences. A requested exact time is not replaced silently by a convenient one. No fitting slot means offer feasible alternatives or explicitly unplaced/day-only work, with no claim that a study period has been found. Do not automatically convert unavailable time into capacity.

Preserve product policy: default automatic proposals avoid conflicts; Calendar's allowed soft overlaps still require their existing explicit warning acknowledgement. Hard constraints remain hard. Do not redesign overlap policy to make parity tests pass. A cross-cycle move uses the existing weekly continuation flow; it never shifts the old week's learning/time into the new week.

Require parity tests for ordinary move, deferred-task reopen, protected conflict, soft overlap, stale task, changed class/availability, continuation, same-day time edit, overnight boundary, cancelled task, exam horizon and wrong owner. Test a class/commitment change versus confirmation in both winning orders, two simultaneous moves into one proposed free slot, and rollback after an event/receipt failure. Document intentional differences such as Coach declining to modify a started task instead of falsely claiming both interfaces are identical.

### Semantic boundary and usable clarification

Allow a validated exclusion-only or unresolved description; the model must not invent a planning intent just to satisfy the schema. Retain semantic no-teaching information even if an unfamiliar phrase is not in the regex list. For ambiguous content-versus-method requests, clarify or give bounded planning help; do not automatically refuse all “explain” requests or silently ignore the excluded part.

Keep server-owned response facts/actions. A model exclusion is not evidence about the student. Request spans, candidate references, IDs and ownership remain validated. Test an unfamiliar explanation request, a mixed unfamiliar explanation/planning request, negation and false-refusal pairs. No answers were shown to leak in the review; this is a boundary-conversion defect to close and test.

Add a small unseen paraphrase set and exercise it through the actual interpreter orchestration with a counted simulated provider. A list of accepted proposal kinds or `/app` URLs is a structural check, not factual-grounding proof. Label it accordingly; test fact/action references against the supplied owned state. Fail evaluation on wrong actionable routing, not only forbidden-action labels.

Version changed deterministic/schema/prompt behaviour accurately. Reuse the new gateway, call limits and cancellation. Do not widen provider retries or add expensive calls to clear requests.

## 3. Build three durable lifecycle journeys

Use shared helpers, an explicit `actual` or `fixture` bank track, and one ordinary student throughout each journey. A single runner with three named scenarios is sufficient; avoid duplicated harness code. Expose three runnable commands/scenarios and a combined runner. Never run resetting suites concurrently on the same account.

Actual-bank shortage is **UNAVAILABLE**, not a passed diagnostic. Fixture mode must refuse a missing/wrong fixture record and assert the delivered item IDs belong to its recorded eligible inventory. Routine and held-out rehearsal inventory are distinct. Keep fixture IDs, families, exact approval versions and source attempt kinds in the evidence report. No production approval claim comes from synthetic data.

Drive user actions through current application commands. Fixture setup may create dated history and inventory under existing guards, but must not pre-create the result/repair/continuation that the journey purports to produce. No disabled spacing, scope permission or production-clock bypass.

### Journey A — fresh self-study through the following week

1. Create a verified ordinary student, complete the real onboarding and accept the first plan. Use a distant tentative exam window; later booking must preserve a real path to update the exact date.
2. Confirm the self-study rule: Monday–Saturday learning, Sunday paper. Joining midway through a week creates only a useful remaining-week plan; do not fabricate past study or force an excessive catch-up week.
3. Complete real Calendar blocks, record partial work with minutes, miss/defer another, and log independent learning through the existing capture flow. Curriculum, Home and Calendar agree on activity and reported coverage while demonstrated understanding remains separate.
4. Preview weekly scope. Include the completed/confirmed manual learning, exclude unfinished learning, and leave unconfirmed scope visibly pending without blocking confirmed work. Assert no question comes from an uncompleted outcome. Freeze scope on the reserved paper.
5. Start a **weekly diagnostic**, answer with mandatory confidence, include a confident miss and an omission, refresh/resume, and submit. Assert score denominator, completion, evidence source, family independence and reserved difficulty policy.
6. Open that exact result in Coach. Explain the observed weakness and limits without teaching. Keep its follow-up for later, navigate away and rediscover it through Home/Tests/Coach. Accept repair work once and open the exact task in Calendar.
7. Finish repair work, respect the spacing period, then place/start an independently eligible re-check. Assert the re-check covers the intended concepts and does not close a thread just because work was logged. Use the currently approved repair-closure policy; do not invent a new threshold.
8. Resolve logs and open the existing weekly review. Record Done/Partly done/Not done/Not sure separately from Continue/Keep later/Remove. Preview, save and accept the next week's draft. Replay the lost acceptance response without duplicate cycles/tasks.
9. Prove continuation lineage, mapping, objective, method and repair link survive. Record 20 minutes partial in the original week, then 25 minutes finishing its continuation: 45 total, attributed 20/25 to the right weeks, effort counted once. The completed week stays history.

Add an adaptive-practice branch on this same student's valid scope. It writes no diagnostic evidence, creates no repair and earns no weekly-paper credit. Never use practice as a substitute for the evidence-bearing chain above.

### Journey B — midway entrant with classes and uncertain covered work

1. Onboard a student reporting three subjects covered, uncertainty in some areas, and remaining first-pass work. Reported coverage is not scored mastery; do not restart completed subjects or force a chapter-by-chapter assessment baseline.
2. Use a realistic non-Monday class pattern. Class timing defines the applicable cycle and pre-class diagnostic. If multiple class patterns need a choice, use the current product rule and expose it clearly; do not impose self-study Sunday scheduling.
3. Log an attended class from Calendar, confirm taught reading/LOS mapping, and preview the resulting preparation/revision/paper changes. Duplicate confirmation logs it once. The number of future study hours changes only as actual work/constraints require, not by multiplying a hidden capacity factor.
4. Have Coach interpret a typo-filled class/recovery request and open the exact editor/preview. Move a class, change availability or add a commitment after preview. The old confirmation is refused with input preserved and no partial writes; rebuild and accept against the changed schedule.
5. Confirmed taught/completed scope feeds the appropriate diagnostic; revision-only scope feeds the current revision-paper mode. A mixed week follows its documented assembly rule, rather than being silently labelled practice. No questions from uncompleted next-class content.
6. Accept a weakness follow-up and continue remaining first-pass work around classes. Work that cannot fit stays explicitly waiting or enters the next-cycle continuation flow. Preserve the prior week, historical class occurrence and reported time.
7. Home, Calendar, Curriculum and Coach agree on priority after acceptance. Calendar's historical week is history; its future view is a forecast until accepted. Exercise both a changed single class occurrence and the next cycle after that change.

### Journey C — first pass complete, mock in a month, through the final week

1. Onboard a self-study student reporting first-pass completion and a mock/checkpoint about a month away. Do not emit generic first-pass tasks or demand one diagnostic per chapter before a useful revision plan.
2. Show revision rotation, specific weakness work and mock preparation from the existing roadmap. A subject completed early releases future effort; missed work causes reviewed adjustments. There are choices under pressure, not panic warnings or a pass prediction.
3. Book a mock around actual classes/commitments. Move it after a preparation preview and prove the relevant preparation basis becomes stale. A label-only edit should not demand unnecessary re-planning.
4. **Internal rehearsal variant:** use sufficient held-out fixture families, the current fixed two-session blueprint, independent clocks and combined result. Concurrent starts resume one reservation. Debrief leads to a manageable set of linked repair/revision choices, not a duplicate backlog for every missed item.
5. **External mock variant:** record topic scores and debrief as self-report. It may satisfy the configured weekly checkpoint decision, but creates no fabricated item-level diagnostic evidence. Coach says which source it is using and opens the exact appointment/result.
6. Complete the appropriate closure, carry unfinished work safely, and inspect the next accepted revision cycle. A challenge/void must update the related finding/repair correctly through the established invalidation flow, not leave a stale confident claim in Coach.
7. Inspect a dated final-week scenario, booked and tentative targets, and exam-sat state. No planned study goes beyond the applicable horizon; completed history survives; exam-sat removes countdown/weekly pressure while retaining results and follow-up.

## 4. Route and state connection map

Build a compact route ownership table in the lifecycle report from actual code. At minimum verify:

| Connection | Required linkage |
|---|---|
| Onboarding → Home/Calendar | Saved context, accepted cycle and plan match; incomplete setup cannot enter the app. |
| Calendar ↔ Curriculum ↔ learning log | Same reading/outcome identity, actual activity/date/minutes and separate self-report/evidence. |
| `/app/calendar/log-class` → class-log context/preview/confirm | Actual class occurrence and taught mapping drive future planning once. |
| `/app/tests` → preflight/reservation/runner/result | One assessment decision, frozen scope/policy and honest inventory capability. |
| Result → repair preview/accept → Calendar | Exact source attempt → repair thread → accepted task; no title-based matching. |
| Result/repair/appointment/rehearsal → `/app/coach` | Selection survives through the API; no fallback to an unrelated latest result. |
| Coach preview/confirm → Calendar/Home | Exact actual placement/receipt, consistent next action and no render-side mutation. |
| `/app/review-week` → preview → draft → accept | Current `/api/weekly-review/*` contract, stale token, saved answers and retry-safe next cycle. |
| `/app/exam` and Settings setup editors → planner | Canonical atomic editor, changed horizon and stale previews, with unrelated setup fields preserved. |
| Past/future Calendar deep links | Correct cycle-owned tasks, historical results/appointments, useful unavailable states and forecasts. |

List actual parameters, caller, service/command and affected records. Keep legacy retired endpoints explicitly retired; do not restore them to satisfy stale scripts. No standalone Materials/sources tab or new weekly-review tab. Do not confuse GET rendering with an action that should prepare/start something.

## 5. Browser matrix and evidence

Run the three journeys at desktop and 390px, not just HTTP. Use Browser if available, otherwise installed Playwright and record the fallback. Reuse stable endpoint fixtures; assert persisted state after significant UI steps, not just navigation/screenshots.

At each viewport cover the defining path of each student: first accepted plan, real learning capture, assessment/result, exact Coach/repair handoff, Calendar placement and weekly closure. For long papers, a few answers can be entered in the browser and the remainder through the actual answer API, then submit in the UI; report that split. Do not seed a scored result and call the runner browser-proven.

Include focused edge paths:

- Keep for later → navigate away → rediscover the same follow-up.
- Insufficient actual bank → planning continues with an honest capability message.
- Scored diagnostic versus practice selection in Coach, and linked rehearsal/repair context.
- Class/availability change after preview; both stale refusal and a fresh successful acceptance.
- Lost send response and lost confirm/weekly-accept response after commit; retry returns the same outcome.
- Two tabs with stale scope and two browser contexts for Clear versus Confirm.
- Provider failure in the page: clear requests still work, unclear mutation requests clarify safely.
- Morning-only availability, exact-date/same-day-time change and no fitting slot.

Check long labels, keyboard order/focus return, IME, loading/retry states, console/hydration errors and no horizontal overflow. An unavailable local server or missing fixture is a setup failure, not a passed or failed product assertion.

## 6. Test ownership, measurements and completion

Register test accounts and fixture IDs immediately after creation, before sign-in/onboarding can fail. `createStudent` currently registers with its caller only after those steps; close this cleanup gap so an unavailable server cannot leak an orphan. Preflight the intended local server and validate fixture mode before remote mutations. Cleanup by recorded owned ID only, including after failure. Avoid hardcoded global task IDs that collide across runs.

Run lifecycle scenarios sequentially per student. Only controlled race tests should create contention. Preserve other workers' banks, roles, processes and dirty files. Stop only owned recorded process handles. Restore generated types through the existing helper; do not manually rewrite generated files or delete a shared `.next`.

Measure the canonical Home/Coach next-action read with realistic multi-month activity and the three changed critical paths. Attribute read counts and stage latency, separate cold/warm and sequential/bounded contention, and compare decisions before/after any optimisation. Share request-local reads or bulk queries where appropriate; no public cache of account data. Do not let a broad performance rewrite replace the lifecycle work. Keep the older heartbeat/run-state outliers explicitly unclassified unless captured with enough evidence.

Run full `npm run verify`, type checks, affected Coach/access/booking/task/repair/weekly-review/entry/class-log/rehearsal suites, and the durable lifecycle runner. New additive migrations require effective-function comparison, clean-install, upgrade, restore and ledger/checksum proof through the current runner. Never edit an applied migration or copy an older function body over later fixes.

Report, concisely:

1. Reproduced defects and actual fixes, with any unproven source observations separated.
2. Journey A/B/C outcomes, bank track, source attempts, linked repairs/tasks/cycles and assertion receipts.
3. Desktop/mobile matrix: browser, endpoint-only, failed, unavailable or not run.
4. Race/rollback/access proofs and preserved product policies.
5. Performance samples/read counts and unresolved outliers.
6. Schema/verification state, exact cleanup and remaining gaps.

Update the master status. Do not stop after Gate A and describe the journeys as future work again. If an external prerequisite prevents one branch, finish every independent branch and identify the exact blocker. Do not call this market-ready while actual approved question capacity is zero. After this slice, the next prompt will prepare private source packs and the input-use permission gate; that content work remains necessary.
