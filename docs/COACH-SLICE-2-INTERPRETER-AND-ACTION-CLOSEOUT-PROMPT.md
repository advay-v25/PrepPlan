# Roadmap — Coach slice 2: language, context and reliable actions

Prepared 13 November 2026. This is the next execution prompt after status §9.29. It narrows the remaining work in `COACH-REVAMP-AND-T5-CLOSEOUT-AGENT-PROMPT.md`; it does not cancel that brief.

## Assignment

Finish the Coach's conversation path before we run the three whole-product lifecycle journeys. Build the bounded model interpreter, its prompt/evaluation package, exact selected-object context, genuine selected-task rescheduling, and the reliability defects below. Complete this slice rather than reporting the interpreter as a future task again.

Read `AGENTS.md`, Ponytail, the current Coach closeout prompt, founder decisions and master status §9.29. Preserve unrelated uncommitted work. Read the installed Next.js guide before framework edits. Use existing services, schemas, components and model gateway; no new agent framework, second planner, model fine-tuning project or broad redesign. No commits, deployment, payments, domain/auth setup or self-granted staff roles.

The remaining sequence is:

1. **This slice:** Coach language/context/actions with focused browser and concurrency proof.
2. **Next slice:** the three durable lifecycle journeys and complete desktop/mobile matrix, fixing defects they expose.
3. **Following slice:** private draft source packs, input-use permission gate and reviewer handoff. Human content/rights approval remains separate.

Do not start steps 2–3 here. Required local Coach tests and its focused browser flow are part of step 1. The actual bank is reported as zero eligible approved questions; use clearly labelled owned fixtures for assessment-dependent checks without changing publication rules.

## 1. Preserve the delivered work and reproduce these gaps

Keep the capability registry, deterministic recogniser, mixed teaching/planning boundary, three quick actions, retained failed input, IME handling, atomic turn finish, hourly admission and confirmation receipts. The review reran `coach:interpret:test` (57), `coach:actions:test` (43), and `coach:eval` (44), all passing. These tests establish those examples, not broad language understanding.

The following are current findings, not permission to weaken a rule:

| Finding | Required regression or investigation |
|---|---|
| Wrong target day | `Move it to Friday because I am busy today` returns `when=today`. Associate dates with the requested action, not the last date word. |
| Identifier corruption | `Move task-tdy to Friday` normalises the identifier into `task-today`. Preserve exact entity spans and IDs; never resolve an autocorrected ID. |
| Content request routed as generic chat | `How do I compute bond duration?` returns `free` with no teaching flag. Test that calculation/solution requests without the verb “teach” are still outside scope. This is a routing gap, not a proven leaked answer. |
| Deferral presented as moving | `move_block` still creates `kind=defer_today`; the requested date is prose only. “Move to Friday” must either preview a real Friday placement or offer an explicitly labelled editor handoff without deferring the task first. |
| Replay outside recent history | `loadTurnAnswer` searches only the last six messages. A replay must fetch the exact owned answer and its proposals regardless of newer turns. |
| Turn-key payload conflict | `coach_turn_begin` does not compare the original message or selection on key reuse. Reusing a key for a different message/context must not reinterpret or overwrite the original turn. |
| Concurrent model work | `resume` allows multiple HTTP requests to do model/context work before the single winning finish. Message uniqueness alone does not prove one paid call. |
| Clear/decision races | `clearHistory` updates proposals and deletes messages separately; dismiss reads then updates, and may report dismissed after another request confirmed it. Prove consistent outcomes and retain executed records. |

Write targeted failing tests before fixing these. If a source finding cannot be reproduced through the endpoint, report exactly which invariant is already protected and retain an appropriate regression test.

## 2. Build the interpreter and versioned prompt package

Keep deterministic recognition for clear requests. Add a bounded, structured model interpretation step when wording is unresolved, ambiguous or outside the recogniser's tested grammar. A regex match alone is not proof that a complex sentence is unambiguous. Do not handle all new phrasing by adding another spelling list.

The model may return a validated description of the request, not executable actions. Define a strict schema with:

- one or more requested capabilities from the existing registry;
- teaching/other excluded components, negated actions and corrections;
- entity mentions as exact spans or references to server-supplied candidates;
- date/time expressions associated with each request;
- unresolved fields and a concise clarification reason.

