# Curriculum workspace: routes, reads, commands, invalidation (Phase 5)

Curriculum is the student's **study and score tracker, notes and recall-card workspace**. It is not a course reader. A page render or GET never marks learning, creates a card, calls a model, or places a task. Every API below requires verified email, admission and completed onboarding (`requireApplicationAccess`), and reads/writes only the signed-in student's rows.

## Pages

| Route | Query (validated) | Read owner | Writes | Notes |
|---|---|---|---|---|
| `/app/curriculum` | `q` (≤100 chars), `f` = `not_covered\|partly_covered\|covered\|attention\|revision\|notes\|cards`, `view` = `overview` (default) `\|notes\|readiness\|roadmap`, `band` (readiness) | `getWorkspaceRows` (one row per reading from the canonical tracker, revision overview, own notes and cards) + `getCurrentOperatingState().nextAction` | none | Compact summary, next step, search, filters, collapsible outline. Failed read = visible unavailable state, never an empty list. |
| `/app/curriculum?view=notes` | `q` | same rows + own subject notes | none | Notes index: scope, a bounded preview (≤160 chars) and saved time. Search runs on the server over the **full** plain text of each note (reading and subject; at most 112 scopes, so no search platform) and shows a window around the match; the full text is never sent to the browser. |
| `/app/curriculum?view=readiness` / `?view=roadmap` | unchanged | `getLosTracker` / roadmap service | none | Existing URLs preserved (now under compact tabs). |
| `/app/curriculum/[subject]` | `q`, `tab` = `work\|notes\|cards`, `return` | `getSubjectReadings`; notes read only on `tab=notes` | note autosave API, card API | Reading list is searchable; editor/deck mount only on their tab. |
| `/app/curriculum/[subject]/[reading]` | `tab` = `work\|notes\|cards`, `los` (outcome of THIS reading), `result` (uuid of the student's OWN attempt), `return` | `getReading` (a failed read throws; an unknown or wrong-subject reading is a 404), tracker, revision status | mark/override/log-learning (existing) | `los` not in this reading → message, nothing highlighted. `result` not the student's → "not available", nothing linked. |
| `/app/curriculum/flashcards` | none | due cards API + workspace rows | card API | "Cards" view: due review (exact total, next due time) + cards by reading. |

**Return context.** `return` is accepted only if `safeInAppReturn` passes **after normalisation**: raw value starts with `/app`, no scheme/host/`//`/backslash/control characters, no encoded dot-segments or separators in the path, ≤300 chars; then the normalised path must still be under `/app` (so `/app/../account` and `/app/%2e%2e/account` are refused), never `/app/api`. Otherwise no Back link is shown. Callers: Curriculum landing and notes index (their own filtered URL), the result page (`/app/tests/<id>/result` with `los` and `result`).

## APIs

| Route | Command / read | Effects |
|---|---|---|
| `GET /api/curriculum/flashcards?scopeType&scopeId[&filter=all\|due\|later][&q][&limit≤100][&offset]` | paginated, **exact** counts (`matching`, `total`, `dueCount`) | read only; any failed read or count is 503 |
| `GET /api/curriculum/flashcards?due=1[&limit][&offset]` | due now across scopes (+ `total`, `totalCards`, `nextDueAt`) | read only |
| `POST /api/curriculum/flashcards` `{action: create\|update\|delete\|review, requestKey (8–100), …}` | `flashcard_apply` (migrations 20270112/20270113): validation, atomic quota (300 per scope, 3,000 per student), monotonic `revision` compare-and-set, request receipt | exact retry replays the original result; same key + different request → `KEY_REUSED` 409; stale revision → `STALE_CARD` 409 with the current card; **no** evidence, coverage, repair or paper credit is written |
| `POST /api/curriculum/flashcards` `{action:'draft'}` | outcome **prompts** (not cards, not generated) | writes nothing |
| `POST /api/curriculum/flashcards/draft` `{scopeType, scopeId, text 40–3000, label}` | optional note-to-card drafting; throttle `flashcard_draft_allow()` (10/hour, fixed in the function, migration 20270114) counted **before** the provider call; one request, 25 s stage deadline, cancelled with the browser request; output validated by `cardDraft.ts` (≤5 cards, short, grounded in the excerpt, no "approved" claims) | preview only; saving is an ordinary create with its own request key; missing/slow/failed provider changes nothing |
| `GET/POST /api/curriculum/notes` | unchanged: validated document, revision compare-and-set, 409 carries the current note | one document per (student, subject or reading) |
| `POST /api/curriculum/coverage` `{updates:[{readingId, state: not_started\|partly\|covered, topicId?} \| {lmId, state: not_started\|taught\|studied\|decaying}]}` (≤200) | explicit identities. `readingId` must be an **active canonical reading** (all ten subjects); `topicId`, when sent, must be that reading's subject (`WRONG_SUBJECT`). `lmId` (existing callers) must be an **active** learning module; a retired legacy module is `RETIRED_MODULE`, an unknown id `UNKNOWN_READING`. All-or-nothing: any invalid entry, duplicate or protected reading (verified or diagnostic-owned, `VERIFIED_COVERAGE_PROTECTED` 409) saves nothing | stored in `user_module_state` under the reading id (the id the tracker, roadmap, revision queue and completed-scope reads already use; readings are rows of `learning_modules` too), `self_report`: covered→`studied`, partly→`taught`. A report only: never evidence, never `verified`. A change moves `weekly_source_version`, so a pending unaccepted weekly draft is stale |
| `GET/POST /api/curriculum/marks`, `/overrides`, `/readiness` | unchanged | self-report only; never evidence |

Signed-in clients can no longer write `flashcards` directly (policy is select-only; insert/update/delete revoked); every card write is the command above.

## Connections

| From | To | Carries |
|---|---|---|
| Result page, missed outcome | `/app/curriculum/<subject>/<reading>?los=<outcome>&result=<attempt>&return=/app/tests/<attempt>/result` (and `&tab=notes` for "Write a note") | exact outcome, the student's own result, a Back to that result |
| Curriculum outline / notes index / cards list | reading page with `tab`, `return` = the filtered list URL | Back restores filter and search |
| Calendar, a revision (review) task | drawer link "Practise your recall cards for this reading" → `/app/curriculum/<subject>/<reading>?tab=cards&return=/app/calendar?view=agenda&week=<date>&task=<id>` | the task's own reading and the exact task to return to. Practising cards is the student's own report: it does not complete the task, confirm outcomes, add evidence or move anything. A student who wants a recall session uses the existing revision/review placement (preview, accept, sitting limit and capacity); there is no task per card. |
| Home | `DueCardsLine` | a read-only count of due cards, link to Cards; a failed count shows nothing, never "0 due" |
| Notes ↔ cards | Cards tab "Draft cards from my note…" reads the student's own note through the notes API | only the chosen excerpt is sent anywhere |

## Invalidation

Server pages are `force-dynamic` and re-read the canonical stores on each request; there is no new cache. Card and note writes refresh their own panel from the API after a confirmed change. Notes and cards never touch the evidence reducer, repair threads, revision rotation, coverage, planner tasks or weekly-paper credit; a rating is a recall report. A completed recall session would log recall activity only, and a repair still needs its authorised scored re-check.

## Not built / out of scope here

No top-level Materials tab, no uploads, no course text, no per-card Calendar tasks, no automatic plan changes from notes or ratings. A recall session in Calendar remains the existing optional revision block through the existing preview/accept path; this phase adds the due-card link and count only.

## Closeout additions (read layer)

- `getWorkspaceRows` pages every note and card read deterministically (500 per page, ordered) through `readAll`; any failed page throws, so a total is never truncated or zero. `getCardTotals` gives the exact all-scope counts that Home, the Cards page and the Curriculum summary all show.
- A failed revision read sets `revisionUnavailable`: the page shows a labelled notice and the Revision queued filter is not rendered as an empty list.
- Card review schedules are derived inside `flashcard_apply` (migration 20270115) from the locked card, the rating and the database clock; the request carries only the rating. The receipt fingerprint is (card, expected revision, rating).
- Note-to-card drafts carry a support passage copied from the student's excerpt; the server verifies it and checks numbers/units, negation, conditions, opposites and the question against the excerpt. These are heuristics: the UI shows each draft beside its passage, says so, and requires an explicit keep.
