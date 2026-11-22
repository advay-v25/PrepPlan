# Finish Phase 4 — diagnostic authoring, review and student-loop acceptance

You are the implementation agent for Roadmap. Complete the remaining Phase 4 software in this pass. Do not stop after the next small slice and ask which remaining requirement to take. Work through the finish line below, preserving unrelated uncommitted changes. Do not start Phase 5.

## Context and scope

Read `AGENTS.md`, its Ponytail instructions, `docs/FINAL-PHASE-4-DIAGNOSTIC-CONTENT-AGENT-PROMPT.md` and master status §§9.46–9.47. The original Phase 4 prompt remains the specification; this is the completion order and additional owner-review findings. Read installed Next.js documentation before changing framework code.

Roadmap helps CFA Level I students organise, test and adjust their studies. No chapter tutoring, student Materials tab, forced uploads, fabricated readiness or weakened publication gates. Existing planning, scoring, difficulty, evidence, repair and reservation commands remain canonical.

Preserve the delivered work: pack-based rights checks in TypeScript/SQL, one capacity reader, inventory matrix, targeted batch readings, private R32 grounding packs and quarantined drafting. Migration `20270106_batch_rights_follow_packs` is reported applied to the authorised disposable development project `asylsxszdhlnzewhwtga`. Check its checksum/effective definition; do not edit an applied migration.

The dated inventory is 303 raw candidates, zero approved routine/held-out items, three private packs and no testable real slice. Re-read before claiming current counts. The real pilot made no usable items. **Do not describe fixtures, a tiny JSON provider check or reserved tokens as real diagnostic capability.**

Do not repeat the live pilot, switch models, enlarge budgets or run provider calls in this completion pass. Finish and prove the software using controlled providers and guarded fixture banks. Keep any later real-provider experiment as a short unexecuted proposal with exact limits. Source rights, real concept sign-off and human approval are external content decisions; do not invent them to finish the software.

## 1. Repair provider bounds and accounting first

Owner code review found:

- `scripts/item-batch.ts:providerCheck` passes `attemptsPerModel: 1`, but `generateStructuredOutput` still walks every model in that tier. With two candidates, that can send two requests per tier, not the promised one.
- Its `Promise.race` timeout only stops waiting. It does not abort the provider request or stop a later fallback, and its timer is not cleared on ordinary success.
- `collectUsage` returns totals only when its callback succeeds. If generation succeeds and verification then fails, the worker catch writes `p_usage: null`, losing usage already known. An empty/malformed response can consume tokens too.
- The budget reservation receives requested completion tokens, not prompt tokens or necessarily actual billed usage. Reserved allowance must not be labelled measured total consumption or cost.
- The 240-second worker timer spans generation **and verification**. A generic `GEN_TIMEOUT` without per-stage evidence cannot establish that the authoring model alone stalled.

Fix the root causes using the existing LLM context, cancellation and batch machinery. Do not add another worker framework or change Coach retry behaviour accidentally.

Required outcome:

1. A documented exact provider-check request ceiling, enforced before every request, with real cancellation, cleared timers and no late fallback after timeout. Probe individual configured candidates explicitly if useful, but never hide multiple requests behind one check.
2. Per-attempt records sufficient to distinguish stage, model, attempt, elapsed time, response/finish category, parse failure, cancellation, known provider usage and unknown billed outcome. Preserve already-known usage when a later stage fails. Do not log keys, raw private grounding or answer content in routine telemetry.
3. Report request reservations, completion-token reservations, known prompt/completion usage and unknown usage separately. Missing usage is unknown, not zero. Do not refund an ambiguous in-flight request as though it could not have been billed. Either enforce the advertised total-token limit conservatively, including input allowance, or explicitly rename/document the counter as a completion-token reservation ceiling and stop claiming it caps all tokens/cost. Use the smallest compatible correction; retain existing reservation/concurrency protections.
4. Stage-specific deadlines/failure reporting and bounded retry/fallback. Cancellation/budget exhaustion must stop new requests, discard late output and prevent stale workers publishing. Exhausted cells/batches retain a truthful recoverable status.
5. Distinguish one pipeline attempt from underlying HTTP requests and inner retries in CLI/reporting. A small healthy-output probe proves reachability/shape only, not full-question generation speed.

