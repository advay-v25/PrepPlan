# Roadmap founder product decisions

**Authority:** canonical product-direction register  
**Last updated:** 19 September 2026  
**Rule:** Later implementation plans and code must follow this document. If another document conflicts with it, this document wins until the founder explicitly changes the decision.

## 1. Product boundary

Roadmap is an AI-powered CFA Level I structured-learning and roadmap control system. It plans, organises, tracks execution, tests, analyses evidence, identifies weak points and opportunities, manages deviations, and adapts the calendar. It does not teach subjects or chapters from scratch.

The product ships with its own verified curriculum intelligence and diagnostic capability. A student does not need to upload study material for the core product to work.

## 2. Study-week definition

### Class-going and hybrid candidates

- The recurring class pattern defines the study-week start and end.
- The weekly paper is scheduled immediately before the next class cycle begins, allowing enough time to complete it and close the week.
- A class change entered in Calendar may change the current operational week only through a visible recalculation/proposal. Historical weeks never move.
- Mixed and irregular class patterns need an explicit deterministic boundary rule in the Calendar engine. The product should derive it from the next relevant class cycle rather than asking the candidate to choose an unrelated weekday.

### Self-study candidates

- New learning and revision are scheduled from Monday through Saturday.
- The weekly diagnostic, revisionary, or mixed paper is scheduled on Sunday and closes the seven-day cycle.
- The post-paper closure produces the next plan. Sunday is a verification and closure day, not an extra new-content study day.

## 3. Weekly paper type

- When the week contains newly learned material, its verification is a **diagnostic paper**.
- When the week revisits previously learned material, its verification is a **revisionary paper**.
- If a week contains both new and revisited material, the system builds a clearly labelled mixed paper with separate diagnostic and revisionary sections and separate evidence semantics.
- The paper must only cover eligible curriculum scope. It must not test material merely because it exists in the curriculum.
- The paper is generated only when the bank can assemble a valid, unseen, quality-controlled form. If it cannot, the weekly closure must state the limitation and use an honest fallback rather than fabricate a test.

## 4. Weekly closure and next-week generation

There is no permanent “Weekly Review” navigation tab.

The weekly closure is a short contextual page/panel surfaced on Home after the diagnostic or revisionary paper is complete. Before it can generate the next week, the student is asked to complete or explicitly mark unknown all outstanding class/study/practice logs for the closing week.

Sequence:

1. The paper is submitted and scored.
2. Roadmap separates demonstrated strengths, unstable understanding, weak points, method issues, confidence mismatches, and untested scope.
3. The student completes or marks unknown any missing execution/class logs.
4. The closure compares planned work, recorded reality, paper evidence, and deviations.
5. It previews the consequences: repairs, re-checks, carried scope, deliberately dropped work, and roadmap pressure.
6. The next-week draft is generated.
7. The student reviews and accepts the draft before it becomes the active Calendar week.

An unknown log remains unknown. Roadmap must not assume a task was completed or missed merely to finish the calculation.

## 5. Readiness and progress presentation

Roadmap will not lead with one opaque readiness percentage.

### Home presentation

Home leads with the Next Action. Under it, Roadmap shows four separate signals:

1. **Curriculum position** — how much scope is not started, exposed, practised, and verified.
2. **Demonstrated understanding** — diagnostic/revisionary evidence, including sample size, difficulty mix, freshness, and scope coverage.
3. **Plan execution** — completed, partial, deferred, skipped, and unreported work for the current cycle.
4. **Confidence calibration** — where self-rated confidence agrees or conflicts with observed performance.

### Overall status

After a minimum evidence threshold is reached, Roadmap may show a plain-language preparedness band such as `Insufficient evidence`, `Building`, `Developing`, `Stable`, or `Exam-phase ready`. It must always show why and must never present a pass probability.

The initial threshold should require, at minimum:

- valid evidence across multiple curriculum scopes rather than one topic;
- more than one completed paper;
- recent evidence rather than only historical performance;
- no critical bank-sufficiency or integrity warning.

The exact quantitative model must be calibrated through evaluation and real outcome data before it is marketed as preparedness. Until then, the four transparent signals are authoritative.

## 6. Roadmap pressure language

- Use calm plan-pressure states and choices.
- Do not tell a student they are unsuitable or deny product access.
- Do not prescribe an arbitrary weekly-hours target.
- Show the assumptions behind the pressure state and offer practical choices: adjust near-term scope, alter sequencing, protect/reclaim time, move the target window, or accept a compressed strategy.
- The final exam-preparation period remains protected unless the student explicitly confirms a trade-off.

## 7. Home role

Home is a next-action operating console, not a grid of metrics.

Priority order:

1. Next justified action.
2. Anything requiring a decision.
3. Today's sequence.
4. Weekly paper/closure state.
5. Week execution and deviations.
6. Evidence signals.
7. Long-term roadmap trajectory.
8. Contextual Coach entry and quick learning capture.

