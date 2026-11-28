# PrepPlan student journey · position, path and next action

This audit uses the revamp phase numbering in `PREPPLAN-END-TO-END-REVAMP.md`. The table describes the checkout before this pass. Browser proof is recorded separately.

| Decision | Route | State owner and available facts | Source finding |
|---|---|---|---|
| What should I do next? | `/app` | `getCurrentOperatingState` and the Home model read the accepted cycle, paper decision and open work. `getSignals` separates coverage, execution and evidence. | Home’s condensed Roadmap labelled estimated coverage effort “Done”. Its next action had its own exact route. |
| Where am I going? | `/app/curriculum?view=roadmap` | `getActiveRoadmap` rebuilds the projection from current inputs. `computeProgress` prices coverage. The LOS tracker owns evidence date and sample. | The Roadmap did not read the shared signals or show an exact next action. Its planned-effort sum also included revision milestones, which re-use readings. The milestone bars used a legacy verified flag. |
| What fits this week? | `/app/calendar` | Calendar reads accepted blocks, recurrence, protected time, execution and task rationale. `generateWeek.ts` proposes work against free gaps and accepted commitments. | An accepted block and a candidate in the queue are different states. Planner allocation already gives repairs and checks precedence. Revision descriptions could obscure eligibility versus placement. |
| What did I actually study? | `/app/log?task=…` and `/app/calendar/log-class` | Planned and separate session commands own recorded minutes and explicit outcome confirmation. Class logging owns occurrence, coverage extent and consolidation. | A completion or a class report records activity. A partial outcome does not become whole scope by aging or rolling over. |
| What can be checked? | `/app/tests` and `/app/tests/[attemptId]` | Scope and assessment preflight own confirmed scope, eligible items, clock and frozen reservation. | A planned reading, a confirmed reading, and a startable paper are separate facts. Bank shortage needs a usable planning path. |
| What does that check support? | `/app/tests/[attemptId]/result` | The score ledger, evidence reducer and repair follow-up own delivered items, observations, disputes, findings and next actions. | The dated attempt persists. A narrow sample describes the outcomes asked. Study and passage of time cannot create a newer observation. |
| How should next week change? | `/app/review-week` | Weekly Review saves draft answers; the canonical revision queue ranks by activity, evidence, uncertainty, history and phase. The packer uses real free gaps and continuing work. Acceptance atomically owns writes. | Every covered reading could compete for a near-term slot even after recent activity. A late accepted block must never be displaced to fit a recall. |
| Why, or what can I change? | `/app/coach`, `/app/settings` | Coach uses the existing world and owned proposal commands. Settings changes canonical exam, preparation and availability inputs with impact previews. | Coach can discuss a queue candidate before any new slot is accepted. Settings changes future inputs and invokes reviewed adjustments where required. |

## Current → intended → verified

| Surface | Before | Implemented direction | Evidence |
|---|---|---|---|
| Home | Coverage effort looked like finished tasks. The understanding tile displayed a band. | One next action, with first-pass effort and dated test evidence as separate signals. | Authenticated Roadmap handoff and exact result link in both browser projects. |
| Roadmap | Phase list, feasibility and two inconsistent effort bars. | Position, workload basis, next action and named milestones. Coverage reports, work and evidence remain distinct. Gaps and untested scope stay visible. | Chapter checks preserve the original result link after the time fixture. Mock-prep checks exercise the gap’s support link. |
| Calendar | Accepted schedule and forecast could include a misleading progress verdict. | Accepted blocks with actual task state. A live class-led path can have no topic milestone. Use the Roadmap for the exam path. | Scoped mock/material fixture and existing drawer journey exercise the accepted-chain controls. |
| Curriculum and Log | Reading controls and separate coverage/evidence owners already existed. | Use the same eligible sample and dated evidence across Roadmap and tracker. Link the exact outcome and supporting result. | Chapter scenarios use the normal Log and curriculum routes. |
| Tests | Paper and result links work, but age is easy to lose when coming back later. | Preserve the original submission timestamp and scope. Distinguish recall, evidence repair and scored re-check. | The scored runner regression covers reserve, changed scope, resume, score, repair and a fresh independent re-check. |
| Coach | Could summarize the result’s interpretation and repeat an aggregate understanding band. | Use current tracked findings and preserve their source and activity status. Link the exact result, outcome or task. Timing guidance points to the already computed Tests finding. | Owned result routing, gap and linked task checks. Provider product behaviour still needs live acceptance. |
| Settings | Canonical input editors described their local effect. | Link to the Roadmap and preserve the approved-work boundary when changing inputs. | Route audit and existing local setting contracts. No complete Settings browser regression in this pass. |
| Weekly Review | Even recent material competed for a slot. Placement and eligibility looked like the same decision. | An eligible reading can rest or wait. Regular first-pass proposals fill core study first. A lighter proposal can make room for a due recall. Mock prep focuses on findings and flagged reading work. | Authenticated proposals at both widths show the due reading in a lighter draft and the exact reason it waits when free gaps are too short. Accepted rows are checked before and after preview. |