Reject unknown fields, arbitrary URLs/endpoints, SQL, trusted user IDs, made-up task IDs and invented facts. Model confidence is not calibrated certainty and cannot authorise a write. The server resolves ownership, supported capabilities, actual dates, resource availability and all changes.

Preserve original input. Normalise a separate interpretation copy while protecting identifiers, links, quantities and date/time spans. Validate any model-supplied span against the original message. Use verified curriculum aliases; clarify ambiguous abbreviations rather than choosing an unrelated reading.

Handle negation, hypotheticals, explanations versus commands, multiple clauses, corrections and mixed requests. For example:

- `I haven't missed today; what's next?` — no recovery proposal.
- `Move it to Friday because I am busy today` — requested Friday, today is the reason.
- `Don't move Friday's block; move Wednesday's instead` — resolve the actual target or ask.
- `No, not tomorrow, Friday` — amend the pending interpretation, not execute an old proposal.
- `I missed today; explain the WACC formula` — help with recovery and decline the formula request.
- `Teach me how to organise revision` / `explain how to use Calendar` — legitimate study-method/app help.
- `How do I compute bond duration?` — curriculum calculation, decline and offer planning/approved result review instead.
- `kal shift kar do` — clarify date/object when unresolved; do not claim general multilingual support from a few examples.

Do not silently discard secondary intents. For a mock debrief plus changed work hours, answer the grounded read-only part and provide a clear sequence for the two relevant flows. A correction or topic change invalidates any conversational assumption that “yes” approves the old plan.

Keep no-tutoring enforcement on deterministic, interpreted and fallback paths. No live-assessment answers, new worked solutions, fabricated weakness diagnoses, pass guarantees or questions generated outside the approved bank. Post-submission discussion can summarise recorded findings and link the approved explanation. Reported confidence, completed blocks, external mock reports and practice are not scored diagnostic evidence.

Create versioned interpreter and response prompts, schema versions, examples and a change log. Reuse trusted fact/action blocks for replies: answer the question, state the relevant evidence/limitation, and give one useful primary action. Do not keep an obsolete prompt package while claiming the new interpreter is complete. Do not rely only on output regexes to constrain factual free text.

## 3. Carry context through the entire conversation

Use one validated selected-object contract through the page, client, API, interpreter and context loader. Cover task, scored attempt, repair, proposal, appointment/rehearsal and reading/LOS where relevant. Extend existing `selection.ts` and URL helpers rather than creating competing selection stores.

An explicitly selected object outranks the generic latest object. A missing/foreign/unreadable selected object must not fall back to another student's data or an unrelated latest result. Distinguish unavailable from no history. Resolve candidate choices by stable owned IDs, never by title alone.

Support `this one`, `the second one`, `same week` and corrections using bounded recent context plus the pending clarification/proposal. Persist enough structured state for a reload to retain the question and available choices. A user's typed title is a mention, not proof of identity. When several objects match, ask one short question with specific choices.

Resolve relative dates using the existing study-week/timezone helpers and an explicit server anchor. Show the interpreted date before a change. Do not ask users for timezone again. Resolve ambiguous `next Sunday`, expired clarification anchors or a target outside the task's cycle safely; cross-cycle continuation belongs to weekly review.

Load the authoritative state again for preview and confirmation. Chat history is not a competing source of Calendar truth. A practice result stays practice, an external mock stays self-report, and a selected linked rehearsal is not misrepresented as a complete mock from just one session.

## 4. Close selected-task rescheduling properly

Implement one complete direct flow: select one not-started movable study task → request a target day/time → clarify if needed → preview exact placement → confirm → durable receipt → open that task in Calendar.

For a day-only request, use the existing planner to propose a feasible slot and show it; if no slot fits, offer valid alternatives or a clearly labelled unplaced/day-preferred option consistent with current Calendar policy. Do not invent a time or silently choose another day. Exact-editor handoffs remain acceptable for complex class/availability/mock edits, with extracted inputs carried where supported. Navigation must not change the task first.

