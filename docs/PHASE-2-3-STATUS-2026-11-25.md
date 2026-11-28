# Phase 2 / 3 status, 25 November 2026

Source: HEAD 2fdce1d plus uncommitted work. Browser target: deployed project `woboyakjtgltgekwtddo` (student-owned fixtures only), loopback build on :3142 in a private dist dir. DB contract proof: local Postgres, full-schema install.

## Built
| Requirement | Implementation | Proof |
|---|---|---|
| Fit against real gaps | `pulse/gaps.ts` (packSittings, packWhole, subtractBusy, reserveFlexible, busyFromTimed); `allocateDay` takes gaps; study splits into ordered sittings, repair/re-check/revision need one gap | `pulse-generate-test` 38/38 |
| Accepted timed work subtracted once | `buildWeekPlanWithPaper` reads timed plan_blocks, converts on the student's clock (DST, repeated hour, midnight) | same suite |
| Fit at the write boundary | migration `20270202_fit_at_write_boundary.sql`: `first_unfit_day` wraps `class_day_packs`; patched into `current_week_proposal_problem` (current-week acceptance) and `accept_weekly_transition` (review acceptance), under the existing scope lock | `current-week-consistency-db-test` 21/21 incl. 3 new cases (45 vs two 30s, timed + flexible counted once, weekly rows) |
| Weakness-only bridge | `selectRevision({bridge})`; service sets it when first pass is finished; only tested-weak or self-reported (labelled) readings chosen, rest held with a reason; nothing invented | `revision-queue-test` 64/64 incl. section 9 |
| Failed read is not zero inventory | `assessmentDecision`: failed active-cycle read returns `unavailable` + retry instead of `no_cycle` | tsc, verify; no dedicated test (DB-bound) |
| Coach: exact log, no writes | spec step in `phase1-log.spec.ts` | 6/6 desktop + 6/6 390px |

Regression: `npm run verify` exit 0; `planned:log:db:test` 12/12; `phase1-frozen-paper-db-test` PASS; `repair:db:test` 44; `continuity:db:test` 22; browser `phase1-log`, `class-followup` (3), `app-audit` (2+1) 24/24 at desktop and 390px.

## Not done / blocked
- Migration 20270202 is NOT applied anywhere but local Postgres. The checksum dry-run against the deployed project was denied by the permission classifier and not run.
- Fit rule not yet shared by: redistribution, class recovery, plan-impact, Coach move previews, accept_onboarding_preview. No lock-order race tests for booking/class-move/availability edit.
- No waiting-reason or bridge copy in Calendar/review UI; bridge is in the revision outcome only.
- Not built: midway reported-vs-measured display, February mature-entrant path, final-prep window choices, retake negative control, cross-page agreement checks.
- Phase 3: only the failed-read fix. The staging-targeted DB contracts (paper, score, challenge ledger, rehearsal, coach, progress, difficulty race) need `asylsxszdhlnzewhwtga` credentials or a local port. No scored browser proof; no isolated Auth/PostgREST stack.
- No timing/read-count remeasurement.

## Update: Phase 3 contracts ported to isolated Postgres (25 Nov)
`scripts/lib/stage.cjs` gives each contract test either the confirmed staging project (as before) or `--local`: a throwaway loopback Postgres with the full schema through the checksum runner. `npm run contracts:local` runs all eight. Result on this source (includes migration 20270202): paper contract 37, paper score 8, challenge ledger 28, rehearsal 14, scope race 23, difficulty race 28, progress 10, Coach confirm 14, all passing. Frozen-paper 5 PASS, repair 44, continuity 22 as before.

This closes the earlier BLOCKED item "scope change after a paper is reserved": reserve, change coverage, resume with an identical form, stale preview refused, new reservation sees the new scope, correction racing reservation and weekly accept (scope-race, frozen-paper). Command-level proof only: no scored browser journey, because no Auth + PostgREST stack exists here.

difficulty-race needed a larger fixture bank (per-outcome 9, was 5) to run locally; not a product change.

