# Roadmap — Onboarding Fixes and Enhancement Proposal

**Goal:** collect the minimum information needed to create a useful first cycle, without overwhelming the candidate. Every answer must either affect the roadmap, Calendar, paper timing or first-week calibration.

## 1. Recommended flow

Reduce onboarding from six screens to five.

| Step | Route | Ask | Used by |
|---|---|---|---|
| 1. Exam | `/onboarding/exam` | Target 2027 sitting, registered/not yet, exact date only if booked | Roadmap horizon, final-eight-week boundary, countdown |
| 2. Study setup | `/onboarding/route` | Self-study/course/classes/hybrid; class pattern; fixed or next known class times | Topic-order ownership, cycle start/end, paper day, Calendar |
| 3. Starting point | `/onboarding/position` | Broad stage and topic status | First roadmap starting position and first-cycle scope |
| 4. Real week | `/onboarding/week` | Study windows and maximum focused sitting | Safe task placement and task size |
| 5. Review and activate | `/onboarding/plan` | Review assumptions and accept first cycle | Atomic roadmap, cycle and Calendar activation |

Delete the standalone checkpoint screen. It asks no question. Its derived paper-day explanation belongs on the final review.

`/onboarding/checkpoint` should permanently redirect to `/onboarding/plan` so saved links do not break.

---

## 2. Step changes

### Step 1 — Exam

**Keep**

- February, May, August and November exam-window cards.
- Registered versus not registered.
- Exact date only for a booked exam.

**Change**

- Show only exam windows supported by the active curriculum version—currently 2027.
- If unregistered, the selected month is the planning target; do not ask for a tentative exact date.
- If registered, validate that the exact date matches the selected sitting.
- Detect timezone silently and store it as a technical Calendar setting; never present it as an onboarding question.
- When the user changes from registered to not registered, clear the old exact exam date.
- Explain in one sentence: “You can replace the target month with your exact booked date later.”

**Delete**

- “Dates to be confirmed” windows that the planner cannot use.
- Any feasibility verdict or access decision.

### Step 2 — Study setup

**Keep**

- Self-study.
- Self-paced course.
- Live classes.
- Hybrid.
- Fixed, variable and mixed class patterns.

**Change**

- Shorten the choice copy to one line each.
- Do not preselect self-study before the candidate has chosen.
- For fixed classes, collect weekday and start/end time. The class name and end date are optional.
- For mixed classes, collect only the fixed part and explain that one-off classes are added in Calendar.
- For variable classes, offer “Add my next known class” using an actual date and time.
- If no next variable class is known, allow continuation with a visible provisional Monday–Sunday first cycle. The Calendar must ask for the next class before recalculating into a class-led cycle.
- Validate end time after start time and prevent overlapping class entries.
- Show the derived cycle and paper day immediately below the class schedule.

**Delete**

- Repeated class labels unless the user wants to distinguish providers.
- Claims that Roadmap follows a variable class schedule before any class has been entered.

### Step 3 — Starting point

**Keep**

- A broad self-reported starting stage.
- Topic-level context.

**Change**

- Use five stages: `Starting fresh`, `First pass underway`, `Most of first pass complete`, `Revising or taking mocks`, `Retaking`.
- Replace three recency buttons on every topic with a compact topic-status control:
  - `Working on now`
  - `Covered before`
  - unselected means `Not reported`
- Make topic marking optional for `Starting fresh`.
- Require at least one reported topic for revision/mock and retake stages; otherwise the first plan has no credible starting scope.
- Label all answers “Your estimate—tests will update this.”
- Use this data only for roadmap order and initial scope. Never create demonstrated-understanding evidence from it.

**Delete**

- “Halfway” as an unexplained standalone state.
- Copy suggesting Roadmap teaches or re-teaches topics.
- A ten-topic wall with three separate buttons per topic.

### Step 4 — Real week

This is currently the highest-friction screen because it asks candidates to enter fixed commitments and then separately enter every available study window.

**Keep**

- Explicit study windows.
- Maximum focused sitting: 20, 30, 45, 60 or 90 minutes.

**Change**

- Ask one primary question: **“When may Roadmap schedule study?”**
- Provide quick presets: weekday mornings, weekday evenings, weekends, and custom.
- Let the candidate edit the resulting weekly grid.
- Automatically block classes captured in Step 2.
- Treat time outside selected windows as unavailable; this removes the need to describe every work, commute and family commitment.
- Add an optional secondary link: “Show a fixed commitment on my Calendar.” It is not required for planning.
- Replace “I have no time to study at all” with:
  - `My schedule changes every week`; or
  - `I cannot schedule study this week`.
- Those choices do not deny access. They create a setup attention item on Home/Calendar instead of a fabricated plan.
- Validate start before end, overlaps and duplicates.

**Delete**

- Mandatory labels and categories for every non-study commitment.
- The requirement to confirm “I have no commitments.”
- The current long day-by-day empty form as the default experience.
- “Weekly capacity” language that makes availability look like a prescribed study-hours target.

### Step 5 — Review and activate

**Show**

- Exam target and whether the date is exact or tentative.
- Preparation route and class pattern.
- Derived cycle start/end and paper day.
- Starting-position assumptions.
- Selected study windows and maximum sitting length.
- First-cycle Calendar preview: class blocks, study blocks, paper block and any unplaced work.
- A clear label that week one is a baseline-calibration cycle.

**Actions**

- `Edit` links return directly to the relevant step.
- `Accept and open Calendar` performs one atomic activation.
- Retry activation without losing answers or producing duplicate roadmaps/cycles.
- If no window exists, allow setup completion but open Calendar with one next action: add this week’s availability. Do not create fake tasks or a 0% dashboard.

