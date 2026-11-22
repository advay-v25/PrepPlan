# Roadmap — Onboarding Optimisation Specification

**Date:** 18 September 2026  
**Status:** Proposed refinement of the current six-step system  
**Goal:** Collect the minimum context required to build a credible CFA Level I roadmap and first study week, using taps, presets and conditional controls rather than writing.

---

## 1. Product decision

The existing six-step structure is fundamentally sound. It should be refined, not discarded.

The optimisation test for every input is:

> Does this answer change the exam horizon, curriculum sequence, weekly placement, task sizing, accountability boundary, or first diagnostic scope?

If not, the question does not belong in onboarding. It can be removed, inferred, or deferred to Settings, Coach, Log Learning, or the first weekly review.

Onboarding remains a mandatory access gate. It is not an eligibility assessment: every authenticated user can complete it and enter the app.

---

## 2. Optimised flow

Keep the six existing routes so saved links, progress and implementation remain stable:

1. `/onboarding/exam` — Exam timing
2. `/onboarding/route` — Study route and classes
3. `/onboarding/position` — Current syllabus position
4. `/onboarding/week` — Real-life constraints and usable study windows
5. `/onboarding/checkpoint` — Weekly accountability boundary
6. `/onboarding/plan` — Review, roadmap and first-week confirmation

The flow should feel shorter because most users see fewer conditional controls, not because the system collects less useful planning context.

---

## 3. Step 1 — Exam timing

### Primary question

When is the candidate sitting CFA Level I?

### Interaction

1. Select year.
2. Select one of four sittings: February, May, August or November.
3. Select registration state:
   - Registered / booked;
   - Not registered yet.
4. Show the exact-date control only after the candidate says they are registered.

### Exact-date behaviour

The system needs two distinct levels of precision:

- `exam_window_id`: the intended CFA sitting, such as August 2027, used for the provisional roadmap before registration;
- `booked_exam_date`: the candidate's exact appointment date, stored only after registration.

Required behaviour:

- If registered/booked, ask for the actual scheduled exam date.
- If not registered, do not ask for or invent an exact date. Build the roadmap against the selected sitting month and its official/indicative window.
- When the candidate registers later, Settings asks for the booked date and previews any resulting phase or weekly-plan shift before applying it.
- When official sitting-window information changes, update the month-level horizon for unregistered candidates and explain any material roadmap movement.

### No typing

- Month/year are cards.
- Registration is a two-card choice.
- Exact date is a date picker.
- Timezone is detected silently and editable later in Settings.

### Product effects

| Input | Effect |
|---|---|
| Sitting | Selects curriculum horizon and official exam window |
| Booked date, when registered | Refines countdown, phase boundaries and final-preparation cutoff |
| Registration state | Determines whether planning uses the sitting window or the exact appointment |
| Timezone | Defines local calendar days and reminders |

### Remove

- A visible timezone text field.
- Eight sitting cards at once if a compact year switch makes four sufficient.
- Any feasibility or “too late” message that blocks continuation.

---

## 4. Step 2 — Study route and classes

### Primary question

Does an external teacher/class determine what the candidate covers and when?

### Route choices

- Self-study;
- Self-paced/recorded course;
- Live classes;
- Live classes plus independent study.

### Remove unnecessary typing

The current “What are you studying from?” or institute-name input should not be part of required onboarding. A provider name does not change the first plan. Move source/provider management to Settings and allow it later through Log Learning.

If the business wants provider analytics later, offer a searchable optional preset list after onboarding rather than a free-text field here.

### Class schedule interaction

Only show for live-class routes.

Each recurring class series should use:

- multi-select weekdays;
- one start time;
- one end time;
- optional start/end date hidden under “This schedule changes later”.

This allows “Monday and Wednesday, 6–8pm” to be entered once instead of as two rows.

Include quick presets:

- Weekday evenings;
- Saturday/Sunday mornings;
- Custom.

### Product effects

| Input | Effect |
|---|---|
| Preparation route | Chooses roadmap-led versus class-led sequencing |
| Class weekdays/times | Creates protected recurring Calendar commitments |
| Class-led route | Tells Log Learning and Coach to follow actual class coverage |

### Required outcome

- Route is required.
- At least one class series is required only for live-class routes.
- Self-paced courses do not create class commitments unless the user explicitly adds a timetable.

---

## 5. Step 3 — Current position