Observed, not changed: `/api/diagnostic/attempt/[id]/response` (legacy, used only by e2e scripts, not the UI) accepts an answer without confidence and has no stale-write guard; the live `/api/tests/attempt/[id]/answer` requires confidence and returns `stale_answer`, and live submit refuses missing confidence.

## Update: migrations applied, Phase 3 continued (25 Nov)
Applied to `woboyakjtgltgekwtddo` through the checksum runner (`--confirm-target`), after a local full-schema rehearsal: 20270202_fit_at_write_boundary, 20270203_adaptive_item_practice, 20270204_adaptive_item_pin_snapshot, 20270205_private_adaptive_item_snapshots. Ledger verified, 0 pending, `first_unfit_day` visible through the API after a schema cache reload, both acceptance functions patched. 20270203-05 belong to another agent's adaptive-practice work; they were applied on the owner's instruction and not otherwise reviewed or tested here.

Browser regressions against the migrated project (phase1-log, class-followup, app-audit; desktop and 390px): 24/24 (one 45 s `/app` load timeout on the first pass, passed on rerun; no STALE_PROPOSAL in the server log).

Coach with the provider simulated (valid-but-rejected, malformed, slow, unreachable; local stub, no live model): links, proposals and intent identical, no schedule/scope/task change, no proposal accepted (`coach:provider:agreement` 7/7). Not re-run after the apply: `coach:turns:runtime:test` (needs a running server).

Final on this source: `npm run verify` exit 0, `contracts:local` exit 0, tsc clean apart from the untracked `scripts/phase2-bank-audit.ts`.

## Update: Phase 2 consumers and app-layer Phase 3 (25 Nov, later)
Built (source only unless stated):
- Redistribution room is the largest contiguous gap left after accepted timed work and accepted flexible sittings are packed (`roomAfterAccepted`); `pulse-redistribute-test` 19/19.
- Plan-impact overflow now also fires when the total is enough but no single gap holds a sitting whole (`allFitWhole`, gap snapshots, timed work from plan_blocks).
- Migration `20270206_move_room_boundary.sql` (NOT applied to any hosted project): a confirmed Coach move of a day-only task to another day returns `NO_ROOM` unless one contiguous gap exists; Coach reports "no_room" with a Calendar link. Calendar's deliberate-override path (strict=false) is unchanged. Proven locally in `current-week-consistency-db-test`.
- `scripts/result-claims-test.ts` (in `verify`): no pass prediction, pass promise or readiness verdict in student-facing assessment/Home/Coach copy.
- Remeasured on the migrated project, same personas, 15 warm samples (warm p50 fresh/history, s): Home 4.32/5.16 (was 4.65/5.8), Calendar 3.68/4.35 (3.8/4.4), Tests 1.71/2.40 (1.8/2.5), Coach 0.94/0.94 (0.93/0.92), /app/log 0.35/0.32, log API 0.72/0.76. One fresh /app/tests sample took ~22.7 s (p95); not reproduced as a trend, machine is loaded by three old Playwright workers. DB read counts: still not instrumented. Evidence: docs/evidence/baseline-measure-after-phase2-2026-11-25.json. NOTE: the first run overwrote docs/evidence/baseline-measure-2026-11-24.json (same-day filename); the script now timestamps its output.

Checked on this source: verify exit 0, contracts:local exit 0, frozen-paper/planned-log/repair/continuity DB suites pass.
Not re-run in a browser after these edits: redistribution, plan-impact (settings save), Coach move refusal.
Pending on production now: 20270206_move_room_boundary (mine) and 20270207_generated_sitting_fit (not mine).

## Closeout pass 2 (25 Nov 2026, later)

