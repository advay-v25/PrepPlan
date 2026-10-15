# Roadmap — feature-by-feature build track

**Purpose:** Make the student experience concrete and build it in connected slices. This is the execution companion to `PRODUCTION-COMPLETION-PLAN-2026-10-13.md`, not a competing architecture or another permission to rewrite everything.

## 1. The experience we are building

A student should be able to say:

> “I know what to work on today, why it matters, where it fits around my life, what my test actually showed, and what changes next.”

Six pages have six distinct jobs:

| Page | The student's question | What the page does | Its useful output |
|---|---|---|---|
| Home | What do I do now? | Shows the next justified action, short Today list and one relevant decision. | Opens the exact task, paper, result or week review. |
| Calendar | When does the work fit, and what changed? | Places accepted study work around protected life/class commitments; records reality and previews recovery. | A feasible day/week, actual learning logs and a clear change history. |
| Curriculum | What have I covered, what have I demonstrated, and what needs another pass? | Maps subjects → readings → LOS, keeping activity and test evidence separate. | Exact scope to study, revise, check or place in Calendar. |
| Tests | What can I actually apply from what I studied? | Checks eligible completed scope with timed/confidence-aware papers and valid results. | Scoped evidence, uncertainty, priorities and a repair proposal. |
| Coach | Why this plan, and how should I respond to a problem? | Explains evidence and offers practical choices with confirmed tool actions. | A justified next step or a validated calendar change, not a lesson. |
| Settings | How do I change the assumptions without breaking my plan? | Edits exam, route, class pattern, constraints and account preferences. | A previewed context change with preserved history and accurate downstream state. |

No Materials tab; no permanent Weekly Review tab; no new dashboard for every metric. Revision and mocks are operating modes of these same pages, not separate disconnected products.

## 2. Why the current app feels linear

- Several pages display information without making its next useful action explicit.
- Roadmap phases exist, but phase-specific daily work is not complete; a revision label alone is not a revision system.
- Some operations mutate one table and fail before updating history or dependent state.
- Scope and task lineage are incomplete in places, so doing work does not always produce the correct test or follow-up.
- The allocator has limited handling of partial portions, sitting lengths, remaining repairs and actual pace.
- Bank capability does not match the desired full-syllabus product yet; trust-tier and scope rules need consolidation.
- In a draft state the UI can still imply an accepted schedule or an execution gap. Calendar's draft-pressure wording has been corrected in the initial slice below.

The solution is not a more powerful chat box or more cards. It is an explicit event → consequence → confirmation loop, supported by trustworthy backend commands.

## 3. The non-linear loop, using concrete situations

| What happens | Calendar consequence | Curriculum consequence | Test consequence | Coach / Home consequence |
|---|---|---|---|---|
| I complete planned learning | Record actual scope; time optional. | Studied scope changes, not mastery. | Eligible completed scope enters the correct paper. | Next action advances; no fabricated readiness increase. |
| I finish extra learning | Log once, reconcile against planned work. | Extra coverage reduces remaining scope. | Confirmed extra outcomes enter the relevant paper. | Explain the changed trajectory and next action. |
| I finish part of a reading | Preserve the remainder and suggest another sitting. | Only confirmed outcomes are covered. | Do not test the whole reading as completed. | Offer recovery choices, not “you failed.” |
| I miss a block | Preview new placement/reduced scope or explicit deferral. | Understanding does not fall just because a session was missed. | Missed content is not tested as learned. | Surface one useful decision; no guilt wall. |
| A class moves or covers different material | Expand the correct occurrence; preview future cycle/scope consequences. | Confirm actual covered outcomes. | Check before the relevant next class cycle, only on eligible learning. | Explain what changed; old accepted history stays fixed. |
| I am confidently wrong | Propose focused work and an independent check. | Valid evidence flags a specific area with sample/recency. | Record confidence mismatch; avoid diagnosing an entire subject from one ambiguous item. | Explain broad topic priorities and method, not teach the topic. |
| An item is invalidated | Cancel obsolete future work with a reason, retain audit trail. | Remove invalid support for its evidence judgment. | Recompute valid score/evidence. | Explain the correction consistently everywhere. |
| I study more/less for a month | Preview a changed near-term load and longer-term trade-offs. | Keep completed scope/history. | Keep legitimate checks and explicit untested obligations. | Offer calm choices, never prescribe hidden mandatory hours. |
| My booked date changes | Rebuild only future horizon after confirmation. | Preserve dated coverage and evidence. | Re-time revision/mocks, not reset all results. | Display one consistent new target and its implications. |

Every consequence needs a clear visible outcome and retry/undo policy. These are requirements, not claims that all are implemented already.

## 4. What each preparation stage looks like

### First week: establish a baseline

