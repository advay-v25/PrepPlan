# Roadmap — development completion and production-readiness plan

**Reviewed:** 13 October 2026  
**Status:** Code-grounded implementation proposal. No application code, migrations or candidate records changed.  
**Headline:** The app builds and has substantial working domain code. It is not yet demonstrated production-ready. Finish its state integrity and complete user journeys; do not restart the whole product or defer backend correctness until after UI work.

**Execution companion:** `FEATURE-BY-FEATURE-BUILD-TRACK-2026-10-13.md` makes the page experiences and preparation stages concrete and records the initial Calendar navigation slice. The findings below are this audit's baseline; later slice completion does not mean the full associated backlog item is closed.

## 1. Verified baseline

### Checks run

| Check | Result | What it does not prove |
|---|---|---|
| `npm run verify` | Exit 0 | Includes TypeScript and offline domain tests, not real authenticated browser journeys or live database policy verification. |
| `npm run build` | Exit 0; Next.js 16.3.4 production compilation succeeds | Does not prove provider configuration, migration parity, scale or production runtime behaviour. |
| `npx tsx scripts/state-activation-test.ts` | 4 passed | Small selector/activation fixture set; not full persisted lifecycle coverage. |
| `npm run coach:policy:test` | 6 passed | Six phrase checks are not a comprehensive model-response evaluation. |
| Route audit, through `verify` | 81 routes; 177 internal links resolve | A resolvable route may still open the wrong state or perform the wrong operation. |

Reviewed current pages/APIs, onboarding/auth, operating state, calendar/planning, weekly review, assessment scope/assembly/attempts/results, Coach, migration runner, recent SQL, test harness, configuration, legal pages and product-direction documents. This is a source audit with automated local checks, **not a new complete browser QA pass or an exhaustive security assessment**. The October 2 visual audit is historical, not proof of today's rendered behaviour.

No remote migration, destructive E2E/reset suite, live generation, question-bank write, account deletion or production configuration change was run. `.env.local` values were not printed. Live database schema, applied migration history, current bank counts, SMTP/OAuth configuration and production deployment settings remain to be verified in an isolated environment.

### Existing work to keep

- Next.js App Router frontend and server API; Supabase Auth/Postgres; deterministic planning; NVIDIA-backed assistance.
- Six primary destinations: Home, Calendar, Curriculum, Tests, Coach, Settings.
- Five onboarding steps, conditional classes/availability, versioned drafts and acceptance RPC.
- Calendar edits, commitments, execution events, class capture and quick outcome-level learning capture.
- Completed-scope papers, confidence/timing capture, weighted blueprints, persisted attempts, result analysis and scoped SWOT.
- Evidence/repair models, challenge handling, weekly acceptance RPC and grounded Coach suggestions.
- Extensive pure-domain test scripts and guarded HTTP integration fixtures.

Several earlier findings are already fixed: Home reads the shared draft/active roadmap loader; next-action selection excludes skipped/deferred work and includes consolidation; closure readiness uses the weekly gate; Home has quick capture and a new layout. Retest these; do not implement the old fixes again.

## 2. Product contract: what “finished” means

Roadmap helps CFA Level I candidates decide **what to study next, when it fits, what their checks demonstrate and what to adjust**. It is not a course, PDF-chat product or full-subject tutor.

The complete loop must work:

```text
Account → verified identity → required setup → preview/accept first week
                                              ↓
                        Home ↔ Calendar ↔ Curriculum / learning logs
                                              ↓ completed, confirmed scope
                                  diagnostic / revisionary / mixed paper
                                              ↓
                                   valid evidence + scoped result
                                              ↓
                           repair proposal → accepted block → re-check
                                              ↓
                            reconcile logs → review → accept next week
                                              ↓
                     rolling revision → mocks → final week → exam archive
```

Preserve these rules:

- Self-study learning Monday–Saturday; Sunday paper/closure. Class-led and hybrid boundaries follow the agreed class rules, not a user-selected review weekday.
- Classes, work and protected commitments limit placement. The app does not invent compulsory hours or reject users on feasibility.
- First week calibrates self-reported onboarding context; later weeks use rolling observed behaviour, not permanent judgments based on week one.
- Unregistered target month/year remains tentative; a booked date is separate. Indicative boundaries must be labelled.
- Completed/confirmed learning defines weekly assessment scope. Missed work is a planning issue, not a wrong answer or evidence of weak understanding.
- Coverage, understanding, execution and confidence calibration stay separate; no pass-probability claims.
- AI advice is grounded; changes require a validated preview and confirmation. No silent calendar execution.
- No Sources/Materials student feature. Internal curriculum/content operations remain rights-cleared and original, not reproduced third-party passages.

## 3. Confirmed gaps and highest-priority backlog

These are code findings. Their live frequency is not yet measured.