## Founder decision on the transition to mocks

- PrepPlan owns one Roadmap recommendation for when to shift from broad revision to mock-led preparation. It uses canonical coverage, completed block history, valid diagnostic and re-check evidence, the exam horizon, and feasible time for the mock, debrief and follow-up.
- Explain why the recommendation applies now, name unresolved and untested areas, and show what the proposed week would change. When time pressure justifies starting mocks with gaps, name the gaps that remain and explain the trade-off. Show the recommendation before the student reviews any changes to accepted work. Existing approval rules apply.
- Coach surfaces the Roadmap recommendation and links the relevant action. The Roadmap owns the judgment. Test a clean transition, continued broad revision, and a time-pressured transition with open gaps.
- The implementation described below used the scheduled final-preparation window. The evidence-based recommendation is the next build requirement. Exact numerical thresholds have yet to be agreed.

## Founder decision on catch-up and recovery

- Start by preserving the current roadmap. Use actual logged completion and the remaining work carried forward to estimate the gap. Show how many extra hours are needed and how many can feasibly fit in the proposed weeks around protected commitments, sitting limits, and the exam cutoff. Carry each unfinished portion forward once, with its existing lineage and prior minutes intact.
- Show added hours and moved work in the proposal until the student accepts it. Track whether the gap is closing from logged work, including partial completion. Added or accepted hours describe the plan. Completed work describes execution.
- Offer formal recovery when repeated shortfalls make the current path difficult to sustain. Show feasible alternatives with the hours required, work moved or deferred, and the effect on revision, mocks and the exam timeline. The student chooses the path. Home, Calendar, Exam Roadmap and Coach use the same status. Coach explains the options and links to the existing review action.
- Verify one missed week, two missed weeks followed by successful catch-up in Weeks 3 and 4, and persistent shortfalls that lead to a recovery choice. This decision defines the next build requirement. The fixed trigger for escalating to formal recovery remains open, and missing two weeks alone does not trigger it.

## Founder decisions still open

- Ready for exam day. Decide how the student reviews unresolved findings, untested scope, mock history and remaining calendar time before this milestone. The app shows the target date and open work today.
- Define “well prepared” only after agreeing what the actual bank and a narrow sample can support. Keep early-stage, thin-bank and older-evidence cases meaningful without an overall label or pass forecast.

## Verification boundaries

The Chapter 1 test scores a narrow weekly paper from one logged reading. Its time fixture shifts the date of the original attempt and the logged study payload together to simulate several weeks elapsed. It creates no replacement evidence. The class-led scenario is a class-led student logging an independent study session. Existing class occurrence and rollover browser journeys are separate evidence for class logging. The zero-bank scenario uses the real eligibility path on a local stack with no reviewed inventory. Scored checks use registered synthetic questions. The actual deployed bank and live providers were not measured in this pass.

The [Phase 5 handoff](PREPPLAN-PHASE-5-AGENT-PROMPT.md) covers the release gates and their dependencies.

## Regression results and fixes found in the browser

- A self-study and a class-led student each used the ordinary Log and Tests UI with one reading in a narrow paper. The aged result still opened at the original attempt and displayed its submission date. The lighter draft placed recall. The short-gap draft kept it waiting with a named reason and left every accepted block unchanged. On the separate empty-bank path, the UI allowed recall and claimed no new evidence.
- The mock-prep fixture puts a booked target inside the existing final-preparation window. One scored miss appeared on the exact Curriculum outcome, the Roadmap and the owned Coach result conversation. The mock-prep draft proposed that repair, and completion updated activity only.
- The mock-prep shortage scenario exposed the Calendar drawer advertising a Start action before checking bank capacity. It now runs Tests’ read-only decision when opened, with distinct wait, shortage, start and resume states. The browser shortage removes only unused synthetic inventory. The original result, recorded gap and completed repair remain.
- The existing scored student browser regression passed all 14 checks across desktop and 390 px on the alignment build before the drawer preflight change. It covered frozen reservations, lost response recovery, exact result and Curriculum links, repair acceptance and a valid spaced re-check. The new mock scenarios cover the drawer change.
- TypeScript, npm run verify, eight local database suites and the isolated production build passed. The generated client audit found zero findings in 57 assets. External auth providers, deployed inventory and comparable Phase 4 route performance remain separate gates.
- The Chapter 1 and empty-bank cases passed 6/6. The final mock-prep cases with and without fresh re-check items passed 4/4. Both used desktop and 390 px. With fresh items, a new scored result became the exact Curriculum outcome’s latest check. With none, the drawer reported the shortage, offered no Start, and the outcome kept the earlier evidence and separate completion status.
- Scoped SHA-256 for the edited Roadmap, queue, Coach service, drawer preflight and main browser spec: `6300532a478ff875d7d4b8cdce406d6c2e29025648cfa0c2573bbed26e7b93e2`.
- Auth, verified local entry, the 48% external mock recovery and explicit retake activation passed another 10/10. The owned server, local database, generated build and fixture inventory were cleaned up. Production and other workers’ services were outside the run.
