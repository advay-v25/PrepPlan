# Roadmap — remaining functional completion phases

15 November 2026. Target: the agreed full-feature private beta by 30 November, ready for reviewers before payments. This is the remaining execution sequence, not another product rewrite. `MASTER-STATUS-AND-COMPLETION-PLAN.md` remains the implementation/evidence record; the November diagnostic-beta plan and founder decisions remain product context.

## Where we are

B3 now delivers reviewed, atomic, retry-safe recovery of existing work after a class change. Preserve it. The owner review reran its 14 recovery-planner, 15 effective-date, 75 scope and 25 learning-loop checks: **129 passed**. Its endpoint, restore and browser evidence is reported in §9.39, not independently repeated in this review. The full mobile rerun and omitted second-tab variants remain final acceptance items.

The earlier browser audit completed four real entry journeys and checked the main pages. A fifth, additional browser check covered a February candidate with a finished first pass and a reported completed revision, followed by a poor external mock. That exposed a separate missing recovery capability described below.

Do not restart onboarding, the question runner, scoring, class-change recovery, note autosave or account controls. Their remaining gaps need specific changes and acceptance checks. Do not add Materials/uploads, tutoring, institute dashboards, a new scheduling service or a pass-probability score.

## Remaining work, in order

| Phase | Work package | Student-visible finish line |
| --- | --- | --- |
| 1. Reliable study blocks | Fix class-log sitting limits, elapsed capacity, split/partial provenance, study instructions, relevant same-day ordering and the approved short transition-cycle boundary. | Every generated block is feasible and explains how to work; no oversized task, expired-window placement or skipped pre-class transition boundary. |
| 2. One truth across pages and Coach | Correct exposure/completion wording, long-history reads and material read failures; capability-aware actions; completed external-mock context; language routing. | Home, Curriculum, Tests, Calendar and Coach agree, and Coach offers a useful available action. |
| 3. Useful entry and poor-mock recovery | Minimal mature-entry context, structured past mock/debrief, targeted planning from reported concerns, separate knowledge/timing/execution responses. | A student who has already studied and revised receives a practical recovery week rather than a beginner restart or generic rotation. |
| 4. Real diagnostic capability | Complete source/manifest activation, bank generation/review/level confirmation, routine/held-out depth, truthful capability counts and real-content checks. | Reviewed real content can serve declared student scopes; the software never substitutes fixtures or unapproved questions. |
| 5. Curriculum and notes workflow | Search/filter, progressive reading detail, actionable weak areas, clear coverage/evidence states, notes index/discovery and contextual return paths. | A student can find the next relevant reading, their own note or the existing repair without navigating a long catalogue. |
| 6. Page usability and Settings acceptance | Compact Home; usable mobile Calendar/mock administration; Settings overflow; field-level effects and account/export failure recovery. | Core actions are visible, settings changes have the promised app-wide effect, and narrow screens remain usable. |
| 7. Whole-lifecycle acceptance and cleanup | Same-day class identity where still missing, B4, Journey C, real/fixture-bank tracks, performance/failure/access checks and removal of verified dead paths. | The supported student journeys work through subsequent weeks, revision, mocks, last-week planning and exam-sat history, with an honest remaining-limit register. |

Phase 4's **content work starts alongside Phase 1**; it must not wait for the UI phases. Use one writer per shared feature/command. This does not authorise competing schema edits or concurrent reset suites on a shared account.

The private beta has two distinct gates: **reviewer-ready software** and **candidate-ready diagnostic content**. The first can be proven on labelled synthetic fixtures; the second requires real authorised, approved content. The last audited bank had 303 stored items and zero student-eligible routine questions. Recheck at the start of Phase 4. The 20,000-item ambition is not a substitute for usable approved coverage and is not assumed complete by 30 November.

## Phase 1 — reliable study blocks

The audit reproduced an 88-minute class consolidation for a student whose comfortable sitting limit was 45 minutes. It also saved 132 minutes on Sunday around 19:54 Asia/Kolkata, after the only Sunday window (09:00–13:00) had elapsed, describing it as comfortable.

Fix the class-log generation/confirmation path using the shared sitting and remaining-capacity contracts, then check the touched placement callers. Preserve the distinction between planned duration and reported actual minutes. Preserve partial class provenance through splits and continuations. Supply the existing objective, suggested approach, completion and verification semantics for generated class-follow-up work, using curriculum scope and practical methods rather than lessons.

Include the known B3 same-day ordering shortcut for explicitly ordered sittings: a relocation cannot place sitting 1 after sitting 2 inside one date. Do not invent prerequisites between unrelated tasks merely because they share a reading.

The owner confirmed the transition policy on 15 November: after recurring class days change, the first affected unaccepted cycle closes before the next class even when shorter than seven days. Remove the newly introduced minimum-seven-day floor; preserve accepted cycles/history and ordinary cadence. Prove a short transition does not produce gaps, overlapping cycles, inflated work or an invented assessment when no valid paper can fit. See founder decision §19.