| ID | Priority | Finding and evidence | Required resolution |
|---|---|---|---|
| T01 | P0 | `scripts/migrate.cjs` displays `--env` but always reads `.env.local`; dry-run creates `schema_migrations`; stored checksums are not compared; TLS certificate verification is disabled. | Enforced target mapping, genuinely read-only planning, drift checks and validated TLS. Never treat today's dry-run as safe validation. |
| T02 | P0 | `supabase/schema.sql` describes old block/metrics/material models. A recent migration says the original profiles table was not tracked in migration history. | Establish a reproducible fresh-install baseline and upgrade path; reconcile remote schema before any production application. |
| T03 | P0 | `taskService.setExecution` updates the task, then writes its event separately. Split shortens the original before inserting the remainder; its remainder omits curriculum identifiers. | Atomic mutation/event/split transactions; preserve LOS/reading/repair lineage and completed scope. Failure cannot leave a shortened task or completion without history. |
| T04 | P0 | `coach/service.decideProposal` marks `executed` before applying edits, may apply some tasks before releasing back to pending; re-check inserts and event writes are separate. | Transactional execution, or explicit durable partial-execution semantics with resumable idempotent steps. Do not report executed before durable completion. |
| T05 | P0 | `startAssessment` writes blueprint, form, form items, attempt and scope snapshot separately. Only the concurrent-open-attempt loser receives targeted cleanup. | Atomic reservation with immutable scope/form; safely handle every intermediate failure and exposure race. Existing unique-open constraint is useful but insufficient alone. |
| T06 | P0 | Task/test/Coach APIs sampled authenticate users but do not enforce completed setup; UI gate is in `/app/layout.tsx`. | Shared endpoint authorization for verified identity, onboarding, ownership, staff role and later entitlement. Setup APIs remain available before completion. Verify direct RPC access too. |
| T07 | P0 | `assembly.ts` fills an outcome's shortage from any remaining item in the reading, not only eligible completed outcomes. | Never silently test an uncompleted outcome. Explicit approved scope expansion or a documented shortfall; retain actual-vs-requested coverage. |
| T08 | P0 | Repair blueprint caps `totalQuestions` at 90 but leaves per-outcome/per-reading allocations unbounded; assembly consumes those allocations. | Enforce ceiling on the delivered form and every aggregate, with a deterministic carry-forward plan. Test more than 45 repair outcomes. |
| T09 | P1 | `roadmapService` sums raw availability; Pulse subtracts commitments differently. Its observed pace uses planned durations; `generateWeek` always supplies empty prior completion rates. | One capacity/pace policy built from actual deduplicated sessions and closed-cycle observations; estimates labelled provisional. |
| T10 | P1 | `allocateDay` permits portions up to 180 minutes without consuming the student's maximum sitting length. It removes a partially allocated module from that week's remaining pool. | Split into valid sittings with conserved remaining scope/effort. No “one portion = completed reading” inference. |
| T11 | P1 | Once any repair fits, `repairsPlaced` prevents the remaining repairs being offered later that week; similar logic exists for unstable work. | Track placed work by identifier; retain and explain unplaced repairs. Do not drop the remainder after one placement. |
| T12 | P1 | Phase-labelled roadmap exists, but allocator uses generic Study tasks across non-final phases; final phase returns without planning mock/review work. | Implement executable revision, mock and last-week strategies rather than chart labels alone. |
| T13 | P1 | `schedule` uses next confirmed class; Calendar week navigation and weekly-review successor calculation use recurring weekdays alone. Capacity does not apply recurring start/end bounds and exceptions consistently. | One occurrence/cycle resolver for current, future, historic and irregular weeks. Confirm the irregular fallback policy rather than silently changing it. |
| T14 | P1 | Today repository reads by date without cycle/cancellation filtering or ordering; repair queue includes only open/proposed while other loaders include more states. | Shared task/repair eligibility and deterministic ordering; show scheduled/awaiting-recheck work accurately. |
| T15 | P1 | `OperatingState` uses wall-clock `dataVersion`, fixed false integrity flags and null trajectory fields; Home reloads signals/week/roadmap separately and swallows some errors as null. | Meaningful revisions, explicit service availability, request-level deduplication, and honest failure vs absence states. |
| T16 | P1 | Bank audit counts verified/reviewed/approved together; assembly and evidence policy use different eligibility rules. Random comparator sorting is used for selection/shuffle. | One versioned trust policy, seedable fair selection and exposure tracking; same eligibility counts in UI, planner, assembler and scoring. |
| T17 | P1 | NVIDIA generator client ignores configurable base URL/model; Coach uses a separate client/retry setup. Its quota is count-then-write, not an atomic reservation. | Shared provider contract with deadlines, model configuration, quota/budget reservation, fallback and evaluation. No current model availability assumed from September probes. |
| T18 | P1 | New log RPC distributes optional/total time into synthetic completed outcome-block durations; legacy and new log contracts have different cross-page effects. | Preserve unknown actual time; allocate recorded totals without inflation; one documented capture pipeline and concurrency-safe idempotency/payload checking. |
| T19 | P1 | `tests/e2e/truth.spec.ts` has empty onboarding and render-purity test bodies. `verify` omits small activation/policy scripts and all live browser flows. | Real assertions and isolated fixtures; no placeholder test may count toward release confidence. |
| T20 | P1 | `RESEND_*`, Sentry and PostHog entries exist in env example without corresponding runtime integration found. Legal pages explicitly remain prototype notices. | Connect needed production services or remove misleading configuration; final legal/privacy/content-rights review before real candidates. |
| T21 | P2 | README still claims local demo state, materials and port 4173. Multiple historical docs/scripts and two assessment API families remain. `lint` is only `tsc`. | Document current architecture; inventory callers before deprecation; real lint/type/test commands; archive superseded instructions safely. |

