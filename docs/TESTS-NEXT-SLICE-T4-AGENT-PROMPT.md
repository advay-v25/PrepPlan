# Next Tests slice — integrity closeout and the student experience

Prepared 9 November 2026, after the T0/T1 report in master status §9.24.

## Assignment and scope

Build the next student-facing Tests slice. Preserve the delivered scoring, mock blueprint, bank-depth and timing fixes. First close the scoring/challenge and historical-policy gaps below, then deliver the Tests workspace, focused runner, compact results and their exact cross-product links.

This is a bounded slice of `docs/TESTS-REVAMP-MASTER-AGENT-PROMPT.md`, primarily T4 with the minimum necessary T1 integrity/evidence work. Do not restart the full brief or recreate the assessment architecture. Do not build the difficulty engine, bulk question generation, model fine-tuning, payments, account operations or a new materials system in this slice. Do not advertise those unfinished features in the UI.

Read `AGENTS.md`, Ponytail, the installed Next.js guides relevant to your edits, the master Tests brief, founder decisions, Curriculum revamp brief, and status §§9.23–9.24. Preserve the existing dirty working tree and coordinate overlapping files. Do not commit, push or deploy.

Complete the implementation and its proof rather than returning another proposal. Routine implementation choices are yours. If an unexpected product-policy conflict remains, retain the current policy and report the precise unresolved decision; do not invent one merely to finish a screen.

## What is accepted from the previous slice

- Future forms pin `paper-score.1`; legacy forms retain `1.0`.
- Paper score, answered accuracy and completion are separate. Omissions earn no correct mark but are not misconception evidence.
- The official-session blueprint is implemented for new mocks; historical reservations remain pinned.
- Per-outcome depth counts independent families; canonical cognition timing aliases exist.
- Blank-question navigation and discard controls exist in code, pending browser proof.
- The unsupported future-performance interval has been removed.
- Migrations `20261205` and `20261206` and the regenerated baseline are already applied/reported. Do not edit them.

Do not weaken exact-version publication, practice-only evidence exclusion, family freshness, item immutability, ownership, atomic submission, repair deduplication or Calendar acceptance rules while finishing this slice.

## Review findings that precede the UI work

These findings come from current source inspection. Reproduce them against the effective database/schema before claiming live failures or fixes.

### 1. Challenge resolution does not persist the new score

`resolve_item_challenge` in `20261031_repair_loop.sql` changes evidence validity, updates result revision and reconciles repairs, but does not recalculate the stored score/counts. No later source migration currently adds that calculation. `resultService.ts` builds a new ledger at read time, whereas Tests history reads stored `assessment_attempts.score` and counts. These paths can disagree after an upheld challenge.

**Required regression:** reserve a new-policy eight-question form, answer one correctly and one incorrectly, omit six, then uphold the challenge on the incorrect item. The initial score is 2 answered, 1 correct, 6 omitted, 12.5% paper score. Afterwards it is 7 scoreable, 1 correct, 1 answered, 6 omitted, 1 voided: 1/7 paper score, 100% answered accuracy and 1/7 completion. Persisted score and every consumer agree after display rounding. `delivered` remains 8; it is not the same as `scoreable`.

Also cover voiding a correct answer, all items voided, dismissal, repeats, and legacy-policy rescoring. Keep original form policy and record the adjustment; do not silently convert old forms to `paper-score.1`.

### 2. Validity currently depends on an evidence row existing

`resultService.ts` derives voided/disputed sets from `evidence_events`. Practice deliberately has no such rows, and an omitted item also has none. Therefore item validity must be represented independently of demonstrated-understanding evidence.

Reuse the authorised challenge/resolution records and existing constraints wherever sufficient. A resolved-voided item must leave the score denominator once even when it has no evidence event. Pending disputes stay scoreable and provisional; dismissed challenges restore the appropriate state. Preserve a readable reason and adjustment history.

Check reporting a problem with an owned delivered item before answering. The student must not have to guess an answer to report unclear wording. If the current command requires a response, safely extend its admission check to owned delivered/exposed form membership. An arbitrary item ID, foreign attempt or unseen held-out question must remain inaccessible.

Serialise submission and challenge resolution against the same attempt consistently. If a challenge resolves during finalisation, the final score/validity/evidence cannot depend on which uncoordinated write wins. Use a consistent lock order and idempotent receipt. Do not insert duplicate evidence to implement rescoring.

