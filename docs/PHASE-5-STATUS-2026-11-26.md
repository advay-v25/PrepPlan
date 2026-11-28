# Phase 5 CLOSED · software · 26 Nov 2026

## Verdict, reported separately
| Track | State |
|---|---|
| Software acceptance | **Phase 5 closed.** Gates and browser proof pass on the final source. Carried forward: the 390 px hydration mismatch (open, capture in place). |
| Importer compatibility | The tree's importer still rejects the current `.2` bank file. Patch and decisions are with the bank owner's queue, not yet delivered: `docs/patches/reference-bank-format-2-handoff.md`. |
| Question-bank availability (separate release gate) | No approved questions in production (26 Nov report: 0). |
| Release readiness | Not ready: approved bank, live provider checks, app not deployed, tree uncommitted. Migrations 20270211 and 20270212: applied to production per the owner; not re-verified here. |

Final source fingerprint `71c0a48cedfe1195` (1050 files), identical at the start and end of the final run.

## Closeout decision and Phase 6 handoff

The checkout fingerprint was independently recomputed and matches the source tested in this report. The recorded main browser run passed 186 checks at desktop and 390 px, with the fixture CAPTCHA spec outside that run. The fault-proxy run passed 30/30, the production-build proxy run passed 34/34, and the production Calendar save run passed 4/4. This review checked the evidence record and source fingerprint.

Include unaccepted new study as **provisional demand** in Phase 6 when the active roadmap still calls for first-pass work. Use only named, unfinished work the planner would consider before the exam. Exclude already accepted or carried work and respect the chosen mock or recovery path. If this extra demand changes whether catch-up fits, show the trade-off. It creates no accepted task, completion credit or shortfall week.

Carry forward the open 390 px Calendar hydration mismatch, the audit of other server-rendered forms for early-input loss, and the Home performance check for students with owed work. The bank owner's format `.2` decisions and the documented release checks remain open. Treat production migration status as owner-reported until the target ledger and checksums are verified through an authorised read-only check.

Next assignment is in [PrepPlan Phase 6 agent prompt](PREPPLAN-PHASE-6-AGENT-PROMPT.md).

## 1. Catch-up uses usable time
`src/lib/planning/usableTime.ts` now gives the mock forecast and the catch-up status the same capacity: availability less protected commitments and timed mock bookings, less accepted work, on study days. `recovery/catchUp.ts` first places booked mocks' debrief and follow-up and unplanned open repairs, then provisional demands, then each owed piece once (study and revision across sittings; checks and repairs whole and within the sitting limit). Owed work already accepted on a coming day holds that time and is not asked for again. "Cannot clear" is decided on this, never on weekly hours added up; the status shows usable hours, what does not fit, and the provisional revision and papers with whether they make the difference.
Proven: unit cases, and a browser case at both widths where two students with identical study windows get "catching up" and "recovery offered".
Assumptions to confirm: provisional demands apply only to weeks with no accepted open work; revision per week is the current week's accepted revision; paper length is the latest paper's (none planned yet means none counted); new first-pass study not yet accepted is NOT counted, so the answer can be generous.

## 2. Calendar keyboard save: fixed
Cause and fix: `docs/evidence/phase5-intermittent-calendar-2026-11-26.md`. Regression `phase5-calendar-save.spec.ts` (request and saved row; slow load, half-typed time, deliberate day-only) passes at both widths on the dev server and the production build. `TaskDetailDrawer.tsx` held another worker's uncommitted edits; only the save path and the readiness gate were changed.

## 3. Mobile hydration mismatch: OPEN
Capture added (shared `login` helper) and proven with a self-check at both widths. No occurrence in the final run. Journeys that do not use that helper are not covered by it.

### The two earlier incomplete results, identified
- **31 of 32** (after the mock-led-week fix): 390 px `position-path` self-study; the lighter-draft expectation expired during a dev-server recompile; 3 of 3 repeats passed. **Neither Calendar finding.**
- **29 of 30** (final fault-proxy run of the previous round): 390 px `phase6-completion` error collector, the **hydration mismatch** (finding 2, still open).
- The desktop keyboard save was the single failure in the round before that (then 29 of 30, reported as 63 of 64 with the production specs): finding 1, now fixed.