**Important qualification:** Existing RPCs already make some operations atomic, including acceptance and scoring paths. Extend verified patterns; do not claim the entire backend lacks transactions. Row-level policies and reviewer checks exist, but remote policy/grant parity and multi-tenant isolation have not been verified here.

## 4. Recommended architecture

Keep a **modular monolith**, not a new microservice estate: Next.js UI and API, Supabase Auth/Postgres, deterministic domain services and an optional durable worker for slow/system work.

| Layer | Responsibility | Boundary |
|---|---|---|
| Pages/components | Render state; collect intent; show preview, result and errors. | No writes during reads, navigation or prefetch. Client state is ephemeral, not a duplicate account store. |
| Request authorization | Validate identity, verification, setup, ownership, roles and entitlement. | Every public mutation and privileged read; layout/Proxy is not sufficient. |
| Domain services | Compose/validate plans, scope papers, reduce evidence, compute signals, plan proposals. | Typed/versioned contracts; no provider narrative can change truth. |
| Database commands | Atomic task/event changes, attempt reservation/scoring, proposal acceptance, weekly closure. | Ownership, revisions, uniqueness and idempotency enforced in Postgres as well as API. |
| Read models | A small common candidate/cycle context plus page-specific projections. | Do not make every page load the entire app. Same authoritative definitions, independent failure reporting. |
| Worker/outbox | Item drafting/verification, notifications, reconciliation and costly recomputations. | Retried, bounded and observable; no silent acceptance of a plan. Keep correctness-critical scoring/acceptance synchronous or explicitly pending. |
| AI adapter | Grounded language, constrained classification/drafting; model configuration and evaluation. | Time/cost budget, validated outputs, no teaching or unauthorised tools; deterministic fallback where possible. |

Use request-local deduplication for repeated account/state queries. Cache shared curriculum safely; private candidate state must never enter an unscoped cross-user cache. Avoid building another `OperatingStateV3` alongside an unreconciled V2: evolve the existing contract with adapters and tests.

“Real time” initially means a successful command refreshes all affected projections and stale tabs detect revision changes. Add scoped Realtime subscriptions only where demonstrated necessary; do not expose private tables broadly or depend on sockets for database correctness.

## 5. Development phases and acceptance gates

### Phase 0 — Establish a safe, repeatable baseline

**Work:** Snapshot the current tree and choose the source-control/deployment ownership. This folder is not a Git repository; repository setup is a separate deliberate action. Freeze overlapping changes and create one tracked backlog from T01–T21, not another competing plan per agent.

- Establish local/staging/production project IDs and separate credentials; block fixture/reset jobs against production project IDs, not merely `NODE_ENV`.
- Reconcile applied SQL, functions, constraints, triggers, grants and RLS in a read-only audit. Track migrations through one tool; do not replay old SQL blindly.
- Make migration planning read-only, validate checksums and TLS, verify clean-install and upgrade paths in disposable databases. Decide whether to standardise on Supabase CLI or repair the current runner; do not maintain two histories.
- Generate database TypeScript types. Add tested deterministic fixtures for different candidate routes and lifecycle states.
- Replace empty browser tests; add activation and Coach-policy checks to the standard verifier. Run against `next build` + `next start`, not only dev.

**Exit:** Reproducible environment, known schema baseline, no unsafe reset/migration targeting and one meaningful verification command. No production writes needed to complete this phase.

### Phase 1 — Truth, authorisation and transactional integrity

**Scope:** T03–T08, T14–T16 and privileged backend boundaries.

