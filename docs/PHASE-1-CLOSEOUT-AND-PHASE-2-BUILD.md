# PrepPlan · Phase 1 closeout and Phase 2 build

Work in `/Users/advay/Documents/Structured Learning App`. Read the revamp plan, the 24 November status and its follow-up evidence. Preserve concurrent changes. Identify the source fingerprint and app/database target for every run. Work through the whole prompt and stop after Phase 2 verification or at a concrete external blocker.

## A. Close Phase 1 before changing the planner

1. Keep the proven planned and separate logging contracts. An explicit owned task logs time, execution, confirmed outcomes and one receipt. Separate capture creates one activity. Time-only capture keeps coverage pending. Scheduled classes retain their occurrence identity. Keep retry, stale-write, held-input and historical behaviour.
2. Drive **new log → Coach** on desktop and 390 px. Start from the task or receipt and verify the Coach uses the exact owned context, actual minutes, execution and confirmed scope. A time-only log stays pending and a separate log leaves the original task untouched. Check refresh, exact links and deterministic response with the provider unavailable. Assert that a Coach explanation creates no schedule or evidence writes. If Coach uses stale data, fix its existing read model or contextual route.
3. Prove **reserve → change source coverage → resume → score** with approved synthetic fixtures on a separate target. Verify that the open attempt and form retain the same IDs, question order, scope and scoring policy. A new eligibility decision sees the new confirmed coverage. A preview that has not reserved a form is refused if scope changed. Run both visibility and underlying row assertions. Use the existing paper reservation and diagnostic suites. If the separate Supabase service is unavailable, add an isolated Postgres contract proof where possible and mark browser proof blocked. Do not seed publication rows in the deployed project.
4. Re-run the Phase 1 25 + 20 minute continuation, late separate log, time-only confirmation, concurrent save and lost response paths. Check Home, Calendar, Curriculum, Tests, Coach and weekly review against the same facts. Record logs that are source review, seeded, API-driven and browser-driven distinctly. Double-check the user-visible Calendar action and backend status after reload. Use the existing scenario harness.
5. Record a Phase 1 verdict. A blocker affecting the pinned form or canonical log integrity must be fixed before changing that logic. If the only remaining gap is external browser evidence, keep Phase 1 partial and continue independent planner code and isolated verification with the dependency visible.

## B. Build Phase 2 in thin, verified slices

### B1. One fit calculation for Calendar

- Use the existing planner and placement services. Load the student’s effective local-day availability, accepted load, timed study, live classes, cancellations/moves, personal commitments, booked mocks and existing papers once per preview or command. Derive real free intervals. Handle elapsed time, cross-midnight boundaries, overlapping windows, timezones, DST and exact adjacency. Carry the active cycle and exam horizon in the inputs.
- Place or size each generated sitting within one interval, to at most the student’s comfortable limit and the remaining gap. Keep existing day-only work flexible in the UI and reserve represented capacity so the same time is never promised twice. Two 30-minute gaps may hold two ordered 30-minute portions. A 45-minute unsplit portion cannot claim their sum. Show remaining work as waiting, including the reason, when no fitting interval exists.
- Apply fit to ordinary drafts, continuations, class follow-ups, repair/re-checks, papers and recovery. If an assessment needs more time than a study sitting limit, apply its explicit format and a feasible slot. Self-study runs Monday–Saturday with tests on Sunday. Class-led cycles follow the actual next class, including a short transition, with a test before the upcoming class when scope and fit allow. If the checkpoint can’t be scheduled, give a valid closure path. Honor manual exceptions after the existing one-time warning and protect hard conflicts.
- At acceptance or confirmation, recheck exact ownership, cycle bounds, source freshness, planned order and fit under the existing scheduling lock. A competing booking or class change must refuse the stale proposal atomically and preserve the student’s choices. Replay the same acceptance safely. Keep page renders read-only.

### B2. First pass and phase progression