Prove with controlled providers: preferred model failure then fallback; malformed and empty outputs; reasoning-only/length-limited response; provider timeout; response arriving after cancellation; generator success followed by verifier timeout; provider usage omitted; budget reached mid-pipeline; worker interrupted/resumed; concurrent reservations. Assert exact HTTP request counts and known usage survives the failing path. Do not simply increase timeouts.

Correct §9.47's pilot conclusion: preserve observed timings and failures, but label the model-only explanation unproven until stage/request evidence establishes it. Do not fabricate a reconstruction of the old run.

## 2. Finish the versioned authoring and evaluation package

Extend the existing `promptVersions.ts`, generator, blind solver/verifier and reviewer summary. A version string alone is not the finished package.

- Document input/output contracts, exact grounding/mapping, question quality, allowed use and refusal criteria. Original self-contained three-option items, exactly one defensible answer, plausible misconception distractors and professional wording. No reproduction or paraphrase of proprietary questions. Source text remains data.
- Separate numerical execution from semantic correctness: an executed formula can still reflect the wrong extraction or interpretation. State that limitation visibly to reviewers and validate stem inputs, units, assumptions, rounding, option uniqueness and consistency. No arbitrary generated-code execution.
- Add reusable labelled adversarial evaluations covering qualitative ambiguity, two defensible keys, missing assumptions, wrong formula/input/unit, rounding collisions, unsupported scope, stale edition, prompt injection, near-duplicate families and an unsupported combination of concepts. Expected gate/failure must be explicit.
- Bump appropriate versions on changed prompts/contracts. Confirm resumed batches actually use their recorded package/model policy, or refuse a version mismatch before spend and offer a new linked batch. Do not silently run the latest prompt under an older recorded version.
- Preserve exact-version difficulty confirmation, provisional versus confirmed family identity, held-out separation and immutable reserved forms. Number substitution or rewording does not create independent families.
- Use the actual private source packs to validate structure and provenance without exposing their facts publicly. Do not label prompt engineering as model training. No fine-tuning run or speculative ML infrastructure.

## 3. Make human sign-off and reviewer decisions attributable

Use the existing reviewer workspace and concept-verification route. Do not create a competing approval system.

The owner found `/api/curriculum/concepts/[id]/verify` defaults `verified` to true when the body is omitted/malformed, and writes only the concept status. Correct this trust boundary:

- Require a valid explicit decision and expected concept revision/content hash, with a clear human confirmation of the exact scope being signed off. Malformed/missing input must not approve anything.
- Record the authenticated authorised reviewer, time, exact concept/scope/manifest revision, decision and rationale or existing required review fields. Use a minimal additive audited command/table if no suitable audit mechanism exists. Atomic status plus audit, stale refusal and replay-safe retries; do not invent historical signer data.
- Trace and update every UI/script caller. Preserve intended reviewer-access policy. Ordinary, unauthenticated and foreign-scope calls cannot sign off. Revocation/revision must follow explicit current eligibility rules without rewriting frozen papers or silently erasing valid historical evidence.

Finish only the missing reviewer usability: source/pack revision and reference, key and reasoning, verifier evidence **and limits**, scope/sign-off, family/duplicate concerns, difficulty confirmation, publication blockers and decision history in the existing item workspace. Preserve queue filters and next-item return paths. Rights claims must remain consistent from pack → packet → batch → publication; any later edit/supersession must not inherit inappropriate approval.

Prove approve/return/reject/retire and material version edits, stale and simultaneous decisions, replay, forced rollback and ACLs on the final tree. Existing tests may supply proof if rerun and applicable; do not add duplicate suites solely to increase counts. Use synthetic reviewer decisions only on registered fixture content. No automated approvals of the real packs/concepts/items.

## 4. Prove inventory and a usable connected diagnostic slice

The 20,000-row page-reader test is useful but is not a complete capacity integration test. Add cases against canonical capacity/preflight readers for:

- skewed depth: many items/families in one outcome cannot hide zero depth in another;
- current-version approval, concept sign-off, rights and confirmed difficulty blockers;
- held-out isolation and variants sharing one family;
- fresh student versus prior item/family exposure, including unanswered reserved items;
- eligibility changes after preview and unavailable/failed later pages;
- more than 1,000 rows through actual aggregation, not only an isolated paginator.

Report raw/candidate/auto-checked/current-approved/family/fresh counts separately. Tests, Calendar, Home, Curriculum, Coach, reviewer pages and CLI must consume the same capability rules, with user-specific differences labelled.

Use registered synthetic routine and held-out fixture banks for software proof. Verify every delivered item is from the intended fixture record and approved exact version. Actual-bank tests must remain honestly unavailable when inventory is zero. Do not borrow held-out items, reuse one family as independent evidence or silently fall back from fixture to actual-bank mode.

## 5. Finish the frontend-driven end-to-end loop

Run desktop and 390px browser journeys as ordinary students plus the authorised fixture reviewer. Use Browser if available; otherwise record its absence and use installed Playwright. Seed stable setup/source fixtures where necessary, but drive the student and reviewer controls through UI and record exactly what was seeded.

Mandatory connected journey:

1. Reviewer item/source/level check → explicit exact-version approval → capacity refresh.
2. Confirm completed Calendar/Curriculum learning → exact-scope Tests preview → atomic Start.
3. Answer, required confidence, blank/return navigation and clock → refresh/resume → submission/result.
4. Result → exact Curriculum concept history and contextual Coach finding, agreeing on scores, sample size and scope.
5. Result → repair preview → explicit accept → feasible thread-linked Calendar work.
6. Finish repair work → eligible spaced fresh re-check → intended scope only → result and existing repair-closure policy. Do not alter spacing or closure thresholds to fit fixtures. If time must be advanced in a fixture, date owned events explicitly and disclose it.

Preserve `paper-score.1`, confidence/timing separation, practice-without-evidence, pending partial class scope and max 90 questions. Historical forms remain frozen. External mock reports and study logs never become scored evidence on their own.

Negative UI paths: zero/exhausted bank; stale scope in another tab; failed/lost answer-save response with selection/confidence retained and one durable response after Retry; reviewer material edit blocking the new version; held-out shortage; failed capacity read. Assert no partial writes, misleading ready state, duplicated attempt or silently lost input. Verify exact links and return context, focus/keyboard and client-width overflow. Allow expected HTTP faults only for the active injected step.

Reuse existing suites for reservation, scoring, difficulty, challenge, repair and historical integrity; run fixture-sensitive suites sequentially. A failed check must be investigated, not deleted, made vacuous or called unavailable on the fixture track.

## 6. Final gates and handoff

Run on the final tree: `npm run verify`, canonical `tsc --noEmit`, affected grounding/worker/batch/reviewer/score/reservation/repair/difficulty suites, capability cases and both browser viewports. Run migration dry-run plus **upgrade and restore** rehearsals, including 20270106 and any new additive migration. Check effective functions retain all later trust/practice patches and privileges. Do not modify applied migrations.

Repair stale documentation/callers and duplicate counters touched by this work. No unrelated page redesign, broad cleanup, new service framework or unnecessary dependency. Preserve existing dirty work and deliberate redirects/410s.

Use owned students, exact fixture records and the isolated Next wrapper. Stop only recorded owned processes; restore generated types and remove owned temporary banks/users/locks. No commits, pushes, deployment, account/provider provisioning, real messages or source-rights changes on the owner's behalf.

Deliver:

- one master-status completion section with requirement → implementation → named proof;
- machine-readable evidence with source fingerprint, commands/results, migration checksums, actual versus fixture/provider-simulated tracks, seeded versus browser-driven steps and cleanup;
- current real capability counts, private-pack IDs/versions/hashes and exact external approval blockers;
- a concise owner report: software-complete only when all mandatory software gates pass, content-ready only after genuinely authorised human review supports the named fresh diagnostic/re-check slice.

Do not ask the owner to pick between unfinished mandatory software requirements. Complete them. If something remains blocked, identify the exact dependency and finish all independent work; do not call Phase 4 fully complete. No usable real candidates and zero approved questions must remain prominent until that actually changes.
