# Roadmap — Settings closeout 2: app-wide effects and account safety

Prepared 14 November 2026 after Settings §9.33. Continue the existing Settings implementation; do not restart the page or rebuild the exports.

## Assignment and ownership

Finish the remaining functional Settings work: concurrent setup edits, truthful save/plan impact, class-finished/undo effects, account deletion failure/recovery and access, reminder-worker correctness, and the export gaps below. Prove effects across Home, Calendar, Curriculum, Tests and Coach.

Preserve the delivered mobile layout, one-way calendar download, personal-export manifest/pagination, explicit reminder form, display-name editor, `/account`, current-session reauthentication and deliberate deletion. Keep sign-out explicitly labelled as this device; do not silently revert its new scope.

Read `AGENTS.md`, Ponytail, the original Settings prompt and master status §9.33. Read installed Next.js guidance before framework edits. No commits, pushes, deployment, domain/OAuth/SMTP provisioning, real outbound messages or changes to content approval/scoring policy.

Journey B is a separate worker's assignment. Settings owns setup/profile/account/reminder/export changes here; B owns class-log/assessment journey and duplicate repair verification. Do not overwrite its files or apply its pending migrations blindly. Coordinate narrowly on shared Calendar readers and prospective class-cycle behaviour. Preserve unrelated dirty work.

## 1. Review findings to close first

The review independently reran `account:controls:test` 8, `calendar:ics:test` 13 and `reminders:test` 18: **39 passing checks**. It did not rerun database, HTTP or browser suites.

Two additional pure probes expose missing assertions:

- `isRecentSessionAuth` accepts an old password authentication followed by a recent `amr.method='token_refresh'`. It currently takes the newest timestamp regardless of method. This is a helper-level finding; no signed-token endpoint exploit was demonstrated.
- `escapeText('a;b')` returns `a;b`, with no backslash. The existing expected test string has the same JavaScript escaping mistake, and the permissive parser still round-trips it. Add an independent exact-byte assertion before fixing it. RFC 5545 requires escaping semicolons in TEXT values: [section 3.3.11](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.11).

Source review also found:

| Gap | Required outcome |
|---|---|
| Missing booked appointments in calendar export | `buildCalendarExport` uses `loadCalendarWeek`, which reads tasks and commitments. Calendar loads mock appointments separately. Export a booked appointment even when it has no task, including a future appointment outside an accepted cycle. Deduplicate if both representations exist. |
| Failures can become a successful partial calendar | `loadCalendarWeek` does not inspect several query errors. Merely awaiting it does not ensure export fails closed. Propagate material read failures; never download a half-empty file as complete. |
| Occurrence identity changes when moved | Recurring entry IDs use the actual moved date. Preserve the original occurrence identity for export UID across a move, and retain two distinct occurrences moved onto the same date. Coordinate any shared reader/UI identity adjustment with Journey B. |
| Time projection can lose real instants | A one-off overnight commitment is clipped to midnight by the display reader; export reconstructs instants from local minute-of-day. Preserve the actual end and distinguish both repeated DST-hour instants. Test source-to-export correctness, not only the serializer. |
| Successful preference write can still report failure | `savePrefs` reloads preferences after upsert outside its sync recovery block. If that read fails, the route returns an ordinary failure although the write committed. Preserve/report the saved versus unconfirmed-response distinction. |
| Reminder read failures change meaning | `syncReminders` still catches exam/appointment/review reads into null/empty; an outage can cancel legitimate pending jobs or miss exam-sat suppression. Unknown is not no appointment/no completed exam. |
| Worker readiness is too weak | `stillWanted` checks an active cycle for weekly review, not the complete current review gate. Re-evaluate actual eligibility at send time and protect claims from stale workers. |

Reproduce the observable effects before editing. Do not expand into a new export platform or reminder scheduler. Fix the shared cause with focused tests.

## 2. Complete canonical setup saves and app-wide effects

Reuse the existing `profiles.onboarding_context_version` and `onboarding_commit_step`; the application already has an atomic setup version. What is missing is version-aware edit input and authoritative outcomes, not another parallel version model.

For completed-user Settings edits, carry the version read by the editor into the write. Compare and increment inside the same command under the established lock. A stale overlapping edit must refuse or deliberately merge only compatible fields without dropping another tab's values. Preserve typed edits and offer a refresh/review path. Update every caller and relevant test, including onboarding reuse; do not silently break first-time setup or introduce an access verdict.

Make write outcomes independent from optional post-save impact reads:

