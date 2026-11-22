# Roadmap Home V2 — final implementation plan

**Status:** superseded on 19 September 2026 by `OPERATING-STATE-V2-AND-HOME-FINAL-IMPLEMENTATION-PLAN.md` after the partial implementation and live schema were re-audited  
**Page:** `/app`  
**Product role:** action-first operating console for the candidate's current study cycle  
**Source specifications:** `FOUNDER-PRODUCT-DECISIONS.md`, `HOME-PAGE-END-TO-END-BUILD-SPEC.md`, and the 18 September product audit

## 1. Goal

Home must answer, in order:

1. What should I do next?
2. Why is that the correct action now?
3. What does today contain?
4. Is a decision, paper, repair, or missing log blocking the next week?
5. What did execution and demonstrated understanding change?
6. Is the broader roadmap holding, under pressure, ahead, or still unknown?

Home is not a second Calendar, a generic analytics dashboard, or a collection of navigation cards. It is a read-only projection of one server-owned operating state plus small client-side action surfaces that call shared commands.

## 2. Required corrections to the proposed plan

### 2.1 Do not maintain two operating-state aggregators

Introducing `getCurrentOperatingStateV2()` beside the old aggregator and letting both query the database would preserve the exact cross-page drift this rebuild is meant to remove.

Use one canonical `OperatingState` contract and one canonical loader. During migration:

- replace `src/lib/state/types.ts` with the new versioned shape;
- rebuild `getCurrentOperatingState()` to return the new shape;
- add a temporary pure `toLegacyCoachContext(state)` adapter only if Coach cannot be migrated in the same change;
- do not let the adapter query the database;
- remove the adapter as soon as Coach consumes its dedicated safe context.

The long-term Coach input is not the entire Home state. It is a narrower, server-created `CoachContext` containing only evidence and actions the Coach is allowed to use.

### 2.2 Home cannot precede onboarding/plan truth repairs

The current app cannot reliably activate the first week. Home must not be rebuilt on top of that state. Gate H−1 below is mandatory.

### 2.3 Protected commitments are not “next actions”

Work, travel, exercise, and other protected commitments appear in Today but are not selected as Roadmap actions. A class may expose `Open class details` or `Log class` when relevant, but Roadmap does not tell the student to “start” their job or commute.

### 2.4 Paper type and weekly closure are core Home requirements

The initial proposal mentions diagnostics but omits the confirmed distinction:

- new material → diagnostic paper;
- revision → revisionary paper;
- mixed scope → labelled mixed paper with separate sections.

It also omits the post-paper logging gate and next-week acceptance journey. These are not optional H3 polish; they are central Home states.

### 2.5 Every visual action needs a shared command contract

Rendering buttons is not completion. Start, resume, partial, complete, move, shorten, defer, review, accept, log, and retry must each identify:

- command owner;
- authentication/authorization;
- validation schema;
- expected revision or idempotency key;
- conflict/stale response;
- resulting route or refreshed state;
- audit event and undo behaviour where applicable.

## 3. Non-negotiable product rules

- No opaque readiness percentage in the Home hero.
- No pass probability.
- No fabricated zero when data is unavailable.
- No page-render mutation.
- No silent Calendar change.
- No activity log treated as demonstrated understanding.
- No paper offered unless a valid eligible form can be reserved.
- No new week generated until the closing paper is scored and outstanding logs are completed or explicitly marked unknown.
- Class-going candidates use their class cycle; self-study candidates use Monday–Saturday with the closing paper on Sunday.
- Calm plan-pressure language and reviewable choices replace “you need X more hours.”
- Sources/materials do not appear anywhere on Home.

---

## Gate H−1 — Restore trustworthy entry state

**User experience achieved:** Every completed onboarding produces one valid active roadmap and one reviewable/accepted baseline week, or an honest recoverable activation error.

### Required work

1. Replace the incompatible onboarding state shapes with one typed read contract. Remove the `as any` boundary between the onboarding page and shell.
2. Make checkpoint completion persistent so `/onboarding/plan` becomes reachable.
3. Align `plan_blocks.origin` and all other enum/check vocabularies across code, migrations, and the live database.
4. Make first-week acceptance atomic and idempotent.
5. Make every onboarding database write throw/report errors.
6. Fix the E2E fixture reset so profile, exposure, availability, drafts, roadmaps, cycles, tasks, and evidence are isolated.
7. Add the recoverable `activation_failed` state; onboarding must not be marked complete when the roadmap/week transaction fails.