## Gates and browser proof, final source
- `tsc`, lint, `npm run verify` (recovery 28, mock transition 39, sittings 19, extra windows 12), `contracts:local`, route audit, production build, secret audit (57 assets, 0 findings): pass.
- Full suite, desktop and 390 px: **186 passed, 0 failed, 0 skipped** (`phase5-closed-suite-2026-11-26.log`). Fault proxy and provider stub: 30 of 30. Production build behind the proxy: 34 of 34. Calendar save on the production build: 4 of 4. Not run: `turnstile-retry` (needs a fixture CAPTCHA build; unchanged area).
- Review benchmarks (15 warm samples): preview 91 / 102 / 102 reads (on track / catching up / recovery; before 88 / 99 / 99), p50 172 / 157 / 153 ms; GET 80 / 80 / 85. Home 65 and Calendar 83 reads for students with nothing owed (ceilings 69, 90). A student with owed work on Home pays additional capacity reads; not separately benchmarked.

---

# Earlier record (superseded where it differs)

# Phase 5 closeout 2 · planning gaps · 26 Nov 2026

Local stack only. Production, providers and the app deployment were not touched. Nothing committed.

## Verdict, reported separately
| Track | State |
|---|---|
| Software acceptance | The three planning gaps are built and proven locally. Open: two browser intermittents (cause unknown) and the question-bank owner's approval of the format `.2` patch. |
| Question-bank availability | None in production (26 Nov report: 0 questions; no paper, re-check or mock can start). |
| Release readiness | Not ready: empty bank, live provider checks, migrations 20270211 and 20270212 not in production, app not deployed, tree uncommitted. |

Final source fingerprint `729306d501b39904` (1047 files), identical before and after the final gates and after cleanup.

## 1. Later weeks
`src/lib/exam/runwayForecast.ts` replaces the weekly-total estimate. Each study day up to the two-week runway uses Calendar's free ranges (availability less recurring and one-off commitments and timed mock bookings), less accepted timed and flexible work. Claimed first: carried work with no future day, open repairs without a task (30 min each), and booked mocks' debrief and follow-up on later days. Then named readings, whole, within the sitting limit, in contiguous gaps of at least 15 minutes, under the daily new-learning cap. Weeks after the proposed one are labelled forecasts, with usable hours, on the Roadmap and in Weekly Review. When the weekly total is larger than usable time, the recommendation states both.
Proven: unit case and a browser case where the same weekly study hours go from "more revision" to "start with gaps" once commitments leave ten minutes a day.
A draft week turns mock-led only when a mock can actually go into it (found by `position-path`, fixed).
**Not deducted:** routine revision and weekly papers not yet accepted for future weeks; a date-only mock. **Not changed:** the recovery status's "can it still clear" still uses the weekly study total.

## 2. Added windows
Order: carried work, then a recommended mock sequence, then eligible new study or revision from the current Roadmap (planner rules, sitting limit, daily cap). New items are named "New, optional", saved timed and optional, and can be switched off. Waiting carried and new work is listed. Windows and placements are saved by one review acceptance; weekly availability is unchanged.

## 3. Long carried tasks
Study, review and class consolidation split into even ordered sittings in real gaps; what fits is proposed and the remainder is saved as a waiting sitting. The first sitting is the one continuation of the original; the others are siblings in its split group, each declared after the previous one. Minutes add up to what is owed and all are counted by catch-up. Repairs, checks and re-checks stay whole and state the opening they need; an added window long enough takes them. A timed mock is never split.

## Migrations (local only)
`20270211_week_extra_windows.sql` and `20270212_continuation_sittings.sql` (adds `continuation_parts`; patches weekly acceptance to save sittings and check room for each; keeps the estimate label on sibling sittings). Both must reach production, with authorisation, before this code deploys.

## Database rehearsals
`docs/evidence/phase5-closeout2-rehearsals-2026-11-26.txt`, each in a fresh temporary loopback database: contract 14 checks; install and upgrade 161 migrations, 0 pending, 0 checksum mismatches; restore 32 checks.

## Reference bank format `.2`
No question-bank owner was reachable from this session, so their file is **unchanged** and still rejects `.2`. Proposed patch: `docs/patches/reference-bank-import-format-2.md` (applies cleanly). A patched copy against disposable databases passed 33 checks (`docs/evidence/phase5-reference-bank-format2-verify.log`): current `.2` file 1,230 drafts (190 held out), `.1` 536 drafts, invalid files leave no rows, retries insert nothing, nothing eligible or approved.

## Software gates (final source)
`tsc`, lint, `npm run verify` (mock transition 39, sittings 19, extra windows 12, recovery status 19), `contracts:local`, route audit, production build, client secret audit (57 assets, 0 findings): pass.

