# Operating State V2 and Home — revised final implementation plan

**Date:** 19 September 2026  
**Status:** revised after code, schema, and product-decision audit  
**Authority:** `docs/FOUNDER-PRODUCT-DECISIONS.md` → `docs/HOME-PAGE-END-TO-END-BUILD-SPEC.md` → this implementation plan  
**Outcome:** one account-scoped read model and an action-first Home connected to real commands, papers, logging, closure, Calendar, Curriculum, Tests, and Coach

## 1. Verdict on the submitted plan

The submitted plan has a good TDD structure and correctly removes the blended readiness percentage, but it is not safe to implement unchanged.

Required corrections:

1. The repository is already mid-migration. `src/lib/state/types.ts`, `operatingStateRepository.ts`, and `coachContext.ts` exist, while the old loader and consumers still expect the previous type. Typecheck currently fails. The plan must begin by reconciling this partial state, not by creating a second `typesV2.ts`.
2. Calendar currently writes a generated week during page render. There is no permitted render-mutation exception. This must be removed.
3. Activation cannot be inferred from `currentWeekTaskCount === 0`. An empty day or deliberately empty week is not automatically failed activation. Activation must use accepted draft/cycle state and explicit failure state.
4. Retry activation must not call `buildWeekPlan` and commit tasks directly. It must restore/regenerate a versioned draft, show the preview, and use the atomic acceptance command.
5. A normal task must not outrank a due weekly paper. Only an already in-progress task may precede it.
6. The paper model must include diagnostic, revisionary, and mixed papers. A generic `task_type='diagnostic'` is not enough to determine purpose.
7. Bank sufficiency cannot remain `null` while the UI calls a paper confirmed. Sufficiency must be checked before scheduling and rechecked when reserving the form.
8. Current draft repository queries reference nonexistent or incorrect columns, including derived evidence fields and Coach proposal display fields. The query layer must be built from verified live schema contracts.
9. The proposed `AttentionItem` includes informational items, but Home attention is reserved for actionable decisions.
10. The proposed Home is only a partial first viewport. The approved Home also requires week execution, evidence freshness, roadmap trajectory, learning capture, paper/closure, and contextual Coach entry.
11. Client-provided Coach context must be removed. The server creates the restricted `CoachContext`.
12. Known failing E2E suites cannot be accepted as the final qualification state. They must be fixed or formally quarantined with a tracked owner and expiry before release.

## 2. Global implementation rules

- Read the repository's installed Next.js 16 documentation before changing routes, Server Components, caching, or request APIs.
- Do not create parallel operating-state loaders.
- Do not create `typesV2.ts`; `src/lib/state/types.ts` is the canonical contract.
- `getOperatingState(userId, now)` is read-only and is the only full operating-state assembler.
- Page renders and GET requests do not create plans, tasks, attempts, repairs, proposals, or activity rows.
- Server Components render state. Small Client Components own only interactions, drawers, and pending UI.
- Independent reads begin together and are awaited together; do not create sequential query waterfalls.
- Keep client serialization narrow. Do not pass the entire operating state into every interactive child.
- Prefer authenticated RLS-scoped reads. Any service-role query must be server-only, explicitly scoped by `user_id`, and covered by cross-account tests.
- Every mutation requires authentication, server validation, expected revision/idempotency where applicable, audit history, and a defined stale/conflict response.
- No readiness percentage, pass probability, required-hours instruction, or fabricated zero.
- Activity, confidence, curriculum position, and demonstrated understanding remain separate.
- New learning produces a diagnostic paper; revision produces a revisionary paper; mixed scope produces a labelled mixed paper.
- Class cycles define class-going weeks. Self-study uses Monday–Saturday with the closing paper on Sunday.
- No paper action appears unless the form can be validly assembled/reserved.
- No next-week generation occurs until the weekly paper is scored and outstanding logs are completed or explicitly marked unknown.
- Sources/materials do not appear in Home or this state contract.

---

## Task 0 — Stabilise the partial migration and freeze the real schema contract

**Goal:** Return the repository to a coherent, compiling baseline without discarding the newly added canonical-state work.

### Existing partial files to retain and correct

- `src/lib/state/types.ts`
- `src/lib/state/operatingStateRepository.ts`
- `src/lib/state/coachContext.ts`

### 0.1 Record the current failure baseline