### 3. Combined mock policy handling contradicts the helper

`combineLedgers` refuses mixed policies, but `getRehearsalResult` independently combines them using answered accuracy. Its expired-session branch also hardcodes the new policy rather than reading the pinned form policy.

Use one combination contract. Show each session separately when policies are mixed; do not invent a single combined paper score. Derive an expired session's policy and question count from its reservation. Unknown policy versions must produce an explicit unsupported state, not silently take the legacy branch. Keep null/missing historical handling deliberate and tested.

### 4. Evidence timing is still unfinished

The result service still reads the current Curriculum tracker to construct historical SWOT. The concept-summary reader still needs a genuine as-of boundary and bounded reads. A later paper must not silently rewrite what an earlier result claims it showed.

For this slice, derive the primary result's findings/SWOT from that paper's pinned scope and valid observations at its current authorised result revision. Put cumulative Curriculum status in a separately labelled “Current status” area with an evidence timestamp/revision. Later observations may update that area, not the earlier paper findings. An authorised challenge adjustment is explicitly versioned.

Do not opportunistically change support thresholds. One success should read as an observation where repeat support is required. Keep open repair status and the installed repair-resolution policy independent of presentation labels. If a threshold change is genuinely needed, version and test it as the master brief specifies.

## Pass A — close the integrity gaps

1. Add failing fixtures for the four findings before changing their shared implementation.
2. Compare the **effective** finalisation/challenge functions with the full migration chain and baseline. Do not rebuild a live function from an old migration body. A substring check alone is not semantic proof.
3. Make a new additive migration only where needed, retaining approval trust, practice exclusion, repair effects, locking, grants and retry behaviour. Test install and upgrade paths; do not create another parallel scorer.
4. Keep scoring versions server/form-owned and enforce every caller, including compatibility endpoints and authenticated RPC access. Never accept a client correctness flag or requested favourable scoring policy as authority.
5. Use one score/validity ledger or one demonstrably equivalent SQL implementation and TypeScript adapter. Persist original delivered count, effective scoreable count/basis, answer counts, omissions, policy and revision unambiguously; extend fields only where existing ones cannot express the facts.
6. Make stored history, results, session/combined summaries, Home and weekly recap agree after challenge resolution. A read failure must be unavailable, not zero.

Required proof includes exact evidence cardinality. A genuine approved eligible answered item creates the expected observation; practice and omitted items create none. An assertion such as “at most one” alone cannot prove the positive evidence path.

**Exit:** new and legacy scores, adjustments and combined-policy handling agree; the approval/practice regressions remain covered. Then proceed immediately to the visible experience.

## Pass B — rebuild `/app/tests`

Use the existing decision/preflight services and UI primitives. Retain `/app/tests` and its old deep links. Add validated shareable views `view=week|practice|mocks`, with Week as default. History can remain below the view and open through a header link; add a separate route only if the interaction actually needs it.

### Week view

One short introduction and one primary stateful card. Prioritise an open paper/session, then the justified weekly action. Do not put a long unavailable-mock inventory report ahead of normal weekly work.

| State | Primary experience |
|---|---|
| No completed scope | Explain that the paper uses recorded completed learning; open Calendar or the existing learning-capture flow |
| Confirmation needed | Open `/app/tests#scope-h`; preserve the confirmed portion's startability under the existing policy |
| Upcoming | Due date, scope/count/time summary; allow deliberate early entry if currently supported, without labelling it overdue |
| Ready | “Review and start” opens the shared preflight preview |
| In progress | “Resume paper” opens the exact owned attempt or rehearsal hub |
| Scored | Score basis and one next action; link the exact result |
| Follow-up | Open the exact existing repair/proposal, not a generic Coach conversation |
| Closure | Open `/app/review-week` under the existing log-resolution and cycle-credit rules |
| Bank insufficient | Concise limitation and usable planning path; expandable details; no fake Ready or infinite spinner |
| Read failed | Retry section, preserving selections; do not claim no history or no work |

Put scope details and excluded/pending work behind one disclosure. Remove duplicated scope-empty copy, raw global bank statistics, repeated evidence cards and redundant assessment-kind explanations from the first view. Keep `#scope-h` and other published anchors working.

### Practice and checks view

Offer the currently implemented reading check, subject check, explicit baseline and fixed timed practice through one compact selection flow. Preserve Curriculum's reading/LOS entry context.

