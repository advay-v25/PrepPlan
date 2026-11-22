# Roadmap — finish Journey A and prove it in the browser

Prepared 13 November 2026 after master status §9.31. This is a bounded continuation of `LIFECYCLE-CLOSEOUT-AND-COACH-SAFETY-AGENT-PROMPT.md`.

## Assignment

Finish **one complete fresh-self-study lifecycle**, including trustworthy assertions and desktop/mobile browser proof. Fix defects it reveals. Do not start another broad Coach redesign, add source packs or declare the whole three-journey brief complete.

The shared `apply_task_move` boundary and the delivered Coach work remain in place. Journeys B and C have useful smoke coverage but are still incomplete. Their outstanding class/revision/internal-rehearsal/final-week paths are the following slice. Private source packs and the provider input-use gate follow that. Keep these remaining obligations visible.

Read `AGENTS.md`, Ponytail, founder decisions, the prior lifecycle prompt and master status §§9.30–9.31. Preserve unrelated dirty changes. No commits, pushes, deployment, payments, domain/auth work or approval-policy changes. Read the installed Next.js guide before framework changes. Use the configured disposable development project only through existing target guards; `.env.staging.local` is not proof of a separate staging project.

## 1. Fix the current runner's proof before relying on its results

The owner-review pass inspected `scripts/e2e-lifecycle.ts` and `scripts/lib/e2eSession.ts`. It independently reran 121 interpretation checks, 43 action checks and the route audit successfully. It did not rerun the lifecycle, database race suites or browser matrix.

Reproduce and correct these specific test defects:

| Current gap | Required correction |
|---|---|
| A is not a fresh candidate | `fresh('lcA')` uses default onboarding: `first_pass_underway`, three exposed topics, a booked February exam and London timezone. Give A an explicit fresh profile, zero reported coverage, a distant tentative window and deliberate realistic availability. Preserve defaults other suites rely on; do not silently alter all fixtures. Assert saved state. |
| Evidence assertion always passes | The result step uses `count(...).catch(() => 1) >= 0`. Remove this. Assert exact expected evidence identities/counts, source attempt, valid concept/outcome mappings and no evidence for the omitted question. Database read errors fail the assertion. |
| Logging retry is not a retry | The second learning-log request can use a different key and its result is ignored. Send the exact same payload and stored request key twice; assert one activity and one intended set of related records, with the same receipt. |
| Spacing refusal is not asserted | The early re-check request's response is only printed. Assert its actual waiting/refusal state and unchanged task/link counts before eligibility. |
| Derived spacing state is forced | The runner manually sets `next_recheck_due_at`, and may directly move a re-check row. Do not claim that proves the scheduling path. Use consistent dated completion history through existing guarded fixtures, let the production service derive eligibility, then place through the real command. Clearly distinguish any unavoidable time-fixture setup from tested commands. |
| Keep for later is not exercised | Finding result links on Home/Tests is not the Keep-for-later action. Use the actual follow-up control, leave, reload, rediscover and accept the same follow-up. Assert its identity and that no repair was scheduled while it was kept for later. |
| Any 200 is treated as exact selection | After a Calendar link, assert the intended task/drawer is selected. A generic Calendar page returning 200 does not prove the link worked. |
| Weekly credit can be silently bypassed | The runner retries review preview with `acknowledgeNoPaper:true` if the scored-paper path fails. For the diagnostic journey, require the correct credit/gate and fail if it is missing. Exercise acknowledgement only as a separately labelled legitimate no-paper branch. |
| Lineage/effort proof is too narrow | Summing two task-event columns does not prove the application's week totals or effort aggregation. Assert the reported-time/pace/lineage read models used by the app, both cycle IDs, preserved original status and exactly-once effort attribution. |
| Smoke and incomplete reports can exit as success | Record per-journey completeness and required missing steps. Required fixture-mode failures/unavailable/not-run steps must not produce a complete-success result. Actual-bank shortage remains a labelled expected limitation, never a diagnostic pass. Invalid scenario/bank arguments must fail before mutations. |

Also replace static IDs such as `lcA-partial` with run-owned identifiers. Use unique evidence filenames/run IDs so reruns do not overwrite prior evidence. Validate the database identity before fixture creation. Keep the immediate account registration and failure cleanup improvements.

Do not replace a failing assertion with a heading check, weaken access gates, ignore query errors or convert product failures into UNAVAILABLE. Test a deliberate broken evidence source and a missing required phase to prove the runner now fails correctly.

