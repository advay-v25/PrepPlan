# Roadmap — B3: safe class scope and usable Calendar editing

Prepared 15 November 2026 after master status §9.36. This is the next bounded implementation slice. Finish it before undertaking B4's full class-led assessment-to-review browser journey. Journey B remains incomplete until that subsequent journey is proven.

## Assignment and boundaries

Build the Calendar experience for changing one class or its future recurring pattern, with a truthful impact preview, atomic confirmation, retry/recovery and a real path to recover affected study work. First close the remaining partial-coverage loopholes below. Do not redesign the Calendar or start Journey C.

Read `AGENTS.md`, Ponytail, founder decisions, §§9.34–9.36 and the existing B/B2 briefs. Read installed Next.js documentation before framework changes. Preserve current class-cycle policy, scoring, content approvals and repair thresholds. Roadmap plans and assesses; it does not teach curriculum.

Settings final acceptance is a separate assignment. It owns setup-version enforcement, classes-finished/undo, account/reminder/export fixes and its effect matrix. B3 owns class-log scope provenance and Calendar commitment editing. Coordinate shared command/version/occurrence changes, preserve unrelated dirty work and never apply another worker's pending migration blindly. No commits, deployment, real mail, owner-data mutations or cleanup of accounts you did not create.

## 1. Review findings: close partial-scope safety first

The review reran `npm run tests:scope:test`: **65 scope checks plus 25 learning-loop checks passed**. It did not rerun the live database or browser journey. Preserve the delivered pending-portion fallback, corrected EPS mapping, paginated inventory counts, current-version fixture approval and A's restored negative-control evidence. A concept-level partial-coverage system is not required in B3: conservatively leaving the whole outcome pending is acceptable.

However, focused pure projection probes found:

- A part-only class correctly produces no target and one pending portion.
- A part followed by `extent:'continued'` produces a target and clears pending, without a separate whole-outcome confirmation.
- A lone `continued` item also produces a test target. The UI calls it **“Continued from before”**, not “Finished the rest.” Continuing study does not establish that the whole outcome is complete.
- A completed consolidation successor without a class-session link produces a target. The weekly continuation command deliberately resets `class_session_id`; the new exclusion depends on that direct link and current-cycle class items. The pure projection admits this state, but the real rollover sequence still needs reproduction.

### Required implementation

Separate continuation/progress from confirmation that the entire outcome was covered. Use the smallest unambiguous representation across class-log UI, validation, persistence, scope readers, hashes and assembly. A repeated “continued” log must remain pending until the student explicitly confirms whole coverage. Preserve the ability to record continuing work and plan its consolidation without making it testable. Do not merely rename historical `continued` records into completion assertions the student never made. Preserve already reserved/scored papers and their frozen rules; any necessary compatibility policy must be explicit and conservative for future reservations.

Trace partial-coverage identity through split sittings and next-week continuations. Do not restore an old `class_session_id` in a way that counts last week's class or minutes again. Follow existing lineage or retain minimal separate immutable coverage provenance. A pending class portion must not become whole-outcome scope merely because its task was split, continued, changed from study to review, or completed next week. A genuinely separate task explicitly covering the whole outcome may make it eligible.

A partial task can still confirm particular **whole outcomes** it finished. Do not remove that valid feature. The distinction is an unfinished portion *inside one outcome* versus a finished outcome *inside a larger task*. Free text, elapsed minutes and automatic model interpretation cannot decide that distinction.

Keep pending portions discoverable across the week boundary with their original class/date and a concrete completion-confirmation action. Review `priorClass` in `completedScopeService.ts`: it currently reads outcome IDs without extent and treats earlier class items as prior outcomes. Carrying a partial must not manufacture a completed first pass or label the first actual whole coverage as revision solely because part was previously taught. Keep exposure distinct from completed scope and demonstrated understanding.

### Proof

Use one outcome with two synthetic concepts. After part-only and part-plus-continued logs, **neither concept** may enter a paper. After explicit whole-outcome confirmation, both may become candidates subject to normal bank rules. This proves conservative exclusion, not concept-level selection.

