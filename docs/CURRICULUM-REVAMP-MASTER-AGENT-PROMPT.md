# Roadmap Curriculum and personal notebook — master implementation prompt

Prepared 7 November 2026 after a local browser, HTTP, source and competitor review.

You are implementing the Curriculum revamp for Roadmap, a B2C CFA Level I planning and accountability app for candidates sitting from 2027. Read AGENTS.md, the founder decisions, VISION-CONTEXT.md, the latest master status and the open [browser and reliability handoff](BROWSER-AND-RELIABILITY-CLOSEOUT-NEXT-AGENT-PROMPT.md). Use the installed Next.js documentation before changing routes or framework code.

The outcome is a Curriculum that helps a student find their place, choose a useful next activity, record their own observations and get back to their accepted week. A student should be able to answer four questions quickly. Where am I in the syllabus? What needs attention? Where is the work for it? Where are my own notes?

Implement this prompt in the ordered slices below, proving each slice through the normal UI and commands. Keep one coherent set of records and reuse current planning, scope, repair, log and assessment services. Preserve the shared worktree and applied migration checksums.

## 1. Product rules that govern the revamp

- Roadmap organises study and checks what students demonstrate. The Coach can explain planning choices, identify observed weak areas, point to the relevant reading or LOS, and propose time changes. Explanations of entire chapters and generated lesson content remain outside this build.
- Curriculum records syllabus context and the long-term direction. Calendar owns accepted work and commitments. Tests owns assessment eligibility, delivery and results. A note, a self-rating, a flashcard rating and a ticked reading cannot create scored understanding.
- Separate first-pass coverage, recorded activity, self-reported confidence and demonstrated understanding in both storage and language. Show the basis and sample where useful. Missing evidence and unavailable questions require honest wording.
- Self-study learning runs Monday–Saturday with the weekly assessment on Sunday. Confirmed classes drive coached students' cycles. A class or available window is planning context, and the student can start midway through preparation.
- A change to a note or coverage must never silently rearrange accepted work. Explicitly requested new study or repair work uses the existing preview, stale check, acceptance and receipt lifecycle. Tasks already linked to a repair should be reused.
- Keep the current access checks and private-beta controls. Materials upload and source management remain outside the student flow. Personal notes may contain students' own text and links without creating a new materials subsystem.

## 2. What was reviewed and what failed

The review used a dedicated local server at localhost:3157, ordinary disposable students, desktop at 1440 × 1000 and mobile at 390 × 844. Browser plugin skill was unavailable, so installed Playwright was used. App code was left unchanged during the audit.

### Verified findings