**Built**
- `supabase/migrations/20270208_continuation_fit.sql` (NOT applied to production; rehearsed on a fresh local full install). Weekly acceptance checked only the generated next-week rows; placed continuations were inserted afterwards with no fit check. They are now checked together with the rows by the same whole-gap helper (`first_unfit_day`). Proof: `currentweek:consistency:test` 26/26; the new case fails without the migration (45-minute continuation beside two 30-minute gaps -> `STALE_PROPOSAL`, nothing written; two rows plus a continuation -> refused; a lone 30-minute continuation -> accepted). Apply with `node scripts/migrate.cjs --env=production --apply --confirm-target=woboyakjtgltgekwtddo` once authorised.
- Result follow-up (`src/lib/repairs/service.ts`, `plan.ts`) sized sittings and the re-check by a per-day total. It now passes contiguous gaps (net of timed work and accepted flexible sittings packed whole, completed/skipped/deferred/cancelled excluded) to `placeContinuing`, and the re-check uses the gaps left after placement. `gapsAfterAccepted` added to `gaps.ts`. `repair:plan:test` 14/14 including a 45-vs-two-30-minute case.
- Personal-data export reads 8 tables at a time and now includes `adaptive_item_runs`, `adaptive_item_receipts`, `adaptive_item_steps`, `planned_log_commands`.

**Read-only inventory, 25 Nov 2026 07:53 UTC (deployed)**: `assessment_items` 0, `assessment_forms` 0, `student_eligible_items` 0, `rehearsal_eligible_items` 0. The honest no-paper path is the only reachable path; no scored taking journey can run against this project.

**Not done in this pass**: Phase 4 (gates unmet), scored Phase 3 browser journeys, class-editing/Calendar-integrity/Home browser re-runs on the final source, DST/overnight/lock-order additions beyond existing cases, lifecycle UI differences, Coach runtime re-run, measurement run, source fingerprint refresh.

## Phase 4 start (25 Nov 2026, evening) — local stack only, nothing run against production

**Why local only:** Supabase warned production's Disk IO budget was depleting, and the memory graph shows a small compute (about 390 MB RAM, swap in use) with a sharp commitment/swap spike around 12:30 local, inside my first deployed browser run. Deployed runs now need named specs (`lifecycle-setup.ts` refuses a bare full run unless `E2E_DEPLOYED_FULL=1`).

**Measurement tooling (new):** `scripts/local-stack.cjs` (+ `local-stack-app.cjs`), `scripts/baseline-measure.ts` accepts the stack, `scripts/stack-read-breakdown.ts` groups one request's reads by table and (with `TRACE_CALLERS=1` and a dev server) by calling function. Read counts on the stack match what production showed (Home 90–94 fresh / 112–134 history), so counts are valid there; latencies are not comparable (local).

**Baseline (production-style build on the stack, 15 warm samples, REST reads + RPCs):** Home 90+3 fresh / 112+4 history; Calendar 93+4 / 115+5; Tests 35+2 / 57+3; Coach 30+1; log 2+1. Evidence: `docs/evidence/phase4-baseline-stack-2026-11-25.json`.

**Where Home's reads go (fresh, 93):** plan_blocks 11, profiles 8, planning_cycles 8, calendar_commitments 7, then evidence_events / user_module_state / assessment_attempts 4 each. Each loader (operating state, roadmap inputs, study-week context, weekly-review state, completed scope, entry context, layout) selects its own copy.

**Slice 1 done:** per-request `profileRow` and `activeCycleRow` snapshots (`src/lib/ops/sharedReads.ts`), used by the layout, study-week context, roadmap inputs, entry context, completed scope, weekly-review state, recovery overlaps and adaptation record. Home 97→89 calls, Calendar 97→94 on the dev server (same server before/after). `npm run verify` exit 0. Write paths keep fresh reads; the memo only applies inside a server render or an explicit read snapshot.

**Honest gap to the 25% target:** Home needs about 23 fewer calls. Remaining candidates: plan_blocks 11 (loaders each select their own columns), calendar_commitments 7, profiles 4, planning_cycles 4, and 4-call groups (evidence_events, user_module_state, assessment_attempts). A further ~16 is plausible by snapshotting plan_blocks and commitments the same way; the rest needs a single Home context loader. The prompt's UI work (route screenshots, simplified first views, 4.1–4.6) has not been started.

