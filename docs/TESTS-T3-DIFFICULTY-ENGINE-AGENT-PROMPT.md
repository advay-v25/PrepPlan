# Roadmap — T3 difficulty adjustment and bounded adaptive practice

Prepared 10 November 2026, after the T2 handoff in master status §9.26.

## 1. Assignment and honest starting point

Build the difficulty-adjustment feature end to end in the existing Tests system. It must choose suitable reviewed questions, explain its choices, preserve valid assessment coverage and provide a usable adaptive-practice journey.

T2 delivered pipeline infrastructure, not operational question supply. The handoff reports zero eligible approved questions, zero authorised real source packs and no live-provider yield data. Preserve those facts. Build and prove this slice using explicit synthetic fixture banks; actual-bank mode must remain honest. Do not approve questions, clear rights, sign off curriculum concepts, or impersonate a reviewer to make the feature appear live.

Read `AGENTS.md`, Ponytail, relevant installed Next.js guides, founder decisions, the master Tests brief, the T2 prompt and status §§9.23–9.26. Preserve existing uncommitted work and coordinate shared files. No commits, deployment, domains, payments, new materials upload, chapter teaching or replacement assessment architecture.

Complete the bounded passes below and report the results. Do not return another plan or start a new Tests redesign. Content authorisation and expert approval are external dependencies; they do not prevent completing the software with labelled fixtures.

## 2. Preserve the existing product

- Three Tests views, preview before reservation, working deep links and compact results.
- Pinned scoring policies, equal marks, separate paper score/answered accuracy/completion and challenge adjustment history.
- Fixed official-session mocks, family/held-out separation and historical reservations.
- Atomic scoring, answer ordering, monotonic bounded telemetry, repair commands and weekly continuity.
- Completed/confirmed weekly scope, including manual learning, with explicit overflow beyond a capped paper. Missed work is not tested as learned.
- Self-study Monday–Saturday learning and Sunday verification; class-led cycles use the existing class-aware boundaries.
- Practice creates no demonstrated-understanding evidence, repair closure, first-pass completion or weekly-paper credit.
- The installed repair-resolution and confidence/evidence policies. Do not change support thresholds as a side effect of introducing a sampler.

Keep legacy stored counts under their recorded historical semantics. Use the form/challenge-derived ledger for factual delivery, omissions and completion. Do not repeat the `20261213`/`20261214` reversal by changing a legacy column's meaning in only one command.

## 3. What needs connecting

Current `assembly.ts` balances authored labels through `pickVaried`; this is not learner adaptation. `assessmentDecision.ts` owns shared preflight, and `startAssessment.ts`/`reserve.ts` own reservation. Timed practice is currently one ten-question shape. Extend these paths rather than making a competing selector.

T2 added difficulty filters but no explicit authored-difficulty review workflow. A generator's `intended_difficulty` is not a reviewer-confirmed level or empirical calibration. Complete that minimal prerequisite in this slice.

Review comments and consumers that still say an unknown family is independent. A null family or unconfirmed construction cannot become verified transfer because the adaptive engine needs more questions. Keep legacy observations labelled with their actual provenance; do not retroactively manufacture family confirmations.

## 4. Pass A — reviewed difficulty metadata

Use the current levels `foundation`, `standard`, `difficult`, `stretch`. Keep their existing identifiers compatible. Add the smallest extension to current item editing/review needed to record:

- proposed authored level;
- reviewer-confirmed level and short cognitive-demand rationale;
- reviewer identity, item version and decision timestamp;
- optional later empirical statistics in separate fields, initially unavailable.

Review rubric:

| Level | Intended demand |
|---|---|
| Foundation | Direct recognition, a relationship or a short calculation with clear assumptions |
| Standard | Ordinary Level I application/interpretation, or a modest sequence of justified steps |
| Difficult | More demanding but fair integration/discrimination within the same Level I scope |
| Stretch | Optional challenge framing; not permission for off-syllabus content, missing assumptions or trick English |

Difficulty is not determined by stem length, a fixed count of arithmetic operations, obscurity, or how often a small sample gets an item wrong. Distractor plausibility, required distinctions and cognitive demand matter. Reviewers can correct a proposed level through the existing edit/version/approve workflow.

New approvals must explicitly acknowledge the level/rationale under the new review contract. Do not bulk backfill reviewer confirmation from existing generator tags. Preserve historical approvals and scores. Existing unclassified content may remain usable under its existing non-adaptive policy, clearly labelled; it cannot satisfy a reviewed-difficulty quota or support a calibrated claim.