### Gate

- A browser user can verify email, finish all onboarding paths, preview the baseline week, accept it, and land on Home.
- Home, Calendar, Curriculum, and Settings show the same exam target, roadmap, cycle, and week boundary.
- Failed activation preserves the draft and presents Retry/Review inputs; it never renders a fake 0% dashboard.

---

## Phase H0 — Canonical truth layer

**User experience achieved:** All primary pages can agree on the same student state before new Home UI is introduced.

### H0.1 Canonical types

#### [MODIFY] `src/lib/state/types.ts`

Define the canonical versioned contract:

```text
OperatingState
  schemaVersion, generatedAt, timezone, dataVersion
  identity
  roadmap
  cycle
  today
  execution
  papers
  evidence
  repairs
  attention
  nextAction
  capabilities
  integrity
```

Important semantics:

- `null` means unknown/unavailable; `0` is a measured zero.
- Every actionable entity includes its ID, current revision, availability, destination, and permitted commands.
- State carries stable machine codes separately from user-facing text.
- Paper state distinguishes `diagnostic`, `revisionary`, and `mixed`.
- Integrity identifies stale data, activation failure, insufficient paper bank, cross-page invariant failure, and partial service failure.

#### [NEW] `src/lib/state/coachContext.ts`

Create a pure server-side projection from `OperatingState` to a restricted `CoachContext`. Client requests may send an intent/message, never an authoritative context object. This closes the current `/api/coach` weakness where arbitrary client context can replace server truth.

### H0.2 Repository/query layer

#### [NEW] `src/lib/state/operatingStateRepository.ts`

Own all account-scoped reads required for Home. Load independent groups in parallel and keep selected columns narrow.

Required inputs include:

- profile and exam window;
- active roadmap, phases, current/next milestone, and projection;
- active cycle and pending/failed/ready drafts;
- today's `plan_blocks` and protected `calendar_commitments`;
- task events for cycle execution summaries;
- assessment attempts/forms, paper purpose, reservations, and bank sufficiency;
- concept summaries/evidence recency;
- open repair/recheck threads;
- Coach/calendar proposals;
- learning/class activities and missing-log detection;
- curriculum/test capability coverage.

Prefer authenticated user-scoped access with RLS. If a server-only privileged client remains necessary, keep it inside a `server-only` repository, scope every query by `user_id`, and test against cross-account leakage.

Add or verify indexes for the real access patterns, including user/status/date and user/cycle/execution lookups. Use query-plan evidence before adding speculative indexes.

### H0.3 Pure reducers

#### [NEW] `src/lib/state/nextActionSelector.ts`

Implement a pure, deterministic selector. It receives an already-normalized candidate list and does no database access.

Priority:

1. Recover failed baseline/current-week activation.
2. Resolve a blocking stale/conflict state.
3. Resume an in-progress executable task.
4. Complete missing logs required to unlock weekly closure.
5. Take/resume a due and reservable diagnostic, revisionary, or mixed paper.
6. Review a scored paper and its plan consequences.
7. Review a repair/recheck proposal that affects the active week.
8. Start the next timed executable class/study/repair action due now or today.
9. Start the next accepted day-preferred core task.
10. Review/accept a pending weekly draft.
11. Place an unplaced core task.
12. Complete weekly closure and generate/review the next week.
13. If none applies, return a typed honest empty state with the exact recovery/destination.

Selection must exclude protected commitments and any paper whose form cannot be reserved.

#### [NEW] `src/lib/state/attentionReducer.ts`

Return at most three user-actionable items ordered by consequence. Do not fill the queue with information-only notices.

#### [NEW] `src/lib/state/weekExecutionReducer.ts`

Compute completed, partial, deferred, skipped, and unreported scope from task events and current tasks. Preserve both scope and actual duration without equating minutes to understanding.

#### [NEW] `src/lib/state/evidencePulseReducer.ts`

Summarize supported, unstable, needs-repair, stale, and confidence-mismatch changes with sample size and recency.

