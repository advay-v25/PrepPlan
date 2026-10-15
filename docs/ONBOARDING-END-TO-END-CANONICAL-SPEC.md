# Roadmap — Canonical End-to-End Onboarding Specification

**Product:** Roadmap Learning Control System  
**Audience:** CFA Level I candidates targeting 2027 onward  
**Status:** Final product and implementation specification  
**Date:** 18 September 2026  
**Owner:** Product, design and engineering  
**Supersedes:** `AUTHENTICATION-AND-ONBOARDING-CONTEXT.md`, `ONBOARDING-V4-AND-PRODUCT-FLOW.md`, `ONBOARDING-OPTIMISATION-SPEC.md`, and `ONBOARDING-FINAL-QUESTIONNAIRE-AND-CLASS-FLOW.md` for all future onboarding decisions.

---

## 1. Purpose

This document is the single source of truth for Roadmap's onboarding. It defines:

- what onboarding must accomplish;
- every user-facing question and conditional branch;
- the exact routes, navigation and access rules;
- what each answer means and where it is stored;
- how each answer changes the roadmap, Calendar, Tests, Coach, Curriculum and Home;
- the first-week preview and confirmation lifecycle;
- validation, recovery, security, accessibility and analytics requirements;
- the distinction between the intended experience and the current implementation;
- the acceptance tests required before onboarding is considered complete.

This is not a feasibility test, an eligibility gate, a readiness verdict or a study-hours questionnaire. It is a mandatory setup flow that gives Roadmap enough truthful context to create the candidate's first roadmap and workable first week.

---

## 2. Product definition

Roadmap does not teach the CFA Level I curriculum from scratch. It helps a candidate answer:

1. What should I work on next?
2. When can it realistically fit?
3. How should I approach the work?
4. What evidence shows whether I understood it?
5. What needs to change after classes, missed work, diagnostics or life disruption?

Onboarding creates the initial conditions for that control loop:

```text
Exam target
    + preparation route
    + present syllabus position
    + protected life/class time
    + realistic study windows
    + session limit
    + weekly boundary
                         ↓
               Long-term roadmap
                         ↓
              Reviewed first week
                         ↓
       Execute → test → analyse → repair
                         ↓
                 Re-plan each week
```

The initial plan is provisional. Diagnostics, completed work and actual behaviour progressively replace self-reported context.

---

## 3. Non-negotiable product rules

### 3.1 Onboarding is a mandatory access gate

- Anonymous visitors cannot access `/app/*`.
- Authenticated users whose onboarding is incomplete cannot access `/app/*`.
- They are redirected to the first incomplete onboarding step.
- The gate checks setup completion only. It must never decide whether a candidate is capable, prepared or worthy of access.
- Every legitimate candidate can complete onboarding.

### 3.2 No feasibility or readiness rejection

Roadmap may surface pressure, limited availability, conflicting commitments or a demanding timeline. It must respond with trade-offs and a workable first draft, never a blocked or rejected state.

### 3.3 The candidate does not choose a weekly hours target

The candidate supplies boundaries:

- unavailable time;
- realistic study windows;
- maximum focused-session length;
- class schedule;
- exam horizon.

Roadmap proposes work inside those boundaries. It may show:

- total usable space;
- proposed study time;
- remaining unallocated capacity;
- movement caused by a new class or disruption.

These are planning outputs, not imposed study-hour quotas.

### 3.4 Self-report is context, not proof

Selecting a topic as studied means only that the candidate has encountered it. Demonstrated understanding comes from valid diagnostic evidence. The interface and database must preserve this distinction.

### 3.5 Time protection is not learning evidence

An upcoming class protects time. A completed class records potential coverage. Neither proves understanding. Only a completed class with confirmed coverage can trigger consolidation or diagnostic eligibility.

### 3.6 No material upload in standard onboarding

Material upload is not required and is not a primary onboarding step. If offered later to premium users, it belongs in source settings and must not block planning. Default curriculum mapping uses Roadmap's verified CFA Level I curriculum registry.

### 3.7 Every answer must have a downstream use

If an answer does not change scheduling, sequencing, diagnostic scope, communication or later workflow, it must not be asked during onboarding.

### 3.8 Meaningful changes require confirmation

Roadmap may propose moves, splits, deferrals and test changes. It must preview material changes before applying them to an accepted week.

---

## 4. Entry, authentication and access flow

### 4.1 Entry routes

| Route | Purpose | Signed-out behaviour | Signed-in behaviour |
|---|---|---|---|
| `/` | Product entry | Show marketing/login entry | Route according to account state |
| `/login` | Existing account sign-in | Email/password and Google | Redirect based on onboarding state |
| `/signup` | Account creation | Create account | Redirect based on onboarding state |
| `/check-email` | Email-verification guidance | Show neutral verification instructions | Continue when session exists |
| `/auth/callback` | OAuth/PKCE callback | Establish session safely | Resolve destination server-side |
| `/auth/confirm` | Email token confirmation | Verify token | Resolve destination server-side |
| `/forgot-password` | Request recovery link | Neutral response | Allowed |
| `/update-password` | Set a new password | Requires recovery session | Update and return to sign-in |
| `/auth/error` | Recoverable auth failure | Explain and offer next action | Explain and offer next action |

