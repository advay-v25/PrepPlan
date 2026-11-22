# Roadmap — Settings, account controls and calendar export

Prepared 14 November 2026. Dedicated implementation prompt for the builder; the owner-review pass audited source and sampled the rendered page. This work does not replace the outstanding lifecycle A/B/C closeout or content-supply work.

## Assignment

Deliver a working Settings system: useful account/setup controls, truthful app-wide effects, safe sign-out/deletion, complete personal-data export and a real calendar download. Implement and verify the slices below in order. Do not stop after rearranging cards or adding buttons whose effects are unconnected.

Read `AGENTS.md`, Ponytail, founder decisions, canonical setup/planning contracts and current master status before editing. Read installed Next.js guides before framework changes. Preserve unrelated dirty work and current access, approval, scoring and task-history policies. Reuse canonical commands and editors rather than rebuilding onboarding/planning inside Settings.

No commits, deployment, payments, domain/email-provider/OAuth provisioning or real outbound email. Do not delete or alter the owner's account, other workers' fixtures, shared admission settings or real student data. Use ordinary throwaway students on the confirmed disposable development project, registered immediately and cleaned by exact ID.

## 1. Audit baseline: confirmed versus unproven

Source inspected: `src/app/app/settings/page.tsx`, `src/components/settings/*`, account/profile/reminder routes, `src/lib/account/export.ts`, reminder service/rules, canonical setup service and plan-impact wrapper.

| Finding | Evidence / required outcome |
|---|---|
| Mobile action row overflows | Browser at 390px measured document width 431px. Sign Out / Download my data / Delete Account remain in one unwrapped row. Fix responsive controls and long support copy. |
| Calendar export does not exist | No current `.ics` implementation or calendar-export route was found. Deliver it, not just the JSON personal-data download. |
| Personal-data export has drifted | `OWNED_TABLES` omits `practice_runs`, `practice_run_receipts`, `coach_model_calls` and parent-owned `practice_run_sets`. Its comment cites a nonexistent `scripts/account-controls-test.ts`; the real older check is in `e2e-beta-controls.ts`. Inventory the current schema, not this partial list. |
| Pagination is not deterministic | Export passes `.range()` queries with no `.order()` to `readAll`. Fix ordering/composite keys and test beyond the API row limit; do not silently truncate or duplicate records. |
| Settings summary uses wrong units | `state.coverage` is topic exposure, but the page calls the count modules. Summarise the actual entity and separate self-report from evidence. |
| Failed reads can look empty | Appointment reads catch errors as `[]`; reminder preference reads default after an ignored error; commitment errors are not distinguished. Unavailable is not no mocks/no classes/default opt-out. |
| Save races and misleading errors | Reminder saves read the full row then overwrite it; rapid or two-device edits can lose another patch. The UI fires saves on every change with no ordering. Classes-finished errors are silent. Failed HTTP reads may leave reminders on Loading indefinitely. Reproduce these paths and fix centrally. |
| Profile endpoint is a competing setup writer | `/api/profile` accepts a different preparation-mode/sitting-limit contract from onboarding and writes a legacy exam record after committing the profile. A failure can leave partial success. Keep real callers working while converging on canonical ownership. |
| Setup effect copy overpromises | `saveWithPlanImpact` reports capacity/cycle differences but does not move accepted tasks. A post-save read can fail after the setup committed. Distinguish saved setup from pending plan adjustment and make retry safe. |
| Classes-finished effects need tracing | The toggle writes `classes_completed_at`; study-week resolution still reads active class recurrence. Verify roadmap, future occurrences and future cycle/diagnostic timing agree without rewriting the accepted historical week. |
| Deletion can mutate before failing | The route cancels reminder jobs before `deleteUser`, then says nothing was removed on failure. Make operation state and copy truthful. |
| Recent sign-in is account-global | Deletion checks `user.last_sign_in_at`, not proof that the requesting session recently authenticated. Test an old device while another device signs in; use verified current-session authentication evidence. |
| Sign-out has no failure path | Returned auth errors are ignored, and navigation can imply sign-out without success. Handle the actual local/server session outcome. |

Browser sample: existing local app at `http://localhost:3141`, Playwright fallback because Browser plugin was unavailable; desktop 1280px and mobile 390px. Settings rendered, no console errors were captured, deletion confirmation began disabled, and Escape closed it without deleting the account. A later reload timed out at 30 seconds, so reminder-failure recovery and export download were not browser-proven. The exact temporary student was removed and deletion verified. Do not claim this sample is a complete Settings journey.

