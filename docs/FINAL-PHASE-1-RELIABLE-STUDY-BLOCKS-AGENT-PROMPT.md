# Roadmap final phase 1 — feasible study blocks from every learning entry

Implement this bounded first package from `FINAL-FUNCTIONAL-COMPLETION-PHASES-2026-11-15.md`. Do not restart B3 or begin late-mock recovery, question-bank growth or a page redesign. Read `AGENTS.md`, Ponytail, the relevant installed Next.js guides, master status §9.39 and the current files before editing. Preserve unrelated dirty work and other workers' accounts/fixtures/processes.

## Goal and known evidence

A student logs a class and receives study work that fits the actual remaining windows and their comfortable sitting length, with meaningful instructions and truthful no-room handling. The same scope remains pending/full through split sittings and later continuations.

The owner browser audit on 15 November reproduced:

1. A student with `profiles.max_session_minutes=45` received one **88-minute** revenue-recognition consolidation task and one 44-minute partial-EPS task.
2. Around **19:54 Asia/Kolkata**, preview placed those **132 minutes on the same Sunday**, whose only availability was **09:00–13:00**, and said “This fits comfortably.” Both tasks persisted through the real class-log confirmation.
3. The resulting task drawer supplied only “Consolidating what you covered in class,” with no useful activity/completion/verification detail.

Source: `src/lib/planning/classlog/consolidation.ts` has a fixed `MAX_TASK_MINUTES=90` and does not receive the student's limit. The service builds today's room using whole-day `dailyCapacityMinutes`, rather than remaining local-clock availability. Reinspect current code; do not assume these findings are already fixed by B3's class-change recovery. B3 fixes existing tasks after a class edit; this defect is in creating new tasks from class learning.

Audit evidence is in `/Users/advay/Downloads/Roadmap-Audit-Evidence-2026-11-15/steps.json`, especially the class-log preview and backend placement check. The disposable audit student is deleted; do not attempt to reuse it or reconstruct it from another student's rows.

## 1. Reproduce, then fix the shared cause

Create small deterministic regressions and one fresh ordinary-student journey. Capture the old planner's oversized and elapsed-window output before editing where safe; no reverting the dirty tree to manufacture a red run. A service-injected clock in tests is acceptable. A public production time/failure bypass is not.

Reuse the existing placement-context/free-range and sitting/group helpers. Pass the actual local clock, date, timezone and sitting limit through class preview, confirmation and consolidation. Subtract real classes, commitments, mock bookings and accepted load using the same authoritative rules as the weekly planner. Do not count overlapping windows twice or subtract the same work twice.

For today, only time that still exists may receive proposed work. For later dates, respect their actual windows, cycle/exam bounds, class-follow-up ordering and the route's existing assessment-day policy. No study may be added to an earlier date merely because that day originally had room. Do not fill an expired day with day-only tasks as a workaround.

Split generated work into linked sittings no longer than the student's configured maximum, retaining the total proposed effort/minutes when it can fit. Respect real contiguous windows where a task requires a contiguous sitting; a sum of fragments is not a single usable gap. Keep the planner's existing minimum-piece rules coherent, without silently rounding away outstanding work or inventing additional minutes.

No-room work remains visible and recoverable under the existing carryover/weekly-review contract. State what is unplaced and why. If some work fits, report placed versus remaining scope/effort accurately; do not enqueue the full amount again as well as its placed portion. A “comfortable” verdict requires actual remaining capacity, not full-day capacity before the clock/commitments were considered.

This cap applies to **generated proposals**. It is not permission to reject a student's report of a genuinely longer sitting, rewrite actual minutes, or silently override an explicit manual edit. Preserve established manual-edit semantics and clearly distinguish plan assumptions from reported study.

## 2. Preserve scope, history and atomic confirmation

Reach every affected caller: class-log context/parser/service, pure consolidation planner, preview DTO/UI, confirmation RPC/validation, task constructors, fingerprint, task drawer and tests/fixtures. Inspect effective deployed functions before proposing additive SQL; do not overwrite a later patch from an old migration body.

Opening or previewing the class log must not write learning/task evidence. Confirm retains its existing atomic, keyed, retry-safe contract. Include material sitting-limit, capacity and time changes in staleness checking. When the clock crosses the last usable window after preview, confirmation must refuse/reprepare or retain unplaced work according to the existing contract; it must not commit an impossible reviewed placement. Keep input, explain the change and never partly save tasks on refusal.

Splitting must preserve outcome/class provenance and the existing scope group. Finishing the consolidation of a **part/continued** class portion does not make the whole outcome testable. The whole-outcome confirmation path remains explicit. Follow lineage across week boundaries without restoring an old `class_session_id` or duplicating class attendance, reported minutes or test scope. Do not change frozen papers, question approvals, scoring or repair closure.

Where group completion uses a member list, ensure every generated sitting is represented and an omitted/deferred/cancelled sibling cannot silently complete the whole outcome. A complete whole-outcome task may still legitimately confirm its covered scope under the existing contract.

## 3. Make generated instructions useful without teaching