Add regressions for: repeated continued logs, continued without a prior log, consolidation completion, split and next-week continuation completion, pending visibility after rollover, earlier partial versus genuine revision, explicit whole coverage, correction/reopening and preflight-to-start staleness. Reproduce the successor case through the real weekly command, not only a hand-built projection. Show unchanged evidence and original per-week reported minutes.

## 2. Build Calendar class editing as one connected flow

### Entry, identity and routes

An ordinary student opens a class occurrence from `/app/calendar` using mouse, keyboard or mobile tap. Show its actual date/time, recurrence and existing changes. Carry the canonical commitment ID and **original occurrence date**, even when the occurrence moved. Do not derive identity from a title, a displayed date alone or a task ID. Preserve export UID/occurrence identity.

Provide a shareable validated Calendar selection, for example `/app/calendar?commitment=<id>&occurrence=<YYYY-MM-DD>`, through the route helpers. An unknown, foreign or no-longer-applicable selection shows an unavailable state and does not open another class. Keep task and appointment selections working.

Reuse `/api/commitments` and `/api/commitments/[id]` as canonical writers. Add a read-only `POST /api/commitments/[id]/preview` if no existing preview contract can be reused. Confirm through the existing PATCH path with a bound operation key, expected source revision and preview fingerprint. Restore uses the same preview/confirm protocol with an explicit action. Update existing callers rather than leaving an unchecked alternate path. Document actual final routes, payloads and links in the handoff.

### Choices and historical meaning

For a recurring class, offer clear operations:

1. **This class only:** move its date/time or cancel this occurrence.
2. **This and future classes:** change the recurring pattern from an explicit effective date.
3. **Restore this class:** when an exception exists, preview restoration to the original slot.

Reuse the current add-class/commitment form and Calendar dialog patterns. Do not add a second calendar editor in Settings. A future pattern edit must not redraw earlier classes using the new pattern; use existing `starts_on`/`ends_on` bounds and minimal successor-series lineage if necessary. Preserve logs, attendance, original occurrence references, exceptions and completed/partial study. Resolve future exceptions explicitly rather than silently losing them when replacing a series. No destructive series deletion.

The accepted current cycle remains fixed under existing policy. A single moved/cancelled occurrence does not silently redefine the recurring class boundary. A future recurring-pattern change affects prospective cycles as appropriate. Preserve explicit next-class anchoring for variable classes. Keep the existing Tue/Thu → Tuesday–Monday/Monday-paper and Sat/Sun → Friday-paper cases; self-study remains Monday–Saturday with Sunday tests.

### Preview, confirm and recovery

Preview must be read-only and show the actual old/new occurrence(s), protected time, affected unfinished tasks, relevant paper/cycle effect and any conflict. Do not promise exact schedules from uncommitted forecasts. A saved class change and a reviewed study-plan adjustment are distinct actions.

Confirm must atomically validate ownership, action, dates/times, recurrence membership, applicable series range, source freshness, booking conflicts and operation identity before writing. Reuse `scope_lock`, the established lock order and current checked-command/version conventions. Current PATCH uses date/time regexes, silently defaults unknown occurrence actions to skipped and filters/coerces weekdays; replace silent acceptance with strict validation. Reject impossible dates, non-occurrences, invalid local times, wrong recurrence, invalid weekdays and reversed ranges with no mutation. Surface infrastructure failure separately from a booking conflict.

Stale previews retain the form and offer a fresh preview. Duplicate clicks, concurrent confirmations and a lost response resolve to one durable outcome. An operation-key retry with a different payload must not replay the wrong change. Do not return a failed-save message when confirmation committed but a follow-up read failed.

Restore must re-check the now-occupied original slot, including booked mocks, under the same transaction as restoring the exception. Refuse with the named conflict and leave the exception intact. Prove restore-versus-book and edit-versus-book races in both orders. Existing database booking guards are a foundation, not permission to rely on a non-transactional UI precheck.