The owner-review pass reran `reminders:test` and `onboarding:contract:test`: 18 + 18 passing pure checks. Account deletion, export completeness and save races still require dedicated proof.

## 2. S0 — define the ownership and effect contract

Produce one compact table with each editable setting, canonical read/write owner, validation, immediate effect, plan-review requirement and affected pages. Implement from it. Every visible control must have a real purpose and end-to-end acceptance test.

| Setting | Required behaviour across the app |
|---|---|
| Display name | Validated name-only patch; Home/account display updates after refresh. It does not change exam, route, sitting limit or plan scope. Email remains read-only here. |
| Tentative sitting / registration / booked date | Existing canonical exam editor. Keep target month distinct from the booked day; update roadmap horizon and subsequent previews, invalidate stale proposals, preserve scored/reserved forms and history. |
| Preparation route and class pattern | Canonical route editor and commitment services. Reflect actual classes and prospective cycle policy; no hidden deletion of class history or compulsory restart of covered subjects. |
| Current position / reported coverage / uncertainty | Canonical position editor. These are self-report, never diagnostic mastery; existing scored evidence is not overwritten. |
| Study windows / unavailable commitments / sitting limit | Canonical week editor and validators. Save the allowed window, not prescribed weekly study hours. Show the effect on unfinished future work and the exact reviewed action needed. |
| Classes finished / undo | Shared profile/setup command, consistent prospective roadmap/calendar/cycle effects and clear effective date. Undo preserves actual learning and historical class logs; it does not blindly recreate every cancelled event. |
| Reminder choices / quiet hours | Atomic, validated patch; no lost fields; pending jobs and later worker decisions use the saved preference. Clearly distinguish saving preferences from operational delivery availability. |
| Calendar download | Read-only export of the accepted schedule and actual commitments/appointments in a chosen range. No new plan, evidence or reminders. |
| Download my data | Authenticated owner-only complete personal-data download, with precise documented exclusions and failure handling. |
| Sign out / delete account | Correct session handling, confirmation, recovery and removal behaviour; no stale access or false success. |

Keep the main navigation at the existing six destinations. Do not reintroduce Materials/sources, add a required timezone question, allow an arbitrary weekly-hours target, or let a calendar-display preference override class-led cycles or the self-study Monday–Saturday/Sunday rule.

Do not invent dark-mode, notification, language, integration or session-management toggles unless their actual behaviour is in this slice. Reuse current authentication; no new Google/email infrastructure. Existing reset links must return sensibly and respect the actual sign-in method. Do not imply an OAuth-only account necessarily has a password.

## 3. S1 — reliable settings saves and visible app-wide effects

Build one calm `/app/settings` page with compact groups: Account, Study setup, Calendar/export, Reminders, Data/privacy. Keep detailed editors progressive: summary → exact editor → save → effect receipt → return. Use existing design/accessibility components. Account deletion lives in a clearly separated danger section, not beside routine actions in a cramped row.

Use saved canonical values, proper topic/reading units and meaningful empty/unavailable states. Show detected/stored timezone as context where relevant; do not add an onboarding requirement. Avoid an unexplained 15–21-hour capacity estimate as a target. Availability is a boundary, while the accepted plan shows actual planned work.

Each save must:

1. Validate on the server against the canonical enum/range/date rules, including any supported 20-minute sitting and self-paced-course options. Reject unknown/inappropriate fields; omitted fields remain unchanged.
2. Use the canonical atomic setup/profile command and version/ownership guards. Cosmetic edits must not invalidate study previews unnecessarily; planning-affecting edits must invalidate the relevant drafts/proposals.
3. Return an authoritative result: what saved, its version and whether a reviewed plan adjustment remains. A successful write followed by an impact-read failure must not be reported as an unchanged failed save.
4. Retain the user's input and recover after validation, stale conflict, network loss or unknown outcome. Retry a committed operation without repeating side effects. Two tabs must not silently overwrite one another's setup.
5. Refresh/invalidate the correct account-scoped reads. Home, Calendar, Curriculum, Tests and Coach agree on the saved inputs and accepted plan. Do not add a generic event bus or public cache to achieve this.

Changing settings is not permission to silently rewrite accepted work. Completed/partial tasks, minutes, diagnostic evidence and past cycles remain historical. The user sees a calm impact message and an exact Calendar/current-week draft action for affected unfinished work. Update that plan only through its existing review/acceptance flow.

For route/classes-finished transitions, prove what happens to future class occurrences, protected time, cycle anchors, pre-class diagnostic and revision phase. Distinguish the still-accepted current cycle from the prospective pattern. Do not merely change the roadmap label while the calendar continues to expect classes forever.

