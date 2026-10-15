# Operating State v2 and Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. This repo is not a git repo — track progress in a ledger at `.superpowers/sdd/2026-09-19-operating-state-and-home/progress.md` and snapshot to `baseline/` per task (same workaround as the Pulse plan). Steps use checkbox syntax.

**Goal:** One account-scoped read model (`getOperatingState`) that every page reads, and a Home rebuilt as a next-action console with four transparent evidence signals.

**Architecture:** Pure derivation functions (activation, next action, signals, preparedness, pressure) in `src/lib/state/derive.ts`, tested without a database. `getOperatingState` composes database reads and calls them. Consumers switch to it; the blended readiness percentage is deleted.

**Tech Stack:** Next.js App Router (server components), Supabase, TypeScript, plain CSS tokens. Test convention: `scripts/*.ts` with the `check()/eq()` harness wired into `npm run verify`.

**Spec:** `docs/superpowers/specs/2026-09-19-operating-state-and-home-design.md` (authority: `docs/FOUNDER-PRODUCT-DECISIONS.md`).

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing Next.js code** (AGENTS.md: this Next.js has breaking changes).
- No single readiness percentage anywhere; no pass probability; no required-hours figure.
- Only `insufficient_evidence` and `building` preparedness bands may be emitted.
- Practice-mode attempts (`evidence_mode = 'practice'`) never count as demonstrated understanding.
- `unreported` (past date, still `not_started`) is its own bucket.
- A roadmap counts only if `status = 'active'`.
- `getOperatingState` never writes; GET/page render stays write-free (Calendar's ruled first-visit generation is the one exception and is unchanged).
- Never use the real account for any destructive test operation; the test identity is the `+e2e` account configured in `.env.local`.
- Live schema facts (verified): `user_module_state.coverage_state ∈ {not_started, taught, studied, verified, decaying}`; `evidence_events.evidence_state ∈ {insufficient, needs_repair, unstable, supported}`, `validity ∈ {valid, voided, disputed}`, `evidence_mode ∈ {evidence, practice}`, columns `self_reported_confidence`, `is_correct`; `plan_blocks.execution ∈ {not_started, in_progress, partial, completed, skipped, deferred, cancelled}`.

---

### Task 1: Types and pure derivation

**Files:**
- Create: `src/lib/state/typesV2.ts`, `src/lib/state/derive.ts`, `scripts/operating-state-test.ts`
- Modify: `package.json` (add `operating:test`, append to `verify`)

**Interfaces — Produces** (exact, later tasks rely on these):

```ts
// typesV2.ts
export type Activation = { status: 'not_onboarded' | 'needs_activation' | 'ready'; reason: string | null }
export type Pressure = { level: 'low' | 'moderate' | 'high' | 'unknown'; assumptions: string[] }
export type TodayTask = { id: string; title: string; detail: string | null; type: string; execution: string;
  durationMinutes: number | null; startsAt: string | null; revision: number }
export type AttentionItem = { id: string; kind: 'decision' | 'info'; title: string; actionLabel: string; actionUrl: string }
export type NextAction =
  | { kind: 'activate' }
  | { kind: 'decision'; item: AttentionItem }
  | { kind: 'task'; task: TodayTask; nextUpTitle: string | null }
  | { kind: 'paper'; title: string; due: 'today' | 'overdue' }
  | { kind: 'none'; reason: string }
export type PaperState = { taskId: string | null; status: 'none' | 'upcoming' | 'due' | 'submitted' | 'closed'; canAssemblePaper: boolean | null }
export type Signals = {
  position: { notStarted: number; exposed: number; practised: number; verified: number; decaying: number; total: number }
  understanding: { supported: number; unstable: number; needsRepair: number; papers: number; topics: number;
    latestEvidenceAt: string | null; daysSinceLatest: number | null }
  execution: { completed: number; partial: number; deferred: number; skipped: number; unreported: number; planned: number }
  calibration: { status: 'insufficient' | 'measured'; sample: number; confidentAndWrong: number; unsureAndRight: number; agreed: number }
}
export type Preparedness = { band: 'insufficient_evidence' | 'building'; why: string[] } | null
export type OperatingStateV2 = { activation: Activation; exam: {...}; route: {...}; roadmap: {...}; week: {...}; today: {...};
  nextAction: NextAction; paper: PaperState; signals: Signals; preparedness: Preparedness; attention: AttentionItem[];
  capabilities: { bankItems: number; canAssemblePaper: boolean | null } }
```
(Write the full `exam`/`route`/`roadmap`/`week`/`today`/`capabilities` field types exactly as in spec §2.1.)

```ts
// derive.ts
export function deriveActivation(i: { onboardingStatus: string | null; hasActiveRoadmap: boolean; currentWeekTaskCount: number }): Activation
export function pickNextAction(i: { activation: Activation; attention: AttentionItem[]; todayTasks: TodayTask[]; paper: PaperState }): NextAction
export function deriveSignals(i: {...rows}): Signals            // see steps
export function derivePreparedness(s: Signals, criticalWarning: boolean): Preparedness
export function derivePressure(v: 'comfortable'|'tight'|'not_enough_time'|'unknown', usesSeededPace: boolean): Pressure
export const MIN_CALIBRATION_SAMPLE = 5
```

- [ ] **Step 1: Write failing tests** in `scripts/operating-state-test.ts` covering, at minimum:
  - `deriveActivation`: status not `complete` → `not_onboarded`; complete + no active roadmap → `needs_activation`; complete + active roadmap + 0 tasks → `needs_activation`; all present → `ready`.
  - `pickNextAction` priority: `needs_activation` beats everything; a decision beats a task; a task beats a due paper; paper `due` with no tasks → `paper`; nothing → `none` with a non-empty reason; completed/skipped tasks are skipped when choosing the task; `nextUpTitle` is the following active task's title.
  - `deriveSignals`: coverage mapping (`taught`→exposed, `studied`→practised); practice-mode and voided/disputed evidence excluded; `unreported` = date before today and `not_started`, and is not counted in `completed`; calibration `insufficient` under 5 responses, `measured` at 5+, with `confidentAndWrong` = confidence high & incorrect and `unsureAndRight` = confidence low & correct.
  - `derivePreparedness`: `null` unless ≥3 topics, ≥2 papers, latest evidence ≤14 days, and no critical warning; when met returns `building` with non-empty `why`; never returns a band above `building`; below threshold returns `null` (the UI, not this function, renders "insufficient evidence").
  - `derivePressure`: verdict mapping and that no returned string contains a digit followed by "hour".
- [ ] **Step 2: Run** `npx tsx scripts/operating-state-test.ts` — expect failure (module missing).
- [ ] **Step 3: Implement** `typesV2.ts` and `derive.ts` to satisfy the tests. Confidence values: check `assessment_responses.self_reported_confidence` accepted values with the diagnostic code (`grep -rn self_reported_confidence src/lib`) before mapping "high"/"low"; map the lowest and highest tiers, treat the middle as `agreed`-eligible only if correct-consistent.
- [ ] **Step 4: Run** the test file — all pass. Add `"operating:test": "tsx scripts/operating-state-test.ts"` and append `&& npm run operating:test` to `verify` (before `audit:routes`). Run `npm run verify` — green.

### Task 2: `getOperatingState` composition

**Files:**
- Create: `src/lib/state/getOperatingState.ts`
- Read for reuse: `src/lib/state/operatingState.ts`, `src/lib/curriculum/roadmapService.ts` (`getActiveRoadmap`, `computeProgress`), `src/lib/planning/schedule.ts` (`getStudyWeekContext`)

**Interfaces — Consumes:** Task 1 types/functions. **Produces:** `getOperatingState(userId: string): Promise<OperatingStateV2>`.

- [ ] **Step 1:** Implement with the admin client, all reads scoped by `user_id`. Reads: `profiles` (onboarding_status, exam_sitting, exam_year, registered, exam_date, prep_mode), `getActiveRoadmap` (must return only `status='active'` — confirm in `roadmapService.ts`; if it does not filter, filter in this function), `getStudyWeekContext`, current-week `plan_blocks` (by `local_date` between week start/end; fields for `TodayTask` plus `execution`, `task_type`, `local_date`), `user_module_state` (`coverage_state`), valid evidence-mode `evidence_events` joined to attempts for paper count and to concepts→topics for distinct topics, `assessment_responses` confidence/correctness (valid, evidence-mode attempts only), `repair_threads` open/proposed count, `assessment_items` verified count for `capabilities.bankItems`.
- [ ] **Step 2:** Attention items: pending repairs → `decision` item linking `/app/calendar?view=agenda`. (Closure/class-change items are added by later sub-projects; leave the extension point commented.)
- [ ] **Step 3:** `paper`: find the current week's `task_type='diagnostic'` block → status `upcoming|due|submitted|closed` from its date vs today and `execution`; else `none`. `canAssemblePaper: null`.
- [ ] **Step 4:** `pressure` from the roadmap's `feasibility.verdict` via `derivePressure`; `roadmap.active` false when there is no active roadmap.
- [ ] **Step 5:** `npx tsc --noEmit` clean. Smoke via a throwaway script against the `+e2e` account printing the state; confirm no `readiness` percentage exists.

### Task 3: Retry-activation endpoint

**Files:** Create `src/app/api/activation/retry/route.ts`

- [ ] **Step 1:** POST, authenticated (`createClient().auth.getUser()`, 401 otherwise). Requires onboarding complete and an active roadmap (else 409 with `{ ok:false, error }` explaining which input is missing). Calls `getStudyWeekContext` → `buildWeekPlan` → if any portions, `commitWeekPlan` (both in `src/lib/planning/pulse/generateWeek.ts`); returns `{ ok: true, status }` using `getOperatingState(...).activation.status`. Idempotent: if the current week already has tasks, returns ready without writing.
- [ ] **Step 2:** Typecheck; manual POST via the e2e cookie helper pattern from `scripts/e2e-calendar.ts` (Task 6 automates this).

### Task 4: Migrate consumers, delete readiness

**Files:** Modify `src/app/app/coach/page.tsx`, `src/app/api/coach/route.ts`, `src/components/coach/CoachClient.tsx`, `src/app/app/settings/page.tsx`; delete `src/lib/state/operatingState.ts`, `src/lib/state/types.ts`, `src/lib/state/readiness.ts`; delete `scripts/readiness-test.ts` and remove `readiness:test` from `package.json`/`verify`; rename `typesV2.ts`→`types.ts` and update imports.

- [ ] **Step 1:** Coach: replace `getCurrentOperatingState` with `getOperatingState`; anything reading `readiness.*`/`diagnostics.latest` is reworked to read `signals`/`preparedness` (the Coach must not quote a percentage; if it did, that copy is removed).
- [ ] **Step 2:** Settings: exam and route facts come from `state.exam`/`state.route` instead of raw profile reads, so Settings cannot disagree with Home.
- [ ] **Step 3:** `grep -rn "getCurrentOperatingState\|computeReadiness\|readiness" src scripts` returns nothing relevant; `npx tsc --noEmit` clean; `npm run verify` green.

### Task 5: Home rebuild

**Files:** Modify `src/app/app/page.tsx`; Create `src/components/home/NextActionCard.tsx`, `src/components/home/SignalCards.tsx`, `src/components/home/ActivationRecovery.tsx`; Modify `src/components/home/TodayFocusCard.tsx` (keep Start/Defer/Complete + duration prompt; remove `readinessPercent`/`ProgressRing`); CSS in `src/styles.css` using existing tokens.

- [ ] **Step 1:** Read `node_modules/next/dist/docs/` for the server/client component and data-fetching conventions before writing.
- [ ] **Step 2:** `page.tsx` calls `getOperatingState` once. `needs_activation` → render only `ActivationRecovery` (retry button POSTing `/api/activation/retry` then refreshing; "review my setup" link to `/app/settings`; a support reference string built from the user id prefix and timestamp). `ready` → order: `NextActionCard` (task variant reuses `TodayFocusCard`'s wired actions; decision/paper/none variants per `nextAction`), decision attention items, today's sequence ("Later today"), paper/closure state line, `SignalCards` (four cards, each showing its sample size and "as of"; an empty signal states what is missing), roadmap trajectory with pressure level and its assumptions, Coach entry and the existing quick "Log learning" link.
- [ ] **Step 3:** Remove the quick-link pill nav and the readiness ring. Copy is calm and factual; no "behind", no hours.
- [ ] **Step 4:** Responsive check at 390 and 1440 widths via the browser tool; no horizontal scroll; `npm run build` clean.

### Task 6: Live contract test

**Files:** Create `scripts/e2e-operating-state.ts`; add `"e2e:state"` script.

- [ ] **Step 1:** Follow `scripts/e2e-calendar.ts` for sign-in and the `+e2e` identity guard (`getE2EEmail`, `verifyAndGetE2EUser`, `resetE2EUser`, `assertBlankOnboarding`). Assert: (a) after onboarding completes but with the roadmap superseded/absent, Home renders the recovery panel and not the console; (b) a **draft** roadmap alone never yields `ready`; (c) after `POST /api/activation/retry` with an active roadmap, Home renders the console with a Next Action; (d) Home, Calendar and Settings show the same exam label string; (e) the Home HTML contains no `%` readiness figure and no "readiness" ring text.
- [ ] **Step 2:** Run `npm run e2e:state`, then the full existing chain (`verify`, `e2e:onboarding`, `e2e:calendar`, `e2e:editing`, `e2e`, `e2e:routes`, `build`); `e2e:roadmap`'s four known failures are pre-existing and out of scope.

---

## Self-review

- **Spec coverage:** §2.2 activation → Tasks 1–3, 5; §2.3 next action → 1, 5; §2.4 signals → 1, 2, 5; §2.5 preparedness → 1; §2.6 pressure → 1, 2 (copy deferred); §2.7 paper → 2, 5; §3 Home → 5; §4 consumers → 4; §7 testing → 1, 6.
- **Type consistency:** all names above are defined once in Task 1 and used unchanged after.
- **Known risk:** `self_reported_confidence` value vocabulary is unverified here; Task 1 Step 3 requires checking it before mapping.