## 2. Make the time and bank fixtures honest

The existing runner extends a Friday cycle by six days, shortens it again for closure, and updates derived re-check timing. These are useful state probes; they do not prove the original self-study recurrence or end-to-end time progression.

Keep Monday–Saturday learning and Sunday verification intact. Verify cycle boundaries explicitly, including a midweek join and the following accepted cycle. Do not lengthen a self-study cycle beyond its real boundary just to make repairs fit. If insufficient time remains, assert honest waiting/next-cycle placement through the real weekly continuation path.

For elapsed-time cases, use existing guarded test seams or consistent run-owned dated fixtures. Record each time transition, source event and affected record. Do not add a production clock override or a bypass flag. Prove before-due and after-due behaviour against the same eligibility service; do not set the derived answer and then test that it is present. A fixture that cannot represent a real calendar week must not be reported as proof of recurrence.

Use a sufficient routine fixture bank with explicit reviewed versions and independent families. Assert every delivered question belongs to that recorded bank and only to the completed/confirmed scope. Keep held-out rehearsal inventory separate. Do not promote real items or manufacture production approval records.

The actual-bank track must distinguish genuine content from synthetic fixture inventory left by another active worker. If contamination prevents a meaningful actual-capability measurement, report that exact limitation without deleting another worker's bank. Zero approved genuine inventory is an honest no-paper path; it must not end planning access.

## 3. Required fresh-student flow

Use one ordinary student throughout each viewport run. Do not seed the scored result, repair, continuation or acceptance outcome the journey claims to create.

1. **Onboarding:** complete the real UI with the explicit fresh profile, tentative exam month, study windows and sitting limit. Reload midway and confirm saved progress. Accept the first useful remaining-week plan. No required uploads/sources, feasibility denial or invented past study.
2. **Calendar and Curriculum:** finish a planned block, record another partly done with actual minutes, leave one unfinished/deferred, and record independent learning through the quick capture or existing log. Assert correct reading/LOS/date links across Curriculum, Calendar and Home. Reported coverage and activity must not create demonstrated understanding.
3. **Scope:** include confirmed completed/manual learning and exclude unfinished work. Unconfirmed scope is shown separately. Confirm scope in the UI where required. Preview is read-only; reservation freezes scope, difficulty/eligibility/scoring policy and item versions.
4. **Weekly diagnostic:** start the evidence-bearing weekly paper. Require confidence for answered items. Include a confident wrong answer, an uncertain correct answer and one omission. Refresh, resume and submit. Assert the score ledger, answer count, omitted denominator and exact evidence source.
5. **Result and Coach:** open that selected result. Coach uses its actual findings and limitations, does not teach or guarantee passing, and links to that result/follow-up. Select a different or unavailable result and prove it cannot silently use the original/latest result.
6. **Keep for later:** activate the real follow-up choice. Leave the result, reload Home/Tests/Coach and rediscover the same follow-up. No repair work appears before acceptance. Preview, accept once, lose/retry the response and get the same receipt/task set.
7. **Repair and re-check:** open the exact accepted task in Calendar, record completion, and verify work completion alone does not resolve evidence. An early re-check remains waiting with no duplicate task. Once legitimately eligible in the dated scenario, place/start through the normal command using fresh independent families and intended concepts only. Assert the current resolution policy precisely, not merely `latest_check_state != null`.
8. **Weekly closure:** resolve required activity logs. The scored weekly paper gives the correct checkpoint credit. Record partial/unfinished dispositions separately from next actions, prepare/save the next-week draft and accept it. A lost acceptance response replays one closed week, one next active cycle and one continuation chain.
9. **Continuity:** 20 minutes in the old partial task plus 25 minutes finishing its continuation produces 45 reported minutes, split 20/25 across the correct weeks. Curriculum mapping, objective, method and repair lineage survive. Effort is counted once. Old links open the historical original with its successor; the original history is not rewritten.
10. **Practice control:** take a separately labelled adaptive-practice branch on valid covered scope. It writes no diagnostic evidence, repair or weekly-paper credit. Compare the actual relevant state before/after, not only the number of weekly attempts.

If an accepted first week contains too few tasks for a particular assertion, choose legitimate availability/curriculum fixtures that generate the required work or test the actual small-week behaviour. Do not insert arbitrary completed scope and call it proof that the planner produced a complete fresh-student journey. Label any supplementary task fixture separately from planner output.

## 4. Browser proof is a required deliverable

