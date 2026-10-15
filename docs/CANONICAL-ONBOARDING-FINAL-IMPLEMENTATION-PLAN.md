# Roadmap — Canonical Onboarding Final Implementation Plan

**Source specification:** `docs/ONBOARDING-END-TO-END-CANONICAL-SPEC.md`  
**Status:** Verified and revised against the repository on 18 September 2026  
**Objective:** Replace the partially connected onboarding implementation with a mandatory, resumable and evidence-honest setup that commits one reviewed roadmap and one executable first week.

---

## 1. Verdict on the proposed plan

The proposed plan has the correct page structure and product direction, but it is not safe or complete enough to implement as written.

The following changes are required:

1. **Do not create an `onboarding_status_enum`.** The current database uses a text column with a check constraint. Extend that constraint additively or derive `review_ready`; do not introduce a second type system.
2. **Do not add a second booked-date source without migration.** `profiles.exam_date` already exists. Use it as the canonical booked date for this slice, or rename it in a deliberate data migration. This plan uses `exam_date`.
3. **Do not use sequential Supabase writes as a rollback substitute.** Completion must be one PostgreSQL function/transaction.
4. **Do not regenerate on confirmation.** Generate and persist a versioned preview first; confirmation accepts exactly that stored revision.
5. **Do not trust tasks supplied by the client.** The acceptance function reads the server-owned draft JSON under a row lock.
6. **Do not mark onboarding complete outside the acceptance transaction.** The existing `/api/plan/accept` does this and can leave split state.
7. **Do not add six physical route handlers without a reason.** Next.js 16 supports the existing dynamic route. Keep a thin dynamic handler, extract strict schemas/services, and give Plan its own preview/confirmation contract.
8. **Do not continue expanding topic taps into every learning module.** Topic-level self-report requires topic-level storage; otherwise the system falsely claims module-specific exposure.
9. **The migration must cover more than two tables.** Completion versioning, topic exposure, active-record uniqueness, commitment kinds and preview linkage are all required.
10. **The first week is part of onboarding completion.** Creating only a roadmap is no longer sufficient.

No production migration should be applied until the generated SQL diff, backfill counts, constraint validation and rollback procedure have been reviewed.

---

## 2. Definition of done

The phase is complete only when a fresh authenticated user can:

1. answer every required onboarding question;
2. leave and resume at the first incomplete valid step;
3. review a deterministic roadmap and exact first-week draft;
4. adjust the first-week draft without changing their underlying availability;
5. confirm the reviewed revision once;
6. land on `/app` with one active roadmap, one active cycle and the exact accepted tasks;
7. use Calendar, Curriculum, Tests, Coach and Settings with the captured context;
8. retry any interrupted request without duplicating commitments, roadmaps, cycles or tasks.

No timeline, low availability or diagnostic result may deny access.

---

## 3. Implementation principles

- **Server-owned truth:** Authentication, step validity, preview revision and completion state are determined on the server.
- **Additive migrations:** Preserve existing accounts and history; backfill before tightening constraints.
- **One canonical weekday convention:** `0 = Sunday` through `6 = Saturday` in database and TypeScript.
- **Preview then accept:** Generation may be retried; acceptance is atomic and idempotent.
- **Self-report is not evidence:** Topic exposure and diagnostic evidence remain separate.
- **Commitments are not coverage:** A scheduled class protects time; only a completed class log may create exposure/coverage context.
- **No hours target:** Availability is a ceiling; planned minutes are an output.
- **Render purity:** Loading a page cannot create diagnostics, plans, commitments or tasks.

---

## 4. Slice 0 — Baseline and migration safety

This slice must happen before schema or UI work.

### 4.1 Capture current truth

Record counts and constraints for:

- profiles by onboarding status;
- active/draft roadmaps per user;
- active planning cycles per user;
- ready/accepted plan drafts;
- onboarding-sourced commitments;
- availability rows using invalid weekday values;
- profile rows with `registered = true` and no `exam_date`;
- module-state rows created from self-report.

### 4.2 Preserve a migration path

