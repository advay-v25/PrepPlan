# Question bank and Phase 0–5 completion steps · 25 November 2026

> **Scope superseded by the owner:** this chat now owns only the question bank and background content resources. See [the content-only scope and readiness](QUESTION-BANK-CONTENT-READINESS.md). Software instructions below are historical handoff material for the separate revamp agent; their target/configuration may have changed. Do not use them as this chat’s current work plan.

## What is ready

Open `output/question-bank/2027/review.html` in a browser. It works offline: search by outcome/ID/wording, filter subject or proposed difficulty, open the overlap queue, and toggle answers. It records no review decisions. The ten `*-blind.md` / `*-answers.md` pairs are suitable for separate blind solving and marking. `draft-bank.json` and `draft-bank.jsonl` contain the complete machine-readable drafts, rationales, source-page references and review status. `coverage.csv` and `coverage-and-review.json` show the actual gaps.

| Subject | Outcomes covered | Draft questions |
|---|---:|---:|
| Quantitative methods | 30 | 39 |
| Economics | 30 | 30 |
| Corporate issuers | 22 | 22 |
| Financial statement analysis | 53 | 162 |
| Equity | 37 | 37 |
| Fixed income | 51 | 51 |
| Derivatives | 22 | 22 |
| Alternatives | 22 | 22 |
| Portfolio management | 40 | 40 |
| Ethics | 36 | 111 |
| **Total** | **343 across 102 readings** | **536** |

There are 254 newly authored questions, 243 revised/reassembled FSA/Ethics drafts in a new namespace, and 39 carried-forward pilot/slice versions. The carried-forward questions preserve their wording, options, keys and item versions; their new intake metadata proposes pending concept mappings. Historical model-solve records are labelled historical. No new independent model solve or expert sign-off is claimed.

All questions have three options, one draft key, a solution and separate distractor explanations. The build executed 99 numeric formula checks and found zero format/input defects. Four carried-forward items retain eight-word source-overlap hints: `pp-2027-r032-a-easy`, `pp-2027-r095-a-easy`, `pp-2027-r095-b-easy`, `pp-2027-r095-e-easy`. Eight items have same-outcome wording-similarity hints. These are review queues, not plagiarism verdicts or proofs of independence.

**This is a draft bank, not a release-ready inventory.** Confirmed independent families, human approvals, approved routine supply and approved held-out supply are all zero. Across 253 outcomes, at least one proposed tier is absent: 196 lack foundation, 63 lack standard and 245 lack difficult candidates. These are overlapping counts (504 empty tier cells), not a request to manufacture 504 number-swapped questions. One candidate per tier would still not establish sufficient fresh family depth. Additional authoring should follow actual reviewer decisions and capacity reports; you do not need to handwrite these gaps yourself.

## Sources and project rules followed

The authoring contract comes from `docs/TESTS-T2-CONTENT-PIPELINE-AGENT-PROMPT.md`, `docs/TESTS-T3-DIFFICULTY-ENGINE-AGENT-PROMPT.md`, the existing generator/verifier/format rules and `docs/CONTENT-AUTHORING-WITHOUT-PUBLISHER-DEPENDENCY.md`.

The ten searchable official 2027 volumes were mapped to all 102 canonical readings, including the Quant and Economics volumes found alongside the eight named main volumes. Extraction excludes exercise/solution/example intervals and suspicious exercise pages. Source matches are automatically retrieved factual-page candidates: a human must still confirm that each citation supports the exact item. The Quant appendix is excluded from the 102-reading mapping.

The two prerequisite books were inspected as supplemental background; prerequisite readings were not invented as extra examinable outcomes. The four Schweser files have no text in the sampled pages and were not OCRed or used as a question source. Their material is not represented as having been read. The searchable official volumes supplied the reference coverage, so OCR of the scans is not a launch prerequisite.

Private extracts and 343 new reference packs live under ignored `content/source-packs/private/reference-2027/`. Do not commit that directory. The public review package contains original draft questions and page/hash references, not copied reference paragraphs. Document text was treated as source data, never as instructions. Exercises were not used as templates. Eight-word screening does not establish originality, correctness or input-use permission.

Reference packs remain `rights.state=unconfirmed`, with the user's local drafting request recorded as the request rather than as publisher/commercial permission. First-party pilot packs retain their prior actual status. The entire new database intake batch remains rights-unconfirmed. No source was relabelled, no role was granted, and no concept, difficulty, family or publication was automatically approved.