Reuse Calendar's validation and domain semantics: cycle limits, exam horizon, protected commitments, mocks, prior completion/partial work, spacing and prerequisite constraints. Preserve current soft study-task-overlap warnings and their explicit acknowledgement; do not silently change Calendar's product policy to make the Coach test easier. The default proposed slot should be feasible and avoid conflicts. Started/partial/historical/continued tasks must retain their established rules and actual minutes.

Inspect the shared task writer before reuse. A preflight followed by separate row/history writes is not an atomic Coach move. Use a minimal extension of the canonical domain command so task mutation, event, proposal state and receipt commit together, with current ownership/revision/booking checks under the existing locking discipline. The Calendar and Coach must not end up with different move semantics. Preserve all existing deferral/redistribution behaviour and its separate truthful receipt language.

Preview changes nothing. Confirmation must refuse stale or conflicting placement without partial writes. Two confirmations return one outcome. A requested different date after preview requires a new preview. Textual `yes` may confirm only one clearly referenced, fresh, visible proposal through the same command as the button; ambiguous consent asks which proposal.

The receipt must distinguish actual placement, deferral and waiting/unplaced work. Preserve the confirmed outcome across refresh and link to the task's own date. Never say “moved to Friday” for a deferral with a Friday suggestion.

## 5. Finish retry, cancellation and conversation integrity

Extend the existing turn command only as needed; do not build a general workflow system.

- Bind a turn key to the original message and explicit selected context/request. A conflicting reuse returns a clear conflict with no new interpretation, answer or proposal. Client Retry preserves the original context even if the user has since selected another object.
- Fetch a completed turn's exact owned answer/proposals directly; do not depend on the current history page size. Replaying an old turn after ten newer turns must return that turn, not current wording or missing actions.
- Admit one worker for the in-flight turn across requests/server instances. Other requests resume/poll/replay safely. Do not hold a database transaction open while waiting for the provider. A minimal durable ownership/lease token must fence late workers after recovery or Clear.
- Reserve the outbound-call budget before dispatch, including retries/fallback calls. The turn allowance counts a user turn once; actual model requests are counted separately. Clearing visible history must not reset the abuse/cost budget.
- Clear deadlines and abort the actual provider request using the existing gateway cancellation pattern. Cancel timers and avoid starting another provider call after a resolved fallback. Bound total calls and elapsed time; do not inherit the authoring pipeline's long retry loop for chat.
- Do not promise exactly-once billing across a process crash after a provider accepted a request. Record indeterminate attempts, fence late results and make any bounded recovery policy explicit. Normal concurrent retries and lost-response replay must not dispatch duplicate calls.
- Make Clear, Dismiss and Confirm serialise consistently. A confirmed operation is never reported as dismissed or deleted. A cleared in-flight turn cannot resurrect its conversation or create proposals later. Confirmed effects/receipts survive under the established retention policy.
- Use authoritative stored turn metadata on replay, including interpretation/prompt version and fallback status. Do not claim a fresh model answer when returning a deterministic or previously completed one.

Keep the student's failed question and clear Retry/status actions. A server or history failure must not say nothing was saved when something committed. Avoid rendering duplicate optimistic and stored messages after retry, refresh or a second device.

## 6. Routes and connections to verify

| Route/connection | Required behaviour |
|---|---|
| `/app/coach` | Selected context and bounded history, clarification, proposal, receipt and retry state. |
| `POST /api/coach` | Access check → turn admission → validated interpretation/context → server-owned response/action → atomic finish. |
| `/api/coach/history` | Owned history and consistent Clear; failures shown, never replaced by invented empty history. |
| `POST /api/coach/proposals/[id]` | Authorised confirm/dismiss, stale/conflict handling and replayable actual effects. |
| Coach → `/app/calendar` | Exact owned task/appointment and its correct date/week selected after navigation and reload. |
| Coach → `/app/tests/[attemptId]/result` | Selected owned result and appropriate kind; correct repair follow-up and combined rehearsal handoff. |
| Coach → `/app/tests` | Correct existing mode/scope/preflight; zero inventory explained without starting a broken attempt. |
| Coach → `/app/curriculum/[subject]/[reading]` | Exact existing reading/LOS context; notes and self-report do not become evidence. |
| Coach → `/app/calendar/log-class`, `/app/log` | Correct capture flow, uncertain mapping confirmed by the student. |
| Coach → exam/availability/review editors | Canonical editor, relevant selected data and safe return link; do not add another profile writer. |
| Confirmed Coach change → Home/Calendar | Refreshed authoritative next action, day placement and receipt agree. |

