# Roadmap Home: end-to-end product and build specification

**Status:** canonical V2 product direction approved; implementation begins after onboarding and operating-state truth repairs  
**Product role:** the student's operating console for today and this study week

**Validated against:** the rendered localhost build and current server/database contracts on 18 September 2026

## Product decision

Home is not a dashboard of everything Roadmap knows. It is the shortest route from anxiety to one justified action.

Within ten seconds, a student should know:

1. What should I do next?
2. Why is it the right thing now?
3. Does it fit today?
4. Is there a test, repair or plan decision waiting for me?
5. Is my broader exam path healthy, changing, or uncertain?

Home must never calculate its own version of progress. It reads the same roadmap, weekly cycle, calendar, task events and evidence services used by the destination pages.

Home does not lead with one readiness percentage. It shows curriculum position, demonstrated understanding, plan execution, and confidence calibration separately. A plain-language preparedness band may appear only after the approved minimum evidence threshold is met; it is never a pass probability.

Home also owns the contextual weekly-closure entry. There is no permanent Weekly Review tab. After the week's diagnostic or revisionary paper is completed, Home asks the student to complete or mark unknown any outstanding logs, then opens the closure and next-week preview.

## Current Home diagnosis — verified 18 September 2026

The current page is a visually polished context echo, not an operating console. In the audited account it showed a 0% Readiness ring and an Ethics milestone even though first-week acceptance had failed, Settings said the exam was not chosen, and there was no executable task. Large parts of the viewport were empty. Four shortcut pills repeated the sidebar instead of resolving the broken setup/plan state.

Rebuilding its layout before establishing a shared operating-state read model would reproduce the same contradiction with better styling.

## Exact page contract

**Route:** `/app`  
**Authentication:** required  
**Onboarding:** `profiles.onboarding_status` must be `complete`; otherwise the shared app layout redirects to the first incomplete setup step  
**Render rule:** the page is read-only on load; it never creates a cycle, task, diagnostic, repair, or Coach proposal as a render side effect  
**Truth owner:** `getCurrentOperatingState(userId, now)`  
**Mutation rule:** every button calls the same command used by Calendar, Tests, Curriculum, or Coach; Home never owns a second implementation

