# Phase 5 acceptance closeout — real coverage, complete reads and trustworthy recall

Complete these remaining Phase 5 requirements before starting Phase 6. Preserve the delivered Curriculum hierarchy, safe note editor, card commands, strict browser harness and all unrelated uncommitted work. This is a bounded correction, not another UI rewrite.

Read `AGENTS.md`, required Ponytail instructions, the original Phase 5 prompt, `docs/CURRICULUM-WORKSPACE-ROUTES.md`, the Phase 5 evidence record and the latest master-status entries. There are two §9.50 headings; distinguish the owner's Phase 4 closeout from the Phase 5 handoff and repair the active index without deleting either record. Read installed Next.js docs before framework changes.

The real bank remains empty. All paper-dependent tests require registered fixture banks; manual study tracking/notes/cards must work without them. No real model calls, source-rights changes, real-content approvals, commits, deployment or account provisioning in this pass.

## 1. Make reported coverage work for the actual 2027 readings

The handoff says its reported-coverage fixtures were written directly because `/api/curriculum/coverage` accepts legacy `learning_modules` IDs, while the workspace uses canonical `curriculum_readings`. The route validates exclusively against `learning_modules`. This is a real input/connection gap, not merely a fixture convenience.

Trace coverage UI/API/storage → tracker → workspace → roadmap/revision inputs → completed test scope → weekly stale token. Inspect `legacy_module_ids` and existing entry-context/activity rules before choosing the smallest compatible fix.

- Provide a validated self-report path for canonical active readings across all ten topics. Reuse the existing storage/commands where semantically correct; do not invent legacy module rows, fake concept mappings or an exhaustive course seed to make validation pass.
- Preserve legacy callers through explicit exact mapping/compatibility. Distinguish reading-level and legacy module-level identity; do not guess by title, silently fan one partial legacy module into a whole reading or allow unknown IDs.
- A reported covered reading is **reported**, not diagnostic-verified, timed study or demonstrated understanding. Partly covered remains partial. Respect the current test-scope policy: self-report must not silently claim completed work for a weekly paper if that policy requires a log/confirmation.
- Keep the existing diagnostic-evidence protection and atomic all-or-nothing mixed updates. A failed read is unavailable, a stale/conflicting write preserves input, and cross-account/forged verified state is refused.
- Ensure planner, tracker, Curriculum filters and Home agree on the same recorded state. Existing accepted work remains intact; changed context invalidates relevant pending drafts and affects later explicit planning through existing rules.

Prove endpoint/UI updates for canonical readings from multiple topics, including at least one with no legacy mapping. Replace direct coverage seeding in the relevant fresh/midway acceptance journey with real API/UI input. Include unknown/archived/wrong-subject IDs, mixed-validity batches, protected diagnostic state, repeated writes and the three-subject midway entry. Do not fix only the validator while leaving downstream consumers unable to read the stored identity.

## 2. Finish full-text note search and complete card counts

Owner review of `workspaceIndex.ts` found:

- `noteText(...)` is truncated to 160 characters before `filterRows` searches it. A word after character 160 is not searchable, despite the “search your own text” claim.
- Workspace card aggregation uses `.limit(10_000)` rather than ordered pagination. A large requested limit does not bypass the API's configured row cap. The 1,200-card deck/API test does not establish that workspace totals and reading badges are complete.
- Revision loading catches failures as `null`, which can turn failed revision data into no queued work.

Fix at the shared read layer. Keep a bounded preview distinct from full searchable text or an appropriate server-side search projection. Do not ship all private note documents to the browser solely for search, and do not build a search platform for at most 112 active note scopes. Preserve full-text matches and return-to-filter context.

Paginate/aggregate the workspace's actual card counts deterministically, including due counts and each reading's badges. Failed later pages must make the section unavailable, never produce truncated totals or zeros. Use the existing read helpers. Revision failure should have an honest section-level state rather than quietly emptying the revision filter.

Proof: a term well beyond the first 160 characters is found in reading and subject notes; duplicate snippets do not open the wrong note; a 1,200-card registered fixture distributed within actual quotas gives matching workspace, reading, Cards and Home totals. Exercise a later-page failure through the real aggregation, not only an isolated paginator. Notes beyond 1,000 are not required; the one-note-per-scope explanation is valid.

## 3. Stop calling lexical overlap proof that a card follows the note

The current `validateDrafts` checks the fraction of matching alphabetic words in the answer. It ignores numbers and does not establish that either the question or answer is supported. Owner ran this exact pure repro:

    Note: Under simple interest, a principal of 100 at a rate of 5 percent for one year earns interest of 5. The final amount is 105.
    Draft front: What is the final amount?
    Draft back: The final amount is 150.

Current result: the card is accepted with `dropped: 0`.

Fix the authoring contract and validation conservatively using the existing one-request pipeline. Prefer verifiable supporting spans/source anchors and short extractive answers when a paraphrase cannot be mechanically supported. Verify anchors against the selected excerpt server-side. Reject unsupported numeric values, changed units and obvious changed negation/conditions; check the front as well as the back. A second LLM agreeing is not deterministic semantic proof.

Do not claim a general semantic guarantee from heuristics. Keep the student's original excerpt/support visible beside a draft, state it still needs personal review, and require an explicit keep/save choice. Supported numeric-only or symbolic answers should not be discarded solely because they contain no four-letter English words. Do not silently use outside knowledge to “correct” the student's own note.

Retain preview-only behaviour, length/count limits, throttling before spend, cancellation, source privacy and no evidence writes. Note text and the optional label are untrusted data, including delimiter/role-injection attempts. Do not expose a whole note history or silently call the real provider.

