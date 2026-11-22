# Roadmap — Coach revamp and connected lifecycle closeout

Prepared 12 November 2026 after master status §9.28 and the owner's request to include the full Coach.

## 1. Assignment and completion boundary

Complete the remaining student lifecycle journeys and rebuild the Coach's scope, language understanding, responses and action handoffs end to end. Preserve the existing Tests, difficulty and transactional work. Do not restart the app, redesign every page, or return another proposal instead of building this slice.

Read `AGENTS.md`, Ponytail, relevant installed Next.js guides, founder decisions, the master Tests brief, previous T3/T5 closeout prompt and status §§9.25–9.28. Preserve the owner's uncommitted work. No commits, deployment, payments, domains, access-policy changes or self-granted staff roles.

Roadmap is a CFA Level I planning and accountability product. Coach helps students decide **how and when to study** using their actual plan and assessment evidence. It must understand ordinary phrasing, typos and follow-ups without becoming a curriculum tutor or an unchecked scheduling agent.

Use the existing Coach, planning, assessment, repair and profile services. A language model may interpret language; server code owns authorisation, factual claims, scope, capability, proposals and execution. Do not build a second planner, scorer, evidence store or generic autonomous-agent framework.

The real bank still has no eligible approved questions or authorised source packs. This does not prevent building Coach against real app state and labelled assessment fixtures. It prevents claiming real diagnostic coverage. Human rights/content sign-off is separate from software work.

## 2. Review findings and preserved fixes

Accept C1–C6 and the reservation/reclassification lock work as delivered, subject to regression testing where touched. The review independently reran policy tests 65/65, score-ledger tests 15/15 and the route audit, which passes. Do not reopen those designs without a reproduced defect.

However, fragments of old HTTP suites do not prove the three requested lifecycle journeys. The reported browser route started from `mode=adaptive`. An adaptive practice result cannot itself prove the weekly diagnostic → evidence → repair → weekly closure loop: practice creates no such evidence or credit. A previously existing repair link is a different source. Prove the source attempt and lineage explicitly.

### Coach findings from current source/probes

| Finding | Evidence and required response |
|---|---|
| Brittle interpretation | `i msised tday can u repln my calender` routes to generic free text. Normalise common wording and use bounded semantic interpretation where needed. |
| Wrong boundary refusals | `teach me how to organise my revision` and `I don't want you to teach me FSA; I need a revision plan` both classify as teaching. These are legitimate planning requests. |
| Negation ignored | `I haven't missed today; what should I do next?` classifies as a missed day. It must not propose deferring today's tasks. |
| Mixed request loses boundary | `I missed today; teach me this chapter` classifies only as a missed day. Help with recovery and decline the teaching component separately. |
| Client hint treated as authority | `/api/coach` accepts `intent` over the message classifier. A forged/stale quick-action hint cannot bypass policy or create a mismatched proposal. |
| Narrow actual actions | The only direct proposal type is `defer_today`. Many other intents return generic links. Deliver the capabilities below through existing shared commands or exact prefilled editors, not claims of unsupported actions. |
| Misleading quick prompt | Remove “Teach me this chapter” from primary suggestions. Test refusals in the evaluation suite instead of advertising a forbidden feature. |
| Context gaps | The chat receives selected `attemptId`, but selected repairs/proposals are not consistently carried as structured request context. Pronouns such as “this one” must resolve to the selected owned object or prompt clarification. |
| Conversation reliability | The client clears input before the request, has no durable turn retry key, and leaves an optimistic message after failure. Server message/proposal writes are separate. A lost response must not duplicate messages, paid calls or pending proposals, or lose the student's question. |
| Weak failure semantics | History reads can collapse errors into empty conversation; some selected-context loaders suppress errors. Show unavailable instead of inventing no history/no evidence. |
| Effect wording | Deferral is committed before best-effort redistribution. Coach must distinguish “deferred”, “placed on Thursday”, “still unplaced” and “redistribution not confirmed”, using receipts. |

The current 43 action tests and six simple boundary tests pass; the probes above expose missing coverage. Current provider-output regex checks do not prove semantic understanding or prevent every unsupported factual claim.

## 3. Pass A — define and enforce Coach's scope

Create one typed capability/policy registry consumed by the API, interpreter, quick actions, response builder and tests. Each capability declares its required context, allowed input, read/preview/confirmation behaviour, canonical service and limitation states. Use `available`, `needs_clarification`, `needs_confirmation`, `unavailable` and `out_of_scope` or equivalent explicit states.

