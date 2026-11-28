# PrepPlan Phase 6 · Final execution handoff for Gemini Hydrogen

Finish Phase 6 from the current checkout. The previous pass closed the known first-week acceptance, early-input, flashcard ordering and catch-up forecast defects locally. Preserve those fixes, close the remaining coverage and tooling gaps, and deliver one reproducible final acceptance record. Stop after the Phase 6 handoff.

## Owner decisions and scope

- Keep the first-week review buffer at 15 minutes and the first-week minimum usable study gap at 15 minutes. When today has less than one usable sitting after the buffer, leave today clear. A short remainder today does not push the whole plan into next week when a later day in this cycle can take it. A fitting draft can still be accepted after 15 minutes. The review buffer is a scheduling rule.
- The owner confirms that `20270213_onboarding_acceptance_guard.sql` has been applied. Record it as owner-confirmed. Use the existing file unchanged and include it in local rehearsals.
- All work and verification for this handoff are local. Use your own app or test process, a disposable local database, and accounts recorded by exact ID. Leave hosted databases and providers, deployment, and other workers’ processes alone. Question-bank work is deferred. Reuse existing synthetic test fixtures where a regression needs them.

## 0. Load the minimum context

1. Read `AGENTS.md` and the Ponytail skill it names. Read the relevant installed Next.js guide before touching Next.js code.
2. Start with the top closeout entry in `docs/PHASE-6-STATUS-2026-11-27.md` and its `phase6f` evidence. Consult `docs/PREPPLAN-PHASE-6-FINAL-CLOSEOUT-PROMPT.md` for original acceptance criteria if needed. The last reported fingerprint is `b68df3dd5776e546`. Capture the current one with `node scripts/source-fingerprint.cjs`, inspect `git status --short`, and read only diffs and files on the affected paths. Preserve the dirty tree and concurrent work. Identify unrelated drift before attributing failures to Phase 6.
3. Reuse the existing local stack, rehearsal commands, browser harness, clock fixtures, fault proxy and measurement scripts. Read the scripts and check their targets before execution. Establish an evidence table up front with each requirement, current proof, action needed and final proof. Carry forward prior evidence for resolved issues, then verify the relevant regressions on the final source.

## 1. Make database rehearsals local by default

The previous install and upgrade runs made two unintended read-only staging connections. The current `scripts/beta/install-rehearsal.cjs` defaults to reading `.env.staging.local` and connecting. Close that tooling gap first.

- Make ordinary install and upgrade commands use loopback and disposable databases. Retain `--local-only` for existing callers. If retaining hosted parity comparison, put it behind an explicit opt-in and an explicit target check before credentials are loaded or a connection is attempted. Update the command help and the directly affected runbook or npm aliases. Check the restore command and helpers for inherited environment or hosted fallbacks.
- Prove the ordinary paths complete with hosted credentials absent and that invalid flag combinations or a missing hosted target fail before any hosted configuration read. Use local tests or stubs for the hosted branch. Keep schema, privilege and migration checksum assertions intact.

## 2. Finish first-week acceptance and recovery proof

Trace preview and confirmation through `previewService.ts`, `planning/activation/draftService.ts`, `planning/schedule.ts`, `planning/pulse/firstCycle.ts` and `accept_onboarding_preview`. Include activation recovery. Extend the existing `onboarding-buffer-db-test` and `phase6-late-confirm` coverage where needed.

- With a fixed clock and otherwise feasible inputs, cover 29, 30 and 31 contiguous minutes remaining at preview, with boundaries aligned to planner precision. Also cover multiple sub-15-minute gaps after the buffer, an elapsed last window, another viable day in the same cycle, a viable next cycle, and no viable time before the exam. Assert actual placements and reasons, not just text. Include class-led and self-study boundaries, protected time, sitting limits and a student-local date rollover.
- Drive review → delayed confirm → Calendar at desktop and 390 px. Show a draft that remains feasible across a minute boundary and after the buffer. When elapsed time or changed inputs make the proposal infeasible, refuse it with zero partial writes, keep the student's answers, and explain the actual reason. The rebuilt preview must show the same week, time zone and placements that it will commit. Make setup time deterministic without requiring preview and confirm in the same minute.
- Keep durable proof for conflicting first-week drafts, duplicate confirm and lost response, stale setup and rebuild racing acceptance. Assert one accepted cycle, one set of tasks and one receipt, with no past timed blocks and no lost draft when the outcome is unknown. Reuse the original request on replay. An existing active plan stays intact. Preserve the database as the final authority.