## Work completed and checks

- Repeatable private PDF intake; original authoring for the eight previously absent subjects; new FSA/Ethics namespace with formatting repairs; per-outcome coverage and review artifacts.
- Guarded, atomic intake into the existing reviewer schema. It creates pending concepts, approximate mappings, provisional families and unconfirmed batches containing **draft** items. Existing differing IDs are refused, never overwritten. No replacement content store or student workflow was added.
- Full-schema disposable local Postgres rehearsal imported 536 items, repeated with zero new inserts, refused changed content and rolled back a late failure after an earlier insert. Learner-eligible and held-out-eligible counts stayed zero; no human decisions were written.
- `npm run verify` passed all 62 constituent commands; TypeScript passed; an isolated optimized production build passed. No application feature or migration was changed in this authoring pass.
- Offline review QA passed in Chromium at 1280px and 390px: title/content, search, subject/overlap filters, hidden/revealed answers, signed currency, pagination, no console/page errors and no horizontal overflow. Browser plugin was unavailable; regular Playwright was used. Evidence: `output/question-bank/2027/browser-check.json` and `review-1280.png` / `review-390.png`.
- Intake normalization/exercise-boundary self-check, staging-environment isolation self-check, private proxy/identity and wrong-target refusal tests passed. Rebuilding produced the same ordered bank content hash: `721526d5ea2208470b81dba9e21fbc556dd1beaf282c05760e0a551840667726`.

To rebuild locally after an intentional authoring edit:

```sh
cd "/Users/advay/Documents/Structured Learning App"
npm run bank:reference:build
npm run bank:reference:rehearse
```

The first command requires the ignored reference intake from this computer. The second uses disposable local Postgres and deletes its cluster afterward. Neither command publishes or calls a model. The generated package should stay private until its applicable input/distribution basis is established.

## 1. Restore the disposable environment (owner action)

As checked on 25 November: target **`asylsxszdhlnzewhwtga`** has no configured public Auth key, server key or `HEALTHCHECK_SECRET`; `db.asylsxszdhlnzewhwtga.supabase.co` does not resolve. Hosted migration preflight remains blocked. Nothing in this pass was imported into a hosted database. The existing live project **`woboyakjtgltgekwtddo`** is a different target and was not written to.

1. Sign into Supabase Dashboard and select `asylsxszdhlnzewhwtga`. Resume the project if paused. If it no longer exists, report that fact; the tools intentionally refuse a different project until the authorized target configuration is deliberately updated.
2. Open the project's API keys/settings. Copy its **public publishable/anon key** and **server secret/service-role key** into `.env.staging.local` on your machine. Keep server keys out of `NEXT_PUBLIC_*` values and out of chat. Use the aliases supported below; do not copy keys from the live project.
3. Generate a private random monitor secret locally and place it in `HEALTHCHECK_SECRET`. Use a password manager or local generator; do not paste the value into this guide or chat.
4. Open Dashboard **Connect**. Use its exact connection details and the staging database password. If the direct endpoint is unavailable/IPv6-only, use the **Session pooler** details, including its exact hostname, port and `postgres.<project-ref>` username. Do not guess the pooler region or use live credentials. Preserve TLS verification for the migration runner; set its trusted CA file if your network requires one.
5. Confirm that `.env.staging.local` contains the following names with your actual values. Never paste this completed file into chat:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://asylsxszdhlnzewhwtga.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging public key>
SUPABASE_SECRET_KEY=<staging server key>
HEALTHCHECK_SECRET=<new private random secret>
MIGRATION_EXPECTED_PROJECT_REF=asylsxszdhlnzewhwtga
E2E_CONFIRMED_DISPOSABLE_PROJECT_REF=asylsxszdhlnzewhwtga
SUPABASE_DB_PASSWORD=<staging database password>
SUPABASE_DB_HOST=<exact host from Connect>
SUPABASE_DB_PORT=<exact port from Connect>
SUPABASE_DB_USER=<exact user from Connect>
E2E_BASE_URL=http://localhost:3141
NEXT_PUBLIC_SITE_URL=http://localhost:3141
```

The alternative public alias is `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the alternative server alias is `SUPABASE_SERVICE_ROLE_KEY`. Use one actual key per class. `scripts/disposable-run.cjs` blanks missing aliases and disables real model/email/reminder services so `.env.local` cannot fill those fields with live values.

