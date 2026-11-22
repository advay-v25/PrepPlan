# Roadmap — final functional Settings acceptance

## Assignment

Finish the existing Settings slice with a bounded correctness pass. Do not redesign Settings, rebuild exports, or begin another lifecycle feature. Read master status §9.35 and the two preceding Settings prompts, then inspect the current files before editing. The owner's workflow is implementation followed by a reviewable handoff; complete this assignment without stopping at another proposed plan.

Preserve the delivered session-authentication checks, per-device sign-out, mobile layout, atomic preference patches, `/account` outside the study gate, export pagination, privacy-safe calendar titles, and original class-occurrence identities. The reviewer independently ran 44 pure checks: account controls 11, ICS 15 and reminders 18. These passed; no new live database or browser verification was performed in that review.

Follow `AGENTS.md` and Ponytail. Read the installed Next.js documentation before framework edits. Preserve unrelated dirty work. Journey B/B2 belongs to another worker: coordinate shared readers and command signatures, and do not apply another worker's pending migrations blindly. No commits, deployment, provider provisioning, real email, or changes to assessment approval, scoring, repair closure or study-cycle policies.

## 1. Reproduce and close these source findings

These are findings from current source, not claims that all have been reproduced through live endpoints. Add a failing, focused assertion for each before fixing it. Reuse existing services and test seams.

### A. Deletion must report external cleanup truthfully

Files: `src/app/api/account/delete/route.ts`, `src/lib/account/storageCleanup.ts`, account dialog and account tests.

Storage cleanup happens before `deleteUser`. If cleanup succeeds and Auth deletion fails, the response still says “nothing was removed.” The account transaction can roll back; removed Storage files cannot. Test the **combined** sequence with an owned file and a forced Auth/cascade failure, rather than testing storage success and Auth failure separately.

Return a truthful phase-aware result: account remains, any files already removed remain removed, and Retry safely continues. Do not claim an all-or-nothing transaction across Storage and Auth. Keep a successful account deletion successful if writing its audit fails. Supabase operations return `{ error }`; `try/catch` alone does not observe a returned audit error. Check and log both failed- and successful-deletion audit failures without masking the authoritative deletion outcome or exposing secrets.

The cleanup currently lists only the first level beneath `<userId>/`, filters out folders and stops when that page has no files. It can leave nested owned files or miss later pages. Honor the declared prefix ownership boundary, walk nested paths and pagination safely, and remove through the Storage API. Prove a page containing folders, more than one page, nested files, partial provider failure and retry, and preservation of another student's objects. Do not add uploads or infer ownership from arbitrary filenames. If the application supports only a restricted storage convention, enforce and document that exact convention instead of claiming arbitrary owned-object cleanup.

Browser-prove a post-commit lost deletion response and the combined failure above on disposable accounts. Preserve confirmation, pending-state protection, reauthentication return to `/account`, and recovery that does not silently create a replacement Google account. Reuse the existing real aged-session and two-session endpoint evidence; another eleven-minute wait is unnecessary unless the authentication code changes.

### B. Enforce setup versioning on the server and preserve committed success

Files: `/api/onboarding/[step]`, onboarding service and impact wrapper, checked command, editor callers.

Currently an omitted or malformed `expectedVersion` becomes `null` and completed-user edits fall through to the unchecked command. Require a valid expected version for completed-user planning edits at the authoritative boundary, including internal callers that could bypass the route. Refuse missing, malformed and stale values without changing any field. Preserve first-time onboarding and cosmetic name edits; the former is not an access verdict and the latter must not stale study proposals.

Inspect effective SQL definitions, not only the original migration. `onboarding_commit_step_checked` takes the profile row lock before calling the inner command, while the current inner command is patched to take `scope_lock` before row locks. Align the lock order with other planning writers. Prove two-connection checked-edit versus ordinary planning-write races with deadlines; no deadlock, dropped update or partially committed command is acceptable.