Acceptance: reproduce both defects, show the corrected UI preview and persisted tasks, cover no-room/stale/duplicate acceptance, and retain the delivered class-recovery/weekly-continuity invariants. This phase needs no scored paper or question-bank fixtures. The first agent prompt is a separate document.

## Phase 2 — one truth and a trustworthy Coach

Close these connected issues:

- Home currently calls partial exposure “confirmed from logged work”: a full outcome plus a partial one appeared as two confirmed outcomes. Preserve exposure information, but label partial, whole coverage and evidence accurately.
- Make roadmap/milestone language match the actual planned week, or explain intentional interleaving. Do not silently impose a different syllabus order.
- Paginate/aggregate the unbounded history reads in the signals service. Test more than 1,000 events/responses and failed pages. Unknown data must remain unknown.
- Make every Coach/Calendar/Home assessment CTA consume actual startability. Coach recommended a weekly paper when neither completed scope nor the bank could provide one.
- Include completed external-mock history in the appropriate Coach context. Do not equate “no upcoming appointment” with “no mock result.”
- Fix language classification so “I finished the syllabus and revised it once” is preparation context, not a request for teaching. Keep real explain/solve requests outside scope.

Acceptance: a field-level cross-page matrix, a long-history regression, controlled read/provider failures and the exact reproduced poor-mock message in the Coach evaluation/browser checks. Preserve strict ownership and no-write-until-confirmation.

## Phase 3 — late-stage entry and poor-mock recovery

### Reproduced case

One ordinary student booked 25 February 2027, declared the whole first pass complete and reported a finished revision. In Calendar they recorded an external mock at **48%**, with notes of **FSA 35%, Fixed Income 40%, running out of time and changing right answers to wrong**.

The result persisted, but tasks stayed at 11, repair threads at zero and evidence at zero. Preserving evidence was correct; providing no planning response was the product gap. Coach replied that it could not see a mock and incorrectly declined the completed-revision statement as teaching. This was a real desktop browser/API/database check, not a future-clock or scored in-app-paper test. Its disposable student was deleted.

### Required experience

The candidate should not restart a first pass or sit chapter tests across all 102 readings. Add minimal context when relevant: whether revision is underway/completed, when it last happened approximately, any recent mocks and the next planned mock. Optional details should remain progressive and editable, with no access or feasibility verdict.

Let the candidate record a **past mock directly**, rather than inventing a new upcoming booking to attach a result to. Keep provider/date/full-or-partial scope, overall result and denominator when known, optional topic results, completion/timing problems and a few self-reported mistake categories. Support an overall score alone without pretending to know its topic weaknesses. Do not force full historical data entry or require a PDF.

Make the debrief produce an explicit **reviewable planning proposal**:

| Finding | Appropriate response |
| --- | --- |
| Low topic score with reported concept gaps | Bounded targeted review of selected readings/outcomes, followed by a suitable available check. |
| Correct untimed, weak when timed | Timed application/pacing work; do not automatically relabel concepts as misunderstood. |
| Rushed omissions, calculation or interpretation errors | A practice activity matching the reported error type and a later check of whether it improved. |
| Confident wrong answers from an in-app paper | Use valid question/concept evidence and the existing repair-thread policy. |
| High overall score but concentrated gaps | Preserve broader maintenance and focus on the actual risk areas. |
| Only an overall poor score is available | Ask one useful clarification or offer a small opt-in mixed check; no invented detailed SWOT. |
| Several poor mocks or a plateau | Inspect scope, comparability, timing and adherence before changing the strategy; do not merely add hours. |

External scores and student-selected concerns may guide study tasks **without** becoming demonstrated evidence, concept diagnoses or closed repairs. Keep their source/uncertainty visible. Link each proposed task back to the relevant report/finding. Reuse current draft/placement/receipt infrastructure; no independent mock-recovery scheduler. Show displaced accepted work and no-room items before acceptance.

Plan according to the candidate's **remaining time and commitments**, not February as a hardcoded mode:

- More runway: targeted repair plus spaced maintenance and the candidate's actual upcoming mocks.
- Final eight weeks: prioritise mock/revision/weakness follow-up; avoid restarting the entire first pass. Targeted reference reading remains legitimate.
- Two weeks left: narrow the plan to the most consequential supported or reported gaps and realistic checks; disclose trade-offs.
- Final week: consolidate, review recurring mistakes and respect existing commitments; do not automatically pile on daily full mocks or guarantee readiness.

These are planning principles, not new fixed workload percentages or prescribed mock frequencies. Ask for preferences where evidence cannot decide. Test them with coherent dated fixtures and actual commands, clearly labelled; no public clock override or fabricated scores.