- Centralise authenticated/verified/onboarded/staff access checks with explicit exceptions for setup/recovery/account operations.
- Audit service-role use; use request-scoped RLS clients where appropriate, narrowly bounded privileged commands otherwise. Add `server-only` guards and explicit response DTOs that never expose answer keys before submission.
- Atomic task create/move/complete/partial/split/cancel/undo + history; include outcome/reading/repair linkage. Model completion reversal and scope recalculation explicitly.
- Atomic paper reservation + immutable item/version/order/scope/exposure record. Add failure cleanup and reconciliation for legacy orphan forms.
- Atomic proposal application; concurrent accept returns the same result. Stale proposals cannot edit today's changed plan. Return accurate partial/pending outcomes if a multi-step operation cannot be made atomic.
- Strengthen existing scoring/challenge RPCs: duplicate submit produces no duplicate evidence, invalidation recomputes affected summaries and cancels obsolete future repairs with an audit reason.
- Replace false integrity flags and wall-clock revisions with meaningful snapshots/versions; service failures never become fabricated zeros.

**Exit:** Two-account isolation, two-device concurrency, retries and injected failures leave coherent task/event/attempt/evidence/proposal state. This is a prerequisite for the UX promises.

### Phase 2 — Finish account, onboarding and editable setup

**Student outcome:** A short setup produces a reviewable first week; editing it later does not send someone through a new-account journey or silently erase their accepted plan.

- Test real email verification, Google sign-in, callback cancellation, expired/reused recovery links, safe redirects, logout and session expiry. Explicitly enforce verification before setup; do not rely solely on unseen dashboard settings.
- Keep five steps: exam target, learning route/classes, starting point, real-week constraints/sitting length, review.
- Preserve tentative month/year; accept exact booked date later. Version curriculum/exam manifests; validate against confirmed windows without pretending indicative data is definitive.
- Autosave with server validation, resume the first incomplete step, conditionally require only relevant fields, and retain answers across refresh/back/error.
- Preview based on a versioned snapshot. Confirmation and failed activation recovery cannot manufacture duplicate active roadmaps/cycles or route users into loops.
- Completed candidates use Settings-owned editing; initially reuse forms if practical, with unambiguous edit/return mode. Show calendar/roadmap consequences before replacing future work.
- Profile creation/cascade migrations need a fresh-install and account-deletion test; their presence in the folder is not proof they are applied.

**Exit:** Fresh email and Google candidates enter a valid first week; incomplete candidates cannot call workspace mutations; returning candidates edit context safely; failures have a retry path.

### Phase 3 — Complete Calendar and capture as the operating backbone

**Student outcome:** The day/week looks like a real calendar, protects life commitments and reliably records what happened.

- One timezone-aware occurrence engine for recurring/one-off/moved/cancelled commitments, exceptions, effective dates and midnight spans. Use it for occupancy, usable time, cycle boundaries, Calendar and review.
- One date-aware cycle resolver; do not recompute a historical accepted cycle from today's class pattern. Support the confirmed irregular next-class anchor and explain fallback when it cannot define a viable cycle.
- Split study portions to maximum sitting length, conserve remaining effort and distinguish partial scope from a completed reading. Retain unplaced work, rather than dropping it.
- Task detail: exact reading/LOS, purpose, suggested method, estimate, timing, status and intended check. No lesson generation.
- Task move/split/defer/skip/completion/undo use transactional commands; offer explicit recovery choices and make any redistribution consequences visible.
- Reconcile class log, quick learning capture and planned-task completion: one real session, multiple covered outcomes, one recorded duration, no duplicate counting. Unknown time stays unknown.
- Class attendance alone does not assert every predicted class topic was covered. Confirm actual scope; unmapped scope remains pending.
- Desktop seven-day grid; tablet adaptive view; mobile day/agenda. Floating/unplaced work and protected commitments remain accessible with keyboard alternatives.
- Precise task deep links with ownership checks and sensible missing/superseded fallbacks.

**Exit:** Logging or changing work updates Home, Curriculum, completed paper scope and trajectory consistently. Recurrence exceptions do not create phantom capacity. No completed task loses its test linkage after splitting.

### Phase 4 — Finish Tests and the curriculum/content capability

**Student outcome:** A paper genuinely checks recorded work, then shows trustworthy weaknesses and a practical next step.

- One versioned curriculum spine and mapping contract across legacy modules, readings, LOS and concepts. Historical evidence retains its original version; upgrades must not fabricate coverage or verification.
- One trust-policy matrix by purpose, tier and evidence effect, used in bank reports, sufficiency, assembly, scoring and signals. Human-reviewed and numerical-verifier-passed are not interchangeable labels.
- Completed-scope snapshot freezes at reservation. Preview distinguishes planned scope from completed scope; no same-reading substitute may introduce an uncompleted outcome.
- Allocation: subject-weight priority, page tie-break, breadth, difficulty/cognition/error-target diversity, item-family exposure and a real 90-question ceiling. Use seeded selection and an unbiased shuffle; persist seed and allocation diagnostics.
- Save mandatory answer confidence, active/interrupted time, flags and changes. Test refresh, offline save failures, expiry, multiple tabs, pause rules, unanswered submission and no-response expiry. Mock clock is server-authoritative; ordinary-paper pause/timing policy must be explicit.
- Results show actual coverage, score/sample size, reading/subject breakdown, confidence/time patterns, supported vs inferred SWOT and untested scope. No correctness → guaranteed mastery shortcut.
- Results produce traceable repair/re-check proposals with bank sufficiency, not automatic unlimited calendar debt.
- Consolidate `/api/tests/*` and `/api/diagnostic/*` behind the same services. Keep adapters until caller audit and parity tests prove safe retirement.

