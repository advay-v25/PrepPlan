# Roadmap — Final Onboarding Questionnaire and Variable-Class Flow

**Date:** 18 September 2026  
**Status:** Consolidated proposed onboarding experience  
**Principle:** Mandatory setup, minimum typing, progressive disclosure, and a documented planning effect for every answer.

---

## 1. Decision on changing class schedules

Students with changing class schedules should not be forced to enter a recurring timetable during onboarding.

The practical design has three separate concepts:

1. **Preparation route:** Does a teacher/class influence syllabus order?
2. **Scheduled class:** When will a class occupy time in the current or upcoming week?
3. **Completed class:** What was actually covered and should now affect consolidation and diagnostic scope?

These must not be collapsed into one “class” record.

### Onboarding behaviour

The student selects one class pattern:

- Fixed every week;
- Changes week to week;
- Some fixed, some changing.

For fixed classes, onboarding collects the recurring timetable.

For changing classes, onboarding collects no invented timetable. Roadmap instead enables a lightweight weekly class-sync experience.

### Calendar experience

The Calendar has one prominent **Add class** action with two modes:

- **Upcoming class:** protects the date/time and triggers a preview of any study-block moves needed to keep the week feasible.
- **Class completed:** records the actual date/time and asks what topic/module was covered; it can then propose consolidation and an appropriate diagnostic.

The quick form uses:

- date;
- start/end time;
- topic/module, optional for upcoming and required or confirmable after completion;
- “repeat weekly” toggle;
- “copy last class” shortcut;
- optional note hidden under More details.

### Weekly sync for variable classes

At the beginning of a new study week, class-led candidates with a changing timetable see a non-blocking prompt:

> Add this week's classes so Roadmap can protect them before placing study work.

Actions:

- Add a class;
- Copy last week;
- No classes this week;
- I will add them later.

If the student adds a class after accepting the week:

1. create/protect the class commitment;
2. recompute remaining usable windows;
3. detect study-block conflicts;
4. produce a change proposal showing moved, split or deferred work;
5. recalculate planned load and remaining capacity—not a mandatory hours quota;
6. update diagnostic timing/scope only when studied coverage and item-bank sufficiency support it;
7. apply changes only after acceptance.

If the student logs a completed class:

1. record a learning activity and coverage event;
2. map it to topic/module/LOS, with confirmation when uncertain;
3. propose class consolidation/retrieval work;
4. update the current milestone/coverage view;
5. reassess diagnostic eligibility;
6. preview any remaining-week change.

This is more practical than rebuilding the whole week automatically because it distinguishes time protection from learning evidence and preserves student control over accepted plans.

---

## 2. Complete onboarding questionnaire

The following is the full set of user-facing onboarding questions, including every conditional branch.

## Step 1 — Your exam

### Question 1 — Which CFA Level I sitting are you aiming for?

**Control:** Year selector followed by four sitting cards.

- February [year]
- May [year]
- August [year]
- November [year]

**Required:** Yes.

**Product effect:** Selects the exam window, provisional roadmap horizon, phase boundaries and final-preparation period.

### Question 2 — Have you registered and booked your exam yet?

**Control:** Two cards.

- Yes, I have booked it
- Not yet

**Required:** Yes.

**Product effect:** Determines whether Roadmap uses only the selected sitting month or a booked exact date.

### Question 3 — What is your booked exam date?

**Shown only when:** The user selected “Yes, I have booked it”.

**Control:** Date picker restricted to the selected sitting window, with an escape route if CFA scheduling falls outside the stored range.

**Required:** Yes for registered candidates.

**Product effect:** Refines countdowns and phase dates. Unregistered candidates are never asked for or assigned an exact date.

Timezone is detected silently. It is not a question unless detection fails.

---

## Step 2 — How you prepare

### Question 4 — How are you preparing for Level I?

**Control:** Four cards.

- Studying on my own
- Following a self-paced or recorded course
- Attending live classes
- Live classes plus my own study

**Required:** Yes.

**Product effect:** Determines whether Roadmap or class coverage leads curriculum sequencing.

### Question 5 — How predictable is your live-class timetable?

**Shown only when:** Live classes or hybrid is selected.

**Control:** Three cards.

- Fixed every week
- Changes week to week
- Some fixed, some changing

**Required:** Yes for live-class routes.

**Product effect:** Determines whether onboarding creates recurring commitments or enables weekly class sync.

### Question 6 — When are your fixed classes?

**Shown only when:** Fixed or mixed class pattern is selected.

**Control:** Repeatable recurring-series card.

For each series:

- Which days? — multi-select weekday chips
- Start time — time picker
- End time — time picker
- Does this end on a known date? — optional expansion

Shortcuts:

- Add another class time
- Same time on multiple days

**Required:** At least one series for a fixed class pattern. Mixed users may continue after entering only the fixed portion.

**Product effect:** Creates protected recurring Calendar commitments.

### Confirmation for changing schedules

This is explanatory, not another question:

> Add each week's classes from Calendar. Roadmap will protect the time and show how the rest of the week should change.

No provider/source-name typing is required in onboarding.

---

## Step 3 — Where you are now

### Question 7 — Where are you currently in your preparation?

**Control:** Six cards.

- I have not started
- I started recently
- I am partway through the syllabus
- I have covered most topics and am revising
- I am returning after a break
- I am retaking Level I

**Required:** Yes.

**Product effect:** Sets sensible topic defaults and the starting roadmap phase. It never creates demonstrated evidence.

### Question 8 — Which topics have you already touched?