### 4.2 Post-authentication routing

After any successful sign-in, the server resolves the destination in this order:

1. If `onboarding_status !== 'complete'`, redirect to `/onboarding`.
2. If onboarding is complete and a safe internal `next` path exists, use it.
3. Otherwise redirect to `/app`.

First-time Google and email users follow the same rule. Google must never bypass context capture.

### 4.3 Protected product routes

The shared `/app` layout must enforce both authentication and onboarding completion. Individual pages may repeat authorization checks for defence in depth but cannot weaken the shared gate.

### 4.4 Safe redirects

- Accept only same-origin paths beginning with one `/`.
- Reject external URLs and protocol-relative paths.
- Do not trust a user-supplied account ID.
- Determine the authenticated user from the server session.

### 4.5 Onboarding state machine

```text
not_started
    ↓ first successful step save
in_progress ─── sign out / close / lose connection ───┐
    ↓                                                  │
review_ready                                           │
    ↓ atomic confirmation                              │
complete ←─────────────────────────────────────────────┘ resume at first incomplete step
```

Recommended states:

- `not_started`: no onboarding answer has been saved;
- `in_progress`: at least one step is saved;
- `review_ready`: every required answer is valid and the preview can be generated;
- `complete`: setup, roadmap and first accepted week were committed successfully.

`complete` must not be set if roadmap or first-week creation fails.

---

## 5. Canonical route map

### 5.1 User-facing routes

| Order | Route | Screen | Required? | Primary output |
|---:|---|---|---|---|
| Entry | `/onboarding` | Resume resolver | — | Redirect to first incomplete step |
| 1 | `/onboarding/exam` | Exam target | Yes | Exam horizon |
| 2 | `/onboarding/route` | Preparation route and class pattern | Yes | Sequencing ownership and class anchors |
| 3 | `/onboarding/position` | Current syllabus position | Yes | Self-reported starting context |
| 4 | `/onboarding/week` | Constraints and realistic windows | Yes | Legal scheduling surface |
| 5 | `/onboarding/checkpoint` | Weekly boundary | Yes | Review/test rollover day |
| 6 | `/onboarding/plan` | Review and first-week preview | Yes | Confirmed setup, roadmap and week |

### 5.2 Server endpoints

| Endpoint | Method | Responsibility |
|---|---|---|
| `/api/onboarding/exam` | `GET/POST` | Read state; validate and save exam target |
| `/api/onboarding/route` | `GET/POST` | Save preparation route, class pattern and fixed schedules |
| `/api/onboarding/position` | `GET/POST` | Save starting stage and self-reported topic exposure |
| `/api/onboarding/week` | `GET/POST` | Save commitments, available windows and sitting limit |
| `/api/onboarding/checkpoint` | `GET/POST` | Save study-week closing day |
| `/api/onboarding/plan` | `GET` | Produce review read model and deterministic preview |
| `/api/onboarding/plan` | `POST` | Atomically confirm setup, roadmap and first week |

The existing dynamic `/api/onboarding/[step]` implementation may remain internally, but its contracts must match these responsibilities.

### 5.3 Deep links and navigation

- Each step has a stable URL.
- Browser Back and Forward must work naturally.
- Refresh preserves answers already saved.
- The progress rail links only to completed steps and the current permitted step.
- Users may go backward and edit prior answers.
- Users may not jump forward past missing required answers.
- Editing an earlier answer invalidates and regenerates dependent preview data.
- The onboarding brand link must not navigate an incomplete user into `/app`; it should return to `/onboarding` or show a safe sign-out option.

---

## 6. Global onboarding experience

### 6.1 Shell

Every screen contains:

- Roadmap identity;
- “Step X of 6”;
- a short title explaining why the step matters;
- a compact progress indicator;
- the current question area;
- Back and Continue actions;
- saved/saving/error feedback;
- a sign-out action.

Desktop may use a left progress rail. Mobile uses a compact top progress bar or horizontally scrollable labelled steps.

### 6.2 Interaction principles

- Prefer cards, chips, date/time controls and structured choices over text fields.
- Use progressive disclosure for conditional questions.
- Do not rely on placeholders as labels.
- Validate a field on blur or immediately after a choice makes it evaluable.
- Put the error beside the affected input and summarize it near the Continue action.
- Preserve entered values after errors.
- Disable Continue only when the reason is visible.
- Use a loading state during save and prevent duplicate submissions.
- Autosave completed steps server-side; local storage may only be a temporary resilience layer.

### 6.3 Required versus optional

The setup is mandatory, but not every conditional field is. Required questions cannot have “Skip this.” Optional details can have “Not now” or remain collapsed.

### 6.4 Responsive and accessible behaviour

- Minimum interactive target: 44 by 44 pixels.
- Full keyboard navigation and visible focus indicators.
- Semantic headings, fieldsets and legends.
- `aria-current="step"` on the active step.
- `aria-live` for save and error status.
- Contrast of at least 4.5:1 for body text.
- Do not use colour alone for selected, error or completion states.
- Respect reduced-motion preferences.
- No horizontal page overflow at 320px width.

### 6.5 Copy style