| ID | Priority and evidence | Finding and required response |
|---|---|---|
| N1 | P0, browser with an injected failed response and HTTP read-back | Type an older note, wait for autosave to start, type a newer draft while that request is pending, then fail the first save. The editor displays the newer draft and says Saved, while the server stores the older draft. In NoteEditor.save, the failure path restores the captured older document over pending.current. Serialise saves and tie acknowledgement to the exact document saved. Preserve newer pending content after a failure. |
| N2 | P0, browser | Two tabs create a correct stale-revision conflict, but the only visible recovery is Reload the latest version. Clicking it discards the local conflicting text. Preserve both documents and give a choice to use the server version, keep the local text as a separate note, or copy/merge it. A retry after a committed note save currently returns a 409 even when the returned server doc equals the retried doc. Reconcile this safely. |
| N3 | P1, browser | A permanent 400 note refusal triggered five requests in about seven seconds. The editor keeps retrying automatically, has no useful validation explanation and no explicit Retry control. Stop retrying permanent errors. Bound transient retries and give a visible recovery action. |
| N4 | P1, HTTP | A text node with marks supplied as an object instead of an array produces a blank 500. validateNoteDoc assumes marks is iterable. Validate the entire supported document shape and return a structured 400 for malformed input. |
| N5 | P1, source review | Navigation cleanup clears the pending autosave timer and there is no durable local draft. beforeunload only covers unsaved/saving, excluding error/conflict. A quick internal-navigation trial happened to save before the page changed, so loss on that specific path was not proven. Add controlled navigation tests and draft recovery for every unsaved state. |
| C1 | P1, browser | A first-pass-complete student has 102 readings in revision, but Roadmap shows 60% COVERED and 0 of 102 modules verified. The 60% derives from effort reduction rather than syllabus coverage. Expose separate truthful measures and remove the ambiguous coverage ring. First-week copy says the plan has not started even while the accepted week exists. Use baseline/calibration wording. |
| C2 | P1, source review and controlled HTTP fixture | getLosTracker loads repair threads only in open/proposed/scheduled states. A thread in in_progress or awaiting_recheck disappears from that lookup. With a synthetic thread and no raw evidence, the same outcome changed from Repair/sample 1 to Untested/sample 0 as the status changed. This fixture is a lifecycle test, not a genuine assessment. Include all relevant open states and never manufacture an observation count from thread existence. Prove behavior with real scored fixture evidence as well. |
| C3 | P1, scored fixture browser | Readiness prescribes 12–15 fresh questions, at least 90% and a next-day retest as Proof of mastery. Those fixed instructions come from BAND_METHOD and disagree with bank depth and the actual spaced repair policy. It also treats a sure-and-wrong answer as definitively a misconception rather than a possible explanation. Render the current policy, eligibility and due time, show observed facts separately from hypotheses, and keep practice suggestions distinct from the rule that closes a repair. |
| C4 | P1, browser and source | Reading 28 shows reading-level confidence plus four choices for each of five outcomes, manual-status controls, a full notebook and flashcards in one stream. Mobile reading height was about 2,900 px; Roadmap for the revision persona was about 4,693 px. Use progressive disclosure and task-focused sections. |
| C5 | P1, browser and source | Overview is a catalogue of long subject cards. It has no cross-curriculum search, return-to-reading shortcut or useful connection to the notes students already made. A subject's editor is below every reading card. Offer compact subject/reading navigation and a discoverable notebook. |
| C6 | P1, source and UI | Some Readiness actions lead to generic Tests without scoped eligibility. Revision's Calendar action is also generic. Resolve exact reading, task, repair or result objects through shared route builders, with a capability-aware next step. |
| C7 | P1, HTTP | Repeating the same flashcard Good review advanced reps from 1 to 2 and the interval from 1 to 3 days immediately. A lost response and retry can therefore count twice. Use an idempotent review command with version/concurrency checks. Ratings must continue to leave diagnostic evidence unchanged. |
| C8 | P1, source review | Notes and flashcard GETs, scopeExists and several curriculum spine reads ignore database errors and can present an empty state or 404. Failures must preserve existing content and offer a retry. A failed initial note load must never initialise a replacement blank document as though no note existed. |
| C9 | P1, source review | generateRoadmap supersedes the existing roadmap, inserts the replacement and then inserts milestones in separate requests. A later failure can leave no active roadmap or incomplete milestones while UI says Nothing changed. Trace all callers and make replacement atomic, stale-safe and retry-safe. This partial failure was not injected during the audit. |
| C10 | P2, current official-source check | The displayed 2027 weight ranges match CFA Institute. Portfolio Management still uses the older public name, and Ethics copy calls it the heaviest single topic despite its displayed range. Correct labels and editorial claims while preserving stable IDs and historical mappings. |
| C11 | P2, browser/source | The notes toolbar exposes 13 controls, including Code and Divider, and was 157 px high on mobile. There is no note search, titled-entry list, recovery/history, contextual capture, export or direct note-to-revision action. Reuse TipTap while rebuilding the surrounding experience. |
| C12 | P2, source review | Marks, overrides and flashcard actions have incomplete transport recovery. Override replacement retires the old row before inserting the next one in a separate request. DueFlashcards cannot distinguish a failed fetch from an empty queue and only loads 50 cards. Harden any retained controls and provide accurate queue totals and continuation. |

### What already passed

- Notes/flashcards HTTP suite ran against a disposable student and passed 39 checks, including safe-link rejection, revision conflicts, concurrent note writes, per-scope separation and basic ownership.
- Confidence HTTP suite passed 31 checks, including a real scored diagnostic against a temporary approved fixture bank, marks, display-only overrides and unchanged evidence when students change a mark.
- Curriculum spine HTTP suite passed 33 checks. All ten subject routes and all 102 reading routes rendered. Unknown subjects and reading/subject mismatches returned 404. The 102-reading structure is an app inventory check, not a claim that every summarized outcome exactly reproduces an official LOS.
- Note-document/flashcard logic passed 23 checks, confidence logic 29, and revision queue logic 56. LOS classification checks and project verification also passed.
- A separate ownership probe returned an empty own-note result for the other student and 404 for editing another student's flashcard. User-authored note/card actions produced no diagnostic evidence.
- Browser checked the three Curriculum views, an FSA subject and reading, notes creation and reload, conflict and failure cases, flashcard creation and the due-review entry, confidence persistence, a fresh candidate and a first-pass-complete candidate with a mock in one month. No horizontal overflow was observed on those mobile Curriculum views. The injected save failure accounts for the observed console 500.

