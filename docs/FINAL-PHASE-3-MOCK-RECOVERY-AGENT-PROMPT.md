# Next build — finish three Phase 2 gaps, then deliver mock recovery

Implement this assignment end to end. Do not rebuild the working Phase 1/2 features, return another proposed sequence, or ask the owner which subsection to take next. First close Gate 0 below; then complete the Phase 3 vertical journey in the same assignment.

## Context and invariants

Read `AGENTS.md`, Ponytail, the relevant installed Next.js guides before framework edits, founder decisions, master-status §§9.42–9.43, and the Phase 3 section of `docs/FINAL-FUNCTIONAL-COMPLETION-PHASES-2026-11-15.md`. Inspect the actual current source, callers, database definitions and dirty tree. Preserve other workers' changes.

Roadmap is a CFA Level I planning and accountability product. It helps students organise, practise, assess and adapt; it does not teach curriculum content or guarantee a pass. It supports students joining fresh, midway, after first pass, after revision, and near their exam. It must not send a late-stage candidate back through a generic first-pass plan or compulsory tests on all readings.

Keep Phase 1's sitting limits, real remaining capacity, durable unallocated class work, ordered splits, atomic reviewed acceptance and short class-transition boundary. Keep Phase 2's whole-versus-partial coverage, complete histories, assessment decision and external-report context. Self-study remains Monday–Saturday with Sunday assessment; class-led cycles follow their existing class boundary. Preserve accepted history, actual minutes, frozen papers, exact-version approvals, held-out policies, access controls and repair closure.

No deployment, payments, provider/account provisioning, source uploads, question-bank expansion or automatic question approvals. A thin real bank must not stop honest planning. Use guarded fixture banks only for software proof that needs scored questions, and label that proof.

## Gate 0 — close three specific Phase 2 gaps

The owner-side review reran `phase2:pure:test` (12/0), `coach:interpret:test` (121/0) and `coach:interp:eval` (exit 0; this includes unresolved cases, so it does not prove successful model interpretation). No new live-database or browser walkthrough was run in that review.

### 0A. Preparation context must survive successful model interpretation

Source reproduction:

> I have gone through every reading and revisited everything once; what would you suggest?

`interpret()` returns `free`, `preparation:false`. A schema-valid model interpretation with `capability:log_learning`, quoted span `gone through every reading`, and no exclusions passes into `toInterpretation()` as a log request. `planLinks()` then offers “Record your study.” The existing deterministic-only tests and failed-provider tests do not cover this successful-provider path.

Fix the shared interpreter contract and runtime so preparation statements/paraphrases can be represented as planning context, without becoming a study log, coverage edit, calendar mutation or teaching request. A small validated context field or equivalent existing-contract solution is sufficient; do not build another interpreter service or solve the whole issue by adding only the exact reproduction to a regex list. Version any changed prompt/schema and preserve historical turn replay.

Keep an explicit “please record today's study of reading X” request distinct. A mixed message can contain preparation context plus a genuine move/result request; do not erase the latter. Preserve negation, correction, exact numbers/dates/IDs, teaching boundaries and confirmation requirements.

Test a successful valid model response, misclassification, ambiguous context, negated preparation, mixed requests, and disabled/slow/malformed/unreachable providers. Assert the rendered reply and canonical links, as well as zero unintended task/evidence/coverage writes. Do not claim that provider wording changed persistent preparation state.

### 0B. Bound context loading and stale-turn completion

`runTurn()` awaits `loadCoachWorld()` without a deadline. The model gateway bounds model work, but not this context-loading stage. The reported 84-minute world stage must not be explained away as machine sleep without evidence.

Use the smallest existing-compatible request/stage budget, cancellation and lease/fencing solution. Bound database/network reads used by the Coach, return a clear retryable outcome with the question preserved when essential context is unavailable, and retain usable optional sections where safe. Do not substitute zeros or invent a plan to meet a deadline.