- Record current typecheck failures in the implementation ledger.
- Inventory every import of `OperatingState`, `getCurrentOperatingState`, `readiness`, `TodayFocusCard`, and Coach context.
- Do not use the current failing typecheck as a starting “green” baseline.

### 0.2 Verify live schema before defining queries

Add a read-only schema-contract script that checks the actual columns and constraints used by the state loader. At minimum verify:

- `profiles` exam, route, timezone, onboarding, and context-version fields;
- `study_roadmaps`, `roadmap_milestones`, and active uniqueness;
- `planning_cycles`, accepted draft, local dates, anchor day, status, and revision;
- `plan_drafts` purpose, status, revision, failure, context, and accepted cycle;
- `plan_blocks` task type, origin, placement, execution, dates, assessment scope, attempt/evidence/repair links, and revision;
- `calendar_commitments` recurrence fields and protected status;
- `task_events` event vocabulary and actual-duration fields;
- `assessment_attempts`, responses, forms/blueprints, evidence mode, and status;
- `evidence_events` validity, evidence state, confidence, correctness, concept/item/attempt IDs, and created time;
- `repair_threads` and `coach_proposals` real columns/status vocabulary.

Do not query derived fields such as `sample_size` or `confidence_mismatch` from `evidence_events`; derive them with the existing evidence reducer. Do not query `title`/`summary` from `coach_proposals` when the table stores `intent`, `reasoning`, and `proposed_changes`.

### 0.3 Correct canonical unions

Align `types.ts` with the verified schema:

- task types include all live values: study, review, verification, diagnostic, class consolidation, repair, recheck, mock, admin, and other;
- execution includes not started, in progress, partial, completed, skipped, deferred, and cancelled;
- nullable database fields remain nullable in normalized types;
- protected commitments are expanded from their recurrence/time fields using the same Calendar projection logic, not treated as if every row contains a ready-made duration for today;
- paper purpose is diagnostic, revisionary, mixed, or unknown—not inferred from `task_type` alone.

### 0.4 Restore a temporary compiling bridge

Finish the canonical loader and adapters in one coherent slice. Do not change the canonical types while leaving the old loader compiled against them.

**Gate:** typecheck is green before Home UI work begins.

---

## Task 1 — Canonical Operating State contract

**File:** `src/lib/state/types.ts`

The final contract is versioned and distinguishes data availability from measured zero.

```text
OperatingState
  schemaVersion
  generatedAt
  timezone
  dataVersion
  identity
  activation
  roadmap
  cycle
  today
  execution
  papers
  evidence
  preparedness
  repairs
  attention
  nextAction
  capabilities
  integrity
```

### Required semantics

#### Identity

- exam window and exact booked date;
- registered/unregistered state;
- preparation route/class pattern;
- user-facing exam label generated once.

#### Activation

Use these machine states:

- `not_onboarded` — shared app layout redirects to onboarding;
- `preview_required` — setup is valid but no ready/accepted baseline draft exists;
- `acceptance_required` — a valid ready draft exists and needs review/acceptance;
- `activation_failed` — draft generation/acceptance failed and can be retried or reviewed;
- `ready` — active roadmap plus an accepted active cycle exist.

Do not use “zero tasks today” to change activation. A ready cycle may legitimately have no task today.

#### Papers

Each scheduled/available paper carries:

- purpose: diagnostic, revisionary, mixed, or unknown;
- eligible curriculum scope;
- scheduled local date/time;
- attempt/reservation ID when present;
- state: unavailable, checking, upcoming, due, in progress, scored, closure pending, or closed;
- bank sufficiency result with required/available counts and checked-at time;
- revision and permitted commands.

#### Four transparent signals

1. Curriculum position.
2. Demonstrated understanding.
3. Plan execution.
4. Confidence calibration.

Every signal includes sample size, latest valid observation, and unavailable/stale status.

#### Preparedness

For this release:

- below the evidence threshold, `preparedness` is `null`; the UI says “Insufficient evidence” as an explanation, not as a scored band;
- after the threshold, only `building` may be emitted;
- developing/stable/exam-phase-ready remain reserved until outcome calibration is approved;
- every emitted band contains explicit reasons and evidence coverage.

#### Attention

Only actionable decisions. Informational notices belong to their relevant section.

#### Next Action