### Allowed capabilities

| Student need | What Coach actually does |
|---|---|
| Today / next action | Identifies accepted work, open sessions, due decisions and unplaced/overdue work using the same ordering as Home. Opens the exact object. |
| Missed or partial work | Clarifies what happened, keeps actual reported time/partial status, previews recovery and preserves continuation history. Does not assume everything today was missed. |
| Move/defer a block | Resolves the task, target date/window and intent; previews feasible changes, conflicts and work left waiting; confirms through the canonical Calendar command. |
| Lighter/heavier week | Explains the current draft and offers a capacity-respecting proposal. Does not prescribe an arbitrary new weekly study-hour target. |
| Availability, travel, illness or class changes | Opens the exact prefilled editor or shared preview/confirm flow. Changes neither historical weeks nor protected commitments silently. |
| Log learning/class | Opens the existing capture flow with extracted date and proposed reading/LOS mapping. Uncertain mapping stays unconfirmed; recording learning does not prove understanding. |
| Result discussion | Explains what an owned scored paper showed, its score basis, completion, confidence, timing and limitations. Distinguishes practice, external report, single session and combined rehearsal. |
| Weakness and SWOT | Names supported narrow observations and verified dependency-based opportunities/threats, with sample and source. Self-reported uncertainty remains self-report. |
| Repair and re-check | Opens/reuses the exact repair follow-up, proposes work through existing commands and explains eligibility/spacing. Never invents a thread or marks something repaired from activity alone. |
| Diagnostic/practice request | Prepares the existing Tests preflight for the selected scope/mode. Explicit Start assembles approved questions; it does not generate unreviewed questions live. |
| Confidence / slow correct work | Separates uncertain success, confident miss and fluency. Suggests an appropriate existing check/practice approach without changing marks or inferring laziness. |
| Revision / first pass / mock phase | Uses the existing roadmap and revision rotation; no mandatory restart for a midway entrant or chapter-by-chapter baseline near a mock. |
| Mock planning/debrief | Opens the exact appointment, checks real capability, distinguishes external self-report and internal evidence, and prepares a manageable debrief/recovery proposal. |
| Weekly closure | Explains unresolved logs, opens the contextual review and carries choices into its saved draft/acceptance lifecycle. No new weekly-review tab. |
| Exam target / exam sat | Uses the canonical editor/command; tentative window versus booked date stays distinct. Exam-sat state pauses study pressure while retaining history. |
| Notes / app help | Opens an exact existing note or explains how to use Roadmap and study methods. A note does not create evidence. |

### Strict limits

- No teaching a CFA chapter/concept from scratch, deriving a curriculum formula, solving a new finance question, generating lecture notes or supplying answers during an open assessment.
- An existing post-submission result may be summarised as evidence (“this answer suggests a period-selection issue”). Link its approved explanation. Do not generate a replacement solution or pretend to know the student's thought process.
- Study-method guidance is allowed: retrieval before rereading, explaining a distinction in the student's own words, planning spaced checks, or practising application. “How should I study FSA?” is not the same as “teach me FSA”.
- No pass guarantees/probabilities, shame, suitability verdicts, unsupported mastery labels or diagnosing a student from missed blocks.
- No invented scores, curriculum relationships, citations, provider locations, page numbers, dates, available hours or completed actions.
- No direct protected-commitment changes, raw database writes, content approvals, access changes, arbitrary web browsing or third-party account actions through chat.
- Resource guidance uses actual curriculum/LOS identifiers and known provider/class context. If a learning location is unknown, suggest the relevant section in the student's existing CFA material; do not invent a source feature.

For mixed requests, answer the legitimate part and briefly redirect the excluded part. Do not refuse app help merely because “teach” or “explain” appears. If the user asks to manipulate evidence, turn a practice score into readiness or bypass a test, explain the valid alternative without moralising.

**Exit:** a tested scope matrix, with every advertised capability linked to a working service or exact editor and honest unavailable states.

## 4. Pass B — robust language understanding and conversation context

Preserve the original message. Create a separate normalised interpretation input: Unicode/whitespace/apostrophe normalisation, common app-term spelling variants, and aliases from the active curriculum. Never autocorrect record IDs, numbers, dates or quantities into guessed values.

Use high-precision deterministic recognition for obvious cases and a bounded structured semantic interpreter for unclear phrasing. Do not keep adding hundreds of regexes as the only solution. Reuse the existing model gateway and provider abstraction; no custom model training is required before this feature can work.

