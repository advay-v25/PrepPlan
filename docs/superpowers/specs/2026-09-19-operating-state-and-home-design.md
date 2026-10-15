# Operating State v2 and Home — design

**Status:** draft for founder review
**Authority:** `docs/FOUNDER-PRODUCT-DECISIONS.md` (§5 readiness, §6 pressure, §7 Home, §16 failed activation). Where this spec and that document differ, that document wins.
**Audit items closed:** P0-6 (pages disagree on account truth); the "0% readiness ring", "no next action", "fabricated dashboard" findings for Home.

## 1. Problem

Home, Calendar, Settings, Curriculum and Coach each compose account truth independently. On the same account they showed an Ethics milestone at 0% readiness, "exam not chosen", a February draft roadmap, and no accepted week. Causes, verified in `src/lib/state/operatingState.ts`:

- It reads the roadmap without requiring `status = 'active'`, so a draft (created by an onboarding preview that never confirmed) counts as the plan.
- It has no notion of "onboarding complete but the first week failed to activate".
- `readiness.percent` blends coverage (60%) with diagnostic accuracy (40%) and collapses to pure coverage when no diagnostic exists, so self-reported coverage reads as preparedness. Decisions §5 forbids leading with one opaque percentage.
- It has no next action, no weekly-paper state, no execution/deviation view, no confidence calibration.

## 2. Design

One function, `getOperatingState(userId)`, is the only way any page learns account truth. It is a pure composition of database reads plus pure derivation functions; it never writes. Every consumer (Home, Coach route/page, Settings, Calendar header) reads the same object.

### 2.1 Shape

```ts
type OperatingStateV2 = {
  activation: Activation
  exam: { sitting: string | null; year: number | null; registered: boolean; date: string | null; label: string | null }
  route: { prepMode: string | null; label: string | null }
  roadmap: { active: boolean; activeMilestone: Milestone | null; pressure: Pressure }
  week: { start: string; end: string; today: string; timezone: string; cycleId: string | null }
  today: { tasks: TodayTask[] }
  nextAction: NextAction
  paper: PaperState
  signals: Signals               // the four transparent signals, §2.4
  preparedness: Preparedness     // band or null, always with reasons
  attention: AttentionItem[]
  capabilities: { bankItems: number; canAssemblePaper: boolean | null }
}
```

### 2.2 Activation (Decisions §16)

`activation.status` is exactly one of:

| status | condition | Home shows |
|---|---|---|
| `not_onboarded` | `profiles.onboarding_status !== 'complete'` | redirect to onboarding (already enforced) |
| `needs_activation` | onboarding complete, but no **active** roadmap, or no plan_blocks for the current week and none generatable | a recoverable "Your week could not be activated" panel: retry, review inputs, support reference. No dashboard. |
| `ready` | onboarding complete, active roadmap, current week has tasks | the console |

A draft or superseded roadmap is never "the roadmap". `roadmap.active` is true only for `status = 'active'`.

Retry is an explicit POST (`/api/activation/retry`) that calls `buildWeekPlan` + `commitWeekPlan` for the current week and returns the new status. The Calendar's existing generate-once-on-first-visit behaviour is unchanged.

### 2.3 Next action (Decisions §7 priority order)

`nextAction` is a discriminated union chosen by a pure function `pickNextAction(input)` in this priority order; the first that applies wins:

1. `activate` — activation is `needs_activation`.
2. `decision` — an attention item that requires the student to decide (pending repair proposal, weekly-paper closure awaiting logs/accept, class change awaiting recalculation).
3. `task` — the first not-completed, not-skipped task today.
4. `paper` — the weekly paper is due today or overdue and not submitted.
5. `none` — with a plain reason ("Nothing is scheduled today"), never a blank card.

Home leads with this. There is no fifth-tier fallback that shows a percentage.

### 2.4 The four signals (Decisions §5)

Each signal carries its own sample size and freshness so the UI can show how much to trust it.

