# Roadmap — Phase 0 Truth Baseline: Final Implementation Plan

**Verdict:** Build this phase. Do not skip it.  
**Reason:** It removes false data, hidden writes and unsafe test behaviour that would otherwise contaminate every page rebuilt afterward.  
**Scope discipline:** This phase restores truthful foundations. It does not build the weekly composer, final Home, full Coach action system, or new visual redesign.

---

## 1. Goal

Establish a verified baseline in which:

- page rendering is read-only;
- onboarding remains the mandatory `/app/*` access gate;
- no production student page reads seeded browser-local demo state;
- Coach reads real account state and makes no fake calendar changes;
- destructive E2E scripts cannot default to a real personal account;
- browser automation catches hydration/runtime failures;
- legacy URLs continue to resolve safely while canonical route ownership is documented in enforceable code.

---

## 2. What changes from the submitted plan

| Submitted proposal | Final decision | Reason |
|---|---|---|
| Remove Calendar render mutation | Keep | Required immediately |
| Delete `AppState.tsx` | Keep after dependencies are removed | It is an active false-data source |
| Add a new global Toast Context | Do not add yet | Only dead demo state currently consumes it; Calendar already has its own undo feedback |
| Convert Coach to a Server Component | Use server page + interactive client component | Chat requires client interaction; context must be loaded on the server |
| Keep existing `/api/coach` logic | Rewrite it | It reads legacy `user_metrics` and `test_records`, not the real diagnostic model |
| Install Playwright | Keep | Fetch scripts cannot catch client runtime failures |
| Delete `/app/materials`, `/app/week`, `/app/syllabus` | Do not delete | Preserve compatibility redirects during the migration window |
| Put route matrix only in JSDoc | Replace with typed registry + generated/linked documentation | Comments drift and cannot be audited |
| Run current E2E scripts | Fix test-account safety first | Current scripts default to a personal email and perform destructive resets |

---

## 3. Workstream 0 — E2E identity safety first

This must be completed before running any reset-based E2E suite again.

### [NEW] `src/lib/testing/e2eIdentity.ts`

Provide a single test identity guard used by every reset-capable script:

- require `E2E_EMAIL`; no personal-email fallback;
- require an explicit `E2E_ALLOW_RESET=1` for destructive fixture resets;
- require the account to carry a database `e2e_test_user` role or an approved test-email marker;
- refuse to reset when production environment markers are present;
- print the selected project URL and masked test identity before mutation;
- scope every cleanup query to the verified test user.

### [MODIFY] All `scripts/e2e-*.ts`

Affected scripts:

- `e2e-onboarding.ts`;
- `e2e-routes.ts`;
- `e2e-calendar.ts`;
- `e2e-editing.ts`;
- `e2e-roadmap.ts`;
- `e2e-tests-tab.ts`.

Changes:

- remove `?? 'advayvaidya.25@gmail.com'` defaults;
- import the shared identity guard;
- separate fixture setup from assertions;
- record what was reset and fail loudly on cleanup errors;
- prevent suites from leaving onboarding status or plan data changed for a non-test user.

### Acceptance criteria

- A reset suite cannot begin without an explicitly configured, authorised test identity.
- Running a test against a normal account fails before any database write.

---

## 4. Workstream 1 — Make Calendar and Tests render-pure

### [MODIFY] `src/app/app/calendar/page.tsx`

- Remove the `ensureWeeklyDiagnostic` import and call.
- Load the week exactly once through `loadCalendarWeek`.
- Render only existing accepted tasks and commitments.
- When the week has no accepted plan, show a truthful action to build/review a weekly draft.
- When no diagnostic exists, do not imply one was scheduled.

### [MODIFY] `src/lib/planning/schedule.ts`

- Remove or deprecate the database-writing `ensureWeeklyDiagnostic` function.
- Preserve only pure diagnostic-task construction logic if it will be used by the Phase 1 weekly composer.
- Diagnostic task creation ultimately belongs inside accepted-plan construction and must receive:
  - studied scope;
  - item-bank sufficiency result;
  - target study cycle;
  - checkpoint placement;
  - idempotency key.

### [VERIFY] `src/app/app/tests/page.tsx`

Tests currently reads scheduled diagnostics rather than creating them. Preserve this read-only behaviour.

Update language so the page distinguishes:

- scheduled diagnostic;
- recommended but not scheduled;
- unavailable because no studied scope exists;
- unavailable because the eligible unseen bank is insufficient.

### Existing orphan blocks

Do not silently delete historical weekly diagnostic blocks created by page renders.

Add a read-only reconciliation script that reports likely orphans:

- `task_type = diagnostic`;
- `origin = planner`;
- `cycle_id is null`;
- no linked assessment attempt;
- created before render-side scheduling was removed.