A timer race alone is insufficient if abandoned work can later write proposals or complete an expired/replaced turn. Abort underlying reads where supported, discard late results, preserve existing command fencing, and ensure a retry with the same turn key cannot create another student message/proposal. Confirmation writes must retain their own transactional outcome: a lost response is not proof that nothing committed.

Prove an indefinitely delayed world loader, delayed database read, late completion, lease expiry, duplicate retry and suspend/resume or equivalent simulated elapsed-time jump. Show recovery in the browser. No public clock/failure bypass. Measure server stage time separately from browser/environment suspension. Do not promise JavaScript timers run while a machine is suspended.

### 0C. Show Calendar read failures

`calendar/page.tsx` currently converts a failed `getSignals()` to null and hides the strip. Replace silent disappearance with a compact unavailable/retry state while preserving the readable calendar. Keep known zero, bank unavailable, not requested and failed read distinct.

Prove a controlled failed later history page produces that visible state and recovery restores the actual numbers. Do not make the whole Calendar unavailable or add another dashboard panel.

**Gate 0 finish:** focused regressions pass, controlled provider success/failure behave consistently, the timeout/retry journey is usable, and the Calendar failure is visible. Preserve Phase 2's working proof. Then continue below without waiting for another owner approval.

## 1. Deliver the real student journey

Required primary case:

> A candidate targets February 2027, has finished the first pass and revised once, and reports a recent mock at 48%, FSA 35%, Fixed Income 40%, running out of time and changing right answers to wrong. They have work/classes and limited available study windows.

The student records an already-taken mock directly, gets an honest debrief, reviews a targeted proposal for their current week, confirms once, finds executable sittings in Calendar, records actual progress, and sees a later check/debrief inform the next week. Do not restart first pass, prescribe extra hours or require chapter-by-chapter calibration before helping them.

Build by remaining time and actual preparation context, not a hardcoded February mode. Preserve existing ordinary planning for fresh and midway candidates.

## 2. Capture a past mock without inventing a booking

Reuse Calendar's checkpoint/report experience and canonical services. Add a clear “Record a mock already taken” entry, reachable from Calendar and an appropriate Tests/Coach action. Do not require creating an upcoming appointment first.

Minimum input: date taken and enough result information to be useful. Support an overall score only; optional provider/label, full versus partial scope, topic results and reported difficulties. Keep progressive choices concise, with optional notes. Do not require a PDF or complete historical reconstruction.

Validate results structurally: percentages versus marks/counts versus percentiles are different. Store the scale/denominator when known, preserve an unknown scale honestly, reject impossible values, and never average unlike scales. Topic results may be missing; they do not need to sum to the overall result. A partial exam must not be represented as a full mock. Preserve the existing two-session in-app rehearsal and its combined-count score ledger.

Use the existing owner-checked command/idempotency pattern for create/edit/delete or withdrawal. A reload, double click, lost response or second device must not duplicate a report. Changing a report invalidates dependent unaccepted previews; it does not silently rewrite an accepted week, a scored in-app attempt or historical evidence. Keep enough source/version provenance to explain the relationship.

For old free-text mock reports, preserve original text and unknown fields. Offer optional confirmation of structured details; do not silently parse them into trusted measurements or fabricate missing topic scores.

## 3. Debrief facts separately from hypotheses

Each finding must identify its source, supported scope, uncertainty and planning implication:

| Input | Appropriate response |
|---|---|
| Overall low score only | Explain the limit; ask one useful clarification or offer an optional suitable mixed check. No invented topic/concept diagnosis. |
| Reported low FSA/Fixed Income score | Let the student select relevant readings/outcomes for targeted review. Do not assume every reading in the subject is weak. |
| Rushed omissions or running out of time | A pacing/application activity, without automatically labelling concepts misunderstood. |
| Reported answer changing | An activity to record why answers changed and review that pattern; no universal “never change answers” rule. |
| Actual confident wrong in-app answers | Existing valid concept evidence and repair-thread rules. |
| Correct but slow | Timed application within the existing practice policy; do not equate speed with ignorance. |
| High overall score with concentrated gaps | Maintain strengths and target the identified gaps. |
| Several poor mocks/plateau | Compare scope, scale, provider, timing and adherence first. Non-comparable reports must not produce a fabricated performance trend. |

