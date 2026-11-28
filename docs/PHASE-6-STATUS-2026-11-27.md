# Phases 0–6 local software final closeout · 28 Nov 2026 (Hydrogen)

Start `ea6fef3cc55ca385` (1,063 files). Pre-doc code fingerprint `38e8ee13ae9380ad` (1,065 files). Nothing committed, staged, or deployed. All runtime verification ran locally against the isolated loopback stack (`scripts/local-stack.cjs`, stopped and purged at closeout); no hosted database, live model/email/Turnstile provider, or question-bank/importer work was run. Migration `20270213_onboarding_acceptance_guard.sql` is untouched and recorded in [docs/PHASE-5-OWNER-RELEASE-CHECKLIST.md](docs/PHASE-5-OWNER-RELEASE-CHECKLIST.md) as **owner-confirmed applied, hosted ledger and checksum verification outstanding**; local install/upgrade/restore rehearsals include it.

| Track | Verdict |
|---|---|
| Software (local, Phases 0–6) | **Closed.** All 43 lifecycle Playwright spec files (302 tests across `desktop` and `mobile-390`) ran and passed in their designated local-stack lanes (`prod`, `prod+proxy`, `prod+provider-stub`, `dev+fixture+proxy`, `prod+turnstile-fixture`), with 1 intentional `mobile-390` skip (`phase6-late-confirm.spec.ts` setup probe, passed on `desktop`). All static, DB contract, Coach runtime, reminder cursor/worker, beta install/upgrade/restore, secret-audit, and wrapper-teardown gates passed. |
| Hosted / Live Release Gates | **Separate (outstanding).** Hosted DB ledger/checksum verification (`20270213`), live Turnstile/Google OAuth/email delivery, real Coach provider, and production question-bank publication remain outside this local pass. |

## Changes Made in This Pass

1. **Wrapper teardown ownership (`scripts/local-stack-app.cjs`, `scripts/local-stack-app-test.cjs`):** Forwarded `SIGINT`/`SIGTERM`/`SIGHUP` to the child `isolated-next.cjs` process and waited for child exit so `restore()` completes cleanly; verified with `node scripts/local-stack-app-test.cjs` (`local-stack-app-test: PASS`). Note: `SIGKILL` cannot be caught and still leaves `.next-isolated.lock` if a runner hard-kills the wrapper.
2. **Release checklist status (`docs/PHASE-5-OWNER-RELEASE-CHECKLIST.md`):** Updated migration `20270213` status from stale "Not applied" to owner-confirmed applied with hosted ledger/checksum verification outstanding.
3. **Coach pre-fault proposal assertion (`tests/e2e/lifecycle/phase3-closeout.spec.ts`):** Added pre-fault `propBefore` sampling of `coach_proposals` and asserted `prop0 === propBefore` after timeout before Retry.
4. **First-pass-finished weakness-only bridge fix (`src/lib/curriculum/revisionQueueService.ts`, `tests/e2e/lifecycle/phase6-bridge-transition.spec.ts`):** Fixed `bridge` in `revisionQueueService.ts` (`o.phase === 'first_pass' || o.phase === 'consolidation'`) so the weakness-only bridge fires after all readings are covered (`getActiveRoadmap` transitions `phase` to `'consolidation'`). Verified with `npm run revision:queue:test` (`66 passed, 0 failed`), `npm run adaptation:note:test` (`4 passed, 0 failed`), and new browser spec `phase6-bridge-transition.spec.ts` (`4 passed, 0 failed` at `desktop` and `mobile-390`: no-concern control, self-reported uncertainty bridge, Calendar/Curriculum/no-eligible-question control, and broad revision recall with fixture bank keeping activity and evidence separate). *(Only a boolean expression changed in `src/`; no extra Supabase read queries were added, preserving the `255 → 66` onboarding preview read count.)*

## Phases 0–6 Verification Matrix on `38e8ee13ae9380ad`

| Lane / Gate | Scope / Command | Result |
|---|---|---|
| Static & unit gates | `npm run verify` (`tsc --noEmit`, lint, unit suites), `npm run routes:inventory` | **exit 0** (`84 files 105 handlers`) |
| Secret audit | `node scripts/client-secret-audit.cjs .next-stack` | **exit 0** (`4123` browser assets, `0` findings) |
| Local DB contracts | `npm run contracts:local` (`paper:db`, `paper:score`, `challenge:ledger`, `rehearsal:db`, `scope:race`, `difficulty:race`, `progress:db`, `coach:db`) | **exit 0** |
| Local DB consistency & frozen paper | `onboarding-buffer-db-test.ts --local` (`27 passed`), `current-week-consistency-db-test.cjs --local` (`27 passed`), `planned-log-db-test.cjs --local` (`12` checks), `phase1-frozen-paper-db-test.cjs --local` (`5 PASS`) | **exit 0** |
| Coach runtime & reminders | `coach-turn-runtime-test.ts` (`39 passed`), `reminder-cursor-db-test.cjs` (`1,205` students), `reminder-worker-scoped-test.ts` (`25 passed`) | **exit 0** |
| Beta install / upgrade / restore | `npm run beta:install:rehearse`, `npm run beta:upgrade:rehearse`, `npm run beta:restore:rehearse` (162 migrations, 0 pending, 0 checksum mismatches) | **exit 0** (`restore`: `32` checks passed) |
| Wrapper teardown | `node scripts/local-stack-app-test.cjs` | **exit 0** (`local-stack-app-test: PASS`) |
| Prod build (`local-stack-app.cjs start`, 37 non-fault/non-Turnstile files) | 29 empty-bank/non-stub specs + non-fixture tests of `phase4-student` & `phase5-workspace` | **204 passed** (26 failed = the 8 dev-fixture/`--provider-stub` specs, plus 22 skipped dependent tests in `journey-a`) |
| Prod build + `--provider-stub` (`phase5-workspace.spec.ts`) + `fault-upstream.cjs` | `phase5-workspace.spec.ts`, `phase5-closeout.spec.ts`, `phase6-completion.spec.ts`, `phase6-late-confirm.spec.ts`, `phase6-forecast.spec.ts` | **42 passed, 1 intentional skip** (`phase6-late-confirm` setup probe at `390px`); `phase6-forecast.spec.ts` failed once on a 5-min clock-minute boundary (`308` vs `313 min`) and passed **10 passed, 0 failed** on immediate re-run |
| Dev-fixture + `fault-upstream.cjs` (`ROADMAP_FIXTURE_BANK=1`) | `app-audit-paper`, `journey-a`, `linked-rehearsal`, `phase4-student`, `phase5-mock-transition`, `position-path`, `question-bank-adaptive`, `phase3-closeout` | **54 passed, 0 failed** |
| Prod build + `--turnstile-fixture` | `turnstile-retry.spec.ts` (`E2E_TURNSTILE_FIXTURE=1`) | **4 passed, 0 failed** |