After a successful edit, show affected accepted study work and **Review changes to my week**. This opens the existing current-week draft/recovery flow with the correct work selected. Preview and accept the adjustment; do not quietly reschedule started/protected/completed work or offer a generic Coach link with no target. If there is no room, retain the work visibly unplaced/deferred with the existing week-review continuation path. Do not discard it or rewrite old minutes.

## 3. Cross-product acceptance and browser proof

Use separate ordinary students at desktop and 390px. Synthetic reviewed items are fixture-bank software proof only; the actual bank's limited control remains separate. B3 does not need a full scored browser paper; focused scope/assembly tests may cover section 1.

Drive these Calendar paths through the browser and verify persisted state after reload:

- Open a moved class by its deep link, move only that occurrence, preview, confirm, retry a lost response and restore it.
- Add a booked conflict after preview in a second tab; confirmation refuses without partial writes and retains input. Restore against a newly booked conflict also refuses.
- Change future Tue/Thu classes from a chosen effective date. The old Calendar history and accepted cycle remain intact; a prospective cycle uses the supported new pattern.
- Recover affected study work through the real reviewed draft, accept once and open the resulting exact task. Confirm protected commitments, completed work, reported minutes and repair identity remain intact.
- Log a partial class, reload, continue its consolidation into the next week and inspect pending scope. Explicit whole-coverage confirmation then makes only the intended outcome eligible.

Assert Home, Calendar, the class-log chooser, Tests scope and Coach's deterministic context agree on the saved occurrence/scope. Check the existing export reader's occurrence identity without taking over Settings' export implementation. If multiple classes on one day cannot be logged independently, expose and report that limitation honestly; do not call a date-level log occurrence-specific proof.

Verify keyboard opening, focus/return, Escape, error announcements, IME composition and no horizontal overflow. Expected failure allowances must be limited to the intentionally injected request/status/window; do not ignore all Coach/confirmation errors or all “Failed to load resource” messages throughout the spec. A required failed step prevents a `complete` result.

## 4. Verification, coordination and handoff

Run focused scope/class-log/continuity/commitment/booking/current-week tests, actual endpoint races and the new browser paths, then `npm run verify` and TypeScript on the final tree. Do not run reset-based suites concurrently on one account. Preserve frozen scoring and reserved forms in a regression assertion.

Accept §9.36's baseline-plus-upgrade proof for 20261219–22; do not spend this slice reproducing unchanged work. Extend the existing restore rehearsal to apply uncovered migrations before dumping, then restore into a separate local database and exercise the relevant commands, records, RLS/grants and ledger. A restore of the old baseline alone does not cover later migrations. Coordinate once with Settings so this is not duplicated. New B3 migrations must be additive and tested on both upgrade and restore paths using effective function definitions. Do not edit applied files or overwrite later patches.

Register and clean only owned account/item/storage IDs and fixture records. Preserve the seven older accounts unless their creator/owner authorizes cleanup. Use the shared fixture-bank lock; stop only your recorded server process and restore generated types through the existing helper.

Update the next master-status section with defects reproduced, final route/action contracts, scope provenance and compatibility, unchanged history/evidence, Calendar browser results, races, upgrade/restore proof and cleanup. Distinguish endpoint, pure and browser evidence. Report any remaining limitation with a user consequence and exact reproduction.

**Finish line:** partial consolidation cannot leak whole outcomes into papers; the class occurrence/future-pattern edit works through Calendar, supports recovery and survives retries/staleness; required B3 checks pass. Do not stop after only section 1.

**Kept for B4, not abandoned:** class-led onboarding through UI; paper → result → actual Keep for later → repair → after-spacing re-check → weekly review; revisionary/mixed UI; uncertain class-log draft recovery; student-chosen baseline; cross-page unstable-concept deduplication; exact Coach movement/drag and controlled provider fallback; A mobile regression on changed helpers. Journey B stays partial until those are closed. Journey C and genuine bank activation remain separate.
