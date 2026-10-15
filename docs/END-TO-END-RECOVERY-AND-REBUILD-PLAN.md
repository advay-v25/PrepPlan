# Roadmap — End-to-End Recovery and Rebuild Plan

**Status:** Active implementation plan  
**Date:** 18 September 2026  
**Product boundary:** Roadmap plans, organises, tests, measures, adapts, and holds a CFA Level I candidate accountable. It does not teach the curriculum from scratch or present itself as a replacement for a learning provider.

## 1. The product we are actually building

Roadmap is a learning control system with one continuous loop:

1. Capture the candidate's exam target, preparation route, current coverage, fixed commitments, realistic study windows, and weekly checkpoint.
2. Turn the long-term curriculum roadmap into one reviewable week.
3. Put accepted study, class, review, test, repair, and life blocks onto a real calendar.
4. Record what actually happened without pretending partial work was complete.
5. Test with unseen, traceable, CFA-style diagnostic items.
6. Convert test evidence into concept-level strengths, instability, and repair needs.
7. Propose repair and re-verification work for the next valid window.
8. Compare planned work with actual execution and adapt the following week.

The system may recommend, explain, and propose. It must not silently invent availability, write an accepted plan from a page render, teach whole readings, fabricate evidence, or block a student from entering because setup is incomplete.

## 2. Verified baseline on 18 September 2026

### Release blockers found in the live app

- Selecting an exam caused a `Maximum update depth exceeded` loop. Continue became disabled and onboarding could not advance.
- Every `/app/*` route redirected to onboarding until setup was marked complete, so the broken step denied access to the whole product.
- The calendar creates a weekly diagnostic as a side effect of rendering the page. A read-only visit must never mutate the student's plan.
- A weekly diagnostic appears even when there is no accepted study cycle and no studied scope to diagnose.
- The calendar UI is technically a time grid, but the current user sees an almost entirely empty week because no connected week-composition journey exists.
- Home has non-functional `Start Now` and `Defer` controls and does not expose setup gaps, weekly load, execution drift, repairs, or diagnostic readiness as one operating state.
- Coach is still powered by seeded browser-local demo state. Its API reads legacy `user_metrics` and `test_records`, while the real product now stores assessment attempts, evidence events, repair threads, roadmap progress, and plan blocks.
- Curriculum can generate a long-term roadmap, but there is no visible, reviewable bridge from the current milestone to a weekly draft.
- Tests has a real item/evidence pipeline, but the product does not yet guarantee that every scheduled test has enough eligible unseen items or that its scope matches studied modules.
- Settings describes several features correctly, but source creation/archiving is unfinished and the app still contains legacy redirect-only pages and dead demo models.

### Foundation that is worth keeping

- Supabase authentication and password recovery routes exist.
- Structured onboarding writers exist for profile, coverage, availability, classes, commitments, and checkpoint settings.
- The curriculum roadmap supports prerequisites, phases, variable horizons, and an eight-week final-preparation reserve.
- Calendar rendering, recurring commitments, conflict checks, optimistic revisions, task events, partial completion, deferral, splitting, and repair task types exist.
- Diagnostics has deterministic numerical verification, unseen-item tracking, reviewed-versus-verifier tiers, evidence events, challenge handling foundations, and repair threads.
- The current automated logic suites pass, but they do not catch the live onboarding loop or the product-level contradictions above.

## 3. Target architecture

### 3.1 One server-owned student operating state

Every product page reads from a shared `OperatingState`; no page maintains a parallel version of the student in local storage.

The read model must contain:

- identity: exam window, registration status, preparation route, timezone;
- setup completeness: missing context and a non-blocking action to add it;
- roadmap: current phase, milestone, progress, drift, projected first-pass finish;
- week: draft/accepted cycle, planned minutes, available-window minutes, protected commitments;
- today: ordered executable tasks and the true next action;
- execution: completed, partial, deferred, skipped, and actual time;
- diagnostics: next eligible check, bank sufficiency, recent attempts, concept evidence;
- repairs: proposed, accepted, scheduled, overdue, and re-verification status;
- attention: conflicts, stale drafts, over-capacity warnings, missing context, and items requiring human review.

### 3.2 Separate state machines

Do not overload one status field across unrelated concepts.