## 8. Recording learning and classes

- Learning is recorded through the Curriculum experience and through a quick capture widget on Home and Calendar.
- Variable, moved, cancelled, and one-off classes are managed directly in Calendar.
- A class log captures what curriculum scope was covered, actual attendance/completion, optional duration, and mapping certainty.
- Study/activity logs are execution evidence, not demonstrated-understanding evidence.
- Uncertain curriculum mappings remain unconfirmed until resolved; the system does not guess silently.
- No standalone learning-log page needs to appear in primary navigation. A deep-linkable detailed route may support the widgets and history.

## 9. Coach

Coach retains a concise account-scoped conversation history and permanent records of proposals and outcomes, with deletion controls.

Coach may:

- explain the current plan and next action;
- identify weak points, opportunities, threats, unstable areas, and broad topics to revisit;
- point to the relevant curriculum topic, learning module, LOS, class, or approved learning-provider location;
- explain what a diagnostic or revisionary paper changed;
- propose recovery after missed work or a changed class;
- preview calendar rescheduling, validate conflicts, and execute it only after confirmation.

Coach may not:

- teach an entire subject, chapter, reading, or learning module;
- become a substitute curriculum tutor;
- invent unsupported explanations or curriculum citations;
- treat activity or confidence as mastery;
- silently change the Calendar;
- claim exam readiness or pass probability without the approved evidence model.

Coach implementation requires an end-to-end system prompt, tool contracts, response schemas, policy boundaries, adversarial tests, response evaluation sets, proposal audit trails, and regression testing. Prompt engineering alone is not sufficient; “response training” must be implemented as owned examples, evaluation rubrics, retrieval/context controls, and—only if later justified—fine-tuning on licensed or company-owned data.

## 10. Internal diagnostic operations

Item review, manifest sign-off, verifier status, generation metrics, and challenge resolution are not part of the student application.

- Remove their links from student Tests.
- Protect operational routes with explicit staff roles.
- Prefer a separate internal route group or internal application.
- Students retain a simple question challenge/report action and can see the result relevant to their own evidence.

## 11. Sources and materials

Remove the source/materials feature from the current student product:

- no Sources page;
- no Materials tab;
- no source step in onboarding;
- no “coming soon” dead-end;
- no source-dependent core planning;
- no upload claims in current product copy unless the feature is actually enabled.

The curriculum, roadmap guidance, and tests come from Roadmap's controlled internal curriculum intelligence and content pipeline. Any later student-material capability is a separate future product decision requiring rights, privacy, security, entitlement, retention, and processing design.

Internal use of third-party study material must be rights-cleared. The product must create original questions and guidance and must not reproduce protected passages. “The model knows the curriculum” does not remove copyright, licensing, provenance, or accuracy obligations.

## 12. Public demo

Provide an unauthenticated, read-only public sandbox with seeded data. It must be isolated from real accounts and cannot write to production student records. The demo should show the complete cycle: Calendar → paper → analysis → closure → adapted week.

## 13. Authentication and verification

- Email/password users must verify their email before onboarding begins.
- Google/OAuth identities are treated as verified according to the provider's verified-email claim and the configured authentication policy.
- After verification, onboarding is mandatory before `/app/*` access.
- A future paywall sits after verified identity and before or within onboarding according to the commercial trial design; it must not corrupt the onboarding state machine.
- Password reset, expired/reused links, OAuth cancellation, account linking, deletion, and safe redirects require end-to-end tests.

## 14. Legal and privacy

Before accepting real candidates, Roadmap needs jurisdiction-aware Terms, Privacy Policy, cookie/analytics disclosures where applicable, data-processing disclosures, retention/deletion rules, a named privacy contact, CFA Institute non-affiliation, no-results-guarantee language, AI limitations, and content/licensing terms.

Only active processing should be described as active. Future material upload must be labelled as future/optional or omitted. Final legal text requires qualified counsel for the launch jurisdictions; product copy must not imply that an engineering draft is legal approval.

## 15. Responsive Calendar

- Mobile: day timeline by default.
- Tablet: adaptive three-day view.
- Desktop: seven-day week grid.
- Agenda is available on all sizes.
- Floating/unplaced work is visible without horizontal hunting.

## 16. Failed first-week activation and baseline week

- A failed first-week activation shows a recoverable state with retry, input review, and support diagnostics. It never shows a fabricated 0% operating dashboard.
- The first week is a baseline-calibration week. Onboarding provides self-reported context; the first week captures actual execution, deviations, paper performance, confidence calibration, and logging behaviour.
- The initial plan must therefore be conservative and transparent about assumptions.
- After the first closure, Roadmap has enough first-party signals to personalise the second week more strongly.
- Personalisation continues to update from rolling evidence; the product must not assume one week permanently defines the candidate's capacity.