Add the exact 105→150 regression, altered percentages/units, negation reversal, a front introducing an unrelated concept, missing/forged support anchors, numeric-only legitimate answers, empty/unclear excerpts and injected text. Re-run controlled valid/malformed/error/timeout paths and the save/retry path. Describe the checks' limits accurately in code, UI and evidence.

## 4. Own the flashcard schedule at the write boundary

`flashcard_apply` is callable by authenticated students. It currently writes `intervalDays`, `ease`, `reps`, `lapses` and `dueAt` from `p_f`; the route computes them, but a direct RPC can supply them independently. Range checks do not establish that the due date/counters follow the rating. Several missing values can also bypass SQL comparisons as null and fail later as an infrastructure error.

Make the authoritative command derive the next schedule from the locked card plus an allowlisted rating and a trusted clock, or restrict the schedule-setting command to a genuinely server-only path with ownership/access enforced at that boundary. Prefer the smallest solution that preserves the current one-command, monotonic revision, quota and receipt model.

Retain the existing Again/Hard/Good/Easy algorithm and ten-minute Again rule. Bind retries to the student's intent, not freshly derived times. Exact retry replays once; a different rating/request under the same key conflicts; stale edits/ratings retain local input. Do not let a changed derived schedule alter a committed receipt.

Prove direct callers cannot forge due dates/counters/ease or bypass validation, all four legitimate ratings match the existing pure scheduler, missing/null/malformed inputs fail cleanly, and same-key lost response, competing ratings, quota and ownership tests still pass. Additive migrations only; preserve applied 20270112–14 and current ACLs. No rating may create evidence, coverage, repair closure or paper credit.

## 5. Validate return links after normalisation

Owner reproduced:

    safeInAppReturn('/app/../account')          → '/account'
    safeInAppReturn('/app/%2e%2e/account')      → '/account'

The helper validates the prefix before `new URL` normalises it, then returns an outside-app path. This is same-origin, not an external-host redirect, but it violates the declared return-route boundary.

Validate the final normalised origin/path as well as the raw input. Preserve legitimate app query/section return context. Reject dot-segment escapes, protocols, encoded/backslash/control-character tricks and disallowed API destinations. Do not break exact owned result → reading/note/card → Back links. Add pure adversarial tests and one UI return-path check.

## 6. Finish the omitted practical journeys and recall connection

Drive these through the UI at desktop and 390px, with real routes underneath:

1. **No API key:** launch an owned isolated server with generation disabled. Open note-to-card drafting, retain the selected excerpt on the honest unavailable response, then create/review a manual card. Verify no throttle/provider call and no evidence/task mutation. This branch is currently code-only proof.
2. **Failed initial note read:** inject failure in the server-side page read before editor initialisation. Show unavailable/Retry; never mount an empty editable note or overwrite saved text. Recover to the original document. Preserve the existing conflict, lost-save, IME and owner-switch tests.
3. **February mature entry:** upcoming February exam, first pass complete and revision reported complete, poor external mock with selected reported subject concerns. Set context through canonical APIs rather than inventing coverage/evidence rows. Curriculum shows recorded/revision/real repair context, not a beginner restart or fake diagnosis. Open exact current work, result/report and note/card routes; tracking/card actions leave evidence and accepted work intact.
4. **Recall session linkage:** the delivered code adds a due-card line, but no selected-deck connection was found in Calendar. Do not claim an unchanged end-to-end path unless its actual caller exists. Connect an existing suitable revision/recall block to its selected reading/cards and provide the return path. If the student chooses to add a recall session, use the existing explicit preview/accept placement path with sitting/capacity limits; no task per card and no automatic rescheduling from ratings. If a small activity distinction is needed, make it server-owned and keep recall-only completion outside whole-outcome confirmation, diagnostic evidence and repair closure. Test its effects, not just its title.

Keep the workspace compact. Do not add chapters, lessons, PDF import, a standalone material library or a second planner. Missing diagnostic inventory must not block planning or personal notes/cards.

## 7. Final acceptance and handoff

Do not reset the owner's shared E2E account. Refactor the relevant legacy notes/cards script to own disposable students if it supplies unique coverage; otherwise explicitly replace its assertions with equivalent owned-user tests and migrate callers. Run fixture-sensitive tests sequentially.

Required final gates:

- named red→green regressions for coverage identity, full note search, real workspace counts, incorrect draft values, schedule ownership and normalised returns;
- full `npm run verify`, canonical TypeScript, affected coverage/note/card/draft/evidence/repair suites and route audit;
- migration dry-run and clean install/upgrade/restore for any additive changes;
- existing Phase 5 desktop/390px workspace and scored student journeys, plus the omitted cases above, with zero unexpected framework/console errors or overflow.

Use Browser if available; otherwise record its absence and use installed Playwright. Separate actual zero-bank behaviour, registered synthetic inventory and simulated providers. Distinguish seeded setup from UI actions. Failed reads and unavailable fixtures are not successful empty states. No broad new error allowances, vacuous assertions or evidence fabricated by direct self-report seeding.

Update the route/connection map and add one completion section with requirement → implementation → proof, plus machine-readable final-tree evidence, exact migration hashes, real capacity, UI steps and cleanup. Preserve previous evidence and repair the duplicate status-section index.

Use the isolated Next wrapper; stop only owned recorded processes, restore canonical types and delete only owned fixtures/users/locks/output. Leave the existing shared server alone. No commits, pushes, deployment, paid provider experiments or rights/item sign-off changes.

Finish this package before calling Phase 5 complete. Real model quality and a usable real diagnostic bank remain separate external/content work; they do not justify leaving the manual workspace or its existing app connections incomplete. Phase 6 gets its own prompt after this review.