Trace all `/api/profile` callers. Keep it for name edits or adapt legitimate legacy callers to canonical services; do not leave a route where a name/sitting update commits before an exam-date error. Remove dead duplicate setters only after checking callers and tests.

## 4. S2 — reminders that save and recover correctly

Keep opt-in defaults and current quiet-hour semantics: equal start/end currently means no quiet period; preserve and label it. Save the start/end pair together when appropriate, and prevent incomplete time input from firing malformed writes.

Apply patches atomically, preserving other fields. Protect against rapid changes, out-of-order responses and separate devices. Use a small explicit Save or ordered pending-save interaction rather than unbounded autosaves. Loading, saving, saved, validation, unavailable and retry states must be distinct.

Preference-save success must not depend on silently succeeding at every downstream read. If reminder reconciliation needs retry, retain the saved preference and report delivery/sync state truthfully. Failed reads do not become default opt-out; toggling back on must handle previously cancelled same-key jobs correctly without duplicate sends.

Recheck relevance and opt-in immediately before dispatch. Cover mock moves/cancellations, weekly closure, quiet-hour changes, exam-sat and account deletion. A reminder already handed to the provider cannot be recalled; do not promise otherwise. Keep indeterminate delivery separate from confirmed failure and avoid duplicate delivery on retries.

If sender credentials/worker scheduling are unavailable, show that delivery is not active while preserving preferences. No fake Connected/Sent status or dead test-email button. Use a controlled transport in isolated tests; do not send real messages or claim all shared users' jobs with a fake sender. Do not run the old whole beta suite merely to test Settings: it changes global admission and can touch unrelated queued work. Extract scoped account/reminder tests instead.

## 5. S3 — calendar export students can actually use

Deliver **one-way `.ics` download first**, from Settings and Calendar, without requiring Google OAuth or connecting an external account. It is a snapshot, not live sync. Say that exported files do not change automatically when Roadmap changes, and reimport behaviour varies by calendar client. Do not promise duplicate-free synchronisation from a file import.

Add a canonical authenticated read-only route such as `GET /api/calendar/export`, registered with the routing helpers and called by both pages. A bounded range defaults to this week plus the next four weeks, with explicit date controls and sensible maximum size. Validate range, options and ownership; ignore any client-supplied account ID.

Use the same schedule/occurrence readers as Calendar:

- Include accepted timed study/revision/repair/test blocks and booked mock appointments, with real times/durations.
- Include actual classes/protected commitments when chosen, respecting recurrence start/end, exceptions, skipped/moved occurrences, overnight events and cancellations.
- Deduplicate canonical task/appointment/commitment representations by identity, not title. A mock displayed through both a task and an appointment must not export twice.
- Day-preferred dated work may be exported as an explicitly all-day, non-blocking reminder. Undated/unplaced work has no invented time: exclude it and show its count/reason in the export preview, with a Calendar link to place it.
- Drafts/forecasts are excluded by default; do not turn a projected future week into committed events. Optional completed history must be labelled and use actual historical dates. Respect the exam horizon without hiding already-existing history.
- Titles and short study objectives are sufficient. Exclude assessment keys/questions, scores, private notes, confidence and weakness labels by default. Links open the exact normal authenticated Roadmap object; no embedded session/token or invented public share link.

Generate standards-compliant iCalendar with stable event identity, correct UTC/local conversion, non-inclusive all-day end dates, safe text escaping, CRLF and UTF-8 line folding. Do not generate invitations or email attendees. Test the output with an independent parser as well as semantic assertions. See [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) for the format contract.

Use deterministic UIDs across downloads of the same event, and preserve moved occurrence identity. Do not expose account email as a UID. Return `text/calendar`, a safe attachment filename and private no-store headers. Failed/invalid downloads show an actual error instead of saving an error JSON file as `.ics`.

An empty range still returns an honest valid empty calendar or a clear no-events state. Provide a preview/count including excluded unplaced work. Test Unicode, commas/semicolons/newlines, long labels, DST and Asia/Kolkata. Re-export after a confirmed move, class exception, mock edit and weekly rollover must match the new accepted state while old downloaded files remain snapshots.

No subscription feed, two-way sync or calendar-provider integration in this slice. Do not expose a bearer URL merely to make Add to Google Calendar appear implemented.

## 6. S4 — complete personal-data export and safe account deletion

### Personal-data export

