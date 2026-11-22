# Route and State Ownership

## 1. Golden Rules of State

1. **State lives on the server.** The source of truth is the Postgres database.
2. **Page renders are read-only.** Visiting a page (`GET` request) must **never** mutate state.
3. **`OperatingState` is the unified read model.** All student-facing views derive their context from `src/lib/state/operatingState.ts`.
4. **Mutations happen via API endpoints or Server Actions.** They must be explicitly triggered by user intent or scheduled background jobs, never as a side-effect of navigation.

## 2. Canonical Routes

All application routes are defined in `src/lib/routing/registry.ts`.

- `/login` - Authentication entry point.
- `/onboarding/*` - The mandatory setup phase. Users cannot enter `/app` until `onboarding_status === 'complete'`.
- `/app` - Action-first Home and the student's operating console.
- `/app/calendar` - The weekly tactical view. Read-only projection of `plan_blocks`.
- `/app/curriculum` - The long-term strategic view. Read-only projection of `study_roadmaps` and `user_module_state`.
- `/app/tests` - The evidence and repair view.
- `/app/coach` - The advisory view. Derives advice from `OperatingState`.

### Reviewer workspace (staff only; never linked from student navigation)

All guarded by `getReviewer()` (`src/lib/diagnostic/reviewAccess.ts`); a non-reviewer is redirected to `/app/tests`, an API caller gets 401/403.

- `/app/tests/review` - paginated queue by topic / reading / outcome / state / batch, with whole-set totals.
- `/app/tests/review/[itemId]` - item workspace: item, key, proof, mapping, checks, family, versions, decision. `.../preview` - single-question rehearsal.
- `/app/tests/review/preview` - candidate-paper rehearsal. Client-only state; no response, evidence, progress, repair or Calendar write.
- `/app/tests/review/batches` - durable generation batches and their measured report. `/app/tests/review/challenges` - student challenge queue (existing `resolve_item_challenge`).
- `/app/tests/manifest` - curriculum sign-off (unchanged URL).

**Item state ownership.** `assessment_items.review_status` is one of draft / verified ("automatically checked") / reviewed ("human reviewed") / deprecated ("retired"); words live in `src/lib/diagnostic/itemState.ts` and nowhere else. Only `reviewed`, not `held_out`, AND with a recorded approval for the item's exact version reaches a new student paper: the database view `student_eligible_items` (read through `eligibleItems()` in `itemState.ts`) is the one source; `paper_item_defects()` and the `form_items` trigger apply the same rule at reservation. `reviewed` is granted only by `decide_item_review`; content changes to a published or used item go through `edit_item`, which creates a new version row (`supersedes_item_id`). Families (`item_families`, `family_id` null = unknown) and hold-out are set only by `group_items_in_family` / `set_item_holdout`. Generation batches (`item_batches`, `item_batch_cells`) are advanced only by the service-role commands `claim_batch_cell`, `store_batch_cell`, `fail_batch_cell`.

### Diagnostic papers (Phase 3)

- **One decision.** `src/lib/tests/assessmentDecision.ts` (`decideAssessment`) answers, for every kind (weekly, reading, subject, repair, mock): purpose, eligible confirmed scope, requested vs deliverable questions, timing, the open attempt to resume, what stays pending (capacity, bank, unconfirmed blocks, a further paper) and the student's next action. Tests, Calendar (`PaperStrip`), `POST /api/tests/preflight`, `POST /api/tests/start`, the weekly-closure gate (`startablePaperExists`), Curriculum's reading check and the re-check all read it or the shared pool beneath it (`itemPool.ts`: `loadEligibleItemPool`, `countFreshByReading`). The older per-surface counters now delegate to that pool.
- **One reservation.** `start_assessment_paper` (service-role only; `src/lib/tests/reserve.ts`) writes blueprint, form, pinned item versions, attempt, scope snapshot and the Calendar block link in one transaction, under an advisory lock per (student, kind, open key). Used by `startAssessment`, `/api/diagnostic/attempt` (module papers and the Calendar paper task). Re-checks keep `start_repair_check`, patched to use the same `paper_item_defects` rule.
- **Eligibility policy `approved-version-v1`** is stored on `assessment_attempts.eligibility_policy`; null means the paper was reserved under the earlier rule. `form_items.item_version` pins each question's version.
- **Routes.** `/api/tests/preflight` now takes every kind and returns `{ decision }` (it was re-check only, returning `{ plan }`). `/api/tests/start` accepts `part` for a further weekly paper. No route was retired.
- **Results.** `getAttemptResult` adds `findings`, `nextAction`, `omitted`, `invalidated`, `eligibilityPolicy`; voided answers leave the analysis. Home's Understanding tile links to the latest scored result (`signals.understanding.latestAttemptId`).