**Content release gate:** The repository bank report is historical and concentrated in FSA/Ethics. It is not a fresh count and mixes trust tiers. Run a corrected staging audit for every promised topic/LOS and intended repeated use. A target of 20,000 does not make the current bank production-ready. Conversely, arbitrary volume is not a substitute for reviewed breadth, original wording, valid distractors and re-check depth.

Keep generation off the student's time-critical paper-start path. Build internal queued drafting → independent verification → human review → publication → challenge/withdrawal, with provenance and version records. Move review/manifest controls out of ordinary student navigation while preserving staff authorisation.

**Exit:** Every delivered question lies within authorised scope; cap, no-repeat/family policy and tier rules are enforced; paper start/submit/retry/challenge works end to end. Release only the support actually demonstrated.

### Phase 5 — Actual adaptation, revision, mocks and the final-week journey

**Student outcome:** Next week responds to reality; months later the app remains useful when first pass is over.

- Replace empty completion-rate input with closed-cycle evidence. Calculate pace from actual sessions; normalise partial work, missing duration, absences and short observation windows. Distinguish forecast uncertainty from shortage of available time.
- Weekly review reconciles required logs or explicit unknowns, combines valid paper evidence and previews carryover, repairs, deferred/dropped scope and changed pressure.
- Accept closes the old cycle and opens one successor atomically. Sunday results normally place repair in the following cycle; irregular class cycles use their stored boundaries.
- Faster progress, extra learning, holidays, heavier/lighter months and class completion update the remaining roadmap without erasing completed history or creating duplicate scope.
- Revision strategy: stale/weak areas, spacing, mixed papers and repeated re-checks; not generic Study tasks or a complete syllabus reset. Preserve strengths with evidence-age labels.
- Final strategy: actual mock appointments, error-review blocks, targeted re-checks and realistic recovery. Full-exam rehearsal can be two separately capped session papers if approved; do not silently call one 90-question session a complete exam.
- Protect the agreed final-preparation period. Late starters receive explicit compressed-plan trade-offs. Last week reduces new decisions and backlog escalation; after exam, stop nudges and archive/export history.
- Test exam target change, deferment, class route → self-study transition and unsupported curriculum years.

**Exit:** Simulated candidate journeys progress from baseline to exam archive with sensible actions, conserved scope and no infinite deferred backlog. Actual observations demonstrably change week two and later weeks.

### Phase 6 — Finish every student page and wording

Keep existing visual direction; finish state coverage and connections before another redesign.

| Surface | Completion requirement |
|---|---|
| Landing | Accurate product promise, clear signup/signin, labelled read-only demonstration, no teaching/upload/readiness guarantees. |
| Home | One justified next action, concise Today, conditional weekly decision, quick capture and transparent progress detail. Loading, stale, zero-evidence, draft, rest-day and final-phase states all work. |
| Calendar | Real grid/agenda, exact task drawer, conflict preview, classes/logs/repairs/papers and previous/next cycles using one resolver. |
| Curriculum | Reading/LOS coverage separate from evidence; revision/roadmap views; precise learning capture and test/calendar links. Long summaries deferred. |
| Tests | One current paper state; accurate start/resume/result; optional checks progressively disclosed; bank gaps honestly labelled; no staff jargon. |
| Coach | Compact grounded conversation, valid suggestions, preview/confirm, outcome and stale/failure state; no teaching. |
| Settings | Canonical exam/route/classes/week/account values; safe editing, notification preferences if supported, history/privacy controls. |
| Review | Contextual page, not navigation tab; short reconciliation and accept-next-week flow with explicit limits. |

Add route-specific loading, error/retry and missing-object states, keyboard/focus management, non-colour status meanings and mobile parity. Do not conflate `null` service failure with an absent roadmap. Align copy with the actual operation: “Defer” is not “Rescheduled” unless placement happened.

**Exit:** Browser scenarios show consistent information and useful actions in each page state; primary links open the intended task/attempt/draft rather than a generic unrelated list.

### Phase 7 — Coach and background services ready for real usage

