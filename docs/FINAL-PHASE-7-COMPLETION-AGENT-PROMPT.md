# Phase 7 completion — finish the command boundaries and the whole student lifecycle

Continue the authorised Phase 7 implementation in the current checkout. The first slice is useful but partial. Finish the remaining work; do not ask the owner to choose an order again or deliver another “which journey next?” handoff. Work in this order: **safe test cleanup → command/identity corrections → Journey B → Journey A → Journey C → shared cleanup and final gates**. Do not start another phase or rebuild passing pages from scratch.

## 0. Establish the current baseline without repeating every test

Read `AGENTS.md`, required Ponytail guidance and installed Next.js docs for the APIs touched. Read:

- `docs/FINAL-PHASE-7-LIFECYCLE-AND-CLEANUP-AGENT-PROMPT.md` — original requirements remain binding;
- `docs/PHASE-7-FIRST-SLICE-REVIEW-2026-11-19.md` — source findings to reproduce and close;
- master status §9.56–9.57, `docs/evidence/phase7-first-slice-2026-11-19.json` and its source snapshot;
- founder decisions, effort model, route/state ownership, Curriculum route map and Phase 6's field/connection matrix.

The reviewed tree matches `04fff4332dbd2a91`. Compare again and account for later work rather than overwriting it. Preserve the dirty tree. No commits, pushes, deployments, payments, domains/OAuth provisioning, real provider calls, real mail or owner-account operations. The configured project `asylsxszdhlnzewhwtga` is authorised disposable development; the staging env is the same database. Preserve the owner's server, previously PID 84412, after checking current identity.

Reuse the new manual creation and occurrence models. Do not add a second planner, operating-state contract or evidence model. Fix the specific incomplete contracts below. Reproduce meaningful failures before changing their shared cause where feasible; a newly introduced command needs its own invariant tests rather than a fabricated historical red run.

### Product rules stay fixed

Roadmap tells students how and when to study and helps manage deviations. It does not teach chapters, promise a pass or prescribe a universal weekly-hours target. Onboarding is required context capture, not a feasibility verdict. Low capacity or unavailable questions never removes planning access.

Self-study uses Monday–Saturday with Sunday paper/review. Classes define class-led cycles. A new unaccepted transition closes before the next class even if short; accepted history stays unchanged. New confirmed scope gets diagnostic questions; previously covered scope gets revisionary questions; mixed papers label the mix. Only completed/explicitly confirmed scope is testable. Part/continued stays pending until explicit whole confirmation. No paper exceeds 90 questions; a rehearsal remains two linked sessions with separate clocks.

Coverage, actual minutes, confidence and demonstrated evidence stay distinct. Cards, practice and external mock reports create no demonstrated concept evidence. Overall mock scores cannot justify invented topic weaknesses. Repairs close only through the established valid independent-evidence rule, never merely from completing a study task.

Manual longer/out-of-window sittings require the existing one-time warning per edit. Generated work follows saved limits. Protected bookings, order, cycle and applicable exam boundaries stay hard constraints. No automatic displacement of accepted work or movement of historical minutes across weeks.

## 1. Close first-slice integrity and reliability gaps

### 1A. Make the test harness safe first

Remove the `tm-%@example.invalid` deletion sweep in `scripts/task-create-db-test.cjs` before executing it. Register exact IDs created by this run and delete only those IDs in `finally`. A durable owned-run manifest may support interrupted-run recovery, but a name prefix or creation date is not ownership. Leave old/other-worker accounts untouched. Check touched scripts for the same pattern.

### 1B. Finish manual task creation's receipt contract

The current transaction correctly creates task plus history together, but replay compares against the mutable task and omits detail/priority. The service runs current-date/occupancy checks before replay. Replace this with the smallest durable command-receipt pattern already used in this app:

- Bind an owned key to the complete canonical original request, including normalised detail, priority, type, selected date/time/duration and any other semantic creation fields. UI warning acknowledgement is not itself a second task request.
- Persist the original creation result atomically with task/history. Same key/same original request replays the same creation outcome after editing, completing, moving or cancelling the task, midnight, rollover and later changes to availability/bookings. A replay must not revert later task state. Show current task state separately if needed.
- Same key/different semantic request refuses without any write. Retain receipts after ordinary task cancellation/deletion according to existing history semantics; never recreate work because its current row disappeared. Do not silently backfill a “known original payload” for old tasks where none was stored; provide an honest compatibility result.
- Run immutable access/ownership and payload-shape validation on every call. Resolve existing valid receipts before mutable scheduling checks; new creation still validates its real current constraints under the per-student lock.
- Verify no-active-cycle, closed/future cycle and clock-boundary behaviour. A new task must belong to the intended accepted cycle; otherwise return the existing prepare/review action. Do not create an orphan with `cycle_id = NULL` just because no active row was found.
- Preserve one warning, accessible toolbar creation, explicit day choice and dedicated commands for repairs/checks/mocks. No false success or generic “nothing added” after an uncertain transport outcome.
- The database-race conflict path must retain actionable event links where available, as the ordinary preflight path does.