After the save, the route still calls `readCanonicalState` outside the committed-success recovery path. A failure there can return a generic failed-save response after data committed. Fault-inject that exact point, as well as the impact read. Return the authoritative committed version/receipt and “saved, follow-up unavailable,” with a safe reload action. A lost response must resolve as committed, stale or still unknown without applying side effects twice or encouraging blind overwrite. Use the smallest existing operation-key or exact version/payload reconciliation mechanism.

The impact wrapper reads before and after a write without binding those reads to its version. A third edit must not be described as the impact of the earlier save. Detect intervening revisions and mark the impact unavailable/stale, or obtain a genuinely bound comparison. Inspect returned query errors: unreadable planning counts or scheduled minutes are not an authoritative empty plan or zero load.

Trace all `/api/profile` consumers. Prefer a name-only write contract with canonical onboarding editors for planning fields. If the legacy planning branch is unused outside tests, remove it and update those tests; reject retired fields explicitly rather than silently ignoring them. If a real necessary caller remains, move it to the canonical atomic, versioned command. Do not retain the separate profile/exam writes as a “finished” solution. Remove misleading legacy planning values from the read response only after checking consumers.

### C. Classes-finished and undo must compose with other edits

`set_classes_finished` changes class series and `classes_completed_at`, but its current call to `update_planning_profile` does not increment the setup version. An editor opened before that change can retain the same version. Ensure material class-transition changes participate in the existing setup freshness boundary. Do not introduce a parallel version counter or increment it for no-op/cosmetic changes.

Undo currently restores remembered `ends_on` unconditionally for marked series. Test a student explicitly editing a series after classes-finished, then pressing Undo. Preserve that newer decision or refuse with a clear review action; never silently overwrite it. Also cover repeated finish/undo, a newly added series, archived series, concurrent route edits and an undo that would restore a class over a booked mock. Refusals must be atomic and actionable. Preserve logs, completed work, current accepted-cycle history and existing cancellation semantics. Classes finished does not mean syllabus mastery.

### D. Separate sending from recording delivery

Files: `src/lib/reminders/service.ts`, transport, claim command, preference UI and run route.

After `transport.send` succeeds, a failed `set({status:'sent'})` falls into the same catch that makes known send failures retryable. The outer catch can also put the job back into `pending`. This can resend a message whose provider already accepted it. Separate transport outcome from persistence outcome. Preserve provider idempotency, but do not claim it makes every uncertain delivery exactly once. Use the smallest durable claim/state transition that prevents automatic resend after a potentially accepted delivery; surface uncertainty and recovery honestly, including a worker crash at that boundary.

Test provider success followed by failed state persistence, timeout after provider acceptance, lease expiry while a send is paused, reclaim by another worker, and an old worker returning late. A stale claim must not overwrite a newer claim or turn a delivered/uncertain job into an ordinary retry. Check claim validity at the dispatch boundary. State any unavoidable external send/opt-out race honestly; do not promise a sent email can be recalled.

`savePrefs` ignores `syncReminders(...).unknown` and can report `sync:'ok'` when material source state was unreadable. Propagate pending/unknown to the UI. Check errors from timezone reads, job reads, cancellation and revival writes; do not manufacture a successful sync. Preserve the saved preference if follow-up fails, and distinguish a database problem from missing mail configuration.

Exercise the actual service through scoped dependency injection, an internal test seam or an isolated test process. Public production failure flags are unnecessary and prohibited. Add executable failures at post-save reload, source read, opt-out cancellation and post-send recording. No fake sends or global claims against other students' jobs, and no real email.

### E. Calendar export must deduplicate by identity

`buildCalendarExport` creates `apptDates` and omits every mock-layer task on any booked appointment date. Sharing a date does not prove two records represent one mock. Deduplicate through an explicit existing task/appointment relationship. If no relationship exists, preserve distinct events; do not invent one from title or date.