The final-week browser journey, every keyboard control, an actual-bank full diagnostic, and realistic-history performance were not covered. Carry those gaps into acceptance. A saved note, valid graph, passing route or HTTP test alone does not establish that its full student journey works.

## 3. Competitor patterns to adapt

These are public product/documentation observations as of 7 November 2026. They are reference patterns, with implementations designed for Roadmap. Public pages do not establish that a competitor lacks an unadvertised feature.

| Reference | What is documented | Roadmap response |
|---|---|---|
| UWorld My Notebook | Searchable notes, tabs/tags, personal entries, QBank capture and mobile sync. | Make personal notes easy to capture, locate and reuse from a reading or scored finding. Store links to permitted assessment findings and the student's own words. |
| UWorld Dynamic Study Planner | A curriculum path, calendar assignments, study-time tracking and adjustments after missed work. | Show the exact accepted block next to the reading, then offer an explicit preview for a new revision need. Explain any capacity trade-off. |
| Kaplan Schweser | An activity feed and performance tracker that recommend remediation and adjust study plans. | Link each visible recommendation to the observed scope, current work and reason it matters now. |
| RemNote | Searchable linked notes and an exam-aware flashcard schedule with daily goals and final review. | Keep notes and recall cues connected to readings and the approaching exam, with a bounded review allowance inside real study capacity. |
| AnalystPrep | Curriculum-aligned practice and topic-level performance analytics. | Make topic detail actionable using Roadmap's coverage, evidence, repair and accepted-week records. |
| CFA Institute LES | Topic ordering, excluded study weeks, reading estimates and Calendar links in its published feature guide. | Make ordering and availability assumptions visible and editable through the existing setup/planning paths. |

Sources for the rows above, in order.