---

# Phase 6 evidence record · 27 Nov 2026 (Hydrogen final acceptance)

Start `0a3112e247d02af1` (1,062 files). **Final fingerprint `ea6fef3cc55ca385`** (1,063 files). Nothing committed, staged, or deployed. All work and verification ran locally against the isolated loopback stack (`scripts/local-stack.cjs`, stopped and purged at closeout); no hosted database or provider was contacted. Migration `20270213_onboarding_acceptance_guard.sql` is recorded as **owner-confirmed** as applied, left unchanged, and included in all local rehearsals.

| Track | Verdict |
|---|---|
| Software (local) | **Closed.** Both red acceptance cases (`phase4-reviewer.spec.ts:193` on production build and `phase3-closeout.spec.ts:201-224` Coach deadline/log-capture) are reproduced, fixed, and verified at both desktop and 390 px. All final gates, normal dev-server sweep (`251 passed, 5 skipped, 0 failed`), fault-proxy + provider-stub suite (`61 passed, 1 skipped, 0 failed` + `phase3-closeout` `2 passed, 0 failed`), production-build reviewer/input runs, and `turnstile-retry` (`4 passed, 0 failed`) pass on the final source. Historic 26 Nov Calendar hydration occurrence remains **monitored and unresolved** (0 reproductions across `phase6-hydration.spec.ts` 288 sequences and `phase6-audit-disclosures-notes.spec.ts`). |

## Root Causes & Fixes for the Two Red Cases

1. **`tests/e2e/lifecycle/phase4-reviewer.spec.ts` (line 193, production build):**
   - **Root cause:** `phase4-reviewer.spec.ts` used a raw `page.on('requestfailed', ...)` listener instead of `scopedErrors.ts`. On the production build (`next start`), Next.js `<Link>` speculative RSC prefetch requests (`GET ...?_rsc=...` with `rsc: 1`, `next-router-prefetch: 1`) are cancelled (`net::ERR_ABORTED`) when `page.goto(.../preview)` navigates away.
   - **Fix:** Switched `phase4-reviewer.spec.ts` to `scopedErrors()`, scoped the stale second-tab `409` allowance to that single step via `errors.expecting(...)`, and added [scripts/scoped-errors-test.ts](scripts/scoped-errors-test.ts) proving aborted API requests, failed document loads, uncategorized RSC failures, console errors, and pageerrors still fail.
   - **Proof:** `scoped-errors-test.ts` PASS; `phase4-reviewer.spec.ts` **10 passed, 0 failed** on isolated production build (`task-1368`, desktop & 390 px) and **10 passed, 0 failed** in dev-server sweep (`task-1406`).

2. **`tests/e2e/lifecycle/phase3-closeout.spec.ts` (lines 201–224, Coach deadline & log capture):**
   - **Root cause:** The test harness had started `next dev` without redirecting both `stdout` and `stderr` to `SERVER_LOG` (`server-3151.log`), and `phase3-closeout.spec.ts` silently defaulted `srvBefore = 0` when `SERVERLOG` was absent and read `SERVERLOG` without a bounded flush wait.
   - **Fix:** Updated `phase3-closeout.spec.ts` to require `SERVER_LOG` and `UPSTREAM_LOG` up front, assert the first `POST /api/coach` HTTP `503` response has `code === 'CONTEXT_TIMEOUT'`, and poll the new `SERVER_LOG` byte range with a bounded `5s` wait for `Coach context exceeded its budget (... ms); reads aborted, late result discarded`.
   - **Proof:** `phase3-closeout.spec.ts` **2 passed, 0 failed** behind `scripts/fault-upstream.cjs` (`task-1379`, desktop & 390 px) with `stdout+stderr` captured to run-owned `server-3151.log`.

## Final Acceptance Gates on `ea6fef3cc55ca385`