- Keep actual progress separate from projected milestones. Resume from reported prior work for midway entrants. Distinguish explicitly confirmed work and self-reported coverage from diagnostic evidence, and treat no evidence as unknown. Keep unfinished first-pass workload visible by reading or owned scope group, with stable segment order and explicit remaining work. Generating time never marks a topic covered. Split overly large work across feasible slots and cycles without duplicating its scope or counting old minutes twice.
- First pass prioritizes unfinished learnings and actual class follow-up with room for high-priority repairs. Once the student records first-pass completion, or reports it on entry, use the remaining pre-revision time for a **weakness-only bridge**. Prioritize supported weaknesses, unstable evidence and separately labelled uncertainty checks. Preserve practice spacing. If no area warrants work, leave room or offer an earlier start to broad revision. An insufficient bank means guided review and an honest pending check.
- In broader revision, rotate cumulative topic coverage. Protect the intended final mock and preparation window, normally up to eight weeks where the horizon supports it. Show choices when first-pass work remains at the transition, with explicit reduced scope, timeline or tracked debt. Preserve mock, debrief and repair time. A mature February entrant with one revision and a poor mock gets bounded weak-area work and the next feasible checkpoint. A reported score or feeling alone cannot invent concept weaknesses.
- Use the last study date. A booked exam excludes study and generated papers on and after exam day. Tentative targets retain their existing inclusive boundary. Paused or exam-sat students retain history; a retake requires explicit activation. Never rewrite an accepted week upon a new log, result or class change.

### B3. Make the decision visible across screens

- Calendar shows **what fits, what is flexible, what waits and why** in a short daily/weekly agenda with exact task links. Weekly Review shows how prior work and deviations change the next draft. Home shows the next action. Tests reads the same availability and confirmed scope. Coach explains and previews the same server-owned change, with a useful provider-free fallback. Keep user confirmation for plan changes.
- Validate missed days, less or more study than expected, moved/cancelled class, changed availability, moved mock and exam-date edits. Explain what can move and which existing work is protected. Support a legitimate empty or no-paper week.
- Reuse existing data and commands. Keep fit, placement and transition policy deterministic on the server. If an additive migration is required, review callers and ownership, rehearse upgrade and restore, and use the checksum runner on authorized targets. Keep app work usable without applying unapproved changes to the deployed database.

## C. Acceptance matrix and closeout

Drive desktop and 390 px, with database assertions at each consequential step. Run the actual-bank path separately from synthetic assessment proof.

| Case | Evidence required |
|---|---|
| Fresh self-study and a class-led student | Correct study and test boundaries, including a short class transition and the no-paper path |
| Two 30-minute gaps, ordered portions, and a competing accepted task | Fits, refuses or waits correctly. Concurrent acceptance/booking cannot overfill the day |
| Elapsed day, holiday, DST, midnight, exact adjacency and no windows | Correct local day, no invented time, eligible empty draft, intact old week |
| Midway with three subjects reported covered and uncertainty | Unfinished work continues in sequence. Reported uncertainty and evidence are distinguishable |
| First pass just complete | Weak-only bridge, then broader revision. Unplaced work keeps its mapping and next action |
| Mature February entrant with poor mocks | No first-pass restart. Suggested work fits. Booked mock, debrief and repair are linked |
| Midweek exam or later retake | Active room and available work exist after the cutoff in the fixture. No generated task or paper crosses it. History stays readable |
| Review changed during preview, two tabs and a lost acceptance response | Stale confirmation writes nothing. Same-key retry returns one receipt and no duplicate work |
| Real bank shortage and synthetic reserved paper | Actionable shortage and closure. Frozen form survives an independent logging or coverage change |

Re-run `npm run verify`, TypeScript, the production build, Calendar integrity, weekly review, rollover, class change, assessment scope, Coach and the Phase 1 focused suites. Reuse the Phase 0 timings and read counts with like-for-like personas and sample sizes. Compare preview reads and latency separately from load; keep freshness and refusal tests.

Return one requirement → implementation → proof table, exact commands and results, source fingerprint, migration state, timing/sample counts, and test account cleanup. Give Phase 1 and Phase 2 separate verdicts. Keep actual and synthetic evidence separate. Continue fixing failures within scope. Mark a remaining external dependency as blocked with the exact action needed, and leave that phase partial when required proof is missing.