- Onboarding provides expectations: target window, route/classes, starting point, commitments, available windows and sitting length.
- The first draft makes its estimates clear. The student reviews it before acceptance.
- Home opens the exact next task. Calendar records completed/partial/deferred/unknown rather than assuming activity.
- A supported paper checks confirmed learning; confidence and time provide additional signals.
- A quick review reconciles logs and proposes week two. One week begins personalisation, but does not permanently define capacity.

### Learning stage

- Self-study progresses through a sequenced roadmap. Class-led work follows actual classes plus consolidation; hybrid adds only appropriate independent scope.
- Weekly work includes essential new learning, revision, supported repairs and protected life time.
- New completed material receives diagnostics; revisited material receives revisionary checks. Mixed weeks keep purposes distinguishable.
- The paper result changes evidence; accepted proposals change Calendar. Doing those are different operations.

### The syllabus has been studied once

The next screen should not be “100% complete, good luck” or a new first-pass plan.

- Curriculum changes emphasis to **needs repair / needs another check / maintain / not yet tested**, with reasons and dates.
- Calendar places retrieval and mixed revision, not generic Study tasks on every reading again.
- Revision allocation combines weak areas, stale evidence and broad retention coverage. It must not repeatedly select only the easiest or most heavily tested areas.
- Results determine which priorities become maintain work, which need another repair and which remain uncertain.
- The phase transition distinguishes “coverage finished” from “understanding established.”

### Mocks and final preparation

- A mock has a defined purpose, supported syllabus breadth, reserved time and a review block. It is not just a bigger weekly quiz.
- Keep the 90-question ceiling per paper. If a full rehearsal requires multiple sessions, plan them as linked session papers with separate clocks and an honest combined result; confirm the rehearsal policy before implementation.
- Assess errors, confidence and time patterns; create a limited, prioritised response rather than a repair task for every wrong answer.
- Do not compare raw percentages from different forms as if they prove a trend without considering coverage and difficulty.
- Unavailable eligible bank coverage is visible. Unsupported scope remains unassessed; no fake mock or pass forecast.

### Last week and after the exam

- Final-week Home leads with today's essential work, not a huge cumulative backlog.
- Reduce decisions and unnecessary new content. Protect recovery and existing commitments; offer optional logistics reminders.
- A disruption triggers small practical changes within the remaining horizon, not tasks dated after the exam.
- After the student confirms the exam is finished, stop study nudges and archive the goal. Keep/export history according to account choices; a retake retains labelled evidence rather than fabricating a fresh start.

## 5. Build phases: one usable outcome at a time

Backend integrity from the production plan is a prerequisite inside each slice, not a separate final project.

| Phase | Feature slice | What we build together | Proof before advancing |
|---|---|---|---|
| 0 | Make the system understandable | Interactive journey explanation; page jobs; concrete scenarios; current-vs-proposed labels. | You can describe how a disruption, test result and finished syllabus change the app. |
| 1 | Calendar and task execution | Exact task links/drawer, meaningful study-block scope, sitting lengths, remaining portions, recurrence/cycles, capture, conflict/recovery preview and atomic task history. | A task can be found, understood, changed and recorded; downstream pages agree. |
| 2 | Curriculum as an action map | Useful subject/reading/LOS drill-down; separate studied/tested/confidence; coverage capture; revision queue; exact Calendar/Test links. | Every status has a reason and a relevant action; manual learning does not create mastery. |
| 3 | Tests, bank and results | Correct completed-scope allocation, original reviewed items, trustworthy reservation/timing/confidence/scoring, scoped SWOT and item challenges. | Supported checks work with retries; ≤90; no out-of-scope items; honest gaps and no fabricated bank coverage. |
| 4 | Repair and actual next-week adaptation | Deduplicated repair threads, accepted placements, re-checks, missing-log reconciliation, actual-capacity learning and one successor week. | A Sunday/class-cycle paper produces a useful following cycle; repair outcomes feed back into evidence. |
| 5 | Revision, mocks, final week | Executable phase-specific tasks, spacing/retention, linked mock sessions if approved, targeted reviews, final-week recovery and archive. | Simulated candidates complete the whole horizon, including late starters and changed targets. |
| 6 | Coach, Settings and Home integration | Grounded prompts/tool schemas/evals, confirmed changes/history; setup edits with impact preview; simple Home in all modes. | Coach changes match preview; Settings changes propagate; Home opens the right object and explains uncertainty. |
| 7 | Design polish and production release | Approved screen concepts, consistent components/copy/accessibility/mobile, then cleanup, auth delivery, monitoring, backups, security/content/legal review and staged release. | Browser + integration + operational gates pass; capability claims match reality. |