Any cleanup or cancellation is a separate reviewed operation with an audit trail.

### Test updates

- Replace the existing E2E assertion “visiting Calendar schedules a diagnostic” with “visiting Calendar does not change plan-block counts”.
- Visit Calendar and Tests repeatedly and assert zero writes.
- Preserve a separate future test proving weekly-plan acceptance creates one eligible diagnostic idempotently.

---

## 5. Workstream 2 — Remove legacy AppState without rebuilding the full Coach

Dependency review confirms `AppState` is currently consumed only by:

- `/app/layout.tsx` through `AppStateProvider`;
- `AppShell.tsx` for demo toasts;
- `/app/coach/page.tsx` for seeded messages/actions.

### [MODIFY] `src/app/app/layout.tsx`

- Preserve authentication and mandatory onboarding gates.
- Remove `AppStateProvider` after Coach and AppShell no longer consume it.

### [MODIFY] `src/components/AppShell.tsx`

- Remove `useAppState`.
- Remove the seeded-page prototype banner once the affected pages are truthful.
- Remove the global demo toast renderer.
- Do not introduce a new global toast provider until a real cross-page consumer exists.
- Preserve Calendar's existing independent `UndoToast`.

### [DELETE] `src/state/AppState.tsx`

Delete only after all imports are removed and repository search confirms no dependency.

Also remove dead demo types/data that exist solely for AppState after dependency verification.

---

## 6. Workstream 3 — Minimum truthful Coach foundation

Full Coach proposals, persistent conversations and calendar tools remain in the dedicated Coach phase. Phase 0 only makes the current page honest and connected.

### [MODIFY] `src/app/app/coach/page.tsx`

Use a server page to:

- authenticate the user;
- load `getCurrentOperatingState(user.id)`;
- load concept summaries and open repair threads required for Coach context;
- pass a serialisable, permissioned snapshot to a new interactive component.

### [NEW] `src/components/coach/CoachClient.tsx`

Client responsibilities:

- render the initial real-state summary;
- send a message to `/api/coach`;
- show loading, failure and retry states;
- render suggestions based on actual attention items;
- never seed Fixed Income, readiness scores or mock history;
- never show “Apply recovery plan” until a real proposal exists.

Conversation persistence is not required in Phase 0. Clearly label the session as non-persistent if that remains true.

### [MODIFY] `src/app/api/coach/route.ts`

- Remove `demo`, `demoContext`, `user_metrics` and `test_records`.
- Authenticate before model configuration details are evaluated.
- Build context server-side from:
  - Operating State;
  - recent real assessment attempts;
  - concept summaries;
  - open repair threads;
  - current roadmap milestone;
  - current accepted cycle.
- Pass a compact structured context, not unrestricted raw rows.
- Enforce the product boundary: planning, sequencing, accountability, weakness interpretation and source direction—not full curriculum teaching.
- Return structured fields such as `reply`, `evidenceUsed`, `limitations` and optional `suggestedIntent`.
- Do not mutate Calendar or Curriculum.
- If the NVIDIA model is unavailable, provide an honest deterministic state summary rather than inventing a weakness.

### [MODIFY] Operating State

Expand only what the truthful Coach and Home foundation need now:

- onboarding/exam identity;
- active milestone;
- current cycle summary;
- today's tasks;
- latest diagnostic summary;
- concept-state counts;
- open repair count;
- attention items with action links.

Avoid `any` in the public contract.

### Acceptance criteria

- Coach never displays seeded names, topics, scores or messages.
- Its stated facts can be traced to real account data.
- It cannot apply a fake recovery plan.
- Missing evidence produces an explicit limitation, not fabricated advice.

---

## 7. Workstream 4 — Browser E2E foundation

### Dependency decision

Install `@playwright/test` as a development dependency. This is recommended because the existing fetch-based suites are useful contract tests but cannot execute React, observe hydration, inspect Next.js overlays or test focus/interaction.

Use Playwright for repeatable CI browser coverage and continue using the shared Browser plugin for human-visible exploratory and regression QA. They serve different purposes.

### [NEW] `playwright.config.ts`

- Chromium-first for Phase 0;
- base URL from `PLAYWRIGHT_BASE_URL`;
- controlled local web server;
- trace and screenshot on failure;
- serial execution for account-mutating onboarding specs;
- no reuse of a developer's normal browser profile;
- dedicated E2E identity only.

### [NEW] `tests/e2e/onboarding-access.spec.ts`

Cover:

