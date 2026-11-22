# Phase 7B — finish receipts and the class-led student lifecycle

Build this bounded vertical slice to completion. It is part of the existing Phase 7, not a replacement plan or a declaration that the whole phase is finished. **Order: export regression → receipt UI/HTTP reliability → class identity through the complete Journey B → final proof.** Do not start A/C or a general redesign in this slice. Do not return after only repairing setup or repeating the short `journey-b` spec.

## Context and scope

Read `AGENTS.md`, Ponytail, relevant installed Next.js docs, founder decisions, master status §9.56–9.58, `docs/PHASE-7-SLICE-2-REVIEW-2026-11-19.md`, and the original Phase 7 plus completion prompts. Their product rules remain binding. Current reviewed source: `12078dc2ca489bee`; compare the snapshot and account for later edits. Preserve unrelated dirty work.

Manual creation now has a durable original-request receipt. Class logs now have explicit occurrence identity, command-side timetable validation and receipt-backed series succession. Preserve them. Do not redesign their models because HTTP/browser proof is missing.

**Owner decision confirmed on 19 November 2026 (founder decisions §21): allow in-progress logging; keep class completion separate.** Implement §2A below in this slice. The blanket end-time gate is superseded; the existing ownership, occurrence authority, locks and replay rules remain binding. Merely deleting `OCCURRENCE_NOT_ENDED` is insufficient because the current one-log-per-occurrence behaviour would block later additions/finalisation.

Keep planning access regardless of capacity/bank depth, mandatory onboarding, Monday–Saturday self-study/Sunday paper, class-led cycles ending before the next class, short unaccepted transitions, accepted history, explicit full versus part/continued scope, diagnostic versus revisionary/mixed papers and the 90-question ceiling. No teaching, uploads, pass prediction, hours target, synthetic evidence or automatic repair closure from study completion. Manual exceptions retain the one-time warning and hard protected/order/cycle constraints.

Only the authorised disposable development project may be used. No real model calls, email, content approvals, payment/deployment/domain/OAuth or owner-account operations. No commits/pushes. Reuse existing planners, commands, components and registered fixture banks.

## 1. Fix the independently reproduced export regression

Run the read-only `scripts/account-export-schema-test.ts` before the fix. It currently returns exit 1, 2 passed/2 failed: `task_create_receipts` is missing from `OWNED_TABLES` and account-reference coverage.

Add that owned collection to `src/lib/account/export.ts` with its actual primary key (`key`) and existing ownership/paging conventions. Do not add another exporter or exclude it merely to make the check green.

Prove an ordinary student's export includes their receipt and its original request/result, excludes another student's receipt and shared bank secrets, reads all ordered pages, and fails the whole download on a failed page. Confirm the Auth deletion cascade removes receipts. Parse the downloaded JSON in the browser for at least the connected creation case. Run the live schema check separately alongside offline verification; do not make the normal offline check require database credentials without an explicit existing convention.

## 2. Complete the receipt contract through HTTP and UI

### Manual creation

Drive the existing actual route and dialog, not only the RPC:

- Create once, lose the response, retry under the same key and original payload: one task, creation event and receipt.
- Change the task through supported commands after the original creation, then retry the original request. Creation replays, later state remains unchanged. Include partial/completed, cancelled and deleted cases through HTTP/DB where appropriate; drive at least edited and inactive/deleted replay in the browser.
- Current `NewTaskDialog` ignores `replayed`/`current`. Give an accurate receipt: newly created versus saved earlier, with current status or no-longer-present state. No silent resurrection, invented new task or misleading “added” outcome when nothing new was created. Offer the exact existing task/history/Calendar destination when available.
- Freeze the reviewed inputs and guard Cancel/Escape/overlay while a save is pending, using the existing dialog conventions. Do not let an older success silently discard a newer typed request. After an uncertain response, preserve the submitted payload/key for Retry and explain how to check the saved outcome before starting a different request. Avoid trapping someone indefinitely behind an unresponsive dependency.
- Detail-only/priority-only/time/title mismatch refuses without writes; crossing midnight/rollover or later booking does not defeat an already-known replay. Existing receipt lookup and scope ownership remain authoritative.
- Same-key requests from two tabs return one creation result. A database commit followed by a lost RPC result must produce an unconfirmed outcome, not a rollback claim. Test this layer separately from browser-response loss.
- Retain no-cycle/past-day/system-type refusals and exact protected-conflict links. Do not bypass access or warnings for a new request while improving replay.

### Class confirmation

`classlog/service.ts` still says “Nothing was changed” for generic RPC failure. Separate known transactional refusals from unknown transport outcomes. After a committed write with a lost result, preserve the occurrence, submitted extent and idempotency key; a retry returns the original session/tasks. Do not invent a new `manual:` identity on Retry. Replaying an older saved entry must not change later tasks or coverage.

