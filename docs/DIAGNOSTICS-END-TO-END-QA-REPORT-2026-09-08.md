# Roadmap diagnostics: end-to-end QA report

**Test date:** 8 September 2026  
**Environment:** `http://localhost:3000`, current local Next.js build, connected Supabase project  
**Perspective:** what a CFA Level I candidate can actually do and understand—not only whether the code compiles

## Executive verdict

The diagnostic engine has a credible technical foundation. It can assemble a form, withhold answer keys, lock answers, score an attempt, record concept evidence, show per-question explanations, accept a challenge, and propose calendar repairs. Its offline and live-model verification checks pass.

It is not yet a usable accountability system for a real student. The live journey dead-ends after the small question bank is consumed, duplicates concept weaknesses, describes repair work as fitting in one week while placing much of it in another, and creates calendar tasks that the tested interface cannot complete, move, or defer. Home then says there is no active plan while Calendar visibly contains diagnostic work. Those are release-blocking failures because they break the product's core promise: a test must change what the student does next.

The honest status is:

- **Diagnostic pipeline:** technically functional for a small FSA pilot.
- **Item quality:** not yet established; automated arithmetic/scope checks are not expert curriculum validation.
- **Tests-to-calendar loop:** partially connected but behaviorally inconsistent.
- **Mass-user readiness:** not ready.

## What was tested

### Automated journey

The real HTTP journey was run without deleting existing history. It produced **46 passes and 0 failures** across:

- authenticated access;
- Tests page rendering and item-bank counts;
- a six-question module diagnostic;
- answer-key withholding before submission;
- answer persistence and answer locking;
- server-owned scoring;
- concept-evidence creation;
- idempotent submission;
- per-question result review;
- item challenge creation and de-duplication;
- invalid-purpose, invalid-manifest, invalid-option and foreign-item guards;
- manifest sign-off gates;
- item-review and manifest pages.

The wider repository verification also passed:

- TypeScript check: pass.
- Numerical verifier and blueprint checks: **62/62** offline.
- Study-week and timezone checks: **69/69**.
- Live verifier call: **66/66**, including accepting a sound numerical item and rejecting its corrupted key.
- Route audit: pass across the currently detected application routes.
- Production build: compiled and typechecked successfully.

These passes prove important mechanics. They do not prove that the journey is coherent, that an item is correct under the CFA 2027 curriculum, or that the evidence is psychometrically valid.

### Rendered user journey

The signed-in desktop journey covered:

1. Google sign-in entry.
2. Diagnostics index and all assessment cards.
3. A scored result with confidence mismatches.
4. Concept evidence and answer explanations.
5. Challenge-question dialog and validation.
6. Repair proposal preview and acceptance.
7. Current-week Calendar, Agenda, task drawer and linked result.
8. Following-week Calendar.
9. Home after the diagnostic work was scheduled.

Responsive/mobile rendering remains a release risk and was not fully exercised in a narrow physical viewport during this run.

## Release-blocking findings

### P0-1 — The user can permanently exhaust the product

**Observed:** the account had answered 17 items. Reviewed available: 0. Verifier-passed available: 0. Module diagnostic, Concept check and Weekly cumulative were all disabled. The calendar still showed a scheduled weekly diagnostic that could not be started.

**User impact:** the accountability ritual disappears precisely because the student used it. There is no useful next action.

**Cause:** all previously seen items are excluded for every purpose, while the pilot bank is finite and the required assessment lengths are larger than the remaining bank.

**Required fix:**

- Add a bank-sufficiency service that runs before scheduling or presenting a diagnostic.
- Separate **evidence attempts** from **practice/reinforcement attempts**. Reused items may support practice if clearly labelled, but cannot create fresh readiness evidence.
- Maintain alternate forms per blueprint cell and generate/review ahead of demand.
- If an evidence-grade form cannot be assembled, replace the dead button with an honest fallback: reviewed practice, scheduled bank refresh, narrower valid scope, or “not enough independent evidence yet.”
- Never schedule an assessment that the bank cannot deliver.

### P0-2 — The result counts questions as concepts

**Observed:** six evidence rows were displayed as “6 concepts need work,” but two concepts appeared twice. There were only four unique concepts.

**User impact:** weakness volume is exaggerated and the repair plan becomes artificially heavy.

**Cause:** the result page filters evidence events but does not aggregate by `concept_id`. The Tests index uses a concept map, but the result page uses raw events.