External reports and student concerns may drive planning, but must not create demonstrated evidence, concept verdicts or closed repairs. Keep these review tasks distinct from evidence-backed repair threads. Free-text notes are user data, not model instructions. Guidance names activities and curriculum scope, not lessons or copied course material.

## 4. Propose an achievable recovery week

Reuse existing draft/composer/placement/receipt infrastructure. Do not create a separate recovery scheduler or automatically place an LLM-written plan. Deterministic commands own feasibility, ownership and mutations; the model can interpret or explain a verified proposal.

A proposal must show:

- Exact report/finding provenance, selected curriculum scope, why this activity, a concrete approach, what counts as done and what later check could evaluate it.
- Sittings within the current limit and actual remaining contiguous capacity, around classes, work, commitments, mocks, elapsed time and the exam boundary.
- Existing started/protected/partial work retained appropriately; existing open repairs and equivalent tasks deduplicated by identity, not title.
- Any accepted work that would move or be set aside, and anything that will not fit. Never silently sacrifice work or overload the week.
- Current-week versus next-week handling. A report recorded at the end of a cycle must not create past-dated work or break the weekly review.

Use one explicit acceptance command with stale checks, lock ordering, atomic rollback and retry receipts. Refused/stale proposals keep the student's input. Declining a proposal changes no work. A proposal that partly fits must disclose the remainder and preserve it through the existing durable obligation/review mechanism; avoid creating another untracked backlog.

An accepted recovery week must open actual Calendar sittings with useful drawers and exact reading/report links, not merely a Coach message describing a future plan.

## 5. Adapt by runway and actual progress

| Situation | Required behaviour |
|---|---|
| First pass/revision complete, several months left | Targeted review plus spaced maintenance and the student's chosen mocks; no first-pass restart. |
| About a month to the next mock | Build a realistic review–application–check sequence, protecting the actual mock slot. |
| Final eight weeks | Preserve the existing mock/revision focus. Targeted reference reading is legitimate; a new whole-syllabus first-pass programme is not. |
| Two weeks remaining | Narrow priorities, disclose trade-offs, and keep checks proportionate to the available time. |
| Final week | Consolidate recurring errors and existing commitments; no automatic pile-up of full mocks or pass guarantee. |
| Midway first pass, some subjects shaky | Continue unfinished work while adding bounded review of reported/supported gaps. |
| Work finished ahead of plan | Avoid duplicate scope; offer an explained update for review. |
| Partial/missed/repeatedly deferred recovery | Preserve actual time and continuation history; adapt placement and method without calling it a wrong answer or moral failing. |
| Break/return or changed exam target | Re-evaluate remaining time with the canonical editor and stale-preview safeguards. |

No invented workload ratios, compulsory mock frequency or readiness thresholds. Use existing policies and ask only the useful preference/clarification that evidence cannot resolve. Planning should work even when a student has poor adherence or cannot provide detailed histories.

## 6. Complete the accountability loop honestly

After accepted work, use an appropriate available in-app check or a later external practice/mock debrief. The student can report completion and concerns; that alone cannot close an evidence repair. If inventory is inadequate, show the limitation and offer a non-evidence follow-up using their own study/practice; never manufacture scores or auto-approve questions.

Test the learned/unlearned boundary: an external full-mock result does not automatically mark all outcomes covered, and a proposed check cannot ask unconfirmed or pending class portions under a scope that forbids them. Preserve re-check spacing, freshness/family independence and the 90-question ceiling. Scored fixture journeys must use approved/versioned test-only inventory.