The interpreter returns a validated request description, for example intents, entity mentions, relevant time expressions, allowed/disallowed components and ambiguities. It does not return executable SQL, an arbitrary endpoint, trusted ownership, a new mark or a final calendar change. Numerical “confidence” from a model is not a calibrated guarantee.

Support:

- common typos, punctuation-free sentences, contractions and abbreviations such as FSA/FI/QM/CI;
- negation, hypothetical statements, past versus future and corrections (“not tomorrow, Friday”);
- multi-intent requests (“my mock went badly and I work Saturday now”);
- pronouns and short follow-ups (“that block”, “the second one”, “same week”, “yes, move it”);
- practical Indian-English phrasing. Include a modest set of common Hinglish examples if handled reliably; otherwise ask a helpful clarification rather than claiming universal language support;
- “kal”, ambiguous date phrases, “next Sunday”, “this paper” and ambiguous subject aliases through visible clarification when context cannot resolve them safely.

“Missed today” can mean reporting past execution or requesting a recovery plan. Distinguish those actions before changing records. “No, I didn't miss it” must correct the interpretation rather than confirm an earlier proposal.

Use account-scoped conversation state and a validated selected-object reference: attempt, rehearsal, repair, proposal, task, appointment or reading/LOS. Resolve against owned/current data on the server. Selected context outranks a generic latest result. An invalid selected object does not silently fall back to an unrelated result.

A prior chat statement is not a current fact about the Calendar. Reload authoritative state before a proposal. If a student says “remember I have a class Tuesday”, use the actual class/commitment editor and confirmation; do not quietly store it as a competing schedule memory.

Ask one concise clarification when a material detail is missing, preferably with two or three object/date choices. Do not ask a question whose answer is already in the selected object or current app state. Read-only help can proceed with labelled assumptions; writes require resolved targets and explicit confirmation.

Treat a UI `intent` value as an untrusted hint. The server validates it against the message/context and scope policy. A request with teaching text plus `intent=today` or `intent=day_was_bad` cannot bypass the boundary. Source text, notes, history and student messages cannot override system policy or supply trusted action IDs.

On model failure, clearly understood deterministic requests still work. Unclear mutation requests become clarification, not a guessed change. Unknown wording must not fall through to an apparently successful but irrelevant plan.

**Exit:** the failed probes in §2 work correctly, and paraphrases/typos do not change the authorised meaning or effects.

## 5. Pass C — grounded replies, tools and trustworthy changes

### Context and response contract

Build minimal intent-specific context from existing operating state, assessment decisions, result service, Curriculum, repair state and Calendar. Keep reported coverage, execution, scored evidence, confidence, practice history and unknowns separate. Include object identity, validity, sample, revision, timestamp and capability.

Do not feed the model raw books, full private notes, pre-submit keys, unrelated student records or every database row. Keep bounded recent history and context size. Avoid loading the whole world twice for a simple next-task question.

Use structured response blocks with server-approved fact/action references. Render factual counts, dates, task names and destinations from trusted records. The model may help interpret wording and provide concise non-factual connective language; it cannot invent factual blocks, sources or links. Regex filtering of free-form text alone is not sufficient.

Each useful reply should normally contain a direct answer, a short evidence/limitation statement and one primary next action, with at most two alternatives. A long repeated dashboard summary is not a conversation. Dates/times already in the Calendar may be displayed by the server; do not ban all useful schedule details just because arbitrary model dates are unsafe.

An unavailable evidence read produces unavailable, not zero/“no tests”. A selected practice result remains practice even if it contains wrong answers. A selected rehearsal should show the combined result where appropriate, not describe Session 1 as the complete mock. Uncertain SWOT relationships stay inferred or absent.

### Tools and calendar recovery

Use an allowlisted tool/capability registry over existing services:

- readonly context/result/capability queries;
- assessment preflight and explicit start/resume;
- task/current-week recovery preview and confirm;
- existing repair preview/accept and re-check capability;
- class/learning log and availability/commitment editors/commands;
- checkpoint/mock planning and weekly closure.

At minimum, implement direct preview/confirm for a specific movable study block and for today's recovery, plus exact repair/test handoffs. Complex availability/class/mock edits may use a prefilled canonical editor where it is the existing safe owner. Do not label navigation as execution or claim a rescheduling capability with only a generic Calendar link.