**Required fix:** introduce one shared `ConceptEvidenceSummary` service. Aggregate all events for a concept, retain the supporting item events underneath, and expose one current concept state with recency, sample size, confidence mismatch and validity.

### P0-3 — “Fits in this week” schedules work outside that week

**Observed:** the proposal claimed it fit in 3–9 September because one day remained. Two repairs were dated 9 September, two were dated 10 September and the re-check was dated 12 September.

**User impact:** the student accepts one promise and receives another. The next week is altered without being described as altered.

**Cause:** `repairPlacementFor` selects a target week using the first eligible date. `buildRepairProposal` then adds fixed date offsets without checking `targetWeek.endDate`.

**Required fix:** plan the full repair set as a unit. If every required block and its spaced re-check cannot fit within confirmed capacity before the cycle closes, either roll the complete proposal into the next draft or explicitly split it across named cycles. The preview must show both consequences.

### P0-4 — Repair work duplicates and compounds

**Observed:** current and following weeks contained repeated repair and re-check blocks from several attempts. The same concepts can be added again by later attempts.

**User impact:** Calendar becomes a backlog generator and punishes a student for testing often.

**Required fix:** repair work needs identity and lifecycle rules:

- One open repair thread per user + concept + curriculum version.
- New valid evidence updates or supersedes that thread; it does not blindly append another full task.
- A later miss may escalate the method, priority or re-check requirement.
- A later supported result closes the thread and cancels stale proposed work with an audit trail.
- One re-check can cover several repairs only if its blueprint explicitly covers each concept.

### P0-5 — Calendar work cannot close the accountability loop

**Observed at test time:** a repair drawer showed why, approach, done definition and source result, but no Start, Complete, Partial, Move, Place, Split or Defer action. The page said the student could place day-preferred work, but provided no placement control.

**User impact:** Roadmap tells the student what to do but cannot learn what happened. The next weekly plan has no execution evidence.

**Required fix:** ship task actions as one coherent flow: start, record partial scope, complete, move, split, defer, skip with reason, and undo. Every action must write an event and refresh Home, Calendar and weekly analysis. Calendar Editing was being developed concurrently during this audit; it needs a fresh rendered regression run after completion.

### P0-6 — Home and Calendar disagree about reality

**Observed:** Calendar contained the weekly diagnostic and repairs. Home said “No active plan was automatically assigned” and offered to plan a week.

**User impact:** the command center is less trustworthy than the page it is meant to summarize.

**Cause:** Home only loads `plan_blocks` through an active cycle. Calendar loads account tasks by date whether or not they are visible through that cycle path. The access/query paths also differ.

**Required fix:** create a single account-scoped `getCurrentOperatingState` service used by Home, Calendar, Tests and Coach. Diagnostic-origin work must either belong to a visible cycle/draft or appear in a clearly named inbox—not disappear from Home.

### P0-7 — Google sign-in is broken in the tested browser

**Observed:** “Continue with Google” reached the Supabase authorization host and failed with `ERR_BLOCKED_BY_CLIENT`. Email/magic-link authentication through the server path worked.

**User impact:** a primary acquisition path fails before onboarding.

**Required fix:** test Google OAuth on a clean browser profile and deployed callback domain; verify allowed redirect URLs, Supabase provider configuration, content-blocker behavior and the exact return destination. Signup must return to onboarding; sign-in must respect the requested destination.

## High-priority findings

### P1-1 — An accepted proposal looks unaccepted after reload

The POST endpoint prevents a duplicate insert, but the GET response does not report that the proposal was already applied. Reloading the result shows “Add 5 tasks to my calendar” again. Return `applied`, task IDs, current status and destination week from the read model; render “Added—view or revise” instead of another add action.

### P1-2 — “Independently checked” overstates item trust

The UI says unseen items are “independently checked.” A verifier-passed item has automated structural, numerical and model checks, but may not have expert human review. The same model family may also participate in more than one role. Use precise labels:

- **Automatically validated:** eligible for routine diagnostic practice.
- **Expert reviewed:** eligible for readiness-moving evidence.

Do not call arithmetic execution an independent CFA-correctness check.

### P1-3 — Evidence recency is non-deterministic

The Tests index summarizes the “most recent” concept state by inserting database rows into a map, but the query has no chronological ordering. Database return order is not a recency contract. Order by evidence timestamp and apply a defined reducer—or materialize current concept state transactionally.