- A refused/rolled-back command means nothing saved.
- A committed command returns the saved version and values even if a subsequent impact read fails; show “saved, plan impact unavailable” with Retry/Calendar action.
- A lost response resolves by a bound operation key or equivalent exact version/payload receipt, without incrementing versions repeatedly or duplicating side effects.
- The before/after impact belongs to the saved version. A third edit during calculation cannot be presented as the effect of the earlier save.

Trace `/api/profile` consumers. Prefer a name-only owner for display name and canonical editors for route, sitting limit and exam changes. Remove unused test-only legacy write branches after updating callers, or make a necessary remaining multi-record command genuinely atomic. A precheck followed by separate profile/exam writes and a `partial:true` response is better copy, but not the final canonical solution.

Do not rewrite accepted history, scores, reserved forms or actual minutes when setup changes. Show which unfinished future work needs a reviewed current-week proposal. Accept through the existing draft command; do not add a second scheduler in Settings.

Build a real before/after matrix using these changes:

| Change | App-wide evidence required |
|---|---|
| Name | Home/account display changes; no planning version or stale proposal caused solely by a cosmetic edit. |
| Tentative month → booked date / exam moved | Correct target/date/horizon on Home, roadmap/Curriculum, Calendar and Coach; affected proposals stale; existing attempt/form policy untouched. |
| Availability or sitting limit | New preview uses the changed boundary; accepted work remains visible with a clear conflict/review action; no invented weekly-hours prescription. |
| Reported coverage/uncertainty | Planning context changes while diagnostic evidence remains unchanged; no compulsory fresh-start plan for a midway student. |
| Route/classes finished/undo | Consistent prospective class occurrences, cycle anchor, paper timing and revision phase, with current accepted cycle/history preserved. |

### Classes finished and undo

Trace the actual class recurrence, `classes_completed_at`, scope readers and next-cycle generator. Do not mark the roadmap as revision while future classes remain protected forever or the next cycle still expects an ended class pattern.

Use a reviewable effective-date change. Preserve historical attendance/logs and the accepted current cycle. End or suppress the appropriate future occurrences without destroying the original series/history. Undo restores the appropriate prospective expectation without reviving unrelated cancellations or duplicating work. Do not treat class completion as syllabus mastery.

The class-led export must reflect these same occurrences and the completed transition. Coordinate the contract with Journey B; no competing class-cycle logic.

## 3. Close account safety with actual failure/recovery proof

Filter current-session authentication methods deliberately: a refresh/anonymous/unknown method alone is not fresh authentication. Handle absent/malformed evidence conservatively, bind it to the verified requesting user/session and distinguish legitimate current sign-in/reauthentication methods. Test provider-supported password, OTP/magic-link and any actually configured OAuth method. The provider's [JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields) distinguishes the methods; do not trust `iat` or account-global sign-in time.

You can age a real session: create session A near the start, retain it while doing other work until the configured ten-minute window plus margin elapses, then sign in on B and request deletion from A. It must refuse with no deletion. Use the time productively; do not replace this route proof solely with an unsigned token parser test or add a production time bypass. Then reauthenticate A and prove the intended flow works.

Provide a controlled `deleteUser` failure and a lost response after real deletion on an owned disposable student. No public failure-injection flag and no altered production secrets. Verify a pre-change failure leaves the account, preferences, jobs and history intact. After an uncertain/lost response, use honest recovery without automatically creating a replacement account through a signup-enabled sign-in call.

Inventory owned Storage and indirect references. Test a small owned test object if Storage is available, using the Storage API, not a SQL-only metadata deletion. If no Storage exists, prove that inventory result and document the boundary instead of pretending files were tested. Do not add an uploads feature. If external cleanup creates partial progress, track and retry it truthfully; no claim that external deletion rolls back with Postgres.

Prove post-delete access with two real owned sessions: app pages/API, direct database REST paths the student could previously use, refresh, exports and relevant queued mutations. A still-valid JWT is not automatically revoked by removing a browser cookie. Use the narrow actual session/owner existence boundary where required, without a costly global rewrite. The provider documents the [deletion and outstanding-token limits](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users).

Verify surviving receipts/audits and shared content remain as declared. Do not erase question-bank content/review decisions or another student's records. A deletion audit failure must not turn an already deleted account into a “nothing removed” error. Keep per-device sign-out behaviour explicit and test another device remains signed in after ordinary local sign-out, but loses account access after deletion.

Preserve the safe modal and no-dismiss-after-submit behaviour. Finish reset/reauth return paths using existing auth configuration, including a non-password sign-in method if supported. No new domain/provider setup; classify any unavailable external provider separately.