- Keep existing columns until all readers and writers use the new contracts.
- Backfill before adding `NOT NULL` or validated checks.
- Add constraints as `NOT VALID` where appropriate, clean data, then validate.
- Make the migration rerunnable where practical with `if not exists` and named constraint replacement.
- Include a down/rollback note even when full reversal is not safe.
- Do not run `apply-schema.cjs` against production during plan implementation without explicit review.

### 4.3 Freeze the route/state matrix

Create `docs/ONBOARDING-ROUTE-STATE-MATRIX.md` or place the matrix beside the onboarding domain contract. It must identify the owner of:

- authentication;
- access gating;
- progress/resume;
- normalized answers;
- preview generation;
- preview acceptance;
- downstream settings edits.

### Acceptance

- Current baseline report is saved.
- No migration has been applied.
- Existing tests run and their failures are recorded before changes.

---

## 5. Slice 1 — Database and domain foundation

### 5.1 Migration

#### [NEW] `supabase/migrations/20260918_canonical_onboarding.sql`

The migration is additive and contains the following.

### Profiles

Use existing `profiles.exam_date` as the canonical exact booked date.

Add:

- `class_pattern text` with allowed values `none`, `fixed`, `variable`, `mixed`;
- `onboarding_context_version integer not null default 1`;
- `onboarding_completed_at timestamptz`;
- optionally `onboarding_preview_id uuid` after the preview table exists.

Replace the `onboarding_status` check to allow:

- `not_started`;
- `in_progress`;
- `review_ready`;
- `complete`.

`review_ready` may be omitted as a persisted status if it is derived deterministically. If persisted, only the server may write it.

Update `max_session_minutes` constraints to include `20, 30, 45, 60, 90`.

Retire as onboarding writers, but do not immediately drop:

- `prior_attempts`;
- `background`;
- `reminder_at`;
- `failure_mode`;
- `capacity_factor`.

### Exam target

- Preserve `exam_window_id`, `registered` and `exam_date`.
- Add a check: a complete profile cannot have `registered = true` with a null `exam_date`.
- Do not require `exam_date` for unregistered candidates.
- Correct all roadmap readers to prefer `exam_date` when registered, then fall back to the selected window's planning date.

### Class and life commitments

Confirm/add on `calendar_commitments`:

- `recurrence`;
- `weekdays smallint[]`;
- `start_time` and `end_time`;
- `starts_on` and `ends_on`;
- `timezone`;
- `is_protected`;
- `source`;
- `status`;
- revision fields used by existing optimistic concurrency.

Expand the commitment-kind constraint to include the final product choices, while preserving existing values:

- `class`;
- `work`;
- `college`;
- `personal`;
- `commute`;
- `exercise`;
- `family`;
- `appointment`;
- `travel`;
- `other`.

Validate every weekday array element is between 0 and 6. Add indexes supporting `(user_id, status, kind)` and recurring expansion.

### Availability

The current three-day-part schema can lose multiple gaps in one day. Introduce a canonical exact-window model rather than making `slot` carry two meanings.

#### [NEW] `availability_windows`

Fields:

- `id uuid primary key`;
- `user_id uuid` with cascade ownership;
- `weekday smallint check 0..6`;
- `start_time time`;
- `end_time time`;
- `source text` (`onboarding`, `settings`, `observed_override` where supported);
- `status text` (`active`, `archived`);
- `created_at`, `updated_at`;
- check `end_time > start_time`.

Index active windows by user and weekday. Keep `availability_rules` during migration, then stop writing it from canonical onboarding. Provide a compatibility reader until downstream planning is migrated.

### Topic-level self-report

#### [NEW] `user_topic_exposure`

Fields:

- `user_id`;
- `topic_id`;
- `recency` (`current`, `recent`, `stale`);
- `source` fixed to `self_report` for onboarding;
- `created_at`, `updated_at`;
- primary/unique key `(user_id, topic_id)`.

Do not fan one topic tap out to every module. `user_module_state` remains for module-specific coverage and later evidence-backed state.

### Versioned preview

Prefer linking existing versioned entities instead of creating an unrelated JSON blob.

Add to `plan_drafts`:

- `roadmap_id uuid references study_roadmaps(id)`;
- `onboarding_context_version integer`;
- `context_fingerprint text`;
- `accepted_cycle_id uuid` if not already recoverable;
- `purpose text` constrained to include `onboarding_initial_week`.