Copy must be direct, calm and operational. Avoid:

- moral language about discipline;
- readiness verdicts;
- claims that a plan guarantees passing;
- false certainty around unofficial exam dates;
- calling every plan “personalised” before there is evidence;
- implying reminders exist before notification delivery is operational.

---

## 7. Step 1 — Exam target

**Route:** `/onboarding/exam`  
**Purpose:** Establish the planning horizon without fabricating an exact date.

### Question 1: Which CFA Level I sitting are you aiming for?

**Control:** Year selector plus four sitting cards:

- February [year]
- May [year]
- August [year]
- November [year]

**Required:** Yes.  
**Validation:** Must reference an active supported exam-window record.  
**Downstream effects:**

- long-term roadmap horizon;
- learning, revision and final-practice phase boundaries;
- provisional first-pass completion range;
- exam countdown on Home and Curriculum;
- urgency input for weekly planning.

Exam windows should come from the database, not hardcoded client copy. Unconfirmed dates must be labelled indicative.

### Question 2: Have you registered and booked your exam?

**Control:** Two cards:

- Yes, I have booked it
- Not yet

**Required:** Yes.  
**Downstream effects:** Determines whether the roadmap uses a booked appointment date or only the selected sitting horizon.

### Question 3: What is your booked exam date?

**Shown only when:** Registered is Yes.  
**Control:** Date picker.  
**Required:** Yes for registered users.  
**Validation:** Must be a real future date reasonably associated with the selected sitting. If outside the stored window, allow it with an explicit confirmation rather than silently rejecting a valid booking.  
**Downstream effects:** Refines countdowns, roadmap phase dates and final-practice cutoff.

For an unregistered candidate, Roadmap uses the selected month/year as the tentative target. It never invents an exact appointment date. Settings must later offer “I have now booked my exam” and recalculate affected dates after confirmation.

### Timezone

Timezone is detected from the device and stored silently. Only show a correction control if detection fails or produces an unsupported value. Timezone is operational metadata, not an onboarding question.

### Data contract

```ts
type ExamSetup = {
  examWindowId: string
  registered: boolean
  bookedExamDate: string | null // required when registered
  timezone: string
}
```

### Connections

- **Home:** countdown, current phase and next milestone.
- **Calendar:** date boundaries and exam-week protection.
- **Curriculum:** projected topic completion path.
- **Tests:** mock and final-check period scheduling.
- **Coach:** timeline-aware analysis without pass/fail predictions.
- **Settings:** editable registration and exact-date status.

---

## 8. Step 2 — Preparation route and classes

**Route:** `/onboarding/route`  
**Purpose:** Determine who sets syllabus order and how class time enters the Calendar.

### Question 4: How are you preparing for Level I?

**Control:** Four cards:

- Studying on my own
- Following a self-paced or recorded course
- Attending live classes
- Live classes plus my own study

**Required:** Yes.

**Planning meaning:**

| Choice | Curriculum sequencing owner | Calendar effect |
|---|---|---|
| Self-study | Roadmap proposes sequence | Study tasks are primary anchors |
| Self-paced course | Roadmap proposes sequence; course is a source | Candidate logs completed coverage |
| Live classes | Class coverage leads near-term sequence | Classes are protected anchors |
| Hybrid | Classes lead covered topics; Roadmap fills gaps | Both class and self-study blocks |

### Question 5: How predictable is your live-class timetable?

**Shown only for:** Live classes or hybrid.  
**Control:** Three cards:

- Fixed every week
- Changes week to week
- Some fixed, some changing

**Required:** Yes for class-led routes.  
**Downstream effects:** Selects recurring-class capture, weekly class sync or both.

### Question 6: When are your fixed classes?

**Shown only for:** Fixed or mixed pattern.  
**Control:** Repeatable class-series cards with:

- weekday multi-select;
- start time;
- end time;
- optional known end date;
- “same time on multiple days” shortcut;
- “add another class time.”

**Required:** At least one series for Fixed. Mixed candidates must enter the fixed portion if one exists.  
**Validation:** End must follow start; duplicates are merged; overlapping class series require confirmation.  
**Downstream effects:** Creates protected recurring class commitments and removes those periods from study placement.

### Changing schedules

Changing class times are not invented during onboarding. Show this confirmation:

> Add each week's classes from Calendar. Roadmap will protect the time and show how the rest of the week should change.

Do not ask for provider name or material upload.

### Data contract

```ts
type PreparationSetup = {
  prepMode: 'self_study' | 'self_paced_course' | 'instructor_led' | 'hybrid'
  classPattern: 'none' | 'fixed' | 'variable' | 'mixed'
  recurringClasses: Array<{
    weekdays: number[] // canonical 0–6 representation
    startTime: string
    endTime: string
    endsOn: string | null
  }>
}
```

### Connections

- **Calendar:** recurring protected commitments and weekly class-sync prompt.
- **Home:** prompt to add variable classes and surface the next class.
- **Curriculum:** class-led ordering when applicable.
- **Tests:** diagnostic scope follows confirmed coverage, not merely scheduled classes.
- **Coach:** explains schedule pressure and proposes changes after new class information.
- **Settings:** change route, class pattern and recurring schedule.