- [UWorld My Notebook](https://finance.uworld.com/cfa/digital-notes/)
- [UWorld CFA study planner](https://finance.uworld.com/cfa/study-planner/)
- [Kaplan Schweser Level I packages](https://www.schweser.com/cfa/level-1/study-packages?pid=876024)
- [RemNote note search](https://help.remnote.com/en/articles/6030721-searching-your-knowledge-base) and [exam preparation](https://help.remnote.com/en/articles/9101991-preparing-for-an-exam)
- [AnalystPrep Level I](https://analystprep.com/cfa-level-1/)
- [CFA Institute Canvas feature guide](https://www.cfainstitute.org/sites/default/files/docs/programs/cfa-program/candidate-resources/new-canvas-learning-ecosystem-features.pdf)

Use the [official 2027 topic outline](https://www.cfainstitute.org/sites/default/files/2027levelitopicoutline_online.pdf) and [Level I topic weights](https://www.cfainstitute.org/programs/cfa-program/candidate-resources/level-i-exam) to validate labels and mappings. Reading/page references from a particular Schweser volume are edition-specific metadata. Label them accordingly. Do not imply official endorsement or republish textbook passages as lessons.

## 4. The proposed student experience

### Curriculum landing

Keep Curriculum in primary navigation. Give it three clear destinations within the page — Subjects, My notes and My roadmap. Keep the existing Overview/Readiness/Roadmap URLs working with sensible aliases or redirects. Readiness becomes an attention/evidence filter within Subjects, with its existing deep links preserved.

The first screen contains the exam target with Change exam, one short current-phase line, a search field and a compact return-to-reading or work-next row when there is an actual candidate. Avoid a catalogue introduction before the useful action.

Search matches subject names, reading titles, outcome text and the student's own note titles/body. Results label their type and show subject/reading context. Make spelling variants and simple abbreviations useful through deterministic aliases. Search remains scoped to the signed-in student's notes. Keep the query/filter in the URL so Back and shared links are predictable.

Show ten compact subject rows or light cards. Each has a name, official exam-weight range, first-pass coverage expressed as readings or confirmed scope, and an evidence summary only where observations exist. A fresh user sees a helpful start state with no implication that untested equals weak. Expand a subject to see a short reading list or open the full subject route.

Filters should answer student needs — In my week, Need attention, Covered once, Not covered, My notes. Clearly label whether a filter is using reported coverage, observed evidence or current task state. Keep low-priority counts behind Details. Avoid four repeated confidence buttons on every visible row.

### Subject page

Keep /app/curriculum/[subject]. Lead with subject name, weight, relevant accepted work and the one next action. Use a compact searchable list of readings instead of large repeated summaries.

Each reading row shows title, coverage, current work/revision state, a short evidence signal where known and whether personal notes exist. The row opens the reading. A contextual menu or explicit action can log learning, open a linked Calendar task, flag a revision need or add a note.

Subject notes are accessible at the top through My notes for this subject. Reading notes appear in the same notebook filtered to that subject. Empty flashcard forms and a full editor should not sit after the entire subject list by default.

### Reading workspace

Keep /app/curriculum/[subject]/[reading]. Use a compact header, breadcrumb, current accepted action and tabs or accessible sections for Overview, Outcomes and My notes. Flashcards belong under My notes or a secondary Recall action.

Overview shows reported coverage, last recorded activity, observed understanding and the student's confidence as separate facts. Show why this reading is in the current plan and link to its exact task. If no task exists, offer a reviewable revision request. If information is missing, ask for the smallest relevant action.

Outcomes start collapsed or condensed. A row shows the outcome reference/title, evidence sample/freshness and any real repair/re-check state. Confidence is optional and appears when opened. Use action language such as Needs another check or Practice planned, with explanation available on demand. The full meaning of Repair/Verify/Maintain remains accessible.

Log work opens the existing quick log with the reading selected. The student chooses the actual outcomes covered and reported minutes. Notes can link to that activity after it exists. A note alone records writing.

The current manual evidence-status override controls add confusion to every outcome. Proposed UX change — replace their prominent position with a voluntary revision flag or confidence report. Preserve legacy override records and their read visibility in an advanced history view. Reuse uncertainty/marks where they express the required meaning. Do not silently reclassify past evidence or discard a supported API before checking all callers.

### My notes

Add an in-Curriculum notebook at /app/curriculum/notes. It is searchable across the student's subjects, with Recent, Mistakes and Pinned as useful filters. A student can create more than one titled entry for a reading. New notes default to the current reading and need no extra classification to save.

Use a small set of optional note kinds — Note, Mistake, Formula/recall cue and Question for class. These are organisational labels. Support optional outcome links and a scored-result/repair link when the note was captured there.

Opening a note gives a focused editor with its subject/reading visible. Desktop may use a list and editor together; mobile uses a focused document and an obvious return action. The core toolbar contains undo/redo, basic emphasis and a simple list. Put headings, tables and other formatting behind More. Keep the installed TipTap engine unless the audit shows it cannot support the requirements.

Start with an empty paragraph and optional templates chosen by the student. Preserve existing rich-text documents, tables and links. Provide a clear saving indicator and last confirmed save time. Draft/recovery state must be truthful for the currently visible content.

Add archive, restore and export for the student's own notes. A modest searchable title/body index is enough. Full-text database search is preferable to downloading all documents to the browser. Make table content readable on a phone without horizontal page overflow.

### My roadmap

Retain the roadmap route and underlying planner. Show current phase, next milestone and upcoming mock/final-review boundaries in a compact timeline. The current week links to Calendar. Future work is a forecast until accepted.

Replace ambiguous metrics with explicit facts. For example, First pass reported complete, 8 readings still partly covered, 5 readings in this week's revision, or 12 of 343 outcomes have recent evidence. Keep estimated remaining effort labelled as an estimate. Do not use an effort discount as a percentage of syllabus completion or a pass probability.

Coverage changes have a receipt that explains their actual effect and an easy path back. Rebuilding from current context shows a proposed roadmap delta and accepts it atomically. Exam edits reuse the shared onboarding exam editor and safe return. A later milestone adjustment must preserve accepted weekly tasks and their history.

## 5. Useful product additions built around Roadmap's purpose

Treat these as a coherent product hypothesis to validate with beta users, rather than a claim of worldwide uniqueness.

**A mistake that follows through to action.** From a scored finding, Add a mistake note creates a student-authored entry linked to that reading/outcome and result. The prompt can ask what they thought, what they want to check and which activity they will use next. It supplies no invented explanation. The note shows the linked repair task and due fresh check, and a later valid result can show whether that particular finding still needs work. Editing or archiving the note never closes the repair.

**A briefing for the next sitting.** Open a Calendar task and see a small My study brief link with the student's pinned note, relevant past mistake entries, the task objective, activity and completion check. Keep it behind an action so it does not clutter the grid. Notes should be inaccessible during a closed-book diagnostic according to the existing assessment policy.

**A plan preview for I am still unsure.** A reading-level flag can propose focused revision within the accepted cycle's remaining capacity, or offer it in weekly review. Show the existing overlapping task first. If the week is full, explain what would need to move or let the student keep the need for later. Deduplicate by reading/outcome/repair identity, never a generated title.

**A mock-week and final-review brief.** Assemble links to the student's relevant mistake notes and original recall cues, open repairs, last checked date and untested scope. It is a compact personal index, not an AI textbook summary. Show what is due, what is waiting on the bank and the time trade-off. Keep preparation and debrief inside their real week.

**A why-next explanation.** For each proposed reading, name the actual reason — class coverage, unfinished work, reported uncertainty, valid misses, an upcoming mock or scheduled maintenance. When several reasons overlap, merge the activity or explain the separate purposes. A missed study block is evidence of execution, not evidence of misunderstanding.

**Recall practice within real capacity.** Retain user-authored flashcards as optional personal recall practice. Connect a bounded card-review session to a Calendar activity when the student requests it. Card scheduling can respond to exam proximity and planned breaks, with assumptions visible. A card rating remains self-report and cannot satisfy a diagnostic or close a repair. Do not silently add a second full workload outside the week's study plan.

## 6. Routes, commands and ownership

Use the route registry and existing calendar/repair helpers. The paths below are the proposed contract. Check conflicts with dynamic subject/reading routes, and keep compatibility during migration.

| Surface or action | Route/command | Authoritative record and cross-product effect |
|---|---|---|
| Subjects and attention filters | /app/curriculum with q, subject, filter and band as needed | Server-owned read model joining canonical curriculum and owned state. No writes on GET. Preserve view=readiness and band links. |
| Subject and reading | Existing subject/reading routes, optional panel/outcome parameters | Reference scope plus owned learning, evidence, notes and exact work links. |
| Notebook list | /app/curriculum/notes with search/scope/type filters | Owned note metadata and paginated excerpts. |
| Note editor | /app/curriculum/notes/[noteId] | Owned entry content and revision. Direct deep links from a task or result. |
| Note list/create | Extend /api/curriculum/notes using an explicit list/create shape | Shared note service. Preserve the current scope-based GET/POST until existing clients are migrated. |
| Entry read/edit/archive/restore | /api/curriculum/notes/[noteId] and an explicit restore action if needed | Versioned owned content, retry identity and archive state. Never evidence. |
| Note export/history | Entry actions backed by the same owned service | Export student-authored content. Restore creates a new revision. |
| Coverage | Existing POST /api/curriculum/coverage | Validated self-report, protected diagnostic provenance, stale planning inputs. Keep batch atomicity. |
| Confidence/revision need | Existing marks and uncertainty/planning commands where sufficient | Separate self-report and proposed activity. Do not create an evidence-band override. |
| Learning log | Existing LogLearningButton, /app/log and /api/log-learning | One completed sitting, explicit outcome scope and reported time. Tests reads the eligible confirmed scope. |
| Class coverage | /app/calendar/log-class with the reading selected and existing class commands | Class occurrence and covered scope, with cycle implications handled by class planning. |
| Open accepted work | calendarTaskHref(taskId, localDate) | Exact owned task and week; continuation history preserved. |
| Revision or repair request | Existing preview/accept proposal commands | Accepted Calendar changes only after review, using stale checks, lock order and replay receipts. |
| Scoped check | Existing assessment decision/preflight/start paths | Fresh approved questions for the intended confirmed scope. Show expected size, time and unavailable coverage. |
| Result → note/repair | Existing result route with an owned result/item/finding reference | Store the relationship and the student's words. Keep answer keys hidden where assessment policy requires it. |
| Coach from reading or note | Existing Coach route with validated reading/repair/note context | Server resolves the owned context and legal actions. Free text alone must not be the scope contract. |
| Roadmap preview/accept | Existing roadmap service, refactored into atomic persistence | New roadmap and milestones plus one receipt. The accepted week is preserved. |
| Exam edit | onboardingHref('exam', safeReturn) | Existing atomic setup command and source-version invalidation. |
| Flashcards | Existing scoped/due routes and review command | Owned cards and recall history with idempotent ratings. Labels separate from test evidence. |

Do not create a generic task-write backdoor for notes or the Coach. Every student command retains verified-email, setup, invitation and ownership checks. A foreign note, result, task or thread must reveal no private context.

## 7. Backend design and data migration

### Curriculum state

Create or adapt one request-scoped Curriculum read service with clear per-surface projections. Resolve the active curriculum version, canonical subject/reading IDs, activity, reported coverage, confidence, evidence and linked work once per request. Avoid running full-syllabus joins again for every reading component. Cache public reference data only with a curriculum-version key. Keep mutable student state request-scoped.

Reuse the evidence reducer and repair state definitions. Audit outcome-to-concept aggregation so evidence about one concept does not falsely certify all linked concepts. Deduplicate shared events by stable ID, retain validity and challenge handling, and show genuine observation counts. Include open, proposed, scheduled, in_progress and awaiting_recheck wherever those states represent an unresolved obligation. Derive the next action from both thread state and check eligibility.

Unify guidance with the actual assessment/repair policy. No unversioned mastery percentages or fixed question counts in a display component. If a practice target exceeds available fresh questions, label it as a suggested external practice activity or give a smaller honest supported action. A follow-up check uses its real spacing rule.

Paginate records that can grow with student history. Return a section failure with retry when a data source is unavailable. Do not convert failures into no notes, no evidence, unknown scope or zero progress. Preserve stale drafts for review and invalidate them when relevant coverage, exam or class context changes.

### Notes

The current curriculum_notes primary key is user_id/scope_type/scope_id. Additive migration must preserve every existing document and revision as a discoverable legacy/default entry. Keep the old scope-based contract through a shared adapter while the UI transitions. Design note-entry identity, content, optional title/type/links, archive state and search metadata around the existing model; avoid maintaining duplicate editable copies.

Maintain an allowlisted TipTap schema, byte/depth/collection limits and safe links. Validate node arrays, marks, attributes and hierarchy before rendering/saving. Retain existing document features and migration compatibility. Validate referenced reading/outcome/result/repair ownership and curriculum membership on the server.

Use optimistic concurrency and a retry identity for note writes. Recognise a replayed successful save. A lost response must not be treated as proof that the save failed. Keep a compact revision history or safe recoverable prior snapshots. Restore writes a new revision and retains the audit trail.

Use a serial editor save queue. Capture each draft's identity and associated scope. A save failure cannot replace a newer pending draft. Update Saved only when the displayed document matches the acknowledged committed revision. On conflict preserve local and server versions and offer a clear merge/copy/reload choice.

Persist unsent drafts locally with a user-and-note key and a timestamp/version. Recover explicitly after refresh, app navigation or a failed session. Clear or segregate drafts on account changes and sign-out. Do not expose one student's local draft to another. Use save state to protect navigation; beforeunload alone is insufficient for internal routes.

Bound retries, stop on validation/access conflicts, and expose Save/Retry and a useful error message. Test typing during IME composition. Avoid leaving timers and saves running after an editor switches scope.

### Roadmap and optional cards

Make roadmap replacement a single transaction that creates the complete replacement and retires the prior roadmap only when the replacement is ready. Include idempotency, stale input checks and complete rollback if milestones fail. Prove access and lock order with current weekly commands.

Retained flashcard create/review operations need replay safety, clear pending state and useful failure recovery. A due queue has an accurate total and can continue beyond its first page. Keep note/card imports, automatic teaching answers and content licensing expansion outside this migration.

## 8. Ordered implementation slices

| Slice | Deliverable | Exit condition |
|---|---|---|
| C0 — safety and semantics | Fix N1–N4 and error-as-empty paths; establish truthful coverage/evidence measures, repair-state handling and shared policy wording. | Failure while typing never saves older content as current; malformed docs return 400; conflicts preserve both drafts; first-pass-complete copy is consistent; lifecycle states agree with Tests/Coach. |
| C1 — lighter navigation | Searchable compact subjects, reading workspace and exact existing action links; legacy URL support. | Fresh, midway and revision users can find a reading, log work and open accepted work with sensible Back/filter behavior at desktop and mobile. |
| C2 — usable notebook | Entry migration, focused editor, search, local recovery, archive/export and revision recovery. | Legacy content survives; notes can be found across subjects; lost responses and two-tab conflicts recover without silent loss; account isolation is proven. |
| C3 — joined study loop | Mistake-note capture, study briefs, voluntary revision requests, context-aware checks and bounded recall practice. | A scored miss opens the same note and repair from reading, result and Calendar; no duplicate tasks or fabricated evidence; full-week/no-bank paths remain usable. |
| C4 — later preparation and closeout | Mock/final-review briefs, atomic roadmap persistence, performance and whole-journey QA. | Mock in one month, completed first pass, final week and post-exam states work through real routes with an explicit record of remaining constraints. |

Build C0 before migrating the notebook or adding more controls. Preserve currently passing learning-log and evidence-protection behavior. The open answer-ordering and fixture-validation work from the reliability prompt remains a dependency for claims about scored journeys; carry it forward where tests depend on it.

## 9. Required acceptance journeys

Run each relevant journey through the normal UI and commands using ordinary students. Use actual-bank and isolated fixture-bank tracks with the intended items/families asserted on reserved forms. Use Browser when available, otherwise the installed Playwright path with the reason recorded.

1. Fresh candidate finds a reading by search, logs a completed sitting with selected outcomes, adds a personal note, refreshes, sees reported activity and an honest test capability. No note or flashcard changes understanding.
2. Midway candidate with three covered subjects and uneven confidence sees the remaining work and a small targeted revision request, without being pushed through diagnostics for every chapter. Duplicate flags reuse their existing obligation.
3. First-pass-complete candidate with a mock in one month sees a consistent coverage statement, revision activity, prep/debrief and a useful personal note index. The same appointment is addressed from every page.
4. A scored diagnostic miss leads to a student-authored mistake entry, existing or accepted repair task, finished repair and an eligible fresh check. Readiness, Coach, Curriculum and Calendar agree while the thread moves through all live states. Challenge invalidation updates findings while retaining the student's original writing with an accurate context label.
5. Notes survive normal typing, rapid internal navigation, refresh, browser back, offline/save failure, access expiry, a lost response after commit, concurrent tabs, an old delayed response and an account switch. Verify visible content against the stored document after every fault.
6. Malformed or oversized documents fail safely; pasted content stays within the schema; unsafe links remain refused. Keyboard users can search, select tabs, write, open More, recover conflicts and return focus. Tables, toolbar, modal and virtual keyboard remain usable at 390 px.
7. Subject/reading mismatches, inactive references, foreign note IDs and foreign result/repair links fail safely. Broken loaders show an error rather than inviting a blank replacement.
8. A full week or unavailable question scope offers a practical plan/review choice. An uncertain mark without enough evidence remains self-report. Confirmed tests cover only the supported learned scope and retain mandatory confidence and the 90-question ceiling.
9. Near a mock, during the final week and after the exam, the reading and notebook show relevant work/history. Note edits never extend study beyond the exam horizon or alter the accepted week automatically.
10. Rebuild a roadmap, fail the milestone write, retry it and edit the inputs concurrently. Exactly one complete accepted result is visible; no partial replacement or incorrect success receipt remains.

Run notes, confidence, LOS, revision, coverage protection and scoped assessment tests; project verification; TypeScript; migration/upgrade rehearsals if schema changes; and route/deep-link checks. Measure an empty, typical-history and large-notebook profile with bounded database reads and payloads. Report latency as observed, identify failed stages and avoid claiming performance improvements from incomparable fixtures.

Return a compact report with implemented routes, user-visible changes, test evidence and known limits. Record decisions that changed a visible behavior, especially the evidence-override placement and the new notebook structure. The final result should feel smaller to use while making the planning and evidence loop more useful.