## Target first viewport

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CFA Level I · Aug 2027      First pass · Study week 4     312 days to window│
├──────────────────────────────────────┬───────────────────────────────────────┤
│ NEXT ACTION                          │ TODAY                                 │
│ Consolidate LM: Time value of money  │ 07:30  Retrieval · 35 min             │
│ 45 min · before Wed class            │ 18:00  Class · Quant                  │
│ Why: first retrieval after exposure  │ Flexible  Concept check               │
│ [Start] [Move] [Make shorter]        │ [Open day]                            │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ ATTENTION (only when actionable)                                             │
│ Your Friday class moved. Review a 2-task calendar adjustment. [Review]       │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ THIS WEEK                            │ EVIDENCE / CHECKPOINT                 │
│ 3 core actions left · 1 partial      │ Sunday check eligible · 12 unseen     │
│ [Open calendar]                      │ items · 1 repair due [Open tests]     │
└──────────────────────────────────────┴───────────────────────────────────────┘
```

On mobile the order is Next Action → Attention → Today → This Week → Evidence → Roadmap → Coach. The desktop sidebar remains available, but Home does not repeat it as a row of generic destination pills.

## Information hierarchy and components

| Order | Component | Job | Source | Destination/action |
|---|---|---|---|---|
| 1 | `HomeContextBar` | Confirm exam window, phase, study week, and data freshness | identity + roadmap + cycle | Curriculum or Settings when context is missing |
| 2 | `NextActionCard` | Put one justified, executable action in front of the student | deterministic next-action selector | task focus, diagnostic attempt, draft review, or conflict review |
| 3 | `TodaySequence` | Show commitments, classes, study, tests, and repairs in chronological order | calendar projection | `/app/calendar?date=YYYY-MM-DD` |
| 4 | `AttentionQueue` | Surface at most three decisions that block or materially change the plan | conflicts + proposals + sufficiency + setup gaps | exact resolution route |
| 5 | `WeekPulse` | Explain accepted scope, actual execution, remaining core work, and deviations | active cycle + task events | `/app/calendar?view=agenda` |
| 6 | `EvidencePulse` | Show recent support/instability/repair changes with sample size and age | concept summaries | relevant test result/concept history |
| 7 | `RoadmapTrajectory` | Show current milestone, projection band, final-eight-week boundary, and next milestone | active roadmap projection | `/app/curriculum` |
| 8 | `CoachEntry` | Offer contextual questions and proposal entry points, not a blank chat box | current operating state | `/app/coach?intent=...` or inline composer |
| 9 | `LearningCapture` | Log external class/study/practice without calling it mastery | activity log contract | quick drawer and `/app/log` |

## Deterministic next-action selector

Home must choose one action using a testable ordering. It must never ask an LLM to decide the priority from raw prose.

1. Recover a failed or stale week activation.
2. Review a change that blocks today's accepted work.
3. Resume an in-progress timed task.
4. Start a due, deliverable weekly diagnostic or re-check.
5. Review a scored diagnostic whose repair proposal is waiting.
6. Start the next timed class/study/repair action due now or today.
7. Start the next accepted day-preferred core task.
8. Review/accept the next weekly draft.
9. Place an unplaced core task.
10. Close the week and review actual versus planned work.
11. If there is genuinely no accepted work, explain why and offer the exact recovery action.

Each candidate action carries `kind`, `title`, `scope`, `reason`, `start`, `duration`, `primaryCommand`, `secondaryCommands`, `destination`, `revision`, and `availability`. If `availability` is false, it cannot be selected as the primary action.

## First-viewport experience

### 1. Context line

Show only durable orientation:

- “CFA Level I · May 2027” or “Target window not chosen”.
- Current phase: First pass, Consolidation, Revision, Final eight weeks, or Post-exam.
- Days to window only when the window is known and the value helps a decision.

Do not lead with a readiness percentage or hours studied.

### 2. Next best action

This is the dominant object on Home. It is selected by deterministic priority, not by an LLM improvising:

1. A diagnostic that closes the study week and is currently deliverable.
2. An overdue or due-today re-check.
3. A time-sensitive repair.
4. A class or consolidation task with a confirmed time.
5. The next accepted core study task.
6. A plan-review decision.
7. If nothing is accepted, create/review the week.

Display:

- action title and curriculum scope;
- date/time or “choose a time”;
- expected sitting range;
- one-sentence rationale;
- source pointer when verified;
- one primary action: Start, Resume, Take diagnostic, Review changes, or Choose time;
- one contextual secondary action: Move, Make shorter, or Not today.

Starting a task creates an execution event. It opens a focused session surface; it must not be a decorative button.

### 3. Today

Show today's accepted sequence across protected commitments, classes, study tasks, tests and repairs. The goal is not to replicate the full Calendar. Show enough to expose collisions and sequence.

Each row supports:

- open details;
- start/resume;
- mark partial or complete;
- move/defer through the shared Calendar action;
- explain why it is here.

If there is a collision or more work than confirmed time, show one attention message and the smallest useful resolution—not a red status wall.

### 4. Attention queue

At most three items, ordered by consequence:

- a repair proposal waiting for acceptance;
- a weekly plan draft waiting for review;
- an overdue re-check;
- an unplaced core task;
- a class/commitment change that invalidates the week;
- a bank shortage that prevents the scheduled diagnostic;
- genuinely missing context needed for the next draft.

Every attention item must have a resolution action. Informational notices belong lower on the page.

## Below the fold

### This week

Summarize behavior, not vanity:

- completed, partial, deferred and unreported scope;
- next diagnostic date and deliverability;
- core tasks remaining;
- changes since the week was accepted;
- link to Calendar.

Avoid completion rings that treat all tasks as equal. A protected life commitment is not study progress; a completed reading is exposure, not understanding.

### Evidence pulse

Show the top evidence changes, not a generic “preparedness score”:

- newly supported concepts;
- unstable concepts;
- open repair threads;
- evidence becoming stale;
- confidence/performance mismatches.

Each item links to the concept history or diagnostic result. State sample size and recency. Self-reported confidence and demonstrated understanding remain separate.

### Roadmap trajectory

Show:

- active milestone and intended date range;
- current curriculum scope;
- whether the projection is holding, ahead, compressed, or unknown;
- protected final-eight-week boundary;
- next milestone.

If the student advanced faster, offer Advance, Consolidate, or Reclaim time. If slower, offer Reduce scope, Change method/placement, or Revise milestone. Never silently add the missed load to next week.

### Coach entry

Coach is a contextual control layer, not a blank chatbot greeting. Offer prompts derived from current state:

- “Why is this my next task?”
- “Make Wednesday lighter.”
- “What did my last diagnostic change?”
- “I do not feel confident in this topic.”
- “My class moved—repair this week.”

Calendar changes always return a preview and require confirmation.

### Learning capture

Provide quick learning/class capture widgets on Home and Calendar, backed by a detailed route/history rather than a primary navigation tab. Learning can also be recorded from Curriculum. Capture class/study/practice, scope, actual duration and optional confidence. If mapping is uncertain, save it as unconfirmed and ask for later mapping confirmation. Logging study never creates mastery evidence.

### Weekly paper and closure

- New material produces a diagnostic paper.
- Revisited material produces a revisionary paper.
- Mixed weeks use explicitly separated sections and evidence semantics.
- Class-going candidates' class cycle defines the week; self-study uses Monday–Saturday with the closing paper on Sunday.
- After scoring, Home shows the analysis and requests any missing execution/class logs.
- Only then does it generate and preview the next week.
- The student accepts the draft before Calendar changes.

## Required Home states

Home is one page with explicit states, not one happy-path layout.

| State | Dominant action | Supporting message |
|---|---|---|
| New account, onboarding incomplete | Continue setup | Access remains available; explain what setup unlocks |
| Onboarding complete, no roadmap | Review target and starting point | Do not fabricate a week |
| Roadmap exists, no accepted week | Review this week's draft | Show the draft rationale |
| Active normal day | Start next action | Show today's sequence |
| Diagnostic due | Take or place diagnostic | Confirm that a valid form can be assembled |
| Diagnostic finished, repairs pending | Review what changes | Preview dates and displaced work |
| Plan conflict | Resolve one conflict | Offer valid alternatives |
| Midweek disruption | Review the smallest repair | Preserve completed and protected work |
| Week closed | Review the week and next draft | Unknown logs stay unknown |
| Ahead of roadmap | Choose Advance / Consolidate / Reclaim | Do not automatically raise future load |
| Behind roadmap | Choose an honest trade-off | Protect final preparation unless explicitly changed |
| Final eight weeks | Begin mock/review action | Replace first-pass pacing with exam simulation loop |
| Exam completed | Record outcome or close journey | Archive evidence; support retake without erasing history |
| Data/service error | Retry or use unaffected feature | Never display fabricated zeroes |

## Shared operating-state contract

Home should consume one server-owned read model:

```text
OperatingState
  identity: target exam window, route, phase
  roadmap: active milestone, projection status, protected boundary
  cycle: current week, accepted revision, pending draft/proposals
  today: ordered commitments and tasks
  nextAction: action, rationale, destination, executable state
  attention: conflicts, unplaced work, pending repairs, diagnostic availability
  evidence: current concept summaries and recent changes
  activity: completion, partial, defer and unknown events
  capabilities: what curriculum/tests/sources are actually supported