Prove two appointments on one date, a linked task/appointment exported once, and an unrelated mock task on that same date exported separately. Retain exact instants, stable UIDs, class/history options, strict reads and independent parser checks. Preview counts must agree with parsed events. No feeds or two-way synchronization.

## 2. Prove settings effects in the actual product

Finish the prior assignment's field-level matrix. A successful render or a shared reader returning an object is not enough. Use ordinary students and compare persisted values, relevant displayed values, proposal freshness and untouched history. Reuse the existing fixtures; distinguish the actual empty question bank from synthetic paper availability.

| Change | Required cross-product proof |
| --- | --- |
| Name | Settings and displayed identity agree after refresh; no planning-version change or proposal invalidation. |
| Tentative target → booked date; date moved | Home target, Curriculum/roadmap horizon, Calendar and Coach agree; affected drafts/proposals refuse as stale; reserved forms and scores remain unchanged. |
| Availability/sitting limit | New preview uses the changed boundary. Accepted work remains visible. If it conflicts, Settings leads to a real Calendar review/proposal action; preview, accept and verify the corrected placement without rewriting history. |
| Reported coverage and uncertainty | Midway/first-pass-complete planning uses the changed context; Curriculum, Tests scope and Coach agree. Self-report does not create demonstrated evidence, close repairs or force a fresh-start plan. |
| Route, classes finished and undo | Prospective occurrences, next-cycle anchor and paper timing agree with Calendar and export; the accepted current cycle and historical logs retain their meaning. |

For stale proposal checks, use the actual relevant command, not only a changed hash assertion. Show a refused old proposal followed by a successful re-prepared proposal. Keep self-study Monday–Saturday with Sunday tests and existing class-led cycle rules. Do not invent a new schedule policy during this closeout.

Finish targeted keyboard/focus/error-announcement checks on edited controls. Include IME composition so Enter does not accidentally save/delete during composition. Preserve back navigation, typed input and truthful saved/unsaved feedback after errors.

## 3. Verification and migration acceptance

Use focused tests first, then final project verification. Existing passing suites do not substitute for the new failure assertions.

1. Run targeted pure, database and HTTP tests for sections A–E; include concurrency and forced failure after a committed write or accepted send.
2. Extend the existing Settings browser suite at desktop and 390px for the changed controls, two-tab version refusal, material effect/review path, class undo conflict, parsed export and deletion recovery. Exercise actual interactions and reloaded state, not headings alone.
3. Rehearse a clean install and an upgrade from the pre-20261219 baseline through 20261219–22 and any new migrations, then the repository's restore/baseline checks. The previous handoff explicitly omitted these. Use existing isolated helpers; do not treat their absence for a specific migration as permission to skip the upgrade path. Verify effective functions, lock order, ACL/RLS, rollback and ledger/checksum agreement. Never edit a previously applied migration to conceal a fix.
4. Run `npm run verify`, TypeScript and affected regression suites on the final tree. Separate unavailable-bank outcomes, skipped checks and failures from passes. Do not run shared-account mutation suites simultaneously.
5. Record exact fixture/account/storage IDs immediately, clean only owned test data, stop only the recorded server handle and restore generated types with the existing wrapper. Do not kill processes by port matching.

No domain, OAuth or mail-provider provisioning is requested. Exercise local reauth/reset return logic where possible and list genuinely unavailable external-provider checks separately. Retention durations and legal approval remain owner decisions; keep unapproved copy labelled draft and technical statements factual.

## Handoff

Update the next master-status section and provide one concise report: defects reproduced/fixed, files and additive migrations, field-level effect matrix, named failure/race/browser proofs, final verification and cleanup. List any unresolved issue with its concrete consequence and reproduction. Do not describe Settings as complete while a required functional path in this assignment remains untested or broken. Keep lifecycle B/C and genuine question-bank activation as separate workstreams.