### P1-4 — The score dominates a report that says score is secondary

The largest object on the result is `33%`, followed by copy saying raw scores across forms are not comparable. Lead with the evidence pattern and next action. Keep raw score as attempt metadata. Do not call the current fixed delivery mode “adaptive.”

### P1-5 — Error diagnosis is stated too confidently

The report says several misses were “the same kind of mistake.” This label comes from the selected distractors' generated diagnoses. One attempt can support a hypothesis, not a durable cognitive diagnosis. Say “This attempt suggests…” and only promote a repeated pattern after multiple valid items across time.

### P1-6 — Repair guidance is truncated

The task drawer ended a learning approach mid-sentence. The repair builder slices `scope_notes` to 220 characters. Store and render a purpose-written short pointer; never truncate source meaning by raw character count.

### P1-7 — The scheduled diagnostic has an assumed time

The scheduler uses the profile reminder/check-in time, otherwise 18:00. A reminder preference is not necessarily a 90-minute free window. A weekly diagnostic should be timed only inside a confirmed interval; otherwise it should be day-preferred with a “choose a time” action.

### P1-8 — Home’s key controls are placeholders or invisible

Home's Start and Defer controls have no connected behavior in the inspected source. In the rendered no-cycle state, the “Explore your workspace” heading appeared but its destination cards remained invisible after waiting. A command center cannot contain decorative controls or animation-dependent content.

## Quality, security and operating findings

1. **Item-quality proof is still missing.** Verifier–human agreement has not been measured. The live model check proves arithmetic consistency and key mismatch detection, not CFA 2027 correctness.
2. **Reviewer authorization is unsafe if `REVIEWER_EMAILS` remains unset.** Item promotion to gold must use an explicit server-side role/claim, not a permissive fallback.
3. **The E2E suite defaults to a real personal email.** Running it creates attempts, evidence, challenges and possibly repairs in the founder's account. It must require an explicit test account and refuse production Supabase unless a separate override is present.
4. **The manifest test does not restore the actual previous state.** It forces a concept to `drafted`, signs it off, then writes `drafted` again. Capture and restore the original row, or test only in isolated fixtures.
5. **Reset mode is destructive.** It deletes the selected account's diagnostic history. Keep it unavailable outside an ephemeral test project.
6. **Scoring and evidence are not atomic.** An attempt can be terminally scored even if evidence insertion fails. Use one transaction or a recoverable `scored_evidence_pending` state and background retry.
7. **Challenge resolution is not yet closed-loop.** Voiding a flawed item must recompute affected attempts, retract derived evidence, repair current concept summaries and revise/cancel calendar work.
8. **The prototype banner contradicts the connected data.** It says schedules and scores are examples even on pages backed by the signed-in account. Remove it from real flows and use precise per-capability pilot labels.

## Recommended repair sequence

### Gate A — restore truth

1. Create the shared operating-state and concept-evidence reducers.
2. Deduplicate result evidence and repair threads.
3. Fix repair-week placement and applied-state persistence.
4. Prevent undeliverable diagnostics from being scheduled.
5. Make challenge invalidation transactional across score, evidence and plan proposals.

### Gate B — restore actionability

1. Finish and render-test task start/partial/complete/move/split/defer/undo.
2. Add bank-exhaustion fallbacks and a content-supply monitor.
3. Connect weekly diagnostic blocks directly to an assemblable assessment scope.
4. Rebuild Home on the same operating-state service.

### Gate C — establish quality

1. Sign off the curriculum concepts against licensed/authorized 2027 references.
2. Run a blinded expert review set and publish verifier–human agreement internally.
3. Create defect thresholds by item type, topic, difficulty and model version.
4. Expand the bank ahead of consumption and continuously monitor exposure capacity.

### Gate D — qualify release

Run three full seeded journeys on desktop and mobile:

- coaching-led student with a class moved midweek;
- self-study student who advances faster than projected;
- disrupted student who completes partially, misses the weekly diagnostic, and restarts without backlog punishment.

Each journey must complete two weekly cycles and prove that evidence, repairs, Calendar, Home and Coach all agree.

## Final release criterion

The diagnostic system is ready for a student only when this invariant holds:

> A valid diagnostic produces one understandable evidence update, one non-duplicated and reviewable planning consequence, an executable calendar action, and a later re-check that can close or revise the weakness.

At present, the system reaches the proposal but does not reliably satisfy the rest of that invariant.