| Gate / Harness | Command / Scope | Result |
|---|---|---|
| Static, unit & contract gates | `npx tsx scripts/scoped-errors-test.ts`, `node scripts/beta/install-rehearsal-test.cjs`, `npm run verify` (`tsc --noEmit` + lint + unit suites), `npm run routes:inventory` | **exit 0** (`task-1386`) |
| Local DB contracts & buffer test | `npm run contracts:local`, `npx tsx scripts/onboarding-buffer-db-test.ts` | **exit 0** (`onboarding-buffer-db-test`: **27 passed, 0 failed**) |
| Local DB install / upgrade / restore | `npm run beta:install:rehearse`, `npm run beta:upgrade:rehearse`, `npm run beta:restore:rehearse` (local-only by default, 162 ledger rows, 0 mismatches, incl. `20270213`) | **exit 0** (`restore`: 32 checks passed) |
| Isolated prod build & secret scan | `node scripts/local-stack-app.cjs build`, `node scripts/client-secret-audit.cjs .next-stack` | **exit 0** (`4,123` browser assets, 0 findings) |
| Normal dev-server sweep (desktop + 390 px) | All 24 non-proxy/non-Turnstile specs (`task-1406`) | **251 passed, 5 skipped, 0 failed** (skips: 4 `FAULTS_FILE` cases + 1 desktop-only setup probe at 390 px; all 5 passed in intended harnesses) |
| Fault-proxy + provider-stub suite | `phase3-closeout` (`task-1379`: **2 passed**), `phase5-closeout` + `phase5-workspace` + `phase6-completion` + `phase6-forecast` + `phase6-late-confirm` (`task-1385`: **61 passed, 1 skipped**) | **63 passed, 1 skipped, 0 failed** (skip: desktop-only setup probe at 390 px) |
| Isolated prod build reviewer & Turnstile | `phase4-reviewer.spec.ts` (`task-1368`: **10 passed**), `turnstile-retry.spec.ts` (`--turnstile-fixture`: **4 passed**) | **14 passed, 0 failed** |
| Read-cost & latency baselines (unchanged `src/`) | `stack-onboarding-measure.ts` (`MODE=preview`, `SAMPLES=15`): fresh `255 → 66` reads (1 RPC, p50/p95 `167/214 ms`), reuse `2` reads (3 RPCs, `68/96 ms`); `stack-read-breakdown.ts`: fresh Home `68` (budget 69), history Calendar `88` (ceiling 90) | Carried from [phase6g-preview-before.json](docs/evidence/phase6g-preview-before.json), [phase6g-preview-after.json](docs/evidence/phase6g-preview-after.json), [phase6g-owed-trace.json](docs/evidence/phase6g-owed-trace.json) |

---

# Phase 6 evidence record · 27 Nov 2026 (Hydrogen closeout)

Start `b68df3dd5776e546` (1,060 files). **Final fingerprint `0a3112e247d02af1`** (1,062 files). Nothing committed, staged, or deployed. All work and verification ran locally against the isolated loopback stack (`scripts/local-stack.cjs`, stopped and purged at closeout); no hosted database or provider was contacted. Migration `20270213_onboarding_acceptance_guard.sql` is recorded as **owner-confirmed** as applied, left unchanged, and included in all local rehearsals.

| Track | Verdict |
|---|---|
| Software (local) | **Partial.** All implementation changes, local DB rehearsals, `onboarding-buffer-db-test` (27/27), disclosures/notes/390 px audit (6/6), preview read reduction (`255 → 66` reads), `verify`, `routes:inventory`, `contracts:local`, `client-secret-audit`, `turnstile-retry` (4/4), and `mock-progress-owner` passed. Two harness/assertion failures remain open: `phase4-reviewer.spec.ts:193` aborted `_rsc` prefetches on the production-build run (passed in dev sweep), and `phase3-closeout.spec.ts:213` did not match the `exceeded its budget` log line in `SERVER_LOG` (`task-1299.log`). Historic 26 Nov Calendar hydration occurrence remains **monitored and unresolved** (0 reproductions across 288+ dev sequences). |

## Requirement-to-Proof Table

| Requirement | Action & Changed Files | Final Proof |
|---|---|---|
| 1. Local DB rehearsals by default | Made `scripts/beta/install-rehearsal.cjs` local-only by default (`--compare-hosted --confirm-target=<ref>` opt-in before `.env.staging.local` read; `--local-only` retained); updated `docs/BETA-OPERATIONS.md`; added `scripts/beta/install-rehearsal-test.cjs`. | `install-rehearsal-test.cjs` PASS; `beta:install:rehearse` (162 ledger rows, 0 mismatches, 0 pending); `beta:upgrade:rehearse` (57 post-baseline migrations incl. `20270213`); `beta:restore:rehearse` (32 checks). |
| 2. First-week acceptance & recovery | Added `registered` to `PROFILE_COLUMNS` in `src/lib/ops/sharedReads.ts` (fixes `lastDay` exam-date cap); extended `scripts/onboarding-buffer-db-test.ts` (31 min, sub-15-min gaps, sitting limit 20, class-led Wed–Tue boundary, `America/New_York` UTC rollover, no-time-before-exam, activation recovery). | `onboarding-buffer-db-test.ts`: **27 passed, 0 failed**; `phase6-late-confirm.spec.ts`: passed on production build and behind fault proxy. |
| 3. Early disclosures, notes editor & 390 px | Reproduced React hydration mismatch (`open=""`) on `WeekStep.tsx` `<details className="fl-more ob-fixed">`; added `suppressHydrationWarning` to `<details>` in `WeekStep.tsx`, `RouteStep.tsx`, `PlanStep.tsx`, `PositionStep.tsx`, `TodaySequence.tsx`, `src/app/app/page.tsx`, `src/app/app/tests/page.tsx`, `MockSchedule.tsx`; added `tests/e2e/lifecycle/phase6-audit-disclosures-notes.spec.ts`. | `phase6-audit-disclosures-notes.spec.ts`: **6 passed, 0 failed** (desktop & 390 px, delayed hydration, Notes editor loading/IME/slow-save, Settings→Calendar `America/New_York`). Historic 26 Nov hydration: **monitored and unresolved** (0 reproductions in `phase6-hydration.spec.ts`). |
| 4. Cut redundant preview reads | Wrapped `generatePreview` (`src/lib/onboarding/previewService.ts`) in `withReadSnapshot`, merged `reviewNoteFor` `reference` reads, and switched `getStudyWeekContext` (`src/lib/planning/schedule.ts`) + `readPlacementContext` (`src/lib/planning/pulse/generateWeek.ts`) to `freeRangesForDates`. | `stack-onboarding-measure.ts` (`MODE=preview`, `SAMPLES=15`): fresh `255 → 66` reads (1 RPC), p50 `285 → 167 ms`, p95 `379 → 214 ms` ([before](docs/evidence/phase6g-preview-before.json), [after](docs/evidence/phase6g-preview-after.json)); reused `2` reads (3 RPCs), p50 `85 → 68 ms`. Fresh Home `68` calls (budget `69`); history Calendar `88` calls (ceiling `90`); owed-work trace in [phase6g-owed-trace.json](docs/evidence/phase6g-owed-trace.json). |
| 5. Final gates & browser sweep | Ran `verify`, `routes:inventory`, `contracts:local`, `client-secret-audit.cjs .next-stack`, production-build sweep, dev-server sweep, fault-proxy + provider-stub suite, and `--turnstile-fixture` build. | `verify`, `routes:inventory`, `contracts:local`, `client-secret-audit` (`2,584` assets, 0 findings): exit `0`. `turnstile-retry`: 4/4. Prod sweep: 76 passed, 5 skipped, 3 failed (`phase6-flashcard-order` 6/6 on rerun; `phase4-reviewer:193` `_rsc` abort). Dev sweep: 267 passed, 9 skipped, 10 failed (8 proxy-only; `class-followup` 6/6 on rerun; `phase6-audit-disclosures-notes` 6/6 after fix). Proxy suite: 61 passed, 1 skipped, 2 failed (`phase3-closeout:213` `SERVER_LOG` match). |