```

The service must:

- be account-scoped;
- define “current” once using the student's local study week;
- aggregate concept evidence deterministically;
- include diagnostic-origin work whether or not it began in a planning draft;
- distinguish unavailable data from zero;
- expose stale/revision state;
- return links/actions only when their downstream capability is available.

## Action contracts

### Start/resume

Writes a task event and opens a focused task view with scope, source pointer, suggested approach and done definition.

### Complete/partial

Records completed scope and optional actual time. Partial means partial; it does not become failed or restart at 100% next week.

### Move/defer/split

Uses Calendar's validated mutation service. Protected conflicts are refused with alternatives. Other conflicts require acknowledgement. Every change has revision checking and undo.

### Diagnostic

The action first reserves/validates a form. If no valid form exists, Home must not render “Start test.” It renders the honest fallback returned by the bank-sufficiency service.

### Accept proposal

Shows a human-readable difference: added, moved, shortened, deferred or superseded tasks; cycle effects; roadmap effect. Acceptance is atomic and idempotent.

## Route and command connections

| Home intent | Canonical route/command | Required result |
|---|---|---|
| Open full day/week | `GET /app/calendar?date=...` or `?view=agenda` | Same task IDs, revisions, and execution states as Home |
| Start/resume task | shared task command (`/api/tasks/[id]`) | Writes task event, returns new revision, opens focus detail |
| Partial/complete/skip | shared task command (`/api/tasks/[id]`) | Updates Calendar and Home atomically; records actual scope/time separately |
| Move/split/defer | calendar mutation service | Validates protected conflicts, returns proposal/alternatives, supports undo |
| Review weekly draft | `/app/calendar?panel=draft` | Shows added/moved/removed scope and assumptions before acceptance |
| Start diagnostic | attempt reservation endpoint then `/app/tests/[attemptId]` | Confirms eligibility and locks an item form before navigation |
| Review diagnostic | `/app/tests/[attemptId]/result` | Shows concept evidence and proposed plan consequences |
| Review repair | `/app/calendar?panel=repair&thread=...` | Shows repair + re-check placement and displaced work |
| Open concept evidence | `/app/tests?concept=...` (or future concept detail route) | History, validity, recency, confidence calibration, source attempts |
| Open milestone | `/app/curriculum?milestone=...` | Same active roadmap and projection shown on Home |
| Ask Coach | `/app/coach?intent=...` | Sends a structured intent plus current-state version, not copied page text |
| Log external learning | quick capture or `/app/log` | Writes activity/exposure only; never mastery evidence |
| Repair setup | exact `/app/settings?...` editor | Returns to Home with state recomputed; does not reopen the gated onboarding journey |

Completed users must edit setup through Settings-owned editors. Linking a completed user back to `/onboarding/*` currently fails because onboarding redirects completed profiles to `/app`.

## Required `OperatingState` V2 shape

```text
OperatingStateV2
  generatedAt, timezone, dataVersion
  identity
    examWindow, bookedExamDate, registrationStatus, preparationRoute
  roadmap
    status, phase, currentMilestone, nextMilestone
    projectionBand, projectedFirstPassRange, finalPreparationBoundary
  cycle
    status, revision, weekStart, weekEnd
    acceptedAt, pendingDraft, pendingProposals
  today
    orderedEntries[] (commitment | class | study | diagnostic | repair | recheck)
  execution
    plannedCore, completed, partial, deferred, skipped, unreported
  diagnostics
    nextEligible, reservationState, bankSufficiency
    latestResult, dueRechecks
  evidence
    supported, unstable, needsRepair, stale, recentChanges[]
  repairs
    openThreads[], proposedChanges[]
  attention
    actionableItems[]
  nextAction
    selected action with executable command and explanation
  capabilities
    curriculumCoverage, testCoverage, coachActions, premiumSources
  integrity
    stale, conflicts[], crossPageInvariants[]
```

Absence and zero are distinct. `null` means unavailable/unknown; `0` is only rendered when the system actually measured zero.

## Home copy rules

- Say “Roadmap coverage,” “diagnostic evidence,” “week completion,” and “self-rated confidence”; do not call all four “progress.”
- Do not say “ready” from coverage alone.
- Do not say “behind” without naming the baseline and the choice available.
- Do not congratulate routine clicks or use shame/streak pressure.
- Do not claim a diagnostic is due unless an eligible attempt can be reserved.
- Explain every adaptive change in one sentence: evidence or deviation → proposed consequence.
- When a service is unavailable, preserve known state and label it stale; never replace it with 0%.

## Responsive behaviour

- **≥1200px:** two-column operating console; Next Action spans the larger column and Today sits alongside it.
- **768–1199px:** one main column plus compact secondary panels; Calendar links open the three-day/tablet view.
- **<768px:** single column; sticky bottom action only when it is the same action as the visible Next Action card; no seven-day mini-grid.
- Minimum interactive target: 44×44px. Keyboard focus order follows the visual order. Status must never rely on color alone.
- Motion is limited to 150–300ms state transitions, respects reduced-motion, and explains accepted/moved/completed state changes rather than decorating load.

## Error, stale, and concurrency behaviour

1. A failed Home read shows the last coherent snapshot if available, labels its age, and offers Retry.
2. Mutations carry expected revision/idempotency keys. A stale command refreshes the affected card and explains the change.
3. Partial service failure does not zero unrelated cards.
4. A task moved on another device updates Home before a new command can be applied.
5. A diagnostic form that becomes insufficient between render and click returns to an honest alternative state; it does not create an empty attempt.
6. A failed plan acceptance leaves onboarding/weekly-draft status unchanged and preserves the reviewable draft.

## Visual and interaction direction

- Use one dominant next-action surface, not a grid of equal cards.
- Use the Calendar's semantic colors sparingly and consistently.
- Keep content density high enough that today's plan and attention queue fit in a laptop viewport.
- Use restrained motion only to explain state change. Essential content must be visible without animation or JavaScript success.
- Buttons must look disabled when disabled; disabled actions must explain why.
- Use real CFA curriculum names only when mapping is verified.
- Write in calm, direct language. Avoid praise, shame, streak pressure and pass predictions.
- On mobile, place Next Action, Today and Attention before any analytics.

## Instrumentation

Track product behavior without turning activity into surveillance:

- Home loaded with coherent operating state;
- next action opened and completed/partial/deferred;
- attention item resolved;
- diagnostic due but undeliverable;
- proposal previewed, accepted, rejected or stale;
- cross-page state disagreement detected;
- time from Home arrival to meaningful action;
- week-review completion.

Do not optimize for minutes on Home, number of cards clicked, scheduled hours or raw streak length.

## Build sequence

### H0 — Truth layer

Build and test `OperatingState`, concept aggregation, next-action selection and capability gates with deterministic fixtures.

### H1 — Action-first shell

Build the Context line, Next Action, Today and Attention states. Connect every displayed control to a real service. Remove the prototype banner from account-backed screens.

### H2 — Evidence and roadmap

Add evidence change, weakness threads and long-term trajectory after their source services exist. Never mock personal data in the real account flow.

### H3 — Coach and weekly closure

Add contextual Coach actions and the week-review/new-draft transition. Demonstrate two consecutive cycles.

### H4 — Qualification

Test all states on desktop and mobile, keyboard and reduced-motion settings, slow/offline networks, stale revisions and two-device updates.

## Acceptance criteria

Home is complete when:

1. Home, Calendar, Tests, Curriculum and Coach agree on the current cycle and concept states.
2. Every primary action is executable or truthfully unavailable.
3. A diagnostic result appears as a reviewable plan consequence and later as an executable task.
4. Partial, moved and deferred work changes the next draft without duplication.
5. The page never calls exposure mastery or confidence evidence.
6. The student can reach the right next action in one click.
7. A no-plan, exhausted-bank, conflicted-week and post-exam account each receive a useful, non-blocking state.
