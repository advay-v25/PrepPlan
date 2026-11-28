# Revamp Phases 0–4 closeout

The checks in this record use an isolated loopback app, Auth, PostgREST and Postgres. Scored browser paths use synthetic, approved question banks. Hosted source comparison, provider acceptance and deployment are separate from this verification.

## Changes

- Log links from a task or reading load the selected context first. The generic chooser loads when requested. Scoped logging keeps its existing owned-task checks, retry receipts and separate-session choice.
- Starting point only loads a topic's full reading list when opened. Saved refinements remain editable when the optional lookup fails. The eligible mock date is rendered from the student's saved timezone on both server and client.
- The Curriculum Notes index reads notes and catalogue labels without loading assessments, revision planning or card history. Reading and subject tabs load the selected section. Full-text note search and links back to the originating reading or result remain available.
- Settings names the four setup areas and their actions. The reviewer workspace keeps the approval receipt visible when a stale tab repeats a decision and provides an explicit reload.
- Results distinguish a pending challenge from a kept or set-aside question. A set-aside question remains findable by its paper number. A kept question retains its ordinary review row.
- The compatibility answer command uses the current answer and timing transaction. It preserves an already recorded answer and its receipt. The lower-level writer is no longer callable by authenticated students. The migration is `20270210_legacy_answer_boundary`.
- Calendar browser fixtures now use the student's timezone and valid cycle dates. Fault injection for Home and Calendar matches the actual signals query. Separate Settings and Calendar tests can report their own outcomes.

## Read budget

Fifteen warm requests per route, per persona, on a local production build. Counts are database reads plus RPCs.

| Persona | Home | Calendar | Tests | Coach | Log page |
|---|---:|---:|---:|---:|---:|
| Fresh baseline | 93 | 97 | 37 | 31 | 3 |
| Fresh closeout | 68 | 74 | 29 | 23 | 3 |
| History baseline | 116 | 120 | 60 | 31 | 3 |
| History closeout | 82 | 88 | 43 | 23 | 3 |

Fresh Home and Calendar with history both met the 25% reduction targets. Local response times reflect the machine and work running during the samples.

The Starting point HTML was 39,879 bytes versus the previous 57,871 bytes, a 31% reduction. For the known-task Log entry, the API payload went from 3,388 to 539 bytes on desktop and 3,485 to 636 bytes at 390 px. These are context-response bytes. The Log page shell is measured separately.

In the final local run, fresh Home was 115 ms p50 / 124 ms p95. Calendar with history was 117 ms p50 / 141 ms p95. The [route measurements](evidence/revamp-phase4-closeout-performance.json) and [onboarding measurements](evidence/revamp-phase4-closeout-onboarding.json) contain all sampled routes.

## Database checks

- `npm run contracts:local` passed. The answer and progress suite passed 12 checks, including the compatibility receipt, saved timing and effective grants.
- Local install and upgrade applied 54 migrations over the 105-version baseline. The local ledger had 159 entries, zero checksum mismatches and zero pending. Restore passed 32 checks. Use `--local-only` for the install or upgrade rehearsal when a hosted source comparison is unavailable.

## Browser checks

The viewports were 1280 and 390 px. Sign-up and recovery use the local Auth stack. The production-style check confirms behaviour with unavailable providers. The controlled-provider checks use loopback fixtures.

| Area | Evidence |
|---|---|
| Access and navigation | Auth-security at both widths, public walkthrough and self-study and class-led app audit |
| Session logging | 12 tests passed, including an exact Coach link, a lost reply and a weekly continuation |
| Calendar and weekly review | Class move, protected conflicts, partial-class scope, no-room obligation carried when a feasible next slot exists, keyboard and IME |
| Mature candidate and exam boundary | February first-pass-complete student, poor external mock and repeat, failed-read and deadline recovery, and a booked midweek exam with time beyond the cutoff |
| Linked rehearsal | Both widths passed. Reservation started neither clock, each Start began its own clock, and the result combined the two forms |
| Assessment and challenges | Both widths recovered a failed runner load on the same reservation. The corrected challenge journey passed 8 browser tests with setup and paper taking, then verified evidence and denominator after one keep and one void |
| Curriculum | Both widths passed for full-text notes, note and card retries, local drafting, the 1,000-card boundary, and the no-key control |
| Settings and Account | 28 production-style checks passed across the Settings, fault, and no-key suites. The optional reading lookup and saved refinement passed in a separate test at both widths |
| Reviewer | 8 workflow checks passed at both widths, including a repeated approval and exact new item version |

The controlled Coach runtime passed 39 checks. Its provider is scripted locally. The empty-bank control and fixture-bank assessment runs are separate.

The browser checks were split across focused runs. The first broad runs found a test fixture with an elapsed or out-of-cycle study window, stale copy and fault selectors, a browser response-body race, a timezone hydration warning, and contradictory challenge copy. The corrected cases were rerun on their matching banks and viewports. The full lookups and fault behaviours were exercised separately from the provider-free production build.

## Build gates

The production build, TypeScript, route audit and `npm run verify` passed on the isolated source snapshot `4927ef03507f09b4`. The asset audit checked 57 browser assets and found no secrets. Local performance was measured on that build. The shared worktree may also contain parallel Phase 5 work.

The final `npm run verify` passed on worktree fingerprint `cf2e410ac7dbed56`. The local stack had zero fixture accounts and zero assessment items at cleanup. The run's servers and database were stopped.

## Release checks still separate

Live email delivery, Google sign-in and Turnstile acceptance require the configured providers. Synthetic questions establish the application behaviour. Student paper availability depends on the published question bank. The new migration and app changes were tested locally. This run made no deployment or hosted database changes.