### Primary question

How much of the syllabus has the candidate already encountered?

### First choice

- Starting fresh;
- Started recently;
- Partway through;
- Covered most topics / revising;
- Returning after a break;
- Retaking Level I.

### Progressive disclosure

The current screen always presents ten topics with four controls each. That is accurate but visually heavy.

Optimised behaviour:

- **Starting fresh:** set every topic to `not_started`; show no topic grid unless the user chooses “Actually, I have covered something”.
- **Started recently / partway through:** show the ten topics as multi-select cards under “Which topics have you touched?” Then ask one batch recency choice for the selected topics, with per-topic editing available.
- **Revising / returning / retaking:** preselect all topics as previously covered, then ask the user to deselect topics they never completed or mark topics currently being worked on.

### Remove or defer

- Exact number of prior attempts: retaker status is sufficient for the initial plan. Ask for attempt history later only if it changes a retake-specific workflow.
- “Finance degree”, “work in finance”, “comfortable with maths”, and “studied in English”: these do not currently produce dependable task-level changes. Defer them to optional profile research or remove entirely.

### Evidence rule

Every answer is self-report. It may alter exposure planning and diagnostic scope but can never mark a topic, module, LOS or concept as supported.

### Product effects

| Input | Effect |
|---|---|
| Overall stage | Selects starting roadmap phase and default topic states |
| Topics touched | Prevents obviously repeating exposure and identifies baseline diagnostic scope |
| Recency | Adjusts review priority and expected decay, not demonstrated readiness |

---

## 6. Step 4 — Real-life week

### Primary question

What time is genuinely unavailable, and which remaining gaps could realistically be used for study?

The current availability grid is useful, but it asks the candidate to construct their week from scratch. The optimised version begins with fixed constraints and then shows the resulting gaps.

### Stage A — Fixed unavailable time

Ask “When can you usually not study?”

Preset commitments:

- Work/college;
- Commute;
- Classes already carried from Step 2;
- Exercise/sport;
- Family/personal;
- Sleep boundary;
- Other.

Each commitment uses:

- preset label/icon rather than typing;
- multi-select weekdays;
- start/end time;
- optional custom label only for Other.

Quick templates:

- Weekday job/college, 9am–5pm;
- Weekday job/college plus commute;
- Variable schedule / add manually.

### Stage B — Realistic study gaps

After fixed constraints are placed, show the remaining morning/afternoon/evening gaps as tappable windows:

- “Could you realistically study here?”
- User taps only plausible windows.
- Exact times are prefilled from the gap boundaries and editable in an expanded control.

This captures real availability without asking the student to estimate weekly study hours.

### Stage C — Sitting length

Ask one tap-based question:

“What is the longest focused sitting you can usually complete?”

- 20;
- 30;
- 45;
- 60;
- 90 minutes.

The answer splits tasks. It does not decide the total weekly load.

### Display language

Do not show “You can study 14 hours” as a target. Show:

- “Roadmap has 6 possible planning windows.”
- “Your week currently contains approximately 7–10 hours of usable space.”
- “This is a ceiling, not a requirement.”

### Product effects

| Input | Effect |
|---|---|
| Fixed unavailable blocks | Protected commitments; planner cannot overlap them |
| Realistic study windows | Legal placement windows for weekly tasks |
| Sitting length | Task splitting and alternative-slot suggestions |

### Required outcome

At least one realistic study window and one sitting length are required. Limited time may produce a compressed proposal, but never denial.

---

## 7. Step 5 — Weekly checkpoint

### Primary question

When does the candidate want one study week to close and the next to begin?

### Keep

- Closing/check-in day as seven tap targets.

### Optimise

- Suggest a day based on the user's realistic windows and classes.
- Explain in one sentence that diagnostic findings after this boundary belong to the next week's repair work.

### Remove or defer

- Reminder time while reminders are not operational. Add it when notification delivery exists, or infer a proposed time from an available window and confirm it when the first diagnostic is scheduled.
- “What usually breaks your plan?” It helps Coach tone but does not materially change the first roadmap or Calendar. Ask it contextually during the first weekly review or Coach interaction, where the answer is grounded in actual behaviour.

### Product effects

| Input | Effect |
|---|---|
| Closing day | Defines study-week boundaries, weekly review and repair rollover |
| Diagnostic time, once operational | Places scheduled weekly check inside an available window |

---