6. For manual browser sign-in, add `http://localhost:3141` and `http://localhost:3141/auth/callback` to this **staging** project's Auth redirect allowlist. Keep its required verification/admission policy; use an admitted test account rather than weakening production access.
7. Tell me “staging is configured” when done. The following automated installation and acceptance commands can then be run by Codex. These do not require you to manually operate every student test.

## 2. Install or reconcile staging (automatable after step 1)

Run from the project directory:

```sh
node scripts/install-disposable.cjs
npm run migrate -- --env=staging --dry-run
```

If the preflight reports **zero public tables**, install the pinned baseline and every later checksum migration:

```sh
node scripts/install-disposable.cjs --apply --confirm-target=asylsxszdhlnzewhwtga
```

If the project already has a checksum-tracked schema, apply only its pending migrations:

```sh
npm run migrate -- --env=staging --apply --confirm-target=asylsxszdhlnzewhwtga
```

Then repeat the read-only dry-run. Expect zero pending and no checksum mismatch (currently through `20270207`). If it reports an existing **untracked** schema or mismatch, stop and reconcile its actual history; do not reset tables, invent ledger rows or mark migrations applied by hand. The empty-project installer refuses to replace an existing schema. Its hosted path is currently connectivity-blocked; the reused baseline/install path passed local rehearsals.

## 3. Run Phase 0–5 software acceptance (automatable)

Start an isolated staging app in terminal A:

```sh
node scripts/disposable-run.cjs node scripts/isolated-next.cjs .next-staging-accept dev -p 3141
```

This mode disables real model/email/reminder calls. Terminal B runs the targeted suites, one worker and both configured viewports. Each invocation still verifies the app's protected readiness target and SQL checksum ledger before creating fixtures:

```sh
node scripts/disposable-run.cjs npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/app-audit.spec.ts tests/e2e/lifecycle/settings.spec.ts tests/e2e/lifecycle/phase1-log.spec.ts
node scripts/disposable-run.cjs npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase2-truth.spec.ts tests/e2e/lifecycle/phase3-closeout.spec.ts tests/e2e/lifecycle/phase3-recovery.spec.ts tests/e2e/lifecycle/question-bank-adaptive.spec.ts
node scripts/disposable-run.cjs npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase4-reviewer.spec.ts tests/e2e/lifecycle/phase4-student.spec.ts
node scripts/disposable-run.cjs npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase5-owner-final.spec.ts tests/e2e/lifecycle/phase5-nokey.spec.ts
```

Phase 5 controlled drafting uses a separate app configuration. Stop only terminal A's owned app with Ctrl-C, then start:

```sh
node scripts/disposable-run.cjs --provider=controlled node scripts/isolated-next.cjs .next-staging-accept dev -p 3141
```

In terminal B:

```sh
node scripts/disposable-run.cjs --provider=controlled npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase5-workspace.spec.ts
```

The workspace suite owns its loopback provider on port 39177. This proves application behavior with controlled responses, not live model quality. Restart the disabled-provider app for the no-key suite if re-running it.

For the initial-read failure closeout, stop the owned app in terminal A. Initialize and start the **disposable-only** private proxy in terminal C:

```sh
node -e "require('node:fs').writeFileSync('/tmp/prepplan-phase5-faults.json', JSON.stringify({rules:[]}))"
node scripts/disposable-run.cjs node scripts/fault-upstream.cjs --port=4144 --faults=/tmp/prepplan-phase5-faults.json --log=/tmp/prepplan-phase5-upstream.log
```

Start the app through that loopback proxy in terminal A:

```sh
node scripts/disposable-run.cjs env NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4144 node scripts/isolated-next.cjs .next-staging-accept dev -p 3141
```

Then terminal B runs:

```sh
FAULTS_FILE=/tmp/prepplan-phase5-faults.json E2E_PRIVATE_PROXY_ORIGIN=http://127.0.0.1:4144 node scripts/disposable-run.cjs npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase5-closeout.spec.ts
```

The proxy now reads only the selected disposable file and refuses other upstreams. The readiness guard requires an explicitly declared loopback origin and checks the proxy's disposable target identity; normal tests still require the direct disposable origin. Real loopback tests prove identity, injected failure and wrong-target refusal without forwarding requests. The authenticated proxy/app journey remains blocked on credentials and is not claimed as passing. Afterward stop the owned proxy/app, clear the owned faults file and restart the direct staging app for ordinary tests.

