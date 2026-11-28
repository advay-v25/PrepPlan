# Final closeout through Phase 5 — 25 November 2026

This closeout follows the owner's replacement brief and stops before Phase 6. It preserves the existing dirty work, prior evidence and the verified `d190b3e23be67938` source snapshot. **Required authenticated acceptance remains open.** The work below closes reproduced engineering defects and executable local checks; it does not convert local or simulated proof into authenticated app proof.

Evidence: [33 command/check outcomes, gates, blocker list and migration hashes](evidence/phase1-5-final-closeout-2026-11-25.json), [final source snapshot](evidence/phase1-5-closeout-source-2026-11-25.json), [read-only deployed migration observations](evidence/phase1-5-closeout-live-ledger-2026-11-25.json). The earlier [November 25 evidence](evidence/phase1-5-verification-2026-11-25.json) remains unchanged and belongs to its earlier snapshot.

## Closeout decision

| Gate | Verdict | Open-item classification and exact dependency |
|---|---|---|
| Phase 5 workspace acceptance | **PARTIAL** | **Unexecuted verification:** authenticated desktop/390px workspace, closeout, no-provider, owner-final and scored-student journeys. Component browser checks and local card commands pass, but do not replace these journeys. |
| Upstream Phases 0–4 engineering | **Local checks PASS; end-to-end PARTIAL** | **Unexecuted verification:** actual authenticated FSA/Ethics/subject selection and scoring; weekly scope/Calendar repair and re-check; adaptive lost Skip/reload/stop/stale tabs; linked rehearsal result/debrief; mature/final/retake and cross-page/performance cases. Prior browser results remain historical. |
| Editorial and content coverage | **PARTIAL / BLOCKED** | **External dependencies:** 81/89 FSA/Ethics outcomes lack source packs; each first blocker is `ABSENT_PACK` in the machine-readable evidence. Human editorial, concept, tier and learner-distribution approval remain separate. The nine revised pilot and six revised slice model key matches are carried-forward exact-version records, not new human review. |
| Actual rehearsal capacity | **BLOCKED** | **External dependency:** fresh live observation found zero approved held-out questions/families and a bank-wide full-rehearsal capacity upper bound of zero. Student-specific fresh capacity remains unknown. |
| Learner release eligibility | **BLOCKED** | The authenticated acceptance and content eligibility gates above remain open. |
| Move on to Phase 6 | **NO** | The required Phase 5 and upstream authenticated acceptance has not executed successfully. |

## Baseline and migration reconciliation

HEAD remains `2fdce1db829078c778cb25eeaefb4e8eb1da3c3b`. Starting source fingerprint was `2a7187e50b1567ec`: seven source/test files changed and migration `20270206_move_room_boundary.sql` was added since the earlier verified snapshot. These changes affect Coach moves, redistribution, gap packing, onboarding impact, their tests and measurement. They were inspected and preserved. The separately added result-claims test/package change was also preserved and is included in final verification.

Final source fingerprint: **`63b4783711cd2827`**, 982 files. Final bank fingerprint: **`a3f5b902bc3145d7`**, 82 code/fixture files and 14 pack metadata entries. The bank fingerprint changed from `45a333707f098009` because the adaptive upgrade test now accepts the exact current migration suffix; candidate fixtures, keys and pack rights were not edited. The final source snapshot lists every difference from the prior verified tree.

The deployed project and disposable staging project are different targets:

- **Deployed `woboyakjtgltgekwtddo`, read only:** the ledger confirms `20270202–05` with matching checkout checksums and UTC applied timestamps. An initial dry-run reported `20270206–07` pending. A subsequent read-only observation found them applied at `2026-11-24T20:58:20.251Z` and `20:58:20.705Z` (25 November in India), with matching checksums. The final read-only dry-run reports zero pending. **This session issued no hosted apply command.** Their appearance in the ledger is recorded without claiming that this closeout applied them.
- **Disposable `asylsxszdhlnzewhwtga`:** public Auth key, server key and `HEALTHCHECK_SECRET` remain absent. Its direct database hostname does not resolve. The staging migration dry-run fails; staging ledger and schema state remain unverified. Neither the deployed ledger nor a local install establishes staging state.
- **Local disposable Postgres:** all 156 migrations install through the checksum runner with zero pending; restricted redistribution and authenticated onboarding ACLs are preserved. Upgrade from the pre-private-snapshot schema through `20270207` passes, as does the 32-check backup/restore rehearsal. Existing migration files were preserved; this closeout added `20270207_generated_sitting_fit.sql`.

