# Pulse — Canonical Adaptive Calendar and Coach System

**Product:** Roadmap Learning Control System  
**Audience:** CFA Level I candidates preparing for 2027 onward  
**Status:** Audited and enhanced product/implementation specification  
**Date:** 18 September 2026  
**Scope:** Calendar planning, weekly adaptation, deviations, classes, diagnostics, mocks, Coach actions and cross-product linkage

---

## 1. Executive verdict on the proposed design

The proposed Pulse design correctly identifies several current failures:

- study work is not reliably generated from the UI;
- current capacity logic ignores real window duration;
- actual study duration is accepted by the backend but not captured by the interface;
- the old composer is not phase-aware;
- class consolidation is declared but disconnected;
- the Calendar, Tests and Coach do not yet form one operating loop.

However, the proposal should **not** be implemented unchanged. Its central rule—persist only today and recompute the rest of the week every time it is viewed—would make the product adaptive but psychologically unreliable. A CFA candidate needs to know what the week means, make plans around it and trust that tomorrow will not change simply because they opened the page again.

The corrected architecture is:

```text
Stable accepted week
        +
Live progress and forecast
        +
Explicit change proposals
        =
Adaptive planning without calendar anxiety
```

The accepted week is a visible promise. Actual events update progress immediately. Forecasts may change freely. Accepted tasks change only through transparent, reversible proposals.

---

## 2. Decisions from the audit

### Keep

- The name **Pulse** for the adaptive planning engine.
- Phase-aware task composition.
- Exact availability-window capacity.
- Optional actual-duration capture.
- Repair, unstable-concept and class-consolidation priorities.
- A closed Coach action surface instead of unconstrained tool calling.
- Explicit escalation when a disruption cannot be absorbed safely.
- Mocks as protected high-duration events when the roadmap reaches the correct phase.

### Change

- Keep a user-confirmed weekly boundary rather than deriving it from the earliest class.
- Persist the entire accepted week, not only today.
- Show future projections beyond the accepted week without persisting them.
- Calculate weekly demand from remaining effort divided by remaining usable weeks, not remaining effort multiplied by a pacing factor.
- Keep repair inside the safe weekly capacity by displacing lower-priority work; do not add it above capacity.
- Learn pacing from a rolling evidence window rather than one prior week.
- Separate weekly review from diagnostic eligibility.
- Use completed class logs, not scheduled commitments, to trigger consolidation.
- Make Coach create auditable proposals; it must not rewrite evidence or reopen completed tasks.

### Reject

- Deleting `plan_drafts`, planning-cycle acceptance and proposal infrastructure.
- Automatically moving accepted tasks without a visible policy and audit trail.
- Restoring a function that always creates a weekly diagnostic.
- Keeping reminder-time and failure-mode questions while deleting the weekly-boundary question.
- Marking a concept `needs_repair` merely because the student says they are struggling.
- Clearing a completed task back to incomplete.
- Hard-coding “weekends first” or a universal mock cadence without respecting the candidate's windows, phase and exam configuration.
- Claiming that no new persistence is required.

---

## 3. Product promise: a non-panic CFA planner

Pulse should make a candidate feel:

- **oriented:** I know the next useful action;
- **protected:** the plan respects classes, work and life;
- **in control:** changes are explained before they are applied;
- **honest:** confidence is separated from demonstrated understanding;
- **recoverable:** one bad day does not turn the whole calendar red;
- **progressive:** tests and repair work improve the next plan;
- **exam-aware:** the long-term syllabus path and final practice period remain visible.

Pulse must never use shame as a scheduling mechanism. Avoid:

- overdue counters that accumulate indefinitely;
- red failure streaks;
- “you are behind” without an actionable recovery choice;
- silently increasing next week's load after strong completion;
- filling every visible gap merely because it exists;
- presenting estimated time as a moral commitment.

---

## 4. Core system model

Pulse operates through five layers.

### Layer 1 — Fixed truth

Inputs that planning cannot overwrite:

- exam window and booked exam date;
- protected work/life commitments;
- upcoming classes;
- user-confirmed availability windows;
- maximum focused-session length;
- accepted mock appointments;
- timezone.

### Layer 2 — Learning truth

Inputs describing what work is relevant:

- active roadmap phase and milestone;
- curriculum prerequisites;
- completed learning activities;
- completed class coverage;
- diagnostic evidence;
- open repair threads;
- evidence recency and stability;
- self-reported concern, stored separately from demonstrated evidence.

### Layer 3 — Accepted week

A versioned set of persisted `plan_blocks` inside one active `planning_cycle`:

- visible for the full week;
- accepted by the candidate;
- stable unless the candidate edits it or accepts a proposal;
- auditable against what actually happened.

### Layer 4 — Live forecast

A non-binding calculation showing:

- expected completion by week-end;
- likely rollover;
- space created by early completion;
- conflicts introduced by new classes or commitments;
- roadmap effect if current behaviour continues.

Forecast changes do not mutate accepted tasks.

### Layer 5 — Change proposal

A versioned diff explaining proposed changes:

- what moves, splits, becomes floating or defers;
- what remains unchanged;
- why the change is proposed;
- effect on study minutes, milestone and diagnostic timing;
- Accept, Adjust or Keep current week actions.

---

## 5. Weekly boundary and Pulse review

### 5.1 Keep the onboarding question

The study-week closing day remains user-confirmed during onboarding and editable in Settings. Roadmap may recommend a day based on classes and availability, but it does not derive the boundary from the earliest recurring class.

Reasons:

- variable class schedules should not move the week boundary;
- a class added on Tuesday should not redefine historical weekly analytics;
- self-study users may prefer Friday, Saturday or Sunday reviews;
- repair placement and trend comparisons require stable periods;
- a user understands and remembers a chosen boundary.

### 5.2 Separate three concepts

- **Week closing day:** reporting and planning-cycle boundary.
- **Weekly review:** short reflection and next-week draft preparation.
- **Diagnostic:** evidence-generating assessment scheduled only when eligible.

The closing day does not guarantee a diagnostic. If a diagnostic is eligible, it may be placed near the boundary where capacity permits. If not, the review explains why.

### 5.3 Terminology

- **Pulse review:** the weekly operational review.
- **Pulse proposal:** a proposed change to an accepted week.
- **Pulse score:** do not introduce a new opaque composite score. Use transparent measures such as completion, demonstrated coverage, repair backlog and roadmap pace.

---

## 6. Planning horizons

Pulse uses three horizons with different stability.

### Today

- Concrete accepted actions.
- Exact or day-preferred placement.
- Start, complete, partial, defer, move or split controls.
- The highest-confidence operational detail.

### Accepted week

- All seven days persisted and visible.
- Stable baseline for accountability.
- Can include timed, day-preferred and floating work.
- Changed only by user edit or accepted proposal.

### Beyond the week

- Roadmap milestones and forecast only.
- No false daily precision months ahead.
- Curriculum shows date ranges and phase windows.
- Calendar may preview the next week, clearly labelled Draft/Forecast.

---

## 7. Inputs to the weekly planner

The planner receives one normalized `WeeklyPlanningInput`.

```ts
type WeeklyPlanningInput = {
  userId: string
  contextVersion: number
  cycle: { startDate: string; endDate: string; timezone: string }
  exam: { targetDate: string; sitting: string; registered: boolean }
  roadmap: { id: string; revision: number; phase: string; milestoneIds: string[] }
  availabilityWindows: ExactWindow[]
  protectedOccurrences: CommitmentOccurrence[]
  maxSessionMinutes: number
  completedCoverage: CoverageSignal[]
  evidence: ConceptEvidenceSummary[]
  repairs: RepairThreadSummary[]
  learnerSignals: LearnerSignal[]
  priorCycles: CycleOutcome[]
  diagnosticSupply: DiagnosticEligibility[]
  policyVersion: string
}
```

Every generated task records the relevant input/policy version so later analysis can distinguish poor planning from unexpected life events.

---

## 8. Capacity and workload model

### 8.1 Physical capacity

For each day:

1. expand exact availability windows;
2. subtract protected commitments and class occurrences;
3. remove fragments below the minimum supported task duration;
4. split remaining space by maximum session length;
5. preserve breaks between long sessions;
6. convert local time safely through the user's timezone.

Weekly physical capacity is the sum of the remaining exact minutes. It is a ceiling, not a goal.

### 8.2 Planned capacity

Pulse does not fill 100% of physical capacity. It uses a learned `draft_fill_ratio`:

- seeded conservatively for the first week;
- explicitly changed by Make it lighter/Use more space;
- adjusted slowly from several weeks of completion and actual-duration evidence;
- bounded by policy so one unusual week cannot produce a large jump;
- stored with the draft for transparency.

Planned capacity:

```text
plannedCapacity = physicalCapacity × draftFillRatio
```

### 8.3 Roadmap demand

The proposed formula `remaining effort × pacing factor` is dimensionally wrong because it tries to place the entire remaining syllabus into one week.

Use:

```text
baseWeeklyDemand =
  phaseRelevantRemainingEffort
  ÷ max(1, usableWeeksRemainingInPhase)
```

Then apply bounded adjustments for:

- prerequisite order;
- class-led coverage;
- diagnostic repair urgency;
- exam proximity;
- observed throughput;
- incomplete prior work;
- final-period reservation.

The generated week is constrained by planned capacity. Unscheduled demand remains in the roadmap; it is not hidden.

### 8.4 Pacing adaptation

Do not infer capacity from one week's completion percentage alone. Use a rolling window, ordinarily three completed cycles, and distinguish:

- completion ratio by planned minutes/effort;
- actual versus estimated duration;
- diagnostic quality after the work;
- moved/deferred work;
- protected-time changes;
- candidate-requested lighter/heavier drafts.

Example policy:

- insufficient history: keep conservative seed;
- consistent completion with reasonable actual duration and stable evidence: increase fill gradually;
- low completion caused by lost availability: reduce placement, not curriculum priority;
- low completion with tasks completed much slower than estimated: revise duration model;
- high completion but weak diagnostics: change method/mix, not simply add more work;
- high completion and strong evidence: modestly advance roadmap scope.