Weekly review must incorporate the actual work, remaining obligations and new report/check observations, not repeat the original recovery plan blindly. Keep historical weeks and reported minutes in their original cycles. Editing/withdrawing a report must leave a clear explanation for associated accepted tasks and allow reviewed adjustment; do not silently erase history.

## 7. Routes and linkage

Inventory actual current commands before editing. Prefer existing routes; document every new route and its callers if an addition is necessary.

- `/app/calendar`: past-mock entry/report, booked mock, accepted recovery tasks, unplaced work and exact task/report deep links.
- `/api/checkpoints` and `checkpointService.ts`: inspect the current appointment/outcome/version/receipt model before extending it for independent past reports. Preserve booking conflicts and historical appointment links.
- `/app/tests`: appropriate check availability, preflight, owned resume/result and honest insufficient-bank path. Use the shared assessment decision.
- `/app/coach` and its turn/proposal handlers: read the exact selected report/result and offer the verified reviewed proposal; contextual conversation alone makes no coverage/calendar write.
- `/app/curriculum` and exact subject/reading pages: distinguish reported concern from demonstrated weakness and link to the accepted work/report/check.
- `/app`: concise next accepted action and accurate progress, not another large dashboard section.
- `/app/review-week`, `/api/weekly-review/{state,preview,accept}`: unfinished work, follow-up and next-week adaptation.
- Canonical onboarding position/exam/week editors used by Settings: preparation context and actual constraints, with existing setup versions. No duplicate editor or forced re-onboarding for a late entrant.

Keep one source of truth and server-owned access. No new OperatingState version, hidden calendar mutation or client-trusted owner/source/evidence flags.

## 8. Required proof and finish line

Build and test in vertical slices, then deliver the complete assignment:

1. Gate 0 successful-model context tests, never-resolving/late context reads, same-key recovery/fencing, Calendar failed-page visibility and recovery. Repeat the relevant Phase 2 matrix fields with exact expected changed/unchanged values rather than relying only on page renders.
2. The primary 48% candidate through **browser-driven past-report entry → debrief → scope choices → proposal → accept → Calendar drawer → partial work → reload → later check/debrief → weekly adaptation**, desktop and 390px. Fixture setup of exam/clock/inventory is allowed when recorded, but the product actions above must be clicked, not seeded and called browser proof.
3. Overall-only, partial exam, topic gaps, timing-only, answer-changing, repeat-low non-comparable scores, high overall/concentrated gap, midway first pass, no availability, no approved bank, late Sunday/class-boundary report, final two weeks and final-week scenarios.
4. Atomic failure, double accept, lost response, concurrent report edit, stale availability/exam/commitment, unrelated report edit, foreign report/proposal and replay tests. Prove no duplicate task/effort/attendance or cross-account access. External-only journeys leave demonstrated evidence and repair closure unchanged.
5. Verify scoped links, keyboard/focus, mobile width, refresh, console/hydration and visible failed-save/read recovery. Use Browser when available; otherwise record Playwright fallback.
6. Run focused tests while editing. On the final relevant tree, run affected Phase 1/2 regressions, project verification and TypeScript. If SQL changes, use additive checked migrations and current deployed definitions, permissions/rollback/race proof, upgrade and restore rehearsals. Never edit an applied migration or overwrite later patches from an old SQL body.

Register resources at creation; clean exact owned student/fixture IDs on success/failure, stop only recorded owned process handles and restore generated declarations. No shared-account resets, broad deletes, commits, pushes, real emails or deployment.

Update master status with requirement → implementation → proof, source/migration fingerprints, exact commands/counts, actual versus fixture inventory and browser evidence. Distinguish creation through the UI from seeded setup. A green simulated provider evaluation is not proof of a successful live model call. Keep real-bank/content readiness separate.

**Done means Gate 0 is closed and the full recovery loop works.** Do not stop after storing a score, showing a Coach explanation, generating unaccepted draft tasks or proving only the happy-path endpoint. If an essential check is externally blocked, report the exact incomplete requirement rather than calling it complete. Do not claim universal bug-free operation or whole-app production readiness.