Every action carries:

- stable code and referenced entity ID;
- title, rationale, scope, timing, and expected duration;
- availability and reason when unavailable;
- destination;
- permitted command identifiers;
- expected entity revision.

---

## Task 2 — Pure derivation and priority rules

**Create:** `src/lib/state/derive.ts` and deterministic tests.

Pure functions perform no database access and generate machine state before user copy.

### 2.1 Activation derivation

Inputs include onboarding status, active roadmap ID/status, ready/accepted draft, active cycle, accepted draft ID, and explicit draft/activation failure.

Tests must prove:

- a draft/superseded roadmap is never active;
- an empty current day does not trigger activation recovery;
- an accepted active cycle remains ready even if its week has deliberately zero tasks;
- an acceptance failure returns `activation_failed` with a recoverable reference;
- a ready draft returns `acceptance_required`, not `ready`.

### 2.2 Next-action priority

1. Recover failed activation.
2. Review/accept a baseline or current-week draft blocking entry.
3. Resolve a blocking conflict/stale proposal.
4. Resume an already in-progress executable task.
5. Complete/mark unknown logs when a scored paper is waiting for closure.
6. Take/resume a due or overdue paper whose form is reservable.
7. Review a scored paper and its consequences.
8. Review a repair/recheck proposal affecting the active week.
9. Start the next timed executable class/study/repair item due now/today.
10. Start the next day-preferred core task.
11. Place an unplaced core task.
12. Complete weekly closure or review the next-week draft.
13. Return an honest empty state.

Protected work/personal commitments are excluded. Completed, skipped, deferred, and cancelled tasks are not startable.

### 2.3 Signals

- Reuse/extend `reduceConceptEvidence` rather than implementing competing evidence logic.
- Exclude voided/disputed evidence and practice-mode attempts from demonstrated understanding.
- Confidence scale is already verified as 1–5: low=1, medium=3, high=5. Confident-and-wrong is ≥4; unsure-and-right is ≤2.
- `unreported` means a past accepted task remains not started and has no execution/log event resolving it. It is not silently counted as missed or completed.
- Execution summaries carry task/scope counts and actual duration separately. Minutes are not understanding.

### 2.4 Pressure

Map roadmap feasibility to low/moderate/high/unknown with assumptions. Strip required-hours prescriptions from the operating state and Home copy.

### 2.5 Tests

Use table-driven fixtures covering priority collisions and null/unknown behavior. Add the suite to `npm run verify` only after it passes independently.

---

## Task 3 — Account-scoped repository and state assembler

### Files

- Correct `src/lib/state/operatingStateRepository.ts`.
- Replace `src/lib/state/operatingState.ts` with the canonical assembler or rename atomically to `getOperatingState.ts` and update all imports in the same task.

### 3.1 Repository rules

- Mark privileged modules server-only.
- Scope every user-owned query by `user_id`.
- Use authenticated RLS reads where practical.
- Select only required columns.
- Start independent queries in parallel.
- Check every Supabase error; partial failures become typed integrity domains rather than fabricated empty arrays.
- Use the existing Calendar recurrence-expansion service for today's commitments.
- Use `getConceptSummaries`/evidence reducers for evidence summaries.
- Use actual Coach proposal fields.
- Use the diagnostic sufficiency service with user exposure, purpose, trust tier, and requested scope—not a global verified-item count.

### 3.2 State assembly

`getOperatingState(userId, now)`:

1. resolves timezone and operational week once;
2. loads identity, active roadmap, drafts/cycle, plan blocks/events, commitments, papers/attempts, evidence, repairs, proposals, activities, and capabilities;
3. normalizes rows;
4. executes pure reducers;
5. checks invariants;
6. returns immutable serializable state.

Use request-level memoization only. Never cache one user's state across users.

### 3.3 Invariants

- At most one active roadmap.
- At most one active cycle.
- Active cycle references an accepted draft where required.
- Home, Calendar, Curriculum, and Tests resolve the same operational week and roadmap.
- Every paper action has valid scope and current sufficiency/reservation state.
- A task linked to a cycle belongs to the same user.

### 3.4 Temporary consumers

Keep `projectCoachContext(state)` as a pure projection. It cannot query and must not expose `userId` to the model unless a tool contract requires an opaque account handle. Remove readiness fields above the approved release level.