Proof: full-payload mismatch including detail-only and priority-only changes; retry after task edit and midnight/rollover; task cancellation/deletion; same-key concurrency; competing booking/close-cycle; missing cycle; forced history/receipt failure; lost response **after database commit but before the route gets its result**. Assert exact task/event/receipt counts and unchanged later task state. Browser: lost response/retry and warning at desktop and 390px. Existing simple immediate retry remains a regression, not the entire contract.

### 1C. Finish occurrence authority and explicit succession

`loggedBeforeSuccession` currently matches same labels and adjacent dates. Replace guessed lineage with the existing class-change receipt's explicit `commitmentId` → `successorId` relationship, or an equally authoritative persisted relation. Include unrelated same-name series as a negative control. Labels must never be identity.

For a **new** class-log commit, verify the actual owned occurrence under the established lock: recurrence membership, original date, moved effective date, skipped/cancelled/archived state and supplied class date. A new direct command cannot attach a log to an arbitrary date merely by naming an owned class. An occurrence changed after preview must be refused atomically with input retained and a useful refreshed preview. Preserve legitimate receipt replay after later schedule changes. Review both RPC signatures and all effective grants; a compatibility wrapper must not bypass the intended new-write authority.

Owner decision §21, confirmed 19 November 2026: allow in-progress reporting of already-covered material and keep class completion separate. Preserve one occurrence/session across versioned updates and later finalisation, with no duplicate scope/work/evidence. Remove the blanket end-time gate without weakening occurrence ownership, cancellation/move, lock or replay checks. Implement the complete incremental flow and proof in §2A of `docs/PHASE-7B-CLASS-LED-LIFECYCLE-AGENT-PROMPT.md`; simply allowing an early one-shot log is insufficient. Never present date alone as proof a class ended or that any outcome was covered.

Carry identity, original/effective date and a useful class label through obligations, class-item/task provenance, weekly review, continuations, Calendar, Curriculum and Coach. Keep historical identity intelligible after renames/archive/deletion with a safe fallback. Do not restore a cleared `class_session_id` on continuation or duplicate scope/minutes to achieve labels.

Legacy date-only logs remain readable and unresolved. Do not guess mappings or build a bulk association wizard. If unresolved rows prevent legitimate new classes from being logged, provide the smallest explicit resolution/separate-session choice with ownership/revision checks and no duplicate history, tasks or coverage. Otherwise safe unresolved display is sufficient; the mere absence of an association UI is not a blocker.

Proof: restore-versus-protected-booking races in both orders; move/cancel between preview and confirm; invalid direct occurrence/date calls; two independent same-name classes; explicit series succession; same-day sessions through rollover; one full and one partial outcome with no leakage; original links and exact minutes retained. Test the UI handoffs, not only row IDs.

## 2. Repair and complete Journey B first

Diagnose the current failure before changing it. `journey-b` assumes two pending **dates**, but the feature now represents pending **occurrences**, including two on one day. It also uses UTC `today`. Use the student's timezone and a coherent, recorded owned clock/fixture with the intended occurrences actually available. Do not change real cycle rules, remove the precondition or force two dates just to make the spec green. Handle a legitimate first class week with only one available occurrence honestly.

Drive UI onboarding → actual classes → two distinct same-day selections → full/part/continued logs → ordered feasible consolidation → confirmed scope → diagnostic/revisionary/mixed preflight → runner/confidence → result → Keep for later → follow-up → exact Calendar repair → eligible fresh re-check → weekly review → continuation/next cycle.

Include a moved class after preview and its reviewed recovery, a stale tab, lost acceptance reply, no room/owed work, short transition before the next class and explicit whole confirmation after a partial portion. Check Home, Calendar, Tests, Curriculum and Coach agree on the same class, reading/outcome and next action. A correct selection in the form alone is not end-to-end identity proof.

Capture and diagnose the mobile hydration mismatch from `class-editing`: actual console message/component stack, server versus client value, timezone and fixture state. Fix a reproducible shared cause. If it remains intermittent, add a deterministic stress/negative control with strict failure capture; rerunning until green or widening an error allowance does not establish resolution. Retain an honest open finding if its cause remains unproven.

## 3. Complete Journeys A and C

### A — self-study from first week through revision

Drive onboarding → first accepted baseline → next action → partial actual minutes → reload → confirmation → paper → result → optional mistake note/card → accepted repair → spaced check → weekly closure → exactly one linked continuation → next-week adaptation.