### Coach (Phase 4)

- **Supported intents** are resolved by code in `src/lib/coach/actions.ts`: today, missed today, availability, lighter week, result, slow-but-correct, mock, teach-me-a-chapter (a boundary reply plus a practical method), plus the earlier struggling / redo / next. The server chooses every proposal and link; the model (`coach/model.ts`, prompt `coach-2026-11-04.2` in `coach/response.ts`) may only re-word the verified answer in a validated `{reply}` shape, with one 12-second attempt and the verified reply as fallback.
- **Confirmation is one transaction.** `confirm_coach_proposal` (authenticated; ownership by `auth.uid()`) validates every reviewed task (revision, date, not started, not a protected commitment, no continuation), applies them through `set_task_execution`, and writes the receipt on the proposal. A repeat returns the receipt; a stale proposal changes nothing. The week's existing spreading of deferred work runs after the commit and is best effort.
- **Timed practice** is `attempt_kind = 'practice'` (`kind: 'practice'` in preflight/start, 10 questions, 75 s each, strict server deadline). `finalize_assessment_attempt` forces `evidence_mode = 'practice'`, so it writes no evidence, closes no repair and is not a weekly paper.
- **Scope race.** `paper_scope_source(user)` is read before the scope is built. Every writer of the rows it reads (plan blocks, scope confirmations, class sessions and items, module state, evidence) takes one per-student advisory lock by trigger (`scope_write_lock`); `start_assessment_paper` takes the same lock BEFORE it compares, so a confirmation either commits first (the reservation refuses `SCOPE_CHANGED`, nothing written) or waits until the reservation commits.
- **Study guidance** lives in `src/lib/study/guidance.ts` and is used by repair tasks, result findings and Coach replies.

Completed users edit exam, route, classes, availability, and other setup inputs through Settings-owned editors. They are not sent back through the gated first-time onboarding journey.

## 3. The End of AppState

The legacy `AppState` Context provider has been removed. Client-side state is restricted to ephemeral UI state (e.g. "is the drawer open", "what is typed in this input"). Persistent state is exclusively fetched server-side and passed down as props to Client Components where interactivity is required.

## 4. End-to-End Testing

End-to-end tests must protect real user identities. Destructive tests (`--reset`) must use the `E2E_EMAIL` and `E2E_ALLOW_RESET=1` guards. Tests must assert that navigating the app does not produce side effects (e.g. the "Render Purity" test in `e2e-calendar.ts`).

## Phase 5 — linked mocks, appointments, final stretch, exam completion