1. Signed-out `/app/*` routes redirect to Login with a safe return path.
2. Authenticated incomplete user is redirected from every canonical workspace route to `/onboarding`.
3. `/onboarding` resumes the first incomplete step.
4. Exam choice and Continue do not trigger maximum-update-depth or hydration errors.
5. Step state survives refresh.
6. Completing onboarding unlocks Home.
7. A duplicate final submission creates no duplicate roadmap/cycle/tasks.

### [NEW] `tests/e2e/render-purity.spec.ts`

- Record plan-block counts through a test-only fixture helper.
- Visit Calendar and Tests repeatedly.
- Assert counts and revisions do not change.

### Runtime failure policy

Capture and fail on:

- uncaught `pageerror` events;
- console errors, with a small explicit allowlist for known browser-extension noise only;
- Next.js error overlays;
- failed same-origin API requests required by the journey;
- hydration mismatch text;
- blank or missing main content.

Do not fail indiscriminately on every console warning; warnings must be collected and reviewed separately to avoid brittle tests.

### [MODIFY] `package.json`

Add:

- `test:browser`;
- `test:browser:headed`;
- `test:contracts` for existing fetch-based suites;
- `verify:phase0` combining typecheck, unit/contract tests and browser tests.

---

## 8. Workstream 5 — Canonical routes without breaking URLs

### Do not delete compatibility routes in Phase 0

Keep:

- `/app/materials` → permanent redirect to `/app/settings/sources`;
- `/app/syllabus` → permanent redirect to `/app/curriculum`;
- `/app/week` → permanent redirect to `/app/calendar` while preserving supported query parameters.

These routes contain no product implementation and are not shown in navigation. Removing them now would break bookmarks and older links without creating user value.

### [NEW] `src/lib/routing/registry.ts`

Create a typed route registry containing:

- canonical path;
- visibility: public, onboarding, student, staff, compatibility;
- owning feature;
- access requirement;
- navigation label where applicable;
- replacement target for compatibility routes.

Use the registry for Sidebar items and route-audit expectations where practical.

### [NEW] `docs/ROUTE-AND-STATE-OWNERSHIP.md`

Human-readable explanation of:

- route ownership;
- state read owner;
- mutation service owner;
- incoming/outgoing links;
- compatibility policy.

Link this document from `operatingState.ts`; do not copy the full matrix into a JSDoc block that can drift independently.

### Staff diagnostic routes

Current review and manifest pages already fail closed through `user_roles`. In Phase 0:

- remove the student-facing Item Review link unless `checkIsReviewer` is true;
- keep fail-closed route guards;
- document their future move to `/admin/*`;
- perform the physical route move when the admin shell is built, with compatibility redirects for authorised staff.

---

## 9. Explicitly out of scope for Phase 0

- Final weekly composer and draft acceptance UX.
- Full action-first Home redesign.
- Persistent Coach conversations.
- Coach calendar mutation tools.
- Complete curriculum graph expansion.
- Diagnostic generation/model-training changes.
- Premium source ingestion.
- Route deletion after compatibility sunset.
- Broad visual redesign.

These depend on the truthful foundation created here.

---

## 10. Implementation order

1. E2E identity safety.
2. Render-purity change and updated contract tests.
3. Expand typed Operating State minimally.
4. Build truthful Coach server/client split and rewrite API context.
5. Remove AppState, provider, banners and dead demo dependencies.
6. Add typed route registry and ownership documentation.
7. Add Playwright configuration and Phase 0 browser specs.
8. Run full automated verification.
9. Run shared-browser manual QA on authentication, onboarding, Home, Calendar, Tests and Coach.

---

## 11. Verification plan

### Static and unit/contract checks

- TypeScript passes.
- Production build passes.
- Existing verifier, study-week, mutation and roadmap suites pass.
- Route audit passes against the canonical registry.
- Repository search finds no `AppState`, seeded Coach facts, `roadmap-cfa-demo-v2`, legacy `user_metrics` or `test_records` runtime reads.

### Database and API checks

- Visiting Calendar/Tests produces zero writes.
- Incomplete onboarding gates every `/app/*` route.
- Coach context queries are user-scoped.
- Reviewer routes fail closed.
- Reset scripts refuse non-test identities.

### Browser checks

- No Next.js overlay, hydration mismatch, uncaught error or blank page.
- Onboarding exam selection advances successfully.
- Completed onboarding unlocks the app; incomplete onboarding does not.
- Calendar Week/Agenda and task drawer still work.
- Coach renders only real/empty state and can send a non-mutating message.
- Desktop and mobile navigation remain usable.

---

## 12. Phase 0 exit condition

Phase 0 is complete when every visible student page is truthful even if incomplete: no page mutates state by being viewed, no page displays seeded progress, no automated test can reset a real user by default, onboarding reliably gates the workspace, and the team has repeatable browser evidence that the foundation is safe for the page-by-page rebuild.