- One model gateway with runtime-validated config, per-request deadline/cancellation, bounded retries/fallback and safe error responses. Provider health checks run in staging; September access probes are not an availability promise.
- Context/tool contracts contain approved curriculum scope and real state, not raw unlimited history. Validate proposal outputs against deterministic scheduling and authorisation.
- Build response/policy evaluations for no tutoring, no source quotation, uncertain evidence, weak-point guidance, malicious instructions, stale plans, invalid scope and provider outages. Fine-tuning is optional only after evaluation exposes a justified gap and rights-cleared training data exists.
- Durable job/outbox design for notifications and internal generation: unique job keys, retries/backoff, lease/timeout, dead-letter visibility and audited reconciliation.
- Reminder preferences, quiet hours, timezone, opt-out and delivery outcome tracking. Notifications must never accept a plan on a student's behalf.
- Use Resend through configured Supabase SMTP for auth email if selected; adding `RESEND_API_KEY` alone does not connect Supabase confirmation/reset delivery. Separate application reminders from auth email.
- No duplicate LLM client behaviour or unbounded Coach calls; quota/cost limits enforced atomically and measured.

**Exit:** Provider failure leaves a usable planner and an honest fallback; confirmed Coach operations remain truthful; scheduled work executes once or is visibly retryable.

### Phase 8 — Cleanup, performance and maintainability

- Inventory active imports/routes/tables/scripts before deletion. Preserve historical attempts, evidence and old-link redirects; retire legacy API adapters only after parity and usage checks.
- Replace README and env documentation; identify one authoritative spec per domain. Mark old plans superseded rather than destroying founder/history context.
- Remove obsolete demo/materials/scheduler models from runtime where proven unused. Do not drop legacy database data because the UI no longer uses it; apply reviewed retention/backfill/archive plans.
- Eliminate loosely shaped `any` boundaries and unsafe enum drift using generated DB types, Zod input/output validation and typed adapters. Standardise error codes and request IDs.
- Pin supported dependency/runtime versions through a reproducible lockfile/install process; replace `latest` ranges deliberately. Add proper linting rather than calling typecheck lint.
- Remove duplicate full-state loads and query-per-module patterns; batch/aggregate and paginate large evidence/response/history reads. Avoid API default row-limit truncation once item/response counts grow.
- Add query-plan/index review for per-user active cycles/tasks, attempts, scope, evidence/repairs and exposures. Benchmark first; indexes should follow actual plans.
- Lazy-load heavy editors and secondary analysis. Keep public marketing separate from private dynamic state; do not globally cache candidates.

**Exit:** Repeatable clean install/build, documented schema/types/contracts, no unused competing runtime models and measured query/page budgets met on realistic long-term accounts.

### Phase 9 — Production operations, compliance and staged release

- Deploy to a selected managed Next.js platform or properly configured Node hosting; validate production-runtime behaviour, region/DB proximity, timeouts and connection pooling.
- Separate dev/staging/production and secrets; verify OAuth redirects, site URL, email templates, sender-domain configuration and auth protections. Configure limits for abuse and expensive endpoints, not only Coach.
- Audit all exposed tables/views/functions, RLS and `SECURITY DEFINER` grants/search paths. Test direct database API/RPC calls as anonymous, incomplete, candidate A/B and staff. Review CSRF/origin protections, CSP and server-only secret handling. Header presence alone is not a security assessment.
- Connect error monitoring, structured request/job logs and health checks. Redact credentials, raw personal study data and answer keys; configure access and retention.
- Backups/PITR according to chosen recovery objectives, restore rehearsal into staging and emergency rollback/roll-forward procedure. Database backup does not replace separate storage-object backup where storage is actually used.
- Replace prototype legal notices with reviewed launch terms/privacy, retention/deletion, processors, AI limitations, content rights, non-affiliation and no-results guarantees. Obtain appropriate professional review; this plan is not legal sign-off.
- Account deletion/export needs confirmed intent, appropriate reauthentication, correct dependency cleanup, session handling and clear retention exceptions. Billing dependencies, if introduced, must be handled before deleting identity.
- For a paid launch: decide trial/paywall placement, add server-side entitlements, signed/idempotent payment webhooks, refunds/cancellations and grace periods. Do not gate core safety/privacy/account actions on payment. Free private-beta release need not wait for payment integration.
- Release behind capability flags: supported assessments, Coach writes, notifications and billing can be disabled independently. Start with an invited cohort, inspect failures and expand only after release gates pass.

**Exit:** Operations can detect, explain and recover from failure; real provider/email flows and restored data work; paid features cannot be bypassed if enabled; no unresolved P0 defect or unsupported product claim.

## 6. Route and connection delivery checklist

Preserve existing route families. New paths below are proposals, not claims of implemented destinations.