Use coherent labelled long-horizon fixtures for the months, not hundreds of silent API actions claimed as UI proof. Demonstrate first-pass completion, remaining scope, revision rotation and repeated revision. Show ahead-of-plan learning (FSA plus CI when only FSA was planned), slower progress, unknown minutes and a break/return. Future drafts adapt; accepted history does not rewrite. Already-covered material must not restart as generic first-pass study, and partial chains must not count their effort twice.

### C — mature February entry, poor mocks, final weeks and exam history

Enter with first pass and revision complete, an upcoming February exam and weak mock results. Do not require 102 chapter tests or a beginner restart. Drive a saved external report/debrief → chosen topic/timing concern → bounded preview → acceptance → actual work → later result/report → next-week adjustment.

Cover overall-only score without topic inference; topic-specific weakness; slow-but-correct; rushed omissions; high-confidence wrong and repeated plateau, using the recorded source/sample for each claim. Respect available time and offer calm choices when scope does not fit. No assumed universal mock frequency.

Drive the existing held-out two-session rehearsal through booking, protected time, start/resume and separate clocks, both sessions, combined result, weakness work, later check and week closure. Also prove external mock as an alternative. Show the final eight weeks and final week: revision/retrieval, realistic mock/recovery spacing and no generated work after the permitted horizon. Exam sat pauses prompts but preserves history. Moved/missed exam asks rather than assuming attendance. Retake preserves the former attempt and its records.

## 4. Close the shared deviation matrix and cleanup

Map the original §3 matrix to existing proofs before running more tests. Reuse unchanged proofs with exact scope; add missing high-risk cases without an exhaustive Cartesian product. Cover inconsistent deferrals without judgement, changed availability/limit, classes-finished/undo, no useful windows, empty week, midweek entry, changed target/mock, partial carry, lost/stale/concurrent commands, bank shortages/exposure/held-out families, challenge/void, failed later reads, provider-free fallbacks and cross-account/incomplete/unverified/reviewer boundaries.

Assertions must check tasks, immutable receipts, minutes/events, scope revisions, form IDs, evidence validity, repairs, cycle boundaries and grants—not just toasts or HTTP 200. Reads render without mutation. Scope shortage never tests uncompleted outcomes or turns synthetic capacity into a live claim.

Finish the caller/route/anchor/legacy-label and unused-code inventory. Fix reached dead links and stale scripts. Use owned disposable students and explicit bank modes; retain intentional redirects/410s. Delete only proven unused code. Do not remove private source packs, unrelated dirty files or evidence to make the tree look clean.

Measure ordinary and realistic-history reads and p50/p95 with the Phase 6 approach, running alone with the same disabled provider configuration. State sample size/cold handling; separate instrumented HTTP reads from SQL counts. Preserve paging/errors, remove a proven duplicate before adding cache and never cache student state globally. Do not diagnose long stalls as host sleep without evidence.

Re-read the canonical **actual** question-bank report after all registered synthetic fixtures are removed. Report current-version approved routine/held-out inventory and families, not status-only counts. Real approval/rights and real-provider quality remain external; do not fabricate them, start batches or spend money to satisfy this phase.

## 5. Final gates, evidence and stopping rule

For changed contracts: meaningful pure, HTTP/database and desktop/390px browser tests, including failures, replay, concurrency and ordinary-user access. Run full `npm run verify`, canonical TypeScript, route audit, isolated production build and read-only migration preview on the final runtime tree. New schema requires fresh additive migrations plus clean install, upgrade, restore and effective ACL/RLS proofs. Start from current live function definitions, preserving later patches; never edit applied files.

Keep strict console/hydration capture, configured viewport/client-width checks, keyboard equivalents, focus return, IME, reload, pending controls and error recovery. Allow only exact induced failures or proven read-only cancellations. A green retry cannot erase a prior unexplained failure.

Produce one requirement-to-proof checklist with separate implementation, endpoint/DB and browser status. Record seeds/time shifts, simulated services, failures/fixes, reused proof, all final exit codes, migration hashes, actual versus fixture inventory and cleanup. Update route/connection maps and one master-status section. The fingerprint file-selection policy must be explicit: the Phase 7 script includes assets such as a pre-existing SVG which Phase 6's extension filter omitted; do not describe that as newly added application code or silently rewrite historical snapshots.

Use the isolated wrapper, stop only verified own processes and restore generated types through its supported recovery. Do not use `git checkout` to restore shared files that another worker may have changed. Clean exact owned records/outputs/locks and verify the owner's server remains alive. Preserve unrelated accounts.

Complete all independent authorised work in this prompt. Only say **Phase 7 software-complete** when the command boundaries, B/A/C journeys, deviation coverage, cleanup and final gates are proved. If a required outcome remains unresolved, state it as partial with the captured evidence; do not rename the phase complete or quietly move required work into a new phase. Real content readiness and operational launch readiness must be separate conclusions.