### 8.5 Repairs compete within capacity

Repairs are high priority but are not added above the safe envelope. They displace lower-priority new/review work. If repair demand itself exceeds available capacity, Pulse opens a recovery proposal and shows the consequence for the roadmap.

---

## 9. Task selection and priority policy

Priority is evaluated in this order, subject to dependencies and capacity:

1. Accepted mock or diagnostic appointments.
2. Due rechecks attached to open repair threads.
3. High-severity or repeatedly missed repair work.
4. Unstable demonstrated concepts due for retrieval.
5. Consolidation after a completed class.
6. In-progress module continuation.
7. Phase-appropriate milestone work.
8. Maintenance retrieval for decaying evidence.
9. Optional enrichment or user-added work.

Priority alone does not permit overload. The planner records what was displaced and why.

### Dependencies

- A recheck follows its repair.
- A diagnostic follows confirmed coverage.
- Class consolidation follows a completed class session, not the scheduled event.
- New learning respects curriculum prerequisites where registered.
- A mock requires sufficient broad coverage or an explicit candidate decision to use it as a baseline.

---

## 10. Phase-aware task policy

### First pass

Objectives:

- advance through the current milestone;
- include short retrieval after exposure;
- avoid overloading a day with excessive new content;
- preserve previously learned material through small maintenance tasks.

The daily new-content cap must be configurable by module effort and session length, not universally fixed at two effort units.

### Consolidation

Objectives:

- revisit stale/decaying modules;
- connect related concepts;
- mix applied practice with retrieval;
- resolve gaps before broad revision.

### Revision

Objectives:

- cumulative mixed-topic diagnostics and practice;
- timed application;
- cross-topic switching;
- repair and recheck cycles;
- progressively broader scope.

### Final phase

Objectives:

- mocks and mock review;
- repairs and final rechecks;
- Ethics and formula/process refresh where policy supports it;
- logistics and rest protection;
- no routine expansion into untouched content.

If first-pass content remains unfinished, Pulse must not simply hide it. It opens a recovery decision showing:

- essential remaining coverage;
- likely exam value and prerequisites;
- time displaced from mocks/revision;
- options to triage, cover or intentionally defer.

---

## 11. Placement model

### Timed

Use for:

- classes and protected commitments;
- accepted diagnostics where a sitting time is chosen;
- mocks;
- user-pinned study sessions.

### Day-preferred

Use for most study, review, repair and consolidation tasks. The task belongs to a day but not an invented clock time.

### Floating

Use when:

- the task is valid for the week but no day is yet safe;
- the candidate chose flexible work;
- a conflict removed its placement;
- the candidate explicitly keeps it floating.

### Forecast-only

Use beyond the accepted cycle. Forecast entries are visually distinct, cannot be completed and are not stored as `plan_blocks`.

---

## 12. Weekly planning lifecycle

### 12.1 Draft generation triggers

A weekly draft may be generated:

- at onboarding completion;
- during the Pulse review;
- on explicit Generate next week;
- after an exam-date or major availability change;
- after an accepted recovery decision.

Page render never generates or accepts a plan.

### 12.2 Draft review

The student sees:

- week goal and active milestone;
- total available versus proposed minutes;
- classes and protected time;
- task list by day;
- floating work;
- diagnostics/mocks and eligibility reason;
- repair work and displaced scope;
- assumptions and unresolved conflicts;
- comparison with the prior accepted week.

Actions:

- Accept week;
- Make it lighter;
- Use more available space;
- Move/split an individual task;
- Keep a task floating;
- Edit availability/classes;
- Ask Coach about the draft.

### 12.3 Acceptance

Acceptance is atomic and idempotent:

- verify draft ownership, purpose, context fingerprint and revision;
- create one cycle;
- insert the exact reviewed tasks;
- link the accepted draft;
- supersede any conflicting unaccepted draft;
- return the active cycle.

### 12.4 During the week

Events update progress and the forecast. Accepted tasks remain stable until edited or a proposal is accepted.

### 12.5 Weekly close

Pulse review summarizes:

- completed, partial, deferred and intentionally skipped work;
- planned versus actual time where available;
- diagnostic evidence and repair outcomes;
- class coverage;
- roadmap movement;
- one or two observed planning lessons;
- the next draft's important differences.

The review is concise and factual, not a self-judgment exercise.

---

## 13. Today and task execution experience

### Today panel

Show:

- one Next action;
- why it matters;
- estimated duration;
- approach;
- completion meaning;
- Start/Complete/Partial/Move actions;
- next one or two actions, collapsed.

### Completion interaction

On Complete:

- completion is immediate;
- optionally ask “About how long did it take?” with quick choices and custom entry;
- allow Skip for now;
- never block completion on duration entry;
- write immutable `task_events`.

### Partial completion

Ask what remains using structured choices where possible:

- about one-quarter;
- about half;
- almost done;
- custom note.

Pulse proposes either a smaller continuation task or retains the remaining scope. It does not duplicate the full task.

### Redo

Do not clear a completed task. Create a new linked retry/retrieval task while preserving the original completion event.