---

## 9. Step 3 — Current syllabus position

**Route:** `/onboarding/position`  
**Purpose:** Avoid treating every user as a blank slate while keeping self-report separate from evidence.

### Question 7: Where are you currently in your preparation?

**Control:** Six cards:

- I have not started
- I started recently
- I am partway through the syllabus
- I have covered most topics and am revising
- I am returning after a break
- I am retaking Level I

**Required:** Yes.  
**Downstream effects:** Sets the initial roadmap phase, default coverage selection and appropriate first diagnostic type.

### Question 8: Which topics have you already touched?

**Shown when:** Stage is not “I have not started.”  
**Control:** Multi-select cards for the ten CFA Level I topic areas.  
**Required:** At least one unless the user goes back and chooses Not started.  
**Downstream effects:** Creates self-reported exposure records and candidate scope for baseline diagnostics.

### Question 9: How recently did you work on these topics?

**Shown when:** At least one topic is selected.  
**Control:** Batch choice with optional per-topic adjustment:

- Working on them now
- Covered recently
- Covered a while ago

**Required:** Yes when topics are selected.  
**Downstream effects:** Influences review priority and decay assumptions. It does not mark a topic mastered.

### Explicit exclusions

Do not ask during onboarding:

- degree or profession;
- English background;
- mathematics confidence;
- generic subject-confidence ratings;
- exact prior-attempt count;
- expected score;
- readiness percentage.

### Data contract

```ts
type PositionSetup = {
  stage: 'not_started' | 'recent_start' | 'partway' | 'revision' | 'returning' | 'retaking'
  topicExposure: Array<{
    topicId: string
    recency: 'current' | 'recent' | 'stale'
    source: 'self_report'
  }>
}
```

### Connections

- **Curriculum:** initial exposure state; never verified state.
- **Tests:** baseline diagnostic candidates and unseen-item requirements.
- **Calendar:** initial consolidation versus advancement balance.
- **Home:** current starting milestone.
- **Coach:** can compare claimed exposure with later demonstrated evidence.

---

## 10. Step 4 — The candidate's real week

**Route:** `/onboarding/week`  
**Purpose:** Establish where study may and may not be placed without asking the candidate to prescribe total hours.

### Question 10: What time is normally fixed or unavailable for study?

**Control:** Add-from-preset commitment cards:

- Work or college
- Commute
- Exercise or sport
- Family or personal time
- Regular appointment
- Other

For each commitment:

- weekday multi-select;
- start time;
- end time;
- custom label only for Other;
- optional known end date where relevant.

Classes from Step 2 appear read-only in this view and cannot be double-entered.

**Required:** Candidate must add at least one commitment or explicitly select “I have no other fixed commitments.”  
**Downstream effects:** Creates protected Calendar time that automated planning cannot overwrite.

### Question 11: Which remaining windows could you realistically use for study?

**Control:** Weekly grid generated after subtracting classes and commitments. The user selects plausible gaps; proposed exact boundaries can be adjusted.

**Required:** At least one usable window.  
**Downstream effects:** Defines the legal placement surface and maximum capacity boundary.

Display:

> Roadmap found [n] possible planning windows, with approximately [range] hours of space. This is a ceiling, not a requirement.

If no windows remain, do not reject access. Ask the candidate to edit constraints or create a floating-task-only first week and clearly explain that timed placement is unavailable until a window is added.

### Question 12: What is the longest focused sitting you can usually complete?

**Control:** Choice chips:

- 20 minutes
- 30 minutes
- 45 minutes
- 60 minutes
- 90 minutes

**Required:** Yes.  
**Downstream effects:** Splits work into realistic blocks; it does not determine total weekly study time.

### Availability semantics

- A selected window means “Roadmap may propose work here.”
- It does not mean every minute must be filled.
- Protected commitments win over study blocks.
- Accepted timed work cannot overlap protected commitments.
- Floating tasks may exist when exact placement is not possible.

### Data contract

```ts
type WeekSetup = {
  noOtherCommitments: boolean
  commitments: Array<{
    kind: 'work' | 'college' | 'commute' | 'exercise' | 'family' | 'appointment' | 'other'
    label: string | null
    weekdays: number[]
    startTime: string
    endTime: string
    endsOn: string | null
  }>
  availableWindows: Array<{
    weekday: number
    startTime: string
    endTime: string
  }>
  maxSessionMinutes: 20 | 30 | 45 | 60 | 90
}
```

### Connections

- **Calendar:** protected commitments, available placement windows and block length.
- **Home:** today's feasible next action.
- **Roadmap:** does not change total curriculum demand, but changes achievable pacing.
- **Tests:** controls when a diagnostic can fit; never fabricates item availability.
- **Coach:** proposes realistic trade-offs when planned work exceeds space.

---

## 11. Step 5 — Weekly checkpoint

**Route:** `/onboarding/checkpoint`  
**Purpose:** Establish the candidate's recurring study-week boundary.

### Question 13: Which day should close your study week?

**Control:** Seven weekday chips. Roadmap recommends a day based on classes and available windows but allows any choice.  
**Required:** Yes.  
**Downstream effects:** Defines:

- the start and end of a planning cycle;
- the usual weekly review point;
- when eligible cumulative diagnostics are considered;
- whether a finding belongs to the current or next week's repair work;
- weekly reporting boundaries.

Supporting copy:

> Roadmap will normally review the week and place an eligible cumulative diagnostic around this boundary. Findings from the closing day shape the next week.

### Explicit exclusions

- Do not ask for a reminder time until notification delivery works.
- Do not ask “what usually breaks your plan?” during onboarding. Learn this from actual missed, moved and completed work, then discuss it during a later weekly review.
- Do not promise that every checkpoint contains a diagnostic. It depends on covered scope and sufficient valid items.

### Data contract

```ts
type CheckpointSetup = {
  weekClosingDay: number // canonical 0–6
}
```

### Connections

- **Calendar:** planning-cycle boundary.
- **Tests:** ordinary cumulative diagnostic target day.
- **Home:** next weekly review countdown.
- **Coach:** evidence summary and next-week proposal.
- **Analytics:** consistent weekly aggregation.

---

## 12. Step 6 — Review, roadmap and first week

**Route:** `/onboarding/plan`  
**Purpose:** Show the exact consequences of the setup before committing the candidate to a plan.

### Question 14: Does this accurately reflect your current situation?

**Control:** Review cards with deep links back to each relevant step.

Cards show:

- exam sitting;
- registration status and exact date when booked;
- preparation route;
- fixed/variable class pattern;
- recurring class schedule;
- present preparation stage;
- topic exposure and recency;
- protected commitments;
- usable study windows;
- maximum sitting length;
- study-week closing day.

### Required preview

Before confirmation, show:

1. **Long-term direction**
   - phase sequence;
   - provisional first-pass completion range;
   - revision and final-practice reservation;
   - current milestone.
2. **First study week**
   - cycle dates;
   - protected classes and commitments;
   - proposed timed study blocks;
   - floating work where placement is uncertain;
   - purpose and suggested approach for each study block;
   - total proposed study time versus available ceiling.
3. **Testing**
   - eligible first diagnostic, scope and placement; or
   - a clear reason no diagnostic is yet appropriate.
4. **Assumptions and conflicts**
   - indicative exam date;
   - unsupported curriculum slice;
   - insufficient question-bank coverage;
   - scheduling conflicts;
   - unplaced work.

### User controls

- Change any setup section.
- Make the week lighter.
- Use more available space.
- Move an individual block.
- Keep a task floating.
- Regenerate the preview from the amended constraints.

These edits affect the first draft only. Future adaptation should learn from completion evidence rather than permanently treating a one-time preference as capacity truth.

### Final action

**Button:** `Confirm setup and open my week`

The button must not say “Start studying” because the action is confirming a planning setup, not beginning curriculum instruction.

### Atomic completion transaction

The server must:

1. revalidate the authenticated session;
2. revalidate every required onboarding field;
3. lock or idempotently identify the user's active setup version;
4. persist the final setup snapshot;
5. create or activate exactly one roadmap version;
6. create exactly one initial planning cycle;
7. persist exactly the plan blocks shown in the preview;
8. set onboarding status to Complete;
9. emit an onboarding-completed event;
10. return `/app` as the destination.

If any required write fails, the transaction rolls back and onboarding stays incomplete. Repeated submission must return the existing completed result rather than duplicate the roadmap, cycle or tasks.

---

## 13. Complete questionnaire and branching count

| # | Question | Required | Conditional |
|---:|---|---|---|
| 1 | Which sitting are you aiming for? | Yes | No |
| 2 | Have you registered and booked? | Yes | No |
| 3 | What is your booked exam date? | Yes | Registered only |
| 4 | How are you preparing? | Yes | No |
| 5 | How predictable is your live timetable? | Yes | Live/hybrid only |
| 6 | When are your fixed classes? | Yes | Fixed/mixed only |
| 7 | Where are you in preparation? | Yes | No |
| 8 | Which topics have you touched? | Yes | If started |
| 9 | How recently did you work on them? | Yes | If topics selected |
| 10 | What time is fixed or unavailable? | Explicit answer | No |
| 11 | Which remaining windows are realistic? | Yes | No |
| 12 | Longest focused sitting? | Yes | No |
| 13 | Which day closes your study week? | Yes | No |
| 14 | Does the reviewed setup reflect reality? | Yes | No |

Typical decision counts:

- Fresh self-study candidate: 9.
- Registered self-study candidate with prior coverage: 12.
- Fixed live-class candidate: 11–14.
- Variable live-class candidate: 10–13.

Most decisions are taps, not typed answers.

---

## 14. Calendar class workflow after onboarding

This workflow is part of the onboarding contract because it is the continuing mechanism for candidates whose class timetable changes.

### 14.1 Persistent Calendar action

Calendar provides **Add class** with two modes:

#### Upcoming class

Fields:

- date;
- start and end time;
- topic/module, optional;
- repeat weekly toggle;
- copy last class;
- optional note under More details.

Effects:

1. Create a protected commitment.
2. Recalculate usable windows.
3. Identify conflicting study blocks.
4. Create a proposal showing moved, split, floated or deferred work.
5. Recalculate proposed study time and free capacity.
6. Do not count the class as completed coverage.
7. Apply the proposal only after acceptance.