Published/used metadata must stay reproducible. Freeze the difficulty interpretation used by a reserved form. Reclassification uses the current item-version mechanism or an equally explicit metadata revision; it cannot relabel an earlier student's paper invisibly. Update fixture approval helpers through the real reviewer command.

No automatic empirical relabelling in this slice. Store space for future observed difficulty only if necessary; do not build a psychometric model before sufficient data exist.

**Exit:** a reviewer can inspect, correct and confirm a level for the exact item version; the selector can distinguish confirmed from proposed/unknown levels.

## 5. Pass B — one deterministic difficulty policy

Implement a pure, versioned policy in the existing domain. One proposed name is `difficulty-policy.1`. Names may follow repository conventions, but there must be one definition consumed by preview, reservation, results and practice.

Separate:

1. Authored item difficulty.
2. Learner evidence for the selected scope.
3. Selected form/profile and delivered mix.
4. Empirical item calibration, which is not available yet.

This is rules-based adaptation, not IRT, CAT, ML training or a pass predictor. The model cannot choose marks, change a clock, authorise scope or silently replace a question.

### Evidence eligibility

For adapting evidence-bearing papers, use recent, valid, scored, human-approved observations with confirmed independent families, appropriate curriculum edition and pinned difficulty metadata. Exclude voided/disputed observations, practice-only responses, repeated familiar families, fixtures outside test mode, unscored attempts, missing mappings and unsupported policy versions.

Use the existing shared recency boundary, currently `STALE_DAYS = 21`, or its canonical equivalent. Do not create a second conflicting freshness constant. Record the effective cutoff in the decision. An interruption or absence of telemetry is not an incorrect answer.

Count one independent observation per family in the decision window; question variants do not inflate the sample. Use deterministic date/ID ordering. Require at least **eight** independent eligible observations across **two completed attempts** before personalising a scope.

Use at most the twenty most recent eligible independent observations in the applicable scope/window. Eligibility requires first-exposure provenance; do not replace an earlier first-exposure miss with a later familiar-family success. “Newest observations” below means the newest three in this filtered set. A repeated uncertainty pattern means at least two of those three were correct with low or medium confidence. Confirmed standard-level successes used for challenge eligibility must have high confidence. These are explicit beta defaults, not validated psychometric cutoffs.

Prefer the exact tested concept, then the selected LOS. A reading-level fallback is allowed only with adequate history in that reading across multiple outcomes, labelled as broader context. Do not transfer Ethics proficiency to Fixed Income, or a few successes in one concept to every concept in a reading. Where evidence is inadequate, use the cold-start profile for that scope.

These thresholds are conservative beta operating rules, not statistical proof. Preserve them as versioned configuration with tests; no operator can silently change a reserved form by editing a constant.

### Diagnostic profiles

Use three bounded profiles over confirmed authored levels:

| Profile | Foundation | Standard | Difficult |
|---|---:|---:|---:|
| Balanced / cold start | 25% | 50% | 25% |
| Foundation support | 50% | 50% | 0% |
| Application challenge | 0% | 50% | 50% |

These are provisional engineering defaults, **not official exam difficulty distributions**. Stretch is excluded from ordinary diagnostics/revisionary papers under this policy. Do not change the content/subject quotas to achieve the difficulty proportions.

Suggested deterministic decisions for adequately sampled scope:

- Challenge eligibility: at least 80% correct, at least two independent standard-level successes, no unresolved confident miss among the newest eligible observations, and no repeated low-confidence pattern. Correct-but-unsure should favour an independent verification or confidence-building approach, not an automatic jump.
- Foundation support eligibility: at most 50% correct with repeated standard-level misses across the required attempts. A single difficult miss does not demote the learner or cause a subject restart.
- Otherwise use Balanced. A recent confident miss may prioritise a targeted repair while the rest of the paper stays broad.
- Timing alone never changes correctness or demonstrates conceptual weakness. Repeated slow-correct work may offer the existing fluency/timed-practice path.

Keep at least half of an ordinary paper at standard level when the eligible inventory permits it. A first eligible change is at most one profile step. Prevent reversals from one answer or preview refresh: require at least two newly completed relevant attempts since the previous profile change before switching between support and challenge. Derive this from scored form/decision history rather than a new opaque learner score. If a challenge invalidates the evidence basis, fall back honestly to limited-evidence behaviour for future forms; do not modify an open form.

The ordered profiles are Foundation support → Balanced → Application challenge. An update moves at most to an adjacent profile; it cannot jump directly from support to challenge. A scope with fewer than eight eligible observations uses Balanced, with the limited-evidence reason, rather than retaining an unsupported personalised label.