---

## 14. Class lifecycle

### Scheduled class

Created from onboarding, Settings or Calendar. It:

- protects time;
- may influence short-term sequencing if the teacher's intended topic is known;
- does not create coverage evidence;
- may trigger a conflict proposal if added after week acceptance.

### Completed class

The candidate confirms:

- occurrence attended/completed;
- actual duration, optional;
- topic/module covered;
- optional lesson reference/note;
- whether coverage mapping is uncertain.

The system then:

- writes a learning activity;
- records exposure/coverage provenance as class-reported, not demonstrated;
- proposes consolidation within a suitable window;
- reassesses diagnostic eligibility;
- updates Curriculum and Home.

### Missed/cancelled class

- Mark occurrence cancelled or missed without deleting the recurring series.
- Remove any consolidation that depended solely on that occurrence through a proposal.
- Do not mark the student as behind merely because the provider changed schedule.

### Variable-class weekly sync

For Variable/Mixed schedules, Home and Calendar offer:

- Add class;
- Copy last week;
- No classes this week;
- Add later.

Adding later keeps the accepted plan but marks its forecast as awaiting class information.

---

## 15. Diagnostics, repairs and rechecks

### 15.1 Diagnostic eligibility

A diagnostic is proposed only when:

- relevant coverage has been completed/logged;
- curriculum scope is supported;
- sufficient unseen, appropriately reviewed items exist;
- the blueprint can meet coverage and cognitive targets;
- a realistic sitting fits the week;
- there is no duplicate active attempt for the same purpose/scope.

If ineligible, Calendar displays a reason—not a broken diagnostic task.

### 15.2 Scheduling versus attempt creation

- Calendar may contain a diagnostic task referencing intended scope.
- An `assessment_attempt` is created only when the candidate selects Start test.
- Merely rendering Calendar or accepting a week cannot consume or expose a form.

### 15.3 Weekly diagnostic

Do not restore “ensure a weekly diagnostic” as an unconditional mutation. Use a pure eligibility service that can return:

- eligible and proposed;
- insufficient coverage;
- insufficient bank;
- too soon since related evidence;
- already scheduled/attempted;
- deferred by capacity.

### 15.4 Results to Calendar

After scoring:

1. evidence updates transactionally;
2. concept summaries recompute;
3. repair threads are created/deduplicated;
4. a repair proposal is generated;
5. same-week versus next-week placement follows the cycle boundary and remaining safe capacity;
6. candidate reviews and accepts the change;
7. recheck follows repair at an evidence-policy interval.

### 15.5 Sampling quality

The diagnostic blueprint must diversify:

- LOS/concepts;
- cognition level;
- item form;
- difficulty;
- numerical/non-numerical mix;
- previously seen items;
- distractor/error targets.

Calendar requests purpose/scope; the diagnostic engine owns item selection.

---

## 16. Mock scheduling

Mock policy is configuration, not hardcoded Calendar logic.

Inputs:

- roadmap phase;
- exam date;
- completed coverage;
- prior mocks;
- available contiguous windows;
- official/current configured mock format;
- candidate's accepted sitting preference.

Rules:

- never assume weekends first if weekday capacity is better;
- offer full-condition and policy-approved split-session options where appropriate;
- protect mock review time as well as attempt time;
- do not silently shrink a mock to fit;
- if no adequate window exists, create an attention item with options;
- allow the candidate to pin the chosen appointment;
- avoid a universal every-two-weeks cadence; propose cadence from phase and remaining attempts.

---

## 17. Deviation and recovery model

### 17.1 Events Pulse observes

- completed/partial/deferred/skipped task;
- actual-duration update;
- new or changed commitment;
- scheduled/completed/cancelled class;
- diagnostic result or invalidation;
- repair/recheck result;
- availability edit;
- exam-date change;
- user request for lighter/heavier week;
- self-reported concern.

### 17.2 Impact levels

#### Informational

No accepted task must change. Update progress and forecast silently.

Examples:

- task finished slightly early;
- duration recorded;
- forecast improves without moving work.

#### Adjustment proposal

One or more future accepted tasks should move/split/float/defer, but the milestone remains viable.

Show one batched proposal, not repeated alerts.

#### Recovery decision

The disruption cannot be absorbed without a roadmap trade-off.

Examples:

- several lost days;
- new recurring commitment;
- repair backlog exceeds planned capacity;
- mock cannot fit;
- exam date moves materially closer;
- final phase begins with meaningful untouched coverage.

### 17.3 Proposal options

Depending on the event:

- move work inside the week;
- convert timed to day-preferred;
- keep one task floating;
- split a long task;
- defer lower-priority scope;
- move scope to the next cycle;
- reduce new content to protect repairs;
- extend milestone range;
- explicitly accept a heavier day.

### 17.4 Safe automation boundary

By default, Pulse may automatically:

- update completion/progress;
- recompute forecast;
- remove resolved attention items;
- prepare a proposal.

It may not automatically:

- move or delete accepted tasks;
- increase planned load;
- change milestone scope;
- create evidence;
- schedule a diagnostic attempt;
- reopen a completed task.

