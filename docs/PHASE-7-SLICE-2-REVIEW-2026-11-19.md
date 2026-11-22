# Phase 7 slice 2 review — 19 November 2026

**Keep the delivered changes. Phase 7 remains partial.** The current source matches the reported `12078dc2ca489bee` snapshot (864 files, no changes). Both new migration files match the reported checksums. I did not rerun the builder's database or browser suites, so their passing counts remain attributed to the handoff.

## Independently reproduced regression

Read-only command: `npx tsx scripts/account-export-schema-test.ts`.

Result: **exit 1; 2 passed, 2 failed**. The deployed `task_create_receipts` table is missing from `OWNED_TABLES`. Both complete-owned-table coverage and the account-reference coverage assertion fail. Its actual primary key in migration 20270118 is `key`; it also has an account ownership column and an Auth cascade. Add it to the canonical export, then prove ownership/paging/deletion behaviour. A green offline `npm run verify` does not cover this connected schema check.

## Remaining source findings

1. **Creation UI does not finish the receipt contract.** `NewTaskDialog` closes on every `data.ok`, ignoring `replayed` and `current`. The command correctly retains the original result after cancellation/deletion, but the student gets no explanation when replay creates nothing and the task is no longer active. Its fields and Cancel also remain usable while a save is pending; an older successful response can discard a newer draft. Drive the HTTP and browser paths before declaring this closed.
2. **Class confirmation still overstates uncertain outcomes.** The generic error in `classlog/service.ts` says “Nothing was changed” for any RPC error. A response lost after database commit cannot prove that. Distinguish definite command refusal from transport uncertainty, then retry the same identity/key rather than creating a new manual session.
3. **Journey B's new fixture is still date-dependent.** It wants two distinct pending dates and adds a one-off when there are fewer. If neither date exists, or the extra class falls on the existing pending date, that does not guarantee two. Subtracting one/two hours around local midnight can also produce yesterday, despite the F1 comment calling it today. Use explicit occurrence identities and coherent dated setup. The full Journey B still is not represented by that short spec.
4. **Test helpers can silently change the scenario.** `keyed`, `keyedClient` and the HTTP session helper select a pending occurrence or invent a manual-session UUID when omitted. That can be useful fixture compatibility, but it cannot prove rejection of missing identity, same-day identity, or legacy calls. Those tests need an unmodified client/payload and explicit negative controls. Do not describe an implicit manual fallback as logging the intended scheduled class.
5. **Labels and cross-week propagation remain missing.** The new command authority does not prove weekly-review/continuation labels, Curriculum/Coach agreement, protected restore races or identity after rollover.

## Product decision — resolved after this review

The builder introduced “scheduled class must have ended” without an established owner decision. The owner subsequently confirmed on 19 November 2026: **allow in-progress logging; keep class completion separate** (founder decisions §21). The updated Phase 7B prompt now requires the versioned incremental-update flow, not just removal of the end-time check. This is an approved implementation requirement, not a claim that the current software supports it.

## Next build

Finish **one vertical slice**: receipt/export closeout plus Journey B through tests, repairs and the next class-led cycle. Do not spend the next turn re-running only the short class-log spec and calling it Journey B. A/C, long-horizon coverage, broad cleanup/measurement and final real-bank inventory remain subsequent work under the existing Phase 7 plan.

Prompt: `docs/PHASE-7B-CLASS-LED-LIFECYCLE-AGENT-PROMPT.md`. This review changed documentation only and made no database writes.