Expose decision reasons in plain words, including the scope/sample and whether broader reading evidence was used. Never tell a student “you are a weak student” or claim a profile is their permanent ability.

### Purpose boundaries

- Weekly, reading, subject and revisionary checks may adjust between forms while preserving completed/confirmed scope and breadth.
- Repair re-checks retain their exact concept, independence, spacing and installed resolution rules. Do not make them easier merely to close a thread. If selecting a difficulty mix there, use the declared fixed verification policy and report unavailable depth honestly.
- Mock difficulty is fixed before reservation and identical in policy for different learner histories. Do not personalise either session. Retain the declared static mock profile and session quotas; if introducing a new profile or stretch exclusion, version it for new forms. Never call the selected mix calibrated without evidence.
- Existing fixed timed practice remains ten questions at its existing declared limit. Adaptive practice is a separately labelled mode described below.

**Exit:** deterministic decisions with provenance and no changes to marks, understanding thresholds, study-hour targets or mock difficulty based on learner identity.

## 6. Pass C — integrate coverage-first selection and atomic reservation

Extend the shared decision and assembly contracts. The order of constraints is:

1. Existing access, scope, exact-version publication, rights, manifest mapping, family and exposure admission.
2. Completed/confirmed outcome coverage and the 90-question ceiling.
3. Existing subject-weight/readings-size allocation and pending scope.
4. The applicable difficulty target, then cognition/form variety and a reproducible random tie-break.

Coverage and correct authorisation outrank difficulty preferences. A lack of difficult items cannot send a student to unrelated material. Ordinary evidence-bearing papers may use the best eligible mix with an explicit shortfall/actual-mix explanation when the difficulty preference is soft. Do not reduce a feasible broad paper to only easy outcomes. Strict declared mock/re-check constraints remain strict.

Use deterministic integer apportionment for a requested mix. Preserve fractional targets in the metadata; round actual counts so they sum to the real form size. Report coverage-floor effects and missing reviewed levels. Unknown/proposed tags are not silently treated as Standard.

Test greedy-selection traps. Example: outcome A has eligible families X and Y, outcome B has only X. Selecting Y for A and X for B covers both; choosing X for A must not create a false bank shortage when a feasible independent selection exists. Use the smallest adequate matching/backtracking or equivalent repair to the selector; no large optimisation dependency is needed.

Add a seeded deterministic tie-break. The same reviewed decision and unchanged inventory must not return a new mix whenever the student refreshes. A new genuinely started paper can use another seed and fresh families. Do not expose item IDs, keys or a client-selectable pool in preflight.

The reserved form/attempt records, using existing JSON metadata where suitable:

- difficulty policy version and purpose;
- target profiles/quotas and actual delivered mix;
- effective evidence timestamp/revision, independent sample and decision reasons;
- source scope/manifest, reviewed item/difficulty versions and selection seed;
- shortfalls, fallback basis and practice-run/block identity if applicable.

Reservation must validate approval/family/scope again. If changed evidence, metadata or scope would materially change the reviewed decision, return a stale preview requiring review; do not silently reserve a differently described form. Extend the existing transactional revision/lock mechanism as necessary. A separate unchecked comparison in TypeScript is not an atomic stale check. Keep a consistent lock order and preserve effective scoring/repair functions if they need changing.

An existing open attempt resumes before fresh pool selection. An accepted form's questions, difficulty, deadline and scoring policy never change because the student answers well, poorly or slowly.

**Exit:** Tests, Calendar, Home and Curriculum see the same capability/description, and start pins the form the student reviewed.

## 7. Pass D — bounded adaptive practice

Add an Adaptive practice choice to the existing Practice and checks view. It is a sequence of fixed five-question sets, not a mutable assessment that swaps questions mid-flight.

### Student flow

1. Select a reading and optional LOS/concepts. A Curriculum link preserves those selections.
2. Choose Adaptive practice and a total cap of **10 or 20 questions**. Default ten. Each set is five; existing fixed timed practice is unchanged.
3. Preview the scope, estimated length, initial approach, content availability and the statement that practice does not verify understanding or earn weekly-paper credit.
4. Explicit Start atomically creates/resumes an owned practice run and its first immutable practice attempt.
5. Answer with the existing confidence/save/skip/review behaviour. Adaptive practice is untimed/pausable by default; show estimates, not a hidden deadline or a timer promise derived from fixed timed practice.
6. On set submission, show a short practice result, what the next set would change and why. Offer Continue, Stop here or the existing return action.
7. Continue explicitly reserves the next set. Never reserve future items automatically or append them to the open form.
8. At the cap or Stop, show a compact run summary with actual delivered/answered counts and a useful next action. No mastery award, repair closure, streak penalty or lesson generation.

