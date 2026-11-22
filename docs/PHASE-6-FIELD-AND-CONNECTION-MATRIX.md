# Phase 6 — field effects and connected acceptance

This is an implementation map. Test outcomes belong to the final evidence record; a listed route is not itself proof of a passing journey. Existing policies, paper eligibility, scoring and planning commands remain authoritative.

## Settings fields

| Student change | Editor and write owner | What changes | What must stay unchanged | Recovery / next action |
| --- | --- | --- | --- | --- |
| Display name | `/app/settings` → `PUT /api/profile` | `profiles.display_name`; refreshed server layout supplies the same name to Home and both navigation views | Setup revision, roadmap, cycles, evidence, accepted work | Newer in-flight text survives. The receipt distinguishes an earlier saved value from the current draft. IME confirmation cannot submit. Failed request retains text. Long names wrap on Home and truncate in navigation without stretching the viewport. |
| Target month/year, registration and exact date | `/onboarding/exam?returnTo=...` → `POST /api/onboarding/exam` → checked setup command | Canonical profile target, context revision, roadmap horizon and draft freshness; tentative month remains distinct from booked date | Accepted work/history, reserved questions and scored evidence | A stale edit is refused whole. A committed save with unreadable impact stays saved and shows its version. Calendar reviews existing work; no automatic date overwrite of history. |
| Preparation route and class pattern | `/onboarding/route?returnTo=...` → `POST /api/onboarding/route` | Prospective class pattern, roadmap route and future cycle/test cadence | Accepted cycle boundaries and attendance history | Reopen Calendar for reviewed adjustments. Class changes use occurrence/future-series commands, not direct table writes. |
| Classes finished / undo | Settings toggle → `POST /api/profile/classes-completed` | Completion date and exactly the series ended by this action; future planning becomes self-directed | Finished work, accepted cycle, unrelated archived/cancelled series and later explicit edits | Undo uses recorded prior series ends. A restore over a protected mock is refused atomically. Lost response is unconfirmed, never proof of rollback. |
| Study windows, commitments, sitting limit | `/onboarding/week?returnTo=...` → `POST /api/onboarding/week` | Checked availability, limits and setup version used by new previews; stale drafts become stale | Accepted tasks and reported minutes | Explicit impact receipt; Calendar move/review controls. No weekly-hours target and no automatic accepted-work displacement. |
| Starting position, topic/reading coverage and uncertainty | `/onboarding/position?returnTo=...` → `POST /api/onboarding/position` | Self-reported starting scope and future revision/roadmap priorities | Diagnostic evidence and existing accepted week | Covered is not understood. Three-covered-subject entry stays midway; first-pass-complete entry does not restart all readings. |
| Next mock context | Position editor and Calendar checkpoint/report commands | Same canonical appointment schedule consumed by Home, Calendar, Tests, Coach and roadmap | Scored papers and historical reports | Calendar owns move/cancel/debrief; confirmed slot/spacing/scope restrictions remain authoritative. |
| Reminder opt-ins and quiet times | Settings → `GET/PUT /api/reminders/prefs` | Atomic partial preference patches; relevant jobs synchronised | Unrelated preference fields | Explicit Save; failed load is unavailable, not opted-out. Lost response keeps edits; committed save with failed sync says sync pending. No mail configuration means no mail delivery. |

Setup writes require the version read by the editor. Optional fields are not cleared by omission. After an unconfirmed response, reload the saved setup before another edit; a stale retry cannot silently overwrite a concurrent change. A missing impact comparison cannot be reconstructed from the new state alone: the receipt says so and links to the current Calendar, rather than fabricating a before-and-after result.

## Page and action ownership

| Entry | Read / command ownership | Connected outcome |
| --- | --- | --- |
| `/app` | Operating state and canonical assessment decision, signals, roadmap, Calendar projection, exam status | One next action; exact task/day, owned attempt/result, selected repair/proposal or review. Partial minutes/defer/undo use the task command. Optional read failures show Retry. Unknown exam status does not advertise an active study action. |
| `/app/calendar?week=<date>&view=agenda` | Study-cycle context and strict Calendar projection | Timed events, day-only sittings, unplaced work and history stay distinct. Future weeks say Forecast: classes/commitments/mocks can be arranged, but empty-grid study creation waits for an accepted week rather than opening an editor the cycle guard will refuse. Mock administration follows current work. |
| `?task=<id>&week=<task day>` | Owned task projection / lineage; task drawer → `/api/tasks/<id>` | Keyboard date/time/length controls match dragging; pending submissions freeze their fields. Ordered predecessors link by ID. Cross-cycle continuation retains old history. |
| `?entry=<occurrence id>&week=<date>` | Existing authorised Calendar entries only | Opens the exact protected event cited by a conflict; unknown/foreign entries say unavailable. This selection performs no write. |
| `?appointment=<id>&week=<date>` | Owned checkpoint service | Opens the exact booked mock. No unrelated appointment fallback. |
| `?commitment=<id>&occurrence=<original date>` | Class occurrence command / receipt | Move, cancel, restore or future-series edit → reviewed recovery → one acceptance. Earlier classes and accepted cycle stay intact. |
| `?plan=review&change=<operation key>` | Class-change receipt and current-week draft command | Preview writes nothing; stale changes refuse whole; retry replays. No-room/unplaced work stays discoverable. |
| `/app/calendar/log-class` | Class log context, preview and atomic confirmation | Full/part/continued extent → feasible ordered follow-up sittings; partial coverage stays pending for testing. |
| Weekly review | Existing answers → saved draft → accept command | One next cycle and linked continuations, with original week/time retained. Intentionally empty weeks remain valid. |
| Tests / result / follow-up | Canonical decision, frozen reservation and score/evidence ledger | Actual confirmed scope → paper → result → repair → spaced fresh re-check. Fixture availability is separate from real bank capacity. |
| Curriculum reading | Shared coverage/evidence, notes and flashcards commands | Self-report remains separate from diagnostic evidence; notes/cards return to the same result or revision task. Card practice completes no task. |
| Coach | Guarded situation, deterministic decisions and reviewed proposal commands | Exact report/task/result/exam links. No tutoring or unconfirmed mutations. “When is my exam?” routes to exam context even without a model. |
| `/account` | Signed-in own-account access outside completed setup | Export, this-device sign-out and confirmed deletion. Recent requesting-session authentication, storage ownership and honest partial/lost-response outcomes remain enforced. |

