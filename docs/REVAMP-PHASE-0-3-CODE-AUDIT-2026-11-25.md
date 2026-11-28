# PrepPlan revamp · Code audit and closeout evidence · 25 November 2026

This is the revamp numbering in `PREPPLAN-END-TO-END-REVAMP.md`. The existing question bank, rehearsal and Curriculum tracks use separate numbering.

## Phase verdicts

| Phase | Verified now | Open gate |
|---|---|---|
| 0 · Baseline | Deployed checksum dry-run reports zero pending, including `20270206` and `20270207`. The local production build and route audit pass. The focused browser suite passes 4/4 on desktop and 390 px. The dedicated measurement run records REST reads and RPCs over 15 warm samples. | Full fault-harness matrix and live email, Google and Turnstile acceptance. See the previous baseline for unchanged evidence. |
| 1 · Logging | Planned-log contract suite 12/12. Frozen-paper local full-schema proof passes all five stages. Browser logging passes 12/12 across both viewports, including separate, time-only and planned behaviour and the 25 + 20 minute continuation. | Authenticated scored frozen-form journey with approved fixture capacity. |
| 2 · Planning | Local write consistency 25/25, including onboarding, redistribution, class recovery and lock-order checks. Class recovery already uses shared whole-gap packing in the preview. The owner-side fixes below have focused tests. | Shared write-time fit for all accepted continuation and assessment rows, repaired-work follow-up, and the remaining mature/midway/final-prep browser matrix. |
| 3 · Assessment | `npm run contracts:local` passes. Live routine and held-out eligibility views both return zero. Coach runtime 39/39 using simulated providers and the real turn store. | Authenticated scored taking, result, repair, re-check, challenge and rehearsal. The zero-bank path and local SQL proof cover separate cases. |

## Code fixes and proof

- Weekly Review now packs each continuation into a contiguous opening after subtracting timed work. It shows why a requested day is unavailable and leaves the task unplaced. New learning receives the same remaining gaps. The deliberate exception in the Calendar editor retains its existing confirmation flow. A regression proves that a 45-minute continuation bypasses two 30-minute gaps, while a 30-minute continuation uses one and leaves the other free.
- The planner keeps the unallocated part of a reading in the waiting estimate. The accepted review stores a bounded list of names and estimated minutes in the existing recap, so Calendar, Home and the roadmap can show the same explanation. Older receipts still show the count. The list describes the accepted draft; it is not recalculated as current debt on page render.
- Unrelated repair and re-verification work remains eligible on later days after one item is placed. Previously the first successful placement ended the whole lane for that week.
- Generated weekly papers now prefer the usual time only when it fits. A feasible alternate slot is carried into the stored draft. Fragmented or occupied time produces a distinct no-slot reason in onboarding, Calendar and Weekly Review. The fit search is conservative. The deployed bank is empty, so scored browser timing and no-slot closure with a startable bank still require proof. The SQL guard still needs review for the combined next-week rows and continuations that currently enter through separate JSON fields.
- The retained legacy response HTTP route now requires a supported confidence value and rejects missing/invalid answers before lookup. Failed reads offer retry. The compatibility script now asserts confidence and retains the existing response-lock behaviour. The underlying legacy SQL command and scored route working together still need the canonical command audit.
- The Phase 0 focused move test referenced draft-only `group_key` on saved tasks, then assumed the generator always left unsplit tasks. The fixture now uses the ordinary manual-task command to create two independent tasks, and its actual-bank case explicitly logs scoped activity rather than inferring scope from marking a task done. The new deployed-owned Playwright profile verifies the loopback app’s database origin and the read-only ledger, and allowlists student-owned specs only. The fixture-bank test profile keeps its existing guard.

## Read and latency baseline

The dedicated local production build used the deployed project, before the last continuation and paper-slot edits. This is a Phase 4 baseline for unchanged read surfaces, with 15 warm HTTP requests per route and fresh/history students. A separate browser process shared the host for part of the run. These are observed PostgREST calls, with RPCs counted separately in the evidence.

| Route | REST read range, fresh / history | p50, fresh / history | p95, fresh / history |
|---|---:|---:|---:|
| Home | 90–94 / 112–134 | 5.33 / 5.93 s | 12.85 / 11.21 s |
| Calendar | 93–97 / 115–127 | 4.36 / 5.08 s | 7.28 / 6.23 s |
| Tests | 35 / 57 | 2.22 / 3.07 s | 3.59 / 5.99 s |
| Coach | 30 / 30 | 1.13 / 1.03 s | 1.52 / 2.15 s |
| Known-task log API | 8 / 8 | 0.84 / 0.84 s | 1.17 / 1.22 s |

The Tests outlier in the earlier run did not recur here. Its cause remains unclassified. The trace does not include scored preflight/answer or review preview. Full records and cleanup are in [the read-count evidence](evidence/revamp-closeout-read-counts-2026-11-25.json).

## Final evidence and cleanup

- `npm run verify`, `npx tsc --noEmit`, isolated production build, `npm run contracts:local`, `npm run currentweek:consistency:test`, `npm run planned:log:db:test`, `node scripts/phase1-frozen-paper-db-test.cjs` and `npm run adaptive:item:test` pass. The generator suite passes 43. The built browser-asset check scanned 58 files and found zero matches.
- Phase 1 browser evidence on the continuation build: [desktop](evidence/phase1-log-desktop-lbmwvt56p3mra.json), [390 px](evidence/phase1-log-mobile-390-lbmwvt91ti782.json). Final paper-slot build focused evidence: [desktop](evidence/lifecycle-browser-focused-2026-11-25-desktop-lbmwvtbeqaoqe.json), [390 px](evidence/lifecycle-browser-focused-2026-11-25-mobile-390-lbmwvtdh6z0d8.json). The focused run covers normal move and reopen plus a scoped learning log followed by the actual-bank shortage.
- Source fingerprint `91b577eeea6d1e96` on HEAD `2fdce1d` covers tracked and untracked code, tests, scripts and migrations. The local servers were stopped and the fixture cleanup passed. The deployed Auth count returned to one. No hosted schema write, publication, deployment or real provider call was needed for this pass.

The next assignment is [Phase 2–3 closeout and Phase 4 build](REVAMP-PHASE-2-3-CLOSEOUT-AND-PHASE-4-BUILD.md).