## 8. Step 6 — Review and confirm

### Primary question

Did Roadmap understand the candidate's exam, classes, constraints, starting point and weekly boundary correctly?

### Review cards

- Exam: month/year and, only when registered, the booked appointment date.
- Route: self-study/course/classes/hybrid.
- Classes: recurring schedule.
- Starting point: overall stage and topics already touched.
- Fixed constraints: number and visible examples.
- Planning windows: count and weekly range, labelled as a ceiling.
- Maximum sitting length.
- Study-week closing day.

Each card has Change and returns to the review after saving.

### What the user previews

- Long-term phases and target first-pass completion.
- Current/first milestone.
- First week draft with study blocks, class blocks and protected commitments.
- Diagnostic block only when studied scope and item-bank sufficiency make it executable.
- Assumptions or conflicts requiring attention.

### Final action

“Confirm setup and open my week” should:

1. validate all required outcomes;
2. save onboarding completion/version;
3. activate one roadmap;
4. create one versioned first-week draft;
5. accept exactly the previewed first week;
6. redirect to Home, where the same accepted blocks appear.

No duplicated plan or roadmap may be created if the user refreshes or presses the button twice.

---

## 9. Current input audit

| Current input | Decision | Reason |
|---|---|---|
| Exam sitting | Keep, required | Defines the horizon |
| Registered/not yet | Keep | Determines whether an exact booked date exists or planning remains month-based |
| Visible timezone text input | Remove from flow | Browser can detect it; Settings can correct it |
| Preparation route | Keep, required | Changes sequencing authority |
| Provider/source name | Move out | Does not change initial plan; creates typing |
| Repeated class rows | Replace | Multi-day recurring series is faster and cleaner |
| Overall stage | Keep, required | Seeds coverage defaults |
| Ten topic rows for everyone | Conditionalise | Fresh users should not answer 40 controls |
| Prior attempt count | Remove/defer | Retaker status is enough initially |
| Background chips | Remove/defer | No dependable current planning effect |
| Availability grid | Keep but derive after constraints | Needed for placement; should not be built from scratch |
| Fixed commitments | Keep, simplify with presets | Prevents impossible plans |
| Maximum sitting | Keep, required | Controls task splitting |
| Week closing day | Keep, required | Defines weekly loop |
| Reminder time | Defer | Do not collect before reminders work |
| Failure mode | Defer | Better asked after behaviour exists |
| Source/material upload | Exclude | Premium Settings feature, never required |

---

## 10. Required schema and service changes

### Profile/exam

- Add `booked_exam_date date null`.
- Preserve `exam_window_id`, `exam_year`, `exam_sitting`, `registered`, `timezone`.

### Commitments

- Support multi-day recurring series from one onboarding control.
- Add optional commitment template/category.
- Preserve source/provenance so later edits replace only onboarding-owned rows.

### Onboarding completion

Finalisation checks:

- exam window, plus a booked date only when registered;
- preparation route;
- stage/coverage context;
- at least one availability window;
- maximum sitting length;
- closing day;
- generated roadmap and accepted first-cycle revision.

### Planner

- Use available windows as placement limits.
- Subtract protected commitments/classes.
- Do not convert the total window time into a mandatory target.
- Learn future draft fill from actual completion behaviour.

---

## 11. Target effort and interaction count

Typical fresh self-study candidate:

- Exam: 3 taps plus date confirmation.
- Route: 1 tap.
- Position: 1 tap.
- Week: one constraint preset, a few gap taps, one sitting-length tap.
- Checkpoint: 1 tap.
- Review: inspect and confirm.

Typical class-led candidate:

- Adds one or two class series using multi-day selection.
- All other steps remain comparable.

The intended completion time is approximately three minutes for a straightforward candidate and under five minutes for a class-led candidate with several commitments.

---

## 12. Acceptance criteria

- No required free-text field.
- A fresh candidate never sees the full topic grid unless they request it.
- A self-study candidate never sees class-schedule controls.
- A class-led candidate can enter two same-time class days as one series.
- The system captures a sitting month before registration and an exact booked date only after registration.
- Fixed unavailable time and realistic study windows are both represented.
- Every collected answer has a documented downstream consumer.
- Final review shows exactly what will be created.
- Completion creates one roadmap and one accepted first week.
- `/app/*` remains inaccessible until finalisation succeeds.
- No feasibility result can block onboarding.