Resolve target tasks, actual free windows, sitting limits, classes, protected time, mock bookings, cycle boundaries, prerequisites, spacing and exam horizon through the shared planner. The model does not choose an unchecked slot. Preserve completed/partial work, reported minutes, continuations and historical cycles.

A proposal shows before/after, exact affected tasks, reasons, what stays due, what remains unplaced and relevant trade-offs. No room means honest waiting/unplaced work or a reviewed next-cycle draft, not silent overbooking. Changing a weekly-hours number is not a substitute for planning.

Confirmation uses the existing atomic domain command or a minimal extension with version/ownership/stale checks and a receipt. Never implement a multi-task “transaction” as several independent HTTP writes. Repeated confirmation returns the original outcome; any invalid affected task causes the declared all-or-nothing operation to refuse.

Support a clear textual confirmation only when it unambiguously refers to one current, visible proposal. It goes through the same command as the Confirm button. “Yes” with two proposals, a changed subject or no pending confirmation asks clarification; it does not approve everything. Explicit approval already given for a concrete fresh proposal need not be asked for twice.

Use precise receipt language: deferred is not necessarily rescheduled. If redistribution is best effort, return placed/deferred/unplaced/failed-to-confirm effects separately and provide a recovery action. Do not say “I moved it to Thursday” until the durable receipt proves that placement.

Do not create standalone repair tasks from chat or close a repair because a student says it feels fine. Reuse the existing thread and accepted follow-up. If the user asks for a paper, assemble only the approved bank through Tests; bank shortage stays visible.

### Message and proposal reliability

Add an account-scoped turn/request key. A send or retry records one original student message, one resolved answer and one set of proposal references. A response lost after commit replays that turn without another paid call or duplicate pending proposal.

Persist the answer/proposal references/receipt consistently. If context/model work fails, retain the original message and a recoverable state; do not claim “nothing was created” if a pending proposal already committed. Use the smallest durable turn/receipt extension to existing tables, not a generic agent job platform.

Apply model-call rate/cost limits atomically and count retries once according to the documented rule. Do not let concurrent count-then-insert requests bypass the budget. Clear request deadlines and abort actual provider work where supported, reusing T2's cancellation pattern. A timeout must not keep consuming unbounded calls in the background.

Clear history only clears the conversation and cancels applicable pending proposals under the current policy. It never deletes accepted task history, scored evidence or receipts. Confirm/Clear and Confirm/Dismiss races require consistent outcomes. Load/delete failures must be visible and retryable.

**Exit:** interpretation → grounded answer → exact preview → confirmation → durable receipt → refreshed app works after retries and from two devices.

## 6. Pass D — Coach UI and prompt/evaluation package

Retain `/app/coach` and existing selected-object links; extend validated selection for task/appointment/rehearsal where needed. `/api/coach`, `/api/coach/history` and `/api/coach/proposals/[id]` keep access/ownership checks. Document any new tool/preview route and every caller.

Preserve and verify these route connections; inspect each page's actual query contract before constructing a link:

| From Coach | Canonical destination and required context |
|---|---|
| Next task, recovery or accepted proposal | `/app/calendar`, with the exact task, its own date/week or booked appointment selected. |
| Log a taught class | `/app/calendar/log-class`, prefilled where the existing contract allows; confirm uncertain curriculum mapping. |
| Record independent learning | `/app/log`, carrying the relevant reading and the actual date rather than marking a task done from chat. |
| Reading, related notes or reported coverage | `/app/curriculum/[subject]/[reading]`, with validated identifiers and the existing section/selection contract. |
| Scope, capability or practice preview | `/app/tests`, with allowlisted view, reading/LOS and mode parameters; the server revalidates eligibility. |
| Resume or discuss an assessment | `/app/tests/[attemptId]` or `/app/tests/[attemptId]/result`, resolving the owned attempt and its kind. |
| A linked rehearsal | `/app/tests/rehearsal/[id]`, retaining appointment and session context. |
| Weekly closure and continuation choices | `/app/review-week`, for the correct cycle and existing saved-draft lifecycle. |
| Change exam target | `/app/exam` or the existing canonical setup editor reached from it; do not introduce another exam write path. |
| Preferences or availability editor | `/app/settings` or its existing exact editor, with a safe return to Coach where supported. |
| Review the outcome | `/app`, `/app/tests`, `/app/curriculum` and `/app/calendar` reload the authoritative state affected by the confirmed command. |

Resolve exact repair/proposal links through the existing selection/follow-up contract. Do not invent query parameters that render successfully but select nothing. Keep existing valid deep links working, with explicit unavailable states for foreign, removed or superseded objects. Read-only page loads and previews must not mutate plans or start assessments.