Ensure the draft stores:

- proposed cycle dates;
- timezone;
- immutable task JSON for the shown revision;
- revision and status.

Add partial unique indexes:

- at most one active `study_roadmaps` row per user;
- at most one active `planning_cycles` row per user;
- at most one ready onboarding-initial draft per user/context version.

Resolve existing duplicates before validating these indexes.

### Audit/idempotency

Add an idempotency key or use the accepted draft ID as the completion key. The database must be able to return the previously created cycle when the same accepted draft is submitted again.

### RLS and function security

- Enable RLS on every new user-owned table.
- Policies use `(select auth.uid()) = user_id`.
- Security-definer functions set an explicit `search_path`.
- Revoke broad execute permission and grant only to authenticated users where required.
- Functions derive `auth.uid()` internally.

### 5.2 Domain schemas

#### [NEW] `src/lib/onboarding/schema.ts`

Define Zod schemas for:

- `ExamSetup`;
- `PreparationSetup`;
- `PositionSetup`;
- `WeekSetup`;
- `CheckpointSetup`;
- preview adjustments;
- confirmation request.

The schemas are the shared domain contract. Route handlers import them; UI may use inferred types but cannot be the authority.

#### [MODIFY] `src/lib/onboarding/steps.ts`

- Keep route names and metadata.
- Replace obsolete payload types.
- Remove provider name, prior attempts, background, reminder time and failure mode.
- Add class pattern, grouped recurring series, exact exam date, topic recency and explicit no-commitments confirmation.

### Acceptance

- Migration applies to a clean database and a database containing current seed data.
- Backfill preserves existing complete users.
- All new tables have RLS and ownership tests.
- Database rejects invalid weekdays, session lengths and commitment kinds.
- Existing `exam_date` is the only booked-date source.

---

## 6. Slice 2 — Server-owned progress, validation and access

### 6.1 Keep the dynamic route, extract services

Retain:

- `src/app/api/onboarding/[step]/route.ts`

Make it a thin authenticated dispatcher. Move logic to:

#### [NEW] `src/lib/onboarding/service.ts`

Responsibilities:

- authenticate and identify user;
- parse the appropriate schema;
- validate cross-field rules;
- write normalized state idempotently;
- increment `onboarding_context_version` only when a planning-relevant answer actually changes;
- invalidate stale ready previews after upstream changes;
- compute first incomplete step from stored validity.

Separate physical endpoint files are optional, not a requirement. A dynamic route is valid in the installed Next.js version and avoids six copies of authentication/error handling.

### 6.2 Progress semantics

Do not rely only on `profiles.onboarding_step` as “last page visited.” Determine resume from valid stored answers:

1. exam target valid;
2. preparation route valid;
3. position valid;
4. week valid;
5. checkpoint valid;
6. preview current and ready.

`onboarding_step` may remain a denormalized display optimization, but it is not authorization.

### 6.3 Access enforcement

#### [MODIFY] `src/app/app/layout.tsx`

- Authenticate server-side.
- Read onboarding status.
- Redirect incomplete users to `/onboarding`.
- Remove obsolete `AppStateProvider` coupling as part of the wider shell cleanup if still present.

#### [MODIFY] `src/app/onboarding/page.tsx`

- Redirect complete users to `/app`.
- Redirect incomplete users to the first incomplete valid step.

#### [MODIFY] `src/app/onboarding/[step]/page.tsx`

- Authenticate server-side.
- Reject unknown steps.
- Redirect attempts to jump beyond the first missing required step.
- Allow backward navigation to completed steps.
- Fetch independent data in parallel.
- Pass only the minimal serializable state required by the active client component.

The proxy continues refreshing sessions and protecting anonymous routes. It does not replace server-side onboarding authorization.

### 6.4 Error contract

Return consistent JSON:

```ts
type OnboardingResponse<T = unknown> =
  | { ok: true; data?: T; next?: string }
  | { ok: false; code: string; message: string; fields?: Record<string, string> }
```

Use:

- `400` for invalid input;
- `401` for no session;
- `403` for a forbidden state transition;
- `409` for stale preview/revision conflict;
- `422` for valid syntax but unresolved cross-field contradiction;
- `500` for unexpected server failure.

### Acceptance