| Concern | Owner | Notes |
|---|---|---|
| Mock schedule | `mock_appointments` (id = the old checkpoint id; version per row) | `profiles.mock_*` is a projection of the next planned appointment; a legacy write of those columns edits that appointment (trigger). Read through `listAppointments` / `getCheckpointView(userId, now, appointmentId)`. |
| Appointment commands | `checkpoint_command` (save / add / cancel / choice / outcome / suggestion / related), `POST /api/checkpoints` | An internal rehearsal cannot be "taken" by typing; completed appointments are history. |
| Designation | `cycle_assessment_choices.appointment_id` | One appointment per week counts. A finished designated rehearsal credits the cycle in which its SECOND session finished (weekly gate `rehearsal`). |
| Capability | `decideRehearsal` (`src/lib/rehearsal/service.ts`), `GET /api/rehearsal` | Calendar, Tests, Coach and Settings read it; reasons are per session and per topic. |
| Reservation | `start_rehearsal` (service role), `POST /api/rehearsal/start` | Pins BOTH 90-question held-out forms or nothing. The hold-out exception is a transaction-local setting set only inside this function. |
| Clocks | `start_rehearsal_session`, `POST /api/rehearsal/[id]/session` | Deadline set once on explicit start (server clock); session 2 only after session 1 ended; `save_attempt_response` refuses an unstarted rehearsal session. |
| Settlement | `settleRehearsal` | Expired sessions are finalised from saved answers (omissions stay omitted) or closed `expired` when empty. |
| Hub / result | `/app/tests/rehearsal/[id]` | Combined view only for two ended sessions; debrief uses `previewRepairFollowUp({ alsoAttemptIds, limit: 5 })`. |
| Retired | `POST /api/tests/start {kind:'mock'}` → 410 | Historical `attempt_kind='mock'` attempts keep their result links. |
| Exam | `exam_completion`, `record_exam_status`, `/api/exam`, `/app/exam` | "I sat the exam" is the student's statement only; study prompts pause, history is kept. |


## Phase 3 — mock reports and recovery

| Concern | Owner | Notes |
|---|---|---|
| Past mock report | `mock_reports` (+ `mock_report_commands` receipts), `save_mock_report` (service role), `POST /api/mock-reports` `{action: create|edit|withdraw, key, reportId?, expectedVersion?, input}`, `GET /api/mock-reports` | A mock ALREADY TAKEN, recorded without any booking. Owner = the signed-in student (never a client field). One request key = one report. Edits are expected-version checked. The student's own report: never evidence, coverage, a concept verdict or repair closure. `mock_outcomes`/`mock_appointments` and the in-app rehearsal ledger are untouched; an old free-text outcome is linked by `legacy_outcome_id` only when the student chooses to structure it. |
| Debrief | `buildDebrief` (`src/lib/mocks/debrief.ts`, pure), page `/app/calendar/mock-report/[id]` | Each finding: source, what it supports, what it does not show, planning implication. Comparability (`comparable`) requires the same scale, scope, provider (and total for marks). |
| Recovery proposal | `previewRecovery` (`src/lib/mocks/recovery.ts`), `POST /api/mock-reports/[id]/recovery {mode: preview|accept}` | Deterministic. The student selects readings/activities; whole sittings go into the real remaining contiguous room (same `roomOfDay` rule as class follow-up). Never moves accepted work. The unplaced remainder is kept in `mock_reports.plan_selection` and derived (`recoveryRemainder`), surfaced in Calendar, Review and the report page. |
| Acceptance | `accept_mock_recovery` (service role) | One transaction: scheduling lock, report version, cycle, sitting limit, `class_day_packs` room, source identity (`plan_blocks_report_source_idx`), receipt in `mock_report_commands`. Same key replays; a new key with an old fingerprint is `preview_changed`. |
| Entry points | Calendar strip (`MockReportsStrip`), Tests `?view=mocks`, Coach mock replies | Callers of `/app/calendar/mock-report` and `/app/calendar/mock-report/[id]`. |
| Context stage budget | `boundedStage` (`src/lib/ops/requestBudget.ts`) in `runTurn` and Coach optional sections | Aborts service-role reads at the budget, discards late results, releases the fenced lease; `worldBudgetMs` is a server-side test seam only. |

### Phase 3 closeout (17 Nov 2026) — what changed in ownership

