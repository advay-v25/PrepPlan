# Phase 4 acceptance closeout — dates, installation and exact command records

Finish these concrete Phase 4 gaps before starting Phase 5. Preserve the delivered authoring/reviewer/student loops and all unrelated dirty work. This is a bounded acceptance correction, not another diagnostic redesign.

Read `AGENTS.md`, the required Ponytail instructions, the Phase 4 original/completion prompts and master status §9.48. Read the relevant installed Next.js documentation before framework changes. The owner-authorised database remains the disposable development project `asylsxszdhlnzewhwtga`. No commits, deployment, provider calls, model/budget changes or real-content approvals.

## What stands

Preserve pack-derived rights, canonical capacity, prompt/model-package resume guards, the versioned authoring checks, explicit concept review, exact-version question approval, held-out isolation, durable answers, frozen paper/scoring semantics and existing repair policy. The real bank is still empty; fixture success must not become a real-content claim.

Owner review reran `llm:bounds:test` 24/0, `authoring:eval:test` 34/0 and `batch:worker:sim:test` 19/0. The additional failure below is not covered by those green suites. The reported desktop/mobile journey also used a matching server/student timezone, so it does not prove timezone independence.

## 1. Fix the reported re-check date mismatch at its actual source

The handoff says the re-check start was one day off until the server was launched with `TZ=Europe/London`. This workaround is not an acceptable product dependency: one server serves students in multiple zones. First reproduce and identify whether the mismatch belongs to application logic, SQL session timezone, timeline fixtures, or a browser assertion. Do not patch the application if only the fixture is wrong, and do not waive a product error as a fixture issue without proof.

Trace the full route:

`repair completion → due-date storage → add-re-check command → Calendar task date/display → assessment preflight → start command → resume`.

Relevant starting points: `src/lib/tests/repairCheck.ts`, `src/lib/repairs/service.ts`, the effective `place_repair_check`/`start_repair_check` definitions, `studyWeek.ts`, Calendar data/drawer, `scripts/lib/timeFixture.ts` and `tests/e2e/lifecycle/phase4-student.spec.ts`.

Distinguish a calendar date from an instant. Audit `next_recheck_due_at`, UTC string slicing, session-dependent `::date`/`::timestamptz`, process-local date construction and shifted timestamps. Reuse canonical student-zone/date helpers. Preserve the existing spacing duration and calendar-day versus elapsed-time policy; do not change the rule to make the test pass. Preflight, transactional start and UI must agree. Keep dates inside the actual cycle and exam horizon.

Proof:

- Same fixed instant and same student zone yield identical due date, Calendar date and eligibility under server `TZ=UTC`, `Asia/Kolkata` and `Europe/London`.
- Cover students in Kolkata and London, one zone west of UTC, local midnight and a London DST transition. Demonstrate the original mismatch red, then green. If the issue is entirely test-side, show the application results that prove it and fix the fixture.
- Re-run the connected student browser journey at desktop and 390px with the server timezone deliberately different from the student's. The test must not require a matching `TZ` environment to pass.
- Waiting before eligibility writes no attempt; eligible Start works and retries resume the same attempt. Existing papers/history remain unchanged.

Use injected clocks for deterministic pure tests and clearly registered historical fixtures for endpoint/browser checks. No production test-only bypass, shortened spacing, hardcoded today or blanket timezone override.

## 2. Make clean installation, upgrade and restore agree

`beta:install:rehearse` currently compares an older baseline directly with the latest schema without applying later migrations. `beta:upgrade:rehearse` does apply them. The hosted installer also installs only the baseline and then tells the operator to expect zero pending. Those behaviours need one coherent contract; a pre-existing red gate is still an unresolved gate.

Inspect `scripts/beta/install.cjs`, `install-hosted.cjs`, `install-rehearsal.cjs`, `make-baseline.cjs`, package scripts and the baseline manifest. Choose the smallest correct approach:

- either bring the supported baseline to the current effective schema using the existing generator;
- or make the canonical fresh-install path install the pinned baseline **and apply its later migrations** before declaring readiness, with identical steps in its rehearsal.

An intentionally historical baseline is valid if the complete installation path upgrades it. Do not merely skip reconciliation, rename failure as success or delete the failing command. Remove dead helper code encountered in the touched installer after tracing callers. Do not rewrite checksums or edit applied migrations. Preserve the upgrade test from a genuinely earlier baseline.

Run clean install, upgrade and restore on owned disposable local databases. Verify all current schema categories and effective function definitions, policies, ACLs, triggers, indexes, reference data and migration ledger/checksums. Report exact counts and zero pending/drift. Include `mock_reports`, recovery commands and the new concept-signoff objects in checks. Ensure baseline/reference generation contains no real users, private source facts, provider secrets or synthetic test-bank residue.

Do not run the hosted production installer or provision a project. Update its instructions/code only as needed to match the verified local installation contract.

## 3. Preserve late-response usage while still rejecting late output

Owner reproduced this against `src/lib/llm.ts` using a local replacement of `chat.completions.create`: it ignored abort, waited 35 ms and returned a valid JSON result plus usage of 7 prompt / 3 completion tokens, with `stageMs: 5`.

