# Roadmap — next build: reliable repairs, re-checks and Calendar acceptance

**Implementation handoff · 31 October 2026**

Use the following as the complete worker prompt. This is a build specification, not a claim that the work is already implemented. Recheck the checkout and database before relying on dated counts or findings.

---

You are implementing the next bounded part of Roadmap in `/Users/advay/Documents/Structured Learning App`. Finish the diagnostic-to-repair-to-recheck loop without rewriting the rest of the product. Read the current implementation, preserve correct behaviour, work in small phases, and test real student journeys. Do not stop at a new plan or a successful typecheck.

## 1. What the product is

Roadmap helps CFA Level I candidates decide what to work on, organise their week, record what actually happened, take diagnostics, identify gaps and adjust the following week. It complements coaching and self-study. It does not teach chapters, replace coaching, or reproduce copyrighted provider content.

Its core loop is:

`Context → proposed week → student accepts → actual study/class logs → confirmed learning outcomes → diagnostic/revisionary paper → trustworthy evidence → proposed repairs → accepted Calendar work → repair activity → unseen re-check → updated evidence → next week.`

Every handoff must retain the student's curriculum mapping, history and choices. A student who is behind needs calm choices, not an access verdict or automatically inflated workload.

## 2. Established decisions: preserve them

- Verified authentication and completed onboarding are required to enter student features. Onboarding is a context gate, never an exam-feasibility selection process.
- External domain, Google provider enablement and email delivery are deferred until the repository/GitHub stage. Do not configure them now. Keep existing access guards intact.
- Self-study learning runs Monday–Saturday, with the weekly paper on Sunday. Class-led cycles follow the existing class-boundary resolver, with the paper before the next class. Reuse that resolver; do not introduce a fourth definition of a week.
- An unregistered candidate plans toward the selected tentative exam month/year. An exact booked date can be added later.
- Calendar plans work; actual completion and explicit outcome confirmation determine ordinary diagnostic scope. Unfinished work is not a wrong answer.
- New material leads to diagnostic questions; revisited material to a revisionary paper; genuinely mixed scope is labelled mixed. Do not reclassify a frozen paper when live context changes.
- No paper exceeds 90 questions. Existing mock sessions are 90 questions/135 minutes; building the full mock product is outside this slice.
- Answer confidence is mandatory. Confidence, accuracy, timing and task execution are distinct observations. Slow answers are not automatically concept failures; confident wrong answers are signals, not diagnoses of a person's ability.
- Reviewed, unseen, correctly mapped questions are required for evidence. Do not promote verifier-passed questions, rephrased previously seen items or unsupported scope to fill a shortage.
- No sources/material-upload feature. No tutoring, streaks, shame, fabricated mastery, pass probability or one blended readiness percentage.
- Planning assumptions are labelled as assumptions. Preserve the student's sitting limit, real commitments and actual time. Extra repairs must consume capacity and visibly displace other proposed work rather than silently extending the week.
- Tests, Calendar, Curriculum, Home and Coach must agree on the same records. No second frontend-only repair state.

## 3. Context to load before editing

Read root `AGENTS.md` and the relevant installed guides under `node_modules/next/dist/docs/`. This checkout uses Next.js 16.3.4; do not assume older route/component conventions.

Read these active documents, resolving discrepancies against current code and the latest dated implementation records:

- `docs/FOUNDER-PRODUCT-DECISIONS.md`
- `docs/VISION-CONTEXT.md`
- `docs/EFFORT-MODEL.md`
- `docs/LIMITS-AND-SOLUTIONS.md`
- `docs/MASTER-STATUS-AND-COMPLETION-PLAN.md`, especially the 29–30 October records.
- `docs/WEEKLY-CONTINUITY-W0.md`, especially W1–W3 and subsequent corrections.

Earlier archived proposals are historical context, not instructions to rebuild superseded features. This prompt is a proposal for the next slice; do not misrepresent its defaults as prior founder decisions.

The tree contains substantial existing, uncommitted work, staged archive moves and cleanup. Preserve it. Do not reset, broadly stage, commit, push, open a new repository or clean another worker's files. No parallel editing agents unless separately authorised.

