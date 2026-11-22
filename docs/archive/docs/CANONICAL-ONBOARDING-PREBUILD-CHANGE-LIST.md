# Canonical Onboarding — Final Pre-Build Change List

**Reviewed:** 18 September 2026  
**Input reviewed:** Pasted “Roadmap — Canonical Onboarding Implementation Plan”  
**Verdict:** Directionally correct and close to implementation-ready, but the following changes must be incorporated before building.

## P0 — Must correct before implementation

### 1. Correct the transaction language

Do not describe onboarding as a “single transactional flow.” Individual steps are resumable, idempotent saves. Only final acceptance must be one atomic PostgreSQL transaction.

Use this language:

> Onboarding is a resumable multi-step flow culminating in one atomic acceptance transaction for the exact reviewed roadmap and first-week preview.

### 2. Define the exact preview and confirmation endpoints

Add these explicit contracts:

- `GET /api/onboarding/plan` — return the current valid preview or its generation state;
- `POST /api/onboarding/plan/preview` — generate and persist a preview;
- `PATCH /api/onboarding/plan/preview` — create a new revision after lighter/more-space/move/floating adjustments;
- `POST /api/onboarding/plan/confirm` — accept a specified draft ID and expected revision.

The existing dynamic route can remain for the five answer steps. Preview and confirmation must be separate operations.

### 3. Persist the preview atomically too

`previewService.ts` may compute the roadmap and week in TypeScript, but roadmap draft, milestones and plan draft must be persisted together. Use a database function such as `create_onboarding_preview`, or a server-side SQL transaction. Do not leave an orphaned roadmap if milestone or plan-draft insertion fails.

### 4. Fully specify `plan_drafts`

The migration must add/confirm:

- `roadmap_id`;
- `purpose = 'onboarding_initial_week'`;
- `onboarding_context_version`;
- `context_fingerprint`;
- stored local cycle start/end dates;
- stored timezone;
- `accepted_cycle_id` or equivalent recovery link;
- existing revision and status semantics.

Add a partial unique index allowing at most one Ready onboarding preview for a user and context version.

### 5. Fully specify the acceptance RPC

`accept_onboarding_preview` must:

- derive `auth.uid()` internally;
- set an explicit safe `search_path` if security-definer;
- lock the draft row;
- verify user, purpose, Ready state, expected revision, context version and fingerprint;
- read tasks from locked server-owned `draft_json`;
- activate the linked roadmap;
- supersede the previous active roadmap;
- create one cycle using stored local dates and timezone;
- insert the exact reviewed tasks;
- mark the draft Accepted and link its cycle;
- save the final onboarding snapshot;
- set profile status, step and completion time;
- return existing IDs when the same accepted draft is retried;
- roll back all changes on any failure.

Remove client-supplied task JSON and any UTC fallback.

### 6. Add active-record uniqueness

Before validating, clean existing duplicates and add partial unique indexes for:

- one Active roadmap per user;
- one Active planning cycle per user;
- one Ready onboarding preview per user/context version.

### 7. Correct exam-date precedence

The current roadmap loader checks the representative exam-window date before `profiles.exam_date`, meaning the exact booked date can be ignored. The plan must explicitly modify `src/lib/curriculum/roadmapService.ts` to use:

1. `exam_date` when `registered = true`;
2. otherwise the selected exam window's planning date.

### 8. Correct capacity calculation

The current capacity calculation counts a maximum session for each selected slot rather than the duration of actual windows. Add an explicit `roadmapService.ts` change to:

- sum exact availability-window duration;
- avoid double-subtracting protected commitments;
- treat the result as a ceiling;
- use maximum session length only for task splitting.

### 9. Do not destructively replace `availability_rules`

Create `availability_windows` additively. Include:

- a backfill/compatibility reader;
- a writer cutover point;
- a downstream-consumer migration list;
- a later retirement step for `availability_rules`.

Do not drop the existing table in this migration.

### 10. Specify schema constraints, RLS and grants

The migration must include:

- canonical weekdays `0–6` everywhere;
- `end_time > start_time` checks;
- `20, 30, 45, 60, 90` session constraint;
- final commitment-kind constraint;
- class-pattern/preparation-route consistency validation;
- complete registered profile requires `exam_date`;
- RLS policies for every new user-owned table;
- indexes for active user/window/commitment reads;
- restricted RPC execute grants;
- explicit security-definer `search_path`.

### 11. Define topic-exposure cutover

`user_topic_exposure` is correct, but the plan must say:

- stop onboarding from expanding topic taps into all modules;
- preserve existing historical `user_module_state` rows;
- do not infer detailed recency from legacy rows unless provenance supports it;
- update Curriculum, roadmap input and Tests to read topic exposure only as self-report;
- never convert it to verified evidence.

### 12. Fix the completion destination

The manual verification currently expects `/app/calendar`. Change it to `/app`, the canonical action-first Home. Home then links to Calendar and shows the first accepted action.

## P1 — Required for the complete product flow

### 13. Include `OnboardingShell.tsx`