Observed result: the response was correctly refused, but usage was `{ calls: 1, knownCalls: 0, unknownCalls: 0, promptTokens: 0, completionTokens: 0, attempts: [] }`.

Cause: after the awaited response, `if (own.signal.aborted) throw stopped(...)` runs before accounting; the catch immediately rethrows `LlmStopped`. Thus one sent request has neither known nor unknown usage and no attempt record.

Fix once in the shared accounting path:

- A response already received with valid usage records that known usage even when its content is discarded as late. No late item or model output becomes usable.
- Missing usage stays explicitly unknown. Aborted/rejected requests get one accurate outcome record; no double counting on catch/rethrow.
- A reservation refused before sending is not a sent request. An abort after reservation but before HTTP send is distinguished from an ambiguous in-flight request.
- Maintain `calls = knownCalls + unknownCalls` for every settled run. Validate malformed/partial usage metadata rather than treating any truthy `usage` object as fully known.
- Preserve already-known generator usage when verifier fails; cancellation prevents later fallback; report reservations separately from measured usage/cost.

Add the exact ignored-abort late-response regression, with and without usage, to the existing bounds suite. Assert known token totals, one sent request, one attempt record, no fallback, and discarded content. Test the batch worker persists the final settled telemetry even on failure. Keep timers/listeners bounded and cleaned up.

Use controlled local providers only. Do not repeat the real pilot.

## 4. Bind concept sign-off retries to the complete reviewed request

The new `decide_concept_signoff` replay branch checks reviewer and decision but returns before comparing `p_expected_hash` or rationale. Reusing one key with a different scope hash/reason can therefore report a successful replay of a request that was not the one submitted.

Use the existing command/receipt pattern to bind the key to concept, authenticated reviewer, explicit decision, reviewed scope hash and a consistently normalised rationale. Exact retries must replay the original receipt; materially changed requests must return a clear conflict and write nothing. The receipt must describe the original decision, not masquerade as approval of a later scope.

Trace the concept route and UI. Reject overlong/invalid keys or rationale explicitly rather than silently truncating two different requests into the same command. Do not invent audit data for historical decisions or change a previously applied migration. If storage changes are needed, add an additive migration that patches the effective function and preserves ACLs.

Prove exact retry, lost-response retry, same key with changed scope/reason/decision/reviewer, concurrent identical and incompatible requests, and scope edit after the original decision. A stale/conflicting command changes neither status nor audit history. Preserve active-manifest/role/confirmation requirements and the trigger's scope-edit revocation.

## 5. State the sign-off-withdrawal policy precisely; do not silently change it

The current implementation blocks new approvals after withdrawal but keeps already approved item versions eligible until explicitly retired. That differs from immediately suspending new delivery of dependent items. Do not conflate either policy with rewriting frozen papers or erasing historical evidence.

Retain the current behaviour in this closeout unless the owner explicitly decides otherwise. Verify the reviewer warning/count and canonical inventory/student preflight remain consistent with that policy, and document it as an owner decision still to confirm. Add a focused approved-fixture test: approve → withdraw/edit scope → inspect future eligibility, historical form and evidence → explicit retirement. If a particular screen says all dependent items are blocked while the reservation still serves them, fix the inaccurate claim, not the policy by surprise.

## 6. Final acceptance and evidence

Run sequentially where fixture banks/accounts can interfere. Required final proof:

- named regressions for the three product/command issues above;
- full `npm run verify`, canonical TypeScript and migration dry-run;
- clean install **and** older-baseline upgrade **and** restore, with effective definition/ACL parity;
- affected LLM/worker/batch/reviewer/capacity/repair/reservation suites;
- both existing Phase 4 reviewer and student browser journeys at desktop and 390px, including a deliberately mismatched server/student timezone.

Tighten the existing Phase 4 browser error handling while rerunning: `phase4-student.spec.ts` currently allows several endpoint/status errors for the whole test and ignores resource-console messages broadly. Limit allowances to the deliberate failing step/request; correlate a genuinely expected post-score progress beacon with the owned scored attempt. Unexpected errors on another step must fail. Do not weaken a failed assertion or count an unavailable fixture paper as a pass.

Record UI versus seeded setup, any clock/history fixtures and what they do not prove. Keep real inventory, guarded synthetic banks and simulated provider proof separate. Source packs remain private/unconfirmed and real candidates remain unapproved. No real-provider success is required or claimed in this closeout.

Append one requirement → implementation → proof closeout to the master status and one machine-readable evidence record. Include source fingerprint/file hashes, additive migration checksums, final commands/results, timezone matrix, installation parity, browser error counts and cleanup. Correct the earlier software-complete claim by explicitly linking the resolved gaps.

Clean only your owned students/banks/locks/output. Stop only owned recorded processes, restore canonical types, leave unrelated work/accounts alone. No commits/pushes or external account operations. Stop after this closeout; Phase 5 gets its own prompt.

The finish line is a complete, reproducible Phase 4 software path on fixtures **without a server-timezone workaround, unexplained installation failure, missing sent-call accounting or unbound retry receipt**. Real-content availability remains a separately stated external blocker.