The existing linked-rehearsal HTTP journey additionally needs a recorded synthetic held-out fixture bank. With the staging app in disabled-provider mode:

```sh
node scripts/disposable-run.cjs npm run fixture:bank -- create --confirm-target=asylsxszdhlnzewhwtga --out=/tmp/prepplan-heldout-staging.json --rehearsal=auto
node scripts/disposable-run.cjs npx tsx scripts/e2e-rehearsal-journey.ts --part=fixture --bank=/tmp/prepplan-heldout-staging.json
node scripts/disposable-run.cjs npm run fixture:bank -- destroy --confirm-target=asylsxszdhlnzewhwtga --file=/tmp/prepplan-heldout-staging.json
node scripts/disposable-run.cjs npx tsx scripts/e2e-rehearsal-journey.ts --part=live
```

Run the destroy command even if the fixture journey fails, after preserving failure evidence. Fixture-bank approvals are synthetic test data and do not approve this question package. Do not run fixture suites concurrently with content review. Check each runner's recorded cleanup, failed-request/console allowances, assertion counts and desktop/mobile evidence; a setup failure or zero assertions is not a pass.

Phase exit observations to preserve:

| Phase | Required final observation |
|---|---|
| 0 | Current build/types/routes, checksum-current target, protected/public routes, genuine sign-in and settings ownership, no failed cleanup. |
| 1 | Verified account → accepted week → Calendar sitting → partial and completed logging; split 25+20-minute work retains one sitting's identity and correct completion. Capacity/refusal/retry produces no duplicate receipt or false completion. |
| 2 | Reviewer scope and exact-version controls; student test → result → diagnosis/repair → due recheck; wrong/stale/foreign selections refused. Report actual approved family/tier availability. |
| 3 | Item-adaptive practice starts only with sufficient fresh independent families, freezes displayed content, handles Skip/retry/concurrency, stops honestly on shortage and creates no formal exam evidence. |
| 4 | Two linked 90-question / 135-minute sessions, 180 distinct held-out families, separate clocks, Session 2 ordering, omissions and exactly-once scoring. Routine and held-out inventory remain separate. |
| 5 | Authenticated Curriculum workspace at desktop/390px: search/deep links, notes autosave/reload/IME/owner-conflict/offline recovery, real 1,200-card counts/pagination, suspended filtering, Again delay, stale/lost-response retries, controlled draft validation/save/return, no-key state and scored result-to-notes/cards links. |

The prior engineering evidence is in `docs/PHASE-1-5-FINAL-CLOSEOUT-2026-11-25.md`. Its local SQL/component passes remain scoped proof; they do not replace these still-blocked authenticated journeys. Comparable authenticated latency/read-count measurements and mature/final-prep/retake cross-page journeys must also be rerun against the resulting target. Do not treat earlier live observations as fresh staging proof.

## 4. Perform actual content review (human decisions)

1. **Choose and record the input/distribution basis.** Read the project's existing content-authoring decision guide. Decide whether these supplied-source drafts can be used for the intended product, or whether authorized first-party/licensed replacement grounding is needed. Retain evidence tied to the exact sources and uses. No paid book purchase or local drafting request has been recorded as distribution permission. This is a product rights decision; no new legal conclusion is supplied here.
2. **Blind solve a small pilot.** Start with the Quant/FSA/Ethics pilot outcomes using the `*-blind.md` files. A qualified reviewer should independently choose answers and show calculations before opening the answer companion. Resolve ambiguity, missing assumptions, implausible distractors and factual/source-support defects. Expand subject by subject. The four overlap hints require explicit review; rewrite or reject where necessary rather than dismissing the flags globally.
3. **Import drafts into staging only.** After staging installation and separately from fixture suites:

```sh
npm run bank:reference:import:staging -- --confirm-target=asylsxszdhlnzewhwtga
```

This imports draft candidates without clearing rights or approving anything. An exact retry preserves existing rows. If an existing ID differs, intake stops; use a deliberate new item/version or the existing reviewer revision flow. Never delete a reviewed item to make import pass.

4. **Give the qualified reviewer access.** Create/sign into the reviewer account normally, complete admission/onboarding as required, and copy that account's UUID from staging Dashboard → Authentication → Users. An authorized administrator can grant the existing reviewer role in the staging SQL editor (replace the UUID below):

```sql
insert into public.user_roles(user_id, role)
values ('REPLACE_WITH_ACTUAL_REVIEWER_UUID'::uuid, 'diagnostic_reviewer')
on conflict do nothing;
```