---

# Phase 6 evidence record · 27 Nov 2026 (final closeout)

Start `dc2cce0687b6214a`. **Final fingerprint `b68df3dd5776e546`** (1060 files), identical at the start and end of the final run and after the rerun. Nothing committed, staged or deployed. Local stack and owned fixtures only, with one exception below. One new additive migration.

**Isolation exception.** The first runs of `beta:install:rehearse` and `beta:upgrade:rehearse` omitted `--local-only`. By default they compare the rehearsed database with the hosted **staging** project (`mnlezctdqkdfgvmipmcj`), so two **read-only** hosted connections were made without authorisation. No writes; production not contacted. They reported that staging holds 158 ledger rows, without 20270210–213. All later runs used `--local-only`.

| Track | Verdict |
|---|---|
| Software | **Closed locally.** First-week acceptance, staff Edit and the two adjacent risks are fixed with red and green proof. One named failure in the final sweep, passing on rerun. 26 Nov hydration occurrence carried forward. |
| Importer and bank owner | Open, unchanged: `.2` is still refused; handoff stands. |
| Question availability | Last authorised report 26 Nov: 0 approved. Not re-read. Local bank: 0 items outside fixtures before and after. |
| Release | **Not ready.** New migration `20270213` is not applied anywhere hosted; production status of 210–212 is owner-reported. |

## 1. First-week review time
**Rule now.** A draft is planned from 15 minutes after the instant it is prepared (`REVIEW_BUFFER_MINUTES`), in both first-week selection and task generation; the date, class boundary and booked exam stay the student's actual ones. A day counts only if a free stretch of 15 minutes remains. The draft stores its own week, zone, notes and planning reference, and the preview route returns those. Acceptance still checks the exact tasks against the database clock and current setup; a draft that still fits is accepted after 15 minutes, including past midnight.

**Defects found on the old code** (`phase6f-buffer-red`: 17 of 20 fail) and fixed:
- Accepting a newer draft over an accepted week added a **second copy** (9 tasks became 18).
- A timed task whose start had passed was accepted.
- Superseding could overwrite a draft accepted meanwhile.
- Confirmation retired the draft on any error, including an unknown outcome.
- The earlier minute-boundary refusal, and ten free minutes tonight counting as a study day.

**Changes.** `schedule.ts`, `firstCycle.ts`, `generateWeek.ts` (`notBefore`), `roadmapService.ts`, `previewService.ts`, `draftService.ts` (reuse only while it fits; retire only ready drafts), preview and confirm routes, `OnboardingShell.tsx`, `PlanStep.tsx`, migration `20270213_onboarding_acceptance_guard.sql` (SHA-256 `9cf1c9d898a01b38…`). Confirmation outcomes: stale or rejected (draft retired), already accepted (nothing added, link to Calendar), unconfirmed (draft kept; the same press is a safe retry). The fixture's minute-alignment and retry workaround is removed.

**Proof.** `onboarding-buffer-db-test.ts`: 20 of 20, injected planning instant (1, 10, 14, 15, 29 and 30 minutes; later in week; elapsed; no room; midnight; reuse; contention; replay; recovery replacement). `phase6-late-confirm.spec.ts`, both widths: crossing a minute accepted exactly as shown; 20-minute-old draft accepted; newly protected time refused with zero accepted writes, rebuilt, accepted once; obsolete draft refused by the clock and replaced; request never sent and reply lost after commit; older tab after acceptance; failed read (fault proxy). Deterministic fixtures; the only wait is one minute boundary.

**Behaviour to know.** With less than 30 minutes left today, today is not used. A draft reopened inside its 15 minutes is shown unchanged; after that it is reused only if 15 minutes of review time still remain. The elapsed-window case offers the next week, or an empty plan that says why.