Selection → purpose-specific preflight → visible scope/count/time/capability → explicit Start → exact paper. A preflight cannot consume freshness or start a clock. Baseline permission is an explicit opt-in; a URL cannot grant it.

Do not add Adaptive Practice controls or claim personalised difficulty until T3 actually implements them. Existing timed practice stays practice-only. For bank insufficiency, retain the selection and explain the alternative without launching an unrelated question set.

### Mocks view

Show the next appointment, the owned incomplete rehearsal or Plan a mock. Differentiate external and internal mocks. The unavailable internal bank is a short state with optional detail, not ten default-open shortfall rows.

Use the existing checkpoint/Calendar editor. Reservation pins both sessions without starting a clock. Starting a session is explicit. Keep the break, Session 2 handoff, cancelled appointment, stale booking, lost response and completion states understandable.

### History

Paginate using a stable date/ID cursor or existing equivalent. Show purpose, date, scope, question count, completion and clearly labelled score basis. Handle reserved-but-unstarted timestamps without displaying 1970. Legacy, practice, external reports, incomplete sessions, mixed-policy mocks and no-score cases stay distinguishable.

The student sees no reviewer, manifest, generation or batch operations links. Staff routes retain their role protection.

## Pass C — focused runner and reliable navigation

Preserve the answer-ordering and lost-response fixes from §9.23. Verify the current Skip/Discard implementation in the browser before modifying it further.

- A completely blank question can be skipped and revisited through Next, Previous and the navigator.
- An answered question requires the owner's confidence selection; a blank one never receives a fabricated level.
- A half-made or unsaved choice stays visible. Offer a safe retry or explicit discard; switching questions must not lose it silently.
- “Discard my choice” must not allow an in-flight successful response to restore a discarded draft unexpectedly. Define whether it discards only local changes or clears an already saved answer, label accordingly, and test the race. Do not clear a server answer unless an explicit authorised clear command exists.
- Show Saved only for the exact acknowledged item/revision. Reload and return must visibly restore the actual saved choice and confidence.
- Review lists answered, omitted, flagged and unsaved states. Expiry submits saved work, including an all-blank new-policy paper, without being trapped by confidence controls.
- Timers remain server-deadline-based; reload, offline time and another tab cannot extend a mock.
- Use a focus layout that keeps the menu away from the title and footer controls. Hide the floating Coach launcher during an active assessment. Provide a safe exit/resume action; no tutor or key reveal during a live paper.
- Test at desktop and 390px, keyboard-only, long stems/tables and 90-question navigation. Use existing accessible radio behaviour and focus management.

Remove durable expiry settlement from page renders and GET handlers. Keep elapsed-time truth in the read model; use the existing authenticated, idempotent session/submission command on timeout/resumption. A prefetch cannot mutate an attempt. This change must not permit late answers or require the browser to stay open to enforce a deadline.

## Pass D — compact result and exact links

First viewport: paper identity/purpose, paper score and basis, completion, one supported finding and one useful next action. Show answered accuracy as a clearly secondary measure. Preserve precision in counts and round consistently for display.

Detailed sections should open on demand:

1. What to do next and existing follow-up.
2. Reading/subject/LOS findings and clearly qualified SWOT.
3. Questions, with wrong/unsure/omitted/flagged filters.
4. Timing, difficulty mix, scope coverage and integrity details.

Do not show several different “close week / next week / follow-up” cards offering the same decision. A repair, further paper, timed practice or closure must lead to the exact working destination. Preserve empty and unavailable states rather than hiding why an action cannot run.

Keep concise assessment reasoning and distractor rationale; no generated lesson or teaching conversation. An omission is an unanswered item, not a proven concept gap. A single right answer is not a whole-reading strength. Opportunities/threats require the existing verified relationship and rationale; label them inferred.

### Link contracts

| From → destination | Contract |
|---|---|
| Curriculum → check | `/app/tests?view=practice&reading=<id>&los=<id>` selects an unstarted preview; validate the LOS belongs to that reading and manifest |
| Result → Curriculum | `/app/curriculum/<subject>/<reading>?los=<id>` opens/highlights the exact outcome; build the consumer if missing |
| Result → Coach | An owned structured attempt selector, implemented in page and API together; preserve current `proposal`/`repair` selectors and server-owned links |
| Result → repair | Exact existing proposal/thread; reuse the current preview/accept lifecycle and receipt |
| Repair/task → Calendar | `calendarTaskHref` with the task's own date/week, preserving old/continued-task behaviour |
| Mock → Calendar | Exact appointment selection and its date context; never substitute the next unrelated appointment |
| Result → weekly closure | `/app/review-week`, resolving missing/unknown logs before draft acceptance |
| Result → note | Reuse the existing private note record/editor and its conflict/draft handling; no second editor or automatic note creation on GET |
| Home → Tests/result | Same decision and capability as Tests; keep unconfirmed-scope anchor and startable/upcoming distinction |