### Verified foundation to retain

1. Task execution, exact scope confirmation and scope-preserving splits have guarded database commands and regression suites.
2. Weekly review records what happened separately from what should happen next. Unfinished work continues as a **new successor task**; the original week, time and history stay intact. One successor per original; old links have continuation pointers.
3. `/api/weekly-review/preview` saves a server-owned draft. `/api/weekly-review/accept` accepts only its ID and atomically closes/opens weeks, creates continuations and records the receipt. Stale previews are refused. Empty/unplaced weeks are valid.
4. New plan portions respect the maximum sitting and avoid past local dates. Continuing work reduces room for new work.
5. One shared quick-learning form exists on Home, Calendar, Tests, reading pages and `/app/log`. `record_learning_sitting` creates one activity, one linked task, exact outcome confirmations, one nullable time observation and a retry receipt. Unknown time remains null. Removing a mistaken log cancels its active contribution while retaining audit history.
6. A subset of outcomes does not finish a reading. Study/class exposure never creates diagnostic evidence. Date-only study logs cannot establish that same-day work happened after a test.
7. Existing paper assembly constrains candidates to eligible reviewed/unseen questions and actual confirmed outcomes. Frozen papers retain their original scope and identity.

Latest recorded development state: 54 applied migrations, ending in `20261030_learning_sittings.sql`; zero pending at that checkpoint. The confirmed disposable Supabase project is `asylsxszdhlnzewhwtga`. Both local environment files point there; there is **no separate staging project**. Reverify rather than assuming that remains current. Do not expose credentials or disable TLS. Applied migration files/checksums are immutable; changes require a new additive migration.

The recorded bank had 19 reviewed and 243 verifier-passed items. These are dated counts, not certified content quality or full-syllabus support. Do not claim model training, a 20,000-question bank or release readiness.

## 4. Inspect these paths and prove the remaining gaps

- `src/lib/planning/schedule.ts`: `buildRepairProposal`, `applyRepairProposal`.
- `src/lib/planning/repairDates.ts`, `repairPolicy.ts`.
- `src/app/api/diagnostic/repair/route.ts`.
- `src/components/diagnostic/RepairProposalUI.tsx`.
- `src/lib/tests/{resultService,resultAnalysis,startAssessment,paperPreview,testsOverview,itemPool,assembly,limits}.ts`.
- `src/components/tests/{ResultView,OtherAssessments,StartButton}.tsx`.
- `src/lib/planning/weeklyReview/{service,composer,dispositions}.ts` and its routes.
- `src/lib/planning/pulse/{generateWeek,paper}.ts`.
- `src/lib/coach/{service,actions}.ts` and `/api/coach/proposals/[id]`.
- The current evidence reducer, assessment-finalisation and challenge/void RPCs; inspect all additive replacements, not just the original SQL definition.
- `src/lib/state/`, `src/lib/signals/`, shared Curriculum activity/coverage loaders and task drawer.

Confirmed code findings at handoff:

- The repair GET is read-only, but POST recomputes a new proposal from `attemptId`; it does not accept the exact saved preview the student saw.
- POST checks for existing tasks before inserting. That check is not concurrency-safe acceptance. Proposal upsert can reset status before the legacy apply RPC.
- Application code supplies provenance fields which the deployed insert contract must be checked to preserve. Do not assume a caller's JSON is actually stored.
- Existing suggested dates follow a simple two-repairs-per-day/three-day-later calculation. They are not proof of free capacity.
- The aggregate re-check has null thread/concept identity. `startAssessment(kind:'repair')` gathers the general weakness tracker and slices it, rather than accepting the exact repair dependency set selected in Calendar.
- Existing thread lookup filters `open/proposed`; already scheduled/in-progress/awaiting-check work needs explicit treatment rather than disappearing or duplicating.
- Coach has a separate `recheck_block` proposal path which inserts a repair task directly. Trace and consolidate it.
- A three-question small-scope preview can disagree with the start minimum of five. Reading/subject Start controls do not consistently preflight bank eligibility.
- Original finalisation code increments repair occurrence per failing response; determine whether newer definitions fix duplicate/concurrent scoring and multiple misses in one paper. Do not assume one question equals one new repair episode.
- Thread permissions and legacy apply signatures need direct-RPC testing; route authentication alone is insufficient.