### H0.4 Canonical loader

#### [MODIFY] `src/lib/state/operatingState.ts`

Implement `getCurrentOperatingState(userId, now)` by:

1. resolving the student's timezone and operational study cycle once;
2. fetching independent state groups in parallel;
3. normalizing database rows;
4. running pure reducers;
5. checking cross-page invariants;
6. returning one immutable serialized state.

Use request-level memoization so Home components and other server consumers do not repeat the same load. Do not introduce cross-user caching.

### H0.5 Temporary migration adapter

#### [NEW] `src/lib/state/legacyCoachAdapter.ts`

If needed, create a pure temporary adapter for the current Coach component. Mark it deprecated and add a removal test/task. It must not create a second query path.

### H0 verification

- Contract fixtures for new account, failed activation, baseline week, active normal week, paper due, post-paper missing logs, closure ready, repair pending, compressed roadmap, final phase, and service failure.
- Unit tests for every next-action priority collision, not just one happy path.
- Database integration tests for account isolation, `null` versus zero, timezone boundaries, active-cycle uniqueness, and draft revision handling.
- Query-count/performance budget for Home state assembly.
- Invariant test proving Home, Calendar, Tests, and Curriculum resolve the same active cycle and roadmap.

---

## Phase H1 — Action-first Home shell

**User experience achieved:** The first viewport gives the student one justified action, today's real sequence, and only decisions that require attention.

### Page architecture

#### [MODIFY] `src/app/app/page.tsx`

- Keep the page as a Server Component.
- Authenticate in the shared app layout and load the canonical state once.
- Render server components by default; introduce client components only around interactive mutations/drawers.
- Remove `TodayFocusCard`, readiness rings, generic workspace pills, and duplicated page-level calculations.
- Add a route-level loading state and error boundary that preserve known context and never fabricate zeros.

#### [NEW] `src/app/app/loading.tsx`

Render a stable skeleton matching the final layout to prevent layout shift.

#### [NEW] `src/app/app/error.tsx`

Provide Retry and unaffected destinations. Show last coherent snapshot age if the architecture supports it.

### Components

#### [NEW] `src/components/home/HomeContextBar.tsx`

Show exam window/date, phase, operational week, and data freshness. Missing context links to the Settings-owned editor—not first-time onboarding.

#### [NEW] `src/components/home/NextActionCard.tsx`

Show one action with scope, timing, expected sitting length, rationale, and one primary command. Secondary actions are limited to valid options such as Move, Make shorter, or Not today.

Use a small client action island for mutations. On 409 revision/conflict responses, refresh the affected state and show alternatives rather than overwriting.

#### [NEW] `src/components/home/TodaySequence.tsx`

Interleave commitments, classes, study, paper, repair, and recheck entries. Protected commitments are context only. Link to `/app/calendar?date=YYYY-MM-DD` for full control.

#### [NEW] `src/components/home/AttentionQueue.tsx`

Render no more than three actionable decisions with exact resolution destinations. Suppress empty decorative cards.

### H1 action connections

Reuse shared commands:

- task execution/move/split/defer → `/api/tasks/[id]` with expected revision;
- Calendar conflict alternatives → the existing task/calendar mutation service;
- paper reservation/start → diagnostic attempt service before navigation;
- proposal review/acceptance → transactional proposal command;
- failed activation retry → idempotent activation command;
- Settings repair → Settings-owned routes.

Where the required command does not exist, build it before rendering its button.

### H1 responsive behaviour

- Mobile: Next Action → Attention → Today. Calendar opens in day view.
- Tablet: compact one-column Home and three-day Calendar destination.
- Desktop: Next Action and Today form the first two-column region.
- 44px minimum targets, visible focus, semantic headings, screen-reader status, no color-only meaning, and reduced-motion support.

### H1 gate

- The first meaningful action is reachable in one click.
- Every visible button completes a real command or is truthfully unavailable with a reason.
- Home and Calendar update the same task and revision.
- Empty and failed states are useful and do not show 0% placeholders.

---

## Phase H2 — Week, evidence, and roadmap signals

**User experience achieved:** Below the first action, the candidate can understand the week, demonstrated evidence, and long-term pressure without interpreting vanity metrics.