- **Onboarding:** not_started → in_progress → complete; authenticated users must complete onboarding before accessing `/app/*`. This is a setup-completion gate only—never an eligibility, feasibility, or readiness gate.
- **Planning cycle:** absent → draft → accepted → active → closed → superseded.
- **Task execution:** not_started → in_progress → partial/completed/skipped/deferred.
- **Diagnostic attempt:** ready → in_progress → submitted → scored → challenged/voided where applicable.
- **Evidence:** supported / unstable / needs_repair, with validity and recency separate.
- **Repair thread:** proposed → accepted → scheduled → repaired → recheck_due → verified/reopened.
- **Coach proposal:** proposed → accepted/rejected → executed/failed/expired.

### 3.3 Command/query separation

- Page rendering and GET requests are read-only.
- Plan creation, plan acceptance, task changes, test submission, challenge resolution, repair acceptance, and coach actions are explicit commands.
- Multi-table commands use database transactions/RPCs and idempotency keys.
- Every consequential mutation writes an audit event.

## 4. Delivery phases

## Phase 0 — Recovery baseline and product truth

**User experience achieved:** The app stops contradicting itself. A signed-in student completes a reliable, non-judgmental setup flow and then enters a workspace that already understands their exam, route, current position, and real week.

### Build

- Inventory every route, database table, state model, and mutation owner.
- Establish canonical routes: Home, Calendar, Curriculum, Tests, Coach, Settings, plus contextual Log Learning.
- Keep compatibility redirects temporarily for `/app/week`, `/app/syllabus`, and `/app/materials`; remove them after analytics show no active use.
- Enforce onboarding as a setup-completion gate for every `/app/*` route. It must never become an eligibility, readiness, or feasibility gate.
- Fix onboarding render stability and make timezone automatic, editable later in Settings.
- Replace user-facing fake/demo data outside explicit `?demo=1` preview mode.
- Define the authoritative `OperatingState` contract and page ownership matrix.
- Ensure page renders never create plan blocks, attempts, repairs, or proposals.

### Verification gate

- Email login, Google callback, email verification, password reset, sign-out, and safe return paths pass.
- Every onboarding step can be opened, changed, saved, skipped, refreshed, and resumed.
- An incomplete profile is always resumed at the first incomplete onboarding step; completing the final confirmation opens the workspace without any pass/fail judgment.
- No console errors on desktop or mobile.
- Route audit, typecheck, onboarding E2E, and browser walkthrough pass.

## Phase 1 — Weekly planning engine and real calendar

**User experience achieved:** A candidate can see exactly what this week contains, why each block exists, and what to do today—without Roadmap deciding an arbitrary study-hours target.

### Planning inputs

- Active roadmap milestone and remaining module scope.
- Preparation route: self-study, self-paced course, live classes, or hybrid.
- Class timetable and optional record of what was actually covered.
- Real availability windows, maximum sitting length, protected commitments, and one-off deviations.
- Last week's planned-versus-actual execution and learned completion ratio.
- Open diagnostic repairs and due rechecks.
- Diagnostic bank sufficiency for any proposed assessment.

### Composer rules

- Determine scope from roadmap pressure, class coverage, open repairs, and evidence—not a fixed weekly-hours prescription.
- Availability is a ceiling and placement boundary, never a required hours target.
- Start conservatively when no execution history exists; learn a personal draft fill ratio from completion evidence.
- Never schedule over protected commitments.
- Never invent a precise clock time when only a day preference is known.
- Split work by the student's maximum sitting length while preserving total scope.
- Diagnostic and recheck blocks are only proposed when the eligible item bank can deliver them.
- A diagnostic on the closing day sends repairs to the following study week.
- All generated tasks include purpose, LOS/module reference, suggested method, completion meaning, and verification intent.

### Weekly draft journey

1. `Build this week` produces a deterministic, versioned draft.
2. The student sees scope, time demand, protected commitments, conflicts, floating work, and assumptions.
3. They can make it lighter/heavier, move blocks, or change availability before acceptance.
4. Accepting the draft transactionally creates one planning cycle and its blocks.
5. Subsequent adaptations create a new revision/proposal; they never silently rewrite accepted work.

### Calendar experience

- Today, week, and agenda views.
- Clear visual layers for class, protected life commitment, study, review, diagnostic, repair, recheck, and mock.
- Always-visible floating work tray.
- Study block drawer with: what, why now, source pointer, how to approach, what done means, and next verification.
- Add/edit commitments, drag/move, resize, split, defer, partial, complete, undo, and conflict alternatives.
- Weekly review panel: planned versus completed, deviations, what rolls forward, and what is deliberately dropped.