Maintain safe return state. Validate all identifiers and internal return paths. An unknown/foreign object shows an unavailable state with a return action; it cannot select a different student's or unrelated current object.

Scope, scoring, Curriculum evidence and Calendar proposals remain server-owned. Reuse operating-state and result models. Share request-local data reads where practical; do not build OperatingState V3 or a duplicate progress store for the redesign.

## Test isolation and proof

The reported concurrent rehearsal/results failure is **unclassified**. A passing isolated rerun is useful but is not an explanation. Do not label it a race fix without evidence.

Inspect shared E2E identities, resets, fixtures, global inventory reads, model/DB timeouts and cleanup boundaries. Run mutating suites sequentially unless they use independent students and explicit recorded pools. Capture failed status/body, request ID, attempt/form/appointment IDs, fixture membership and server stage timings; redact tokens. If independent scenarios still fail under controlled concurrency, retain it as a product defect with a reproducible interleaving.

Required tests for this slice:

1. **Challenge ledger:** new-policy and legacy examples above, practice with zero evidence, omission with zero evidence, dispute/dismiss/uphold, all void, repeated resolution and submit/resolution concurrency. Stored/API/UI counts agree.
2. **Mock policies:** same-policy combined results; legacy expired session; mixed/unknown policies are explicit, not blended into a headline score.
3. **As-of evidence:** score A, then score contrary B; A's paper findings remain A, Current status reflects B. A later authorised challenge shows an adjustment. Unavailable reads never become zero history.
4. **Workspace states:** no scope, unconfirmed portion, Ready, Upcoming, resume, insufficient bank, result, follow-up, closure, error and exam-sat. No enabled dead-end buttons.
5. **Runner browser:** blank skip/return, partial discard, in-flight save/discard, save/reload/return, failed save and lost committed response, timer expiry and all blank. Assert actual selected option and confidence after reload; seeing the next question is not proof of restored answers.
6. **Cross-product browser:** Curriculum selection → preview → fixture paper → result → exact repair preview/accept → Calendar; Home/Tests/Curriculum agree after score and challenge. Also no-bank planning path.
7. **Both widths:** desktop and 390px with screenshots, no overlays/overflow, visible focus, Escape/return focus and safe navigation. Verify important information is visible without default-opening every detail.
8. **Read purity/access:** page/GET visits do not mutate state; ordinary users cannot access staff operations, foreign attempts or pre-submit keys.

Use existing focused suites first: ledger, depth, result, paper/rehearsal contracts, approval/practice DB regressions, challenge/repair tests, attempt races, taking/results and relevant route/access tests. Run `npm run verify` on the final tree. Re-run baseline install/upgrade/restore when a migration changes the effective schema/functions.

Use ordinary disposable accounts and separately recorded routine/held-out fixtures. Assert every fixture form belongs to its declared pool. Actual-bank shortage is UNAVAILABLE, not a scored-flow pass. This slice may not approve real questions or represent fixtures as content readiness.

## Definition of done and handoff

One ordinary student can understand the Tests workspace, select the right check, preview honestly, start/resume, skip/review/submit safely, read a compact valid result and reach the exact useful next action. Another student's historical paper and a bank-insufficient account remain correct. Every claimed browser behaviour has been clicked through.

Report:

- student-visible changes and linked route journey;
- each reproduced defect, fix and precise policy/version behaviour;
- tests and browser evidence, separating actual and fixture tracks;
- any unexplained failure and what was captured, without turning reruns into a cause;
- schema migration proof if applicable;
- known limitations, actual question-bank capacity and remaining T2/T3/T5/T6 work;
- cleanup by exact IDs and owned process handles, with canonical generated types restored.

After this slice, the next build priority is **T2 content operations and reviewer-ready bank supply**, then T3 difficulty adjustment. Do not defer question supply behind repeated cosmetic redesigns. Full question approval remains human work, while the agent completes the pipeline and its reviewable outputs. Stop at this slice's handoff so the owner can review before the next prompt.