| Concern | Owner | Notes |
|---|---|---|
| Logical recovery identity | `plan_blocks.source_report_id/source_key`, trigger `guard_source_identity` (migration `20270104`), `loadItemStates` (`src/lib/mocks/recovery.ts`) | One finding sitting = one logical identity (report + key). A weekly continuation (`continued_from_task_id`) or a manual-split sibling (same `scope_group_id`) is another OCCURRENCE of it and keeps the provenance; a live holder that is neither is refused (23505). The old unique index is replaced by a backstop on root occurrences only. Allocation counts a chain once (leaf minutes + reported minutes on replaced predecessors); reported minutes stay per occurrence. |
| Re-proposal across weeks | `previewRecovery` reads EVERY cycle of the report; statuses `planned` / `continues` / `completed` / `unfinished` | "Plan what is left" (`/app/calendar/mock-report/[id]?plan=left`) is linked from Calendar (`MockReportsStrip`) and Weekly review and previews the SAVED selection. A dropped unplaced choice needs `confirmRemove`; the command enforces it (`removal_unconfirmed`). |
| Exam horizon | `mock_recovery_horizon(p_user)` (service role), read by `previewRecovery` AND `accept_mock_recovery` | Booked `profiles.exam_date` → last study day is the day before; otherwise the target sitting's opening day; exam sat → no new allocation (history, report and receipts stay). The fingerprint covers horizon state, runway text, trade-offs and what would be dropped. Read under the profile share-lock the command already holds, so an exam edit and an acceptance serialise one way or the other. |
| Idempotency binding | `mock_report_commands.request_hash`, `mock_report_hash`, `mock_recovery_hash`, `mock_command_replay` | Same key + same semantic request = the original receipt (also after a later edit, clock or cycle change); same key + anything different = `KEY_REUSED` (409), nothing written. Receipts older than the migration have no hash and keep replaying. |
| Selected report in Coach | `/app/coach?report=<uuid>` → `CoachClient reportId` → `POST /api/coach {reportId}` → `runTurn` (turn-key hash) → `loadCoachWorld extra.reportId` → `mockReport.selected` / `mockReportUnavailable` | Owner-read; active, withdrawn and unavailable are different explanations; never replaced by the latest. No selection still defaults to the latest. Entry points: report page and the task drawer. |
| Private fault harness | `scripts/fault-upstream.cjs` (loopback pass-through; only the isolated test server's `NEXT_PUBLIC_SUPABASE_URL` points at it) | Not part of the app and never started by it; faults exist only while a spec writes a rule file. |


### Phase 4: content production and publication surfaces (17 Nov 2026)

Every writer of a publication-relevant state. A label such as `reviewed`, an automatic PASS, a difficulty label or a CLI string is not a publication decision; only the exact-version approval command is.

| State | Only writers | Guard |
|---|---|---|
| Student-eligible (routine / held-out) | `decide_item_review` reviewer command (called with the reviewer session) via `/api/diagnostic/items/[id]/review` | Role check, exact current version, `item_publish_blockers` (automatic checks, confirmed family, signed concept, batch rights), one receipt per decision. Eligibility views `student_eligible_items` / `rehearsal_eligible_items` are the one reader (`itemState.ts`). |
| Candidate (`draft` → `verified`) | `store_batch_cell` (batch worker, fenced claim), `scripts/lib/bankLoader.ts` (hand-written ethics/FSA banks), legacy `scripts/pilot-generation-run.ts` | Never writes `reviewed`; a candidate is quarantined until its batch rights are `cleared`. |
| Batch rights (`item_batches.rights_status`) | `create_item_batch` only | `cleared` needs a recorded authority AND (migration `20270106`, also checked in `createBatch`) every pack used must itself record `cleared` rights, an authority and a permitted use other than `none`. `--rights-ref` is an annotation, not clearance. |
| Concept sign-off | `/api/curriculum/concepts/[id]/verify` (reviewer role) → `decide_concept_signoff` (migration `20270107`) | One writer. Needs `{decision: verify\|withdraw, expectedScopeHash, rationale, confirmScope: true}`; a missing, malformed or old-shape body approves nothing. The database re-checks the reviewer role as the signed-in user, refuses a stale scope hash, and writes status + an audit row (`concept_signoffs`: reviewer, time, exact scope snapshot/hash, decision, reason, request key) in one transaction; a repeated request key replays. A direct status write to `verified` is refused by trigger; editing a signed-off concept's scope revokes it (`revoked_by_edit`, audited). **Eligibility rule:** withdrawal/revocation blocks NEW approvals (publish blocker) and is reported with the count of approved items still live on that concept; those are retired by a reviewer through the item workflow. Nothing is unpublished silently and no frozen paper or answered evidence is changed. No automated or CLI caller. Unsigned concepts permit quarantined drafting only. |
| Family confirmation | `/api/diagnostic/items/[id]/family` (reviewer role) | Provisional family is a publication blocker. |
| Source packs | `content/source-packs/**` files read by `loadSourcePacks`; `content/source-packs/private/` is git-ignored | `items:batch packs` is the read-only checklist; a missing, stale, off-scope, hash-mismatched or contradictory pack blocks drafting with a named cell blocker. |
| Capacity / coverage | `getCapacityReport` (`src/lib/tests/capacityReport.ts`) | `bank:capacity`, `bank:matrix`, `bank:audit` (writes `docs/BANK-COVERAGE-2027.md`) and the reviewer batch report read it. The old status-only `getBankCoverage` was removed. Paper-ready uses `MIN_PAPER_QUESTIONS`, the same constant as preflight. Per-student freshness stays in preflight and is labelled per student. |

## Phase 7 — manual task creation and class identity

| Concern | Owner | Notes |
|---|---|---|
| Student-added task | `apply_task_create` (service role), `createManualTask` (`taskService.ts`), `POST /api/tasks` `{key, title, date, startMinutes, durationMinutes, taskType?, acceptWarnings?}` | One transaction: scope lock, cycle bound, protected time, the task and its `created` event. The task id is `task-<key>`: the same request replays (`replayed: true`), a different request under the same key is `KEY_REUSED`. Only study / review / admin / other; repair, re-check, mock and diagnostic work has its own commands (`BAD_TYPE`). Past days refused (use Log learning). The one-time window / sitting-limit warning is `NEEDS_CONFIRMATION` then `acceptWarnings`; it never edits Settings. Entry points: Calendar toolbar **Add study task** (explicit day, time left open) and an empty-slot click. |
| Class identity | `class_sessions.occurrence_key` (+ `commitment_id`, `occurrence_date`), `apply_class_log` (10-argument form), `getClassLogContext().occurrences` | A date is not a class. Key = `series:<commitment>:<ORIGINAL occurrence date>` (stable when moved), `once:<commitment>`, or `manual:<uuid>`; unique per student (`OCCURRENCE_ALREADY_LOGGED`), retries replay by idempotency key. Rows with no key are legacy date-level entries: shown as `legacy` (never guessed onto an occurrence). Obligations, follow-up tasks, Tests scope and Coach already hang off the session id. The 7-argument `apply_class_log` is a wrapper that writes an unresolved date-level entry. |
| Class log form | `/app/calendar/log-class`, `POST /api/class-log/{preview,confirm}` `{occurrenceKey?, classDate, ...}` | Chooses an actual class (disabled once logged), or "another session not on my timetable" with its own day. A new request key per chosen class. |


### Phase 7 slice 2 additions
- `POST /api/tasks`: replay is decided by `task_create_receipts` (service role only) before today's calendar checks; response carries the original `task` and the live `current` row (null if deleted).
- `apply_class_log` (10-arg) is the only new-write path; the 7-arg form is a replay-only wrapper. `class_change` receipts in `checkpoint_commands` are the sole succession authority.

### Phase 7B additions (19 Nov 2026)
| Concern | Owner | Notes |
|---|---|---|
| Account export of receipts | `OWNED_TABLES.task_create_receipts` (key `key`), `OWNED_TABLES.class_log_updates` (key `user_id, idempotency_key`) in `src/lib/account/export.ts` | Checked live by `scripts/account-export-schema-test.ts`; both cascade-delete with the Auth user. |
| Manual-task dialog | `NewTaskDialog` ← `POST /api/tasks` | States: edit → pending (inputs frozen, Cancel/Escape/overlay inert) → done (receipt: **Added** vs **already saved earlier** with current status or "no longer on your Calendar") or unconfirmed (reply lost: request + key frozen, Retry resends the same payload, "Start a different task" mints a new key). 502 `OUTCOME_UNKNOWN` = the RPC reply never arrived (a SQLSTATE error means rolled back; anything else may have committed). |
| Class in progress | `class_sessions.version`, `.completed_at`, `.create_fp`; `class_log_updates` (receipts + the report each update replaced); `apply_class_log` (11-arg, `p_finalise`), `apply_class_log_update`, `class_apply_tasks` (shared task validation/insertion, no direct grant) | Identity (occurrence), completion (explicit `completed_at`, never the clock) and coverage (`class_session_items`) are separate. A class is reportable once it has STARTED (`OCCURRENCE_NOT_STARTED` otherwise). Updates name `expectedVersion`; same key = replay of the original result; a stale version = `version_changed`. |
| Class log API | `POST /api/class-log/preview` `{…, sessionId?}`, `POST /api/class-log/confirm` `{…, sessionId?, expectedVersion?, finalise}` | With `sessionId` the day, kind and occurrence come from the saved session; only changed items are planned, restricted to that session's owed work. Codes: `unknown` (502, retry the SAME key), `version_changed` (409). |
| Class label in follow-up | `Obligation.classLabel/classOriginalDate` (`loadClassObligations`), `sittingText` rationale, Calendar owed line, preview carry-over | Two classes on one day read differently everywhere the follow-up is explained. |

## Functional closeout

| Concern | Entry point and owner | Connection |
|---|---|---|
| Saved class reports | `/app/calendar/log-class?session=<id>` and `?occurrence=<key>`, `getSavedClassLog`, `getClassLogContext` | Calendar, weekly review, Curriculum, Tests and Coach link the named report. Calendar study tasks recover the report through continuation lineage. A saved report remains readable across cycles and route changes. |
| Unreported class at closure | `/app/review-week` → `POST /api/weekly-review/preview` with `unreportedClassKeys` → `accept_weekly_transition` | The reviewed choice is in the draft and receipt. It creates no attendance or test scope. The next cycle uses the same boundary resolver as Calendar. |
| Reviewed retake | `/app/exam` → date editor → `POST /api/exam` with `preview_retake`, then `activate_retake` or `cancel_retake` | `review_exam_retake` locks the student and matches the owned draft, previous sitting, target, version, cycle and planning sources. It archives the sitting, accepts the draft and resumes the plan together. A reply lost after commit can replay the original receipt. |
| Exam status | `POST /api/exam` with `sat`, `undo` or `follow_up` | The panel includes the shown setup version. The checked command refuses an older sitting. `/app/exam` reads owned history, and the booked date feeds the shared roadmap. |
| Answer and timing | `POST /api/tests/attempt/[id]/answer` → `save_attempt_answer` | One owned transaction commits the answer and bounded time. Stale or closed requests leave both untouched. The runner can retry a lost save or submission. |
| Assessment inventory | `loadEligibleItemPool` → `student_eligible_items` or `rehearsal_eligible_items`; `getCapacityReport` for actual coverage | Both pools exclude synthetic provenance by default. An explicitly enabled non-production test server can use fixture items. Actual capacity excludes synthetic items and concepts even when a fixture is present. |
| Sign-in return | `/auth/confirm`, `/auth/callback`, `safeNextPath` | Sanitised relative redirects keep the session cookie on the browser's current origin, including a loopback alias behind a proxy. |
| Public walkthrough | `/` → `/demo` → `/login` | A sample calendar, paper, result and reviewed week use browser-local state. |