**Gate:** canonical state fixtures and live test identity load successfully; no old readiness calculation remains in the loader.

---

## Task 4 — Remove all render-time planning writes

**Modify:** `src/app/app/calendar/page.tsx`

Delete the first-visit `buildWeekPlan`/`commitWeekPlan` mutation from Calendar render. Calendar GET becomes a pure projection.

Home/Calendar may show:

- baseline preview required;
- draft acceptance required;
- activation failed with retry;
- no active week with a build/review action.

The user-triggered command creates or restores a versioned draft. A separate explicit acceptance transaction creates the active cycle/tasks.

Add a render-purity test that snapshots row counts before and after GETs to Home, Calendar, Curriculum, Tests, and Settings.

---

## Task 5 — Recoverable activation workflow

### Endpoint/service

Create an idempotent activation-recovery command, but do not directly commit generated tasks.

Flow:

1. authenticate and verify onboarding complete;
2. inspect existing ready/failed/accepted onboarding draft by context version/fingerprint;
3. if already accepted with an active cycle, return ready without writing;
4. if a valid ready draft exists, return it for review;
5. if failed/stale/missing, regenerate a versioned preview using the canonical roadmap/week composer;
6. return `acceptance_required` and the draft revision;
7. use the atomic acceptance RPC after explicit confirmation;
8. on failure, persist/return a recoverable error without marking onboarding/activation ready.

The response includes a server-generated opaque request ID for support. Do not expose a user-ID prefix.

### Gate

Retrying the command cannot duplicate roadmap drafts, cycles, tasks, or repairs.

---

## Task 6 — Paper classification and sufficiency

The existing generator always appends a generic weekly diagnostic. Replace that assumption with a paper-planning contract.

### Paper classification

- new eligible scope only → diagnostic;
- revisited eligible scope only → revisionary;
- both → mixed with separately identified sections;
- no eligible scope → no paper, with an honest checkpoint state.

Store paper purpose and curriculum scope in the scheduled block/form blueprint. Do not reconstruct purpose from the title.

### Sufficiency

- check at proposal/scheduling time;
- check again during attempt reservation;
- calculate unseen eligible items for the requested scope and required trust tier;
- do not use `Math.min(5, desiredLength)` as an undocumented universal policy; define minimum/target lengths per paper purpose and module size;
- show available/required counts only where useful, without exposing internal reviewer tooling.

If sufficiency is unknown or false, the paper cannot be the primary Start action.

---

## Task 7 — Migrate consumers without creating a second truth

Update in one controlled sequence:

1. Home.
2. Calendar header/week identity.
3. Tests paper/evidence header.
4. Curriculum active roadmap/pressure header.
5. Settings exam/route/week identity.
6. Coach page and API through `CoachContext`.

Remove the old loader only after all imports move. Delete `readiness.ts`, its test, and ring UI after repository-wide search proves no runtime consumer remains.

### Coach correction

`/api/coach` accepts only message, structured intent, and referenced entity IDs. It always rebuilds `CoachContext` on the server. Remove the current optional client `context` override.

---

## Task 8 — Home action-first shell

### Server page

`src/app/app/page.tsx` remains a Server Component and calls `getOperatingState` once. Add route loading and error surfaces. Pass minimal slices to Client Components.

### Components

- `HomeContextBar`
- `ActivationRecovery`
- `NextActionCard`
- `TodaySequence`
- `AttentionQueue`
- `WeekPulse`
- `EvidencePulse` / four signal cards
- `RoadmapTrajectory`
- `WeeklyClosureCard`
- `LearningCaptureTrigger`
- `CoachEntry`

Do not keep `TodayFocusCard` as the architectural centre merely to reuse buttons. Extract its working task-mutation controls into a smaller reusable client action component and delete the readiness-ring assumptions.

### Layout order

1. Context.
2. Next Action.
3. Actionable attention.
4. Today.
5. Paper/closure.
6. Week execution.
7. Four signals.
8. Roadmap trajectory/pressure.
9. Coach and quick learning/class capture.

No generic shortcut pills that duplicate the sidebar.

### Responsive behavior

- mobile: single-column operating sequence and day-view Calendar destination;
- tablet: compact layout and three-day Calendar destination;
- desktop: Next Action and Today form the first two-column region;
- no horizontal overflow at 375, 768, 1024, or 1440px;
- 44px targets, visible focus, semantic status, no color-only meaning, reduced-motion support.