## Browser proof, desktop and 390 px
- Full suite including `app-audit`, `app-audit-paper`, `class-editing`, `focused`, `phase5-nokey` (all passed): 178 passed, 2 failed, 0 skipped. Both failures were the mock-led-week bug above. Log `docs/evidence/phase5-closeout2-suite-2026-11-26.log`.
- After that fix, `position-path`, mock (4) and recovery (7) journeys: 31 of 32; the one mobile wait expired during a dev-server recompile and passed 3 of 3 repeats. The rest of the full suite was not repeated after this one-condition change.
- Fault-proxy and provider-stub specs on the final source: 29 of 30 (the hydration intermittent below). Production build behind the proxy: 34 of 34.
- **Remaining skip:** `turnstile-retry` needs a build with a fixture CAPTCHA site key; the auth security script it covers was not changed in this work.

## Open intermittents (cause unknown)
`docs/evidence/phase5-intermittent-calendar-2026-11-26.md`: (1) desktop keyboard placement saved no start time, 1 in 4; the trace shows the app sent `startMinutes: null` about 0.1 s after page load. (2) 390 px Calendar agenda hydration mismatch, once; 24 further runs clean; differing element not captured. Passing retries show recovery only.

## Performance (production-style build, 15 warm samples)
| Persona | Review GET reads/RPC, p50/p95 ms | Preview reads/RPC, p50/p95 ms | Earlier today preview |
|---|---|---|---|
| On track | 80/2, 153/172 | 88/4, 169/195 | 86, 131/137 |
| Catching up | 80/2, 129/141 | 99/4, 159/167 | 97, 128/132 |
| Choosing recovery | 85/2, 128/142 | 99/4, 165/172 | 97, 129/131 |
The forecast adds 2 reads and roughly 30-40 ms to a preview. Home 65 and Calendar 83 reads (ceilings 69 and 90), unchanged. `phase5-review-trace2-stack.json`, `phase5-final2-stack-2026-11-26.json`.

## Editing incident
A scripted edit truncated `src/lib/planning/weeklyReview/service.ts`. The lost tail was restored from the source map of the previous round's production build and verified identical to that original, then edited as intended; all gates and journeys above ran afterwards.

## Cleanup
My servers, fault proxy and local database are stopped. Browser output and per-run JSON are in the session scratch folder; screenshots and closeout JSON that specs rewrite in `docs/evidence` were left. Stack files remain under `/tmp/claude-501/stack`.

---

# Earlier record (superseded where it differs)

# Phase 5 closeout · 26 Nov 2026

Local isolated stack only. Production was not touched in this pass (the earlier read-only bank report stands). Nothing deployed, committed, published, mailed or spent.

## Verdict, reported separately
| Track | State |
|---|---|
| Software closeout | Product changes built and proven locally. **One check open:** the reference-bank import rehearsal rejects the current bank file. One browser intermittent recorded below. |
| Question-bank availability | None. Production report of 26 Nov: 0 candidates, 0 approvals, no paper, re-check or mock can start. |
| Release | Not ready: empty bank, live CAPTCHA and the other provider checks, migration 20270211 not in production, app not deployed, tree uncommitted. |

Final source fingerprint `282f267ff8c813e9` (1043 files). Static gates ran on `e244e6108dae0df9`; the only change afterwards is the `phase2-truth` spec fixture, after which `tsc`, lint and `verify` were re-run. HEAD 2fdce1d, nothing staged, other workers' edits preserved.

