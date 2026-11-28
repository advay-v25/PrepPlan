# PrepPlan Phase 6 · Catch-up accuracy, browser reliability and release handoff

## Assignment

Work from the current checkout. Read the Phase 5 status record, the owner release checklist, the intermittent Calendar evidence, and the format `.2` importer handoff before editing. Record the starting source fingerprint and inspect the dirty tree. Preserve concurrent edits. Phase 5 software was accepted on fingerprint `71c0a48cedfe1195` with 186 browser checks passing, plus 30 fault/provider-stub, 34 production-build/proxy and 4 production Calendar-save checks. Scored software journeys used synthetic fixtures. Carry that evidence forward.

Make the changes and run the proofs below on an isolated local stack. Use owned students, registered synthetic banks and controlled providers. Keep production traffic closed. Hosted reads, migrations, provider actions, publication, commits and deployment require separate authorization. Keep the local software, importer compatibility, real inventory and release verdicts visible throughout.

## 1. Include first-pass study in the catch-up forecast

Use the existing roadmap and planner to derive named, unfinished first-pass work when the student's active path still schedules it. Treat it as provisional demand alongside unaccepted revision and weekly papers. Choose demand from the applicable weeks and phase, within the exam horizon. Deduplicate by canonical reading or scope and continuation lineage. Accepted work already occupies capacity. Owed work retains its own obligation and order. Optional work the student declined and work deferred by their accepted mock or recovery path stay out of the forecast unless that path schedules them later.

Start with `src/lib/planning/recovery/catchUp.ts`, `status.ts`, their input loader, `src/lib/planning/usableTime.ts` and the existing weekly planner. Reuse the same availability, commitments, protected bookings, sitting limits and real gaps. Respect sequence and the difference between splittable study and work that needs one sitting. Avoid a planning loop in which recovery asks a draft to compute recovery again.

Keep these outcomes legible in the canonical recovery status consumed by Home, Calendar, Roadmap, Weekly Review and Coach:

- The accepted plan and already-owed work fit or do not fit.
- The expected additional study, revision and assessment work fits or would need a trade-off. Show what would wait and how many minutes, using named work where the data supports it.
- When only the provisional work makes the full roadmap infeasible, explain the choice. For example, the existing catch-up can fit if the student delays specific new work or adds a feasible window. Preserve the current recovery rule for repeated genuine shortfalls or work that cannot clear in time. A forecast creates no shortfall, history entry, commitment, evidence or accepted task.

Prove a first-pass case where the provisional workload changes the recommendation, a case where it fits, and a mock-led case where displaced broad first-pass work stays out. Include duplicate accepted/carried scope, a fragmented day, and missing forecast data. Verify matching status and explanation across the existing routes `/app`, `/app/calendar`, `/app/curriculum?view=roadmap`, `/app/review-week` and `/app/coach`. Use the existing review approval flow for edits.

## 2. Fix confirmed early-input bugs and retain the hydration evidence

- Start with the proven Calendar save regression. Extend the same slow-script and immediate keyboard-entry check to existing task creation, Calendar class or mock editing, Weekly Review added windows and Settings setup saves. Trace each form before changing it. Prove that a confirmed save matches the visible inputs and that invalid or half-entered values are refused without losing input. Preserve deliberate blank values, focus, keyboard access, and stale or lost-response handling.
- Extend full hydration capture to the Calendar and Settings journeys that bypass the shared login helper. Re-run the exact 390 px Calendar agenda deep link from the Phase 5 evidence, including the Settings → Calendar sequence, mismatched timezones and a local date boundary. Keep full messages and safe route context. If reproduced, identify the differing element, fix its source and show a failing-then-passing test. If it stays unreproduced, keep it open with the number and conditions of attempts. Preserve the strict error collector.
- Run `turnstile-retry` in the isolated fixture-key build, including shared script loading across auth navigation. Record that as local UI proof. Real server-side Turnstile, Google and email remain in the live-provider checklist.

## 3. Check the cost for students who owe work

Measure `/app`, `/app/calendar` and Weekly Review GET and preview on a local production build. Use the Phase 5 on-track, catching-up and recovery personas with at least 15 warm samples each. Include a history-heavy case with owed work. Keep bank state, timezone and request method comparable. Record database reads, RPCs and p50/p95. For Home and Calendar keep the existing no-debt ceilings of 69 and 90 using the same metric as the baseline. Establish and report the debt-heavy baseline and attribute new costs. Phase 5 recorded Home 65 and Calendar 83 reads for students with nothing owed and review preview 91/102/102 reads across its three personas.

Share duplicate request-scoped reads when owner, time range, filters and freshness match. Preserve fresh write-time and stale-draft checks. Report failed reads separately from valid empty results.

## 4. Keep the bank and release work explicit

The current importer still refuses `reference-draft-bank.2`. Use `docs/patches/reference-bank-format-2-handoff.md` for the existing patch, local proof and two owner decisions on shared families and source provenance. Confirm the owner and obtain those decisions before landing the importer change. When approved, rehearse both supported formats on a disposable database, with malformed input, rollback, idempotency and zero student eligibility. If ownership or a decision is unavailable, record the exact blocker and finish the independent software work.

The last authorised capacity report on 26 November showed zero approved production questions. Keep it dated. If a fresh hosted check is separately authorised, use the canonical read-only report on the explicit target. Keep import, rights, concept sign-off, human review, publication and actual student capacity distinct. Run the empty-bank student flow locally, including external mock reporting as self-report.

Use `docs/PHASE-5-OWNER-RELEASE-CHECKLIST.md` for live verification and configuration. Migrations `20270211` and `20270212` are reported applied by the owner. Keep that status until an authorised ledger read verifies versions and checksums. Include the target, owner, evidence and status for each release action. Leave deployment and traffic controls as they are.

## Acceptance and handoff

- Run the new cases and affected lifecycle journeys at desktop and 390 px, including a stale or lost-response save and the mock and recovery regressions. Exercise a fresh student and a student with history.
- On the final source, run TypeScript, `npm run verify`, the route audit, applicable local database contracts, the isolated production build and the browser-asset secret audit. If schema changes, run local install, upgrade and restore with ledger and checksum proof. Use generated types from the final build and record the source fingerprint.
- Write a short Phase 6 evidence record with routes, exact pass/fail/skip results, fixtures versus browser-driven steps, before/after performance, the hydration outcome, and cleanup. Stop owned services and clean up fixtures by ID.
- Report software acceptance, importer compatibility, actual question availability and release readiness as four verdicts. Mark each outstanding action with its owner and the proof required to clear it. Close the software work when the required local changes and tests pass, with any unreproduced hydration finding explicitly carried forward.