### Practice adjustment rules

Start from relevant adequate evidence when available, otherwise Balanced. Practice history may guide later practice sets through a separate practice-only decision path; it does not enter the durable understanding ledger.

Raise the practice profile by at most one step after **two consecutive fully answered five-question sets** at or above 80% correct, with sufficient standard-level questions and no repeated confidence mismatch. Thus a ten-question run can influence a later run; a twenty-question run may adjust its third/fourth set.

For this beta rule, the pair must contain at least two independent, correct standard-level observations. Evaluate scope-relevant practice history within the same shared recency window. A missing standard sample is insufficient evidence to advance; it is not an incorrect answer. For downward support, require at least four answered items in each of two consecutive sets and at most 50% answered accuracy in both; omissions alone cannot trigger it.

Offer foundation support after repeated difficulty across two adequately answered sets, not after one mistake or an interrupted/mostly omitted set. Distinguish “not enough observations” from a low result. Low-confidence successes can hold the level and recommend a fresh independent check. Repeated familiar items cannot satisfy an independent advancement condition.

Respect the selected scope, fresh routine-family availability and total cap. If fewer than five suitable questions remain, do not pad, loop known variants or silently increase the cap. Show the remaining limitation and let the student end. Do not consume held-out items. Familiar-question review, if retained elsewhere, stays labelled and cannot count as fresh adaptation evidence.

### Persistence and commands

Reuse existing practice attempts and the standard answer/submit/result endpoints. Add only the minimal run identity/state needed to link sets, enforce the cap and resume. A run owns user, canonical scope, policy, cap, current revision/status, block ordering, prior decision and immutable attempt links. Enforce one attempt per run/block and prevent a new run from resuming another mode's ten-question timed attempt accidentally.

Suggested API contracts, adapt names only if an existing equivalent already exists and document both callers and consumers:

| Contract | Behaviour |
|---|---|
| `POST /api/tests/preflight` with `kind=practice`, `mode=adaptive`, scope and cap | Read-only initial preview; no run, form or exposure write |
| `POST /api/tests/start` with the same mode, preview revision and request key | Atomic owned run + first set or retry/resume; returns run ID and normal attempt URL |
| `GET /api/tests/practice-runs/[id]` | Owned state, completed sets, pending decision and permitted next action; read-only |
| `POST /api/tests/practice-runs/[id]/next` | Expected run revision + retry key; previous set must be terminal; recompute/validate the next preview and atomically create one next attempt |
| `POST /api/tests/practice-runs/[id]/stop` | Idempotent boundary stop; no further set can be reserved |

The new-set preview can be returned with the current set result/run state or through preflight. Client input cannot choose items, scores, level, held-out status or whether an attempt produces evidence.

Stop applies at set boundaries. While a set is open, offer Leave/resume or explicit submission with omissions; do not destroy or secretly score work through the stop button. Concurrent Continue/Stop, duplicate starts, lost responses and two-device actions must converge to a valid single outcome with no duplicate question consumption or cap overflow. Keep existing deadlines/late-answer rules for timed practice and mocks.

Update ordinary result/runner labels so an adaptive set says Practice set, not Diagnostic or the old fixed Timed practice label. Each set result exposes the correct next-set/run destination. Record all answered confidence and telemetry, while asserting no evidence event, repair-state change or weekly credit is produced.

**Exit:** preview → start → answer → result → next set → stop/cap → reload/resume works through actual student endpoints and UI.

## 8. Cross-product links and display

- `/app/tests?view=practice&reading=<id>&los=<id>` continues to select an unstarted practice flow. Add an allowlisted optional mode selector; URL state cannot bypass scope or baseline permission.
- Weekly card/preflight shows a short explanation such as “A broad check, with extra foundation questions in the areas recently missed.” Expand counts and reasoning on demand.
- Results show the actual mix and whether difficulty changed between papers. Raw scores from different mixes are not a validated improvement curve or pass probability.
- Curriculum still distinguishes coverage, self-rating and scored understanding. Practice may be shown as practice activity, never verification. Existing LOS/result/note links remain exact.
- Calendar continues to own accepted work. Difficulty adjustment cannot silently change durations, commitments, tasks or next-week scope. A timing/repair finding uses the existing preview/confirm commands.
- Coach may explain the recorded profile and offer existing scope-specific actions. It cannot invent a level, teach the reading, alter marks or execute a calendar change without confirmation. Its fallback retains identical facts/links if the provider is unavailable.
- Home's understanding/preparation signals remain evidence-owned. Practice completion does not inflate them. Missing bank coverage is incomplete evidence, not a failing ability score.