Inspect existing query contracts before adding links; do not invent parameters that open a page but select nothing. Keep old valid deep links working. Read-only rendering and previews must remain free of side effects.

## 7. Proof required before handoff

### Language and prompts

Retain existing cases and add a separate hold-out set of unseen paraphrases rather than only the spellings in the implementation. Cover every advertised capability, negation/correction, clause-linked dates, ambiguous references, mixed allowed/excluded requests, forged client hints and prompt injection in messages/history/notes. Report routing, entity/date resolution, clarification, boundary compliance, factual grounding and action equivalence separately. A refusal does not count as successful planning help.

Exercise malformed, empty, slow, unavailable and hostile simulated provider outputs. Clear deterministic requests should give equivalent facts/actions with the provider enabled or disabled; genuinely unresolved language may fall back to clarification. Make a small explicitly bounded live-provider probe with available configuration, separating it from simulated results. Do not dump keys, raw private context or provider reasoning. If live calls fail, report the classified failure; do not imply live interpretation was proven.

### Reliability and action tests

Prove old-turn replay, conflicting key reuse, simultaneous identical HTTP sends with a counted provider stub, retry after context selection changes, Clear during inference, stale-worker finish, allowance after Clear, Confirm/Dismiss and Confirm/Clear in both orders. Force an intermediate failure in the move command and verify zero partial changes. Race a protected booking/task edit with confirmation. Use ordinary student fixtures and test foreign/incomplete-access refusals.

### Focused browser proof

At desktop and 390px, perform:

1. A typo/paraphrase names an ambiguous task → clarification → select target → request Friday → exact preview → confirm → Calendar selected task → Home → reload receipt.
2. Correct the target date before confirmation; an old second-tab proposal becomes stale with no writes.
3. Lose send/confirm responses after commit, Retry and verify one turn/change.
4. Open a selected scored fixture result/repair and a selected practice result; replies preserve each source and evidence boundary.
5. Teaching-only and mixed planning/teaching requests, unavailable bank, and a model outage.

Check keyboard/focus/IME, long labels, console errors and no horizontal overflow. Use Browser if available, otherwise installed Playwright and record the fallback. These are Coach proofs, not completion of the three full lifecycle journeys.

Measure simple-next-action, interpreted clarification and preview/confirmation separately: sample count, stage timings, reads, p50/p95/max and failures. The reported 6–8 second deterministic replies need stage evidence before attributing delay. Keep model work off obvious deterministic requests and avoid loading all evidence/roadmap services unnecessarily. Do not start an unrelated performance rewrite.

Run full `npm run verify`, type checks and affected Coach/access/task/booking/Tests regressions. Any new migration must preserve the current effective functions, privileges and rollback behaviour; prove install, upgrade, restore and ledger status through the existing runner. Do not edit applied migrations or copy an older function over newer patches.

## 8. Finish and report

Deliver working software and prompt/schema/evaluation artifacts, not another recommendation to add the interpreter. Update the master status with exact capabilities, limitations, simulated/live-provider evidence, browser proof, concurrency results, migration state and performance. Run the own-fixture cleanup isolation test changed in slice 1. Remove only recorded owned fixtures/accounts/processes; never kill a process based on a port connection alone. Verify generated types and restore them using the existing helper if needed.

Use this handoff format:

- **Delivered:** interpreter/prompt versions, selected context, exact move versus editor handoffs.
- **Proven:** checks and browser paths, with fixture versus actual bank and simulated versus live provider separated.
- **Remaining:** specific gaps and their impact, including unresolved external-call failure modes.
- **Next:** the three lifecycle journeys and browser matrix. Source packs remain the following content-preparation slice; eligible real-bank capacity is unchanged unless separately evidenced.

Do not claim the whole Coach/whole product is market-ready from these tests. Do not claim that moving means deferring, that practice produced diagnostic evidence, or that a passing test corpus proves arbitrary language understanding.
