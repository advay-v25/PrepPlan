# Phases 1–5 continuation — November 25, 2026

The current checkout already contains the adaptive runner, linked rehearsal and Phase 5 Curriculum/notes/cards workspace. This pass preserved that implementation and the owner's dirty work, repaired concrete gaps, and ran the executable local gates. **Learner release and authenticated acceptance remain open.** The owner chose to continue with available local checks after the missing disposable credentials were identified.

Machine-readable results, migration hashes and limitations: [verification evidence](evidence/phase1-5-verification-2026-11-25.json). Full source inventory: [source snapshot](evidence/phase1-5-source-2026-11-25.json).

## Separate verdicts

| Gate | Current verdict and evidence | Remaining blocker |
|---|---|---|
| Phase 1 editorial closeout | **Partial.** All 18 pilot deterministic checks pass. The nine revised versions carry recorded model key matches. | Human editorial, mapping and difficulty approvals and learner distribution authority remain outstanding. No item was published. |
| Phase 2 launch-slice engineering | **Local SQL pass; authenticated gate open.** All 21 slice checks and 267 legacy dispositions reproduced. Eligibility, frozen papers and FSA/Ethics SQL student journeys pass. | Real authenticated subject/reading/weekly selection, Calendar repair and spaced re-check journeys have not executed on this tree. SQL tests seed some scope/repair states and pass preselected IDs to reservation commands. |
| Phase 2 full coverage | **Blocked: 8/89 outcomes have new candidates.** FSA 3/53, Ethics 5/36. Quant R004 is outside this denominator. | All 81 uncovered outcomes have `ABSENT_PACK` as their first blocker in the regenerated outcome matrix. No additional outcome has a scoped source pack from which authoring can proceed. Candidate checks do not supply content rights or human approval. |
| Phase 3 adaptive practice | **Local fresh/upgrade, RPC concurrency and simulated service checks pass; authenticated gate open.** Same-key three-connection starts and commits, pinned grading, scope refusal, family exposure, stale stop, closed-run refusal, RLS and zero formal evidence pass. All 17 policy vectors pass. | Current authenticated Tests UI, lost-response omission retry and stop/reload journey remain unexecuted. The SQL shortage case deliberately supplies no next item; selector/service tests separately check genuine family exclusion and failed inventory recovery. |
| Phase 4 rehearsal engineering | **Local SQL and simulated service pass; authenticated gate open.** Two linked 90-question/135-minute forms, 180 distinct fixture families, clocks, S2 lock, resume, omissions, replayed finalization and held-out isolation pass. Blueprint has 17 checks. | Tests → readiness → reservation → both sessions → result → debrief must still run through authenticated app routes. |
| Phase 4 actual capacity | **Blocked.** Fresh read-only live audit: zero approved held-out questions, bank-wide rehearsal capacity upper bound zero. | Approved held-out independent families across every topic. Student-specific fresh capacity remains unmeasured. |
| Phase 5 workspace | **Existing end-to-end implementation retained; current local SQL/pure gates pass; authenticated acceptance open.** Card commands 25/25, schedule checks 17/17 including 3,696 algorithm states; notes/cards 23, draft validation 16 and return links 7 pass. | Current desktop and 390px workspace, scored result-to-note/card journey, no-provider UI, long-list aggregation and note recovery/concurrency browser acceptance require disposable Auth/server keys. |
| Learner release | **Blocked.** | Content rights/approvals/capacity and remaining authenticated gates above. |

## Changes and connections

- `scripts/phase2-bank-audit.ts` now includes `codexBlindSolve` in generated item rows and provenance text. All six revised slice versions appear as exact-version matches, clearly distinct from human approval. Pilot/slice views and coverage matrices were regenerated. These are carried-forward model checks, not fresh independent solves in this pass.
- `src/lib/tests/adaptiveItemPractice.ts` counts independently deliverable Easy families in preflight. Two sibling variants no longer advertise two fresh questions. `scripts/adaptive-item-service-test.ts` exercises the production read path with simulated later-page failures, recovery, sibling exposure and start-receipt replay before inventory. `npm run adaptive:item:test` runs this with the production selector and policy vectors.
- `scripts/phase3-adaptive-item-db-test.cjs` adds a pre-20270205 upgrade run, independent-connection same-key races, selected-outcome refusal, exposure refusal and stale/closed stop assertions. The private snapshots migration executes successfully on both fresh and upgraded local schemas; authenticated users cannot select pinned answers.
- `src/lib/rehearsal/service.ts` refuses a failed/null status-page answer count instead of showing zero answered. `scripts/rehearsal-service-test.ts` covers failed count, null count, failed finalization, honest status reads and retrying appointment completion after the rehearsal is complete. It uses simulated transport, not a hosted database.
- `scripts/phase4-rehearsal-lifecycle-db-test.cjs` adds explicit Session 2 ordering, stable deadlines and repeated-finalization evidence assertions.
- `scripts/e2e-rehearsal-journey.ts` defaults to `.env.staging.local`, supports both server-key aliases, checks the fixture record before student creation and calls `assertRehearsalTarget`. The protected `/api/health?ready=1` response now reports `databaseOrigin` so the runner verifies app/fixture target agreement before any account creation. It requires the existing `HEALTHCHECK_SECRET`; the public health response stays unchanged. Target tests cover wrong project, missing keys, aliases and unavailable readiness. These service/target tests are included in `npm run verify` through `rehearsal:contract:test`.
- `scripts/flashcard-commands-db-test.cjs` and `scripts/flashcard-schedule-test.ts` reuse `openStage` for `--local` execution. They retain exact-target confirmation for hosted execution. Cleanup handles connection failures, closes owned connections and removes the disposable cluster. A redundant vacuous schedule assertion was removed; the real database count assertion remains.