The UI slice must explicitly modify the shell to:

- remove required-step Skip actions;
- remove “every answer is optional” copy;
- show visible reasons when Continue is disabled;
- provide field and page errors;
- prevent duplicate saves;
- expose accessible saving/error status;
- keep optional detail controls optional;
- prevent the brand link from bypassing the gate.

“Remove all Skip options” should mean step-level skipping. Optional fields such as class end date may still use Not now.

### 14. Define ordered navigation behaviour

Add acceptance rules:

- completed users cannot re-enter onboarding accidentally;
- incomplete users resume at the first invalid required step;
- backward navigation is allowed;
- direct forward URLs redirect to the first incomplete step;
- upstream changes increment context version and invalidate Ready previews;
- `onboarding_step` is display metadata, not authorization truth.

### 15. Add the no-window acknowledgement contract

For candidates with no timed availability:

- never deny access;
- offer Edit commitments or Continue with floating-only work;
- store explicit acknowledgement;
- show the limitation in Review;
- do not invent a timed block.

### 16. Define preview adjustment semantics

“Density” is too ambiguous. Name the user actions and persistence effects:

- Make it lighter;
- Use more available space;
- Move a block;
- Keep a task floating.

Each creates a new draft revision. It does not silently alter availability, maximum session length or long-term capacity assumptions.

### 17. Complete the class continuation workflow

Slice 6 must include:

- Calendar **Upcoming class** mode: protects time and creates a change proposal;
- Calendar **Completed class** mode: records confirmed coverage and proposes consolidation;
- weekly sync for Variable/Mixed users;
- Copy last week, No classes this week and Add later actions;
- no scheduled class automatically counting as coverage;
- no silent rewrite of an accepted week.

### 18. Include Coach explicitly

Coach must read the same operating state and may explain/propose schedule changes, diagnostic weaknesses and LOS references. It must not teach entire subjects or execute material calendar changes without confirmation.

### 19. Define Settings mutation behaviour

Planning-relevant Settings edits must:

- increment context version;
- preserve past cycles/evidence;
- generate a proposal for the active/future week;
- never silently rewrite accepted history.

### 20. Define legacy cutover

Add explicit tasks to:

- retain a one-way compatibility adapter for `study-context.ts`;
- remove it as onboarding authority;
- remove provider/material fields from onboarding;
- replace legacy `AppState` toast usage before deleting its provider;
- redirect/retire obsolete onboarding preview/gate paths.

## P1 — Testing required before release

### 21. Expand database verification

Test:

- RLS isolation;
- invalid weekdays/times/session values;
- one-active-record indexes;
- stale revision rejection;
- forced rollback at every acceptance stage;
- idempotent repeated confirmation;
- unauthorized draft access;
- client task injection impossibility;
- no profile Complete status outside the RPC.

### 22. Expand API branch coverage

The onboarding integration suite must cover:

- registered versus unregistered exam targets;
- exact booked-date precedence;
- self-study, self-paced, Fixed, Variable and Mixed classes;
- Not started versus prior topic exposure;
- explicit no-commitments response;
- exact windows and floating-only exception;
- upstream edit invalidating preview;
- lighter/more-space/move/floating revision;
- stale and repeated confirmation.

### 23. Replace Playwright placeholders

The browser suite must use disposable authenticated fixtures and assert:

- anonymous and incomplete-user gates;
- direct-URL skip prevention;
- refresh/resume on every step;
- conditional fields;
- Back-edit-Forward behaviour;
- exact Review-to-Home handoff;
- 320px mobile layout;
- keyboard-only completion;
- no console, hydration or uncaught errors;
- page renders create no database mutations.

### 24. Add migration rehearsal requirements

Before production:

- apply to a disposable database containing a production-like snapshot;
- record before/after counts;
- identify and repair duplicates before unique indexes;
- validate all deferred constraints;
- run the entire API/browser suite;
- document rollback and controlled cutover;
- obtain explicit migration review.

## Final go/no-go checklist

The build may start after the plan explicitly contains all of the following:

- [ ] Multi-step resumable flow; atomic final acceptance only.
- [ ] Exact preview/adjust/confirm endpoints.
- [ ] Atomic preview persistence.
- [ ] Fully specified plan-draft linkage and indexes.
- [ ] Fully specified secure/idempotent acceptance RPC.
- [ ] Exact exam-date precedence fix.
- [ ] Exact-window capacity fix.
- [ ] Additive availability migration and compatibility cutover.
- [ ] Topic-exposure cutover without fabricated module evidence.
- [ ] Onboarding shell and ordered-navigation changes.
- [ ] No-window acknowledgement.
- [ ] Explicit preview adjustment semantics.
- [ ] Full Calendar class continuation workflow.
- [ ] Home, Calendar, Curriculum, Tests, Coach and Settings connections.
- [ ] Legacy-state replacement plan.
- [ ] Database, API and real browser verification.
- [ ] Final redirect to `/app`.

Once these are incorporated, the plan is proper to build.