#### [NEW] `src/components/home/WeekPulse.tsx`

Show accepted core scope plus completed, partial, deferred, skipped, and unreported work. Show material deviations and the current paper/closure state. Do not reduce all work to one completion ring.

#### [NEW] `src/components/home/EvidencePulse.tsx`

Show recent concept changes, sample size, recency, paper type, and confidence mismatch. Link to the originating result or filtered Tests view. Activity logs never move this component.

#### [NEW] `src/components/home/RoadmapTrajectory.tsx`

Show current milestone, next milestone, projected range, protected final-preparation boundary, and a calm state: `holding`, `ahead`, `pressure`, or `unknown`. Avoid a definitive “behind” label without explanation.

#### [NEW] `src/components/home/PreparednessBand.tsx` (gated)

Render only after the approved evidence threshold. Use `Insufficient evidence`, `Building`, `Developing`, `Stable`, or `Exam-phase ready`, with the contributing signals visible. Do not build or market a pass probability.

### H2 gate

- Coverage, activity, confidence, and demonstrated understanding remain separate in types, reducers, copy, and tests.
- Every evidence claim links to its supporting attempts/events.
- Service unavailability labels the affected section stale without erasing unaffected state.

---

## Phase H3 — Learning/class capture

**User experience achieved:** A student can quickly record what happened without leaving the operating flow or accidentally creating mastery evidence.

#### [NEW] `src/components/home/LearningCaptureTrigger.tsx`

Open the shared capture drawer from Home.

#### [NEW] `src/components/learning/LearningCaptureDrawer.tsx`

Shared by Home, Calendar, and Curriculum. Capture:

- class, self-study, review, or external practice;
- actual curriculum topic/module/LOS where known;
- mapping confidence (`confirmed` or `unconfirmed`);
- actual date and optional duration;
- class attendance and what was covered;
- optional self-rated confidence, stored separately.

The backend writes activity/exposure only. It never creates supported concept evidence.

#### [MODIFY] Calendar and Curriculum entry points

- Calendar manages variable, moved, cancelled, and one-off classes.
- Curriculum supports logging against the exact curriculum location.
- Remove the Log Learning page from primary navigation; retain a detailed route only if needed for history/deep linking.

### H3 gate

- A log appears consistently in Home closure, Calendar, and Curriculum.
- Unconfirmed mappings remain visibly unconfirmed.
- No logging action changes diagnostic evidence or preparedness.

---

## Phase H4 — Paper result, logging gate, and weekly closure

**User experience achieved:** Finishing the week's paper creates an understandable analysis and a reviewable next week, not an invisible automatic rewrite.

#### [NEW] `src/components/home/WeeklyClosureCard.tsx`

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

#### [NEW] `src/app/app/closure/page.tsx` or contextual intercepted panel

Use a deep-linkable route even if it opens as a Home panel. It must support refresh, mobile navigation, and recovery.

Closure shows:

1. diagnostic/revisionary/mixed paper outcome;
2. demonstrated strengths, instability, weak points, confidence mismatches, and untested scope;
3. missing logs, each completable or markable as unknown;
4. planned versus actual execution and deviations;
5. proposed repairs, rechecks, carried/dropped scope, and roadmap-pressure effect;
6. a versioned next-week draft;
7. explicit acceptance before Calendar activation.

Generation and acceptance are separate commands. Acceptance is atomic, idempotent, revision-checked, and auditable.

### H4 gate

- New-learning, revision-only, and mixed weeks produce the correct paper/analysis semantics.
- A closing-day paper places resulting repair into the next operational week.
- Missing logs block final generation only until completed or marked unknown.
- Repeated submission/retry cannot duplicate drafts, cycles, repairs, or tasks.
- Two consecutive weeks pass browser E2E.

---

## Phase H5 — Contextual Coach entry

**User experience achieved:** Coach explains state and proposes safe planning actions without becoming a curriculum tutor.

#### [NEW] `src/components/home/CoachEntry.tsx`

Show state-derived prompts such as:

- Why is this my next action?
- What changed after my paper?
- Which broad area needs attention and where should I revisit it?
- My class moved—propose a repair to this week.
- I missed today—show the least disruptive recovery.