Generated work stays inside saved study boundaries. Manual moves keep the existing flexibility, but a longer sitting or a placement outside the saved windows now requires an explicit one-time warning/confirmation. It changes neither Settings nor future generated limits. Protected bookings and sitting order cannot be overridden. **The owner confirmed this policy on 18 November 2026.** Moving an existing 44-minute sitting preserves 44 minutes rather than silently rounding it to 45.

## Downloads and external effects

- Calendar `.ics` is a one-way snapshot from the canonical projection. Clock-timed events retain timezone/DST semantics; day-only tasks are non-blocking all-day reminders. Unplaced/deferred work is excluded and counted. Classes/history are opt-in. Existing event identity survives ordinary moves; future-series changes retain their documented identity boundary. The independent parser and selected-view comparison are the acceptance controls.
- Personal-data export pages owned records and parent-owned children, includes current schema additions, and fails the download if a page fails. Shared-bank answer keys, tokens and another student's data are excluded. It does not claim a transactional snapshot.
- Reminder acceptance uses only controlled transports and owned jobs: quiet times, moved/cancelled mocks, exam sat, opt-out/revival, uncertain delivery, stale leases and deletion-before-send. No real email is authorised.
- Deletion cannot be one database transaction across Auth and Storage. The interface must state whether an operation failed, committed or remains unconfirmed. A successful deletion with lost response must not claim the account still exists. Legal retention wording remains beta/policy-pending.

## Eight-scenario acceptance ownership

| Scenario | Browser proof | Backend checks |
| --- | --- | --- |
| Fresh baseline | `phase6-home`, `phase6-completion`: next action, partial, reload, defer/undo, keyboard placement and week spread | Task revision/history and accepted task snapshot |
| Three subjects covered midway | `phase6-completion`: three coverage choices, uncertainty, Settings edits, dependent pages | Self-report rows, unchanged evidence and accepted work |
| Class-led | `class-followup`, `class-editing`: feasible work, short transition, reviewed recovery, no-room → review/continuation | Atomic class/recovery commands, lineage and pending scope |
| Mature entry / poor mock / final week | `phase3-recovery`, `phase3-closeout`, `phase5-closeout`, `phase6-completion` | Report provenance, bounded proposal, horizon and evidence unchanged |
| Zero bank / fixture paper loop | `phase4-student` with Home resume/result additions | Registered item IDs, approval/family policy, repair spacing and score ledger |
| Settings effects and failures | `settings`, `phase6-completion` | Version/CAS, impact failure, lost response, classes-finished/undo suites |
| Downloads, reminders and deletion | `settings`, `phase6-completion` | Parsed ICS/JSON, 1,200-row export, schema drift, controlled worker and Auth/Storage failures |
| History / forecast / empty / long history | `class-followup`, `phase3-closeout`, `phase6-completion`; owned performance fixture | Read-only snapshots, truthful failed reads, 50 closed cycles / 1,200 sittings measurement |

Browser setup, seeded scores or time shifts are recorded as fixtures. They establish a situation; only driven actions prove the resulting user flow. The final evidence must retain failures and their resolution, exact exceptions, cleanup and remaining external content/provider limitations.

## Final evidence and measured reads

The final outcomes and exact artifact paths are recorded in `docs/evidence/phase6-final-completion-2026-11-18.json` and master status §9.56. The matrix above describes ownership; the final record qualifies which steps were seeded, driven or reused from unchanged database suites.

Home's operating bridge now asks the existing weekly reader for its canonical gate only. The full review route still composes the next-week preview. The 18-check gate comparison covers a current cycle, an ended-cycle clock, an external mock and no active cycle, with no changes to accepted work or evidence. Calendar reuses the already-loaded roadmap input for progress. Neither change introduces cross-request caching.

Warm development samples (five per page, cold sample excluded) count instrumented server HTTP reads, not SQL statements or later browser requests. Ordinary Home fell from 145 to 108 reads; long-history Home from 158 to 114. Calendar fell from 127 to 113 and from 135 to 119. Settings stayed at 13. The corresponding latency snapshots and their limitations are in `docs/evidence/phase6-final/performance-{before,final}.json`. They are small dev measurements, not production guarantees or a controlled causal experiment. A separate overlapped diagnostic run is excluded. Historical long stalls remain unclassified.

The first-week concentration probe uses a fresh midweek London student with a 45-minute sitting limit. Its four remaining study dates receive 171, 171, 146 and 228 minutes against three 180-minute weekday windows and a 240-minute Saturday window. No sitting exceeds 45 minutes. These are retained planning defaults within the supplied windows, not a recommendation to study that many hours. The Calendar now exposes the day totals and lighter/move routes without silently changing an accepted week.

The personal export's schema check additionally found four missing owned collections: `flashcard_commands`, `flashcard_draft_requests`, `mock_reports` and `mock_report_commands`. They now use their actual primary keys and complete paging. Account and navigation sign-out share this-device scope and truthful failure handling; separate-browser proof checks that another session survives.