## Reproduced defects and fixes

| Requirement / reproduced defect | Implementation | Current proof |
|---|---|---|
| Redistribution may turn a 30-minute sitting into 60 minutes using a separate spare 30-minute gap | Shared `growthRoom` measures the whole replacement, existing unfit work blocks new allocation, and the service validates all proposed extensions together. Failed source/inventory reads propagate. `20270207` validates actual resulting sittings under the existing planning lock before a receipt commits. | Negative control: real SQL failed the expected-refusal assertion. Final boundary suite verifies refusal, rollback, no receipt, a fitting positive case and replay. Pure redistribution 20/20. |
| Day-only class recovery treats fragmented total minutes as room for a whole sitting | Recovery preview checks whole flexible sittings against non-overlapping windows and real blockers. Timed proposals preserve room for accepted flexible work. The new migration rechecks recovered target days before the acceptance receipt. | Production pure planner negative control 21 passed/1 failed; final 23/23. SQL also verifies same-day refusal leaves task revision, events and draft untouched. An early SQL fixture omitted a required `detail`; it was corrected before the final assertions and is not counted as product proof. |
| Initial onboarding acceptance lacked the shared whole-sitting boundary | `20270207` checks current contiguous room before activating roadmap/cycle/tasks, retaining purpose, version, lock and receipt guards. Papers/admin keep their separate placement semantics. | Real command rejects one 45-minute sitting in two 30-minute gaps without writes, accepts two whole 30-minute sittings, and replays without duplication. |
| Setup impact includes deferred/cancelled/logged history as future load and treats missing reads as empty/setup | Existing impact reader now filters active planned work. Failed profile reads or missing counts return saved/impact-unavailable while invoking the authoritative save exactly once. | Production reader over simulated PostgREST reproduced a false 120-minute overflow. Final test verifies no false overflow, missing-count/profile failure handling and one version per save. |
| Readings held for broader revision are labelled “in this week’s plan” | Preserve queue state in the projection; held entries have an explicit held status. Review carries bridge counts and distinguishes test-supported concerns, self-report and unflagged readings held for later. It no longer calls an empty justified bridge a capacity shortage. | Production selector/projection and server-rendered component checks: correct held label, reason, counts, exact reading link and no false in-plan/no-room wording. |
| Browser fixture imports can fill missing staging credentials from `.env.local` | The selected lifecycle env file is propagated to SQL helpers; no fallback file is loaded. Config fails early on missing Auth/server keys. Global setup binds app readiness origin to the authorized disposable target and requires checksum-current SQL before fixtures. | Initial matrix: 48 declared, 16 setup failures and 32 skipped; **zero authenticated app assertions**. Guarded retry stops at config before test discovery. Target tests verify aliases, missing keys, wrong project and readiness failure. No successful fixture account creation occurred. |
| Adaptive upgrade test assumes `20270205` is the only pending migration | Assert the exact ordered current migration suffix, including `20270205`, then zero pending. | Fresh and upgraded adaptive RPC/concurrency/RLS suites pass with `20270206–07` present. |

These changes retain explicit Calendar manual-placement overrides, task/reading identity, declared sitting order, accepted history, human content approval, formal scoring and repair policy. No duplicate editor, workspace, scheduler or planner was added.

## Phase 5 proof, precisely scoped

The existing component is exercised in real Chromium at **1280px and 390px** through controlled HTTP responses. All eight checks pass:

- finishing the last card keeps hook order valid and shows one reviewed card;
- Again parks the card until the returned future due time;
- a lost response retries the exact request key, rating and revision;
- another tab's later schedule parks the stale card, counts no review and does not immediately requeue it;
- no unexpected page/console errors or horizontal overflow in those component scenarios.