Add focused HTTP/DB and desktop/390px browser proof. Use exact scoped fault injections and inspect durable rows, not only toasts.

### 2A. Allow in-progress reporting on the same class

- Keep occurrence identity, class completion and outcome coverage as separate facts. An in-progress class remains selectable as **Continue logging**, not greyed out as permanently logged. Returning after the scheduled end must open the same session and its saved coverage. Completion is explicitly recorded; the clock alone must not mark the log complete or invent coverage.
- Reuse the current session and append versioned, owned update commands with exact-payload receipts. Updating, correcting and finalising a class are not new sessions. Same-key retry replays; two tabs with the same expected version cannot silently overwrite one another. Preserve historical reports and original/effective occurrence dates.
- Add clear **Save coverage so far** and **Finish class log** actions using the existing form. Show what is saved and what remains unreported. Protect pending input and preserve drafts after failure. Do not require typing a class summary or recording a duration just to save scope.
- Explicitly whole outcomes may enter existing planning/test scope even while other parts of the class are unreported. Part/continued remains pending. Saving the same outcome twice counts once; finishing the class with no further changes adds no extra coverage, evidence or tasks. A planned class/topic is not reported learning.
- New coverage or a correction moves the canonical scope/change revision. Apply existing stale-preflight rules; reserved papers keep their frozen scope. Do not rewrite answers, historical minutes or scored evidence as a side effect of finalisation.
- Recompute follow-up obligations using the existing effort rules and already allocated work. Preview only the additional/affected work, not another complete set of tasks for the same outcomes. Preserve accepted/started work; changes requiring recovery use the existing reviewed draft. No room remains visible as owed work.
- Preserve scheduled-class validation for ownership, real occurrence, moved date and cancelled state. Distinguish a student's own manual session from a scheduled class; do not bypass a cancelled/moved class by silently creating a manual identity. Revisiting saved history after a timetable change remains possible without pretending a new attendance event occurred.
- Allow late finalisation or further reporting without silently reopening a closed week or moving its minutes. Preserve the original class/cycle provenance; any newly proposed work uses the appropriate current-cycle review path.

Proof: log part during class → reload/continue same session → add an explicitly whole outcome → preview/accept only additional work → scheduled end → explicit finalisation. Assert one session, correct current scope, no duplicate obligations/tasks/minutes/evidence and unchanged unrelated same-day class. Include correction, no-change finalisation, lost save/finalise reply, stale two-tab update, moved/cancelled occurrence, next-cycle revisit, reserved paper unchanged and denied cross-account writes. Drive the primary chain at desktop and 390px; test boundary/race cases at the command/HTTP layer. Use an additive migration from the live definition if needed, with normal schema/ACL rehearsals.

## 3. Build a trustworthy Journey B fixture

The short existing `journey-b` currently requires two pending dates. That assumption is not the product: two independent classes can share a date. Its new F1 adds at most one date and `now - 1/2 hours` can cross local midnight. Fix the premise rather than adding ad hoc rows until the assertion happens to pass.

Use a coherent owned class-led student, explicit original/effective dates, timezone and occurrence IDs, with actual room remaining for follow-up and the next class closing the cycle. Establish two **named occurrences** on the same day and a later class for rollover. Include both an in-progress class and an ended class in the relevant scenarios under §21. If dated history must be seeded/shifted, use the existing guarded fixture mechanism, keep all related records consistent and record it. Test a normal day and a local-midnight/first-class-week boundary at the appropriate pure/HTTP layer. Do not change production cadence or attendance rules for the test.

Use real onboarding UI for the primary full Journey B. Historical setup may then be seeded and clearly labelled. A separate fixture may cover older unresolved logs. Do not claim API onboarding as UI proof.

`keyed`, `keyedClient` and the HTTP helper currently choose pending classes or silently create a manual UUID when occurrence identity is omitted. Audit their callers before reusing them. Full identity and negative tests must use explicit intended keys/raw clients, including missing-key rejection and legacy replay. A fixture helper may be explicit about creating a manual class, but must not turn an absent or invalid scheduled occurrence into a successful manual log invisibly.

## 4. Drive Journey B through the next week

Build on current UI and suites. Ordinary student, no reviewer role; desktop 1280×900 and phone 390px, one owned student per coherent journey.