#### Completed class

Fields:

- actual date and time;
- topic/module covered;
- optional learning-module/LOS confirmation;
- optional note.

Effects:

1. Create a completed learning activity.
2. Create self-reported coverage evidence, not mastery evidence.
3. Propose consolidation or retrieval work.
4. Reassess diagnostic eligibility and question-bank sufficiency.
5. Show any remaining-week changes for confirmation.

### 14.2 Weekly class sync

At the start of a new week, variable or mixed class users see a non-blocking prompt:

> Add this week's classes so Roadmap can protect them before placing study work.

Actions:

- Add a class
- Copy last week
- No classes this week
- I will add them later

“I will add them later” keeps access but marks the plan as awaiting class information. “No classes this week” suppresses the prompt for that cycle.

### 14.3 What must never happen

- Adding a class must not silently mark a topic complete.
- Logging a class must not silently rewrite accepted study blocks.
- A scheduled class must not automatically create a diagnostic.
- A diagnostic must not be scheduled if valid item-bank coverage is insufficient.
- The system must not increase a mandatory hours target because a class was added.

---

## 15. Cross-product connections

### Home `/app`

Receives:

- current phase and milestone;
- today's next accepted action;
- exam countdown;
- upcoming class;
- class-sync prompt where applicable;
- weekly review status;
- attention items such as conflicts or unplaced work.

Home must not duplicate onboarding questions. It prompts only for newly missing operational context.

### Calendar `/app/calendar`

Receives:

- recurring classes;
- protected life commitments;
- available placement windows;
- session-length constraint;
- first accepted study week;
- study-week boundaries.

Calendar becomes the primary place to add changing classes, adjust availability and review re-planning proposals.

### Curriculum `/app/curriculum`

Receives:

- exam horizon;
- sequencing ownership;
- starting phase;
- self-reported exposure;
- active roadmap and first milestone.

Curriculum must visibly distinguish Not started, Exposed, In progress, Tested and Demonstrated states.

### Tests `/app/tests`

Receives:

- eligible scope from confirmed learning coverage;
- checkpoint boundary;
- initial baseline candidate scope;
- roadmap phase.

The Tests system returns demonstrated evidence, misses, confidence calibration and repair proposals. It does not overwrite self-report without preserving provenance.

### Coach `/app/coach`

Receives the operating state derived from onboarding and later evidence. It may:

- explain why a task is next;
- summarize progress and risk;
- propose calendar changes;
- point to the relevant curriculum source/LOS;
- analyse diagnostic patterns;
- help recover a disrupted week.

It may not teach an entire subject or silently execute material schedule changes.

### Settings `/app/settings`

Contains editable setup sections:

- exam target and registration;
- preparation route;
- recurring classes and class pattern;
- weekly constraints and availability;
- maximum session length;
- weekly closing day;
- timezone correction;
- account and privacy controls.

Changes that affect an accepted week create a previewable proposal. Past cycles and evidence remain immutable.

---

## 16. Data ownership and persistence

### 16.1 Canonical entities

| Entity | Owns | Must not own |
|---|---|---|
| `profiles` | Onboarding status, current setup preferences, timezone | Historical snapshots or diagnostic evidence |
| `exam_windows` | Supported sitting metadata | User appointment date |
| `exam_attempts` or active exam target | User target, registration and booked date | Mandatory prescribed weekly hours |
| `onboarding_sessions` | Versioned answer snapshot and completion audit | Live operational state |
| `availability_rules` | Legal recurring study windows | Planned tasks |
| `calendar_commitments` | Classes and protected life commitments | Understanding/mastery |
| `user_module_state` | Exposure/coverage with provenance | Raw diagnostic attempt history |
| `roadmaps` and milestones | Long-term sequence and projections | Accepted daily task state |
| `planning_cycles` | Weekly boundary and revision lifecycle | Curriculum truth |
| `plan_blocks` | Concrete timed/floating work | Source documents |
| `diagnostic_attempts/evidence_events` | Demonstrated evidence | Self-reported exposure |

### 16.2 Required schema additions or confirmations

The final specification requires:

- a persisted booked exam date separate from exam-window metadata;
- a persisted `class_pattern`;
- recurring classes supporting multiple weekdays and an optional end date;
- one canonical weekday representation across all onboarding and planning tables;
- onboarding status capable of `review_ready` or an equivalent derived state;
- versioned preview/draft identity so accepted blocks exactly match the review;
- idempotency protection on onboarding completion;
- provenance on topic state (`self_report`, `class_log`, `diagnostic`, etc.).

### 16.3 Write rules

- Each step is safe to resubmit.
- Server validation is authoritative.
- The server uses the authenticated user ID.
- Replacing recurring onboarding commitments must be transactional or versioned.
- Editing a step cannot delete unrelated calendar records.
- Completion writes are atomic.
- Historical diagnostics and completed cycles are never rewritten by onboarding edits.

---

## 17. Planning logic initiated by onboarding

### 17.1 Long-term roadmap

The roadmap uses:

- exam horizon;
- curriculum graph and topic weights;
- preparation route;
- class-led versus Roadmap-led sequencing;
- self-reported exposure;
- reserved revision and mock period.

