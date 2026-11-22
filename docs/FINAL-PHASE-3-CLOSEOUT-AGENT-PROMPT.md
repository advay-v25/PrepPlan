# Phase 3 closeout — continuity, exam boundaries and the complete recovery loop

Complete these specific gaps before starting Phase 4. Do not rebuild the report/debrief screens, repeat a broad discovery phase or return a menu of unfinished tasks. Preserve the delivered Gate 0 and Phase 1/2 behaviour.

Read `AGENTS.md`, Ponytail, the relevant installed Next.js guides before framework edits, founder decisions, master status §9.44 and `FINAL-PHASE-3-MOCK-RECOVERY-AGENT-PROMPT.md`. Inspect current callers and effective database functions before editing. Preserve unrelated dirty work and other workers' resources. No commits, pushes, deployment, real emails or provider/account setup.

## Owner review: what is established

The owner-side review read the handoff and current source and reran `mock:debrief:test`: **34 passed, 0 failed**. It did not rerun the full browser or live HTTP suite.

Two probes against the disposable development database were transactions that were rolled back in full:

1. Creating a mock report at **48%**, then repeating the same key with **82%**, returned success with `replayed:true` and the original 48%. It did not reject incompatible key reuse.
2. A source-linked partial recovery task was cloned into a genuinely later cycle using the same row-copy strategy as weekly continuation, with the real continuation guard enabled. The insert failed **23505, `plan_blocks_report_source_idx`**. The source identity survives the copy, but the index permits only one uncancelled row with that identity. This was an insert/constraint reproduction, not a full weekly-review browser journey.

Additional source findings:

- `previewRecovery()` reads source identities only in the current cycle; the unique source index applies across all cycles. A re-proposal next week can recreate an old `:1` key and block otherwise legitimate new work.
- `recoveryRemainder()` sums occurrence durations without resolving continuation lineage. Simply weakening the unique index can therefore double-count allocated work.
- The preview places work through the cycle end, not the exam boundary. `exam_date` changes only the note and is absent from the fingerprint; acceptance does not validate the exam horizon. This is not just an omitted test.
- Both `save_mock_report` and recovery acceptance identify a replay by key/action/report but do not bind the original semantic payload.
- `parseReportInput()` accepts `2026-02-30` as a valid past date because `Date.parse` normalises it. SQL later refuses it, but the request should fail validation clearly.

These are the starting regressions. Prove each against current code, fix the shared cause, and preserve a named test. No reverting other workers' changes to manufacture red tests.

## 1. Repair logical recovery identity across weeks and splits — release blocker

Trace the new provenance fields through every task-copy writer: weekly continuations, manual splits, recovery/rescheduling and any clone path. Distinguish one logical recovery obligation from its calendar occurrences using the existing lineage/group contracts.

Requirements:

- A partial recovery task continues into a new linked task in the next week. The original stays in its original week with its reported time and history. The new occurrence retains truthful report/finding provenance without conflicting with duplicate protection.
- Protect against duplicate logical work and duplicate successors. Do not fix this by dropping all source uniqueness, clearing provenance or changing the same task's cycle in place.
- Read allocated/completed/open recovery work across all relevant cycles. A previously allocated item must not be proposed again merely because its task is in another week. Use accurate “completed previously,” “continues this week” or “already planned” wording, not “already in your week” for an old task.
- Count logical allocation once across a continuation chain. Keep reported actual minutes separate. Reuse the existing rule that a continuation replaces the occurrence it continues for logical scope/effort.
- Cancellation, replacement, manual split and repeated rollover must leave truthful outstanding work and eventual completion, without phantom siblings or lost minutes.

Mandatory regression: **45-minute recovery sitting → 20 minutes reported/partial in week one → reviewed continuation of 25 in week two → finish with 25 reported**. Assert 45 actual minutes total, 20/25 in the correct weeks, one logical allocation, one scope contribution and intact report links. Then repeat with another rollover and a manual split.

Use a new additive migration and checked current definitions. If shared continuation commands need a change, preserve all access, atomicity, stale-preview, history, class-provenance reset and receipt safeguards installed after their original migration.

## 2. Make the unplaced-work path usable across cycles

Automatic placement at weekly acceptance is **not itself required**. A visible action that re-proposes outstanding recovery work for review is acceptable. The student must not need to recreate the mock report or remember hidden unfinished work.

