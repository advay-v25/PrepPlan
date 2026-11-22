# Roadmap agent handoff — browser and reliability closeout

Use §9.22 of [the master status](MASTER-STATUS-AND-COMPLETION-PLAN.md), the journey matrix in [the Calendar closeout](CALENDAR-JOURNEY-CLOSEOUT-NEXT-AGENT-PROMPT.md), and AGENTS.md. Use the existing browser harness, fixtures and commands. Keep class-aware rollover and forecast implementation for the following slice. Preserve the passing rehearsal start, answer retry and Coach fallback paths.

## 1. Establish that fixture runs use the intended bank

- Tighten `scripts/lib/bankMode.ts`. It checks only the first 300 IDs for presence, accepts a record if any listed item exists, and counts reviewed items from the entire database. A held-out-only, partial or unrelated record can therefore pass with help from other inventory. Validate the full record in bounded batches against the appropriate eligibility view and the required reading/outcome scope. Fail on a read error. Keep actual-bank unavailability and fixture setup failures distinct.
- Use separate routine and held-out fixture records. Assert the IDs or families pinned to each scored attempt, including follow-up checks, against the intended routine record. Prove genuine freshness with the delivery and family exclusions in `itemPool.ts`. Where exact membership is needed, use a fixture-only inventory or a test scope that can only draw from the intended readings. Keep server eligibility and student APIs intact. Prove the negative path by giving a routine suite a wrong-pool or insufficient record while unrelated inventory is present.
- Run the actual-bank mode of `rehearsal:start:race` independently of any held-out fixture. Confirm that a real shortfall starts nothing and links to Calendar. Keep the existing passing fixture race as regression evidence.

## 2. Prove the latest answer survives reversed write order

`AttemptRunner` ignores an older response in React. The SQL write still accepts the last request that reaches it, and the contention suite only asserts that one row contains *one of* the submitted choices. A green check does not establish that the stored answer agrees with what the UI showed as saved.

- Force choice A to reach the server after the newer choice B has committed. Assert B in the owned attempt read, after reload and in finalisation, including its confidence. Cover answer and confidence edits, a lost response with same-choice Retry, and the last question. Capture which path actually reproduces the inconsistency.
- Apply the smallest ordering change that works through the normal runner and answer command. Define how overlapping changes in two tabs are accepted or refused, with a recoverable refresh or retry. Verify that a stale request cannot silently replace a confirmed newer answer, retries do not duplicate evidence, and the server deadline still controls finalisation. Keep the existing save-failure copy and retained draft behavior. If durable ordering needs a migration, rehearse it on an isolated full schema and then refresh the baseline.

## 3. Run the full browser matrix in this slice

Start the guarded local app and use ordinary students with disposable fixtures. Use desktop and 390 px. Run actual click-throughs and record the result at the final page. HTTP or SQL checks may support a result. Mark a journey incomplete when the browser did not reach its expected end.

| Journey | Required browser evidence |
|---|---|
| Fresh self-study with scored Sunday paper | Monday–Saturday work, confirmed scope, mandatory confidence, refresh to the same attempt, scored result, Keep for later → Review follow-up without reload, repair in Calendar and weekly closure. |
| Midway entry or first pass complete with mock in a month | Reported coverage stays distinct from scored evidence, revision fits the week, and the booked mock, prep and exact links agree across Curriculum, Home and Calendar. |
| Class change after preview | Move a real class, including a next class outside the viewed week. Stale draft refuses, answers survive, and current Calendar shows the correct boundary. Record rollover limitations for the next slice. |
| External mock and full rehearsal closure | Finish both paths separately. Verify assessment designation, both rehearsal clocks and sessions, correct debrief and one weekly closure receipt. External results stay self-reported. |
| Final week and history | Work respects the last study date. Show exam follow-up after the exam. Historical Calendar shows saved work, assessment and mock links, with no current-week controls. A future week reads as a forecast. |
| Lost accept response and stale scope in a second tab | Retry the committed draft and receive a single receipt. Stale scope cannot start a new attempt. A running attempt retains its pinned scope. |

If capacity is limited, do the scored paper and the two closure paths first at both sizes. Capture exact steps, IDs or receipts scoped to the test run, and the first failing request for each blocked journey. Exercise the no-paper planning path separately against the actual bank. Delete records by the run manifest and stop only processes started for the run.

## 4. Collect measurements that explain the remaining risks

- **Tests page.** `tests-page-measure.ts` currently labels counts from raw review status as eligible. Use the same eligibility and student exposure rules as the serving path. Record raw inventory, eligible routine and held-out inventory, fresh counts for the student's scope, and read counts tied to each request. Measure no-history and representative-history students with fixed inventory, with sequential and bounded contention samples. Record p50, p95, max and any timeout stage. The 89-second request and the older answer timeouts stay unclassified if they do not recur. Keep the prior 42 successful saves as separate evidence.
- **Coach live provider.** `src/lib/coach/model.ts` returns only message content to its caller, losing metadata that can distinguish an empty completion from token exhaustion. Run a bounded synthetic probe and capture status, configured model, request ID, finish reason, elapsed time, token usage, and whether visible or reasoning content was present. Use lengths or presence indicators only. Change one variable at a time if the evidence points to response format, budget, provider latency or endpoint compatibility. Preserve deterministic fallback, validated wording, and the rule that the server owns schedule, links and proposals. Report validated live text separately from fallback. A stub agreement run cannot establish live provider health.

Run TypeScript, `npm run verify`, the affected fixture and actual-bank suites, and the focused ordering/replay tests. Report what was clicked in Browser, what passed through HTTP or SQL, what still needs attention, and whether the results support moving to class-aware rollover and a read-only forecast.