Write a short baseline finding list with current evidence. If a finding is already fixed, keep the fix and update the record rather than rebuilding it.

## 5. Required student experience

### A. Result: understand what happened

At `/app/tests/[attemptId]/result`, show the tested scope, valid score and limitations. Separate incorrect concepts from correct-but-uncertain responses and untested areas. Existing SWOT remains evidence-scoped: correlations are possible opportunities/risks, not proof of competence or weakness in untested material.

The repair section has one clear action: **Review follow-up**. For each item show the actual concept/LOS, source result, reason, suggested approach and planning estimate. Guide the student to the named reading/LOS in their existing course; do not give a chapter lesson or provider quotation.

If the weakness already has work, offer **See existing repair**, **Continue repair** or **Review the re-check** as appropriate. Reopening a result must not propose a duplicate set or imply an old weakness is still current after later evidence changed it. Missing data is an error/retry state, not “nothing needs repair.”

### B. Preview: decide what fits

Show exactly what will be added, retained, rescheduled or left waiting. Include the target cycle, dates, minutes, displaced work and re-check dependencies. Provide **Confirm changes**, **Keep for later** and **Back**.

Re-use actual availability, accepted tasks, class commitments and sitting rules. Auto-placement cannot overlap protected commitments, backdate work or invent clock times. Use day-preferred/floating placement honestly where exact times are not supported. Explicit student over-capacity choices receive calm warnings and must be distinguishable from automatic placement; protected commitments are never silently overwritten.

If work spans cycles, separate its actual repair placements from the later check. Do not mislabel a multi-week span as one week. Accept only changes belonging to the selected accepted cycle. Work for the next cycle goes through the existing weekly-review draft, without a second writer opening a competing week. Carry a later re-check as an explicit waiting obligation linked to its repairs, never a hidden future-dated block inside the closing cycle.

An empty or full week does not discard the repair. Show why it waits and how to place it later. “No questions available” blocks a scored check, not study, Calendar access or all weekly review.

### C. Calendar: do the repair

`/app/calendar?task=<id>` opens a repair with its objective, exact LOS/concept, source result, approach, planned estimate and completion meaning. Include **See result**, **Open reading**, and **See follow-up check** when available.

Use existing execution commands for start/partial/completed, reported time and deferral. Completion means “worked on the gap,” not “gap solved.” Finishing work moves it toward awaiting verification; only a qualifying scored check can change demonstrated understanding. Deferring one portion must delay the dependent check. Multiple portions share one dependency identity; check readiness depends on the last required portion, not the first.

Missed/partial work enters weekly review. Successors preserve repair identity and remaining intent, with no copied minutes, answers, scope confirmations or evidence. Original links and historical attribution continue to work.

### D. Re-check: assess exactly the repaired scope

A Calendar check opens a server-generated preview naming the linked repair threads, exact concepts/outcomes, completed repair work, valid item count and timing. It must not silently collect every weakness from the user's account.

Allow an explicit combined check only when its included repairs and their dependencies are visible and ready. Use unseen reviewed questions within those concepts/outcomes. If concept-level inventory cannot support the intended inference, report that limitation; do not use a correct answer about a different concept to close the gap.

Repair activity must postdate the relevant evidence. Date-only same-day work is timing-uncertain, not automatically eligible. Spacing is a labelled scheduling policy, not scientific certainty: preserve an existing documented default where appropriate, make it explicit/versioned and allow realistic later placement. No check before required work. Near-exam constraints should be stated, not hidden by compressing or deleting spacing without acknowledgement.

Resume an existing applicable attempt before declaring it unavailable because its own questions are no longer unseen. Freeze and persist the exact thread/dependency/scope version at start. Repeated start/submit must not create duplicate papers, evidence, thread events or follow-up tasks.

### E. After the check