An optional future “Auto-tidy minor changes” preference may be introduced only with a precise published policy and Undo.

---

## 18. Coach system

### 18.1 Coach role

Coach is the conversational control surface for:

- explaining today's action;
- understanding plan rationale;
- weekly review;
- diagnostic debrief;
- recovery after disruption;
- class-driven changes;
- roadmap trade-offs;
- confidence calibration;
- preparing a proposal.

Coach does not teach whole subjects. It points to the topic/module/LOS and appropriate learning source.

### 18.2 Coach context

Every message receives a bounded `OperatingState` containing:

- exam/phase/milestone;
- accepted week and revision;
- today's tasks;
- protected commitments;
- completion and actual-duration summary;
- latest diagnostic evidence;
- open repair threads;
- class information;
- attention items;
- supported curriculum capabilities.

Avoid sending unnecessary historical rows or source content to the model.

### 18.3 Closed Coach intents

| Intent | Effect |
|---|---|
| `explain_next_action` | Read-only explanation |
| `explain_plan` | Read-only week/roadmap explanation |
| `report_struggle` | Store self-reported concern; propose support/retrieval, not diagnostic evidence |
| `propose_move` | Create versioned task-move proposal |
| `propose_split` | Create versioned split proposal |
| `propose_defer` | Create versioned deferral proposal |
| `propose_lighter_week` | Create revised weekly draft/proposal |
| `propose_more_space` | Create revised weekly draft/proposal |
| `redo_task` | Propose a new linked retry task; preserve original history |
| `day_disrupted` | Record reason and generate an impact assessment/proposal |
| `log_class` | Open/prefill the structured completed-class flow |
| `review_diagnostic` | Explain evidence, repair and recheck plan |
| `prepare_recovery` | Produce explicit roadmap/calendar options |

Anything ambiguous remains conversation until the candidate confirms the intended action.

### 18.4 Proposal lifecycle

```text
Coach interprets request
        ↓
Server validates intent and current revisions
        ↓
Persistent proposal: Pending
        ↓
Preview shown with exact changes
        ↓
Accept / Adjust / Reject
        ↓
Atomic execution or Stale response
```

Coach must use the same planning functions and RPCs as Calendar. It never receives a separate write path.

### 18.5 Evidence integrity

- “I do not understand X” creates a learner concern, not `needs_repair` evidence.
- A diagnostic may confirm or contradict the concern.
- Coach can prioritize retrieval/practice without pretending the concept was tested.
- Confidence and demonstrated understanding remain separate.

---

## 19. Calendar page experience

**Canonical route:** `/app/calendar`

### Header

- Calendar title;
- week range;
- previous/current/next controls;
- Week and Agenda views;
- Generate/Review next week where appropriate;
- Add action menu: class, commitment, personal study task.

### Today focus

- one next action;
- explanation and duration;
- Start/Complete controls;
- next-up summary;
- no readiness percentage presented as certainty.

### Week summary

- proposed/accepted study minutes versus available ceiling;
- milestone contribution;
- completed/remaining work;
- repair and diagnostic status;
- plan state: Draft, Accepted, Needs review or Closed.

### Week grid

- commitments/classes as protected timed blocks;
- timed tasks in clock positions;
- day-preferred tasks in a day lane;
- floating tasks in a side tray;
- forecast-only entries visually distinct and non-interactive;
- drag/move with conflict preview and keyboard alternative.

### Mobile

Default to Agenda, not a compressed seven-column grid. Provide:

- horizontal day selector;
- today's ordered tasks;
- collapsible protected commitments;
- floating tray;
- sticky Add action;
- proposal banner where relevant.

### Empty states

Differentiate:

- no accepted week yet → Review weekly draft;
- no task today → show next scheduled day and optional floating work;
- missing availability → Edit availability;
- awaiting class schedule → Add this week's classes;
- diagnostic unavailable → explain scope/bank reason;
- completed week → show Pulse review.

### Non-panic visual rules

- Neutral language for incomplete work.
- Red only for destructive/error conditions, not ordinary deferral.
- “Needs a decision” rather than “Plan failed.”
- Changes summarized in one banner, not multiple toasts.
- Use subtle motion only to preserve spatial continuity when a proposal is accepted.
- Every colour-coded layer also has a label/icon/pattern.

---

## 20. Routes and links

### Product routes

| Route | Responsibility | Key outgoing links |
|---|---|---|
| `/app` | Next action, attention and weekly snapshot | Calendar, Tests, Coach, Curriculum |
| `/app/calendar` | Accepted week, execution and proposals | Task detail, Tests, Coach, Settings |
| `/app/calendar?week=YYYY-MM-DD` | Specific cycle/week | Current week, prior/next week |
| `/app/calendar?view=agenda` | Mobile/linear execution view | Task detail |
| `/app/tests` | Eligible diagnostics and assessment history | Attempt, result, Calendar |
| `/app/tests/[attemptId]` | Assessment delivery | Result |
| `/app/tests/[attemptId]/result` | Evidence and repair proposal | Calendar, Coach, Review |
| `/app/curriculum` | Roadmap, milestones and evidence-qualified coverage | Calendar, Tests, Coach |
| `/app/coach` | Explanation, review and proposal conversation | Calendar proposal, Tests, Curriculum |
| `/app/log` | Structured external learning/class log fallback | Calendar, Curriculum |
| `/app/settings` | Exam, class pattern, availability and checkpoint | Calendar proposal preview |