This is **component proof**, not an authenticated student, real scheduling command, or a whole-page visual acceptance claim. The actual card commands separately pass 25 local SQL checks; scheduling passes 17 checks including 3,696 algorithm combinations. Notes/cards rules, draft validation, return-link rules, revision selection and boundary checks run in the full verification suite. Provider checks are controlled simulations; no real model was called.

The guarded app suites remain unexecuted: `phase5-workspace`, `phase5-closeout`, `phase5-nokey`, `phase5-owner-final`, the scored `phase4-student` journey and `question-bank-adaptive`, at desktop and 390px. The rehearsal HTTP runner likewise stops at its target guard before creating a fixture. Thus initial note-read failure/retry, IME/owner-switch/offline recovery, real 1,200-card aggregate reads, suspended due filtering through the API, controlled draft save/return, canonical mature-entry and actual scored/Calendar links still require authenticated acceptance. Earlier master-status §§9.51–9.53 are retained as historical evidence, not relabelled current results.

## Final-tree gates

| Check | Result |
|---|---|
| `npm run verify` | Exit 0, all **62** constituent npm commands, including the preserved result-claims check and new impact/revision-presentation regressions |
| Canonical TypeScript, route audit, `git diff --check` | Pass |
| Isolated optimized production build | Exit 0; canonical types restored |
| Planning-boundary SQL | **25/25**, including Coach strict moves and atomic fit/refusal/replay |
| Class-recovery / redistribution / revision presentation / impact | **23/23**, **20/20**, presentation pass, simulated impact pass |
| Phase 1 eligibility/frozen paper; Phase 2 student SQL journey | Pass; selected IDs are fixture-supplied SQL inputs, not app selection proof |
| Planned logging / repair / weekly continuity | **12**, **44**, **22** checks pass. Exact 25+20-minute browser/Coach journeys retain their earlier evidence and were not re-driven here. |
| Eight existing local SQL contract suites | All pass: paper 37, score 8, challenge 28, rehearsal 14, scope race 23, difficulty race 28, progress 10, Coach 14 |
| Adaptive fresh/upgrade/concurrency and policy/service checks | Pass; no formal evidence writes |
| Rehearsal SQL and blueprint | Pass with **180 distinct held-out fixture families**, two clocks, locked Session 2, stable deadlines, omissions and exactly-once finalization |
| Local card commands / schedule / component browser | **25**, **17** (3,696 states), **8** checks pass respectively |
| Fresh install / upgrade / restore | **156 ledger entries**, zero local pending; upgrade passes; **32** restore checks pass |
| Live read-only inventory | Raw 0, auto-checked 0, quarantined 0, approved routine 0, approved held-out 0. New candidate coverage **8/89**; all 81 uncovered outcomes have their first blocker recorded. |
| Authenticated app matrix / rehearsal HTTP | **Blocked before authenticated assertions** by disposable setup; not passes |

## Remaining owner actions and cleanup

1. Configure the disposable project's public Auth key, server key (supported aliases) and `HEALTHCHECK_SECRET` locally. Restore its SQL hostname/connectivity. Do not copy deployed credentials into staging.
2. Rehearse/check its migrations and bring that disposable schema current through its authorized migration workflow. Start an isolated app against the same target; protected readiness, fixture Auth/REST URL and SQL identity/schema must agree before fixtures. Then execute the existing desktop/390px and target-checked HTTP journeys above.
3. Supply or authorize packs for the 81 uncovered outcomes and obtain the separate human editorial, concept/tier and learner-distribution approvals. No publication or rights sign-off was performed here. Student-specific fresh counts remain unknown.
4. Comparable authenticated latency/read-count measurements, final-prep/mature/retake cross-page cases and real Google consent, received email and Turnstile completion remain unexecuted. The first group needs the disposable stack; the provider checks need explicit external user/provider proof. No real email was sent.

All owned local fixture clusters, users, Chromium contexts, loopback component server, temporary bundle and isolated build output were removed. Canonical generated types were restored. Pre-existing database clusters and unowned app servers were preserved; no unowned process was stopped. No commits, pushes, deployment, publication, credential changes or real provider/email actions were performed.

**The current evidence does not support moving on to Phase 6.**