Show **supported on this check**, **still needs work**, **uncertain** or **not assessed**, using the existing evidence policy. One short result cannot establish broad syllabus readiness.

Passing the configured evidence criterion resolves only the assessed concept/episode. Wrong or unstable results update the same active thread and propose a proportionate next step. Untested threads remain open. A newer miss after an older successful check keeps the current gap open; a later unrelated correct answer must not erase it.

Do not invent a hidden success threshold. Reuse a documented current criterion. If no repair-resolution policy exists, present the smallest explicit versioned policy decision with examples before coding automatic closure; the rest of this build can proceed. No “mark repaired” control should fabricate test evidence.

## 6. One source of truth and safe commands

Design the minimum additive schema needed after inspecting current tables. Do not create parallel proposal, repair queue, readiness or evidence systems just for this feature.

Required contracts, regardless of chosen internal names:

- One active repair thread per owner + concept + curriculum manifest, preserving the existing uniqueness semantics.
- Append-only episode/evidence provenance: source scored attempt, valid evidence/response references, current revision, prior actions and results.
- A saved server-owned proposal with owner, target cycle, source version, policy version, expiry and exact diff. Browser accepts an identifier and command key, never arbitrary task JSON.
- Explicit many-to-many check-to-thread/portion dependencies if combining repairs. A null generic thread ID or a title match is insufficient.
- Durable acceptance receipt linking the proposal and resulting task IDs. Identical retries return the original result; changed payload/key conflicts are explicit.
- Lifecycle states for proposal, task execution and repair evidence remain independent. “Proposal executed” is recorded only inside the transaction that successfully applies its changes.

Acceptance must atomically authorise, lock, revalidate source/cycle/task revisions, write the diff and history, update the relevant thread/proposal states and record the receipt. Use a Postgres command consistent with existing guarded RPCs. A failure rolls everything back. Concurrency tests must exercise a genuine second connection, not just sequential calls.

Staleness covers changed task execution/placement, commitments/availability, relevant evidence validity, thread revisions, cycle closure and local-day expiry. Recheck bank eligibility at paper start; do not promise a future question reservation unless an actual reservation mechanism is built. Document isolation boundaries, including concurrent inserts that a row lock alone cannot prevent.

Direct RPC/RLS paths enforce ownership, verified/setup access, allowed transitions, mappings and cycle boundaries. Prevent modification of another user's thread through a caller-supplied ID. Retire or narrow old unsafe functions only after tracing callers. Auth account cascades, continuation immutability and cancellation must still work.

Challenge submission is not automatic invalidation. When an authorised challenge resolution actually voids/supersedes evidence, recompute its contribution. Cancel only open tasks/checks no longer justified by any valid supporting evidence. Keep completed work/time/history and other valid reasons intact. Record the cancellation reason; never silently hard-delete the learner's work.

## 7. Routes and cross-page linkage

Retain stable student URLs where possible. Implement these proposed repair API contracts unless a demonstrably equivalent saved-draft contract already exists; document any deliberate difference:

| Surface/route | Required connection |
|---|---|
| `/app/tests/[attemptId]/result` | Read-only result + current follow-up state; opens saved proposal review |
| `/api/diagnostic/repair` GET | Owned read-only current state; no proposal/thread/task mutation on render |
| `/api/diagnostic/repair/preview` POST **new** | Explicitly save/update a server-owned draft from attempt/thread selection and user placement preferences |
| `/api/diagnostic/repair/accept` POST **new** | Accept saved draft ID + idempotency key; atomic receipt/diff, no client task rows |
| Existing `/api/diagnostic/repair` POST | Migrate callers, then reject the unsafe attempt-only contract or strictly adapt to saved-preview acceptance; no silent recomposition/apply |
| `/api/weekly-review/state`, `/preview`, `/accept` | Existing sole next-cycle transition; includes pending/continuing repairs and waiting checks without duplicates |
| `/app/calendar?task=<encoded-id>` | Repair/check drawer; preserves week/view navigation and historical links |
| `/api/tasks/[id]` | Existing guarded execution/placement commands; add dependency-safe checks where needed |
| `/app/curriculum/[subject]/[reading]` | Specific worked/awaiting-check/assessed outcomes, history and related task/result links |
| `/api/tests/preflight` POST **new** | Shared read-only eligibility contract for requested weekly/reading/subject/repair scope; no attempt creation |
| `/api/tests/start` | Recompute the same policy, resume or atomically start; repair task/thread/dependency IDs identify the exact requested scope |
| `/app/tests/[attemptId]` | Existing taking/resume flow, confidence, timing and frozen scope |
| `/api/tests/attempt/[id]/{answer,progress,pause,submit,result}` | Preserve current contracts; score submission and repair evidence are retry-safe |
| `/app`, shared operating state/signals | One next actionable repair/check or waiting reason; separate execution, exposure and evidence |
| `/app/coach`, `/api/coach`, `/api/coach/proposals/[id]` | Same repair read model and commands; no direct competing task insertion |

