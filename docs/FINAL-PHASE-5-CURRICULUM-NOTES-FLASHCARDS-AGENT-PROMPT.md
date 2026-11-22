# Phase 5 — a useful Curriculum, notes and recall workspace

You are building the next focused Roadmap phase. Complete this package end to end, preserving the established planner, assessment and recovery loops and the owner's unrelated dirty work. Do not start Phase 6 or redesign the rest of the app.

## Product and current context

Read `AGENTS.md` and its Ponytail instructions, current founder decisions, master status §§9.46–9.50, the final functional phases and `docs/CONTENT-AUTHORING-WITHOUT-PUBLISHER-DEPENDENCY.md`. Read installed Next.js documentation and relevant React guidance before framework/component changes.

Roadmap guides **how and when to study**. The owner defines Curriculum as the student's study/score tracker, personal notes and flashcard workspace. It is not a course reader, PDF library or tutor. Keep useful curriculum alignment and topic preparation actions, without chapter lessons. No top-level Materials tab, mandatory uploads, invented pass probability, fixed study-hour prescription or access refusal based on diagnostic inventory.

Phase 4 authoring/reviewer/assessment software works on synthetic fixtures. The real bank still has zero approved questions; private book-derived R32 packs remain unconfirmed. The owner closeout adds transactional re-check spacing in `20270111_recheck_start_date_guard`; preserve it and the earlier timezone/installation fixes. Ordinary note-taking, manual cards, planning and progress tracking must work with no usable bank and no model provider.

**Finish line:** a fresh, midway and revision-stage student can find a reading, understand recorded work versus tested understanding, open the exact next task/check/repair, write and recover notes, create/edit useful cards and review them reliably—on mobile and desktop, with changes reflected across the app.

## 1. Inspect and retain the working foundations

Trace existing code and callers before editing:

- `/app/curriculum`, `/app/curriculum/[subject]`, `/app/curriculum/[subject]/[reading]`, `/app/curriculum/flashcards`.
- `NoteEditor`, note document validator, notes API, per-user local draft recovery and revision/conflict handling.
- `FlashcardPanel`, `FlashcardReview`, `DueFlashcards`, scheduling helper and `/api/curriculum/flashcards`.
- Canonical catalogue/spine, activity/coverage services, evidence tracker, revision overview/queue, repair links and assessment decisions.
- Result, Calendar/task drawer, quick learning log, Home and Coach links that enter Curriculum.

Keep the existing safe note editor/save machinery, original note documents, validated rich text, evidence reducer, question runner and atomic task/assessment commands. Improve their call sites and presentation; do not create duplicate stores, competing progress engines or a second notes editor.

Record a concise current route → owner/read → command/write → invalidation map. A page render or a GET must not mark learning, create cards, generate model output or place tasks. Preserve verified-email/onboarding and owned-row boundaries; reviewer-only controls stay separate from student navigation.

## 2. Simplify the information hierarchy

Curriculum should answer three questions immediately: **where am I, what needs attention, where do I work next?**

Default landing:

- Compact search and subject/reading outline with filters for not covered, partly covered, covered, needs attention, revision queued and items with notes/cards. Labels must use canonical states, not a new score.
- Show a small summary and the student's most relevant current reading/task. Avoid rendering the entire outcome tracker, roadmap timeline, note editor and card manager at once.
- Separate reported coverage, logged activity, self-confidence and valid assessment evidence. “Covered” never means “understood.” Show sample size/freshness only where evidence supports it; no numeric readiness percentage from a tiny sample.
- Notes and Cards should be easy internal views/links, not new sidebar products. Preserve the existing readiness/roadmap URLs through compact navigation or intentional redirects, with saved filter/back context. A roadmap summary should open the existing roadmap/calendar rather than duplicate its planner.
- Detail expands on demand. Do not replace overwhelming cards with another wall of small metrics or jargon.

Subject page: searchable compact reading list; useful status/counts; notes/cards links; an exact return path. Reading page: title, concise current state and primary available action, then small Work / Notes / Cards sections. Outcome details and full history expand when needed. Avoid mounting every rich editor and every deck on initial navigation.

Loading, true empty, unsupported scope and failed read must have different states. Failed evidence or notes reads must never become an empty document or “no issues.” Unknown/mismatched reading or outcome links must show an honest unavailable state instead of silently opening a different reading.

## 3. Make the tracker actionable and consistent

Reuse canonical activity/evidence and the Tests assessment decision. Required connections:

| Action/context | Correct result |
| --- | --- |
| Log learning on a reading | Existing learning-log flow with exact reading/outcome context; explicit scope confirmation where needed; updates Home/Calendar/Curriculum/Tests consistently. |
| Mark reported coverage/self-confidence | Changes self-report only, with failed/stale save visible; never overwrites tested evidence, closes a repair or automatically reschedules accepted work. |
| Open current work | Exact task and its own day/cycle in Calendar, including continuation links and historical tasks. |
| Weak concept | Exact open repair or relevant result/history; a broad `/app/tests` link alone is insufficient when a selected object exists. |
| Take a check | Existing exact reading/outcome preflight; bank/scope/spacing prerequisites visible; unstartable states explained, no false ready button. |
| Enter from a result or Coach | Preserve selected reading/outcome/result and relevant filter, with an explicit return link. |
| Revision complete/underway | Use existing revision rotation, next queued work and confirmed evidence; no first-pass restart. |
| Corrected/voided/disputed evidence | Same canonical verdict/history as Results and Home, with uncertainty shown. |

Do not unilaterally change readiness bands, confidence thresholds, diagnostic weighting, repair closure or revision allocation. External mock concerns remain reported concerns; self-ratings and flashcard practice are not demonstrated understanding. No automatic plan mutation merely from opening a page, filtering, writing notes or rating a card.

## 4. Make personal notes easy to find and safe to use

Build a compact notes index/search from existing subject/reading notes, with scope, short preview and last saved time. Preserve the one-document-per-scope contract unless a concrete essential use case proves it inadequate. Do not add a general document platform.

- Direct entry from a reading, accepted task or result opens the right personal note; validated optional context may identify the reading/outcome/result/task. Do not rely on title matching.
- Add simple optional mistake/revisit structure: “What I missed”, “What I will check next”, personal reference. Reuse the rich editor and allow free notes; never force a template or auto-fill a concept diagnosis from a wrong answer alone.
- Search/return links restore useful scope and selection. Opening a search hit must not reset the document or scroll to a generic page.
- Preserve serial autosave, revision compare-and-set, exact acknowledged-document status, bounded retries, per-owner local drafts and conflict choices. Never show Saved for a newer unsaved edit. Keep both versions on conflicts.
- Complete failure handling for initial load, save refusal, transient/lost responses, offline/reload, leaving the page, oversized/malformed pasted documents and IME input. Unsaved text cannot silently disappear when changing views or signing out; draft recovery must never expose one account's text to another.
- Safe links, rich-text sanitisation, ownership and size/depth limits remain enforced on the server. Notes stay private and are not repurposed for global model training or shared bank content.

## 5. Fix existing flashcard defects before adding generation

Owner code review found these concrete risks to reproduce and fix:

1. `FlashcardReview` calls `useState(problem)` after returning for an empty queue. Finishing the last card changes the hook count. Move all hooks before conditional returns and prove the last-card/empty-deck path.
2. `DueFlashcards` converts failed loads into `[]`, and panel load/suggest/delete failures are incompletely shown. A failed read/save/delete is not “nothing due” or a successful deletion.
3. Rating retries use `expectedReps` as the compare-and-set token, but `Again` resets repetitions to zero. It is not a monotonic revision; a repeated request or competing Again rating can apply multiple times or be mistaken for a replay.
4. An Again card is immediately appended to the client queue even though the server schedules it ten minutes later. The UI must respect the actual returned due time, or clearly implement an explicitly approved different policy. Preserve the current ten-minute rule here.
5. Card edits have no equivalent note-style revision protection; concurrent edits can lose the student's text. Inspect quota checks and count-read failures as well.

Use a minimal monotonic card revision and existing request-receipt patterns where needed. Exact retry of a rating/create/edit must not duplicate a card or advance a schedule twice. A changed rating/body with the same request identity must conflict. A stale second-tab action should reveal the current state and preserve the local edit, not pretend a different rating was applied.

Keep Again/Hard/Good/Easy as personal recall signals. Show due/next due, scope and remaining count, one card at a time. A finished session must distinguish “nothing due now” from “all cards permanently mastered.” Refresh resumes from authoritative schedule; empty deck, future-only cards, lost response and deleted cards are normal recoverable states. No streaks or punitive language.

Paginate the deck/index and real counts; do not silently cap counts at the API's page limit. Keep quotas if useful but enforce them atomically, and fail count reads explicitly. Add safe card search/filter/edit/delete with confirmation and useful return focus. Card reviews must not write evidence, coverage, repair closure or weekly-paper credit.

## 6. Useful generation without a publisher dependency

Provide two clearly distinguished, explicit entry points:

- **Manual card:** always works, front/back editable, no model needed.
- **Draft cards from my selected note text:** optional, preview-only generation, limited batch, user edits/selects before saving. Keep exact note/version/scope context, source label and request limits. Inputs are the selected permitted text, not hidden book extracts.

Only offer a platform-authored card draft when an authorised first-party/licensed pack actually exists for that scope. Do not fill unavailable scope from model memory or the three unconfirmed R32 packs. Existing outcome-front suggestions must be honestly labelled as prompts, not completed cards or evidence of generation quality. Avoid bulk reproducing copyrighted outcome text or provider examples; use authorised metadata and original short wording.

The sourcing memo gives a path to original first-party content; it does not mark any existing pack cleared. Retain provenance/use checks and human diagnostic-item review. Student-saved cards are private practice and do not require the question-bank publication workflow, but they must not enter the shared bank automatically.