## Phase 4 · Home and Calendar read slice (25 Nov 2026, late) — local stack, production-style build

**Ceilings (owner):** fresh Home 69 total calls; history Calendar 90. Counts are total database calls per request (REST reads + RPCs) from the server's `TRACE_READS=1` output, 15 warm samples per route, same stack, personas and clock.

| Route (warm calls) | baseline | slice 1 | slice 2 | slice 3 | slice 4 | slice 5 |
|---|---:|---:|---:|---:|---:|---:|
| fresh Home | 93 | 85 | 80 | 70 | **68** | 68 |
| history Home | 120 | 108 | 103 | 93 | 91 | **82** |
| fresh Calendar | 97 | 90 | 86 | 76 | 74 | 74 |
| history Calendar | 120 | 113 | 109 | 99 | 97 | **88** |
| fresh / history Tests | 37 / 60 | 34 / 57 | 32 / 55 | 29 / 52 | 29 / 52 | 29 / **43** |
| Coach | 31 | 29 | 25 | 23 | 23 | 23 |

Both ceilings are met WHEN THE STATIC-DATA CACHE IS WARM. With the cache disabled (`REF_CACHE_TTL_MS=0`, the cold case) the same build makes: fresh Home 82, history Calendar 102, history Home 96, fresh Calendar 88 (evidence `phase4-slice5-cold-cache-stack-2026-11-25.json`). A request after the 5-minute window expires, on a quiet instance, is cold. Response payloads are unchanged (Home ~58.9 kB, Calendar ~104.8–105.7 kB); p50 within noise (Home 106–124 ms, Calendar 99–114 ms locally, not comparable to production latency).

**What changed (all read-only render paths; write paths and route handlers keep fresh reads):**
1. `profileRow` / `activeCycleRow` per-request snapshots (layout, study-week context, roadmap inputs, entry context, completed scope, weekly-review state, recovery overlaps, adaptation record).
2. `ownedBlocks`: one read of the student's plan blocks, used only by readers that already depend on the full history in the same request (study activity, observed pace, tracker, completed-scope lineage, signals, scope groups). Rows read go down, not up.
3. `refRows` / `referenceReads`: static curriculum reference reads (topics, modules, prerequisite edges, exam windows, readings, outcomes, topic weights) through the existing 5-minute production-only `refCache`; an error response is never cached. The paper manifest is deliberately NOT cached (used when a paper is started).
4. `weeklySeries`: one read of the few weekly commitment series (three loaders); one-off commitments stay range-bounded; `strict: false` tolerance preserved.
5. `loadEligibleItemPool` memoized within one server render (Calendar asked twice with the same readings); route handlers, including starting a paper, stay unmemoized.

**Proof on the same code:** `npm run verify` exit 0; `npm run contracts:local` exit 0; production-style build with the cache active: 42/42 non-bank browser tests (app-audit, phase1-log, class-followup, class-editing, phase7-manual-task, phase7b-in-progress) at desktop and 390 px; dev server with the synthetic bank: 31/32 (phase4-student, phase4-reviewer, mock-progress-owner, question-bank-adaptive, app-audit-paper, phase3-recovery, phase7c-retake). The one failure is an intermittent mobile-only abort of the reviewer page's own navigation in `phase4-reviewer` "stale second tab" (1 failure in 3 repeats; 7, 8, 8 passes otherwise), not touched by these loaders. Earlier dev-mode failures of `phase1-log` first test and `class-editing` mobile "keyboard and IME" do NOT occur on the production-style build: they were dev-server artifacts.

Client asset secret audit on the new build: 58 assets, 0 findings. Source fingerprint `eac4975a4530028b` (1,021 files, HEAD `2fdce1d`; the run started at `4e07206729102195`, 1,018 files).

**Not done:** the UI half of Phase 4 (slices 4.1–4.6: route simplification and before/after screenshots, onboarding/Log payload reduction), review-page and Coach-turn timing traces, and any production-side measurement (none run, by design).

## Phase 4 · review-page and Coach traces (25 Nov 2026) — one worker, warm production-style build, local stack

