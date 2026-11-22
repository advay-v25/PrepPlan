# Roadmap app audit follow-up

This records the code changes prompted by the [21 November audit](APP-AUDIT-2026-11-21.md). The original report documents an earlier working tree.

## Student and platform fixes

| Finding | What changed |
|---|---|
| A-01 · Access and authentication | The auth rewrite now uses absolute redirects and preserves the requested page. Real browser journeys exercise email confirmation, password reset, password sign-in and sign-out with disposable identities. |
| A-02 · Reading coverage | Home and Curriculum share one reading-coverage calculation. Partly covered readings have their own count. Logged work and scored understanding remain independent. |
| A-03 · Age of evidence | Home formats the evidence age once using the student's local day. The recency rule uses the same calendar-day calculation. |
| A-04 · Failed saves | Confidence stays on the last confirmed value until a save returns successfully. Confidence and status overrides report failed or stalled requests and allow a retry. Reviewer challenge resolution also recovers from a failed response. |
| A-05 · Failed paper load | The runner has a bounded read, a retry and a route back to Tests. The server refuses incomplete reads of the form or saved responses. |
| A-06 · Database errors | Commitments, coverage, roadmap and the legacy diagnostic handlers return readable messages and operation references for database failures. Operational logs retain the code and reference. |
| A-07 · Reminder sweep | The worker claims up to 72 opted-in students per tick, works on up to six at a time, and resumes from the last attempted student. A private lease guards overlapping ticks and an interrupted tick leaves the unprocessed tail available. |
| A-08 · Exam controls | Home's exam countdown and the permanent Settings link open Exam status. That is where students record a sitting and start a retake. |
| A-07b · Paper links | Malformed, missing and foreign IDs lead to the same helpful Tests notice. Closed history rows have a status and no resume link. |
| A-08b · Coach | An empty or whitespace-only message disables Send. |
| A-09 · Remaining time | Home's remaining minutes track the rows shown, including changes when the student expands the list. |
| A-10 and A-11 · Weekly Tests | The first card states the blocker once and gives the next action. Log learning uses the same label on Home, Calendar, Tests and reading pages. |
| A-12 · Calendar sittings | Compact blocks show the sitting number ahead of the title. Their full titles remain available to assistive technology. |
| A-13 · Reviewer pages | The shared reviewer guard sends signed-in non-reviewers to the 404 page. Reviewer API permissions continue to be checked separately. |
| A-14 · Invitation screen | The screen uses a single-column layout and signs the student out before offering another email. |
| X-01 · Page titles | Main pages, editor steps, papers and reviewer screens have purpose-specific titles. Subject and reading titles use the active curriculum. |
| X-02 through X-04 · Controls | The learning note has an accessible name. Dense links and setup chips have larger targets. Native buttons have explicit types and the shared button defaults to a regular button. |
| X-05 · Loading and errors | Home, Tests, Curriculum, Calendar and Coach each have a loading state scoped to that page. The application has a branded 404, a recoverable app error and a root error screen. |
| S-01 and S-02 · Headers | The existing nonce-based Content Security Policy and HTTPS-only HSTS were reviewed with the auth changes. |
| S-03 · Development hosts | The committed LAN address and wildcard are gone. Optional additional development hosts are exact names in `ROADMAP_DEV_HOSTS`. |
| S-04 · Search indexing | The robots file and response headers tell crawlers to leave authenticated, onboarding and account routes out of search. A public sitemap and installable-app manifest would be separate product choices. |
| S-05 · Test identity | The test identity utility lives in `scripts/lib` and its import paths have been updated. |

## Cleanup decisions

| Audit item | Disposition |
|---|---|
| C1 · Blended readiness | Deleted the unused combined score and its score-only test. Coverage, activity, understanding and confidence retain their separate checks. |
| C2 · Script callers | The curriculum catalogue, verifier adversarial cases and repair dates have seeding or regression callers. Bank coverage now supplies the minimum-family rule used in the capacity report. The test identity utility moved with its existing callers. |
| C3 · Unused exports | Removed unused routing, motion, logging, Coach, adaptive-practice and rehearsal exports. Split-task, observed-pace and week-commit functions have regression or fixture callers. An export with a caller outside `src/` still has a purpose. |
| C4 · Date and time helpers | Consolidated duplicate calendar-date validation, formatting and clock labels. Home's main dates and Calendar's week range use the browser's supported locale preference. Persisted dates, scheduling and exports retain their existing time-zone rules. Full translation and localisation of every legacy date label remain separate work. |
| C5 · Styles | Removed 50 retired selector branches, about 4.2 KiB. The Tests history still uses some `dashboard-*` classes, and the result page still uses its result styles. The audit's 227 matches were leads for review. |
| C6 · Class log payloads | Create and update now share one task mapping. Each keeps its own identity and planned-minute rules. |
| C7 · Large files and casts | Typed the class preview and command mapping while fixing the duplication. The planner, Calendar and verifier still contain active domain logic. A file's line count alone does not justify another layer. |
| C8 · Compatibility links | Kept the small redirects for `/app/syllabus`, `/app/week` and `/check/result` so existing bookmarks still work. |
| C9 · Repository artefacts | Removed nine inactive generated Next build directories, approximately 5 GiB from the pre-cleanup sizes. Moved the closed-week screenshot to `docs/evidence/`. Replaced the one-off audit scripts with the maintained browser suite. Phase documents, evidence and migration history remain available. |