Update `/api/account/export` and the export manifest from the current schema. Cover direct owner rows and indirect personal rows through attempts, practice runs, repair threads and other parents. Classify operational/internal fields separately instead of dumping every table with a `user_id` blindly.

Include the student's setup, plans/history, activity/minutes, notes/flashcards, responses/confidence/timing, results/challenges, revision/repair state, external mock reports, adaptive runs and saved Coach conversation/proposals. Inventory the new practice receipts/sets and Coach call metadata deliberately. Do not include tokens, secrets, other students, private source packs or Roadmap question wording/keys. Document any justified operational exclusions.

Use deterministic pagination with stable unique/composite ordering and verify beyond 500/1,000 rows. Define consistency during concurrent edits; use an appropriate snapshot/read strategy or clearly bounded versioned export semantics. Do not call it a single consistent snapshot if tables are independently read while changing. Missing pages/errors fail cleanly rather than producing an apparently complete partial archive.

Return a versioned format, export timing, counts and clear exclusions. Handle file preparation/download errors in the UI. A personal-data export is not a backup that the student can re-import unless restoration is actually built.

Add a schema-drift test that catches new owned/parent-owned personal data. Replace the nonexistent test reference in the source comment with the actual maintained check.

### Account access and deletion

Keep `/app/*` gated by completed onboarding. Account-owner data controls must still be reachable by a signed-in person stuck in verification/onboarding/admission; use a minimal authenticated account-controls route outside the study-app gate if no existing UI provides this. It grants no access to study features or another user's records. Apply the appropriate own-session authentication to each operation, without making unfinished setup trap the account.

Keep deliberate permanent deletion with email confirmation and recent authentication; no progress-reset disguise. Offer the optional data download first, but do not force it. Explain actual irreversible scope, remaining retention and external effects in plain language.

Replace the account-global freshness assumption with verified evidence for the **requesting session**. Do not treat JWT issuance/refresh or another device's recent sign-in as fresh authentication. Reuse the existing auth flow for reauthentication; no new OAuth/domain setup. Test stale session A after recent sign-in on B. Supabase documents session IDs and authentication-method timestamps in [sessions](https://supabase.com/docs/guides/auth/sessions) and [JWT claims](https://supabase.com/docs/guides/auth/jwt-fields).

Inventory deletion across the live FK graph, indirect records, background jobs and any legacy owned storage. Deleting Auth alone may be blocked by owned Storage objects, and outstanding JWTs do not disappear merely because the account was deleted; prove the actual access boundary. See [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users).

Use the smallest reliable deletion operation for the actual resources present. Ordinary database rows should cascade atomically. If external storage requires multiple steps, track/retry partial progress honestly; do not promise a distributed rollback. Prevent continued writes/jobs from recreating records during deletion. Do not delete shared curriculum/question-bank content or another account's data. Trace any reviewer/history references so they neither block ordinary deletion nor erase shared content decisions unexpectedly.

Move pre-deletion mutations into a coherent flow: a failed `deleteUser` must not silently leave reminders cancelled while claiming nothing changed. Confirmed deletion, failed-before-change, partial/pending cleanup and unknown response must have different recovery. Repeated clicks and a lost response must not create contradictory outcomes or leak whether another email exists.

After success, clear the current browser session and invalidate account access from another browser/session through the actual server/API/RLS boundaries, including exports and background mutations. Do not claim an expired refresh token retroactively invalidates every outstanding JWT. Use verified server/session checks where required and prove the relevant paths.

Retain only the documented deletion audit and unavoidable external retention. A deterministic hash of a user ID is pseudonymous/linkable, not proof of “never who”; correct that copy and test the retained fields. Do not claim legal compliance or promise a backup expiry schedule that has not been established. Do not turn this into a new retention/legal-policy project; identify the actual remaining owner decisions.

Keep deletion modal focus, Cancel/Escape before submission, validation and keyboard behaviour correct. Once a destructive request is submitted, closing the dialog must not imply cancellation. Sign-out must report actual errors, clear the intended local/server session scope and never say all devices were signed out unless that operation succeeded. Respect the existing sign-out scope or make a changed scope explicit rather than silently altering policy.

## 7. Routes and app-wide acceptance matrix

Keep existing route helpers and ownership; add only necessary routes:

| Route | Owner / connection to prove |
|---|---|
| `/app/settings` | Canonical summary and grouped controls; no mutation during render. |
| `/onboarding/exam`, `/onboarding/route`, `/onboarding/position`, `/onboarding/week` | Existing edit flows with safe `returnTo=/app/settings`, saved inputs preserved. |
| `/api/onboarding/[step]` and current-week preview/accept | Atomic setup owner; stale drafts and reviewed plan impact without rewriting history. |
| `/api/profile`, `/api/profile/classes-completed` | Validated name/classes completion or compatibility adapter; no divergent exam writer. |
| `/api/reminders/prefs` | Owner-scoped load/save, versions and sync/delivery state. |
| `/api/calendar/export` (new) | Read-only `.ics` snapshot matching Calendar after accepted changes. |
| `/api/account/export` | Complete owner-only personal-data download. |
| `/api/account/delete` | Confirmed current-session deletion with truthful failure/retry states; retired immediate DELETE stays retired. |
| Optional authenticated `/account` | Only needed to expose own account controls outside the onboarding/admission gate; no study-app bypass. |
| Existing reset/sign-in/sign-out paths | Safe return, real provider/session behaviour and visible errors; no newly provisioned providers. |

For each mutation verify Home, Calendar, Curriculum, Tests and Coach before/after refresh, including two tabs. Exam changes affect horizon/drafts; sitting changes affect new scheduling, not old minutes; route/class changes affect prospective cycles; self-reported coverage does not overwrite evidence; cosmetic edits do not make unrelated plans stale. Existing papers/results stay frozen under their reserved policies.

## 8. S5 — required tests and browser proof

Create scoped Settings/account/export suites rather than running shared-admission or global-reminder side effects. Pure checks cover validation, effect classification, export mapping/serialization and deletion/reauth state handling. Database/HTTP tests cover ownership, atomic patch races, setup versioning, stale previews and failure rollback.

Use these scenarios at desktop and 390px:

1. Self-study: change name, sitting limit and availability; refresh, verify Home and Calendar, review/accept the affected plan and check Coach. Preserve unrelated settings/history.
2. Class-led: mark classes finished and undo; inspect roadmap, future classes, next-cycle paper timing and historical logs. Test an actual failure with a visible recovery action.
3. Midway/revising candidate: change reported coverage/uncertainty and tentative/registered exam details; scored evidence stays intact and horizons/drafts agree.
4. Two tabs: concurrent reminder fields, overlapping setup edits, stale plan and lost save response. No lost fields or double side effects.
5. Reminders: slow/503 load, invalid time, save error, missing delivery configuration, opt-out and exam-sat. Controlled worker tests cover moved appointments, quiet hours, duplicate claims and indeterminate delivery; no real email.
6. Calendar export: choose range/options, download and independently parse it, compare IDs/times with actual Calendar, move a task and re-export. Cover empty/unplaced, recurring exception, mock deduplication, Unicode and DST.
7. Personal export: two students with distinct markers and high row counts; include new/parent-owned data; exclude another student's marker, answer keys, tokens and private content. Test partial-read failure and real browser download.
8. Deletion: Cancel, wrong email, stale requesting session despite another recent device, retry after reauthentication, forced backend failure, repeated click and lost response. Delete only the disposable test student; verify all intended direct/indirect rows, owned files if any, pending work and session access, while the other student remains untouched.
9. Incomplete setup/non-admitted account: study app remains gated, but legitimate account controls work through their scoped UI and APIs.

Assert persisted IDs/revisions/counts and actual downloads, not only headings or HTTP 200. Capture keyboard/focus/IME, no framework overlay, console state and horizontal overflow. Use Browser when available; otherwise installed Playwright with the fallback recorded. Add repeatable browser specs in the existing test structure. Do not finish with all destructive and download journeys “not browser-tested.”

Do not run destructive tests on the owner account, grant real roles, alter global beta admission or send reminders to real addresses. Preflight local server and database target before fixture creation. Register exact resource IDs immediately, check cleanup errors and remove only owned resources/processes. Restore generated types through the existing helper.

Run full `npm run verify`, TypeScript and affected setup/planning/booking/Home/Coach/reminder/account regressions. New additive migrations need effective-function comparison, privileges, clean-install/upgrade/restore and ledger proof. Do not edit applied migrations or overwrite later patches from old function bodies.

## Completion handoff

Update one existing master-status section with actual controls, route/effect map, remaining external configuration and test evidence. Report desktop/mobile browser results, simulated versus real provider behaviour, downloads parsed, deletion/reauth/ownership/race proofs, schema state and exact cleanup. Keep external backup/retention limits and delivery configuration explicit.

Complete S0–S5. Do not label this finished if calendar export is only a button, account export omits new data, deleting can leave silent partial effects, or changes are visible only in Settings. Keep the lifecycle A/B/C and real question-bank/content readiness work separately open; this is the Settings system, not a market-readiness declaration.