Prove this exact case: three selected recovery activities, only two fit, one remains unplaced; the cycle closes; next week the student opens the follow-up and accepts only the remaining work. Previously allocated/completed tasks must neither be duplicated nor cause the entire acceptance to fail.

Ensure:

- Calendar and weekly review offer a direct, contextual action for the precise remaining selection, with the same minutes/status as the report page.
- Re-proposal uses the current limit, commitments, time and cycle without losing the report's durable selection.
- Editing selections, durations or reading/outcome granularity cannot silently erase old obligations or create a duplicate full sitting. Explain and explicitly confirm any intended replacement/removal; do not invent additional debt.
- Accepted work survives report editing/withdrawal as history with its source/version explained. State what withdrawing a report does to unplaced choices before the student confirms it.
- Existing equivalent open work is offered as such, including evidence-backed repairs; it is not automatically labelled complete or used to close a repair.

Do not create a second backlog/planning engine. Reuse existing durable work, reviewed proposals and shared placement rules.

## 3. Enforce the real exam horizon and material staleness

Use the canonical exam target and study-horizon helpers, including tentative windows, booked dates and exam-sat/paused state. Do not rely solely on a nullable legacy profile date or invent a new target date convention.

- No recovery sitting on/after a booked exam or past the canonical last study date. Short final cycles must remain valid without extending work beyond the boundary.
- Moving an exam earlier between preview and accept must refuse/rebuild the affected proposal, preserving input and writing nothing. Validate the horizon inside authoritative acceptance under the existing scheduling/setup coordination, not only in TypeScript.
- Exam-sat/paused students retain history/report access and successful old receipts; new study allocation follows the existing paused policy.
- The fingerprint must cover the material proposal the student reviewed, including exam-dependent decisions and guidance. Do not silently accept different final-week advice under an unchanged token.
- Revalidate changed commitments/mocks, limit and available gaps atomically. Include both race orders where relevant. An unrelated report edit that changes no reviewed fact must not invalidate another report's preview.
- Final-week/two-week “narrowing” must be honest in the proposal: realistic remaining slots and explicit trade-offs, not a copied month-long plan with a different paragraph. Do not introduce fixed hour targets, compulsory mocks or unsupported topic diagnoses.

Test through the canonical exam editor as well as the command. Keep the existing class-led short transition and self-study Sunday assessment policy.

## 4. Bind idempotency keys to their actual requests

Fix report create/edit/withdraw and recovery acceptance together, at the authoritative command and service boundary.

The same key and same semantic request must return the original receipt, even after a lost response, later clock/cycle changes or a successful edit elsewhere. The same key with changed score, scale, notes, scope, source report, recovery selection or other material payload must return a clear conflict, never acknowledge unsaved edits as success.

Canonicalise inputs consistently: deliberate equivalence such as reordered topic selections or blank/default fields should not create spurious conflicts. Bind the original expected version/selection where appropriate; do not compare an exact retry against the newly incremented current version and reject a committed save.

Prove changed-payload refusal at HTTP and database-command level, concurrent identical retries producing one result, concurrent incompatible requests producing one winner, and a retry of a committed command after a later legitimate action. Refusals leave data and receipts unchanged. Preserve existing receipts; do not fabricate missing historical request payloads.

Reuse real calendar-date validation so impossible dates produce a useful validation response and retained form input. Preserve marks/percent/percentile/unknown distinctions and owned-record checks.

## 5. Coach must open the selected report, not silently substitute the latest

Wire report-page and task-drawer Coach entry points to a validated selected-report identifier using the existing selection pattern. Reach the request schema, server owner lookup, context, model contract, canonical links and reload behaviour.

With two reports, an older report selected explicitly must be discussed as that report; identify it by date/provider. No selection may still default to the latest. An invalid, foreign, deleted or withdrawn selection must be explained according to the record's real state, not quietly replaced with another report.

Preparation context remains context; an external result changes no demonstrated evidence, coverage, repair closure or calendar without an explicit reviewed action. The Coach can guide how to work on the chosen areas; it cannot teach curriculum content.

## 6. Close the missing proof without public test bypasses

### Scored accountability loop