No duplicate workspace, editor, scheduler, planner or content store was introduced. The Phase 5 route/command map remains [CURRICULUM-WORKSPACE-ROUTES.md](CURRICULUM-WORKSPACE-ROUTES.md). Earlier browser evidence in master-status §§9.51–9.53 remains historical and is not claimed as a current run.

## Final-tree verification

| Command/group | Observed result |
|---|---|
| `npm run verify` | Exit 0, all 61 constituent npm commands, including the previously blocked controlled loopback-provider checks |
| Canonical `npm run lint`; `git diff --check` | Pass after isolated build restored types |
| `node scripts/isolated-next.cjs .next-phase5-verify build` | Exit 0, optimized production build |
| Phase 1 eligibility/frozen-paper; Phase 2 SQL journeys | Pass on disposable local Postgres |
| Phase 3 SQL fresh and `--upgrade`; `npm run adaptive:item:test` | Pass |
| Phase 4 lifecycle, blueprint and service/target regressions | Pass; synthetic inventory only |
| `npm run contracts:local` | All eight SQL suites pass: paper 37, score 8, challenge 28, rehearsal 14, scope race 23, difficulty race 28, progress 10, Coach 14 |
| Local card commands / scheduling | 25/25 and 17/17; final runs produced nonempty assertion output and removed their fixtures |
| Backup/restore rehearsal | 32 checks pass, nothing persisted |
| Fresh install / migration upgrade | Local install passes: baseline 105 + 49 later migrations = 154 ledger rows; zero pending, checksum mismatches or missing entries. Targeted pre-20270205 upgrade passes. Full install-rehearsal command exits 1 at the subsequent hosted comparison: staging DB hostname does not resolve. |
| Hosted migration dry-run | Blocked by staging database connectivity; hosted migration status unverified. No hosted migration applied. |
| Authenticated Playwright workspace/adaptive suites | Setup fails with missing disposable server key. **Zero authenticated assertions ran.** |
| Rehearsal HTTP journey | Setup fails before any fixture creation with missing disposable public/server keys. |

Current live inventory was read without mutation from the configured live app project `woboyakjtgltgekwtddo`. It reports raw 0, automatically checked 0, quarantined 0, approved routine 0, approved held-out 0. The separate disposable target is `asylsxszdhlnzewhwtga`; its public Auth key, server key and health monitor secret are absent. Neither production credentials nor production fixtures were copied into it.

The source fingerprint is **`d190b3e23be67938`** (975 files); bank fingerprint **`45a333707f098009`** (82 code/fixture files and 14 private-pack metadata entries, excluding fact text). HEAD remains `2fdce1db829078c778cb25eeaefb4e8eb1da3c3b`. Exact hashes for migrations 20270112–15 and 20270203–05 are in the machine-readable evidence. No migration file was changed in this pass.

## Cleanup and continuation

All owned local test clusters and fixture users were removed, including two aborted local command-test clusters discovered during verification. The pre-existing Postgres cluster and shared app server were preserved. No hosted fixture accounts were created. The isolated build wrapper removed its lock and restored canonical Next types; only its owned generated build output was removed after verification. No commits, pushes, deployments, publications, real-provider experiments or content approvals occurred.

To resume authenticated work, configure the disposable public Auth/server keys and `HEALTHCHECK_SECRET` locally, restore staging database connectivity, apply/rehearse the required migrations through the approved migration workflow, and start an isolated app against that same target. Then run the existing desktop/390px Phase 5 workspace, closeout, no-key, scored-student and adaptive suites, followed by the target-checked rehearsal journey. Do not count unavailable fixtures as successful empty-bank behavior.
