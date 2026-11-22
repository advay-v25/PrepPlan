# Roadmap product audit and founder decision register

**Audit date:** 18 September 2026  
**Scope:** landing, authentication, onboarding, Home, Calendar, Curriculum, Tests, Coach, Log Learning, Settings, sources, routes, shared state, and the current QA harness  
**Status:** analysis complete; founder decisions resolved and recorded in `FOUNDER-PRODUCT-DECISIONS.md`; no application logic changed yet

## 1. Product directions already locked

These are not open questions. They come from the founder's prior instructions and should be treated as product constraints.

1. Roadmap is a CFA Level I learning-control system. It plans, organises, tests, measures, adapts, and creates accountability. It does not teach the curriculum from scratch.
2. Authentication is required. Completed onboarding is a mandatory access gate for every authenticated user entering `/app/*`.
3. The onboarding gate is context capture, not eligibility or feasibility screening. Every user can complete it; no readiness or capacity verdict may deny access.
4. Unregistered candidates choose a tentative February, May, August, or November exam window. Registered candidates can add the exact booked date.
5. The user does not choose an arbitrary weekly study-hours target. Confirmed availability is a planning boundary; the system adapts weekly scope using the roadmap, class activity, diagnostic evidence, deviations, and execution history.
6. Calendar changes made by the Coach must be proposals with a preview and explicit confirmation, not silent mutations.
7. Self-reported study, confidence, exposure, and demonstrated understanding are different facts and must never be collapsed into one evidence type.
8. Diagnostic questions must be original, CFA-style, curriculum-aligned, traceable, and quality-controlled. Licensed/reference material must not be quoted or reproduced in student-facing output.
9. Materials are not a primary navigation tab. Upload/analysis is optional and may become premium; core planning must remain viable without it.
10. The product voice is calm, honest, and non-panic. It should show trade-offs without shaming, predicting failure, or fabricating certainty.

## 2. How the audit was performed

- Created an isolated dummy account and used the app at `http://localhost:3000` as a first-time student.
- Inspected landing, sign-in, sign-up, password recovery, legal pages, the mandatory onboarding path, and all authenticated primary pages.
- Exercised sign-in, sign-out, onboarding forward-step protection, onboarding API flow, route redirects, and the current first-week confirmation path.
- Captured rendered DOM, screenshots, and browser runtime output through the Browser integration.
- Ran the repository's typecheck, unit suites, route audit, and onboarding API journey.
- Compared rendered behaviour with the server state, database constraints, route ownership, and existing product specifications.

Automated logic tests pass, but the current end-to-end onboarding journey does not. The passing unit suite does not validate that the UI and database agree on the same contract.

## 3. Confirmed release blockers

These are defects, not product choices.

### P0-1 — Onboarding crashes on Step 2

**User experience:** After selecting an exam window and continuing, the preparation-route screen fails with a Next.js error overlay: `Cannot read properties of undefined (reading 'filter')`.

**Cause:** `RouteStep` reads `state.commitments`, but `readCanonicalState()` returns `classes`, `windows`, and `exposure`. `OnboardingShell` declares yet another shape: `availability`, `commitments`, `coverage`, and `sources`. The `as any` cast on the page hides the compile-time contract failure.

**Affected path:** `/onboarding/exam` → `/onboarding/route`.

**Required correction after decisions:** Define one canonical onboarding read contract, use it in the service, page, shell, and all six steps, and remove the unsafe cast.

### P0-2 — Checkpoint cannot unlock the plan step

**User experience:** Even after saving the week and checkpoint, direct access to `/onboarding/plan` is redirected back to `/onboarding/checkpoint`.

**Cause:** `readCanonicalState()` has no persisted checkpoint-complete condition. Once `max_session_minutes` exists, `firstIncompleteStep` always resolves to `checkpoint`. `saveCheckpoint()` derives and writes a day but does not update an onboarding step/status marker that changes this result.

**Required correction after decisions:** Make completion derive from explicit, validated per-step state. The review/plan step must become reachable after checkpoint succeeds.

### P0-3 — First-week acceptance violates the live database contract

**User experience:** The final confirmation endpoint fails and no accepted week is created.

**Observed error:** `plan_blocks_origin_check` rejects the value written by `accept_onboarding_preview`.