**Shown when:** Any option except “I have not started” is selected.

**Control:** Ten multi-select topic cards.

- Ethical and Professional Standards
- Quantitative Methods
- Economics
- Financial Statement Analysis
- Corporate Issuers
- Equity Investments
- Fixed Income
- Derivatives
- Alternative Investments
- Portfolio Management

Bulk actions:

- Select all
- Clear all

**Required:** At least one topic unless the selected stage implies broad revision/retake, in which case all begin selected and can be removed.

**Product effect:** Defines self-reported exposure and possible baseline diagnostic scope.

### Question 9 — How recently did you work on these topics?

**Shown when:** One or more topics are selected.

**Control:** One batch choice, followed by optional per-topic adjustment.

- Working on them now
- Covered recently
- Covered a while ago

**Required:** Yes when topics are selected.

**Product effect:** Adjusts review priority and decay assumptions. It does not mark topics understood.

Do not ask about degree, profession, English background, mathematics comfort or exact number of prior attempts during onboarding.

---

## Step 4 — Your real week

### Question 10 — What time is normally fixed or unavailable for study?

**Control:** Add-from-preset cards.

- Work or college
- Commute
- Exercise or sport
- Family or personal time
- Regular appointment
- Other

Classes entered in Step 2 are already displayed and cannot be double-entered.

For each commitment:

- Which days? — multi-select weekday chips
- From — time picker
- To — time picker
- Custom label — shown only for Other

Shortcuts:

- Weekday work/college, 9am–5pm
- Add commute around this
- Add another fixed commitment
- I have no other fixed commitments

**Required:** The user must either add a commitment or explicitly confirm none.

**Product effect:** Creates protected time the planner cannot use.

### Question 11 — Which remaining windows could you realistically use for study?

**Control:** Calendar/grid generated after subtracting classes and fixed commitments.

The user taps plausible morning, afternoon or evening gaps. Exact times are prefilled from the remaining gap and editable under Adjust time.

**Required:** At least one window.

**Product effect:** Defines legal study-placement windows and the maximum available boundary. It does not create a required hours target.

Display:

> Roadmap has [n] possible planning windows, approximately [range] hours of space. This is a ceiling, not a requirement.

### Question 12 — What is the longest focused sitting you can usually complete?

**Control:** Choice chips.

- 20 minutes
- 30 minutes
- 45 minutes
- 60 minutes
- 90 minutes

**Required:** Yes.

**Product effect:** Splits long work into realistic sessions. It does not determine total weekly study time.

---

## Step 5 — Your weekly checkpoint

### Question 13 — Which day should close your study week?

**Control:** Seven weekday chips, with a recommendation based on classes and available windows.

**Required:** Yes.

**Product effect:** Defines the study-week boundary, weekly review point and diagnostic-to-repair rollover.

Supporting text:

> Roadmap will normally review the week and place an eligible cumulative diagnostic around this boundary. Findings from the closing day shape the next week.

Do not ask for a reminder time until reminders are operational. Do not ask what usually breaks the plan until the first evidence-based weekly review.

---

## Step 6 — Review your setup

### Question 14 — Does this accurately reflect your current situation?

**Control:** Review cards with Change links, followed by a single confirmation action.

Cards:

- Exam sitting and booked date if registered
- Preparation route
- Fixed/variable class pattern
- Fixed class schedule
- Current preparation stage
- Topics already touched
- Protected commitments
- Realistic study windows
- Maximum sitting length
- Study-week closing day

**Required:** Yes.

### Preview before confirmation

Show:

- long-term phases;
- target first-pass completion range;
- first curriculum milestone;
- first-week draft;
- classes and protected commitments;
- proposed study blocks;
- eligible diagnostic, or a clear reason one is not yet appropriate;
- assumptions or conflicts.

### Final action

**Button:** Confirm setup and open my week

The transaction:

1. validates all required inputs;
2. completes onboarding;
3. activates one roadmap;
4. creates one versioned first-week draft;
5. accepts exactly the previewed blocks;
6. redirects to Home.

---

## 3. Complete question count

### Fresh self-study candidate

Answers Questions 1, 2, 4, 7, 10, 11, 12, 13 and 14: **nine decisions**, mostly taps.

### Registered self-study candidate with prior coverage

Adds Questions 3, 8 and 9: **twelve decisions**.

### Fixed live-class candidate

Adds Questions 5 and 6: **eleven to fourteen decisions**, depending on coverage and registration.

### Variable live-class candidate

Answers Question 5 but skips timetable entry. Weekly class dates are handled through Calendar: **ten to thirteen decisions**.

---

## 4. Questions deliberately excluded

- Preferred provider/source name;
- Material upload;
- Weekly study-hours target;
- Exact date before registration;
- Visible timezone entry;
- Academic/professional background;
- Mathematics confidence;
- English-study background;
- Exact number of past attempts;
- Reminder time before reminders work;
- Generic motivation/personality questions;
- “What usually breaks your plan?” before actual execution evidence exists.

These either add typing without changing the initial plan or are better learned from real behaviour.

---

## 5. Onboarding completion contract

Onboarding is complete only when the system has:

- intended exam sitting;
- registration state and booked date when applicable;
- preparation route;
- class pattern and fixed class schedule when applicable;
- preparation stage and self-reported topic exposure;
- explicit fixed-commitment answer;
- at least one realistic study window;
- maximum sitting length;
- study-week closing day;
- user-confirmed roadmap and first-week preview.

No readiness, feasibility, background or diagnostic score can prevent completion.