The unavailable-bank path is necessary but is not proof of a working scored follow-up. Use the existing guarded, approved/versioned **test-only fixture bank** for a small supported reading/outcome slice. This does not require creating real publishable questions or relaxing production approvals.

Drive report → accepted targeted work → actual partial/completed work → explicit whole-scope confirmation where needed → suitable available in-app check → required confidence answers → result → evidence-backed follow-up/Calendar → weekly adaptation. Retain normal repair-spacing and closure rules. External report/task completion alone must leave evidence unchanged; only the qualifying scored answers may move it. Do not import an external mock score into the in-app score ledger.

Keep the actual-bank unavailable path as a separate control. Show fixture questions actually belonged to the intended scope, were approved at their exact versions, and were not unstudied class portions. Preserve freshness, family and 90-question rules.

### Real browser failure/retry proof

Complete the Calendar failed-read/recovery journey and a browser request that reaches the **actual server context deadline**, rather than fulfilling a made-up 503 in the browser.

Use a private harness/process-level dependency substitution or controlled test upstream for the isolated test server. Do not expose a production fault/clock query parameter, weaken ownership, modify shared accounts, or add a permanently active test bypass. The evidence must identify what was substituted and which actual server stage, cancellation, lease and retry code ran. A network-offline test may supplement this; it does not alone prove the server deadline.

Live provider success is not a completion requirement for this software slice. Scripted successful/failed-provider tests must be labelled; diagnose any configured live-provider failure separately without pretending simulation is live success. Do not repeat expensive provider calls to mask a failure.

## Required routes/callers

Verify the current exact routes and links before editing:

- `/app/calendar/mock-report` and `/app/calendar/mock-report/[id]` → report save/edit/withdraw → debrief → recovery preview/accept.
- `/api/mock-reports`, `/api/mock-reports/[id]/recovery` and the current save/accept commands.
- Calendar/task drawer → exact report/version, scope, partial completion, continuation and selected-report Coach link.
- `/app/review-week`, `/api/weekly-review/{state,preview,accept}` → unfinished tasks plus direct unplaced-recovery follow-up.
- `/app`, Curriculum's exact reading/outcome page, Tests preflight/attempt/result, Coach turn/selection and the canonical Settings/onboarding exam editor.

Update route ownership documentation and affected exports/tests. Remove only obsolete code whose callers have migrated; no broad cleanup or new navigation tab.

## Final acceptance matrix

Run focused regressions while implementing, then the complete affected proof set on the final relevant tree:

1. Two-week 20+25-minute continuation; three-week continuation; split/cancel/replace; no duplicate source identity, time, scope or evidence.
2. Partial-fit proposal with an unplaced item, rollover, next-week re-proposal and acceptance without repeating old work.
3. Booked/tentative horizon; exam moved earlier through its editor; commitment/mock race; unrelated report edit; paused/exam-sat; correct historical reads.
4. Identical retries and incompatible key reuse for every report/recovery command, lost response, atomic failure, concurrency and cross-account refusal.
5. Two reports with older selected in Coach, no selection, foreign/missing selection, report edit and withdrawal, stable links after reload.
6. Actual-bank unavailable control plus fixture-bank scored follow-up and later adaptation; source/scope and evidence assertions at each step.
7. Browser at desktop and 390px: continuation/remainder, selected older report, actual failed-read/deadline recovery and exam-target staleness. Assert actual database outcomes after UI actions, keyboard/focus, client width and no unexplained console/hydration errors.

Then run affected Phase 1/2/3 suites, `npm run verify`, TypeScript, migration dry-run and upgrade/restore rehearsals for additive schema changes. Never edit an applied migration or overwrite newer function patches from an old file. Preserve service-role-only commands and read-own policies.

Register and clean exact owned fixture/student IDs on success and failure; stop only recorded owned server handles and restore generated type paths. Keep actual-bank and fixture evidence separate.

Deliver a short requirement → implementation → proof table, exact commands/results, browser evidence, source/migration fingerprints, seed-versus-UI distinctions, and cleanup. State which intentional policies remain (for example, reviewed re-proposal rather than automatic weekly placement).

**Finish Phase 3 only when continuity, horizon, retry integrity and the scored follow-up all work.** Do not call listed requirements “limits” while marking the phase complete. If external circumstances prevent a mandatory check, name that exact incomplete gate. Do not begin the bank-expansion phase or another redesign in this assignment.