1. Complete onboarding for the class-led route and enter Home/Calendar. Verify accepted cycle/test timing and the correct next action.
2. Open/log each named same-day class separately. During one class save coverage so far, reload, continue the same session and finalise later. Use full coverage for one outcome, part/continued for another and a later explicit whole confirmation. Only completed/explicitly whole scope enters a paper. Repeated partials do not add up to a guessed full outcome; the scheduled end does not complete unreported outcomes.
3. Preview → confirm → ordered feasible follow-up sittings. Check sitting limit, remaining contiguous room and accepted load. Report actual partial minutes, reload and return to the exact task. Show class name plus useful original/effective date in drawer, owed work, review and history—not identical “class on date” labels for two sessions.
4. Move one class after preview, open the reviewed recovery, accept once and prove exact replay after a lost response. A stale second tab refuses atomically and keeps input. Restore against a newly protected mock must refuse without moving either object; prove restore-versus-booking in both lock orders with the existing database harness.
5. From completed scope, drive diagnostic, revisionary and mixed preflight cases on the registered routine fixture bank. Show pending partial scope, named omissions and honest shortage. Use one scored mixed journey to cover the whole downstream flow; use targeted preflight controls for the other kinds rather than needlessly answering three full papers.
6. Start → mandatory confidence → saved answers → refresh/resume → submit → result. Confirm frozen scope, omissions/score/evidence rules, exact source observation counts and no questions from the unconfirmed class portion. Preserve a lost answer-save response and retry case if not already unchanged proof.
7. Result → Keep for later → discoverable follow-up → preview/accept → exact repair tasks in Calendar. Completing study does not close repairs. Before-spacing re-check is refused; then a labelled consistent time/history fixture permits a fresh-family check and its result. No real passage of time is claimed.
8. Close through the actual weekly-review UI, finishing logs first. Continue partial/unplaced/owed class work into the next cycle exactly once. Preserve original task/week/time, mapping, ordered sitting identity, class provenance and repair links; keep the original and continuation deep links useful. Confirm cycle closes before the next class, including the short-transition regression.
9. Reopen Home, Calendar, Curriculum, Tests and Coach. Assert matching class labels, covered versus pending outcomes, minutes, evidence and next action; five page loads are not agreement proof. Verify the two same-day sessions never merge during rollover or report duplicate evidence.

Notes/cards may be used as existing optional linked tools, never as proof a repair is finished. Do not build a new notes feature in this slice.

## 5. Coach input and browser error closeout

The current B spec changed its typo request to plain wording. Keep the plain baseline but restore a separate test of the real typo/phrasing examples, including “i attnded clas yesterday, can u log it”. Do not label plain text as typo tolerance.

Use provider-free deterministic handling for common unambiguous variants where the existing design supports it; unknown/ambiguous messages should ask for clarification and write nothing. A controlled interpreter response can prove integration/timeout/malformed fallbacks, but is not a live-model language-quality claim. Every actual mutation still requires reviewed confirmation and server-owned IDs/links. No curriculum tutoring or inferred scope from words alone.

Investigate the reported `class-editing` hydration warning using the original console mismatch/stack and current reproduction. Use a bounded timezone/reload/occurrence-state matrix and capture actual server/client differing values. Fix a demonstrated cause when found. No blanket hydration exclusion, fixture waiver or rerun-until-green. If it remains unreproduced, retain the precise unresolved finding, configurations and observations; do not call it fixed. Continue independent functionality rather than spending the whole slice repeatedly running the same baseline.

## 6. Final acceptance and evidence

Run the focused changed command/HTTP/browser suites, the connected export schema check, full `npm run verify`, canonical TypeScript, route audit, isolated production build and read-only migration preview on the final tree. Reuse unchanged prior tests with exact attribution. If no schema changes, do not rerun every install/upgrade/restore ritual; if a new additive migration is necessary, run all three plus effective ACL/RLS proof and preserve live trust patches.

Keep strict unexpected console/network checks, configured viewport/client-width overflow, keyboard and focus, pending protection and reload recovery. Run shared-bank suites sequentially and use a registered synthetic bank. Clean by recorded IDs only; re-read actual bank after fixture cleanup so this slice has a current content-capacity statement. No auto-approvals or real batch/model spend.

Use the isolated wrapper, stop only recorded own processes and restore types through its supported regeneration. Do not hand-edit `next-env.d.ts` or use `git checkout` on shared files. Preserve the owner's existing server and unrelated accounts/files. No commits or external operational changes.

Deliver one concise master-status section and machine-readable evidence: requirement → implementation → endpoint/DB proof → browser proof, route/connection map, initial failures/fixes, seeded versus driven steps, exact final exits, source fingerprint, any new migration hashes, cleanup and remaining unknowns. The output should distinguish **Journey B complete**, **Phase 7 still partial** and **actual content readiness**. A/C, long-horizon/final-eight-weeks completion and broader cleanup/measurement stay explicitly queued; do not claim them from this slice. If mandatory B work remains unproven, say B partial with exact evidence rather than asking which package to do next.