**Cause:** The RPC writes `origin = 'algorithm'`, while the live constraint allows a different vocabulary (`planner`, `roadmap`, `class`, `diagnostic`, `student`, `coach`). The code, migration history, and live schema have drifted.

**Required correction after decisions:** Adopt one canonical origin enum, migrate existing data safely, update every writer, and contract-test the live schema.

### P0-4 — The onboarding E2E reset is not isolated

**User experience:** Not directly visible, but it makes the team trust a misleading result.

**Cause:** `resetE2EUser()` does not reset `profiles.onboarding_status`, exam/profile fields, availability windows, or topic exposure. A test can report that onboarding is complete because an earlier run or manual setup left the profile complete, even when plan confirmation failed in the current run.

**Required correction after decisions:** Make the fixture reset complete, idempotent, and limited to an unmistakable test identity. Assert preconditions before the journey begins.

### P0-5 — Database write failures can be silently ignored during onboarding

**Cause:** Several onboarding service writes await Supabase calls but do not check returned errors or call `throwOnError()`. The API can return success while part of the step failed.

**Required correction after decisions:** Use transactional/RPC writes for multi-table steps and explicit error handling for every write.

### P0-6 — Home, Calendar, Settings, and onboarding disagree on account truth

**Observed state on the same dummy account:**

- Home and Calendar show an Ethics milestone and 0% readiness/progress.
- Settings says the exam is “Not chosen yet.”
- Curriculum has a draft roadmap aimed at February.
- The accepted planning cycle and study tasks do not exist because confirmation failed.

**Cause:** Pages compose data independently and tolerate partial/stale drafts differently. `OperatingState` is incomplete and not yet the universal read contract.

**Required correction after decisions:** One account-scoped operating-state service must define exam target, active roadmap, active cycle, current week, next action, evidence, repairs, and capability availability consistently.

## 4. Page-by-page findings and enhancements

### Landing `/`

**What works**

- The basic promise is understandable and the visual presentation is clean.
- Primary authentication entry is easy to find.

**Problems**

- The copy promises that a diagnostic closes every study week, although the item bank may be insufficient and not every week necessarily has eligible scope.
- The page shows almost no product proof: no calendar preview, adaptive-week example, evidence-to-repair loop, or explanation of what Roadmap deliberately does not do.
- It does not explain the difference between planning evidence, task completion, and diagnostic evidence.
- It lacks production trust content: verified legal policy, security/privacy detail, pricing/entitlements, support/contact, and transparent CFA Institute non-affiliation near the conversion path.

### Authentication `/login`, `/signup`, `/forgot-password`, `/update-password`

**What works**

- Email/password and Google entry points exist.
- Sign-in, sign-out, safe internal next paths, forgot-password entry, and Terms/Privacy consent are present.
- Google sign-up is intended to return to onboarding while returning sign-in users return to the app.

**Problems**

- The development-only “Preview guided setup” link is visible locally but redirects an unauthenticated user back to login; it is not a working preview.
- Sign-up says context is optional, while onboarding is a mandatory product gate.
- The password rule is only eight characters and does not communicate stronger guidance or compromised-password protection.
- Google OAuth, email confirmation delivery, expired/reused recovery links, and post-reset sign-in were not proven end to end with a real inbox/provider.
- Terms and Privacy are marked as prototype documents and still describe material uploads as a normal flow. They are not launch-ready legal documents.
- No visible session/device management, recent security activity, re-authentication before destructive account deletion, or recovery fallback exists.

### Onboarding `/onboarding/[step]`

**What works**

- It is enforced as an authenticated setup gate.
- The exam window asks registered versus not registered and supports a tentative sitting for unregistered candidates.
- Direct forward navigation is blocked before earlier required context is complete.
- The conceptual six-step shape is broadly relevant: exam, route/classes, position, real week, checkpoint, first-week review.

**Problems**