### Read APIs

| Endpoint | Responsibility |
|---|---|
| `GET /api/calendar/week?date=YYYY-MM-DD` | Accepted entries, commitments, forecast and attention for a week |
| `GET /api/calendar/today` | Minimal next-action read model |
| `GET /api/roadmap` | Active roadmap/progress |
| `GET /api/commitments` | Active recurring and one-off commitments |
| `GET /api/tasks/[id]` | Task detail and immutable event history |
| `GET /api/coach/context` or server-internal state read | Bounded operating state |

### Planning APIs

| Endpoint | Method | Responsibility |
|---|---|---|
| `/api/calendar/drafts` | `POST` | Generate a weekly draft explicitly |
| `/api/calendar/drafts/[id]` | `GET` | Read exact draft/revision |
| `/api/calendar/drafts/[id]` | `PATCH` | Lighter/more-space/move/split/float revision |
| `/api/calendar/drafts/[id]/accept` | `POST` | Atomically accept exact weekly draft |
| `/api/calendar/proposals` | `POST` | Build proposal from a disruption/event |
| `/api/calendar/proposals/[id]` | `GET` | Read exact proposal/diff |
| `/api/calendar/proposals/[id]/accept` | `POST` | Atomically apply proposal |
| `/api/calendar/proposals/[id]/reject` | `POST` | Preserve week and record rejection |

Existing `/api/plan` and `/api/plan/accept` may be adapted/redirected during migration; do not delete them before onboarding and every caller move to the canonical contracts.

### Task and commitment APIs

| Endpoint | Responsibility |
|---|---|
| `POST /api/tasks` | User-created study task |
| `GET/PATCH/DELETE /api/tasks/[id]` | Detail, move, execution, split, undo/archive |
| `GET/POST /api/commitments` | Recurring/one-off commitments and upcoming classes |
| `PATCH/DELETE /api/commitments/[id]` | Edit/archive commitment series |
| `POST /api/classes/complete` | Log a completed class occurrence and confirmed coverage |
| `POST /api/classes/[id]/occurrences/[date]/status` | Cancel/miss/move one occurrence |

### Diagnostic APIs

Keep existing attempt routes. Add a pure eligibility endpoint or server service:

- `GET /api/diagnostic/eligibility?purpose=...&scope=...`

Starting an attempt remains an explicit `POST /api/diagnostic/attempt`.

### Coach APIs

| Endpoint | Responsibility |
|---|---|
| `POST /api/coach` | Conversation and intent classification |
| `GET /api/coach/proposals/[id]` | Read proposal preview |
| `POST /api/coach/proposals/[id]/accept` | Execute through shared proposal RPC |
| `POST /api/coach/proposals/[id]/reject` | Reject without mutation |

---

## 21. Data model

### Reuse

- `planning_cycles` — accepted weekly baseline;
- `plan_drafts` — weekly drafts and revisions;
- `plan_blocks` — accepted tasks;
- `task_events` — immutable task history and actual duration;
- `calendar_commitments` — protected classes/life commitments;
- `commitment_exceptions` — moved/cancelled occurrences;
- `coach_proposals` — persistent previewable mutations;
- `repair_threads` and events — repair lifecycle;
- diagnostic attempt/evidence tables — demonstrated understanding;
- `learning_activities` — completed class/external learning log;
- exact `availability_windows` from canonical onboarding migration.

### Extend

#### `plan_drafts`

- purpose (`onboarding_initial_week`, `weekly_plan`, `recovery`);
- policy/context/roadmap revisions;
- forecast summary;
- accepted cycle link;
- capacity and fill-ratio inputs.

#### `plan_blocks`

- optional `parent_task_id` for continuation/retry lineage;
- optional `learning_activity_id`/class provenance where appropriate;
- policy version and generation reason;
- current revision already used for optimistic concurrency.

#### `coach_proposals`

- closed intent;
- source event ID;
- before/after summary;
- affected revisions;
- expiry/stale reason;
- accepted/rejected timestamps.

### Add only if existing structures cannot express them cleanly

#### `learner_signals`

Stores self-reported concern separately from evidence:

- user;
- concept/module;
- signal type (`struggling`, `low_confidence`, `needs_repetition`);
- source (`coach`, `task`, `weekly_review`);
- status/expiry;
- created/resolved timestamps.

If `learning_activities` is extended to represent this without semantic confusion, a new table is unnecessary. Do not store it as diagnostic evidence.

### Constraints and indexes

- one Active cycle per user;
- one Ready weekly draft per user/cycle/context version;
- one open repair thread per relevant concept/manifest identity;
- non-overlapping protected time enforced in service validation;
- indexes on user/status/date for blocks, commitments, proposals and signals;
- RLS on every user-owned table;
- security-definer RPCs use explicit `search_path`, ownership checks and restricted grants.