Keep the three-view Tests layout. Use compact explanations and disclosures, not a new learner-settings dashboard or an extra primary tab.

## 9. Acceptance scenarios and tests

Use ordinary disposable accounts, separately recorded routine/held-out synthetic banks and the real reviewer/approval commands. Synthetic difficulty labels prove software branching, not CFA calibration.

| Scenario | Required result |
|---|---|
| Fresh learner / no history | Balanced default, clear basis, no invented ability |
| Seven observations or only one completed attempt | No evidence-driven diagnostic adjustment |
| Eight eligible independent observations across two attempts | Correct scoped profile decision with deterministic reasons |
| Eight variants of one family | One independent observation, not eight |
| Valid versus disputed/voided/practice/unknown-family | Only eligible evidence drives diagnostic adjustment |
| Right but unsure / confident wrong / slow correct | Distinct response; no confidence mark multiplier or timing-based conceptual demotion |
| Reversal / new single miss | No profile oscillation from one answer or refresh |
| Three subjects covered, uncertainty in two | Relevant scope-specific support; no first-pass restart or assumption that all subjects share ability |
| First pass complete, mock soon | Revision sampling uses relevant evidence; mock stays fixed; no mandatory chapter marathon |
| Mixed new/revised week | Coverage and section semantics survive personalisation |
| 100+ confirmed outcomes | Ceiling and named pending scope survive; hard/easy quotas do not defeat breadth |
| Scarce difficult items / unknown difficulty | Actual mix or precise mode shortfall shown; no unrelated padding or false level confirmation |
| Family-sharing greedy trap | Feasible breadth found; no false insufficiency caused by early tie-breaking |
| Same mock for two learner histories | Same static policy/session quotas, without a personalised easy form |
| Re-check with recent misses | Existing scope/spacing/resolution policy retained; not made easier to close |
| Adaptive practice cap | Sets of five, correct ten/twenty cap, boundary stop and safe resume |
| Continue/Continue and Continue/Stop races | One next attempt or stopped run; no mixed outcome/duplicates/overflow |
| Practice before/after | No evidence, readiness, repair closure or weekly-credit changes |
| Metadata edit or new evidence after preview | Stale review or explicitly versioned safe admission; no silently different described form |
| Reserved item reclassification | Historical form metadata/results remain pinned |
| Actual bank empty | Honest unavailable practice; normal planning still works |

Run pure policy/property tests across many seeds and adversarial pools, then relevant live endpoint/database suites. Test zero, odd and ceiling-sized form allocation, invalid inputs and insufficient metadata. Inspect database grants and ownership for any new run/command; students cannot insert completed runs or set their own difficulty history directly.

Browser proof at desktop and 390px must cover Curriculum-selected entry, initial preview purity, five-answer set with required confidence, change explanation, explicit next set, stop/cap, reload, failed/lost response and scope shortage. Use the Browser plugin when available, otherwise installed Playwright with a recorded fallback. Verify actual restored state, not just navigation.

Close the three previously missing browser checks in the same session where practical: insufficient-bank Week state, stale scope in a second tab and result → repair preview/accept → Calendar. Keep them listed if unrun; do not mislabel fixture or HTTP coverage as browser proof.

Run `npm run verify` on the final tree and the relevant scoring, reviewer, paper/rehearsal, repair, progress, taking/results, scope and access regressions after their contracts change. New migrations require effective-function comparison and install/upgrade/restore proof. Preserve T2 worker/grounding/fencing/budget tests. Do not run live generation without authorised source packs or repeat unrelated expensive suites after cosmetic edits.

## 10. Handoff and completion boundary

Deliver the feature plus evidence, not a calibrated-model claim. Report:

1. Student and reviewer flows completed, with route links.
2. Policy version, thresholds, history filters, fallbacks and why the examples produced their profiles.
3. Exact test results and browser cases, separating actual bank, synthetic fixtures and provider simulation.
4. Proof that marks, old attempts, mocks, practice evidence exclusion and repair rules remain intact.
5. Actual approved/difficulty-reviewed capacity and external source/rights/concept/reviewer dependencies.
6. Remaining gaps, unexplained failures and any measured performance issue. A fast rerun does not classify the earlier 29–70-second heartbeat cause.
7. Cleanup by exact fixture/account IDs and owned server handles, canonical generated types, migrations/baseline state and no unintended commits.

Do not mark real content ready because this engine runs on synthetic banks. The next feature work is T5/T6 cross-product completion and the remaining journey/performance audit. The parallel operational dependency remains authorised source packs, concept sign-off and human question review. Stop after this handoff for the owner's review.