Do not create a new weekly-review navigation tab. Preserve `/app/review-week` as the short contextual closure flow reached from Home, Calendar or results.

The Coach can explain a missed concept/LOS, suggest a study approach, describe current progress, and propose rescheduling. It cannot teach the curriculum, certify untested threats, apply a proposal silently or claim a calendar edit succeeded before receipt confirmation. Accept/dismiss/retry/stale states use the same semantics as the direct UI. Guard the touched Coach routes with the shared application-access check, not login alone. Do not undertake a separate full Coach redesign or claim response fine-tuning in this slice.

## 8. Paper eligibility consistency: bounded accompanying fix

Build one preflight decision used by preview, buttons and start. Distinguish no completed scope, pending confirmation, insufficient reviewed questions, waiting repair dependencies, stale scope and resumable attempt. Show requested versus currently deliverable questions and any unsampled scope.

Conservative implementation default: preserve the current **five-question ordinary-paper minimum** for this slice unless a documented newer product decision overrides it. This is existing code policy, not an immutable founder requirement. A three-question blueprint cannot advertise itself as startable: explain the minimum and offer useful planning/logging/navigation. Do not widen scope to five, weaken question quality, or silently re-label a tiny check as a weekly paper. If introducing shorter targeted checks is necessary, present that explicit product/evidence-policy decision before changing the minimum; keep them out of broad readiness claims.

Preflight is advisory, not a guarantee against simultaneous bank changes. Start remains authoritative. Handle a bank change with a clear recoverable response. Repair-related start/finalisation writes must be atomic through the full form/blueprint/items/snapshot/task-link lifecycle; preserve older attempt shapes and other paper kinds. No partial orphan paper should be left when the touched start path fails.

## 9. Implementation phases

**R0 — establish current truth.** Trace one scored attempt, active thread, existing task, old proposal and weekly handoff through the code. Inspect effective SQL signatures, RLS and current permissions. Write confirmed findings, route ownership, state transitions and any unresolved evidence-policy choice. Do not mutate existing learners to manufacture a demonstration.

**R1 — guarded domain/database contracts.** Implement saved proposals, dependencies, acceptance receipts, provenance and lifecycle invariants with the smallest additive migration. Pure placement/eligibility/reducer rules precede UI changes. Test direct RPCs, stale source detection, concurrency, rollback and account deletion locally, then rehearse on the confirmed disposable project with rollback and timeouts. Use the checksum runner for application; never edit an applied migration.

**R2 — capacity-aware repair placement and weekly continuity.** Replace synthetic date assertions with actual placement/diffs. Integrate the same obligations into weekly review. Preserve split/continuation metadata and original week attribution. Retire duplicate writers only after callers are migrated.

**R3 — scoped re-check and evidence lifecycle.** Join exact repairs to preflight/start/frozen scope/results. Finish dependency readiness, bank shortage/resume behaviour, repeat-miss handling and valid-evidence resolution. Cover invalidation without erasing unrelated or historical work.

**R4 — student and Coach connections.** Deliver the result proposal, Calendar drawer, waiting states, contextual Home/Tests/Curriculum links and shared Coach acceptance. Use concise copy, visible confirmation and one clear primary action. Preserve unsaved choices after recoverable errors. Verify keyboard/focus handling and avoid stacked modal/drawer traps.