## 3. Close early interaction and mobile gaps

- Audit the unchecked disclosures on Home, Tests and setup, plus the Curriculum Notes editor. Read the relevant components and test real entry points under delayed hydration or a delayed initial load. Exercise pointer, keyboard and IME where applicable. A control should either work or clearly indicate it is loading. A slow read, save or refresh must preserve newer input, selection and focus.
- Re-run the reviewer Edit and stale second-tab decision flow, flashcard edit and filter ordering, Calendar keyboard save, and the Readiness width check. Include loading interruptions or slow responses where the existing defect depended on timing. At 390 px measure overflow against both the configured viewport and document client width. Fix confirmed nearby regressions with narrow changes. Preserve normal keyboard and native disclosure behavior.
- Keep the original 26 November Calendar hydration report separate from the reproduced early-disclosure fix. Cover Calendar navigation from Settings and direct links at 390 px on a production-style build, including a student/server time zone difference. Use strict capture for the exact route, console message, component or DOM evidence when available, viewport and time zones. Fix any reproduced mismatch and show it fail before the fix. If the original symptom remains unreproduced after the focused runs, report it as monitored and unresolved, with the attempt count. Keep error capture active.

## 4. Cut redundant first-week preview reads

The prior local benchmark reported 255 reads and 1 RPC for a fresh draft, with p50/p95 of 159/171 ms, and 2 reads plus 3 RPCs for draft reuse, at 42/45 ms. Use those as historical context and take a matched baseline on the current checkout before editing. Reuse `scripts/stack-onboarding-measure.ts` and caller tracing.

- Identify why the capacity lookup repeats across dates and between cycle selection and preview generation. Where the data and freshness requirements match, load once per request and reuse inputs in the per-day calculation. Keep the acceptance transaction's fresh state, ownership and time checks. Preserve complete reads, date boundaries, fit, and failed-read behavior. Show equivalence of the resulting proposals for fresh self-study, class-led and constrained or later-entry students.
- Show the before and after counts for reads and RPCs, the p50/p95 of at least 15 matched samples per fresh and reused case, and the calls removed. Keep reuse cheap. Recheck the fresh Home budget of 69 reads with the existing persona. Report history and owed-work counts separately. If a remaining repeated read has to stay for correctness, name the call and explain the dependency.

## 5. Run the final gates and hand back proof

- Run typecheck, lint, `npm run verify`, route audit, local database contracts, local install/upgrade/restore rehearsals with checksum proof, an isolated production build, and the client-secret audit against that build's actual static output. Run workspace-specific commands from the repo manifest. Record all commands and exit codes.
- Run the full browser sweep at desktop and 390 px from the final source. Run fault-proxy, production-build and CAPTCHA fixture cases in their correct harnesses. Make a pass/skip ledger that names each intentional skip and where its behavior was exercised. Recheck fresh and class-led first-week acceptance, continuation, Settings and the mock-led forecast paths affected by this phase.
- For the prior desktop `mock-progress-owner` timeout, capture the timing of the Calendar navigation and compare the controlled dev run with the production build. Preserve the student-state assertions and report unresolved causes as such. A rerun supplements the original failure record. Fix reproduced product failures and rerun affected proof before closing.
- Update `docs/PHASE-6-STATUS-2026-11-27.md` with a new closeout entry and link machine-readable evidence. Include the starting and final source fingerprints, requirement-to-proof table, changed files, relevant before/after evidence, desktop/mobile and fault results, before/after read counts, and any genuinely open item with its exact scope. Distinguish browser-driven steps from fixture setup. Record the migration as owner-confirmed and local rehearsal results independently. Stop only owned processes and remove only recorded fixtures and generated outputs from this run. Preserve concurrent edits and generated config used by another worker.

Return one verdict for Phase 6 local software with evidence. Use **closed** once the implementation and mandatory proof above are complete, including an explicit disposition for the historic hydration report. Use **partial** if a required behavior fails or a mandatory gate could not run, with the exact blocker and its impact. Keep any missed proof visible. Do not start Phase 7.
