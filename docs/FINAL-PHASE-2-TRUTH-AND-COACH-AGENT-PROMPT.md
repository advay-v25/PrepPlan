# Phase 2 — consistent progress, honest assessment actions and a trustworthy Coach

Implement this bounded next phase end to end. The owner wants useful features that agree with each other, not another new architecture or a larger dashboard. Do not stop at a plan or ask which subsection to build next.

## Read first and preserve

Read `AGENTS.md`, Ponytail, the relevant installed Next.js guides before framework edits, founder decisions, the latest master-status sections and `docs/FINAL-FUNCTIONAL-COMPLETION-PHASES-2026-11-15.md`. Read the Phase 1 closeout added by the owner-side worker, including its actual verification limits; do not rely solely on §9.41's earlier DONE label.

Phase 1 provides feasible class-follow-up sittings, durable unallocated obligations, explicit split identity/order, reviewed atomic acceptance and short class-pattern transition cycles. Preserve those invariants. Existing accepted weeks/history, reported minutes, frozen papers, exact-version item approval, repair closure and access controls must not change as a side effect of this phase.

Roadmap is a study organisation and accountability product. The Coach can explain the student's plan and observations, suggest study methods, identify supported weak areas and propose calendar changes for review. It cannot teach a chapter, solve curriculum questions, invent diagnoses, guarantee a pass or silently change the student's schedule.

No uploads/sources feature, paywall, provider provisioning, deployment, new readiness percentage, Coach retraining programme or independent planning engine. External mock recovery proposals belong to Phase 3; this phase makes the saved reports visible and interpreted correctly.

## Current source findings to reproduce

Reinspect these current files and their callers; some may have changed concurrently:

1. `src/lib/signals/signals-loader.ts` combines class exposure and whole confirmed work into `exposedOutcomes`. Its class-item query omits extent. `src/lib/state/progressSummary.ts` then labels all exposed outcomes as “confirmed from logged work.” One whole outcome plus one part must not become two whole confirmations.
2. The signals loader reads attempts, responses, evidence and class items without complete pagination, ignores several read errors, and fetches item IDs in an unbounded `in` query. A mature student can receive silently truncated or falsely empty summaries.
3. `src/lib/signals/coachPack.ts`, `src/lib/coach/actions.ts`, `src/lib/state/assessmentControl.ts`, Tests decisions and Home's bridge all influence assessment wording. Trace the real consumers before changing one. The Coach must not offer to start an assessment that the authoritative preflight refuses.
4. The current Coach snapshot emphasises a next appointment. A completed external mock must remain discoverable even when there is no upcoming appointment.
5. Audit the exact message “I finished the syllabus and revised it once” through deterministic interpretation, the optional model interpreter, context construction and the rendered reply. Preparation context must not be treated as a teaching request or silently recorded as a confirmed coverage edit.
6. Compare Home's active milestone/trajectory language with the accepted Calendar week. Interleaving is legitimate; unexplained contradictions are not.

Capture a focused failing assertion or reproducible browser/API observation for each confirmed defect before fixing it. If an old claim is already fixed, prove that and preserve the fix. No reverting the dirty tree to manufacture failures.

## 1. Separate the facts behind progress

Reuse the current Signals/OperatingState contracts and shared readers. Add only the minimum fields necessary to distinguish:

- **Reported position:** the student's broad starting coverage and revision context. This is self-report.
- **Partial exposure:** a class covered only a part, or coverage remains unresolved. This does not confirm the whole outcome for a paper.
- **Whole scope confirmed:** the explicit whole-outcome coverage that the existing scope engine accepts. This determines eligible completed scope, subject to the assessment's other rules.
- **Execution:** planned, completed, partial, deferred, unreported and unallocated follow-up work. Postponement changes planning, not question accuracy.
- **Demonstrated understanding:** valid eligible assessment evidence, with observations, recency and dispute/void status. Practice and external self-reports do not become this evidence.
- **Confidence calibration:** the existing confidence-versus-correctness measure with its actual denominator and minimum sample. Do not infer confidence from time spent or task completion.

Home, Curriculum, Tests, Calendar and Coach must use consistent definitions, even when each shows fewer details. Do not replicate the whole scope reducer in every page. Avoid double-counting a class item, split sitting, manual confirmation and continuation that describe the same covered outcome.