## 4. Finish reminder-worker semantics, not only preference saving

Keep atomic partial preference updates and the explicit form. Add recovery for saved-write/failed-read as well as saved-write/failed-sync. Validate time strings and incoming field types strictly; unsupported fields must not produce a fake saved acknowledgement.

Distinguish material source failure from an authoritative empty result. On unknown appointment/exam/review state, do not cancel every pending job, revive an obsolete job, send an inappropriate message or report delivery configuration as missing when the database failed.

Use scoped isolated tests for the real worker service and claim protocol:

- mock moved/cancelled/completed, including returning to its prior date;
- quiet hours wrapping midnight, changed after job creation, and equal start/end under current policy;
- opt-out, re-opt-in, exam-sat and account deletion before send;
- weekly review no longer eligible even if its cycle remains active;
- known provider rejection versus uncertain delivery, no automatic duplicate send after uncertainty;
- two workers, expired lease/late worker, preference change while claimed, and post-send persistence failure;
- post-save load/sync and source-read failures, preserving truthful saved/pending state.

Do not claim or fake-send other users' shared jobs. Use an isolated database or an appropriately scoped service seam that still exercises the real rules/locking; no public user-filter bypass. No real email. Report provider-ready, scheduler-ready and preferences-saved separately; credentials alone do not prove delivery is operating.

## 5. Finish export correctness and browser integration

Retain the one-way snapshot contract and independent parser. Fix the mock-appointment, material-read-error, moved occurrence, overnight and ambiguous-DST gaps in section 1. Preserve canonical absolute instants where they exist; presentation minutes are not sufficient to reconstruct every timed event.

Use stable original identities when a class occurrence moves, and deduplicate only actual multiple representations of one object. A class/commitment opt-in must not accidentally hide a booked mock. Keep privacy-safe repair/re-check titles and distinguish all-day non-blocking work from actual occupied time.

Assert the encoded semicolon backslash as bytes rather than repeating the same faulty JavaScript string literal in expected output. Keep Unicode/folding/CRLF tests. Re-export after class-finished/undo, occurrence moves, mock edits and weekly rollover and compare to actual displayed accepted state. Do not add feeds or two-way sync.

Retain the personal export's explicit non-snapshot limitation. Check parent-owned rows and sensitive internal fields/worker tokens deliberately; correct stale test filenames in source comments. Do not broaden exports to shared authoring content merely because it has a relationship to a person.

Complete the desktop/390px browser matrix in the existing Settings spec:

1. Saved setup/name changes, refresh and Home/Calendar/Curriculum/Tests/Coach agreement.
2. Two-tab stale edit, preserved input, reviewed plan impact and lost save response.
3. Class-led classes-finished/undo and both parsed downloads from that account.
4. Forced deletion failure, stale requesting session versus another recent device, successful reauth, post-commit lost response and cross-device access removal.
5. Reminder unavailable read, saved-but-follow-up-unavailable states and delivery-not-configured copy.
6. Reset/reauth safe return, keyboard/focus/IME, error announcements and no overflow.

Use Browser if available, otherwise installed Playwright with the fallback recorded. Keep browser-driven steps distinct from API/isolated-worker supplements. No screenshots/headings-only proof of persistence or selected state.

## 6. Completion and remaining owner decisions

Implement this closeout, do not repeat the original full S0–S5 redesign. Run targeted pure/HTTP/DB/browser suites plus full `npm run verify` and TypeScript on the final tree. New additive migrations require current-function/privilege, transaction, clean-install/upgrade/restore and ledger proof. Reuse the existing setup version instead of inventing another one.

Do not edit/apply Journey B's work without coordination. Register every account/object/fixture immediately and clean exact owned IDs. Never change global admission, dispatch real mail, delete owner data or kill a process by port matching. Stop only the owned server and restore generated types using the helper.

Update §9.33 or its next closeout section with completed controls, actual route/state owner map, app-wide effect matrix, race/failure proof, parsed downloads, session/storage limits, failed/skipped checks and cleanup. Store no access tokens, email credentials or private auth links in evidence.

Retention/legal wording is not a blocker for the functional fixes: make existing technical statements factually accurate and keep unapproved policy text labelled draft. Do not invent new retention durations or claim legal compliance. Report the exact audit/backups/external retention facts and any remaining owner policy decision separately; no new retention platform in this slice.

Settings is complete only when changed settings lead to the correct accepted or review-required state throughout the app, not merely when the Settings page saves. Journey B/C and genuine question-bank activation remain separately open.