#### [MODIFY] `/api/coach`

- Accept only a message/structured intent and optional referenced entity IDs.
- Build `CoachContext` on the server; never trust client-provided evidence/context.
- Enforce non-teaching boundaries and tool permissions.
- Return structured response sections: observation, evidence basis, recommendation, verification, and optional proposal ID.
- Calendar actions create previewable `coach_proposals`; they never directly mutate accepted tasks.
- Persist concise conversation history, proposals, outcomes, and deletion controls.

Coach prompt engineering, examples, evaluations, adversarial tests, and action-tool testing are a dedicated workstream. Home only exposes Coach capabilities that have passed that gate.

---

## Phase H6 — Observability, qualification, and rollout

### Product instrumentation

Track:

- coherent Home load versus integrity failure;
- next action opened/completed/partial/deferred;
- time from Home load to meaningful action;
- attention item resolved;
- paper due but unavailable;
- missing-log resolution;
- closure generated, failed, retried, accepted, or rejected;
- cross-page state disagreement;
- stale revision/conflict frequency;
- Coach proposal previewed, accepted, rejected, executed, or undone.

Do not optimize for raw time in app, streak length, clicks, or scheduled hours.

### Automated verification

1. Reducer unit tests and priority collision tables.
2. Database/RPC integration tests for atomicity, RLS, idempotency, revisions, and account isolation.
3. Contract tests against the live migration schema.
4. Browser E2E for every required Home state.
5. Cross-page coherence tests: Home ↔ Calendar ↔ Tests ↔ Curriculum.
6. Accessibility checks: keyboard, focus, landmarks, names, contrast, reduced motion, and screen-reader status.
7. Responsive visual checks at 375, 768, 1024, and 1440px.
8. Slow network, partial failure, stale data, multi-device revision, and retry tests.
9. Render-purity test proving a Home GET creates no tasks, attempts, repairs, proposals, drafts, or activity rows.

### Rollout

- Develop behind an internal feature flag only if the flag does not create separate state logic.
- Run legacy and canonical UI comparison against the same canonical state, not two loaders.
- Make Home canonical after state-matrix E2E passes.
- Migrate Coach to `CoachContext` and delete the legacy adapter/types/readiness ring.
- Remove prototype banners and dead Home components only after their real replacements pass browser QA.

## 4. Final file-level change summary

### New

- `src/lib/state/operatingStateRepository.ts`
- `src/lib/state/nextActionSelector.ts`
- `src/lib/state/attentionReducer.ts`
- `src/lib/state/weekExecutionReducer.ts`
- `src/lib/state/evidencePulseReducer.ts`
- `src/lib/state/coachContext.ts`
- temporary `src/lib/state/legacyCoachAdapter.ts`
- Home components: Context, Next Action, Today, Attention, Week, Evidence, Roadmap, Preparedness, Closure, Coach entry
- shared learning/class capture drawer
- Home loading/error surfaces
- closure route/panel
- fixtures, integration tests, and browser state-matrix tests

### Modify

- `src/lib/state/types.ts`
- `src/lib/state/operatingState.ts`
- `src/app/app/page.tsx`
- `/api/coach`
- task/paper/proposal commands where contracts are missing
- Calendar and Curriculum capture entry points
- navigation and Settings destinations

### Remove after migration

- old readiness ring and `computeReadiness` usage on Home
- `TodayFocusCard`
- generic Home workspace pills
- student-facing diagnostic operations links
- sources/materials UI references
- legacy Coach state adapter once Coach migration passes

## 5. Definition of done

Home V2 is complete only when:

1. One canonical state drives Home, Calendar, Tests, Curriculum, and Coach context.
2. The first viewport always produces one executable next action or one honest recovery state.
3. Every Home control is connected to a real revision-safe command.
4. Protected commitments, learning activity, confidence, curriculum position, and demonstrated evidence remain distinct.
5. A valid paper result plus completed/unknown logs produces a reviewable next-week draft.
6. Accepting that draft updates Home and Calendar atomically without duplication.
7. The complete loop works for two consecutive class-led and self-study weeks.
8. Desktop, tablet, mobile, keyboard, reduced-motion, stale-data, and partial-failure states pass Browser QA.