Keep summaries compact. For example, distinguish “1 whole outcome confirmed; 1 partially covered” rather than adding several new Home cards. Do not call an outcome mastered because it was logged, or label a partially covered reading wholly complete. A first-pass-complete self-report remains a self-report; do not require 102 historical chapter tests to preserve that position.

Update DTOs, reducers, serializers, callers, empty/error states and tests together. Unknown/unreadable data remains unknown; zero is a measured value, not an error fallback. Preserve existing historical score semantics.

## 2. Make mature histories complete and reliable

Trace the actual readers supporting these signals, including nested study-activity/LOS evidence readers where they can truncate the same answer. Reuse the existing deterministic `readAll` helper or an appropriate scoped database aggregate. Batch large identifier lists and use a stable unique ordering for every page.

Requirements:

- More than 1,000 responses/events/class items must produce complete, deduplicated counts. Evidence across several papers and split/continued work must remain correctly attributed.
- A failed later page, profile read, cycle read or required join must not turn into “no activity,” “no papers” or an inflated confidence result. Fail the affected section clearly, keep unrelated sections usable where the current integrity contract allows, and provide a retry.
- Practice, held-out restrictions, challenged/voided questions, legacy forms and external mock reports retain their current evidence policies.
- Use owner-scoped reads throughout. Share duplicate reads within a request; do not introduce cross-request caching without demonstrated need and correct invalidation.
- Measure query/read counts and latency on an ordinary account with realistic history before and after. Optimise repeated reads before adding infrastructure. Never remove evidence or lower correctness to improve timing.

Prove this with real paginated fixtures, a failed-second-page negative control and exact expected totals. Report the history size and counts, not merely “pagination tested.” Keep fixture records separate from actual-bank capability.

## 3. One assessment decision for every action

Consume the existing authoritative assessment decision/preflight, including startability, pending coverage, timing/due status, inventory, active reservation and repair spacing. Do not add a separate Coach eligibility heuristic.

Use truthful actions:

| State | Expected action |
|---|---|
| Pending whole-scope confirmation | “Confirm what you covered,” linking to the exact existing scope section. |
| No completed eligible scope | Explain what is missing; offer logging/Calendar. No invented paper. |
| Eligible scope but insufficient approved/fresh inventory | Explain limited availability and continue planning. No “Start paper” promise. |
| Available early, not due | Label it upcoming/available early; preserve the owner's current priority rules for today's work. |
| Due and startable | Link to the correct preflight/start experience; server reservation still revalidates. |
| In progress | Resume the owned attempt, not a new paper. |
| Scored | Open the exact result. |
| Repair work unfinished or spacing not elapsed | Explain the actual prerequisite/date from server state; never bypass it. |
| Eligible re-check | Open the exact scoped re-check action. |

Reach Home, Calendar task controls, Tests, Coach suggestions, selected-object replies and deterministic/model fallback responses. Preserve strict reservation, freshness and 90-question limits. A link explaining availability is allowed; labelling it as a startable paper is not.

Opening these pages or asking a read-only Coach question must create no tasks, attempts, evidence or scope confirmations. Calendar mutation still requires a reviewed proposal and explicit confirm, with current lock/revision/idempotency guarantees.

## 4. Give Coach real context without making it a teacher

Use compact server-owned context with clear provenance. Include separately the next planned mock, the latest completed external mock/report, and the latest relevant in-app result when present. “No upcoming mock” does not mean “no mock history.” Do not discard a completed report because its appointment is no longer upcoming.

Keep external overall/topic scores, self-reported timing problems and notes labelled as reported. They may justify a contextual planning discussion, not concept-level evidence, repair closure, precise causal claims or a pass probability. Do not extract a claimed topic diagnosis from an overall score alone. Link to the exact saved appointment/debrief/result using current verified routes; handle deleted/foreign objects honestly.

Required message set includes:

- “I finished the syllabus and revised it once.”
- “First pass done, mock in a month; how should I organise revision?”
- “My February mock was 48%; FSA 35%, Fixed Income 40%. I ran out of time and changed right answers to wrong.”
- The same situation without topic scores, and without an upcoming booking.
- “Teach me derivatives” versus “Teach me how to organise my derivatives revision.”
- A mixed message asking for both planning and a curriculum explanation.
- Negations/corrections: “I haven't finished revision,” “not this task, the second one,” and a hypothetical missed week.
- Typos and natural paraphrases, while keeping numbers, task IDs and dates unchanged.