---

## 22. OperatingState linkage

`getCurrentOperatingState(userId)` becomes the common read model for Home and Coach and a subset for Calendar.

It should contain:

- identity: exam, route, phase;
- roadmap: active milestone, pace and projection;
- cycle: dates, status, accepted draft/revision;
- today: ordered accepted actions;
- week: capacity, proposed load, completion and floating work;
- diagnostics: latest valid evidence and next eligible assessment;
- repairs: open threads and due rechecks;
- classes: next occurrence and pending weekly sync;
- proposals: pending/stale changes;
- attention: ranked items with direct resolution routes;
- next action: deterministic action and explanation.

Every attention item includes:

- stable code;
- concise title;
- why it matters;
- severity without alarmist copy;
- resolution route/action;
- deduplication key.

---

## 23. Cross-product event flow

### Task completion

```text
Calendar task Complete
  → task event + optional actual duration
  → OperatingState refresh
  → forecast recalculates
  → roadmap progress updates if completion meaning is satisfied
  → no accepted task moves automatically
```

### Completed class

```text
Calendar Completed class
  → learning activity + class coverage provenance
  → Curriculum exposure updates
  → consolidation candidate
  → diagnostic eligibility rechecked
  → proposal if accepted week needs change
```

### Diagnostic result

```text
Test submitted
  → atomic score/evidence update
  → concept summaries
  → deduplicated repair threads
  → repair/recheck proposal
  → Calendar preview
  → candidate accepts
  → Home/Coach show updated next action
```

### New commitment

```text
Calendar/Settings commitment added
  → protected occurrence expansion
  → conflict/impact analysis
  → no-impact forecast OR proposal OR recovery decision
  → accepted change updates Calendar
```

### Coach request

```text
Message
  → intent + entities + confidence
  → read-only answer OR validated proposal
  → preview in Coach and Calendar
  → candidate confirmation
  → shared atomic executor
  → OperatingState refresh
```

---

## 24. Engine modules

Recommended structure:

```text
src/lib/pulse/
  policy.ts                 phase and adaptation policy
  types.ts                  normalized inputs/outputs
  capacity.ts               exact-window capacity
  demand.ts                 roadmap demand per week
  prioritize.ts             repair/class/phase ordering
  composeWeek.ts            pure weekly composer
  forecast.ts               non-mutating live forecast
  impact.ts                 informational/proposal/recovery classification
  proposals.ts              before/after diff construction
  diagnosticEligibility.ts  scheduling eligibility wrapper
  classPolicy.ts            scheduled/completed class logic
  mockPolicy.ts             configurable mock recommendation
  service.ts                authenticated orchestration/persistence
```

Do not delete `composer.ts` until:

- Pulse composer reaches parity;
- onboarding uses it;
- `/api/plan` callers are migrated;
- draft acceptance is migrated;
- route audit finds no remaining dependency;
- regression tests pass.

Then retire through a compatibility adapter or controlled removal.

---

## 25. Atomicity, concurrency and idempotency

### Draft acceptance

- row-lock draft;
- verify expected revision/context;
- read tasks from stored server-owned JSON;
- create cycle/tasks atomically;
- return existing result on retry.

### Proposal execution

- row-lock proposal and all affected task revisions;
- reject stale proposals with 409 and regenerate option;
- apply before/after operations atomically;
- write task events;
- mark proposal executed;
- return affected rows.

Do not pass arbitrary task JSON from the client into security-definer functions. RPCs read validated proposal/draft payloads stored by the server.

### Render purity

GET/page render may read state and compute a forecast. It cannot:

- create plan blocks;
- generate an assessment attempt;
- accept a proposal;
- close a cycle;
- change evidence;
- create a commitment.

---

## 26. Notifications and reminders

Until notification delivery exists, Calendar may show in-app attention but must not ask for or promise reminder times.

When notifications are implemented:

- opt-in by channel;
- quiet hours;
- timezone-aware delivery;
- one daily summary rather than repeated nagging;
- material-change notification only when action is required;
- no public notification text revealing diagnostic weaknesses by default.

---

## 27. Edge cases

Pulse must explicitly handle:

- no available timed windows;
- variable classes added after week acceptance;
- class cancellation;
- timezone/DST change;
- travel week or temporary availability override;
- illness/pause and return after a gap;
- exam date moved;
- registered date different from representative window date;
- work completed outside Roadmap;
- task completed early or over several sittings;
- multiple diagnostics generating the same repair concept;
- invalidated/challenged diagnostic evidence;
- insufficient diagnostic item bank;
- unfinished first pass entering final phase;
- mock requiring more continuous time than available;
- two devices editing the same task;
- stale Coach proposal;
- accepted week with a subsequently deleted commitment;
- candidate intentionally choosing no diagnostic this week;
- curriculum capability missing for a planned module.

---

## 28. Rollout plan

### Phase 0 — Truth and contracts

- Audit live callers and data.
- Finalize Pulse types/policy versions.
- Complete canonical onboarding/availability migration.
- Define draft/proposal atomic RPC contracts.

### Phase 1 — Stable weekly planning core