Populate the existing task-semantic fields, not a new content system:

- **Scope/objective:** the actual mapped outcome or explicitly bounded class portion.
- **Why now:** the class/date and follow-up purpose, or the existing revision reason.
- **Approach:** a concrete study method using the student's own course/book—for example closed-note recall, checking omissions against their own notes, and a short application exercise from their own material.
- **Completion:** what the student should have attempted/covered, allowing partial/unknown reporting.
- **Verification:** which later available check can test the whole confirmed scope, or why a portion remains pending.

Use canonical identifiers and approved metadata. No copied book content, invented page references, subject lessons, answer explanations or guaranteed readiness. A split sitting must indicate which part of the activity it continues; repeated generic “Study this” wording is insufficient. Preserve optional actual-time reporting.

Render these fields in the existing task drawer and keep Curriculum/Tests links scoped to the same reading/outcome. Do not create a new task page or a separate Coach scheduling engine.

## 4. Close the explicit same-day ordering shortcut

B3's recovery planner constrains dates but does not re-check order within a date. For **explicitly ordered sittings**, a proposed relocation must not put an earlier sitting after its later sibling. Reuse the real group/order/prerequisite contract; do not invent an order between unrelated tasks solely from titles or a shared reading ID.

Apply the constraint at proposal and authoritative acceptance boundaries, so a stale or tampered placement cannot bypass it. Test both same-day and cross-day order, a completed predecessor, and a no-room outcome. If the group has no declared order, preserve that fact rather than treating display order as curriculum truth.

### Approved boundary correction — owner decision, 15 November

The owner has now confirmed: after recurring class days change, the first affected **unaccepted transition cycle closes before the next class, even if shorter than seven days**. This supersedes B3's newly introduced minimum-seven-day transition rule. Read founder decision §19.

Make only this boundary correction in `prospectiveWeek` and its actual callers/tests. Preserve accepted cycles, historical work, frozen forms, ordinary class-led cadence and self-study Monday–Saturday/Sunday-paper semantics. Do not widen the change into a new class-boundary algorithm or turn every individual class into a new cycle. Short transitions must have coherent adjacent dates, no overlap/gap, no past-dated actions and no artificially expanded workload. If scope, inventory or time cannot support a paper, show the honest checkpoint/assessment-unavailable state; do not skip the class boundary to manufacture seven days.

Update `series-effective-test.ts`, whose current first-transition assertion explicitly requires at least seven days. Add cases for a shorter-than-seven-day transition, normal following cycles, an unchanged accepted cycle, a near/same-day boundary with little usable time, and a forecast across the pattern change. Prove the expected next-class boundary itself, not just a different cycle length.

## 5. Required proof and finish line

Use ordinary owned students, scoped fixtures and the existing Browser runtime if available; otherwise record the installed Playwright fallback. No shared-account resets or question-bank fixture is needed for this package.

Required focused cases:

1. 45-minute cap with the previously 88-minute follow-up: linked sittings at/below 45, correct total, real available placement, one confirmed class session.
2. Today's sole window already elapsed: no task placed today; later valid placement or explicit no-room carryover, truthful pressure.
3. Fragmented remaining windows, overlapping windows, a class and booked mock, local midnight and a daylight-saving boundary where applicable.
4. Small capacity: partially placed work plus exact remaining obligation, no duplicate full effort when previewed/retried next time.
5. Preview becomes stale because the window expires, the sitting limit changes or a booking is added: refusal/rebuild with no partial writes and retained input.
6. Double confirm/lost response: one session, one set of tasks and stable receipt.
7. Part/continued class → split sittings → partial/complete reporting → continuation next week: no whole-outcome leak or duplicated minutes; explicit whole confirmation still works.
8. Ordered sibling move within one day: valid order or honest no-room outcome, never inversion.

Drive class log → preview → confirm → exact drawer → partial minutes → reload → Home/Curriculum/Tests scope in desktop and 390px. Verify the actual saved dates, durations, group/provenance and task semantics; do not call a render-only assertion a complete journey. Check width against the configured viewport/client width, not only `innerWidth`. Preserve keyboard/focus and record unexpected console/hydration errors without broad ignore rules.

Run touched class-log/sitting/scope/continuity/recovery/placement tests, then `npm run verify` and TypeScript on the final tree. If SQL changes, use additive migrations with ownership/ACL, rollback/race, upgrade and restore proof. Reuse the delivered B3 suites; do not rerun every unrelated live suite after every edit.

Register resources immediately and clean exact owned IDs on success and failure. Stop only your own server handle and restore generated declarations through the existing helpers. No commits, pushes, deployment, real emails or owner-data changes.

Update the next master-status section with reproductions, final preview/confirm/task-field contracts, accepted versus unplaced work, invariants, named tests/browser evidence and cleanup. State any unresolved failure plainly.

**Complete this package only when feasible, scoped study blocks are generated, accepted and usable through the UI. Do not stop after the pure planner fix or add a broad redesign.** Phase 2 will address shared signal wording, historical reads and Coach routing; Phase 3 will build poor-mock recovery. Leave those separate.
