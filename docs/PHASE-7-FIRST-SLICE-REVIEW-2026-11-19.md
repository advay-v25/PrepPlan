# Phase 7 first-slice review — 19 November 2026

**Verdict: keep the delivered work, but Phase 7 remains partial.** The source matches the reported `04fff4332dbd2a91` snapshot: 860 files, no differences. Both migration files match the reported SHA-256 checksums. This review read source, migrations and evidence; it did not rerun the application, database suites or browser journeys. The handoff's green results remain attributed to the builder.

## Fix before the wider journeys

1. **Manual creation does not yet have a durable request receipt.** `20270116_manual_task_command.sql:22` compares the request with the current mutable task. The comparison omits detail and priority. A same-key request with changed detail/priority can be called a replay; a legitimate original retry after a task edit can instead become `KEY_REUSED`. `createManualTask` also checks today's date and current occupancy before it reaches replay. Retry after midnight, rollover or a subsequent booking is therefore not established by the simple immediate-retry proof. Preserve the original canonical payload/result independently of the current task.
2. **Some uncertain saves are described as definite rollback.** `src/app/api/tasks/route.ts` catches all command/transport failures and says “Nothing was added”. A lost database response after commit cannot justify that claim. The same pattern deserves a targeted check in class confirmation. Test loss between database commit and the route, not only between the route and browser.
3. **Class succession is guessed from names and adjacent dates.** `classlog/service.ts:110–120` treats another series with the same label and preceding end date as its predecessor. Independent classes can satisfy those conditions. The existing class-change receipt already records `commitmentId` and `successorId`; use explicit lineage. Include an unrelated same-name negative control.
4. **The class command does not establish that the named occurrence matches the reported class date.** The new SQL block validates key shape and commitment ownership, but not recurrence membership, exception-resolved date, cancellation or commitment status. TypeScript checks a context snapshot before the command. Establish the same decision under the command lock, including direct-call and edit-versus-confirm tests. Preserve valid receipt replay after later timetable changes.
5. **A test cleanup deletes accounts outside its current run.** `scripts/task-create-db-test.cjs:39–40` loads every `tm-%@example.invalid` user into its deletion list. This violates exact-owned-ID cleanup. Remove that sweep before running the script again. Do not delete old accounts as part of this review.

## Close alongside those fixes

- Investigate Journey B's pending-date assumption rather than calling the failure date-dependent without proof. New occurrence identity means two classes do not necessarily mean two dates. Its helper still begins from `pendingDates`, and the spec uses UTC `today`.
- Diagnose the hydration warning with the actual mismatch and strict console capture. Two isolated passes do not explain it.
- Carry class identity and useful labels through obligations, review, continuations, Calendar, Curriculum and Coach. Prove restore conflicts and rollover without changing history.
- Check the no-active-cycle path in manual creation: the SQL permits `cycle_id = NULL`, and the service has no explicit refusal there. Implement the existing product rule, not an orphan task that cannot participate in review.
- Check recurring versus one-off class-time handling: recurring context uses dates through today while one-offs require `ends_at <= now`. This is an inconsistency to resolve against the established logging policy, not permission to introduce an unexplained attendance gate.

An association UI for old date-only logs is **not automatically mandatory**. Safe unresolved history is acceptable if the student can understand and resolve a genuine ambiguity without losing history or duplicating learning. Never infer an association or fabricate one to satisfy a test.

## Remaining Phase 7 scope

Complete B → A → C, the risk-based deviation matrix, first-pass-to-revision and final-eight-weeks fixtures, cleanup/link audit, ordinary/long-history measurement and a fresh actual-bank report. Keep real-content readiness separate from synthetic software proof. Do not restart completed Phase 6 packages.

Continuation: `docs/FINAL-PHASE-7-COMPLETION-AGENT-PROMPT.md`. No application code, migration or account was changed in this review.
