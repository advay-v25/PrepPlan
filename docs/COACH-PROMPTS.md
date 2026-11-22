# Coach prompts, schemas and evaluation

Versions are stored with every turn (`coach_messages.turn_meta`), so a replay reports what actually produced the answer.

| Artifact | Version | Where |
|---|---|---|
| Deterministic interpreter | `coach-interpret-2026-11-13.2` | `src/lib/coach/interpret.ts` |
| Model interpreter prompt | `coach-interp-2026-11-16.1` | `src/lib/coach/prompts.ts` |
| Model interpreter schema | `coach-interp-schema.2` | `src/lib/coach/interpretModel.ts` (strict zod) |
| Response prompt | `coach-2026-11-13.1` | `src/lib/coach/response.ts` |

## How the pieces fit
1. The server reads the message deterministically (`interpret`). A clear request never reaches a model.
2. Only an unresolved message (no deterministic intent, three or more words, not teaching) goes to the model interpreter. It returns a **description** (capabilities, negations, quoted spans, a pointer to the date words, unresolved fields), never an action.
3. The server validates it: strict schema, every quoted span must occur in the ORIGINAL message, nothing URL-, SQL- or id-shaped, no confidence field, no unknown field. A model "teaching" flag counts only where our own grammar agrees on the quoted span. A "reason" date is never the target. A negation can only remove an action. The date is re-read by our grammar from the validated span.
4. The server resolves ownership, dates (study-week "today", never the server clock), slots and every change. Preview first, confirm second; the model never sees ids it could return.
5. Free-text wording is a second, separate, validated model call over server-chosen options. Output rules (no claimed change, no readiness claim, no invented schedule, no teaching) are checked after the call.

Every outbound request is reserved in the database before dispatch (`coach_model_reserve`), aborted at its deadline, and bounded to two per turn and 20 s in total. A request whose outcome is unknowable is recorded `indeterminate`.

## Change log
- **coach-interp-2026-11-16.1 / schema.3** (16 Nov, Phase 3 Gate 0) — adds the optional validated `context: ["preparation"]` field. A model `log_learning` is accepted only when the message has an explicit record/log/add verb (or our own grammar also found it); otherwise it is demoted to preparation context (acknowledged, never a log, coverage edit or calendar change). Schema 2 replies still validate; stored turns keep the versions that produced them.
- **coach-interp-2026-11-13.3 / schema.2** (13 Nov, lifecycle closeout) — `requests` may be empty (an exclusion-only description is valid). Model exclusions the grammar does not confirm are kept as `exclusions` notes: never an action, never a refusal of planning help, never silently dropped; plain study-method wording (`isMethodHelp`) is dropped, not refused. A matched request that is negated, multi-intent or multi-clause now gets a model REVIEW (can only remove a negated request, add an exclusion note, or hold previews to ask one question; it never replaces a matched request). Simple clear requests still make zero model calls.
- **coach-interpret-2026-11-13.2 (deterministic)** — `when` carries exact dates (`2026-11-14`, `14 nov`) and an optional clock time (`day@HH:MM`, `@HH:MM` = same-day time edit).
- **coach-interp-2026-11-13.2** — added three exact output examples and "teaching goes only in excluded". The first live probe of `.1` returned 2 of 6 valid: the model wrote `"when": null`, a top-level `role`, and put teaching inside `requests`. Strict validation rejected all four (that is the design); `.2` returned 6 of 6 valid on the same synthetic messages. The schema now also accepts `when: null`.
- **coach-interp-2026-11-13.1** — first version.
- **coach-2026-11-13.1 (response)** — states that study-method and app questions are in scope. Reason: in the browser, with an earlier refusal in view, the model copied the refusal onto "teach me how to organise my revision". History sent to the model now omits refusals and the teaching requests behind them.
- **coach-2026-11-04.2** — previous response prompt.

## Provider setting (measured 13 Nov 2026)
`nvidia/nemotron-3.5-lightning-30b-a3b` with reasoning on spent every token thinking (11–16 s, no visible text, `finish=length`). With `chat_template_kwargs: { enable_thinking: false }` a short JSON answer takes about 0.4–1.7 s. The Coach provider sets it. Before this, every live interpretation timed out at 8 s.

## Evaluation (kept separate on purpose)
- `npm run coach:eval` — 44 labelled cases of the verified path and the model boundary (simulated provider output). Unchanged by this slice, still passing.
- `npm run coach:interp:eval` — 48 hold-out paraphrases written after the recogniser and not used to tune it. Deterministic path only. Reports routing, resolution, wrong-route, forbidden-action, boundary, date, groundedness and planning-kept separately. Gates only on the safety floors (no forbidden action, no lost planning part, groundedness). Current: routing 43/46, wrong-route 0, forbidden 0/7, boundary 48/48, dates 5/5, planning-kept 2/2. The three routing misses ("what's on my plate for today", "what am I doing today?", "what should I tackle next") fall through to the model interpreter by design.
- `npm run coach:turns:runtime:test` — counted, simulated provider through the real `runTurn`.
- `npm run coach:interpreter:probe` — at most 6 synthetic messages against the live provider. Not a regression test and not run by `verify`.
A passing corpus is not proof of arbitrary-language understanding. Hinglish is only the two high-precision phrases and "kal" (which asks).

**14 Nov 2026 (no prompt or schema change).** A result the student selected that is not theirs / not scored is now stated ("I could not open the result you selected… I have not substituted another one") and gets only a Tests link; the account-wide latest-evidence repair link is never offered beside a selected result unless it is that paper's. The Coach page now passes the unavailable selection to the chat instead of dropping it (the browser run found the page silently falling back to the latest result). The interpreter may still answer such a message with a clarification ("What result are you referring to?"), which is also acceptable; substitution is not.

**17 Nov 2026 (no prompt or schema change).** The Coach can be opened on one saved mock report (`/app/coach?report=<uuid>`, from the report page and the task drawer; `reportId` in the request, bound into the turn-key hash). The report is read by owner and discussed AS ITSELF: an active report by its date, provider and the student's own score (never evidence); a withdrawn report as withdrawn (sittings stay, nothing new can be planned from it); a missing or foreign id as unavailable, with no other report substituted. With no selection the latest active report is used as before. The model context (`selfReported`) carries the same three states, so the model cannot be handed a different report than the one chosen. The Coach guides how to work on the chosen areas; it does not teach curriculum content. Covered by `scripts/coach-phase2-eval.ts` §2b (deterministic text and links) and `tests/e2e/lifecycle/phase3-closeout.spec.ts` (real browser, deterministic replies: no live model is called or claimed).