Generation must stay inside short recall Q/A. No teach-an-entire-chapter answers, expanded textbook reconstruction, plagiarism-by-number-change, fake citations or “CFA-approved” claims. Treat note text as untrusted data. Enforce structured output, length/count limits, cancellation, idempotency and per-user throttling through existing provider helpers. Do not send unrelated notes, scores or personal context.

A missing/slow/failed provider leaves manual notes/cards usable and preserves the selected text/draft. No automatic model call on page load and no real-provider benchmark in this phase. Prove generated workflows with controlled providers; clearly label that evidence. Saved cards should preserve the user's edited content, not regenerate it on retry.

## 7. Link recall practice to planning without calendar clutter

Home can show a compact due-card action/count and Calendar can open an existing optional recall/revision block for the selected scope. Do not create one Calendar task per card or move accepted work because a rating changed. A student explicitly choosing to add a recall session should use the existing preview/accept/placement path, sitting limit and real capacity.

Completing the session logs recall activity only. Diagnostic weakness threads still need their authorised scored re-check. Keep the result → personal mistake note → saved recall card → optional recall session → later diagnostic chain navigable, without claiming that making a card fixes a weakness.

## 8. Routes, access and cleanup

Reuse existing routes and APIs listed above; introduce only needed internal note-index/generation routes within the same ownership pattern. Document exact implemented query parameters for reading/outcome/note/card/result/task, validation, return context and invalidation. Update every caller and route audit. Preserve intentional old links through explicit compatible handling; no broken sidebar/breadcrumbs or renamed query parameters with stale callers.

Every mutation is server-validated and scoped to the authenticated application-access user. Do not trust a submitted owner ID, note source, result ID, scope or external URL. Cross-account, incomplete-onboarding and unverified access must fail without writes. Do not introduce server-role writes without explicit ownership validation.

Use additive migrations and immutable applied files. Read effective definitions before patching them. Keep a shared progress/read model; reduce duplicate reads before adding caching and prove invalidation if caching is introduced. Use installed components/dependencies; no editor rebuild or new design framework.

## 9. Acceptance: complete journeys, not a collection of screenshots

Use ordinary run-owned students and registered fixture banks; actual-bank unavailable cases remain separate. Drive UI at desktop and 390px. Browser plugin if available, otherwise installed Playwright with the reason recorded. Seed initial states if needed and label seeded versus driven steps.

Required student cases:

1. Fresh self-study, zero bank/provider: search a reading → existing task/log → reported partial coverage → own note → manual card → review last card → reload. No false understanding/test readiness.
2. Midway, three subjects reported covered and selected uncertain outcomes: filters expose relevant gaps → exact work/result link → quick log/confirmation → all pages agree. Notes/self-report do not promote evidence.
3. First pass/revision complete near a February exam, poor external mock: current revision/repair context stays visible, no beginner restart; external score remains self-report and notes/cards guide practice without closing repairs.
4. Scored fixture paper: selected result/outcome → Curriculum evidence/history → mistake note → permitted card draft preview/edit/save → due review → optional existing planning action → Calendar. Valid evidence/repair state remains unchanged by note/card actions.
5. Note conflict in two tabs, offline/lost save, reload/local recovery, owner switch, failed initial note read and IME composition. No lost or cross-account text.
6. Card create/edit/delete/rating retries, competing Again/different ratings, last-card/empty queue, ten-minute delay, stale edit, quota race, provider timeout/malformed output and zero provider. One confirmed operation means one durable change.
7. Long note/deck lists beyond 1,000 rows, search/filter/back context, failed later page, historical/disputed/voided evidence and unknown/foreign deep links.

Assert database effects and the cross-page read state, not merely toast text. No unexpected React hooks/hydration errors, horizontal overflow, inaccessible focus, silent errors or broad console allowances. Verify task/result/repair links retain the exact object and return context.

Run `npm run verify`, canonical TypeScript, focused note/card/coverage/evidence/difficulty/repair regressions and route audit. Add meaningful tests for the identified bugs and new trust/command logic. Run clean install, upgrade and restore rehearsals if schema changes. Run fixture-sensitive suites sequentially; never call a failed fixture paper unavailable and count it as success.

## Handoff and completion

Deliver one owner completion section with requirement → implementation → proof, an exact route/connection map, screenshots demonstrating the simpler hierarchy, and machine-readable evidence with commands/results, source fingerprint, migrations/checksums, actual versus fixture/provider-simulated capability, seeded versus UI steps and cleanup.

Stop only recorded owned processes, use the isolated Next wrapper, restore canonical types and remove only owned fixtures/users/locks/output. No commits, pushes, deployments, provider provisioning or real-content approvals. Preserve unrelated work and the existing shared server.

Complete the whole package and its failure paths before handing back. If an external content/provider decision remains, finish the provider-free/manual and simulated software paths and state that dependency precisely. No claim that generated cards establish mastery or that fixture diagnostics make the real bank ready.