| Flow | Existing routes/contracts | Work to finish |
|---|---|---|
| Account | `/signup`, `/login`, `/check-email`, `/auth/{callback,confirm,error}`, `/forgot-password`, `/update-password` | Verified/setup gates, safe returns, real OAuth/email/recovery fixtures. |
| Setup | `/onboarding/{exam,route,position,week,plan}`; `/api/onboarding/state`, `/api/onboarding/[step]`, `/api/onboarding/plan/{preview,confirm}` | Snapshot consistency, autosave/resume, idempotent preview/acceptance and error recovery. |
| Recovery | `/api/activation/recover` | No duplicate active state; completed users reach an appropriate draft review without restarting setup. |
| Work | `/app`, `/app/calendar`; `/api/tasks`, `/api/tasks/[id]`; `/api/commitments`, `/api/commitments/[id]` | Atomic lifecycle, recurrence, exact deep links, cross-page invalidation. |
| Capture | `/app/log`, `/app/calendar/log-class`; `/api/log-learning`, `/api/class-log/{context,preview,confirm}` | Shared actual-session/scope model, trustworthy duration and class boundary consequences. |
| Curriculum | `/app/curriculum`, `?view=roadmap`, `?view=readiness`, subject/reading routes; `/api/curriculum/*`, `/api/roadmap`, `/api/signals` | One versioned spine, safe self-report vs evidence and consistent phase/projection. |
| Assessment | `/app/tests`, `/app/tests/[attemptId]`, result; `/api/tests/start`, scope family, attempt family | Frozen scope, lawful eligible item bank, robust clock/autosave, atomic reserve/score. |
| Repairs/challenges | `/api/diagnostic/repair`, `/api/diagnostic/challenge`, resolution and review endpoints | Shared services, lineage, deduplication, invalidation and re-check placement. |
| Closure | `/app/review-week`; `/api/weekly-review/{state,accept}` | Same cycle resolver, observed adaptation, preview and one successor. |
| Coach | `/app/coach`; `/api/coach`, `/api/coach/history`, `/api/coach/proposals/[id]` | Shared context/tool policy, transactional execution and history controls. |
| Settings/account | `/app/settings`, `/api/profile`, `/api/profile/classes-completed`, `/api/account/delete` | Preview setup consequences; account safety, deletion/export and optional entitlements. |

Proposed query contracts: `/app/calendar?task=<id>` and `?draft=<id>`; centralise builders and validation. Proposed internal `/internal/diagnostics/*` surface may replace student-path review/manifest pages after role and routing verification. Proposed export, job/health and billing endpoints should be added only with the corresponding implemented phase, not as empty stubs.

Keep `/app/week` and `/app/syllabus` compatibility redirects. Do not remove auth recovery/error routes simply because the static link audit calls them unlinked.

## 7. Backend contract and migration checklist

For each command define: identity/role, object ownership, setup/entitlement, input schema, expected revisions, idempotency key/payload hash, transaction boundary, domain events, read-model invalidation, response/errors and retry behaviour.

Key database invariants:

- One active roadmap/cycle per candidate where the domain requires it; one applicable ready draft per snapshot; accepted revisions immutable or explicitly superseded.
- Every task/event/repair/attempt refers to the same candidate; cross-table ownership is enforced, not just independently valid foreign keys.
- Split/carryover retains learning scope and lineage. Session actual minutes have one authoritative total; projections do not manufacture additional time.
- Form ≤90; all items eligible; item versions/options/order frozen; exposure/family rules checked under concurrent reservation.
- Attempt scoring/evidence is repeat-safe; challenge withdrawal preserves history and consistently affects summaries/repair tasks.
- Proposal status reflects actual outcome. A stale revision cannot mutate an accepted newer plan.
- Missing/stale/error states are distinguishable from valid empty states.

Use additive expand → backfill → verify → switch → contract migrations. Rehearse both a clean database and upgrade from an anonymised/staging snapshot. Future-dated migration filenames in the folder are ordering identifiers, not proof that those changes are pending or applied; reconcile the ledger. Do not edit already-applied migrations to conceal drift.

## 8. Environment and external setup

| Service | Required configuration | Current qualification |
|---|---|---|
| Supabase app | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; server-only service credential where narrowly needed | Keys alone do not verify RLS, grants, triggers or email confirmation policy. |
| Migration access | Explicit per-environment DB connection/project identity, credential and TLS configuration | Current runner expects `SUPABASE_DB_PASSWORD`, absent from env example; repair/document targeting before use. |
| Site/Auth | Canonical public site origin and provider redirect allowlist; Google client configuration in Supabase | Google credentials need not be exposed in browser env. Test provider-verified identity. |
| NVIDIA | `NVIDIA_API_KEY`, configurable base URL/model/tier; request/cost budgets | Normalise generator and Coach adapters; confirm access through staging, no assumed historical model availability. |
| Email | Verified sender domain; SMTP credentials configured in Supabase; optional `RESEND_API_KEY`/sender for application email | No direct reminder delivery integration found. Auth email and app email are separate paths. |
| Monitoring | Selected error-monitoring DSN/server credentials and release identity | Env entries currently are not proof of installed instrumentation. |
| Analytics | Optional consent-aware event configuration | Not a prerequisite for transactional correctness; avoid recording raw questions/messages by default. |
| Jobs | Scheduler/worker credentials and job authorisation if introduced | Proposed, not an existing reliable background system. |
| Billing | Selected provider credentials, signing secret and server entitlements if paid launch | Not found as a completed integration; provider choice/trial policy needed. |