## 2. Early input
Red (`phase6f-early-audit-red`): staff **Edit** looked ready and dropped the press; a decision note typed during loading was lost; reviewer disclosures, Curriculum reading, overview, Roadmap and Readiness disclosures raised React's attribute mismatch; typed flashcard text was erased.
Fixed with `WhenReady` (`ItemWorkspace`, `DraftPreview`, `FlashcardPanel`) and `suppressHydrationWarning` on those `<details>`. Also fixed: opening a Readiness topic pushed the page 17 px wider than 390 px (`styles.css`).
Proof: `phase4-reviewer` (reload → early Edit by keyboard and pointer → ready → editor → new version; stale tab leaves one decision; approved version stays; candidate unapproved) and `phase6-early-input`, both widths. Disclosures on Home, Tests, Calendar panels and onboarding steps, and the notes editor, were not audited.

## 3. Adjacent risks
- **Flashcards after a change:** confirmed (`phase6f-flashcard-red`): a slow add, delete or edit reloaded the old filter, search or one page. Reload now uses the current selection and number shown, checking the saved card (`phase6-flashcard-order`).
- **Mock-led catch-up:** confirmed: an accepted mock-led week removed first study from the whole forecast. It now holds study until that week ends and forecasts what the Roadmap schedules afterwards. Final preparation, classes setting the order, and no eligible reading each have their own wording. Owed work still comes first; nothing is written. Unit 53 of 53; browser proof across Home, Calendar, Roadmap, Review and Coach for the mock-led case; the other three wordings are unit proof.

**Fixture defect found today:** `class-followup` built a week holding two eligible Saturdays when run on a Friday, so the planner correctly used both. The fixture now ends the week after the one study day (`phase6f-class-followup-friday`).

## Final run on `b68df3dd5776e546`
| Check | Result | Log (`evidence/phase6f-final-…`) |
|---|---|---|
| Production build, `tsc`, lint, `verify`, `contracts:local`, route audit; asset secret scan (57) | pass; 0 findings | `run.out`, `verify.log`, `contracts.log` |
| Clean install, upgrade, restore (local only); ledger checksums | pass; 162 rows, 0 mismatches; restore 32 checks | `reh-*.log` |
| First-week service test | 20 passed | `buffer.log` |
| Production build: first week, early input, flashcards, recovery progress, Calendar save, disclosure | 53 passed, 1 skipped | `prod-input.log` |
| Dev-server sweep, desktop and 390 px | 244 passed, **1 failed**, 5 skipped | `suite.log` |
| Rerun of the failed file | 2 passed | `suite-rerun.log` |
| Fault proxy and provider stub | 30 passed | `faults.log` |
| Failed-read journeys, fault proxy | 4 passed | `faultread.log` |
| Production build behind the proxy | 34 passed | `prodproxy.log` |
| Fixture CAPTCHA build | 4 passed | `turnstile.log` |

**Failure:** `mock-progress-owner` · "recovery time does not imply completion…", desktop dev sweep. The route was warmed and answered quickly; the following Calendar navigation took 20.2 s against a 20 s wait while the dev server was stalled (it had just logged a 12.1 s cache write; `phase6f-mock-progress-stall`). It passed on the production build at both widths, at 390 px in the sweep, and on rerun. Inferred as machine load; assertions unchanged.

**Skips.** Need the fault proxy, passed there: "forecast · a failed catch-up read…" ×2, "first week · a failed read during confirmation…" ×2. Intentional desktop-only probe with no browser, passed on desktop: "first week setup probe · a setup failure keeps its failing stage…" at 390 px (also the one production-run skip).

**Hydration, 26 Nov occurrence: open.** 504 dev-server sequences in total (252 at 390 px), 0 messages.

## Performance (local production build behind the proxy, 15 warm samples)
| Persona | Home | Calendar | Review GET / preview | Home, Calendar p50/p95 ms |
|---|---|---|---|---|
| review all done | 77 | 76 | 80 / 90 | 129/150, 117/125 |
| catching up | 77 | 76 | 80 / 101 | 124/131, 114/121 |
| recovery offered | 88 | 87 | 84 / 101 | 142/160, 133/139 |
| history with debt | 89 | 87 | 84 / 112 | 139/146, 131/136 |
| nothing owed, fresh | **65** (budget 69) | 70 | | 101/104, 95/99 |
| nothing owed, history | 78 | 83 (ceiling 90) | | 112/123, 112/121 |

Within one read of the earlier Phase 6 figures. These personas were built on a Friday, with smaller weeks than the earlier run.
**First-week preview** (no earlier baseline): fresh build 255 reads, 1 RPC, p50/p95 159/171 ms; reused draft 2 reads, 3 RPCs, 42/45 ms. Most fresh-build reads are the capacity inputs re-read for each date, mostly pre-existing; sharing them is a follow-up, not done.

## Outstanding
| Action | Owner | Proof that clears it |
|---|---|---|
| Apply `20270213` with or before deployment | Owner | Checklist item 11 |
| Verify 210–212 on production | Owner authorises | Checklist item 7 |
| Bank owner; `.2` decisions; approved questions | Bank owner, owner | Handoff; capacity report |
| Mail, reset, Google, Turnstile, reminders, config, compute, commit and deploy | Owner | Checklist items 1–6, 8, 10 |
| 26 Nov hydration occurrence | Engineering | A capture naming the element |
| Unaudited disclosures and notes editor; preview read cost | Engineering | Red then green; remeasure |

---

# Earlier closeout record (fingerprint `dc2cce0687b6214a`; superseded where it differs)


