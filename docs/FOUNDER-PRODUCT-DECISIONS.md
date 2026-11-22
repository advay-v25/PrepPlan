# Roadmap founder product decisions

**Authority:** canonical product-direction register  
**Last updated:** 18 November 2026  
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
- The first week is Roadmap's first week with the candidate, not necessarily the candidate's first week studying. Calibration accompanies useful work appropriate to their starting position. It is not a mandatory beginner sequence or chapter-test gate.
- The initial plan must be transparent about assumptions and use the candidate's existing preparation, evidence and upcoming commitments.
- After the first closure, use whatever first-party signals are actually available to improve the next week. One closure does not guarantee enough reported time or scored evidence for a personal pace or preparedness judgment.
- Personalisation continues to update from rolling evidence; the product must not assume one week permanently defines the candidate's capacity.

## 17. Build priority — 29 October 2026

- Defer domain configuration, Google OAuth enablement and email-delivery setup until the GitHub/repository stage, at the founder's explicit request.
- Preserve the current authentication and mandatory-onboarding protections while developing. This deferral does not authorise bypassing access checks or removing working login.
- Focus on completing and testing the student application first: usable planning, execution, Curriculum, Tests/analysis, Coach, revision, mocks and the exam journey. Do not resume external authentication/domain work without renewed direction.

## 18. Adaptive entry and complete exam journey — 31 October 2026

- Candidates must be able to join midway with uneven subject preparation, after finishing first pass, near mocks or after a break/previous attempt. Onboarding's context must affect the actual proposed plan.
- Prior coverage, reported shakiness, recorded activity and demonstrated understanding are different facts. Do not invent past Calendar tasks, time or evidence to make prior study usable.
- A completed first pass can lead directly to targeted revision, mixed assessment and mock preparation. Do not require testing every chapter before useful planning begins.
- Scheduling must account for upcoming mocks as well as the exam, changing commitments, faster/slower progress and remaining work. Time to the exam alone cannot determine that a prepared candidate is behind.
- Support users with different levels of consistency through practical next actions and honest evidence; do not classify people as lazy or promise an easy path to passing.
- Complete the shared backend, test/question-bank pipeline and feature-by-feature lifecycle audit. The implementation proposal is `ADAPTIVE-ENTRY-TO-EXAM-COMPLETION-PLAN.md`; its calibration lengths and unapproved resolution/rehearsal defaults remain proposals.

## 19. Class-pattern transition cycles — 15 November 2026

- When recurring class days change, the first affected unaccepted transition cycle closes before the next class under the changed schedule, even if that makes the transition shorter than seven days.
- Do not enforce B3's minimum-seven-day transition rule or skip the first relevant pre-class checkpoint merely to obtain a full week.
- Preserve already accepted cycles, recorded history and frozen assessment forms. Any necessary adjustment to accepted future work uses the existing explicit review/acceptance flow.
- This decision concerns the transition after a class-pattern change. Regular class-led cadence and self-study Monday–Saturday with Sunday testing remain unchanged. A shorter cycle does not justify inflating workload, fabricating a paper when scope/bank/time are insufficient, or scheduling into the past.

## 20. Deliberate Calendar exceptions — 18 November 2026

- A student may deliberately choose a longer sitting or a time outside their usual study windows after a clear one-time warning and confirmation.
- The exception applies only to that placement. It does not edit the saved sitting limit, study windows or future generated plans.
- Generated plans continue to respect the saved boundaries. Protected commitments/booked mocks, ownership, cycle/history and declared sitting order remain enforced; the warning cannot override them.

## 21. In-progress class logging — 19 November 2026

- Students may record material already covered while a scheduled class is still running. Class completion stays separate from reported coverage.
- An early log must not consume the occurrence permanently: the student can return to the same class to add or correct coverage and finalise the class later. Keep one class identity, versioned updates and retry-safe commands.
- Only explicitly reported material is used by planning and test scope. Part/continued outcome coverage remains pending until explicitly confirmed whole. A whole outcome can be reported while the broader class remains in progress; neither its timetable end nor a completed follow-up task proves other outcomes were covered.
- Incremental reports must not duplicate coverage, tasks, owed work, minutes or evidence. Preserve earlier history, accepted work and frozen papers; use the existing reviewed planning and scope-revision rules for updates.
- This supersedes the unapproved blanket rule introduced in migration `20270119_class_occurrence_authority` that all logging must wait for the scheduled class to end. Preserve its ownership, occurrence, cancellation/move, locking and replay protections when changing that rule.