### Verification gate

- Plan creation and acceptance are transactional and idempotent.
- No overlaps with protected commitments across timezones or recurring schedules.
- Study scope survives splitting and deferral.
- Empty, compressed, class-led, self-study, missed-week, and exam-near scenarios pass.
- Browser QA proves the accepted draft appears identically on Home and Calendar.

## Phase 2 — Action-first Home

**User experience achieved:** Opening the app answers four questions immediately: What should I do now? Why? How am I doing? What needs attention?

### Build

- Next action with working Start, Complete, Partial, Defer, and Open actions.
- Today's timeline and unscheduled work.
- Week pulse: plan load, actual execution, remaining core work, and overload risk.
- Roadmap pulse: current phase, milestone, drift, and exam countdown.
- Diagnostic pulse: next check, bank readiness, latest result, and recheck due.
- Attention queue: setup gaps, conflicts, unaccepted plan drafts, repairs, stale evidence, and missed commitments.
- Weekly close card that starts the review/adaptation loop.

### Verification gate

- Every Home action changes the same task seen on Calendar.
- No duplicated calculations or page-specific truth.
- No vanity preparedness score without a transparent evidence definition.

## Phase 3 — Diagnostic and accountability system

**User experience achieved:** Tests feel like deliberate CFA practice, reveal why an answer failed, and change the next plan only through reviewable evidence.

### Build

- Test purposes: concept check, module diagnostic, cumulative weekly, repair recheck, milestone check, and mock analysis.
- Blueprint allocation across LOS/concepts, cognitive target, difficulty, calculation/concept/application, and error-trap families.
- Exposure controls and deterministic seed rotation to prevent sampling bias and repeated target patterns.
- Three-option CFA-style construction, item-level rationale, misconception-coded distractors, confidence capture, and time-on-item.
- Deterministic numerical verification, duplicate/fingerprint checks, language/style linting, leakage checks, and human review tiers.
- Atomic scoring and evidence writing.
- Challenge flow that marks evidence invalid, recalculates summaries, and cancels dependent work with an audit trail.
- Results: score, confidence calibration, LOS/concept map, missed-detail versus misconception versus method error, SWOT, and recommended repair proposal.
- Bank sufficiency guard at test creation and at calendar proposal time.

### Content and model policy

- Schweser or CFA-aligned material may only be used when the business has the required rights and access controls.
- Store curriculum facts, LOS mappings, concepts, pitfalls, formulas, and provenance as structured internal references; do not quote or reproduce protected text in generated items or feedback.
- Use retrieval, structured prompts, deterministic validators, human review, and evaluation sets before considering fine-tuning.
- Fine-tune only on content and review labels the company owns or is licensed to use.
- Every live item must be traceable to a curriculum version and reviewed provenance without exposing source passages to students.

### Verification gate

- Statistical blueprint coverage and exposure metrics meet thresholds.
- Numerical, semantic, ambiguity, and answer-key audits pass.
- A repeated miss updates one repair thread, not duplicate repairs.
- Repeating an already answered item does not create fresh readiness evidence.
- Challenging an item rolls downstream evidence and plans back correctly.

## Phase 4 — Curriculum roadmap and deviation intelligence

**User experience achieved:** The candidate can see the entire path to the exam, the current milestone, and how real progress has changed the forecast.

### Build

- Complete CFA Level I topic → learning module → LOS/concept graph with prerequisites and curriculum versioning.
- Four exam sittings per year from verified exam-window data.
- Self-study first-pass target that normally leaves the final eight weeks for mocks and final checks, with transparent compression when the horizon is shorter.
- Class-led roadmap that follows actual teaching order while preserving prerequisite alerts.
- Coverage states separated from diagnostic evidence.
- Forecast versus actual progress, earned-ahead time, slippage, and phase rebalancing.
- Deviation events: class cancellation, extra study, missed week, vacation, illness, faster-than-expected topic completion, and changed exam window.
- Reprojection creates proposals and explains what changed; it never rewrites accepted history.

## Phase 5 — Evidence-grounded Coach

**User experience achieved:** The Coach explains the plan and proposes useful changes, but never pretends to be a curriculum tutor.

### In scope