Closeout start `a697958d23db9ebf`. **Final fingerprint `dc2cce0687b6214a`** (1056 files), identical at the start and end of the final run and after the reruns. Nothing committed, staged or deployed. No hosted read, migration, provider call or publication. No schema change.

| Track | Verdict |
|---|---|
| Software | Late confirmation, setup determinism and the Home case are proven. Two named failures in the final sweep, both passing on rerun; one is an unfixed staff-page defect. |
| Importer and bank owner | **Open.** No owner or decisions; the importer still refuses `.2`. Not touched in this closeout. |
| Question availability | Last authorised report 26 Nov: 0 approved. Not re-read. |
| Release | **Not ready.** Migrations are owner-reported only. Hosted ledger check, live providers and deployment are separate release actions (checklist). |

## Late first-week confirmation
**Before** (unchanged app, `evidence/phase6-late-confirm-reproduced-2026-11-27.log`): a confirmation after a sitting stopped fitting was correctly refused, but the page said "Your setup changed", which was false.
**Changed:** the explanation only. `previewService.ts`, the confirm route, `OnboardingShell.tsx` and `PlanStep.tsx` (narrow edits; other uncommitted work in those files kept). Messages now say what changed (time passed; the week no longer applies; a new day; setup changed), that nothing was saved and answers are kept. The acceptance guard is untouched.
**Proof** (`phase6-late-confirm.spec.ts`, desktop and 390 px, real waiting against the database clock, student in a fixed-offset zone at a known local hour):
- No longer fits: refused; no cycle, task, event or active Roadmap; setup not complete; answers unchanged; draft retired; Accept disabled. Rebuild in the UI gives a smaller plan; a double press accepts one week with exactly the previewed tasks; a repeated request adds nothing.
- Last usable window elapsed: refused with nothing saved. Rebuild plans **the next week**, says "There is no study time left in this cycle…", and it accepts once. (Under 15 minutes left but not elapsed is not separately tested.)

**Open product finding (owner decision).** A plan fills the time left today, to the minute. A student inside their study window who reads the preview past the end of that minute is refused, and again after each rebuild read as slowly (shown in the first journey). They get through by confirming within the minute, or once less than a sitting remains. Suggested fix: plan the preview from a few minutes ahead; the length of that grace is a product choice and was not made here.

## Test setup
Both 27 Nov setup failures are traced (`evidence/phase6c-setup-failure-trace-2026-11-27.log`): stage `POST /api/onboarding/plan/confirm`, HTTP 409 `STALE_PREVIEW`.
| Failure | Preview → refusal |
|---|---|
| Desktop retake | preview built 20:32:00.0Z after starting in 20:31; confirm followed in 20:32 |
| 390 px disclosure | preview 5.4 s ending 20:50:58Z; confirm 1.6 s later, past 20:51 |
Each crossed a minute inside the fixtures' evening window. That is the same mechanism as the late-confirmation case, inferred from timestamps for these two and reproduced directly by the control below.
- Ordinary setup now previews and confirms inside one minute (waits out a nearly finished one; repeats only a `STALE_PREVIEW` that crossed a minute, at most twice, and logs it). Proof in a nearly used-up window, started at second 57: passes; with the alignment off it fails with the same 409 (`evidence/phase6-fixture-setup-minute-2026-11-27.log`).
- A setup failure writes its stage and response (to `evidence/setup-failures.jsonl`) before removing the account. Strict end-of-test cleanup now uses `removeStudent`, which ignores an already-removed account and reports other problems softly, so it cannot replace the first error. The final run recorded no setup failure.

## Home next action
The fixture now has exactly two eligible tasks today in a zone where it is mid-morning; the time-of-day skip is gone. Passed at both widths in the final sweep.

## Final run on `dc2cce0687b6214a`
| Check | Result | Log (`evidence/phase6c-final-…`) |
|---|---|---|
| Production build, `tsc`, lint, `verify`, `contracts:local`, route audit; asset secret scan (57) | pass; 0 findings | `run.out`, `verify.log`, `contracts.log` |
| Production build: early input, Calendar save, early disclosure | 26 passed | `prod-input.log` |
| Dev-server sweep, desktop and 390 px (all specs except late confirmation and the proxy/fixture-key ones) | 216 passed, **2 failed**, 2 skipped | `suite.log` |
| Rerun of both failed files, same source | 10 passed | `suite-rerun.log` |
| Late confirmation, both widths (separate invocation of the same run) | 6 passed, 2 skipped | `late.log` |
| Fault proxy and provider stub | 30 passed | `faults.log` |
| Failed-read journey, fault proxy | 2 passed | `faultread.log` |
| Production build behind the proxy | 34 passed | `prodproxy.log` |
| Fixture-key build, Turnstile retry | 4 passed | `turnstile.log` |

**Failures, by name**
1. `mock-progress-owner` · "recovery time does not imply completion…", desktop. The dev server's first compile of `/api/mock-reports/[id]/recovery` had not finished when the 20 s wait expired; the request never returned (`evidence/phase6c-mock-progress-compile-2026-11-27.log`). Dev-server timing; proof: rerun, and 390 px in the sweep.
2. `phase4-reviewer` · "simultaneous decision from a stale second tab…", desktop. **A real dropped click**: "Edit" on the reviewer item page, pressed while the page was still reloading, does nothing. Reproduced deterministically (`evidence/phase6c-reviewer-early-press-reproduced-2026-11-27.log`). Staff page, **not fixed** in this closeout; proof of the rest of the journey: rerun.

**Skips, by name**
- "forecast · a failed catch-up read…" ×2 in the sweep: needs the proxy; passed 2 of 2 there.
- "ordinary fixture setup begun at the end of a minute…" and "a setup failure keeps its failing stage…" at 390 px: no browser involved; passed on desktop.