For a self-study candidate with sufficient runway, the provisional default may aim to complete first coverage before the final two months, leaving the remaining period for consolidation, mocks and final checks. This is a projection, not a promise. Shorter horizons compress phases instead of denying access.

### 17.2 First-week composition

The deterministic composer must:

1. establish the cycle from the chosen closing day;
2. expand recurring classes and commitments into the week;
3. calculate legal gaps from availability;
4. choose work aligned with the active milestone;
5. split work by maximum session length;
6. preserve setup, consolidation, practice and diagnostic dependencies;
7. place only what fits without overlap;
8. keep excess or uncertain work floating or deferred with a reason;
9. attach learning objective, suggested approach and verification intent;
10. include a diagnostic only when coverage and bank sufficiency allow it.

### 17.3 Initial fill level

The composer may use a conservative seed fill ratio for the first draft, but it must be:

- stored as a draft parameter, not a fixed truth about the candidate;
- adjustable through Make it lighter/Use more space;
- updated later from actual completion evidence;
- distinct from total available time;
- never labelled required weekly hours.

---

## 18. Validation and edge cases

### Exam

- No active windows: explain the data issue and provide a supported tentative-window fallback; do not silently complete with no target.
- Unconfirmed official dates: show month/year and “indicative,” not a fabricated appointment date.
- Registered without date: block Continue with an inline error.
- Date outside selected window: ask for confirmation and retain the booked date.

### Classes

- Fixed route without a class: block Continue.
- Variable route without times: valid.
- Overlapping recurring classes: warn and require confirmation.
- Class crosses midnight: split into two commitments or reject with a clear explanation in MVP.

### Week

- No other commitments: must be explicitly confirmed.
- No usable study window: offer Edit constraints or Continue with floating work; never deny access.
- Availability overlaps a protected commitment: subtract it and explain why.
- Very short fragments below session length: keep unavailable unless the candidate lowers the sitting length or a supported micro-task exists.

### Position

- Not started plus selected topics: resolve the contradiction before saving.
- Topic records unavailable: show retryable error; do not save meaningless free-text labels.

### Completion

- Preview becomes stale after an upstream edit: invalidate it and require regeneration.
- Double click or network retry: return the same completion result.
- Roadmap generation fails: retain answers, stay on Review and offer Retry.
- First-week persistence fails: do not mark onboarding complete.

---

## 19. Error, offline and recovery experience

- Saved steps survive refresh, sign-out and device return.
- `/onboarding` always resumes at the first incomplete required step.
- A network error says that the current change was not saved.
- A successful retry must not duplicate commitments or plans.
- If a server answer differs from stale browser state, server state wins and the user is told the form was refreshed.
- A session expiry redirects to `/login?next=<current onboarding route>` and returns the user afterward.
- Errors include a retry action and, where safe, a route back to the affected step.

---

## 20. Security and privacy

- Enforce row-level security for all user-owned records.
- Use server session identity for every write.
- Validate enum values, IDs, times, dates, array sizes and string lengths server-side.
- Prevent open redirects in auth callbacks.
- Rate-limit repeated mutation and completion requests.
- Do not log free-form private notes or tokens to analytics.
- Do not expose service-role credentials to the browser.
- Audit completion, major setup edits and class-plan proposal acceptance.
- Keep terms, privacy and CFA non-affiliation disclosures available before signup.
- Treat later imported materials as untrusted content and separate them from system instructions.

---

## 21. Analytics and product learning

Track privacy-conscious events:

- `onboarding_started`
- `onboarding_step_viewed`
- `onboarding_step_saved`
- `onboarding_validation_failed`
- `onboarding_resumed`
- `onboarding_preview_generated`
- `onboarding_preview_adjusted`
- `onboarding_completed`
- `onboarding_abandoned`
- `class_pattern_selected`
- `weekly_class_sync_completed`
- `class_logged`
- `class_change_proposal_accepted`

Recommended properties:

- step name;
- route type;
- class pattern;
- registered/not registered;
- number of commitments/windows, never their labels;
- time to complete;
- device class;
- error category;
- preview adjustment type.

Do not send exact schedules, notes, email addresses or diagnostic answers to general product analytics.

Primary onboarding metrics:

- completion rate by step;
- median completion time;
- validation-error rate;
- resume success rate;
- preview acceptance versus adjustment;
- first-week task engagement;
- percentage of variable-class users completing weekly sync.

---

## 22. Current-build reconciliation

The live code is directionally aligned but does not yet satisfy this specification.