---

## Task 9 — Shared learning/class capture

Build one capture drawer shared by Home, Calendar, and Curriculum.

Capture activity type, curriculum mapping, mapping certainty, actual date/duration, class attendance/coverage, and optional confidence. Store activity/exposure only. Never write supported concept evidence.

Outstanding logs required by closure can be completed or explicitly marked unknown.

---

## Task 10 — Paper result and contextual weekly closure

There is no permanent Weekly Review tab. Use a deep-linkable contextual route/panel surfaced from Home.

State machine:

```text
waiting_for_paper
→ paper_in_progress
→ paper_scored_logs_missing
→ ready_to_close
→ generating_next_week
→ draft_ready
→ accepted
→ failed_recoverable
```

Closure shows paper findings, missing/unknown logs, planned versus actual execution, deviations, repairs/rechecks, carried/dropped scope, plan pressure, and the next-week draft. Generation and acceptance remain separate commands.

---

## Task 11 — Verification and release gates

### Unit and contract tests

- activation and next-action collision matrix;
- signal/evidence reduction and confidence thresholds;
- diagnostic/revisionary/mixed classification;
- null versus measured zero;
- schema-contract script;
- pressure copy contains no required-hours prescription.

### Database/integration

- RLS and cross-account isolation;
- active roadmap/cycle uniqueness;
- atomic/idempotent draft acceptance;
- stale revision and two-device conflict behavior;
- paper sufficiency and reservation races;
- no duplicate tasks/repairs/drafts on retry.

### Browser E2E

Use the dedicated test identity after fixing the reset fixture. Cover:

- verified login → onboarding → baseline preview → acceptance → Home;
- failed activation → retry → review → acceptance;
- empty today without false activation failure;
- task start/partial/complete/defer reflected identically in Calendar;
- paper due, insufficient-bank, in-progress, scored, and closure states;
- missing logs → unknown/completed → next-week draft;
- Home/Calendar/Settings/Curriculum/Tests identity coherence;
- no readiness ring by accessible name/component assertion—not by banning every `%` character;
- two consecutive class-led weeks and two consecutive self-study weeks;
- desktop, tablet, mobile, keyboard, reduced motion, slow network, stale state, and partial service failure.

### Final quality gate

- `npm run verify`, all relevant E2E suites, browser suite, and production build pass.
- No accepted known failures remain silently “out of scope.” Any quarantine requires an issue, owner, reason, and expiry and cannot cover a release-critical flow.
- GET/render purity passes for all primary pages.

## 3. Required file strategy

### Keep and correct

- `src/lib/state/types.ts`
- `src/lib/state/operatingStateRepository.ts`
- `src/lib/state/coachContext.ts`

### Replace/migrate atomically

- `src/lib/state/operatingState.ts`
- Home page/components
- Coach API/client context
- page headers that independently calculate identity/week/roadmap

### Add

- pure derivation module/tests;
- schema-contract test;
- render-purity test;
- activation-recovery service/route;
- paper classifier/sufficiency contract;
- Home components and loading/error states;
- shared learning capture;
- contextual closure route/panel;
- operating-state and two-week browser E2E.

### Remove after migration

- blended readiness calculation/test/ring;
- old operating-state shape and imports;
- Calendar render-time generation;
- client-provided Coach context;
- duplicate Home quick links;
- obsolete source/material references on Home;
- student-facing internal diagnostic operations links.

## 4. Definition of done

This implementation is complete only when:

1. One canonical state drives the shared truth used by every primary page.
2. The repository compiles and no partial old/new contract remains.
3. Home always provides one executable next action or one honest recovery state.
4. Empty today is not confused with failed activation.
5. Every visible action has a real revision-safe backend command.
6. Diagnostic, revisionary, and mixed papers are correctly classified and bank-gated.
7. Paper result plus completed/unknown logs produces a reviewable next-week draft.
8. Accepting the draft changes Home and Calendar atomically without duplication.
9. Activity, confidence, curriculum position, and demonstrated understanding remain distinct.
10. Coach uses server-generated context and cannot silently mutate Calendar.
11. Home and all primary page GETs are write-free.
12. Two consecutive class-led and self-study weekly loops pass browser E2E.