Design work happens within each slice. Phase 7 is cross-app polish, not a reason to leave early pages unusable. Before a major screen redesign, show the complete screen and its key states, decide the hierarchy, then implement. No repeated whole-app aesthetic rewrite.

## 6. Calendar is the first main feature

### What should be visible

```text
Calendar · Current cycle                    Log learning / Add commitment
Dates · cycle rule · draft or accepted state

Desktop: real week grid          Mobile: day/agenda
Protected commitments + classes + accepted study/paper blocks

Unplaced work / one pending adjustment, only when relevant

Open a study block:
Reading and exact covered scope
Purpose · why now · approach · estimate
Start / record actual completion / partial scope
Move / split / defer → preview consequences → confirm
Curriculum context / intended check
```

Do not put a curriculum explanation lesson inside the drawer. Its purpose is to help the student execute a study session using their own course/materials.

### Phase 1 slices

1. **Navigation and truthful context:** exact task links; no execution pressure from an unaccepted draft; clear unavailable-task fallback.
2. **Study-block semantics:** explicit scope/goal, estimate vs actual, partial outcome capture, conserved split/carryover and sitting-length constraints. Atomic commands/history before expanding execution controls.
3. **Time model:** one occurrence/cycle resolver, exceptions, overlapping commitments, usable capacity, date navigation, historic/future cycles and mobile parity.
4. **Real learning capture:** one authoritative session/time, mapped outcomes, class confirmation and duplicate prevention; propagate to Curriculum and paper scope.
5. **Recovery:** missed/partial/changed-class scenarios; preview choices, confirm placement and retain unplaced obligations. No hidden workload inflation.

## 7. First implementation slice — started this turn

Implemented:

- Shared encoded task-link builders and authorised-projection task resolution.
- Home next-action task/resume/place links now identify the task and local day.
- Today titles open the corresponding task; Calendar task selection follows the URL, refresh and navigation rather than a permanently copied row snapshot.
- `?task=<id>` opens a task drawer only from the account's loaded Calendar data. Missing/unavailable tasks show a clear current-week fallback.
- Cancelled tasks are filtered out of the Calendar projection.
- Calendar labels a draft focus as **draft, not yet accepted**, and does not describe draft timing as execution failure. An empty week has a **weekly checkpoint**, not a falsely promised scheduled paper.
- Regression tests for encoded identifiers, retained week/view, closing/switching selection, unavailable/commitment references, fresh revisions and next-action destinations; added to `npm run verify`.

This is **not** a complete Calendar rebuild, a bank expansion or a completed production launch. Scope semantics, transactional edits, accepted-cycle navigation and full revision/mock planning remain the next implementation slices.

### Route contract for this slice

- `/app/calendar?view=agenda&week=<local-date>&task=<id>` opens an existing account-scoped task; opening does not start or complete it.
- Opening from Calendar retains its current week/view. Closing removes only the selected task reference.
- Missing tasks never trigger a global lookup or an automatic plan rebuild.
- Existing `/api/tasks/[id]` remains the mutation boundary; no new mutation or production migration was introduced.

### Verification status

- Test-first navigation regression initially failed because the helper did not exist; it now passes.
- Expanded activation/next-action tests: 8 passed.
- Live Roadmap server is at `http://localhost:3100`; port 3000 is another app. No existing server was stopped.
- Browser verified current Home, Calendar, missing-task explanation and recovery link. The observed account has no accepted task week, so positive task-drawer/refresh behaviour still needs an accepted-task fixture, not a fabricated success claim.
- Full verifier/build results and responsive browser evidence are recorded in the completion message for this turn.
- `npm run verify` and `npm run build` both passed after the main slice. Desktop identity, nonblank rendering, no visible overlay, empty relevant console logs and recovery-link navigation were verified through the built-in browser. The viewport override did not change the measured 1280 × 720 viewport, so mobile behaviour is not claimed verified in this pass.

## 8. How we work from here

For each slice: agree the student scenario → show the screen/transition → define routes and consequences → implement → verify → record what is complete and what remains. Keep one build ledger; attach outcomes to the production backlog rather than opening competing plans.

Recommended next slice: **Calendar study-block semantics and atomic execution.** It makes a block answer “what am I doing, what does done mean, and what changes when I finish only part?” That must be reliable before we promise that every completed block creates the right diagnostic.

Questions that need founder decisions at the relevant slice:

- When confirmed weekly scope cannot all be checked within 90 questions, do we use explicit carry-forward obligations or multiple separately capped papers? No silent omissions.
- Should full mocks be linked exam-session papers, with a combined analysis, alongside shorter weekly papers? Recommended, subject to curriculum/exam-format validation.
- Confirm the current irregular-class fallback rule when a next class cannot define a viable cycle; accepted historical dates must never be rewritten.

These decisions do not block the initial Calendar navigation work. No previously agreed product direction is changed silently.