## Product decisions as built
1. **Meaningful revision.** No share cutoff. Remaining first-pass readings are placed whole, in Roadmap order, into the weeks before a two-week mock runway (proposed week: its free minutes; later weeks: weekly study time). Any finishable named reading means more broad revision; none, or no room, means start mocks with open areas named. Roadmap and Weekly Review list the work, what continues after the mock, and the trade-off. Limit: later weeks use total weekly study time, not time net of other future work, so it can be optimistic.
2. **Editable estimates.** 45/60 by default, 15-240, edited in the Weekly Review proposal; the draft rebuilds at once and shows placed, split and waiting parts. Saved on the accepted review and used next time. Accepted work is never rewritten.
3. **Partly done.** Owed = planned less logged (PrepPlan's estimate, labelled) unless the student states a remainder. Logged minutes stay on each session; the obligation is counted once on the newest link, including a partial in the current week. Logged past plan leaves a 15-minute estimate. The 20 + 25 case is proven by unit and browser tests.
4. **Add time.** Specific windows for the proposed week, refused over booked or passed time, each showing what it takes; the remainder and its effect on revision and mocks are stated. Saved with the placement by the same review acceptance; weekly availability unchanged. Limits: windows take carried work and mock pieces only (not newly generated study or revision); a carried task longer than the sitting limit still needs splitting in Calendar.
5. **Formal recovery.** Same trigger over the last four closed weeks. Empty weeks, weeks with unanswered tasks and weeks the student marks as a planned break (new checkbox in Weekly Review) are not shortfalls; their work is still owed.

## Migration
`supabase/migrations/20270211_week_extra_windows.sql` (new, **local only**): adds `window_free_spans` and `extra_window_conflict`, and patches `accept_weekly_transition` so window work is saved timed after an exact-time check. It must reach production, with authorisation, before this code is deployed.

## Database rehearsals (each in a fresh temporary directory, loopback server, deleted afterwards)
Evidence: `docs/evidence/phase5-closeout-rehearsals-2026-11-26.txt`. No command was refused by the permission check this time.
| Command | Result |
|---|---|
| `rehearsal-db-test.cjs --local` | 14 checks passed |
| `beta/install-rehearsal.cjs --local-only` | 160 migrations, 0 pending, 0 checksum mismatches, 0 without a ledger row; schema and empty-data checks passed |
| `beta/install-rehearsal.cjs --upgrade --local-only` | Same counts and checks |
| `beta/restore-rehearsal.cjs` | 32 checks passed |
| `reference-bank-import.cjs --local` (default file) | **FAILS, open:** file is `reference-draft-bank.2`, importer accepts only `.1` |
| same with `--file=` the 25 Nov `.1` baseline | 536 drafts into the temporary database; idempotent, changed content refused, atomic rollback, 0 learner-eligible |
The hosted-source comparison was omitted by `--local-only`. The reference-bank scripts belong to another worker and were not edited.

## Question challenges (synthetic items, desktop and 390 px): passed
Student result proves: **pending** stays in the score, marked "under review, counted for now", and its evidence is excluded; **kept** restores that evidence and clears its label while the other stays pending; **voided** leaves the denominator once (unchanged on reload), is named by its original question number, and the concept's valid-evidence count reflects it. Reviewer decisions are driven in the same journey.

## Weekly Review performance (production-style build, 15 warm samples each, same setup)
`docs/evidence/phase5-review-trace-stack.json`. Personas are confirmed from the response.
| Persona | GET reads / RPC, p50 / p95 ms | Preview POST reads / RPC, p50 / p95 ms |
|---|---|---|
| On track | 80 / 2, 121 / 132 | 86 / 4, 131 / 137 |
| Catching up | 80 / 2, 111 / 116 | 97 / 4, 128 / 132 |
| Choosing recovery | 85 / 2, 113 / 116 | 97 / 4, 129 / 131 |
Phase 4 (catching-up shape): GET 79, preview 93 at 134 ms; earlier today 105. The increase came from the mock and recovery loaders re-reading the week, booked time, capacity, closed weeks and logged events, and from the mock loader computing the whole recovery status. Fixed with one read snapshot per preview, request-scoped week/busy-time/capacity/placement/log-event loaders, and a narrow read of the accepted path. The concurrent-change check is not cached. Four reads over Phase 4 remain for catching up (new questions: saved estimates, planned breaks, logged minutes). Home and Calendar: 65 and 83 reads (ceilings 69 and 90).

## Final sweep
- `tsc`, lint, `npm run verify` (unit suites: mock transition 31, recovery status 19, extra windows 12), `contracts:local`, route audit, production build, client secret audit (57 assets, 0 findings): all pass.
- Main browser suite, desktop and 390 px: 144 passed, 2 failed, 0 skipped. Both failures were `phase2-truth`, a date-dependent fixture (only one past class on a Thursday morning); widened by one day, 2/2 pass. Log: `docs/evidence/phase5-closeout-suite-2026-11-26.log`.
  - Includes the 3 mock and 5 recovery journeys at both widths (three original recovery cases, partly done, and add time with an overlap refusal, a stale draft and a lost save reply).
- Fault-proxy and provider-stub specs: 29 of 30. **Intermittent, unexplained:** desktop `phase6-completion` Calendar keyboard placement read no start time after Apply once; 3 of 3 repeats and the 390 px run passed.
- Production build behind the proxy: `phase5-closeout`, auth, public walkthrough, settings 34/34.
- **Not run:** `turnstile-retry` (needs live CAPTCHA), `class-editing`, `focused`, `app-audit`, `app-audit-paper`, `phase5-nokey`.

## Cleanup
My app servers, fault proxy and local database stack are stopped. The system Postgres on 5432 is not mine and was left alone. The stack's files remain under `/tmp/claude-501/stack` (GoTrue v2.196.0 was rebuilt there from its official repository after a restart cleared it). Browser output and this pass's per-run JSON were moved to the session scratchpad; specs that rewrite screenshots or closeout JSON in `docs/evidence` left those changes.

## Earlier Phase 5 record
Production capacity report: `docs/evidence/phase5-capacity-production-2026-11-26.txt`. Owner actions: `docs/PHASE-5-OWNER-RELEASE-CHECKLIST.md`.