1. **Curriculum position** — counts of modules by `user_module_state.coverage_state`: `not_started`, `exposed` (`taught`), `practised` (`studied`), `verified`, plus `decaying`. Self-reported and task-completion sources are counted as exposure, never as verified.
2. **Demonstrated understanding** — from `evidence_events` where `validity = 'valid'` and `evidence_mode = 'evidence'` (practice attempts excluded): counts by `evidence_state` (`supported`, `unstable`, `needs_repair`), number of scored papers, distinct concepts/topics covered, latest evidence date and days since.
3. **Plan execution** — current-cycle `plan_blocks` grouped as `completed`, `partial`, `deferred`, `skipped`, and `unreported` (date passed, still `not_started`). `unreported` is its own bucket and is never folded into completed or missed.
4. **Confidence calibration** — from valid responses with a `self_reported_confidence`: `confidentAndWrong`, `unsureAndRight`, `agreed`, with sample size. Below a minimum sample (5) the signal reports `insufficient` instead of a ratio.

### 2.5 Preparedness band

`preparedness` is `null` until the minimum evidence threshold is met, per Decisions §5: valid evidence across at least 3 distinct topics, at least 2 scored evidence-mode papers, evidence within the last 14 days, and no critical bank/integrity warning. Even when met, this release emits only `insufficient_evidence` or `building`. `developing`, `stable` and `exam_phase_ready` are reserved until the quantitative model is calibrated against outcome data (Decisions §5 says explicitly this must not be marketed before then). Every band carries a `why: string[]`. There is no pass probability anywhere.

### 2.6 Pressure (Decisions §6)

`roadmap.pressure` maps the existing `Feasibility.verdict` to calm states: `comfortable→low`, `tight→moderate`, `not_enough_time→high`, `unknown→unknown`, plus a list of assumptions. It contains no required-hours figure. The Curriculum page's current "add ~23 hours" copy is a separate follow-up sub-project; this spec only supplies the safe data.

### 2.7 Paper state

`paper` reports the scheduled weekly-paper task (if any), its status (`upcoming | due | submitted | closed`), and `canAssemblePaper`. Bank sufficiency is not evaluated in this sub-project: `canAssemblePaper` is `null` ("not yet checked") and the UI says the paper is confirmed before it is due. Weekly-closure generation is a later sub-project; this spec only surfaces closure as a `decision` attention item when a paper is submitted and the closing week has unresolved logs.

## 3. Home

Order, from Decisions §7: next action; anything needing a decision; today's sequence; weekly paper/closure state; week execution and deviations; the four evidence signals; long-term roadmap trajectory and pressure; contextual Coach entry and quick capture.

- `TodayFocusCard`'s readiness ring is removed. The hero is the Next Action card (Start / Defer / Complete stay wired through `useTaskMutation`).
- The four signals render as separate cards, each with sample size and "as of" date; an empty signal says what is missing, not "0%".
- The quick-link pills that duplicate the sidebar are removed.
- `needs_activation` renders only the recovery panel.
- Copy stays calm: no shaming, no prediction, no hours targets.

## 4. Consumers migrated

`src/lib/state/types.ts` and `operatingState.ts` are replaced by v2. Migrated in this sub-project: Home, `app/coach/page.tsx`, `app/api/coach/route.ts`, `CoachClient.tsx` (reads `readiness`/`diagnostics` today), Settings exam/route facts (`p.exam_*` reads replaced by `state.exam`/`state.route`). `computeReadiness` and `lib/state/readiness.ts` are deleted once nothing imports them.

## 5. Out of scope (later sub-projects)

Weekly closure flow and next-week draft; Curriculum pressure copy; persistent Coach and its tool contracts; bank-sufficiency evaluation; staff-only diagnostic routes; public sandbox; email verification gate; responsive Calendar; legal copy.

## 6. Rulings made without asking (reversible)

- Only `insufficient_evidence`/`building` bands are emitted until calibration exists (conservative reading of Decisions §5).
- `unreported` is a first-class execution bucket (Decisions §4: an unknown log stays unknown).
- Practice-mode attempts are excluded from demonstrated understanding (Decisions §8: activity is not understanding; the audit flags practice-vs-evidence confusion).
- Retry-activation is an explicit POST, keeping GET/page-render write-free apart from the already-ruled Calendar first-visit generation.

## 7. Testing

- Pure-function tests (`scripts/operating-state-test.ts`, wired into `npm run verify`): `pickNextAction` priority order, activation derivation, signal derivation including thresholds, preparedness gating, pressure mapping.
- Live contract test (`scripts/e2e-operating-state.ts`): against the dedicated `+e2e` account only, walk blank → onboarded-without-roadmap (`needs_activation`) → activated (`ready`) and assert Home renders each state, a draft roadmap never yields `ready`, and Settings/Home/Calendar report the same exam label.
- Existing suites must stay green.