- The flow is currently impossible to finish because of P0-1, P0-2, and P0-3.
- The progress rail clips on the tested narrow viewport and does not clearly communicate scrollability.
- State naming differs across server, shell, and step components.
- The service currently treats timezone as a required exam-step field even though it is meant to be detected automatically and editable later.
- `onboarding_step`/status progress is not consistently updated, so the rail, route guard, and persisted truth can disagree.
- The review preview calculates availability from fields the service does not return and can therefore show false “No study time scheduled.”
- The preview creates a draft roadmap before acceptance; repeated preview requests can leave abandoned draft roadmaps unless explicitly superseded/cleaned.
- The review only lists task titles and minutes. It does not expose why the scope was chosen, calendar placement, conflicts, assumptions, diagnostic eligibility, or what can be changed before acceptance.

### Home `/app`

**What works**

- Home is visually cleaner than the earlier build and has clear primary destinations.
- It attempts to orient the student to today and the active milestone.

**Problems**

- With no accepted week, most of the viewport is an attractive but empty shell.
- A 0% “Readiness” ring appears without explaining whether it represents coverage, diagnostic evidence, or plan execution.
- Current readiness is 60% coverage + 40% diagnostic average, and becomes pure coverage when no diagnostic exists. This makes self-reported/completed coverage look like readiness before demonstrated understanding exists.
- There is no executable next action, today's sequence, plan-review action, weekly-close state, test eligibility, deviation status, or cross-page consequence preview.
- Quick-link pills duplicate the sidebar rather than helping the student resolve the next decision.
- The page reads an incomplete `OperatingState`: no plan draft, proposal, evidence changes, capacity, conflict, bank sufficiency, or capability information.
- “Log learning” is visually prominent even though the core accepted week is absent, and its destination is still flagged as example data.

### Calendar `/app/calendar`

**What works**

- It now renders a recognisable time-grid and recurring protected commitments.
- Week/agenda controls, week navigation, current day, add-commitment entry, and semantic explanation of timed versus day-preferred work exist.

**Problems**

- No accepted study work appears because first-week acceptance is broken.
- At the tested 824px width, only part of the seven-day grid is visible at once; the mobile/tablet strategy needs an explicit design rather than a squeezed desktop week.
- The header promises a cumulative diagnostic every week without verifying an eligible form can be assembled.
- There is no visible floating-task tray, class logging/sync flow, plan revision review, weekly close, or repair proposal in the tested state.
- Calendar and checkpoint logic currently derive the study-week boundary from class weekdays, whereas prior specifications also describe a user-selected closing day. This is a product decision conflict.

### Curriculum `/app/curriculum`

**What works**

- A long-term roadmap with phases, prerequisites, and a protected final-preparation period exists.

**Problems**

- Current messaging says the plan “does not fit,” asks the student to add roughly 23 hours weekly, move the exam, or accept thinner coverage. This may violate the non-panic positioning and the rule against prescribing an arbitrary study-hours target.
- A draft roadmap is treated as meaningful context even when onboarding confirmation failed.
- Progress terminology does not consistently distinguish self-report, activity completion, diagnostic verification, and stale evidence.
- The supported curriculum/test slice is far narrower than the full map, but the page does not clearly expose capability coverage.

### Tests `/app/tests`

**What works**

- The page exposes module, concept, and cumulative test purposes.
- The current bank count and per-module coverage are visible.
- The diagnostic backend has meaningful deterministic numerical, blueprint, and evidence foundations.

**Problems**

- The current reviewed bank is only 19 FSA items, while the product presents a broader CFA Level I experience.
- “Weekly cumulative” can be offered without proving unseen eligible items and studied scope are sufficient.
- “Item review” appears in the student experience; this looks like an internal reviewer/admin capability unless deliberately intended as a transparency feature.
- Result-to-repair-to-calendar behaviour has not been proven through two consecutive weeks.
- There is no clear student-facing distinction between practice-only attempts and readiness-moving diagnostic evidence.

### Coach `/app/coach`

**What works**

- The intended boundary is visible: explain state and support planning rather than teach entire chapters.

**Problems**

- The page explicitly describes a non-persistent Phase 0 session.
- It does not yet provide a persistent, account-scoped conversation grounded in the same current operating state.
- It cannot reliably preview, validate, accept, execute, and undo calendar proposals.
- It has no visible evidence citations, capability limits, stale-state handling, or clear handoff from test result to proposed repair.

### Log Learning `/app/log`

**Problems**