Start by proving the browser harness can run locally before beginning a long database pass. Use Browser when available; otherwise installed Playwright and state the fallback. Save a repeatable browser spec/helper in the existing test structure. Do not leave the browser flow as an unrecorded manual exercise or finish with “browser matrix not run” again.

Run at desktop and 390px with separate ordinary students. Important steps must be driven through the UI: onboarding, partial/log capture, scope/start, representative runner answers, result, Keep for later, follow-up acceptance, selected Calendar drawer, Coach interaction and weekly review. For lengthy papers, remaining answers can use the real answer API; document the split and submit in the browser. The API must not pre-score the result before the claimed browser submission.

Add these focused controls:

- Correctly selected scored result versus practice result in Coach; no fabricated evidence/repair from practice.
- Lost send, repair-confirm and weekly-accept responses **after commit**; retries return the same durable outcome. Also test an actual pre-commit failure, which must not claim success.
- A second tab changes scope after preview; start refuses without an attempt/form.
- Two browser contexts race Clear versus Confirm in both controlled orders; confirmed changes survive, cancelled pending work cannot revive, and both screens report the durable result.
- Provider outage in the page: obvious requests still work; unresolved mutation wording gets useful clarification, not a guessed action.
- A task moved through Calendar's actual edit/drag control, including a deferred-task reopen with one `moved` event carrying `reopened:true`, plus a Coach move reflected in the same Calendar view. SQL parity alone is not UI integration proof.
- Exact-date/same-day-time and morning-only-window behaviour, sitting limits and the exam horizon. Reproduce any real failure and fix it through the existing shared boundary, preserving Calendar's explicit soft-overlap policy.
- Actual-bank shortage shown to a student while Calendar/logging/review remain usable; no broken paper-start action.

Check focus order/return, keyboard and IME, input preservation after failures, long labels, console/hydration errors, stale/loading/unavailable copy and no horizontal overflow. Assert persisted IDs/status/minutes after each important mutation, not just visible headings.

## 5. Class-log fingerprint decision and deferred scope

Keep **effect-based staleness** for class-log previews: an unrelated commitment need not force another review when it changes nothing material. This is acceptable only if confirmation revalidates against current constraints under the proper lock and the fingerprint covers every material reviewed effect, not placement alone. Scope/mapping, duration/load, verification timing, waiting work and commitment conflicts must not change silently. Preserve a test where an irrelevant change stays valid and one where a material change refuses atomically.

Do not broaden this slice into implementing direct Coach class/exam/availability edits. Honest exact-editor handoffs are allowed. Likewise, appointment/rehearsal/LOS selection and the full class-led/mock journeys remain recorded obligations for the next slice rather than being called complete here.

Do not optimise the whole operating-state layer in place of completing this flow. Measure Home/Coach next-action latency/read counts on this run and record the cost; fix only a reproduced blocking timeout or obvious duplicate load on the touched path. Older heartbeat/run-state outliers remain unclassified without evidence.

## 6. Verification, cleanup and handoff

Run full `npm run verify`, TypeScript and the affected learning-log, scope, paper/result, repair, weekly-continuity, Home, Coach and task-move regressions. Run the corrected Journey A fixture track and the honest actual-capability track. Any additive migration needs effective-function comparison, install/upgrade/restore and current ledger/checksum proof; never edit an applied migration or restore an older function over later fixes.

Before remote mutations, preflight the intended local server and bank/test target. Register every created resource immediately, namespace task IDs, and clean by recorded owned IDs. Check cleanup errors rather than swallowing them and claiming all fixtures gone. Stop only owned process handles; no broad process-kill or port-based guessing. Restore generated types through the existing helper and preserve other workers' fixtures/files.

Update the master status and evidence JSON with:

- actual onboarding inputs and accepted cycle boundaries;
- source attempt/kind, reserved form/items/families and exact evidence/repair lineage;
- every labelled time-fixture transition and which behaviour it can/cannot prove;
- desktop/mobile steps actually driven in the browser, endpoint-only supplements and unavailable/failed/not-run cases;
- acceptance/retry receipts, before/after counts and meaningful negative-control results;
- verification, schema, cleanup and measured latency/read counts;
- explicit `complete` status for Journey A only, plus the still-open B/C/content obligations.

Finish with a short handoff. Do not report all three journeys complete, diagnostic availability from fixtures, or an elapsed-time rule proven by writing its derived due field. The next prompt will finish class-led Journey B and mock/revision Journey C using this repaired harness; source-pack preparation follows.