- Required steps cannot be skipped by URL or API.
- Back navigation works.
- Changing an upstream answer invalidates the preview.
- Refresh and re-login resume correctly.
- One user's IDs cannot mutate another user's setup.

---

## 7. Slice 3 — Exam, preparation route and position UI

### 7.1 Shared shell

#### [MODIFY] `src/components/onboarding/OnboardingShell.tsx`

- Remove “Skip this” for required steps.
- Replace “Every answer is optional” with accurate setup-gate copy.
- Disable forward progress only with a visible reason.
- Show field-level and page-level errors.
- Prevent duplicate submission.
- Announce saving/error states accessibly.
- Do not link the brand to inaccessible `/app` for incomplete users.
- Keep stable URLs and native Back/Forward behaviour.

### 7.2 Exam

#### [MODIFY] `src/components/onboarding/steps/ExamStep.tsx`

Implement:

- active year and February/May/August/November window cards;
- registration choice;
- conditional exact booked-date input;
- indicative labelling for unconfirmed window metadata;
- silently detected timezone with fallback/correction only when needed.

Rules:

- a window is required;
- registered requires exact date;
- unregistered stores no fabricated exact date;
- date outside the known window is confirmable, not silently rejected.

### 7.3 Preparation route

#### [MODIFY] `src/components/onboarding/steps/RouteStep.tsx`

Implement:

- four preparation routes;
- conditional fixed/variable/mixed class pattern;
- grouped recurring class series;
- multi-day same-time selection;
- optional end date;
- clear explanation of weekly Calendar sync for variable schedules.

Remove provider/source-name input.

### 7.4 Position

#### [MODIFY] `src/components/onboarding/steps/PositionStep.tsx`

Implement:

- six starting-stage cards;
- conditional ten-topic multi-select;
- batch recency selection with optional per-topic adjustment;
- contradiction handling between Not started and selected topics.

Remove background and prior-attempt fields.

### Acceptance

- Conditional questions appear and clear safely.
- Hidden stale values are not submitted.
- Every control has a visible label and keyboard support.
- Topic selections write only topic exposure.
- Google and email users experience the same flow.

---

## 8. Slice 4 — Real week and checkpoint UI

### 8.1 Commitments first

#### [MODIFY] `src/components/onboarding/steps/WeekStep.tsx`

Reorder the interaction:

1. Show fixed classes from Step 2 as protected and non-duplicable.
2. Collect recurring unavailable time from presets.
3. Require either one commitment or explicit “no other fixed commitments.”
4. Derive remaining gaps.
5. Let the user confirm/edit realistic study windows.
6. Select maximum sitting length.

Do not ask users to mark broad day parts before known commitments are subtracted.

The remaining-window calculation must be a pure, tested function:

#### [NEW] `src/lib/onboarding/deriveAvailability.ts`

Inputs:

- recurring classes;
- recurring life commitments;
- day boundaries;
- minimum useful fragment;
- timezone.

Outputs:

- non-overlapping candidate windows;
- conflicts;
- fragments too small for the selected sitting length.

The user confirms which derived gaps are genuinely usable. The UI shows available space as a ceiling, not a required target.

### 8.2 No-window exception

If no usable window exists:

- do not deny access;
- offer Edit commitments;
- offer Continue with a floating-only initial week;
- require acknowledgement that timed placement is unavailable;
- make the first-week preview explain the result.

### 8.3 Checkpoint

#### [MODIFY] `src/components/onboarding/steps/CheckpointStep.tsx`

- Ask only for the day that closes the study week.
- Recommend a day based on classes/windows.
- Remove reminder time and failure mode.
- Explain that diagnostics depend on eligible coverage and bank sufficiency.

### 8.4 Capacity correction

#### [MODIFY] `src/lib/curriculum/roadmapService.ts`

The current `weeklyCapacityMinutes` counts one maximum session per selected slot rather than the duration of exact windows. Replace it with exact-window capacity, subtract protected overlaps once, and keep this value as a ceiling.

Prefer a registered user's `exam_date` before the representative window date. The current read order does the reverse and would ignore the exact booking.

### Acceptance

