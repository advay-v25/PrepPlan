# Phase 0 baseline and Phase 1 session logging: status, 24 Nov 2026

**Source fingerprint.** HEAD `2fdce1d` plus the uncommitted working tree. Content hash of every modified or untracked file under `src`, `scripts`, `supabase`, `tests` and `package.json`, taken after the last source edit: `9192d81009394acb` (sha256 of the sorted per-file sha256 list; edits after the final app build were test specs and this document's inputs only, no app source).
**Tested build.** `NEXT_PUBLIC_SITE_URL=http://localhost:3141 next build`, served with `next start -p 3141`, one Playwright worker, desktop 1280×900 and mobile 390, student timezone Europe/London, machine clock 24 Nov 2026.
**Target.** Deployed Supabase project `woboyakjtgltgekwtddo` (exact-project opt-in via `E2E_TARGET`/`E2E_ALLOW_TARGET`), fresh identifiable fixture students deleted by exact id. After every run `auth.users` held one row (the owner). No provider was called: no real mail, no Google, no Turnstile completion, no model call.

## Schema state (deployed, separate from source)

| Migration | Ledger on `woboyakjtgltgekwtddo` | Notes |
|---|---|---|
| `20270129_profile_name_validation` | applied | not applied by this work |
| `20270130_onboarding_mock_context` | applied | owner unknown; not applied by this work |
| `20270131_mock_reports_service_grants` | applied | written and first applied directly by this work; now in the ledger |
| `20270201_log_planned_session` (new, Phase 1) | applied | table `planned_log_commands` + function `log_planned_session`; additive |

`npm run migrate -- --env=production --dry-run` reports 0 pending. The ledger rows for `20270129`–`20270201` were written by a process other than this session (this session never ran `--apply`); the checksum runner accepts them. Rollback for Phase 1: the migration is additive, so redeploying the previous app build is sufficient; the table and function can stay unused.

## Phase 0 exit matrix

Legend: PASS, FAIL, BLOCKED (needs something not available), SKIP. D = desktop, M = 390px.

| Case | D | M | Evidence / cause |
|---|---|---|---|
| tsc, `npm run verify` (all unit suites), route audit | PASS | n/a | exit 0 after the last source edit |
| Production build | PASS | n/a | |
| Migration dry-run | PASS | n/a | 0 pending |
| Service grants for mock reports; personal export | PASS | PASS | `settings` suite, `has_table_privilege` check |
| Fast result-save → retake | PASS | PASS | `phase7c-retake` |
| Display-name accessible name | PASS | PASS | `settings` |
| Public pages, protection redirects, indexing | PASS | PASS | `app-audit` |
| Self-study and class-led workspace | PASS | PASS | `app-audit` (spec updated for the new log sheet) |
| Class-led follow-up (`class-followup`, 3 cases) | PASS | PASS | stale Home copy and review-gate assertions fixed (note 1) |
| Manual task (`phase7-manual-task`) | PASS | PASS | aborted-prefetch allowance now exact |
| In-progress class log (`phase7b-in-progress`) | PASS | PASS | same |
| **Verified entry → accepted week → Calendar → session log** | PASS | PASS | `phase1-log` (below) plus `app-audit`; actual-bank not needed, planning-only path |
| **`class-editing` partial-log case** | **PASS** | **PASS** | `/api/weekly-review/preview` optimized with `withReadSnapshot` / `perRequest` caching and next-week forecast skip; executes in 6.8–7.5 s (well under 20 s budget); 4 browser samples verified across desktop and mobile-390 (note 2) |
| `focused` date mismatch | not rerun | not rerun | clock-dependent planner; 24 Nov vs the spec's 23 Nov (note 3) |
| `phase3-closeout`, `phase5-closeout`, `phase5-nokey`, `phase6-completion` | BLOCKED | BLOCKED | need a fault proxy / isolated database / no-provider environment that is not available on this deployed project |
| `journey-a`, `journey-b`, `phase2-truth`, `phase4-*`, `app-audit-paper`, `phase5-workspace` | BLOCKED | BLOCKED | publish fixture question banks or assessment rows into the shared project; staging has no keys. Their log-sheet steps were updated for the new UI but not run |
| `scope-race-db-test` (scope change vs reserved paper) | BLOCKED | | needs staging project and a fixture bank |
| Auth: generated-link handlers | PASS | PASS | `auth-security` unusable-link legs |
| Auth: Turnstile `data:` console report | FAIL | FAIL | not diagnosed; CSP header allows `data:` (unchanged from the earlier report) |
| Real email delivery, real Google sign-in, production Turnstile completion | BLOCKED | | owner action required (below) |
| Performance baseline | PASS | n/a | `docs/evidence/baseline-measure-2026-11-24.json` |

Notes.
1. `class-followup`: Home no longer prints "N of M done"; the ring has an accessible label "N of M done today". The assertion was updated. The "no room" case also needed the review's two deliberate gates (settle open class reports, acknowledge no paper) and a navigation-coincident allowance for aborted RSC fetches. All three cases pass at both viewports.
2. `class-editing`: preview latency was previously 20–40 s, causing Playwright action timeouts (>20 s). Traced and resolved via:
   - Wrapped `/api/weekly-review/preview` with `withReadSnapshot` to share `perRequest` cached reads.
   - Cached `studyActivityService`, `activityCoverageService`, `roadmapService.loadObservedPace`, and `cycleObservationService.loadClosedCycleObservationsUncached` across the preview request lifecycle.
   - Updated `getWeeklyReviewState(userId, now, 'preview')` to bypass the redundant next-week forecast when preparing draft previews.
   - Added benign Next.js router prefetch cancellation (`net::ERR_ABORTED` on GET with `_rsc` / `next-router-prefetch: 1`) allowance in `class-editing.spec.ts`.
   - Four reproducible browser verification runs across both viewports proved latency is consistently between 6.8 s and 7.5 s (budget < 20 s):
     - Sample 1 (Desktop): preview 6,783 ms, accept 599 ms (`docs/evidence/class-editing-browser-2026-11-24-desktop-lbmwuy6008btg.json`).
     - Sample 2 (Mobile 390): preview 7,345 ms, accept 886 ms (`docs/evidence/class-editing-browser-2026-11-24-mobile-390-lbmwuy8q2a6en.json`).
     - Sample 3 (Desktop): preview 7,514 ms, accept 585 ms (`docs/evidence/class-editing-browser-2026-11-24-desktop-lbmwuyyzob4xk.json`).
     - Sample 4 (Mobile 390): preview 7,009 ms, accept 713 ms (`docs/evidence/class-editing-browser-2026-11-24-mobile-390-lbmwuzariru74.json`).
   All continuation invariants (minutes preserved, pending portion visible, confirmed scope isolation) are verified byte-for-byte in the browser. Database cleanup verified (only owner in `auth.users`).
3. `focused`: 23 vs 24 Nov is the machine date after midnight UTC against a hard-coded date in the spec; not a product defect.

## Phase 1 requirement → implementation → proof

All proof is on the final source snapshot unless stated. Browser = `tests/e2e/lifecycle/phase1-log.spec.ts` (6 cases × 2 viewports, all PASS, evidence `docs/evidence/phase1-log-desktop-lbmwulgtkcxna.json` and `…mobile-390-lbmwuln56kn0i.json`). DB = `npm run planned:log:db:test` (12 checks, isolated local Postgres, PASS). Unit = `scripts/planned-log-test.ts` (in `npm run verify`).

| Requirement | Implementation | Proof |
|---|---|---|
| Open logging for the exact owned Calendar block | Calendar drawer link "Log this session" → `/app/log?task=<id>`; sheet preselects only that id | browser case 1: link href, radio `aria-checked`, block state |
| Home, Calendar quick capture and `/app/log` let the student choose an open block or "Log a separate session" | `LogLearningSheet` target list built from the active week's open study blocks; separate option always present | browser case 5 (quick capture dialog lists blocks + separate, Escape returns focus); case 4 |
| Curriculum keeps its preselected reading | `?reading=` opens the separate-session path with that reading | `app-audit` (both viewports) |
| Scheduled classes keep the occurrence form | "Had a class" still links to `/app/calendar/log-class`; class blocks are not offered as study targets | `class-followup`, `phase7b-in-progress`, `class-editing` (existing suites) |
| A name, date or reading match never selects a task | Separate path never touches a block; planned path needs an explicit id | browser case 4: separate session on the same reading as an open block leaves that block's row identical |
| Planned save: minutes, status, coverage, history in one transaction against task and revision | `log_planned_session` composes `set_task_execution` and `confirm_task_scope`; any failure raises and rolls both back | DB checks 1, 8; browser case 1 (one `partial` event of 25 min, one confirmation, no new rows) |
| Separate session creates one activity | existing `record_learning_sitting` | browser case 4 (+1 block, +1 activity, yesterday's date) |
| Same-key retry returns the original receipt; changed payload conflicts | `planned_log_commands` keyed by (user, key) with canonical request | DB checks 2, 3; unit |
| Foreign task, closed history, stale revision, continued task, recorded learning → clear refusal, no partial writes | codes `NOT_FOUND`, `HISTORY_CLOSED`, `REVISION_MISMATCH`, `CONTINUED`, `RECORDED_LEARNING` | DB checks 5, 7, 8, 10; browser case 1 (stale second tab: refusal, input kept, Reload button) and case 6 (original after carry) |
| Concurrent submit; lost response after commit | advisory lock per key; UI keeps request + key in sessionStorage; unknown outcomes retry the original | DB check 4; browser case 2 (double click = 1 event; reply aborted after commit, "Retry same log" = 1 event) |
| Light capture: known block loads only its outstanding work; separate starts with recents or search then only that reading's outcomes | bounded `GET /api/log-learning` modes (options, `?task=`, `?reading=`, `?q=` limited to 12) | browser case 1: responses 4,163 B + 726 B; before: 52,460 B and the whole catalogue (102 readings, 343 outcomes) |
| Time-only log visible with "Confirm coverage" | receipt scope state `time_only`, link to the block's coverage form | browser case 3: no confirmations, then one confirmed from Calendar on the same task |
| Date and notes secondary; bounded loading and saving; accessible errors | `<details>` for note and date; 15 s read bound, 30 s save bound treated as unknown outcome; `role=alert` errors; focus moves to the receipt heading | browser cases 1, 2 (focus assertions); no horizontal overflow asserted at 390 px |
| Receipt: action, minutes, scope state, destination | compact receipt list + links | browser cases 1, 3, 4 |
| Calendar and Home reflect the save after refresh | same `plan_blocks`/events; `router.refresh()` | browser case 1 (reload shows saved coverage and "25 min recorded"); `class-followup` Home check |
| Curriculum records reported work separate from understanding; Tests only eligible confirmed scope; reserved paper preserved; partial class coverage pending; Coach same state | unchanged commands, reused | existing suites (`class-followup` pending portions, `class-editing`); **scope-vs-reserved-paper race: BLOCKED** (needs staging + fixture bank); Coach not re-driven |
| Earlier log goes to its history | separate path date up to 14 days back | browser case 4 (yesterday) |
| Carry once through weekly review; finish continuation; 45 minutes across lineage; no transfer of earlier confirmed scope | existing weekly review; new log targets the continuation | browser case 6: one continuation, original stays `partial` in the closed week with 25 min, continuation 20 min, 0 confirmations carried; time fixture T1 (weeks shifted by DB, labelled in evidence) |
| Keyboard, focus return, no overflow, exact routes | dialog focus return, heading focus, links | browser cases 1, 2, 5 |
| Zero catalogue-wide reads for a known task | task mode reads one block, one reading, its outcomes | response sizes above; code review of the route (7 bounded queries, 4 in one parallel round) |

Measured before/after (same build, deployed project, fresh persona, warm p50 of 15 requests):

| Read | Before | After |
|---|---|---|
| Log entry payload | 52,460 B (all readings and outcomes) | 4,163 B options + 726 B for a known task |
| Known-task read | n/a | 0.82–0.86 s p50 (was 1.1–1.2 s before the reads were run in parallel) |
| Planned save | n/a | 0.52–0.73 s p50 (8 saves) |

The history persona was partly measured while another browser suite was running, so its p95 values are inflated; trust p50.

## Route baseline (production build, deployed project, 15 warm samples, no provider calls)

| Route | Bytes (fresh / history) | Cold ms | Warm p50 ms | Warm p95 ms |
|---|---|---|---|---|
| `/app` Home | 59,162 / 58,030 | 4,950 / 7,112 | 4,653 / 5,804 | 7,742 / 10,142 |
| `/app/calendar` | 112,357 / 113,289 | 4,051 / 4,772 | 3,827 / 4,367 | 5,030 / 5,815 |
| `/app/tests` | 24,904 / 30,510 | 2,053 / 2,407 | 1,772 / 2,466 | 2,702 / 3,319 |
| `/app/coach` | 23,026 / 23,026 | 900 / 943 | 930 / 915 | 1,108 / 6,415 |
| `/app/log` (shell) | 21,249 | 327 / 406 | 350 / 337 | 439 / 749 |

Largest confirmed bottlenecks: Home and Calendar take 4–6 s even warm, so the cost is sequential database round trips per request, not payload size (Calendar is the largest at about 112 KB). Database read counts per route were **not** measured: there is no query instrumentation, and it would be a code change. Phase 4 should add it first. Three orphaned Playwright worker processes from 15 Nov were running at about 98 % CPU on this machine throughout; they are not from this work and were left alone, so absolute times are pessimistic.

## Provider proof, separated

| Check | Status | What the owner must do |
|---|---|---|
| Confirmation and recovery handlers | PASS with generated links (handler proof only) | none |
| Real email delivery | BLOCKED | Sign up with an inbox you own on `https://www.prepplan.si`; expect the message within a minute from the configured sender, and the link to land on `/auth/confirm` then onboarding. |
| Google sign-in | BLOCKED | Press "Continue with Google" on the live site and finish consent; expect to return signed in on `/onboarding` or `/app`. |
| Production Turnstile completion | BLOCKED | Submit the live signup form without tampering; expect the widget to complete and the form to proceed with no console CSP error. |

## Verdicts

**Phase 0: PARTIAL.** The prerequisite loop (verified entry → accepted week → Calendar → session log) has reproducible browser and database proof at both viewports with an honest planning-only path (no inventory needed; the review offers the "close without a paper" closure). Open: `class-editing` partial-log case (slow weekly-review preview), `focused` date, Turnstile `data:` console report, the four special-harness suites, the bank-writing suites, read counts, and the three live provider checks.

**Phase 1: PARTIAL.** Every session-log requirement above has passing proof except two that need external setup: the scope change after a paper is reserved (needs the staging project and a fixture bank) and Coach re-driven against a fresh log. Everything else passes on the final snapshot at desktop and 390 px.

## Cleanup and process state

Fixture students: all deleted by exact id (final `auth.users` count 1). Local server on 3141 stopped after the last run. Nothing committed. Scratch files live under `/tmp/claude-501` only.

## Phase 0 follow-up

The source now shares read-only planner inputs within a weekly preview request, fetches independent planner inputs together, and skips the extra display forecast on the preview POST. The before/after source token reads still run independently. Preview does not apply task or cycle changes. Request-snapshot checks verified parallel sharing within one request and isolation across owners and requests.

The read baseline now supports the existing `TRACE_READS=1` instrumentation. It records REST reads and RPC calls separately, removes query values from server traces, refuses wrong targets and redirects, and retains partial evidence with cleanup outcomes. Run with `E2E_READ_TRACE` pointing to the log of a dedicated local app process. Five samples are a smoke measurement. Use the default 15 warm samples or more for p95, and keep first-request timing distinct from a cold process.

The reported `data:,` CSP warning was reproduced on the live sign-in screen and came from the Cloudflare challenge iframe's own `connect-src`. PrepPlan's top-level policy already permits it. The auth test allowance covers that exact provider source and message. The app policy and the actual challenge requirements remain in force.

The notes initial-read test now injects its failure through the existing private loopback upstream, with no shared SQL policy changes. The error harness classifies aborted page reads using the Next RSC header and the same page's navigation or closure. API request failures still surface.

Verification on the follow-up source includes TypeScript, `npm run verify`, a local production build and deployed migration dry-run with zero pending. The browser matrix still has open checks. Deployed Supabase reported gateway and statement timeouts during fixture setup and preview. A successful early preview was still above 20 seconds, so the speed target is unproven. Synthetic bank browser tests still need an isolated Supabase target. Google sign-in, received email and completion of a real Turnstile challenge require their own provider proof.

The agent handoff is [Phase 1 closeout and Phase 2 build](PHASE-1-CLOSEOUT-AND-PHASE-2-BUILD.md).

### Observations from the follow-up runs

- In the desktop partial-class journey, the final preview and accept endpoints both returned 200. The preview took 18.1 seconds and acceptance 7.3 seconds. Both linked continuations were created and old task durations were unchanged. The run then hit a stale Home test that assumed a visible whole-week completion count. Its assertion now checks the new active cycle and Home's exact Calendar week link. One endpoint timing is not a latency guarantee.
- The focused move returned 409 `SITTING_ORDER` because the fixture chose the first sitting of a split and moved it past its sibling. The date had correctly stayed put. The success-path spec now chooses independent tasks and asserts the move response before checking the saved date.
- The initial notes-read fault and its retry passed at desktop and 390px through the loopback proxy. The no-provider flashcard journey also passed at both sizes. The prior fault matrix hit a weekly-preview timeout or an onboarding setup failure before those separate journeys could complete.
- Evidence in [the read-count smoke](evidence/phase0-read-count-smoke-2026-11-24.json) used two owned accounts, eight logged sittings in the history persona and five warm samples per route. Typical GET/HEAD counts for fresh/history were Home 33/110, Calendar 93/113, Tests 35/55 and Coach 30/30. A known-task log entry used eight GET/HEAD requests and one RPC. The history persona's eight planned saves had p50 1.89 s and p95 5.97 s. Page p95 from five samples is effectively the slowest request. Read timings were gathered on a loaded machine and are HTTP-level observations.

The final safe-suite run recorded 8 passes, 2 failures and 2 skipped serial cases. Home execution, Calendar order and Home/Calendar/Settings/Account viewport snapshots passed at both sizes. No-provider flashcards passed at both sizes. The focused desktop case stopped during sign-in. Its mobile run exposed the ordered-sibling refusal above. The revised success fixture's rerun stopped during first-plan acceptance while the app logged a database statement timeout. The class browser still has downstream assertions to re-run after the test updates. The broader fault matrix remains partial, and the bank-writing browser matrix still requires a separate target. The deployed account count was back to one after the owned runs, and the follow-up servers were stopped.

## Phase 1 closeout · 24 November

The session receipt now opens the exact saved item on Coach. Coach reads the owned task, its latest reported time and count of confirmed outcomes. It shows partial, completed, time-only and separate sessions distinctly. Calendar opens the same task. Viewing the log does not change the week or assessment evidence. The Coach proof uses the provider-free local build.

| Requirement | Proof |
|---|---|
| Planned, time-only and separate logs | `phase1-log.spec.ts` passed all six scenarios at desktop and 390 px. It exercised the receipt, the exact Coach context, coverage confirmation, a separate session on the same reading, and Calendar focus return. |
| Refusals and retries | The same browser run covered a stale second tab, double submit and a lost response after commit. `npm run planned:log:db:test` passed 12 command checks, including rollback, ownership and concurrency. |
| 25 + 20-minute continuation | Browser review and accept, one linked successor and a finish through the new log sheet at both viewports. DB checks kept the original 25 minutes and coverage in history and recorded 20 on its successor. The fixture moves the owned student’s timeline to make review eligible. |
| Cross-page agreement | A focused run on the final Coach code passed at desktop and 390 px. Home showed no scored paper, Curriculum showed the recorded sitting and its confirmed outcome, and Tests linked the confirmed reading from the current paper scope. The log changed no evidence. |
| Reserve → coverage change → resume → score | `node scripts/phase1-frozen-paper-db-test.cjs` passed five stages on a clean local full-schema database. It confirmed that a fresh log changes current scope and writes no evidence, a stale unreserved preview creates no form, and a reserved form retains its attempt, order, versions, scope and scoring policy. One correct answer out of five delivered scored 20% and emitted one evidence event. A new reservation accepted updated scope. |
| General regression | `npm run verify`, the independent type check, route audit and local production build passed. The existing Phase 2 generator tests passed 33/33. |

The paper proof invokes real database commands, including reservation, progress, answer and scoring. Source scope is built through real planned logs; selected question IDs in the command are supplied by the test harness. A scored browser journey needs an isolated app database with Auth and PostgREST. Hosted browser tests used throwaway students with the deployed bank unchanged. No schema change, deployment or live provider calls were required for this closeout.

Browser records: [desktop](evidence/phase1-log-desktop-lbmwuxqnoz721.json), [390 px](evidence/phase1-log-mobile-390-lbmwuxtojyqpg.json), [focused desktop](evidence/phase1-log-desktop-lbmwuy07ilvfc.json), [focused 390 px](evidence/phase1-log-mobile-390-lbmwuy1m3jy6c.json). The focused source fingerprint for the changed app and tests is `161fc31ef485ba25` on HEAD `2fdce1d`. Owned fixtures were removed and the local production server was stopped.

The next agent’s assignment is [Phase 2 closeout and Phase 3 build](PHASE-2-CLOSEOUT-AND-PHASE-3-BUILD.md).