Acceptance: February poor-mock entry → structured debrief → proposed targeted week → accept once → actual work → later check/debrief → next-week adaptation. Include overall-only, topic-only, timing-led, mixed-cause and repeat-poor-mock cases. Prove evidence remains unchanged for external reports, and no compulsory whole-syllabus diagnostic sequence is created.

## Phase 4 — usable diagnostic content

Reuse the existing reviewer workspace, exact-version approval, difficulty policy, verified selection, reservation and score ledger. Finish the real source-pack/manifest pipeline and batch throughput controls before increasing volume. Maintain family independence, stale-item exclusion, seen-item handling, held-out mock separation and a maximum of 90 questions per paper. A full rehearsal remains two linked sessions under the existing policy.

Measure capability by subject/reading/outcome, approved families, difficulty and per-student freshness. Test inventory exhaustion and honest reduced availability. Require a reviewer/owner action for human decisions; never auto-approve items or invent a rights basis.

Acceptance: a named real approved slice works through the complete student loop, and every unsupported area is labelled. Full-syllabus marketing remains gated on real coverage. If reviewers/content are unavailable, keep that as an explicit content blocker while finishing the software.

## Phase 5 — Curriculum and notes

Preserve working note persistence and evidence protections. Deliver search/filtering, compact subject/reading status, exact next-work/repair/result links and a useful notes index/search/return path. Add a compact place for the student's own mistake/revisit notes tied to a result or task. Keep flashcard review optional and separate from diagnostic evidence. Do not create lessons, an upload pipeline or another standalone material library.

Acceptance: a fresh, midway and revision student can find the relevant scope, record work, rediscover a note and open the existing repair/check with stable context after reload and on mobile. Exercise unsaved drafts, two-tab note conflicts and failed saves using the existing safety machinery.

## Phase 6 — page usability and Settings acceptance

Work in small page packages: Home first, Calendar second, Settings third. Home keeps one clear next action and concise progress. Calendar puts today's/this week's work ahead of future mock administration, retains a usable mobile agenda/grid and clear unplaced work. Settings keeps canonical editors and explicit save outcomes.

Fix the confirmed Settings overflow against the configured 390px viewport/client width, not only `innerWidth`, which expanded to 406 and concealed the failure. Review the concentration of first-week work into two/three days before changing distribution policy. Finish the field-level Settings matrix and browser deletion/export/reminder recovery checks from its existing brief; do not repeat the whole account implementation.

Acceptance: functional actions and correct resulting state, not screenshots alone; compact small-screen layouts, keyboard/focus/IME, clear errors and parsed downloads. Keep delivery/provider configuration separate from saved reminder preferences.

## Phase 7 — lifecycle acceptance and cleanup

First finish independent identity for two classes on one date where still missing, with legacy date-level records preserved. Then run B4's full class-led paper/result/Keep-for-later/repair/re-check/review UI journey. Run Journey C through mocks, revision adjustments, final-week planning and exam-sat history. Include the mature-entry case from Phase 3 in the final matrix.

Cover lost responses, two tabs, stale inputs, no usable windows, a break/return, work completed ahead of plan, repeated deferrals, moved exams, bank shortages, disputed items and long histories. Validate ordinary-student, incomplete-setup, unverified and cross-account boundaries. Keep actual-bank and fixture-bank outcomes separate.

Close B3's specifically omitted browser variants and rerun its complete mobile project after the CSS fix. Investigate any returning hydration error with full logs; do not waive it as CPU load. Finish the agreed Settings failure matrix.

Cleanup follows verified call sites: remove abandoned components/routes/scripts, repair links and update route ownership docs. Preserve intentional redirect/410 compatibility until callers are migrated. Do not blanket-delete old files or archive evidence backing a current claim. Reduce duplicate reads before introducing caching; prove cache invalidation if caching is added. Rehearse additive migrations through upgrade and restore and run the final project verification once on the final tree.

## Delivery rules and decisions

- One focused agent prompt and one reviewable result per work package. Each prompt states the required end-to-end outcome, affected routes/owners, invariants, failure/retry cases and finish line.
- A phase remains partial when a mandatory outcome is missing; do not describe API-only journeys as browser-proven. Consolidate the remaining acceptance work rather than starting another redesign.
- Preserve existing dirty work, register/clean owned fixtures immediately and stop only owned processes. No commits, deployment, provider provisioning, real messages or owner-account changes without the relevant request.
- Content readiness is tracked alongside software readiness. A green build does not make zero eligible questions into a diagnostic product.
- Class-pattern transition policy is confirmed in founder decision §19: close before the next class even if shorter than seven days. Phase 1 includes the narrow correction to B3's newly introduced minimum, with accepted history protected.

30 November remains the target, not evidence of completion. Use the acceptance gates to decide what is actually ready; optional redesigns, payments, domain/OAuth/SMTP setup and a 20,000-question completion claim are outside this functional finishing sequence.