The page should have:

- a short scope statement: planning, progress and recovery;
- one selected-context card with a clear switch/clear action;
- three or fewer relevant suggestions, not nine repeated buttons and a forbidden teaching prompt;
- readable threaded replies and compact action/proposal cards;
- a composer that retains failed input, supports Retry, handles IME composition safely and does not double-send on Enter;
- honest loading, offline, rate-limited, unavailable and stale states;
- preserved scroll position while reading history, accessible focus/status announcements and no floating control blocking the composer at 390px;
- a clear-history action with visible failure/success and retained confirmed-change records.

Update `CoachClient` from the authoritative response after replay/confirm. A browser refresh must show the same turn/proposal state and actual links. Do not fill missing history with a blank “first conversation” screen.

Deliver versioned interpreter and response/boundary prompts, schemas, owned examples and a labelled evaluation corpus. Call this prompt engineering and evaluation; do not claim fine-tuning or trained financial expertise.

Evaluation must include:

- each capability above in ordinary English, typos and several sentence framings;
- the five failures in §2;
- “teach me how to use Calendar” versus “teach me derivatives”;
- “explain why my week is lighter” versus “explain the WACC formula”;
- negated/hypothetical missed work and multi-intent mixed-boundary requests;
- “move it tomorrow” with/without a selected task and a correction to Friday;
- selected result versus latest result, practice versus evidence, external mock versus internal rehearsal;
- conflicting IDs, foreign objects, injected instructions and forged client intent/tool input;
- empty, malformed, slow, failed and unavailable model output;
- unsupported actions, zero inventory, old evidence and exam-sat state;
- no guessed scores/dates/links, no new unreviewed questions and no false effect claims.

For known deterministic requests, enabled/disabled/failing provider modes must retain the same facts, scope, destinations and proposal effects. For semantic-only phrases, provider absence may produce clarification; it must not produce a different guessed action. Track routing, entity resolution, clarification correctness, boundary compliance, groundedness and effect equivalence separately. A correct refusal alone is not a successful planning answer.

**Exit:** evaluated language understanding and complete mobile/desktop chat flows. Do not publish a “100% understands typos” claim from a small example set.

## 7. Pass E — three actual lifecycle scripts and browser proof

Write or compose durable lifecycle scripts using shared fixtures/helpers, not merely list old suites that separately touch the features. Each lifecycle uses one ordinary student throughout and asserts cross-page/database effects. Record the source attempt/kind and every linked repair/proposal/task/cycle.

### Journey A: fresh self-study week

Onboarding → accepted Calendar → completed/partial/missed/manual learning → confirmed weekly scope → **weekly diagnostic** preview/start → result with a confident miss and omission → Coach explains that exact result → Keep for later → find it again on Home/Tests/Coach → preview/accept repair → dated Calendar task → complete work → spacing → eligible independent re-check → resolve logs → next-week draft/accept → continuation history.

A practice paper cannot stand in for the evidence-bearing weekly diagnostic. Add a paired adaptive-practice path and prove it creates no evidence, repair or weekly credit. If a practice page points to an older repair, identify the older diagnostic as its source; do not claim practice created it.

Retain Monday–Saturday learning and Sunday verification. Seed dated history or use existing test-only clocks for elapsed-time cases; no production clock bypass or disabled spacing. A 20+25-minute continuation keeps 45 total reported minutes attributed to the right weeks and counts the learning effort once.

### Journey B: midway class-led candidate

Three subjects reported covered, uncertainty in parts of two, remaining first-pass work. No compulsory restart. Log an actual class and exact taught scope through the Calendar flow. Coach understands a typo-filled class/change request, resolves or clarifies its date/mapping, and opens a valid preview/editor.

Move a class after a proposal preview. Stale confirmation changes nothing and retains inputs. Reprepare and accept. Class-aware cycle boundaries and pre-class paper timing remain correct; history never moves. Repair and remaining learning fit around classes/commitments or stay explicitly unplaced/next-cycle. Home and Coach agree after acceptance.

### Journey C: first pass complete, mock in a month

No new first-pass restart. Existing revision rotation, limited checks, protected mock and debrief. Coach explains priorities using evidence and capacity without teaching or promising a pass.

Exercise internal rehearsal and external mock variants. Internal sessions use the fixed blueprint and held-out families; external topic scores are self-reported, not item evidence. Debrief yields manageable repair/revision choices and the correct cycle credit. A move after preview invalidates stale preparation assumptions. Final-week work stops at the exam horizon; past Calendar is history and future weeks are forecasts until accepted.