- What should I do next and why?
- What changed after my diagnostic?
- Where are my strengths, weaknesses, opportunities, and threats?
- Should I review, re-test, repair a prerequisite, or advance?
- Help me recover from a missed day/week.
- Make the week lighter/heavier within known availability.
- Propose calendar moves and show conflicts.
- Point to the relevant module, LOS, provider, reading, class, or source pointer.

### Out of scope

- Teach an entire subject/chapter from scratch.
- Generate unsupported factual explanations.
- Claim the student is ready from self-report or task completion alone.
- Directly mutate the calendar without a proposal preview and explicit acceptance.

### Architecture

- Replace `AppState` demo messages with a server-owned conversation and action service.
- Give the model a compact, permissioned operating-state snapshot, not raw unrestricted tables.
- Use tool calls for read state, build proposal, validate conflicts, accept proposal, and explain evidence.
- Persist proposal, rationale, affected records, acceptance, execution result, and undo path.
- Apply strict prompt boundaries, output schemas, provenance labels, rate limits, and audit logging.

## Phase 6 — Settings, sources, premium boundaries, and account lifecycle

**User experience achieved:** Every planning input remains editable and premium source features do not interfere with the core product.

### Build

- Profile, exam target, preparation route, availability, commitments, checkpoint, notifications, privacy, and account actions.
- Source pointers for provider/book/course/portal/Drive references without requiring content access.
- Premium upload/processing behind an entitlement check, asynchronous job, malware/type/size validation, encryption, retention controls, delete/export, and clear copyright confirmation.
- No Materials tab.
- Email preferences and reminders with explicit delivery status.
- Account export and recoverable deletion lifecycle.

## Phase 7 — Release hardening and continuous QA

**User experience achieved:** The app remains trustworthy when data is incomplete, networks fail, schedules collide, or the student changes direction.

### Build and checks

- RLS review for every user-owned table; service-role access limited to server-only modules.
- CSRF/origin protection where relevant, input schemas, rate limits, idempotency, and safe redirects.
- Error boundaries, loading states, empty states, offline/retry messaging, and observability.
- Accessibility: keyboard navigation, focus management, reduced motion, semantic names, contrast, and screen-reader flows.
- Responsive QA at desktop, tablet, and mobile breakpoints.
- Unit, database contract, integration, browser E2E, visual regression, and production smoke suites.
- Synthetic candidate fixtures: fresh starter, self-study, live classes, hybrid, retaker, accelerated, behind plan, short horizon, and insufficient diagnostic bank.

## 5. Page ownership map

| Page | Primary question | Owns | Must not own |
|---|---|---|---|
| Onboarding | What context is needed for a useful first plan? | Initial inputs | Access control, readiness verdict |
| Home | What matters now? | Cross-product operating summary and commands | Separate calculations |
| Calendar | When will accepted work happen? | Accepted week, execution, commitments, deviations | Long-term syllabus strategy |
| Curriculum | What is the path to the exam? | Roadmap, phases, milestones, coverage, drift | Daily task mutation |
| Tests | What does the evidence show? | Attempts, item delivery, scoring, evidence, result | Silent calendar writes |
| Coach | What should change and why? | Explanations and proposals | Teaching whole curriculum, direct unreviewed mutation |
| Settings | What context and permissions can I change? | Editable inputs, sources, account | Weekly plan generation |

## 6. Immediate Phase 0 work log

Completed in the first recovery pass:

- Stabilised the onboarding parent callback so step effects no longer trigger an infinite render loop.
- Removed timezone as a visible onboarding question; it is still detected and stored for correct calendar boundaries.
- Re-established onboarding completion as the single `/app/*` setup gate after the product decision was clarified; it does not score or reject users.
- Re-ran TypeScript checks, the 62-case diagnostic verifier suite, the 69-case study-week suite, the 63-case calendar mutation suite, the 72-case roadmap suite, the route audit, and the full onboarding database E2E.
- Re-tested the live browser: the exam step advances successfully and no runtime overlay appears. The workspace gate now resumes incomplete users in onboarding.

Next Phase 0 slice:

1. Make Calendar and Tests page renders read-only; move weekly diagnostic creation into weekly draft/acceptance.
2. Replace `AppState` and legacy Coach tables with the shared operating-state/evidence model.
3. Add browser E2E that catches console overlays and verifies incomplete-onboarding access.
4. Publish the canonical route/state ownership matrix in code and delete or quarantine dead demo paths.
5. Then begin the weekly draft composer and calendar acceptance journey in Phase 1.