Handle planning language and stated preparation context correctly. A conversational statement must not silently update coverage, revision status or the calendar. If an update is needed, open the canonical editor or ask a concise clarification. For mixed requests, answer the planning portion and explain the teaching boundary briefly.

The model may interpret/reword within the existing validated contract; it does not own permissions, links, dates, scores or mutations. Disabled, malformed, slow and unreachable provider paths must leave the same factual state and permissible actions. Keep bounded latency and deterministic fallback. No live provider success claim based only on simulated output; if a configured live call fails, capture a redacted diagnosis and show the working fallback separately.

## 5. Explain the actual week and actionable refusals

Trace accepted tasks, current roadmap/milestone, projection and available revision context into the displayed summary. Name the difference between the longer-term milestone and this week's accepted work. Explain deliberate interleaving or carried work using recorded provenance; do not rewrite the plan to make a label look consistent.

If a Coach move is refused because it breaks declared sitting order, give the student a useful explanation and a Calendar link to the affected task/sitting. Preserve the authoritative refusal and no-write outcome; do not bypass the constraint or invent a new placement automatically.

Keep unallocated class follow-up visible and separate from completed/confirmed scope. Preserve the Phase 1 short transition and exact task-date deep links, including historical/continued task destinations.

## Routes and connections to verify

Inventory the actual current handlers before editing. At minimum inspect:

- `/app`, `/app/calendar`, `/app/curriculum` and its subject/reading routes, `/app/tests`, attempt/result pages and `/app/coach`.
- `/api/signals`, the current Coach turn/proposal/confirm handlers, assessment scope/preflight/start handlers, and existing task movement commands.
- `signals-loader.ts`, `signals.ts`, `coachPack.ts`, `operatingBridge.ts`, `progressSummary.ts`, OperatingState and current Coach service/actions/interpreter/validator/context readers.

Keep one source of truth per concept; do not introduce OperatingState V3, a second roadmap, a parallel assessment eligibility engine or another scheduling command. Preserve intentional compatibility redirects/410s. Repair affected links and remove only obsolete code whose callers have been migrated.

## Mandatory acceptance and delivery

1. Create a field-level matrix comparing Home/Calendar/Curriculum/Tests/Coach after: partial class coverage, explicit whole confirmation, partial sitting, rollover, scored paper, void/dispute, zero bank, and completed external mock with no next booking. Distinguish genuinely browser-driven actions from setup done through fixtures/API.
2. Prove complete long-history reads, bounded identifier queries, a failed later page, duplicate scope sources and unknown-data behaviour. Check owned and cross-account access for affected routes.
3. Run focused interpretation/action evaluations on the messages above and controlled provider failures. Verify zero unintended writes and links to actual owned objects. Include the exact poor-mock message in the browser.
4. Browser at desktop and 390px: log a partial → Home/Tests agreement → whole confirmation → updated agreement; ask Coach about a saved external mock with no upcoming booking; exercise unavailable-bank action, resume/result routing on guarded fixtures, and an ordered-move refusal. Check keyboard/focus, reload, width and unexpected console/hydration errors. Use Browser when available, otherwise record the Playwright fallback.
5. Run affected signal/Home/scope/Coach suites and relevant Phase 1 regressions after the final change, then `npm run verify` and TypeScript. If SQL is necessary, inspect effective deployed definitions, use additive migrations with ownership/ACL and transaction proof, and run upgrade/restore rehearsals. No applied-file edits.
6. Record exact commands, exit codes, fixture versus actual results, source/migration fingerprints and evidence paths. Update the next master-status section with each requirement → implementation → proof. Identify any external limitation honestly.

Own and register every fixture/student/server at creation, clean exact IDs on success/failure and restore generated declarations with the existing helper. No shared-account resets, broad deletes, unrelated dirty-tree reversions, commits, pushes, deployment or real emails.

Finish all required Phase 2 outcomes before returning. A mandatory unrun journey or unresolved correctness defect means `Phase 2 incomplete`, with the precise reason. Full mock-recovery planning remains Phase 3; question-bank publication remains a separate content gate. Do not call the entire app ready because these software checks pass.