- Derived windows never overlap protected commitments.
- Multiple gaps on the same day can be represented.
- Capacity uses actual window durations.
- Maximum sitting length controls task splitting, not total weekly demand.
- No-window users reach Review with an honest floating-only preview.

---

## 9. Slice 5 — Deterministic preview and atomic completion

This is the most important correction to the original plan.

### 9.1 Preview read model

#### [NEW] `src/lib/onboarding/previewService.ts`

Responsibilities:

1. Load normalized onboarding context.
2. Validate that required setup is complete.
3. Generate a deterministic draft roadmap.
4. Generate a deterministic first-week draft.
5. Run conflict and diagnostic-sufficiency checks.
6. Persist the draft roadmap, milestones and plan draft as one preview revision.
7. Compute a fingerprint from planning-relevant context.
8. Return a review read model.

The preview endpoint is explicit and mutation-aware:

- `GET /api/onboarding/plan` returns the current ready preview when its fingerprint is current;
- `POST /api/onboarding/plan/preview` creates or regenerates a preview;
- `PATCH /api/onboarding/plan/preview` applies lighter/more-space/move/floating adjustments and creates a new revision;
- `POST /api/onboarding/plan/confirm` accepts a specific draft ID and expected revision.

If keeping the dynamic route is preferred, these can be implemented under the Plan branch with action-specific endpoints. The key requirement is that preview and confirmation are distinct operations.

### 9.2 Review UI

#### [MODIFY] `src/components/onboarding/steps/PlanStep.tsx`

Show:

- complete setup summary with Change links;
- roadmap phases and provisional first-pass range;
- current milestone;
- first cycle dates;
- protected commitments;
- timed and floating work;
- objective, approach and verification intent for every task;
- planned minutes versus available ceiling;
- diagnostic scope or honest reason for absence;
- conflicts, assumptions and unsupported areas.

Add controls:

- Make it lighter;
- Use more available space;
- Move a block;
- Keep a task floating;
- Regenerate after setup changes.

### 9.3 Atomic acceptance RPC

#### [NEW OR REPLACE] `public.accept_onboarding_preview`

The function must:

1. derive `auth.uid()`;
2. lock the selected `plan_drafts` row;
3. verify ownership, purpose, `ready` status, expected revision and context version/fingerprint;
4. return the existing cycle if this draft was already accepted;
5. lock/supersede any prior active draft records as defined;
6. activate the linked roadmap and supersede prior active roadmap;
7. create one planning cycle using the stored local dates and stored timezone;
8. insert tasks by reading `draft_json` inside the function;
9. mark the draft accepted and link the cycle;
10. write the final versioned onboarding snapshot;
11. set profile status, step, completion time and preview ID;
12. return roadmap ID, cycle ID and destination.

The function must not accept `p_tasks` from the client and must not default timezone to UTC.

### 9.4 Existing RPC/API correction

The current `accept_plan_draft` and `/api/plan/accept` are insufficient because:

- task JSON is passed as an RPC argument;
- cycle timezone defaults to UTC in the route;
- profile completion happens after the RPC;
- roadmap activation is not in the same transaction;
- retry recovery is incomplete.

Either replace this path for onboarding or safely generalize the RPC without breaking non-onboarding plan acceptance.

### 9.5 Completion destination

After success:

- redirect to `/app`;
- Home shows the first next action and links to `/app/calendar`;
- do not redirect straight to Calendar unless the canonical product flow is explicitly changed.

### Acceptance

- Accepted tasks byte-for-byte/field-for-field match the reviewed revision.
- Stale revision returns 409.
- Double confirmation returns the same cycle and creates no duplicate.
- Any failure leaves onboarding incomplete.
- Exactly one roadmap and one cycle are active.
- Plan generation never runs during a render.

---

## 10. Slice 6 — Cross-product connections

The original plan's “update AppShell and layout” is too narrow. Every captured answer needs a consumer.

### Home `/app`

- Show exam target and current phase.
- Show next accepted action.
- Show today's class/commitment context.
- Show variable-class weekly-sync prompt.
- Show conflicts or unplaced work.
- Link to Calendar, Tests and Curriculum without repeating onboarding.

### Calendar `/app/calendar`