| Area | Current behaviour | Required correction |
|---|---|---|
| Access gate | `/app` layout checks `onboarding_status` | Keep; remove any page-level bypasses |
| Step routes | Six stable routes exist | Keep |
| Skip behaviour | Most steps expose “Skip this”; shell says every answer is optional | Remove skip for required answers; correct copy |
| Exam | Window and registration stored | Add booked exact date; no completion without a target |
| Timezone | Detected automatically | Keep; expose correction only on failure/Settings |
| Preparation route | Four modes exist | Add persisted class pattern |
| Fixed classes | Individual weekday slots are stored | Support grouped recurring series and optional end date |
| Variable classes | Not represented in onboarding state | Add variable/mixed state and Calendar weekly sync |
| Position | Current code stores stage, background and prior attempts | Replace background/prior-attempt questions with final six-stage and recency model |
| Availability | Day-part grid and commitments exist | Ensure commitments are collected first and legal gaps are derived |
| Checkpoint | Day, reminder time and failure mode are asked | Keep day; remove reminder and failure-mode questions for now |
| Review | Shows summary and generates roadmap | Add exact first-week preview and adjustment controls |
| Completion | Marks complete, then generates roadmap; missing roadmap can still pass | Make roadmap + cycle + exact preview acceptance atomic |
| Redirect | Completion currently goes to Calendar | Canonical destination is action-first Home `/app` |
| Legacy context | `study-context.ts` still contains old materials/scheduling concepts | Retire from canonical onboarding path or provide a one-way migration adapter |
| Weekday conventions | Historical 0–6 and 1–7 conflict exists | Enforce one canonical representation end to end |

This section is not permission to preserve obsolete behaviour. Where code and this specification conflict, this specification governs the rebuild.

---

## 23. Implementation sequence

### Slice 1 — Contracts and database truth

- Finalize payload schemas.
- Add booked exam date and class pattern.
- Normalize weekday semantics.
- Add idempotent setup/preview versioning.
- Define atomic completion function.

### Slice 2 — Access, resume and validation

- Enforce onboarding gate.
- Resolve first incomplete step server-side.
- Remove required-step skipping.
- Add per-step server validation and recovery.

### Slice 3 — Exam, route and position

- Implement final questions and conditional branches.
- Persist recurring and variable class models.
- Preserve self-report provenance.

### Slice 4 — Week and checkpoint

- Build commitment-first availability capture.
- Derive legal gaps.
- Store maximum sitting length and week boundary.
- Remove premature reminder/failure questions.

### Slice 5 — Preview and atomic completion

- Generate roadmap preview.
- Generate deterministic first-week draft.
- Add lighter/more-space and move/floating controls.
- Commit exactly the reviewed version atomically.

### Slice 6 — Product connections

- Home next action and class-sync prompt.
- Calendar class logging and change proposals.
- Curriculum exposure states.
- Test eligibility.
- Coach operating context.
- Settings editing with downstream previews.

### Slice 7 — End-to-end quality

- Automated unit, integration and browser tests.
- Mobile, keyboard and screen-reader QA.
- Retry/idempotency testing.
- Analytics verification.
- Empty, loading, error and stale-preview states.

---

## 24. Acceptance criteria

Onboarding is ready only when all of the following are true:

### Access and routing

- Anonymous users are redirected to login.
- Authenticated incomplete users cannot open any `/app/*` route.
- Complete users cannot accidentally re-enter onboarding from `/onboarding`.
- Resume returns to the first incomplete required step.
- Back, Forward, refresh and deep links behave predictably.

### Questions and persistence

- Every required and conditional question follows this specification.
- No excluded question remains in the main flow.
- Each saved answer survives refresh.
- Editing an earlier step updates dependent review data.
- No answer is stored only in browser memory.

### Planning output

- An unregistered candidate receives a roadmap based on the selected sitting month.
- A registered candidate's exact date drives the countdown.
- The preview contains a roadmap and first week.
- No timed block overlaps a protected commitment.
- No block exceeds maximum sitting length.
- Proposed time is not presented as mandatory hours.
- The accepted week exactly matches the reviewed preview.

### Classes

- Fixed classes recur correctly.
- Variable-class users can finish onboarding without invented times.
- Calendar can add upcoming and completed classes.
- Adding a class creates a change proposal rather than silently rewriting the week.
- Scheduled class time does not count as completed coverage.

### Diagnostics

- Self-report never becomes verified understanding.
- A diagnostic is proposed only for covered scope with sufficient valid items.
- Test timing respects the weekly boundary and Calendar constraints.

### Reliability and security

- Completion is atomic and idempotent.
- Double submission creates no duplicates.
- Session expiry returns the user to the correct step after login.
- Server-side validation rejects malformed payloads.
- User-owned data cannot be read or mutated by another user.
- No hydration error, console error or blocking overlay appears in browser tests.

### Experience

- A fresh self-study candidate can complete onboarding in roughly three minutes.
- Most interactions are selections rather than typing.
- Mobile works at 320px without horizontal overflow.
- Keyboard-only completion is possible.
- Errors are actionable and preserve entered data.

---

## 25. Canonical completion definition

Onboarding is complete only when Roadmap has:

- a valid intended exam sitting;
- registration status and booked date when applicable;
- a preparation route;
- class pattern and fixed schedule where applicable;
- a current preparation stage;
- self-reported topic exposure where applicable;
- an explicit answer about fixed commitments;
- at least one usable window, or an explicitly acknowledged floating-only exception;
- maximum focused-session length;
- a weekly closing day;
- a generated roadmap;
- a reviewed and accepted first-week plan;
- a successful atomic completion record.

No readiness score, background answer, feasibility formula or diagnostic result can deny completion. After confirmation, the candidate enters Home with a real next action and a week that can begin immediately.