Tools: `scripts/stack-review-trace.ts` (new) and `scripts/coach-timing-measure.ts` (existing; its `.env.local` default is the production target, so it must only be run with the stack's `stack.env` sourced and live-provider variables blanked).

**`/app/review-week` (student whose week is a week old, review due), 15 warm samples:** GET renders in p50 124 ms / p95 445 ms with 79 reads + 2 RPCs; the preview POST (every unfinished task answered "not done") returns 200 in p50 134 ms / p95 141 ms with 93 reads + 4 RPCs. The 20.3-second GET seen earlier in a concurrent dev run does NOT reproduce on a quiet production-style build; it was the dev server compiling or host contention, not database round trips. `evidence/phase4-review-trace-stack.json`.

**Coach turns (provider unavailable on the stack, so the deterministic path; no live model):** before: simple next-action 230 ms with **286 reads** (operating state 133, evidence pack 53, revision queue 52, tracker 14, assessment decision 16); preview 81 ms / 21 reads; confirmation 77 ms / 7 reads. A route handler has no per-render cache, so the context build re-read everything per loader. `loadCoachWorld` is now wrapped in `withReadSnapshot`; the lean world used for a move preview and every confirmation keep fresh reads. After: simple 147 ms / **76 reads** (−73%), context stage 160 → 76 ms, interpreted 147 ms / 77 reads, preview 84 ms / 21, confirmation 76 ms / 7. `npm run coach:turns:runtime:test` (counted simulated provider) 39 passed, 0 failed. The earlier "Coach context deadline" hits are consistent with 286 sequential-ish round trips against a remote database; local latency cannot confirm that.

## Phase 4 · UI slice 4.2 (Home), first cut, with the motion principles (25 Nov 2026)

Mode: Create. Weighting: Emil primary (restraint, frequency gate, <300 ms), Jakub secondary (polish, nothing the eye has to notice); Jhey not used (no first-run or empty-state moment in this slice).

**Product change (Home):** when the next-action card already says "Today's work is done", the second "Still to do today / Nothing else is planned" card shrinks to what is still useful: "Completed today (N) · M min reported" and "Full day". It stays the full card whenever anything is open, deferred or unplaced. On a 390 px phone the week strip now starts above the fold; desktop is about 35 px shorter; roadmap and progress are unchanged. Files: `src/components/home/TodaySequence.tsx` (new `quiet` prop), `src/app/app/page.tsx`, a labelled block at the end of `src/styles.css`.

**Motion decisions:** Home is opened many times a day, so no entrance motion at all. Two things move: a button gives press feedback (`scale(.97)`, 80 ms, ease-out, main primary/secondary buttons), and a disclosure chevron turns (140 ms, standard ease). Only `transform` is animated, durations are the existing tokens, the press scale is removed under `prefers-reduced-motion`, and the chevron transition is switched off. Nothing loops; nothing starts from `scale(0)`.

**Screens:** 28 "before" and 8 "after" captures in `docs/evidence/phase4-screens/` (desktop and 390 px, fresh and history students; matched data).

**Gates on the final tree:** `tsc` 0; `npm run verify` 0; `npm run contracts:local` 0; 42/42 non-bank browser tests on the production-style build (app-audit, phase1-log, class-followup, class-editing, phase7-manual-task, phase7b-in-progress); 32/32 scored tests on the dev server with the synthetic bank; Coach runtime suite 39/39; client-asset secret audit 58 assets, 0 findings; fingerprint `2bada715862fb7a4` (1,023 files, HEAD `2fdce1d`).

**Not built (open Phase 4 list):** 4.1 auth/onboarding, 4.3 Calendar (a phone shows about 450 px of header chrome before the first day: title line, log button, date navigation, week details, hint, view toggle, filter chips, two add buttons; to be consolidated without removing any exact-link or visible-button contract the specs rely on), 4.4 Curriculum/Tests, 4.5 Coach/Settings/Account, 4.6 cleanup; the 30% initial-payload goal for onboarding and Log; production-side measurement (none run).
