# Roadmap — B2: finish the class-led user journey

Prepared 14 November 2026 after master status §9.34. This is a closeout of Journey B, not a new phase of product design.

## Assignment and boundaries

Finish B's browser-driven onboarding, assessment/result/follow-up/review path and the remaining class-change functionality. Preserve the 31-step endpoint journey, the fixed regression scripts, generic Re-verify deduplication and class-log failure handling. Do not repeat the entire previous brief or start Journey C.

Read `AGENTS.md`, Ponytail, founder decisions, the B prompt and §9.34. Read installed Next.js guidance before framework changes. Reuse the existing browser runner, ordinary-student helpers, command receipts, assessment decisions and class-cycle policy. No new planner, scorer, tutoring, production clock bypass or question-approval shortcut.

Settings closeout is running separately. Do not edit account/export/reminder/Settings files or take over its setup concurrency/classes-finished work. B owns class logging, occurrence/series editing, accepted-work recovery, assessment scope and its browser journey. Coordinate before changing shared occurrence metadata or setup APIs; never apply another worker's pending migration blindly. No commits, deployment, real messages, real account deletion or changes to the owner's data.

## 1. Review outcome and proof boundaries

Accept the delivered endpoint core as meaningful fixture-bank proof. Browser B remains partial: `journey-b.spec.ts` explicitly seeds onboarding through the API and omits the class-led paper/result/Keep-for-later/repair/review UI. Reusing A's components is not proof that class-led dates, scope and links reach them correctly.

The owner-review pass reran:

- `pulse:weekboundary:test`: 35 passing;
- `pulse:generate:test`: 14 passing;
- `classlog:test`: 51 passing.

These 100 focused checks passed. The review did not rerun database or browser journeys.

Keep fixture proof separate from real content capacity. The handoff says B/C were not run on the real bank in this pass but also lists a limited actual-bank control; resolve that wording using the recorded command/evidence, without treating the control as a scored actual-bank journey.

## 2. Close scope/mapping gaps without building a new AI importer

The class-log API accepting outcome IDs is normal. Use the existing curriculum picker to let a student identify the reading/outcomes and explicitly review the proposed coverage. Do not require free-text syllabus typing or a new material-upload/mapping model.

If the student is unsure, do not choose an outcome for them or mark the class missed. Keep their class/date/selection draft recoverable and show what still needs confirmation. Unconfirmed coverage must not enter a paper, finish a reading or create mastery. Reuse an existing pending/draft path if available; add only the minimum durable state if reload-safe recovery genuinely needs it. No scope/evidence mutation from merely opening the form.

### A partial LOS is not automatically safe question scope

The fixture currently attaches the note “basic EPS only” to `r028-b`; the seed mapping associates that outcome with expense recognition/depreciation and EPS with `r028-d`. Check the current canonical catalog rather than relying on those labels. Fix the fixture to use the correct actual outcome/concepts and assert its semantic mapping. The current test proves note persistence, not content-grounded portion selection.

Trace a bounded partial through `class_session_items`, completed scope, allocation and assembly. Currently the scope reader does not carry the portion note and the target is outcome-level with a reduced weight. Fewer questions from a whole LOS do not guarantee they test only the learned portion.

Add two concepts under one outcome to the fixture: one confirmed studied and one explicitly not studied. Prove the paper cannot select the unstudied concept. Use verified concept mapping where the current model supports it. If the portion cannot be represented safely, keep that portion visibly pending/not yet testable and test the remaining confirmed scope; do not silently assume full coverage or stop planning access. Never use a free-text note or model guess as authoritative evidence that arbitrary questions are in scope.

Preserve the established full/partial effort and weighting policy where applicable; this correction enforces the founder's “only what was done/confirmed is tested” rule, not a new scoring or repair-closure policy. Update preflight, scope revision and reservation consistently if the represented scope changes. Report which partial-scope cases remain unsupported instead of claiming universal granular coverage.

## 3. Finish occurrence-versus-series editing and recovery

The backend already distinguishes `scope:'occurrence'` from series edits. Finish the actual user flow in Calendar:

1. Open a specific class and clearly choose “This class only” versus the supported recurring-series operation. Do not silently modify an entire series when one occurrence was meant.
2. Preview actual dates/times, changed protected time, affected unfinished accepted work and any prospective cycle/paper effect. A single moved/cancelled occurrence is not automatically a new recurring class pattern.
3. Confirm through the canonical commitment/exception command with current ownership, conflict and stale checks. Preserve historical attendance/logs and completed/partial work. Do not delete old cycles or move reported minutes.
4. Show a real action to review/recover affected accepted work. Reuse the existing current-week draft/recovery flow; a generic warning or link that cannot address the affected work is insufficient.
5. A lost response or repeat confirmation returns the same durable outcome. A changed class/booking after preview refuses without partial changes and retains input.
6. Undo/restore respects newly occupied protected time and mocks. A restore that now conflicts must refuse clearly and leave the exception intact. Do not override a real-life commitment simply to fit study.

Test one moved occurrence and one recurring-pattern change. Assert which current accepted cycle remains fixed and which subsequent cycle uses the new pattern. Tue/Thu remains Tue–Mon with Monday verification under the existing policy; Sat/Sun has Friday verification. Do not introduce another class-boundary algorithm or change classes-finished semantics owned by Settings.

## 4. Complete the B browser flow on one student per viewport

Expand the existing B spec rather than duplicating all of A. Use separate ordinary students at desktop and 390px. Drive these through the actual UI:

- **Onboarding:** booked May 2027, midway first pass, three covered subjects, explicit uncertainty in two, Tue/Thu classes, realistic work/commute windows and sitting limit. Reload midway and assert saved state. No API-created persona replacing this step.
- **Class log:** mapped full and bounded-partial work, uncertain selection recovery, preview, material stale refusal, retained input, successful confirmation and post-commit lost-response replay. Missed/cancelled classes add no learned scope.
- **Preparation and diagnostic:** complete/confirm actual taught work, inspect the paper purpose and reviewed scope, start, enter representative answers with required confidence, refresh/resume and submit. Remaining answers may use the real answer API, explicitly labelled; no pre-seeded scored result.
- **Result and Coach:** selected class-led result, correct source and no teaching/pass claim, actual Keep-for-later control, navigate away and rediscover the same follow-up. A preview that is merely left unaccepted is not the Keep-for-later UI action.
- **Repair and Calendar:** preview/accept once, open the exact task, verify intended scope, report completion. An early re-check remains unavailable. Complete an after-spacing start on this B student using coherent dated fixtures and the real command, with unused families and correct concept links; do not borrow A's result as proof.
- **Review:** resolve required logs, use the scored-paper gate, save/review/accept the next class-led cycle, replay acceptance and verify history and the prospective pre-class paper. No no-paper acknowledgement fallback masking missing credit.
- **Revisionary and mixed work:** drive a revision class and inspect/start its revisionary preflight, then include new learned scope and inspect/start the mixed-paper preflight. Preserve provenance, not just the label. These can be compact follow-on UI steps with endpoint persistence checks.
- **Class change and recovery:** exercise the occurrence/series path from section 3, not merely add protected time through another tab's API.

An active provider failure is different from returning 503 for the entire Coach route. Use a controlled failing provider behind the actual gateway on an owned local test instance: clear deterministic requests still work, and genuinely unresolved mutations clarify without a guessed write. Do not add a public production failure flag or alter another worker's provider configuration.

Drive exact-date/time or morning-window Coach movement and Calendar drag where the app exposes it. Assert the task's actual selected date/time and durable receipt after reload. Keyboard/focus/IME and long labels must be checked during these interactions, not called proven because controls exist.

Retain the narrow console/request checks, but make expected-failure allowances active only for the deliberately injected operation/time/status. Do not permanently ignore all Coach/class-log request failures throughout the test. Test cleanup, failed required steps and `complete` reporting at both viewport sizes.

## 5. Small completeness and regression controls

- Add an explicit reading/subject baseline check chosen by the student. It must remain separate from the weekly paper's completed-cycle scope and credit. Prior coverage claims do not silently turn it into a compulsory baseline on every chapter.
- Prove the 90-question ceiling and visible remaining-scope/further-paper trade-off on a sufficiently sized fixture. This can be a focused endpoint test; do not make the core browser user answer 90 questions merely to assert the limit.
- Keep diagnostic, revisionary and mixed assembly tied to confirmed scope. Never fill an inventory gap with uncompleted concepts or other readings.
- Restore the deleted A evidence-negative-control artifact by rerunning its guarded command, record its expected failing exit and retain the evidence. Do not reconstruct a fake historical result. Run A mobile once on the final shared test-helper state, since its setup/cleanup/console hooks were changed; do not repeat every A suite after every B edit.
- Rehearse clean install and upgrade of 20261219/20 using the existing isolated Postgres/baseline helpers. Create the small missing rehearsal if needed; “no rehearsal exists” is work to do, not proof of a blocker. Report an actual environment limitation only after trying the available helper. No remote drop/recreate or edits to applied migrations.
- Fix eligibility-count pagination in `scripts/lib/bankMode.ts`: it reads eligible IDs without pagination. A 20,000-item future bank must not be measured using only the first API page. Use existing paginated readers or proper counts, preserving routine/held-out/current-version approval semantics. Fixture mode must validate current usable inventory, not status `reviewed` alone.

Keep the new unstable-concept deduplication. Test the cross-page/rollover effect once: one repair workflow owns verification for the concept, other concepts remain independent and no old unstable event reintroduces duplicate work after newer supported evidence. Do not change mastery or repair-closure thresholds.

## 6. Evidence, coordination and finish line

Use existing guarded fixture banks and current-version publication commands. Validate target and server before creating resources. Register all owned IDs immediately; preserve other workers' fixtures/processes/roles. The test bank lock must be shared and released only by its holder. Do not run reset-based suites concurrently against one student.

Time fixtures must preserve the relevant class occurrence, cycle, logged scope and recorded history relationships. Label trigger bypass and shifted due timestamps; no production time override or direct score/evidence invention. They prove rules from the constructed history, not actual elapsed weeks or cron behaviour.

Run full `npm run verify`, TypeScript and touched class-log/commitment/booking/scope/assessment/repair/weekly-review/Coach regressions once on the final tree. New additive migrations require current-function preservation, access/transaction/race and isolated install/upgrade/restore proof. Coordinate schema work with Settings; do not blindly apply its pending files.

Update §9.34 or the next closeout section with:

1. Completed B UI path, desktop/mobile results and any explicitly endpoint-only supplements.
2. Exact class/session/outcome/concept → paper → result → repair → next-cycle lineage.
3. Partial/uncertain mapping policy actually implemented, and the unstudied-concept exclusion test.
4. Occurrence-versus-series effects and accepted-work recovery, including retries/staleness.
5. After-spacing re-check, baseline/ceiling controls, isolated schema proof and surviving A evidence.
6. Failed/skipped/unavailable checks, actual-bank capacity limits and exact cleanup.

Do not mark B fully complete while its onboarding or assessment-to-review chain remains API-only. Finish this closeout before proposing Journey C. Leave Settings, C and private content preparation separately open, and preserve the distinction between fixture-based software proof and genuine diagnostic availability.