- Render accepted blocks, classes and protected commitments.
- Add Upcoming class and Completed class modes.
- For variable/mixed users, implement weekly class sync.
- Adding a class produces a re-planning proposal; it does not silently rewrite the week.
- Completed class logs confirmed topic/module coverage and may propose consolidation.

### Curriculum `/app/curriculum`

- Show self-reported topic exposure separately from module evidence.
- Connect active roadmap and milestone.
- Do not call exposure “verified.”

### Tests `/app/tests`

- Use confirmed coverage and valid bank sufficiency.
- Respect checkpoint and Calendar space.
- Do not infer mastery from onboarding.

### Coach `/app/coach`

- Read the same operating state.
- Explain roadmap/calendar/test decisions.
- Propose changes but require confirmation for material calendar mutations.
- Do not teach full subjects.

### Settings `/app/settings`

- Edit exam booking/date, route, class pattern, recurring classes, commitments, windows, sitting length and checkpoint.
- Planning-relevant edits increment context version and produce a preview proposal for any active week.
- Historical cycles/evidence remain unchanged.

### Legacy cleanup

- Retire `study-context.ts` from canonical onboarding after a one-way compatibility adapter.
- Remove obsolete provider/material fields from onboarding.
- Redirect or retire legacy onboarding preview/gate paths.
- Remove old demo `AppState` dependencies from the production shell.

### Acceptance

- Every onboarding field has an observable downstream consumer.
- No page uses a legacy blob when normalized state exists.
- Calendar class logging updates planning through proposals.
- Settings edits cannot silently rewrite accepted history.

---

## 11. Slice 7 — Testing and release verification

### 11.1 Unit tests

Add tests for:

- every Zod schema and conditional rule;
- first-incomplete-step resolution;
- context fingerprint stability;
- availability subtraction and fragmented gaps;
- capacity calculation;
- exact-date precedence;
- class-pattern branching;
- topic exposure mapping;
- preview invalidation;
- composer task splitting and conflict prevention.

### 11.2 Database tests

Test:

- invalid weekday/commitment/session constraints;
- RLS isolation;
- one-active-roadmap and one-active-cycle indexes;
- stale revision rejection;
- accepted-preview idempotency;
- forced failure rollback;
- no client-supplied task injection;
- completion status changes only inside the RPC.

### 11.3 API integration tests

Rewrite `scripts/e2e-onboarding.ts` for the canonical payloads and assertions. Cover:

- unregistered self-study;
- registered exact-date candidate;
- fixed classes;
- variable classes;
- mixed classes;
- prior topic exposure;
- no other commitments;
- no usable timed window;
- preview adjustment;
- stale confirmation;
- repeat confirmation;
- upstream edit invalidating preview.

Use a dedicated disposable E2E identity. Never default to a personal account.

### 11.4 Browser E2E

Replace placeholders in `tests/e2e/truth.spec.ts` with authenticated fixtures and real assertions.

Required Playwright journeys:

1. Anonymous `/app/*` redirect.
2. Incomplete authenticated user redirect.
3. Required questions cannot be skipped by click or direct URL.
4. Refresh/resume on every step.
5. Conditional class/date fields.
6. Back-edit-forward invalidation.
7. Review and adjustment.
8. Atomic completion and `/app` landing.
9. Mobile 320px journey.
10. Keyboard-only journey.
11. No hydration, console or uncaught page errors.
12. Page renders cause no database mutations.

### 11.5 Verification commands

- schema migration against a disposable Supabase environment;
- `npm run lint`;
- existing deterministic unit scripts;
- updated onboarding API E2E;
- `npm run test:e2e:browser`;
- `npm run build`;
- route audit.

Add the new suites to `npm run verify` only after they are reliable and isolated.

### 11.6 Manual QA

Verify in the browser:

- fresh Google and email signup;
- session expiry and return;
- desktop and mobile layouts;
- screen-reader labels and focus order;
- visible save/error states;
- no duplicate records after retries;
- exact reviewed tasks on Home and Calendar;
- class logging proposal flow;
- Settings edits and preview regeneration.

### Acceptance

- Automated suite passes from a clean reset.
- Browser console is clean.
- No test depends on production/user data.
- The migration report and before/after row counts are reviewed.

---