### Required browser matrix

At desktop and 390px, complete Coach context → typo/ambiguity → clarification → preview → confirm → exact Calendar link → refresh receipt. Include lost message response and lost confirmation response.

Also cover: reviewer stale-level conflict recovery, Keep-for-later discoverability, adaptive shortage, insufficient-bank Week, stale scope in a second tab, and Home/Coach after repair acceptance. The class-log/mock journeys cannot remain HTTP-only while the handoff claims them browser-proven.

Use Browser when available; otherwise installed Playwright and record the fallback. Assert actual state after important interactions, not only successful navigation or screenshots. Check keyboard focus, IME Enter, accessible proposal controls, long labels and console/hydration errors.

## 8. Draft content preparation and performance closeout

### Give human reviewers something concrete to review

Do not classify all source-pack preparation as external work. Drafting reviewable packs is implementable work; approving their accuracy/rights is a human decision.

Prepare a small internal starter pack of **three reading-specific drafts**, ideally one numerical FSA, one Ethics and one Quant area, using available supplied 2027 reference files and the canonical manifest. Verify locations/file hashes, summarise facts in original wording, identify assumptions/exclusions and list mapping uncertainty. Do not copy provider questions, lengthy passages or pretend a LOS title is the full concept.

Use the current schema where possible. Keep these drafts outside the auto-loaded authoring directory, e.g. private ignored source-drafts storage, with `rights=unconfirmed`, `permittedUse=none`, pending concept sign-off and no provider dispatch. Do not create false authorisation, publication or human approval records. Supply a private review index with exact remaining decisions and the safe promotion path. If a file/scope cannot be verified, report that blocker instead of inventing a draft.

Test that a `permittedUse=none` draft cannot enter provider dispatch, even if rights warnings are currently advisory. Input-use permission and publication permission are separate gates. Do not send private drafts to a third-party model to demonstrate the pipeline. These drafts are not new approved questions or live capacity.

### Performance and test ownership

Measure Coach routing/context/model/proposal/save stages and the changed critical Tests/Calendar paths. Report cold/dev-compile separately from warm calls, sequential and bounded concurrency, sample sizes, p50/p95/max, status/error codes and read counts. A three-set history is not a realistic multi-month history fixture.

Instrument an outlier before attributing it to compilation. The 23.5-second run-state request, 29–70-second heartbeats and prior concurrent-suite failures remain unclassified without evidence. Use timeouts/cancellation and recovery; do not weaken ownership/freshness checks or cache account data publicly to improve timings.

Fix the global `fxb-%` cleanup assertion in `e2e-home-assessments` to verify its own recorded fixture IDs and preserve pre-existing fixtures. Record run-owned assets before mutations and verify their removal. Do not make unrelated active fixtures a test failure or delete another worker's bank. Correct a slot-clashing fixture through valid data, not relaxed booking rules.

Run `npm run verify` on the final tree plus relevant Coach policy/actions/context/model, transaction, access, Tests, repair, weekly review, class-log and checkpoint regressions. New schema changes require effective-function, clean-install, upgrade and restore proof. Do not rebuild a current function from an old migration body or edit applied migrations. Preserve unrelated modifications, including `src/lib/state/types.ts`.

## 9. Handoff requirements

Finish this implementable scope, with any genuinely blocked external decisions identified. Report:

1. Coach capabilities actually delivered versus exact-editor handoffs and unavailable operations.
2. The boundary and interpretation examples, prompt/schema versions and evaluation results; distinguish simulated and live-provider checks.
3. The three lifecycle outcomes, source attempts and linked object receipts; browser versus endpoint proof explicitly separated.
4. Retry, stale, concurrency, privacy/access and no-teaching/no-practice-evidence invariants.
5. Performance/read-count measurements and unresolved outliers without guessed causes.
6. Draft source-pack review index and missing human decisions, separately from actual eligible question capacity.
7. Schema/baseline/verification state, failed/skipped checks and remaining gaps.
8. Cleanup of own accounts/fixtures/processes and restored generated types; no commits/pushes.

Do not call this market-ready while approved content supply is zero. Do not claim a Coach reschedule or complete weekly loop from a generic link or disconnected test fragments. The outcome is a usable scoped Coach attached to a proven end-to-end product loop, with concrete reviewer inputs and an honest remaining content-activation track.