Validate configuration at startup/health boundaries; fail clearly for required services and degrade safely for optional AI/analytics. Only genuinely public keys use `NEXT_PUBLIC_*`.

## 9. Verification matrix and release gates

### Test layers

1. **Pure domain:** deterministic dates, capacity, allocations, evidence, SWOT, selector, revision and carryover. Property tests conserve duration/scope and never exceed 90.
2. **Database integration:** fresh/upgrade migrations, grants/RLS, atomic commands, concurrency, idempotency, rollback and invalidation. Test with separate candidate identities and realistic row counts.
3. **API contract:** direct auth/setup bypass attempts, ownership, invalid inputs, 409 revisions, retry/duplicate operations, missing services and safe errors.
4. **Browser:** real fresh/returning login, setup, capture, calendar edits, paper taking/results/challenge, review, next week, Coach and settings. Empty test bodies must fail review.
5. **Operational:** deployed production build, provider timeouts, SMTP delivery, load/row-limit behaviour, restored database and rollback/roll-forward exercise.

Fixtures must cover self-study, fixed/variable/mixed classes, no availability, tentative/booked target, late starter, first pass complete, sparse evidence, extra/partial/missed work, bank exhaustion, challenged evidence, deferred exam and final week. Test mobile and desktop, keyboard access, two tabs/devices, network interruption and timezone/day-boundary behaviour.

Browser checks: meaningful screen, no runtime overlay/hydration error, relevant console health, visible save/error outcome, exact object destination and proof that each mutation affects its downstream pages. GET/prefetch/render purity must be proven by before/after database snapshots.

### Gates

| Gate | Ready when |
|---|---|
| G0 Safe development | Targeted isolated environments, genuine schema replay and meaningful automated baseline. |
| G1 Trustworthy core | Atomicity, ownership, revisions, eligibility and scope pass fault/concurrency tests. |
| G2 Candidate beta | Fresh candidate completes the full weekly loop and first-pass/revision transitions, with no dead end or fabricated evidence. Capability limits are visible. |
| G3 Production | Legal/content rights, real auth email/provider setup, isolation/security review, monitoring, backups/restore and deployed-runtime QA complete. |
| G4 Paid/public expansion | Honest all-promised-topic capability, billing if applicable, capacity/load/cost validation and support/incident readiness. |

Set performance budgets after measuring staging: request/query counts, p95 mutation/page latency, longest account-history load, LLM spend and notification success. Do not claim scale or completion dates from a passing build alone.

## 10. Priorities, dependencies and decisions

**Critical order:** Phase 0 → Phase 1 → first-week onboarding/calendar → tests/result → observed next-week adaptation → revision/final strategy → page completion → cleanup/operations → staged release. Curriculum/item review is a continuous workstream starting early because it can block release even after UI work is finished. Operational testing starts early and closes in Phase 9; it is not postponed entirely to the end.

Each implementation slice should ship: one user outcome, contract/migration if needed, tests, browser proof, affected-route list and rollback note. Close a slice before opening another competing rewrite of the same domain. Preserve existing successful implementation and founder decisions.

Decisions needed for release—not blockers to start Phase 0:

1. **Launch scope:** Full Level I assessment support, or an honestly labelled invited pilot while reviewed bank coverage expands? Recommend private pilot first; do not sell unsupported full-syllabus diagnostics.
2. **Incomplete paper breadth:** When completed scope cannot all be checked within 90 or the eligible bank, approve an explicit carry-forward obligation or require multiple capped papers? The current “everything this week” promise and fixed ceiling can conflict. Never silently resolve it by dropping scope.
3. **Irregular classes:** Confirm the current next-class anchor/fallback policy, including next-day and distant classes. Preserve accepted historical cycles regardless of the choice.
4. **Commercial release:** Free beta vs paid launch, trial/paywall location and payment provider. Entitlements must follow that decision, not precede it by guesswork.
5. **Operational ownership:** Staging/production projects, hosting, content reviewer and support/privacy contacts. A launch needs named owners, not just env keys.

## 11. Production references

The plan uses the installed Next.js 16.3.4 production guide and React/Supabase review skills. It emphasises coherent commands, scoped data loading and failure recovery rather than another UI-only overhaul.

Supabase recommends reviewing RLS, indices, staging load, authentication settings and deployment controls before production. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

Auth email delivery needs configured custom SMTP, not merely an application API key; confirm delivery/template behaviour in the chosen environment. [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Choose backup/PITR and recovery procedures against agreed recovery objectives, and rehearse restore. [Supabase database backups](https://supabase.com/docs/guides/platform/backups).

This document is the completion backlog and proposed gate sequence as of 13 October, not a claim of production certification. No product-direction change is approved merely by appearing here.