An ordinary student's role must remain unchanged. This session has not executed this grant.

5. **Validate the exact scope.** Visit `/app/tests/manifest` as that reviewer. Review the proposed concept's reading, outcome, scope and exclusions against the cited pages. The new concepts are deliberately pending and the broad per-outcome stubs may need narrowing/splitting or mapping correction before sign-off. Record the actual scope and rationale, acknowledge reading it, then sign off the exact current scope. Do not bulk-sign the 343 placeholders.
6. **Record rights only when supported.** Inspect the imported batch at `/app/tests/review/batches`. There is no general clearance button in the current batch UI. After the owner has established an adequate basis for **every input in this batch**, an authorized maintainer must attach that evidence to this exact batch (`rights_ref`) and set its status through a narrowly targeted maintenance update. If permission covers only part, keep this batch blocked and create appropriately scoped replacement batches. Also version/update the corresponding private pack rights records truthfully. Codex can prepare the exact per-batch update for your concrete rights decision; no universal “clear everything” SQL is provided.
7. **Run the existing independent automatic checks.** Open `/app/tests/review`, choose an imported item, inspect its solution/options/source and use **Re-check automatically** when a separately authorized verifier provider is configured for staging. This step can incur provider use; none was invoked here. Start with the small pilot and a stated budget. The disabled/controlled acceptance runner is not a real verifier configuration. A human solve is valuable but does not manufacture a machine PASS record; failed/unavailable verification stays blocked.
8. **Confirm actual difficulty and family construction.** In the item workspace, record the cognitive basis for the exact-version foundation/standard/difficult label and use **Confirm level**. Group rewordings, new-number versions and scenario siblings in the same family. Use **Confirm this is its own construction** only after comparison; candidate UUIDs prove nothing. Reserve genuinely separate held-out families using the existing holdout control. A family reserved for mocks must not be used in routine practice.
9. **Approve exact versions.** Resolve every blocker, discrepancies and source-overlap issue before the human **Approve** action. Review one exact version; editing invalidates prior-version proof. Previewing, running lint, importing drafts or confirming a tier does not publish an item.
10. **Measure actual capacity.** Run the existing bank capacity/matrix and rehearsal audit under `scripts/disposable-run.cjs` against staging. Inspect per-outcome reviewed tiers, independent family counts, exclusions/exposure and held-out topic allocation. Fill genuine gaps with further original constructions, repeat review and rerun capacity. Do not relabel routine inventory held-out just to satisfy a mock or report 536 drafts as 536 usable questions.

Only reviewed, eligible content can support ordinary student availability. Student-specific fresh counts also depend on that student's exposure. All-outcome drafting coverage does not guarantee full diagnostic or rehearsal coverage.

## 5. External checks you must operate yourself

1. **Google consent:** configure the staging OAuth client/redirects, then use your own browser to complete consent and return to the app. Confirm the intended account and app origin. Provider consent is not proven by a mocked callback.
2. **Email delivery:** configure a verified sending domain and intended staging recipient only when ready to authorize an actual email. Trigger one verification/reset email yourself, confirm inbox delivery, follow its link, and test expired/reused links. No email was sent by this work.
3. **Turnstile:** configure keys for the relevant staging hostname and manually complete the challenge in a real browser. Confirm both success and failure handling. A test token is not real-provider completion.
4. **Owner acceptance:** after automated gates and content eligibility pass, use an ordinary account at desktop and phone width to complete onboarding → week/Calendar → log learning → available diagnostic → result/repair → Curriculum notes/cards. Check the text and behavior suit the intended product. Record the tested revision/target/date, not just “looks fine.”

## Completion and handback

Your essential inputs are **working disposable credentials/connectivity**, **a supported content-use decision**, **qualified exact-version reviews**, and **real external-provider consent/delivery/challenge checks**. Once credentials are ready, Codex can finish the automated journeys, run the private failure harness against authenticated staging, run measurements, resolve actual regressions, expand content where capacity genuinely requires it, and produce a new evidence ledger. Those are remaining engineering tasks, not manual chores assigned to you.

Phases 0–5 are complete end to end only when the authenticated matrix, cleanup, real content eligibility/capacity, external checks and owner acceptance all have current proof. The current outcome is **draft bank ready for review; learner release blocked**. Phase 6 is not included or claimed complete by this request.