## 12. File-by-file change map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260918_canonical_onboarding.sql` | New | Add/backfill canonical schema, RLS, indexes and acceptance RPC |
| `src/lib/onboarding/schema.ts` | New | Authoritative Zod contracts |
| `src/lib/onboarding/service.ts` | New | Step validation, persistence, progress and invalidation |
| `src/lib/onboarding/previewService.ts` | New | Generate/persist exact roadmap and week preview |
| `src/lib/onboarding/deriveAvailability.ts` | New | Pure commitment subtraction and gap derivation |
| `src/lib/onboarding/steps.ts` | Modify | Final step metadata and payload types |
| `src/lib/onboarding/persist.ts` | Refactor/retire | Move writes into canonical service; preserve temporary adapter |
| `src/app/api/onboarding/[step]/route.ts` | Modify | Thin authenticated dispatcher |
| `src/app/api/onboarding/plan/preview/route.ts` | New | Generate/adjust server-owned preview |
| `src/app/api/onboarding/plan/confirm/route.ts` | New | Invoke atomic acceptance RPC |
| `src/app/onboarding/page.tsx` | Modify | Server-derived resume/complete redirect |
| `src/app/onboarding/[step]/page.tsx` | Modify | Enforce ordered access and minimal parallel data loading |
| `src/components/onboarding/OnboardingShell.tsx` | Modify | Required-step navigation, error and save UX |
| `src/components/onboarding/steps/ExamStep.tsx` | Modify | Registration and exact date |
| `src/components/onboarding/steps/RouteStep.tsx` | Modify | Class pattern and recurring series |
| `src/components/onboarding/steps/PositionStep.tsx` | Modify | Six stages and topic recency |
| `src/components/onboarding/steps/WeekStep.tsx` | Modify | Commitments-first exact windows |
| `src/components/onboarding/steps/CheckpointStep.tsx` | Modify | Closing day only |
| `src/components/onboarding/steps/PlanStep.tsx` | Modify | Exact preview, adjustments and confirmation |
| `src/lib/curriculum/roadmapService.ts` | Modify | Exact date precedence and true capacity |
| `src/app/app/layout.tsx` | Modify | Retain mandatory gate, remove legacy state coupling |
| Home/Calendar/Curriculum/Tests/Coach/Settings files | Modify | Consume canonical state and class lifecycle |
| `scripts/e2e-onboarding.ts` | Rewrite | Canonical API integration coverage |
| `tests/e2e/truth.spec.ts` | Rewrite | Real authenticated browser E2E |
| `src/lib/study-context.ts` | Retire/adapter | Remove legacy onboarding authority |

---

## 13. Release gates

### Gate A — Data truth

- Migration and backfill verified.
- Weekday representation consistent.
- Exact exam date has one source of truth.
- Topic exposure is not module evidence.

### Gate B — Flow truth

- Mandatory gate and resume work.
- All required conditional questions work.
- No obsolete questions remain.

### Gate C — Planning truth

- Review shows the exact persisted preview.
- Capacity is based on real windows.
- No overlap with protected time.
- Diagnostics are conditional on valid scope/bank.

### Gate D — Transaction truth

- One RPC accepts preview, roadmap, cycle, tasks and completion.
- Retry is idempotent.
- Forced failure fully rolls back.

### Gate E — Product truth

- Home and Calendar receive the accepted week.
- Variable classes have a continuing workflow.
- Tests, Coach and Curriculum receive correctly qualified context.

### Gate F — Experience truth

- Browser and mobile tests pass.
- Accessibility checks pass.
- Errors are recoverable.
- No page-render side effects remain.

No gate may be waived by marking onboarding complete manually.

---

## 14. Final implementation order

1. Baseline and data audit.
2. Additive schema, backfill, constraints and RLS.
3. Shared Zod/domain contracts.
4. Server persistence, progress and access rules.
5. Exam, route and position screens.
6. Commitments-first week and checkpoint screens.
7. Deterministic preview service and Review UI.
8. Atomic acceptance RPC.
9. Home and Calendar handoff.
10. Curriculum, Tests, Coach and Settings connections.
11. Legacy cleanup.
12. Unit, database, API and browser verification.
13. Production migration review and controlled release.

This order avoids building polished screens on top of ambiguous persistence and prevents the application from declaring onboarding complete before it has an executable week.