## Usability details

- Home shows one line of recorded recent activity. It needs no last-visit tracking, and practice papers do not appear as new scored evidence.
- Log learning remembers the last saved reading for the same account on that browser. Each log still needs the student to choose the outcomes they actually covered. An explicit reading link takes precedence.
- Calendar shows the keyboard-accessible path through a task's existing editor. Phone users still start in Agenda.
- Settings explains exam, class and availability effects beside the relevant controls. Existing reviewed-plan changes remain explicit.
- Failed reads offer retries with support references where the server recorded an error. Confidence and the learning log announce their save states.

## Scope of the deeper checks

The code checks use disposable accounts and synthetic assessment inventory. TypeScript, the route audit, `npm run verify` and the isolated production build pass.

- A revision journey reproduced a false failure after a mock saved successfully. The response now keeps the committed receipt and reports a failed projection refresh separately. Checkpoint dialogs handle that response and reject an unreadable response body.
- The same revision journey found that the ranked queue could fill a short week with one flagged subject. The placement order now applies the existing subject-share rule to the part of the queue that fits. It preserves the leading priority, protects due work from being displaced by recent work, and honours the existing rotation tiebreak. All 59 pure revision-queue checks pass.
- A later full revision run passed 58 of 59 checks and brought one reading back a week early. The draft ranked revision without the student's pending choices from weekly review. It now applies those choices to selection history before proposing the next week. Confirmed learning and evidence still come from the saved records. A focused rerun passed 31 of 31 checks, including the four-cycle rotation and the short week with a flagged subject.
- The production browser run passed 8 checks covering public and signed-in pages, the 404s, recovery, password sign-in, self-study and class-led accounts at desktop and 390px. A separate synthetic-bank run passed both failed-load and retry checks on the same reserved paper.
- The self-study browser rerun passed at both widths after adding the save-and-reopen learning-log check. The reading was remembered and the confirmed outcomes stayed clear for a fresh log.
- The reminder test traversed 1,205 opted-in records in local Postgres. The existing worker suite passed 25 checks with simulated delivery, including quiet hours, stale bookings and uncertain sends.
- The development database has all 146 migrations recorded. Install, upgrade and restore rehearsals passed, with no pending migration.
- The notes and flashcards journey passed 38 checks. The auth database suite passed 20. The account-export schema check passed 4.

### Production-build measurements

Five warm sequential requests per page on a disposable student, with the production build running locally against the development database. Counts include authentication and RPC requests. The shared exam and mock readers now reuse exact repeated reads within a page request.

| Route | Supabase requests | Median time | Highest of five |
|---|---:|---:|---:|
| Home | 109 | 2.21 s | 2.32 s |
| Calendar | 112 | 1.60 s | 1.87 s |
| Settings | 13 | 0.33 s | 1.83 s |

The Calendar sample used 114 calls before the request-local reuse change. Home and Calendar still make repeated reads of profiles, cycles and tasks. The measurements are a baseline for a focused performance pass and cover one ordinary history.

Earlier parallel runs hit database timeouts. One delayed recovery-grant write required a fresh reset link. The production browser rerun passed. The longer scored journey also timed out before its repair and re-check steps. The separate paper retry test covers the audit's runner defect at both widths.

### Work still open

- Home and Calendar need a measured read-reduction pass. The ordinary production-build samples still use more than 100 Supabase requests per page. Long-history production timing and load behaviour remain open.
- The long scored repair and re-check browser journey needs a complete rerun. The reviewer workspace and generation pipeline have existing phase tests. This audit rechecked student access to reviewer pages and error handling in challenge resolution.
- Locale preferences cover the main dates changed in this audit. A full sweep of legacy labels, daylight saving and midnight boundaries is larger than the date fixes here.
- The actual bank has 303 quarantined candidates and zero approved routine or held-out questions. Live email, the AI provider and human question review still need their own checks.

The [manual authentication setup guide](AUTHENTICATION-SETUP.md) is ready for the next step. No dashboard setup is required to review these code changes.