**Hydration (26 Nov occurrence): still open.** 432 dev-server sequences in total (216 at 390 px), 0 messages; strict collector and full capture retained.

**Performance** was not re-measured: this closeout changed no measured page. The table in section 3 (fingerprint `a697958d23db9ebf`) stands. The 69-read ceiling applies to a fresh student's Home (65). History-student Home (78), Calendar (83, ceiling 90) and owed-work reads are reported separately there.

---

# Earlier Phase 6 record (fingerprint `a697958d23db9ebf`; superseded where it differs)

## Four verdicts
| Track | Verdict |
|---|---|
| Software acceptance | **Closed locally.** All gates pass. Browser: two checks failed in the final full run during test-account setup and passed on rerun on the same source (below). The 26 Nov 390 px hydration finding is **carried forward, unreproduced**. |
| Importer compatibility | **Blocked, unchanged.** The importer still refuses `reference-draft-bank.2`. No bank owner is identified to this work and neither decision has been given. |
| Question availability | Last authorised report, 26 Nov (run 2026-11-25T23:27Z): **0 approved questions; 0 of 102 readings servable.** Not re-read since. Local stack: 0 items outside fixtures, before and after the runs. |
| Release readiness | **Not ready.** See "Outstanding". |

## 1. First-pass study in the catch-up forecast
Code: `recovery/firstPass.ts` (new), `catchUp.ts`, `status.ts`, `service.ts`; Weekly Review passes the chosen path and mock choice.
- Demand: pending readings in a first-pass, consolidation or revision milestone whose phase is open inside the window (today or next week, to exam minus 2 weeks). Final preparation adds none and the status says so.
- Counted once per reading: minutes held by accepted, owed or carried tasks, delivered, logged or skipped are taken off.
- Order of claims on time: booked mocks and open repairs, provisional revision and papers, owed work, then new study (Roadmap order, 15-minute minimum, sitting limit, daily new-learning limit; a reading never overtakes the one ahead).
- Because new study is last, whether owed work fits, and the recovery rule, are exactly as before. It only adds a trade-off: headline, named readings and minutes, and "add time" or "pause revision". It writes nothing.
- Protect-core path: revision waits until owed work clears. Mock-led week accepted: first-pass study is not counted and is named as left out.
- A failed catch-up read now says "could not be loaded" on Home, Calendar and Roadmap (before: nothing shown).

Proof: 45 unit checks (changes the recommendation; fits; mock-led; chain counted once; fragmented day; missing Roadmap and unreadable Roadmap); `phase6-forecast.spec.ts` at both widths across Home, Calendar, Roadmap, Weekly Review and Coach, with unchanged-row checks. Fixtures: owned students, time shift, edited availability, seeded deferred tasks (mock-led case). Missing-data cases are unit proof only, apart from the injected failed read.

**Limits.** (a) A review draft's minutes differ slightly from the saved pages' because the draft's own new tasks are not yet accepted (observed 24 min in 169 h); the draft says so. Headline and named readings match. (b) On-track students (nothing owed) get no forecast, to keep their read cost. (c) Skipped study is treated as declined and left out. (d) An accepted mock-led week is recognised from reviews saved from now on.

## 2. Early input and hydration
Reproduced on the old code (`evidence/phase6-early-input-reproduced-2026-11-27.log`), then fixed:
| Form | Old behaviour |
|---|---|
| Display name; Settings study-time setup; class move (deep link); next class (link); mock report; weekly review answers | Input given while loading was lost; the old value or nothing was sent |
| Calendar download range | Preview asked for the old dates |
| Mock weekly choice; "Add study task" | Early press dropped |
| New task start time | A half-typed time was erased and the earlier time saved |
| Mock report numbers | A half-typed number was accepted as blank (confirmed with the guard switched off) |

Class log did **not** reproduce and is unchanged. Half-typed values in forms with native validation (class/commitment, mock date and time) were already refused by the browser. Added-window half times were refused; a message was added. Fix: `components/ui/WhenReady.tsx` gates server-rendered forms until React is attached. `phase6-early-input.spec.ts`: 10 journeys, both widths, dev and production build. Most check both the request and the saved row; the download, review, added-window, new-commitment and class-log cases check the request or the screen only. Lost-response and stale saves: covered by the existing journeys in the full run (recovery, manual task, class editing, mock recovery).
Edits in files holding other workers' uncommitted changes: `DisplayNameForm.tsx` (wrapper), `OnboardingShell.tsx` (ready gate), `CalendarWeekGrid.tsx` (buttons), `ReviewWeekForm.tsx` (wrapper), `calendar/page.tsx`.

**Hydration.**
- *Fixed:* opening a Calendar disclosure (for example "Download this schedule") before React arrived raised React's attribute-mismatch error on the agenda route at both widths (`open=""` on `details.cal-export`). Regression failed before, passes after (`phase6-hydration-disclosure-reproduced-2026-11-27.log`).
- *Open:* the 26 Nov occurrence. Same message and route class, but its record did not name the element, so the fix is not claimed to explain it. Matrix: Settings → Calendar link, the exact `week=…&view=agenda#calendar-today` full load, past week → Today; browser zones London, Auckland, Los Angeles; real clock and just past the student's local midnight; normal and slowed scripts; runner Asia/Calcutta, student London. 288 dev-server sequences (144 at 390 px), 0 messages. Production-build runs are excluded from that count because React does not report attribute mismatches there. Capture now also covers the auth, walkthrough and Turnstile journeys.
- Disclosures outside Calendar were not audited.