- It is labelled example/prototype even though it writes real account data.
- Copy says a learning log is “real evidence of progress,” which risks conflating activity evidence with demonstrated understanding.
- The module list is hardcoded to three FSA modules.
- It is not yet clear whether this should remain a standalone destination or become a contextual action on Home/Calendar.

### Settings `/app/settings` and sources

**What works**

- The page groups major setup inputs and provides edit links.
- It states that sources are optional/premium rather than a core requirement.

**Problems**

- Displayed exam, checkpoint, diagnostic time, slots, and module counts can disagree with canonical account data.
- “Change” links enter onboarding routes that currently redirect completed users straight back to `/app`; completed users therefore cannot edit setup through those links.
- Sources says “add during setup” even though source capture was removed from setup, and direct creation is “coming soon.” This is a dead-end.
- Account deletion safety and full data export/retention controls are not demonstrated.

### Routes and navigation

- All 101 audited internal links resolve to a known route.
- `/app/materials`, `/app/syllabus`, and `/app/week` are compatibility redirects and are not in primary navigation, which is appropriate for now.
- The route ownership document incorrectly says `/app` redirects to Calendar; the actual product uses `/app` as Home.
- `/auth/error`, `/check/result`, and `/update-password` are callback/deep-link destinations and being unlinked is not automatically a defect, but they require dedicated E2E coverage.

## 5. Architecture and quality findings

1. **The typecheck passes because core onboarding state is cast to `any`.** Passing TypeScript is not proof of contract consistency.
2. **Migration history and live schema have drifted.** The accepted `plan_blocks.origin` vocabulary is one visible example.
3. **OperatingState is too narrow.** It currently includes a milestone, today's blocks, a blended readiness number, latest diagnostic, and repair count, but omits the states needed to operate the product.
4. **Readiness semantics are not evidence-safe.** Coverage can produce a readiness score without any diagnostic evidence.
5. **The week-boundary rule is duplicated as both product copy and derived logic.** It needs one explicit product decision and one owner.
6. **A passing logic suite is not a release gate.** Browser onboarding, live schema contracts, empty/partial states, and cross-page coherence need first-class tests.
7. **Prototype banners are route-based, not capability-based.** They can call a real writer “example data” and miss incomplete sections inside otherwise real pages.
8. **Service-role reads are used broadly in `OperatingState`.** Account scoping is present, but RLS-safe client/server ownership and least-privilege boundaries need a dedicated security review before production.

## 6. Founder decisions — resolved

The founder answered D1–D15 on 18 September 2026. The authoritative, implementation-ready resolutions are maintained in [`FOUNDER-PRODUCT-DECISIONS.md`](./FOUNDER-PRODUCT-DECISIONS.md). Key outcomes:

- class cycles define class-going candidates' weeks; self-study uses Monday–Friday;
- new learning closes with a diagnostic paper and revisited learning with a revisionary paper;
- Home uses transparent multi-signal evidence rather than one opaque readiness percentage;
- calm plan-pressure warnings replace prescriptive hours language;
- Home is a next-action console;
- learning/class capture lives in Curriculum plus Home/Calendar widgets;
- the post-paper weekly closure is contextual on Home, not a navigation tab;
- Coach is persistent, planning/evidence focused, non-teaching, and confirmation-gated for Calendar changes;
- diagnostic operations are staff-only and absent from the student app;
- sources/materials are removed from the current student product;
- a public read-only sandbox will exist;
- email verification is required before onboarding;
- mobile/tablet/desktop Calendar defaults are day/three-day/seven-day;
- failed activation is recoverable; week one is a conservative baseline-calibration week.

The original questions and recommendations remain below as the audit trail.

Recommended defaults are offered for speed, but nothing in this section should be implemented as a product change until confirmed.

### D1 — Study-week boundary

Should the week always be Monday–Sunday, should the candidate choose the closing day, or should Roadmap derive it from the class pattern and update it when classes change?

**Recommended default:** candidate chooses a stable closing day during onboarding; Roadmap can recommend one from class timing, but changing it later requires confirmation. A stable reporting period makes execution history and diagnostics easier to interpret.

### D2 — Diagnostic cadence promise

Should every week always end with a diagnostic, or should Roadmap schedule one only when enough studied scope and a valid unseen item form exist?