**R5 — end-to-end proof and cleanup.** Run automated checks, actual database/API tests and Browser journeys. Fix failures and document exact limits. Update the existing master status document, rather than creating another conflicting completion plan. Remove owned fixtures and private sign-in files. Do not certify the entire app from this slice.

## 10. Acceptance tests: required proof

1. A scored paper creates or updates one active concept thread. Several wrong items on that concept and duplicate/concurrent submissions do not spuriously count as several separate paper episodes.
2. Opening result/proposal/Calendar pages has no task/evidence/cycle mutation.
3. Preview and accepted diff match exactly. All objective/method/mapping/result/thread/dependency fields survive storage.
4. Double click, two devices and lost acceptance response produce one task set/receipt. A failed write produces none. Refresh supports safe same-request recovery.
5. Editing relevant context after preview refuses acceptance without discarding the student's choices. Direct RPC attempts cannot bypass this.
6. A full calendar offers waiting/defer/displacement choices. Protected classes/commitments and sitting limits survive. No automatic work is placed in the past or outside its accepted cycle.
7. A Sunday self-study paper routes repairs into next-week review. A class-led paper follows the actual class boundary. Later re-check obligations remain visible across cycles.
8. A completed first repair portion does not unlock a check while another required portion is unfinished. Postponement/split/continuation updates dependencies and preserves one logical repair episode.
9. Re-check questions match the selected repaired concepts/outcomes only. An unrelated account weakness, unconfirmed topic or previously seen item cannot fill the paper.
10. Preview/start/buttons agree on the three-versus-five case, bank exhaustion and mandatory dependencies. Existing open attempts resume even if no fresh unseen inventory remains.
11. Repair completion/logging changes activity, not mastery. Unknown minutes remain unknown; weeks and continuation chains do not duplicate time or effort.
12. Passing/wrong/unstable/partial checks produce the documented concept-level outcomes only. Unassessed concepts stay open. An older check cannot close a newer gap.
13. A pending challenge does not silently erase evidence. Authorised invalidation removes only its actual contribution, keeps other support and preserves completed history.
14. Home, Calendar, Tests, Curriculum and Coach show the same current status after a refresh. Links land on the exact task/result/reading; Back retains useful context.
15. Cross-user IDs, unverified/incomplete setup, arbitrary task payloads, stale revisions and retired RPC calls cannot mutate repair state. Fixture account deletion leaves no owned debris and does not affect other users.

Use meaningful pure-domain tests, real isolated Postgres transactions/concurrency tests, and own-account Auth→API tests. Run `npm run verify`, `npm run build`, typecheck, migration dry-run and whitespace checks. Verify current script names instead of inventing commands. Run relevant existing task/scope/log/weekly-continuity suites to catch regressions.

Use the available Browser runtime for desktop and an actually verified mobile viewport. Inspect page identity, visible state after each interaction, errors/overlays, focus/keyboard and screenshots. Do not claim mobile coverage if a viewport override did not change actual dimensions. Identify a free localhost port; 3000 has previously belonged to another app, and the last Roadmap build ran on 3101. Do not kill unrelated servers.

Use dedicated test identities and clearly labelled fixtures in the confirmed disposable development project. A pre-seeded setup fixture tests repair behaviour, not onboarding. Never promote fixture questions into the shared usable bank. Fault injection is allowed only for owned test records/requests. Clean up all owned rows, orphan forms/blueprints and temporary credential files, verify cleanup, and retain screenshots outside the repository.

## 11. Finish with an honest handoff

Report what changed for a student, the exact routes/contracts/migrations, applied versus unapplied database state, tests and Browser journeys, screenshots, cleanup and remaining failures. Separate proven facts, policy assumptions and untested paths. If a dependency blocks a step, finish independent work and name the concrete blocker.

The release criterion for this slice is that one valid diagnostic can lead to one accepted, traceable repair plan and one correctly scoped check, with safe retries and week transitions. It is not a claim that the curriculum bank, long-term revision/mocks, full Coach training, all settings, external authentication or the whole product is production-ready.