`turnstile-retry`: 4 of 4 on a production build with a fixture site key and stub script (shared script loading across auth navigation included). Local UI proof only.

**Also found and fixed:** the flashcard list let an older reply replace a newer filter (failed once at 390 px in the first final run; then reproduced deterministically). `FlashcardPanel.tsx` now applies only the newest request.

## 3. Cost for students who owe work
Local production build behind the loopback proxy, 15 warm samples, same method before (Phase 5 build) and after. Reads (RPCs) · p50/p95 ms. Every persona has an unreviewed week, so Home and Calendar see owed work in all four; the name says what the review answers.

| Persona | Route | Before | After |
|---|---|---|---|
| review all done | Home / Calendar | 78 (4) 129/138 · 77 (4) 116/123 | 77 (4) 132/150 · 76 (4) 114/118 |
| | Review GET / preview | 80 (2) 125/168 · 91 (4) 165/171 | 80 (2) 119/138 · 90 (4) 162/182 |
| catching up | Home / Calendar | 78 (4) 123/127 · 77 (4) 114/123 | 77 (4) 121/130 · 76 (4) 110/114 |
| | Review GET / preview | 80 (2) 118/122 · 102 (4) 160/174 | 80 (2) 117/132 · 101 (4) 158/166 |
| recovery | Home / Calendar | 90 (4) 141/144 · 89 (4) 136/151 | 88 (4) 139/147 · 87 (4) 131/136 |
| | Review GET / preview | 85 (2) 118/122 · 102 (4) 160/163 | 84 (2) 116/122 · 101 (4) 160/176 |
| history with debt (8 reviewed weeks; 34 and 37 logs) | Home / Calendar | 91 (4) 140/145 · 89 (4) 132/139 | 88 (4) 136/139 · 86 (4) 129/134 |
| | Review GET / preview | 85 (2) 120/127 · 113 (4) 163/174 | 84 (2) 117/136 · 112 (4) 159/167 |
| nothing owed, fresh | Home / Calendar | 65 · 70 | 65 · 70 |
| nothing owed, history | Home / Calendar | 78 · 83 | 78 · 83 |

- No-debt ceilings met on the basis used in Phase 5: Home 65 (≤69, fresh student), Calendar 83 (≤90, history student). The history student's Home is 78, above 69, unchanged by this phase.
- The forecast added no database reads (first after-build equalled before). The 1–3 saved come from sharing two identical per-request reads: the opening review's recap and the confirmed completion scopes.
- Debt cost is the existing catch-up status: capacity, logged minutes, repairs, estimates, closed-week history. It grows with reviewed weeks (Home 77 → 88).
- Other identical repeats remain (for example curriculum manifest, class exceptions, assessment attempts); not changed.
- Debt personas are rebuilt per run, so the history persona is comparable, not identical.

## Final results on `a697958d23db9ebf`
| Check | Result |
|---|---|
| Production build, then `tsc`, lint, `verify`, `contracts:local`, route audit; browser secret audit (57 assets) | pass; 0 findings |
| Production build: early input, Calendar save, hydration | 28 passed |
| Full dev-server run, desktop and 390 px | 214 passed, **2 failed**, 4 skipped |
| Rerun of the affected files, same source | 10 passed, 2 skipped |
| Fault proxy and provider stub; failed-read journey | 30 passed; 2 passed |
| Production build behind the proxy | 34 passed |
| Fixture-key build, Turnstile retry | 4 passed |

- The 2 failures (`phase7c-retake` desktop; disclosure journey 390 px) were in student setup, not the page under test. Retake: onboarding confirm returned `STALE_PREVIEW`. Disclosure: only the cleanup error is shown ("User not found"), consistent with setup having failed and removed the student. Likely cause: the time guard in migration `20270207` (proposed same-evening sittings no longer fit) while runs fell inside the fixtures' evening window. **Not proven**; both passed afterwards. A real student who confirms late in their window would be asked to rebuild the preview.
- The 4 skips: the failed-read journey ×2 (needs the proxy; passed there) and the Home next-action journey ×2, which skips itself when only one task remains today. It passed at both widths in the earlier run on `6685733a38235fbf`, which differs only by the flashcard fix and its test.
- Empty bank: `position-path` and `phase3-recovery` (external mock recorded as self-report) are in the full run.
- Logs: `evidence/phase6-final-*`. Scored journeys use synthetic fixtures.

## Cleanup
Owned students deleted by ID; 0 local auth users left. Local database and apps stopped, no listeners. Build directories removed. Per-run JSON moved to the session scratchpad.

## Outstanding
| Action | Owner | Proof that clears it |
|---|---|---|
| Confirm a bank owner; decide shared families and `.2` provenance; apply the patch | Bank owner (unassigned) | Decisions recorded; both formats, malformed input, rollback, retry and zero eligibility pass on a disposable database (`patches/reference-bank-format-2-handoff.md`; patch still applies) |
| Approved questions | Bank owner, then owner | Fresh authorised `bank:capacity` report on the named target |
| Verify migrations 20270210–212 (reported applied) | Owner authorises; engineering reads | Ledger versions and checksums (checklist item 7) |
| Mail, reset, Google, Turnstile, reminders, config, compute | Owner | Checklist items 1–6, 8 |
| Commit and deploy | Owner | Committed tree, fingerprint, health check (item 10) |
| 26 Nov hydration occurrence | Engineering | A capture naming the element, then a failing-then-passing test |
| Late confirmation: decide a preview grace period | Owner, then engineering | A student reading the preview for the agreed time can accept it; the late-confirmation journeys still refuse beyond it |
| Reviewer item page drops an early "Edit" press | Engineering | Probe fails before, passes after |