**Recommended default:** every week has a checkpoint, but the checkpoint may become a diagnostic, concept check, review, or no-test close depending on eligibility. Never promise a test the bank cannot deliver.

### D3 — “Readiness” on Home

Do you want one headline readiness percentage, or separate transparent measures such as roadmap coverage, diagnostic evidence, week execution, and confidence calibration?

**Recommended default:** do not show a single readiness score until enough valid evidence exists. Lead with Next Action; show separate measures with sample size and freshness.

### D4 — Curriculum pressure language

When the long-term projection is compressed, should Roadmap explicitly say “this does not fit” and quantify additional hours, or present a calm pressure state with trade-offs?

**Recommended default:** show “Plan pressure: high,” explain the assumptions, and offer scope/sequence/window choices. Do not instruct the student to add a specific number of hours unless they ask for that scenario.

### D5 — Home's primary job

Should Home primarily be (a) a next-action console, (b) a progress dashboard, or (c) an equal mix?

**Recommended default:** next-action console first, today/attention second, evidence and roadmap below the fold.

### D6 — Log Learning placement

Should “Log learning/class/practice” remain a full primary page, become a quick action/drawer from Home and Calendar, or support both?

**Recommended default:** both—a fast drawer for common logging and a dedicated deep-linkable route for detailed capture/history. Treat logs as activity evidence only.

### D7 — Classes after onboarding

For variable and mixed classes, should the app prompt for the coming week's classes during weekly review, allow direct Calendar logging, or both?

**Recommended default:** both. Weekly review requests the expected schedule; Calendar supports one-off add/move/cancel and post-class “what was covered?” capture.

### D8 — Coach history

Should Coach retain conversations across sessions, retain only approved proposals/outcomes, or start fresh each visit?

**Recommended default:** persist concise conversation history plus every proposal/outcome, with user-visible delete controls. Do not keep unlimited raw context in the model prompt.

### D9 — Internal diagnostic review UI

Should student accounts ever see “Item review,” manifests, verifier states, or challenge resolution tools?

**Recommended default:** no. Keep student challenge/report controls, but place authoring/review/manifest tools behind an explicit staff role and separate route group.

### D10 — Source management visibility

Until premium upload/source analysis is functional, should Settings show a disabled “coming soon” sources page, a waitlist/entitlement explanation, or no source UI at all?

**Recommended default:** show a concise entitlement explanation only if premium launch is close; otherwise remove the dead-end while preserving backend capability.

### D11 — Public product preview

Should prospects be able to explore a read-only demo without an account?

**Recommended default:** yes, but as a deliberately seeded sandbox isolated from onboarding and real user state. Otherwise remove the broken preview link entirely.

### D12 — Email verification and access

Must email/password accounts verify their email before beginning onboarding, or may they start setup while verification remains pending?

**Recommended default:** allow setup after sign-up but require verified email before first-plan acceptance or external notifications. Preserve work if the link arrives late.

### D13 — Legal/material wording

Should the MVP Terms/Privacy describe premium material upload now, or only features actually enabled for the user's plan?

**Recommended default:** describe both current processing and separately labelled future/optional processing accurately; never make users consent to a misleading active flow.

### D14 — Calendar on small screens

On phones/tablets, should Calendar default to a day timeline, three-day view, or horizontally scrollable seven-day grid?

**Recommended default:** day timeline on phones, three-day adaptive view on tablets, seven-day grid on desktop; Agenda is always available.

### D15 — Home empty/no-plan state

If onboarding is complete but a week cannot be accepted, should Home send the student back to repair setup, allow manual task creation, or show a retry/review state?

**Recommended default:** show a recoverable “Your week could not be activated” state with retry, review inputs, and support diagnostics. Do not show a fabricated 0% dashboard.

## 7. Proposed work order after decisions

1. Repair the canonical onboarding contract and isolated E2E fixture.
2. Fix transactional preview acceptance and live-schema contract tests.
3. Establish the complete `OperatingState` read model and cross-page invariants.
4. Rebuild Home against that truth contract.
5. Connect Calendar task execution, class sync, weekly close, diagnostics, repairs, and Coach proposals.
6. Then polish landing/auth and remove or gate incomplete surfaces.

No feature should be visually “completed” before its underlying action contract is executable and tested across the destination page.