- Exact capacity.
- Correct weekly demand.
- Phase-aware task composition.
- Full-week draft/review/acceptance.
- Calendar reads accepted week.
- Actual-duration capture.

### Phase 2 — Execution and forecast

- Today focus and task state UX.
- Live non-mutating forecast.
- Partial/continuation/retry lineage.
- Pulse weekly review.

### Phase 3 — Classes and diagnostics

- Upcoming/completed/cancelled class lifecycle.
- Variable-class sync.
- Diagnostic eligibility and calendar tasks.
- Atomic result-to-repair proposals.

### Phase 4 — Deviations and recovery

- Impact classifier.
- Batched proposals.
- Recovery decisions.
- Settings-triggered plan impacts.

### Phase 5 — Coach actions

- Bounded OperatingState.
- Closed intents.
- Proposal preview/accept/reject.
- Self-reported concern separation.

### Phase 6 — Mocks and final-phase policy

- Configurable mock recommendation.
- Sitting selection and review protection.
- Final-phase recovery/triage.

### Phase 7 — Polish and controlled retirement

- Mobile agenda and accessibility.
- Notification groundwork.
- Delete dead generator only after route/caller proof.
- Performance and analytics hardening.

The original rollout deferred phase-aware planning and class logic even though they are central to whether the first Calendar plan is useful. They belong in the core or immediately following execution slice, not as distant enhancements.

---

## 29. Verification plan

### Pure policy tests

- exact capacity and protected overlap;
- fill-ratio bounds;
- weekly demand across phase lengths;
- rolling adaptation with insufficient history;
- repair displacement inside capacity;
- prerequisites;
- task split by session limit;
- phase-specific composition;
- no-window floating plan;
- diagnostic eligibility states;
- mock recommendation states;
- impact classification;
- stable forecast without writes.

### Database tests

- one active cycle/draft constraints;
- RLS isolation;
- atomic acceptance rollback;
- proposal stale revision;
- proposal retry idempotency;
- task event immutability;
- repair deduplication;
- invalidated evidence removing dependent repair proposal safely.

### API integration tests

- generate/review/adjust/accept week;
- exact accepted tasks match draft;
- task completion with/without duration;
- partial task continuation;
- upcoming/completed/cancelled class;
- new commitment causing each impact level;
- diagnostic eligibility and explicit attempt start;
- result-to-repair proposal;
- Coach read-only and mutating intents;
- reject/stale/accept proposal.

### Browser journeys

- onboarding to accepted first week;
- self-study candidate normal week;
- fixed-class candidate;
- variable-class weekly sync;
- missed day recovery;
- diagnostic Sunday/closing-day result affecting next week;
- no free timed window;
- revision/mock planning;
- mobile Agenda execution;
- keyboard move/split/complete;
- no console/hydration errors;
- page refresh causes zero writes.

### User acceptance scenarios

1. **Working candidate:** evening windows, changing workload, one missed weekday.
2. **College candidate:** variable lectures and weekend class.
3. **Live-coaching candidate:** class-led topic order and consolidation.
4. **Self-study candidate:** nine-month roadmap with early acceleration.
5. **Short-runway candidate:** compressed first pass without access denial.
6. **Returning/retake candidate:** prior exposure, diagnostics and repair-heavy week.
7. **Final-phase candidate:** mocks, review and limited untouched scope.

---

## 30. Success measures

Product health should be evaluated through:

- accepted-week rate;
- percentage of accepted tasks completed/partially completed;
- proportion of deferrals resolved without repeated rollover;
- actual-duration response rate;
- forecast accuracy;
- diagnostic-to-repair acceptance and completion;
- repair-to-recheck closure;
- class-log-to-consolidation completion;
- roadmap projection stability;
- proposal acceptance/rejection/stale rate;
- reduced accumulation of overdue tasks;
- candidate-reported clarity and perceived control.

Do not optimize for raw planned hours, number of notifications or maximum calendar density.

---

## 31. Founder decisions before implementation

This specification uses the following recommended defaults:

1. **Weekly boundary:** user-confirmed, with a recommendation—not derived from class day.
2. **Schedule stability:** the full accepted week is persisted; only forecasts change automatically.
3. **Automation:** accepted task mutations require confirmation; forecast/progress updates do not.
4. **Mock scheduling:** configurable and candidate-confirmed, not a fixed weekend cadence.
5. **Coach:** closed read/propose/confirm tools, never autonomous open-ended writes.

If any of these product decisions changes, the persistence and UX model must be revised before implementation. They should not be left for an engineer to infer while coding.

---

## 32. Final definition of Pulse

Pulse is not a calendar that constantly rearranges a student's life. It is a weekly learning-control system that:

- translates the CFA roadmap into a realistic accepted week;
- protects classes and life commitments;
- guides the next useful action;
- observes what actually happened;
- schedules tests only when meaningful and deliverable;
- converts weaknesses into repair and recheck work;
- forecasts deviations without panic;
- proposes clear trade-offs when the week must change;
- lets the candidate remain the final authority over material changes.

That is the system required for an adaptive planner to feel dependable enough for months of CFA Level I preparation.