**Delete**

- The separate checkpoint screen.
- The “Roughly X–Y study hours” capacity card.
- Acceptance of an empty plan without explaining why it is empty.

---

## 3. Routes and links

### Authentication and gate

```text
/signup
  → /check-email
  → /auth/confirm or /auth/callback
  → /onboarding

/login
  → incomplete onboarding: /onboarding
  → complete onboarding: requested safe /app/* route or /app

/app/*
  → unauthenticated: /login?next=<safe app route>
  → authenticated but incomplete: /onboarding
```

### Onboarding UI routes

```text
/onboarding             → first incomplete step
/onboarding/exam        → /onboarding/route
/onboarding/route       → /onboarding/position
/onboarding/position    → /onboarding/week
/onboarding/week        → /onboarding/plan
/onboarding/plan        → /app/calendar after acceptance
/onboarding/checkpoint  → permanent redirect to /onboarding/plan
```

Completed users may edit a section through Settings using an allow-listed return path:

```text
/app/settings
  → /onboarding/exam?returnTo=/app/settings
  → /onboarding/route?returnTo=/app/settings
  → /onboarding/position?returnTo=/app/settings
  → /onboarding/week?returnTo=/app/settings
```

Saving in edit mode returns to Settings and generates a **future-plan impact proposal**. It must not force the user through all onboarding steps again or rewrite completed cycles.

### API routes

```text
GET  /api/onboarding/state
POST /api/onboarding/exam
POST /api/onboarding/route
POST /api/onboarding/position
POST /api/onboarding/week
POST /api/onboarding/plan/preview
POST /api/onboarding/plan/confirm
POST /api/activation/recover
```

Retire `/api/onboarding/checkpoint`. Derive the cycle boundary through the same Calendar service whenever class inputs change and again during preview validation.

Add the named onboarding routes to `src/lib/routing/registry.ts`; pages and links should not maintain separate hardcoded route strings.

---

## 4. Required data connections

| Input | Canonical storage | Immediate consumer | Later effect |
|---|---|---|---|
| Exam window | `profiles.exam_window_id` | Roadmap builder | Phase dates, final-eight-week boundary |
| Exact booked date | `profiles.exam_date` | Roadmap and Home | Countdown and final-week boundary |
| Preparation route | `profiles.prep_mode` | Roadmap sequence | Whether classes or Roadmap lead topic order |
| Class pattern | `profiles.class_pattern` | Cycle boundary service | Variable-class attention behavior |
| Fixed classes | `calendar_commitments` | Calendar and cycle resolver | Paper day and study placement |
| Starting stage | `profiles.stage` | Initial roadmap | Baseline scope only |
| Topic status | `user_topic_exposure` with `self_report` source | Initial roadmap | Curriculum position, never test evidence |
| Study windows | `availability_windows` | Weekly composer | Legal placement boundaries |
| Maximum sitting | `profiles.max_session_minutes` | Task splitter | Block duration ceiling |
| Accepted preview | `plan_drafts` + activation transaction | Calendar | Active roadmap, cycle and blocks |

Changing any planning input must increment the context version and invalidate unused previews. Accepted historical cycles remain immutable.

---

## 5. Current defects to fix during this work

1. Changing from registered to unregistered does not clear the old `exam_date`.
2. The exam endpoint trusts the supplied window ID and does not verify that the selected window is supported or consistent with the exact date.
3. Class and study times do not validate `end > start`, overlap or duplicates.
4. Route and week saves archive old rows before inserting replacements without one database transaction; an insertion failure can erase the active setup.
5. `checkpoint` exists only to write derived state and adds an unnecessary page/API.
6. Step completion partly depends on `onboarding_step` while other steps are inferred from data; use one server-derived completion model.
7. Type definitions contain onboarding statuses that the active database constraint does not support.
8. The final preview shows an hours range as “Weekly Capacity,” contrary to the non-prescriptive product direction.
9. Variable-class copy promises a weekly sync flow that is not connected end to end.
10. Settings sends completed users back into the onboarding sequence without a proper edit-and-return mode.
11. The development preview link redirects into authenticated onboarding instead of providing a real isolated demo.
12. Plan generation can show no tasks without giving the user a useful explanation or next action.

---

## 6. Build order

1. **Data safety:** transactional step replacements, validation, stale-value clearing and one completion model.
2. **Five-step routing:** remove checkpoint, add redirects and central route constants.
3. **Simplified UI:** compact Study Setup, topic status and weekly availability controls.
4. **Real preview:** assumptions, derived cycle, paper day, blocks and empty-plan handling.
5. **Settings edit mode:** safe return path and future-plan impact proposal.
6. **Browser verification:** email, Google, refresh/back, each preparation route, mobile layout, activation failure and retry.

---

## 7. Acceptance checklist

- A first-time user can finish setup without typing free-form text.
- No screen asks a question whose answer has no downstream consumer.
- Self-study produces Monday–Saturday study and a Sunday paper.
- Fixed class patterns produce the longest-gap class cycle and pre-class paper day.
- Variable classes never pretend to define a cycle before a class is known.
- Unregistered candidates plan against the selected exam month; registered candidates use the exact date.
- Timezone is captured silently.
- Week one is clearly labelled calibration.
- No onboarding input creates knowledge evidence.
- Activation is atomic and retry-safe.
- Editing setup never changes historical cycles.
- Every route, Back/Continue/Edit link and authentication redirect passes browser E2E on mobile and desktop.

