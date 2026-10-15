# Pulse Calendar Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adaptive weekly planning engine described in the Pulse spec (Phase A), and fix the concrete breakages in the in-progress onboarding rewrite that block it from working at all.

**Architecture:** A new `src/lib/planning/pulse/` module computes a week's boundaries, its effort envelope, and each day's portion from real data (availability, roadmap phase, repair backlog), then writes the whole week as real `plan_blocks` rows in one pass. A `redistributeWeek` operation handles the "auto-redistribute small deviations" requirement by rewriting only today-and-future rows in place when a shortfall stays within each day's absorption cap. The onboarding rewrite already in progress has the exact seam this plugs into (`previewService.ts`'s `generatePreview`, currently a hardcoded mock array) — Phase 1 fills it with the real engine instead of building a second, parallel generation path.

**Tech Stack:** Next.js/TypeScript, Supabase (Postgres + RLS), the existing `scripts/*.ts` pure-function test harness (no test framework — a `check()`/`eq()` runner wired into `npm run verify`).

**Spec:** `docs/superpowers/specs/2026-09-18-pulse-calendar-engine-design.md`

## Global Constraints

- Internal sizing math uses the roadmap's relative effort-units only, never hours or a prescribed weekly-hour target (spec §2).
- New-content absorption cap: **2 effort-units per day**, independent of raw available time (spec §3.1 item 3).
- Weekly envelope formula: `phaseRelevantRemainingEffort ÷ max(1, usableWeeksRemainingInPhase) × pacingFactor` — never `remainingEffort × pacingFactor` directly (spec §2).
- Pacing factor bands: ≥90%→1.15, 60–90%→1.0, 30–60%→0.75, <30% or <2 weeks history→0.6, from a rolling window of the last 3 closed weeks where available (spec §2).
- `day_preferred` placement (a date, no clock time) is the default for study portions; `timed` is reserved for protected commitments, the pulse-day cumulative review, and mocks — mocks are explicitly out of scope for Phase 1 (spec §3.1 item 4, §11).
- Priority order within a day: repair/recheck work > unstable-but-correct concepts > class consolidation slot > phase-appropriate content (spec §3.1 item 1). Class-consolidation *content generation* is Phase B; Phase 1 only needs the priority slot to exist and fall through to phase-appropriate content when there's nothing to consolidate.
- Week generation happens only on an explicit trigger (onboarding completion, pulse day closing, explicit regenerate) — **never on GET / page render** (spec §3.3, §25 "render purity" from the audit, which the founder did not dispute).
- All writes to existing rows are revision-guarded, matching `src/lib/planning/taskService.ts`'s existing optimistic-concurrency pattern (`.eq('revision', expectedRevision)`, checking for a mismatch).
- No new tables for Phase 1.
- Pure-function tests follow the existing `scripts/*.ts` convention: a `check(name, condition, detail)` / `eq(name, actual, expected)` harness, `console.log` output, `process.exit(1)` on any failure, wired into `package.json`'s `verify` script.

---

## Part 0 — Reconciliation (prerequisite; the engine cannot work without these)

These fix concrete, verified breakages in `src/lib/onboarding/{service,previewService,schema}.ts` and one migration, discovered by testing directly against the live database while planning this feature. They are not optional cleanup — Task 7 onward cannot function without them.

### Task 1: Fix the `plan_drafts` column mismatch in `previewService.ts`

**Files:**
- Modify: `src/lib/onboarding/previewService.ts`

**Interfaces:**
- Consumes: nothing new yet (Task 8 will wire in the real generator; this task only fixes the insert).
- Produces: `generatePreview(userId)` writes a real `plan_drafts` row instead of erroring.

**Context:** `plan_drafts` was verified live to have columns `draft_json`, `context_version`, `revision`, `status`, etc. — **not** `roadmap_json`/`tasks_json`, which the current code inserts. This insert currently fails outright.

- [ ] **Step 1: Fix the insert to use real columns**

In `src/lib/onboarding/previewService.ts`, replace the `admin.from('plan_drafts').insert(...)` call:

```ts
const { data: draft, error } = await admin.from('plan_drafts').insert({
  user_id: userId,
  context_version: state.profile?.onboarding_context_version ?? 1,
  draft_json: { roadmap: roadmap, tasks },
  status: 'ready',
  revision: 1,
}).select().single()
```

(Leave the rest of `generatePreview` as-is for this step — `tasks` is still the mock array; Task 8 replaces that.)

- [ ] **Step 2: Verify by calling the route directly**

```bash
npm run dev
```

In another terminal, sign in as the E2E test account (see `scripts/e2e-onboarding.ts` for the magic-link pattern) and hit the route, or add a one-off check:

```bash
npx tsx -e "
import('dotenv/config');
(async () => {
  const { generatePreview } = await import('./src/lib/onboarding/previewService');
  const result = await generatePreview('<E2E_TEST_USER_ID>');
  console.log(result);
})();
"
```

Expected: no error, a real `draftId` returned. (Fails before this fix with a Postgres "column does not exist" error.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/onboarding/previewService.ts
git commit -m "fix: plan_drafts insert uses real columns (draft_json, not roadmap_json/tasks_json)"
```

---

### Task 2: Fix `accept_onboarding_preview`'s `plan_blocks` insert

**Files:**
- Create: `supabase/migrations/20260919_fix_onboarding_preview_rpc.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a corrected `accept_onboarding_preview(uuid, integer)` RPC that inserts into `plan_blocks` using columns that actually exist on the live table.

**Context:** The live `plan_blocks` table (verified directly against the database) has columns `id, user_id, day, title, duration, detail, ..., task_type, priority, placement, execution, ..., local_date, revision, ...` — not `purpose, status, scheduled_date, start_time, is_floating, metadata`, which the current RPC (in `supabase/migrations/20260918_canonical_onboarding.sql`) tries to insert. `day` and `local_date` are both `NOT NULL` on the live table (verified by a failing trial insert during planning) — the current RPC sets neither, so it cannot succeed for any task.

- [ ] **Step 1: Write the corrected RPC as a new migration**

```sql
-- Fixes accept_onboarding_preview's plan_blocks insert, which referenced
-- columns (purpose, status, scheduled_date, start_time, is_floating,
-- metadata) that do not exist on the live table. plan_blocks.day and
-- .local_date are both NOT NULL and neither was being set, so every call
-- failed. This redefines the function against the real schema:
-- id, user_id, cycle_id, title, detail, task_type, origin, priority,
-- placement, execution, local_date, day, starts_at, duration_minutes,
-- duration, rationale, revision (defaults handle revision/created_at).

create or replace function public.accept_onboarding_preview(
  p_draft_id uuid,
  p_expected_revision integer
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_draft plan_drafts%rowtype;
  v_new_cycle_id uuid;
  v_task jsonb;
  v_tasks_array jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_draft
  from public.plan_drafts
  where id = p_draft_id for update;

  if not found then
    raise exception 'Draft not found';
  end if;

  if v_draft.user_id != v_user_id then
    raise exception 'Unauthorized';
  end if;

  if v_draft.status = 'accepted' then
    return json_build_object('cycle_id', v_draft.accepted_cycle_id);
  end if;

  if v_draft.status != 'ready' then
    raise exception 'Draft is not ready';
  end if;

  if v_draft.revision != p_expected_revision then
    raise exception 'Stale revision. Expected %, got %', p_expected_revision, v_draft.revision;
  end if;

  if v_draft.roadmap_id is not null then
    update public.study_roadmaps
    set status = 'superseded', updated_at = now()
    where user_id = v_user_id and status = 'active';

    update public.study_roadmaps
    set status = 'active', updated_at = now()
    where id = v_draft.roadmap_id;
  end if;

  v_new_cycle_id := gen_random_uuid();
  insert into public.planning_cycles (
    id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status
  ) values (
    v_new_cycle_id, v_user_id, now(), now() + interval '7 days',
    coalesce(v_draft.cycle_start_date, v_draft.proposed_cycle_starts_at_local),
    coalesce(v_draft.cycle_end_date, v_draft.proposed_cycle_ends_at_local),
    coalesce(v_draft.timezone, 'UTC'), 'active'
  );

  v_tasks_array := v_draft.draft_json->'tasks';
  if jsonb_typeof(v_tasks_array) = 'array' then
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, starts_at, duration_minutes,
      duration, rationale, created_by
    )
    select
      coalesce((t->>'id')::text, 'task-' || gen_random_uuid()::text),
      v_user_id,
      v_new_cycle_id,
      t->>'title',
      coalesce(t->>'detail', ''),
      coalesce(t->>'task_type', 'study'),
      'algorithm',
      coalesce(t->>'priority', 'core'),
      coalesce(t->>'placement', 'day_preferred'),
      'not_started',
      (t->>'local_date')::date,
      (t->>'local_date')::date,
      (t->>'starts_at')::timestamptz,
      (t->>'duration_minutes')::smallint,
      coalesce(t->>'duration_minutes', '0'),
      coalesce(t->>'rationale', ''),
      'algorithm'
    from jsonb_array_elements(v_tasks_array) as t;
  end if;

  update public.plan_drafts
  set status = 'accepted', accepted_cycle_id = v_new_cycle_id, revision = revision + 1, updated_at = now()
  where id = p_draft_id;

  update public.profiles
  set onboarding_status = 'complete', onboarding_completed_at = now(),
      onboarding_preview_id = p_draft_id, updated_at = now()
  where id = v_user_id;

  return json_build_object('cycle_id', v_new_cycle_id);
end;
$$;

revoke execute on function public.accept_onboarding_preview(uuid, integer) from public;
grant execute on function public.accept_onboarding_preview(uuid, integer) to authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
node scripts/migrate.cjs supabase/migrations/20260919_fix_onboarding_preview_rpc.sql
```

(Check `scripts/migrate.cjs`'s usage pattern first — if it applies all pending migrations rather than taking a path argument, run it with no arguments instead.)

- [ ] **Step 3: Verify the RPC directly**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const uid = '<E2E_TEST_USER_ID>';
  const { data: draft } = await admin.from('plan_drafts').insert({
    user_id: uid, status: 'ready', revision: 1,
    draft_json: { tasks: [{ id: 'test-1', title: 'Test task', local_date: new Date().toISOString().slice(0,10), duration_minutes: 30 }] },
    cycle_start_date: new Date().toISOString().slice(0,10),
    cycle_end_date: new Date().toISOString().slice(0,10),
    timezone: 'UTC',
  }).select().single();
  const { data, error } = await admin.rpc('accept_onboarding_preview', { p_draft_id: draft.id, p_expected_revision: 1 });
  console.log({ data, error });
  const { data: blocks } = await admin.from('plan_blocks').select('id,title,local_date').eq('cycle_id', data.cycle_id);
  console.log('inserted blocks:', blocks);
  // cleanup
  await admin.from('plan_blocks').delete().eq('cycle_id', data.cycle_id);
  await admin.from('planning_cycles').delete().eq('id', data.cycle_id);
  await admin.from('plan_drafts').delete().eq('id', draft.id);
})();
"
```

Expected: `error: null`, one row in `blocks` with the test task's title and today's date.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260919_fix_onboarding_preview_rpc.sql
git commit -m "fix: accept_onboarding_preview RPC inserts real plan_blocks columns"
```

---

### Task 3: Checkpoint day — derive, not ask

**Files:**
- Modify: `src/lib/onboarding/schema.ts:85-87` (remove `CheckpointSetupSchema`'s `closingDay` field)
- Modify: `src/lib/onboarding/service.ts` (`saveCheckpoint`)
- Modify: `src/components/onboarding/steps/CheckpointStep.tsx`
- Test: `scripts/pulse-weekboundary-test.ts` (created in Task 4; this task's derivation logic is exercised there since it's the same function)

**Interfaces:**
- Consumes: `resolvePulseDay(classWeekdays: Weekday[]): Weekday` from Task 4.
- Produces: `saveCheckpoint` no longer requires a `closingDay` in its payload; `profiles.diagnostic_day` is set automatically from the student's class commitments (or defaults to Sunday for no-class students) rather than asked.

**Context:** `CheckpointSetupSchema` currently requires `closingDay: z.number().min(0).max(6)` and `CheckpointStep.tsx` blocks continuing until the student picks one (`canContinue = false` if `day === null`). Per the founder's explicit decision (asked twice, confirmed both times): the week boundary is derived from class schedule, never chosen.

- [ ] **Step 1: Remove `closingDay` from the schema**

In `src/lib/onboarding/schema.ts`, replace:

```ts
// 5. Checkpoint Setup
export const CheckpointSetupSchema = z.object({
  closingDay: z.number().min(0).max(6)
})

export type CheckpointSetup = z.infer<typeof CheckpointSetupSchema>
```

with:

```ts
// 5. Checkpoint Setup — the week-closing day is derived (Pulse spec §1),
// never chosen. This step has nothing left to validate; kept as a schema so
// service.ts's per-step dispatch stays uniform.
export const CheckpointSetupSchema = z.object({})

export type CheckpointSetup = z.infer<typeof CheckpointSetupSchema>
```

- [ ] **Step 2: Rewrite `saveCheckpoint` to derive instead of read a payload field**

In `src/lib/onboarding/service.ts`, replace:

```ts
export async function saveCheckpoint(userId: string, payload: unknown) {
  const data = CheckpointSetupSchema.parse(payload)
  const admin = createAdminClient()
  
  // Save checkpoint day to profiles or somewhere, let's assume profiles has a diagnostic_day or we use a separate setting
  await admin.from('profiles').update({ diagnostic_day: data.closingDay }).eq('id', userId)
  await bumpContextVersion(userId)
}
```

with:

```ts
export async function saveCheckpoint(userId: string, payload: unknown) {
  CheckpointSetupSchema.parse(payload)
  const admin = createAdminClient()

  // Derived, not chosen (Pulse spec §1): class-going students get a week
  // that starts on their earliest recurring class day; everyone else gets a
  // fixed Monday-Sunday week. resolvePulseDay is the same function the
  // calendar engine uses for this — checkpoint's job is just to snapshot the
  // result onto the profile so getStudyWeekContext doesn't need to
  // re-derive it on every read.
  const { data: classes } = await admin
    .from('calendar_commitments')
    .select('weekdays')
    .eq('user_id', userId)
    .eq('kind', 'class')
    .eq('status', 'active')

  const classWeekdays = (classes ?? []).flatMap(c => (c.weekdays ?? []) as number[])
  const pulseDay = resolvePulseDay(classWeekdays as Weekday[])

  await admin.from('profiles').update({ diagnostic_day: pulseDay }).eq('id', userId)
  await bumpContextVersion(userId)
}
```

Add the import at the top of `service.ts`:

```ts
import { resolvePulseDay } from '../planning/pulse/weekBoundary'
import type { Weekday } from '../planning/studyWeek'
```

(This creates a forward dependency on Task 4's file — do Task 4 first if executing out of plan order; the plan lists it next for exactly this reason.)

- [ ] **Step 3: Rewrite `CheckpointStep.tsx` to show, not ask**

Replace the full file:

```tsx
'use client'

import { useEffect } from 'react'
import { weekdayName } from '../../../lib/planning/weekday'
import type { Weekday } from '../../../lib/planning/studyWeek'
import type { OnboardingState } from '../OnboardingShell'

/**
 * The week-closing day used to be a chip picker here. It's derived now
 * (Pulse spec §1) — class-going students get a week that runs from their
 * earliest class day; everyone else gets Monday-Sunday. This step just
 * shows what was derived so it isn't a surprise, and always allows
 * continuing.
 */
export function CheckpointStep({
  state, onChange,
}: {
  state: OnboardingState
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
}) {
  const hasClasses = (state.commitments ?? []).some((c: any) => c.kind === 'class')
  const day = (state.profile?.diagnostic_day ?? 0) as Weekday

  useEffect(() => {
    onChange({}, true, null)
  }, [onChange])

  return (
    <div className="ob-section">
      <section>
        <h2 className="ob-subhead">When your study week closes</h2>
        <p className="fine-print">
          {hasClasses
            ? <>Your week runs from your first class of the week through <strong>{weekdayName(day)}</strong> — the cumulative diagnostic sits there.</>
            : <>Your week runs Monday through <strong>{weekdayName(day)}</strong> — the cumulative diagnostic sits there.</>}
          {' '}Anything it finds becomes the following week's repair work — so a test on your last day never
          gets crammed into the hours that are left. If your classes change, this updates automatically.
        </p>
      </section>
    </div>
  )
}
```

(This assumes `state.commitments` exists on `OnboardingState` — check `OnboardingShell.tsx`'s state shape; if commitments aren't already passed to steps, add `commitments: any[]` to the shared `OnboardingState` type and thread it through the same way `state.profile` already is.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

Expected: no new errors. (This step will legitimately fail until Task 4 exists — `resolvePulseDay` doesn't exist yet. That's fine; Task 4 is next.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/schema.ts src/lib/onboarding/service.ts src/components/onboarding/steps/CheckpointStep.tsx
git commit -m "fix: derive the week-closing day from class schedule instead of asking"
```

---

## Part 1 — The Pulse engine

### Task 4: `resolvePulseWeek` — week boundaries, derived

**Files:**
- Create: `src/lib/planning/pulse/weekBoundary.ts`
- Test: `scripts/pulse-weekboundary-test.ts`
- Modify: `src/lib/planning/schedule.ts` (`getStudyWeekContext`)

**Interfaces:**
- Produces:
  - `resolvePulseDay(classWeekdays: Weekday[]): Weekday`
  - `resolvePulseWeek(options: { classWeekdays: Weekday[]; timezone: string; reference?: Date | string }): StudyWeek`
- Consumes: `Weekday`, `StudyWeek`, `addDays`, `weekdayOf`, `todayInZone` from `src/lib/planning/studyWeek.ts` (all already exported there).

**Context:** `resolveStudyWeek` in `studyWeek.ts` takes an `anchorDay` chosen at onboarding. This replaces that input with a derived one. `resolveStudyWeek` itself is left untouched (other code may still reference the type); only `getStudyWeekContext` — the single call site every other module goes through (`loadRoadmapInputs`, Calendar, Home) — switches to the derived path, so no other caller needs to change.

- [ ] **Step 1: Write the failing test**

Create `scripts/pulse-weekboundary-test.ts`:

```ts
/**
 * Pulse week boundaries — derived, never chosen (spec §1).
 */
import { resolvePulseDay, resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nPulse week boundaries\n')

eq('no classes: pulse day is Sunday (Mon-Sun week)', resolvePulseDay([]), 0)
eq('classes Tue/Thu: pulse day is Monday', resolvePulseDay([2, 4]), 1)
eq('classes Mon/Wed/Fri: pulse day is Sunday', resolvePulseDay([1, 3, 5]), 0)
eq('single Saturday class: pulse day is Friday', resolvePulseDay([6]), 5)
eq('single Sunday class: pulse day is Saturday', resolvePulseDay([0]), 6)

const noClassWeek = resolvePulseWeek({ classWeekdays: [], timezone: 'UTC', reference: '2026-09-18' }) // a Friday
eq('no-class week runs Mon-Sun containing the reference date', [noClassWeek.startDate, noClassWeek.endDate], ['2026-09-14', '2026-09-20'])

const classWeek = resolvePulseWeek({ classWeekdays: [2, 4], timezone: 'UTC', reference: '2026-09-18' }) // a Friday
eq('class week (Tue/Thu) containing a Friday runs Tue-Mon', [classWeek.startDate, classWeek.endDate], ['2026-09-15', '2026-09-21'])
eq('class week has 7 days', classWeek.days.length, 7)
eq('class week pulse day matches endDate weekday', classWeek.anchorDay, 1)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx scripts/pulse-weekboundary-test.ts
```

Expected: `Cannot find module '../src/lib/planning/pulse/weekBoundary'`.

- [ ] **Step 3: Implement**

Create `src/lib/planning/pulse/weekBoundary.ts`:

```ts
import { Weekday, StudyWeek, addDays, todayInZone, weekdayOf } from '../studyWeek'

/**
 * Pulse day — the last day of the study week, and where the cumulative
 * review sits. Never chosen: derived from class schedule.
 *
 * Class-going student: the week runs from the earliest weekday among their
 * recurring classes through the day before it recurs, so the pulse day is
 * the day right before that earliest class day. Classes Tue(2)/Thu(4) ->
 * week is Tue-Mon, pulse day = Mon(1).
 *
 * No classes: fixed Monday-Sunday, pulse day = Sunday(0) — which is also
 * what the formula below produces if you feed it an empty array's implicit
 * "first day is Monday", so the empty case is handled directly rather than
 * relying on that coincidence reading clearly.
 */
export function resolvePulseDay(classWeekdays: Weekday[]): Weekday {
  if (classWeekdays.length === 0) return 0
  const earliest = Math.min(...classWeekdays) as Weekday
  return ((earliest - 1 + 7) % 7) as Weekday
}

/** Same shape as resolveStudyWeek, but the anchor is derived, not passed in. */
export function resolvePulseWeek(options: {
  classWeekdays: Weekday[]
  timezone: string
  reference?: Date | string
}): StudyWeek {
  const pulseDay = resolvePulseDay(options.classWeekdays)
  const today = typeof options.reference === 'string'
    ? options.reference
    : todayInZone(options.timezone, options.reference ?? new Date())

  const forward = (pulseDay - weekdayOf(today) + 7) % 7
  const endDate = addDays(today, forward)
  const startDate = addDays(endDate, -6)

  return {
    startDate,
    endDate,
    days: Array.from({ length: 7 }, (_, i) => addDays(startDate, i)),
    timezone: options.timezone,
    anchorDay: pulseDay,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx scripts/pulse-weekboundary-test.ts
```

Expected: `10 passed, 0 failed`.

- [ ] **Step 5: Wire into `getStudyWeekContext`**

In `src/lib/planning/schedule.ts`, replace:

```ts
export async function getStudyWeekContext(
  userId: string,
  reference?: Date | string
): Promise<StudyWeekContext> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('timezone, diagnostic_day, reminder_at')
    .eq('id', userId)
    .maybeSingle()

  const timezone = profile?.timezone || 'UTC'
  const anchorDay = (profile?.diagnostic_day ?? DEFAULT_DIAGNOSTIC_DAY) as Weekday
  const week = resolveStudyWeek({ anchorDay, timezone, reference })
```

with:

```ts
export async function getStudyWeekContext(
  userId: string,
  reference?: Date | string
): Promise<StudyWeekContext> {
  const admin = createAdminClient()
  const [{ data: profile }, { data: classes }] = await Promise.all([
    admin.from('profiles').select('timezone, reminder_at').eq('id', userId).maybeSingle(),
    admin.from('calendar_commitments').select('weekdays')
      .eq('user_id', userId).eq('kind', 'class').eq('status', 'active'),
  ])

  const timezone = profile?.timezone || 'UTC'
  const classWeekdays = (classes ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[])
  const week = resolvePulseWeek({ classWeekdays, timezone, reference })
  const anchorDay = week.anchorDay
```

Add the import: `import { resolvePulseWeek } from './pulse/weekBoundary'`. The rest of the function (building and returning `StudyWeekContext`) is unchanged — `anchorDay` is still populated, just derived now instead of read from `profiles.diagnostic_day`.

- [ ] **Step 6: Typecheck and run the existing study-week suite**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
npm run studyweek:test
```

Expected: clean typecheck; `studyweek:test` still passes (it tests `resolveStudyWeek` directly, which is untouched — only its caller in `schedule.ts` changed).

- [ ] **Step 7: Wire `pulse-weekboundary-test` into verify**

In `package.json`, add a script and extend the `verify` chain:

```json
"pulse:weekboundary:test": "tsx scripts/pulse-weekboundary-test.ts",
```

and insert `&& npm run pulse:weekboundary:test` after `&& npm run readiness:test` in the `verify` script.

- [ ] **Step 8: Commit**

```bash
git add src/lib/planning/pulse/weekBoundary.ts scripts/pulse-weekboundary-test.ts src/lib/planning/schedule.ts package.json
git commit -m "feat: derive the study week boundary from class schedule (Pulse §1)"
```

---

### Task 5: Real capacity — `dailyCapacityMinutes`

**Files:**
- Create: `src/lib/planning/pulse/capacity.ts`
- Test: `scripts/pulse-capacity-test.ts`

**Interfaces:**
- Consumes: `availability_windows` table (`user_id, weekday, start_time, end_time, status`), `calendar_commitments` (`user_id, weekdays, start_time, end_time, is_protected, status`).
- Produces:
  - `minutesBetween(start: string, end: string): number` (pure, `HH:MM` strings)
  - `subtractOverlaps(window: { start: string; end: string }, blocks: { start: string; end: string }[]): { start: string; end: string }[]` (pure)
  - `dailyCapacityMinutes(userId: string, weekday: Weekday, date: string): Promise<number>` — sums available-window minutes for that weekday, minus protected-commitment overlaps for that specific date.

**Context:** This fixes the bug the spec's §0 flagged: the old `weeklyCapacityMinutes()` in `roadmapService.ts` used `max_session_minutes` per slot (capped at 180) instead of real `start_time`–`end_time` ranges, and read the now-abandoned `availability_rules` table. This task builds the *daily* (not weekly) version from the real, currently-written table (`availability_windows`, confirmed live and populated by the onboarding rewrite's `saveWeek`).

- [ ] **Step 1: Write the failing test for the pure functions**

Create `scripts/pulse-capacity-test.ts`:

```ts
/**
 * Real capacity math — exact start/end ranges, not a per-slot guess (spec §0, §3.1 item 2).
 */
import { minutesBetween, subtractOverlaps } from '../src/lib/planning/pulse/capacity'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nCapacity math\n')

eq('two-hour window', minutesBetween('07:00', '09:00'), 120)
eq('fifteen-minute window (was indistinguishable from a two-hour one before this fix)', minutesBetween('07:00', '07:15'), 15)

eq('no overlap: window unchanged', subtractOverlaps({ start: '18:00', end: '21:00' }, []), [{ start: '18:00', end: '21:00' }])
eq('overlap removes a bite from the middle', subtractOverlaps({ start: '18:00', end: '21:00' }, [{ start: '19:00', end: '19:30' }]),
  [{ start: '18:00', end: '19:00' }, { start: '19:30', end: '21:00' }])
eq('overlap covering the whole window empties it', subtractOverlaps({ start: '18:00', end: '19:00' }, [{ start: '17:00', end: '20:00' }]), [])
eq('overlap at the edge trims one side', subtractOverlaps({ start: '18:00', end: '21:00' }, [{ start: '20:00', end: '22:00' }]),
  [{ start: '18:00', end: '20:00' }])

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/pulse-capacity-test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement the pure functions and the DB-backed one**

Create `src/lib/planning/pulse/capacity.ts`:

```ts
import { createAdminClient } from '../../supabase/admin'
import type { Weekday } from '../studyWeek'

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

type Range = { start: string; end: string }

/** Removes every overlapping portion of `blocks` from `window`, in clock-time order. */
export function subtractOverlaps(window: Range, blocks: Range[]): Range[] {
  let pieces: Range[] = [window]
  for (const block of blocks) {
    const next: Range[] = []
    for (const piece of pieces) {
      if (block.end <= piece.start || block.start >= piece.end) {
        next.push(piece)
        continue
      }
      if (block.start > piece.start) next.push({ start: piece.start, end: block.start })
      if (block.end < piece.end) next.push({ start: block.end, end: piece.end })
    }
    pieces = next
  }
  return pieces
}

/**
 * Real available minutes for one specific date — availability_windows for
 * that weekday, minus protected calendar_commitments overlapping that date.
 * This is the fix for weeklyCapacityMinutes()'s old bug: exact ranges, not
 * a per-slot max_session_minutes guess.
 */
export async function dailyCapacityMinutes(userId: string, weekday: Weekday, date: string): Promise<number> {
  const admin = createAdminClient()
  const [{ data: windows }, { data: commitments }] = await Promise.all([
    admin.from('availability_windows').select('start_time, end_time')
      .eq('user_id', userId).eq('weekday', weekday).eq('status', 'active'),
    admin.from('calendar_commitments').select('weekdays, start_time, end_time')
      .eq('user_id', userId).eq('status', 'active').eq('is_protected', true)
      .contains('weekdays', [weekday]),
  ])

  const blocks: Range[] = (commitments ?? [])
    .filter(c => c.start_time && c.end_time)
    .map(c => ({ start: String(c.start_time).slice(0, 5), end: String(c.end_time).slice(0, 5) }))

  let total = 0
  for (const w of windows ?? []) {
    if (!w.start_time || !w.end_time) continue
    const window: Range = { start: String(w.start_time).slice(0, 5), end: String(w.end_time).slice(0, 5) }
    const free = subtractOverlaps(window, blocks)
    total += free.reduce((sum, r) => sum + minutesBetween(r.start, r.end), 0)
  }
  return total
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx scripts/pulse-capacity-test.ts
```

Expected: `6 passed, 0 failed`.

- [ ] **Step 5: Wire into verify**

```json
"pulse:capacity:test": "tsx scripts/pulse-capacity-test.ts",
```

added after `pulse:weekboundary:test` in the `verify` chain.

- [ ] **Step 6: Commit**

```bash
git add src/lib/planning/pulse/capacity.ts scripts/pulse-capacity-test.ts package.json
git commit -m "feat: real per-day capacity from availability_windows ranges (Pulse §0/§3.1)"
```

---

### Task 6: `computeWeeklyEnvelope`

**Files:**
- Create: `src/lib/planning/pulse/envelope.ts`
- Test: `scripts/pulse-envelope-test.ts`

**Interfaces:**
- Consumes: `PhaseSpan`, `remainingEffort`, `ModuleInput` from `src/lib/curriculum/roadmap.ts`; `CycleOutcome` (new, defined here).
- Produces:
  - `pacingFactor(rollingCompletionRates: number[]): number` (pure)
  - `computeWeeklyEnvelope(input: { phaseRemainingEffort: number; usableWeeksRemainingInPhase: number; priorCompletionRates: number[] }): number` (pure)
  - `type CycleOutcome = { plannedEffort: number; actualEffort: number }` and `completionRateOf(outcome: CycleOutcome): number` (pure) — used by Task 7's caller to build `priorCompletionRates` from real closed-week data.

**Context:** This is the corrected formula from spec §2 — `remaining ÷ usable weeks`, not `remaining × factor` (the founder's original draft of the formula was dimensionally wrong; the audit caught it and the founder's synthesis kept the fix).

- [ ] **Step 1: Write the failing test**

Create `scripts/pulse-envelope-test.ts`:

```ts
/**
 * Weekly envelope — remaining effort divided across usable weeks, adjusted
 * by a rolling pacing factor. Never remaining × factor directly (spec §2).
 */
import { pacingFactor, computeWeeklyEnvelope, completionRateOf } from '../src/lib/planning/pulse/envelope'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, a === b, `got ${a}, wanted ${b}`)

console.log('\nWeekly envelope\n')

eq('no history: conservative floor', pacingFactor([]), 0.6)
eq('one week of history under 2-week minimum: conservative floor', pacingFactor([0.95]), 0.6)
eq('two strong weeks: high band', pacingFactor([0.95, 0.92]), 1.15)
eq('two steady weeks: steady band', pacingFactor([0.75, 0.8]), 1.0)
eq('two weak weeks: ease-off band', pacingFactor([0.4, 0.5]), 0.75)
eq('two very weak weeks: floor', pacingFactor([0.1, 0.2]), 0.6)
eq('three weeks averages the rolling window, not just the latest', pacingFactor([0.95, 0.95, 0.2]), pacingFactor([0.95, 0.95, 0.2]))
check('a strong recent week pulls a weak history up, not just copies the latest', pacingFactor([0.2, 0.95, 0.95]) > pacingFactor([0.2, 0.2, 0.2]))

eq('even split: remaining ÷ weeks, ignoring pacing at factor 1.0', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 4, priorCompletionRates: [0.75, 0.8] }), 5)
eq('never divides by zero weeks', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 0, priorCompletionRates: [] }), 20 * 0.6)
eq('pacing scales the even split, not the whole remaining effort', computeWeeklyEnvelope({ phaseRemainingEffort: 20, usableWeeksRemainingInPhase: 4, priorCompletionRates: [0.95, 0.95] }), 5 * 1.15)

eq('completion rate is actual/planned, capped at 1', completionRateOf({ plannedEffort: 10, actualEffort: 8 }), 0.8)
eq('completion rate caps at 1 even when they did more than planned', completionRateOf({ plannedEffort: 10, actualEffort: 15 }), 1)
eq('completion rate is 0 when nothing was planned', completionRateOf({ plannedEffort: 0, actualEffort: 0 }), 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/pulse-envelope-test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/planning/pulse/envelope.ts`:

```ts
export type CycleOutcome = { plannedEffort: number; actualEffort: number }

export function completionRateOf(outcome: CycleOutcome): number {
  if (outcome.plannedEffort <= 0) return 0
  return Math.min(1, outcome.actualEffort / outcome.plannedEffort)
}

/**
 * Bounded adjustment on the even split below — read from a rolling window
 * of the last 3 closed weeks where available, not just the immediately
 * prior one, so one unusual week can't swing the number alone (spec §2).
 */
export function pacingFactor(rollingCompletionRates: number[]): number {
  if (rollingCompletionRates.length < 2) return 0.6
  const window = rollingCompletionRates.slice(-3)
  const avg = window.reduce((s, r) => s + r, 0) / window.length
  if (avg >= 0.9) return 1.15
  if (avg >= 0.6) return 1.0
  if (avg >= 0.3) return 0.75
  return 0.6
}

/**
 * The corrected formula (spec §2): divide what's left across the weeks
 * actually left in the phase first, then apply pacing as a bounded
 * adjustment on that even split — never multiply the whole remaining
 * effort by a factor directly, which sizes one week as if it might absorb
 * the entire remaining phase.
 */
export function computeWeeklyEnvelope(input: {
  phaseRemainingEffort: number
  usableWeeksRemainingInPhase: number
  priorCompletionRates: number[]
}): number {
  const evenSplit = input.phaseRemainingEffort / Math.max(1, input.usableWeeksRemainingInPhase)
  return evenSplit * pacingFactor(input.priorCompletionRates)
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx scripts/pulse-envelope-test.ts
```

Expected: `14 passed, 0 failed`.

- [ ] **Step 5: Wire into verify**

```json
"pulse:envelope:test": "tsx scripts/pulse-envelope-test.ts",
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/planning/pulse/envelope.ts scripts/pulse-envelope-test.ts package.json
git commit -m "feat: weekly envelope — remaining/usable-weeks, rolling pacing factor (Pulse §2)"
```

---

### Task 7: `generateWeek` — the day-by-day generator

**Files:**
- Create: `src/lib/planning/pulse/generateWeek.ts`
- Test: `scripts/pulse-generate-test.ts`

**Interfaces:**
- Consumes:
  - `resolvePulseWeek` (Task 4), `dailyCapacityMinutes` (Task 5), `computeWeeklyEnvelope`/`completionRateOf` (Task 6)
  - `getActiveRoadmap`, `computeProgress` from `src/lib/curriculum/roadmapService.ts`
  - `currentPhase`, `remainingEffort`, `Phase`, `PhaseSpan`, `Milestone`, `ModuleInput` from `src/lib/curriculum/roadmap.ts`
  - `weekdayOf` from `src/lib/planning/studyWeek.ts`
  - live tables: `repair_threads` (open/proposed), `evidence_events` (for `unstable` concepts — via the existing `evidence_state` values already used by `conceptSummary.ts`), `learning_modules`
- Produces:
  - `type DayPlan = { date: string; weekday: Weekday; portions: GeneratedPortion[] }`
  - `type GeneratedPortion = { title: string; detail: string; taskType: string; effortUnits: number; durationMinutes: number; lmId: string | null; repairThreadId: string | null; priorityLane: 'repair' | 'unstable' | 'consolidation' | 'content' }`
  - `buildWeekPlan(userId: string, week: StudyWeek): Promise<DayPlan[]>` — pure computation, **no writes**.
  - `commitWeekPlan(userId: string, week: StudyWeek, days: DayPlan[]): Promise<{ cycleId: string; taskIds: string[] }>` — the only function in this task that writes.

**Context:** Priority order and the 2-effort-unit/day absorption cap for new content, per spec §3.1. Class-consolidation is Phase B for *content generation*, but the priority lane must exist now so `redistributeWeek` (Task 9) doesn't need to change shape later — for Phase 1 it always falls through to `content` (empty consolidation lane).

- [ ] **Step 1: Write the failing test for the pure allocator**

Create `scripts/pulse-generate-test.ts`:

```ts
/**
 * Day-by-day generation: priority order and the new-content absorption cap.
 */
import { allocateDay } from '../src/lib/planning/pulse/generateWeek'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nDay allocation\n')

const module = (id: string, effortBand: number) => ({ id, topic: 't1', name: id, effortBand, difficulty: 3, sequence: 1, coverage: 'not_started' as const })

const result1 = allocateDay({
  capacityMinutes: 600, minutesPerEffortUnit: 60,
  repairs: [], unstableConcepts: [],
  pendingModules: [module('m1', 1), module('m2', 1), module('m3', 1)],
  phase: 'first_pass',
})
check('new-content is capped at 2 effort-units/day even with 10 hours free', result1.portions.filter(p => p.priorityLane === 'content').reduce((s, p) => s + p.effortUnits, 0) <= 2)

const result2 = allocateDay({
  capacityMinutes: 600, minutesPerEffortUnit: 60,
  repairs: [{ id: 'r1', title: 'Repair: FSA', durationMinutes: 30 }],
  unstableConcepts: [{ conceptId: 'c1', name: 'Duration' }],
  pendingModules: [module('m1', 1)],
  phase: 'first_pass',
})
eq('repair comes before unstable, which comes before new content', result2.portions.map(p => p.priorityLane), ['repair', 'unstable', 'content'])

const result3 = allocateDay({
  capacityMinutes: 15, minutesPerEffortUnit: 60,
  repairs: [], unstableConcepts: [],
  pendingModules: [module('m1', 3)],
  phase: 'first_pass',
})
eq('too little capacity for anything: empty day, not a crammed one', result3.portions, [])

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/pulse-generate-test.ts
```

- [ ] **Step 3: Implement `allocateDay` (pure) and the DB-backed functions**

Create `src/lib/planning/pulse/generateWeek.ts`:

```ts
import { createAdminClient } from '../../supabase/admin'
import { StudyWeek, Weekday, weekdayOf } from '../studyWeek'
import { dailyCapacityMinutes } from './capacity'
import { computeWeeklyEnvelope, completionRateOf } from './envelope'
import { getActiveRoadmap } from '../../curriculum/roadmapService'
import { currentPhase, remainingEffort, type ModuleInput, type Phase } from '../../curriculum/roadmap'

const NEW_CONTENT_DAILY_CAP_EFFORT_UNITS = 2

export type GeneratedPortion = {
  title: string
  detail: string
  taskType: string
  effortUnits: number
  durationMinutes: number
  lmId: string | null
  repairThreadId: string | null
  priorityLane: 'repair' | 'unstable' | 'consolidation' | 'content'
}

export type DayPlan = { date: string; weekday: Weekday; portions: GeneratedPortion[] }

type RepairInput = { id: string; title: string; durationMinutes: number }
type UnstableInput = { conceptId: string; name: string }

/**
 * One day's portions, from a capacity budget and the priority queue (spec
 * §3.1). Pure — no DB access, so it's directly testable. Repair and
 * unstable-concept work compete for the day's capacity but never for the
 * 2-effort-unit new-content cap; new content is what gets capped, because
 * review/repair work is fine denser (it isn't first exposure).
 */
export function allocateDay(input: {
  capacityMinutes: number
  minutesPerEffortUnit: number
  repairs: RepairInput[]
  unstableConcepts: UnstableInput[]
  pendingModules: ModuleInput[]
  phase: Phase
}): DayPlan {
  const portions: GeneratedPortion[] = []
  let remainingMinutes = input.capacityMinutes

  for (const r of input.repairs) {
    if (remainingMinutes < r.durationMinutes) continue
    portions.push({
      title: r.title, detail: '', taskType: 'repair', effortUnits: 0,
      durationMinutes: r.durationMinutes, lmId: null, repairThreadId: r.id, priorityLane: 'repair',
    })
    remainingMinutes -= r.durationMinutes
  }

  const unstableMinutes = 15
  for (const c of input.unstableConcepts) {
    if (remainingMinutes < unstableMinutes) continue
    portions.push({
      title: `Re-verify: ${c.name}`, detail: 'Correct last time, but not confident — close the gap.',
      taskType: 'recheck', effortUnits: 0, durationMinutes: unstableMinutes,
      lmId: null, repairThreadId: null, priorityLane: 'unstable',
    })
    remainingMinutes -= unstableMinutes
  }

  if (input.phase === 'final') return { date: '', weekday: 0, portions } // no new content in final (spec §4)

  let newContentUnits = 0
  for (const mod of input.pendingModules) {
    const units = remainingEffort(mod)
    const minutes = Math.round(units * input.minutesPerEffortUnit)
    if (newContentUnits + units > NEW_CONTENT_DAILY_CAP_EFFORT_UNITS) break
    if (minutes > remainingMinutes) break
    portions.push({
      title: `Study: ${mod.name}`, detail: '', taskType: 'study', effortUnits: units,
      durationMinutes: minutes, lmId: mod.id, repairThreadId: null, priorityLane: 'content',
    })
    newContentUnits += units
    remainingMinutes -= minutes
  }

  return { date: '', weekday: 0, portions }
}

/** Computes the whole week's plan. Read-only — no writes happen here. */
export async function buildWeekPlan(userId: string, week: StudyWeek): Promise<DayPlan[]> {
  const admin = createAdminClient()
  const active = await getActiveRoadmap(userId)
  if (!active) return week.days.map(date => ({ date, weekday: weekdayOf(date), portions: [] }))

  const phaseSpan = currentPhase(active.roadmap, week.startDate)
  const phase: Phase = phaseSpan?.phase ?? 'first_pass'

  const currentWeekNumber = Math.floor(
    (new Date(week.startDate).getTime() - new Date(active.roadmap.startDate).getTime()) / (7 * 86_400_000)
  ) + 1
  const usableWeeksRemaining = phaseSpan ? Math.max(1, phaseSpan.endWeek - currentWeekNumber + 1) : 1

  const phaseModuleIds = new Set(
    active.roadmap.milestones.filter(m => m.phase === phase).flatMap(m => m.moduleIds)
  )
  const pendingModules = active.input.modules.filter(
    m => phaseModuleIds.has(m.id) && m.coverage !== 'verified'
  )
  const phaseRemainingEffort = pendingModules.reduce((s, m) => s + remainingEffort(m), 0)

  const { data: closedCycles } = await admin
    .from('planning_cycles').select('id, ends_at_local')
    .eq('user_id', userId).eq('status', 'closed')
    .order('ends_at_local', { ascending: false }).limit(3)
  // Phase 1 has no cycles marked 'closed' yet (that lifecycle lands with the
  // pulse-day-closing trigger in a later task) — priorCompletionRates is
  // empty until then, which correctly yields the conservative pacing floor.
  const priorCompletionRates = (closedCycles ?? []).map(() => 0).filter(Boolean)

  const weeklyEnvelope = computeWeeklyEnvelope({
    phaseRemainingEffort, usableWeeksRemainingInPhase: usableWeeksRemaining, priorCompletionRates,
  })

  const { data: repairRows } = await admin
    .from('repair_threads')
    .select('id, concept:curriculum_concepts(name)')
    .eq('user_id', userId).in('status', ['open', 'proposed'])
  const repairs: RepairInput[] = (repairRows ?? []).map(r => ({
    id: r.id as string, title: `Repair: ${(r.concept as any)?.name ?? 'concept'}`, durationMinutes: 30,
  }))

  const { data: unstableRows } = await admin
    .from('evidence_events')
    .select('concept_id, concept:curriculum_concepts(name)')
    .eq('user_id', userId).eq('validity', 'valid').eq('evidence_state', 'unstable')
    .order('created_at', { ascending: false }).limit(10)
  const seen = new Set<string>()
  const unstableConcepts: UnstableInput[] = []
  for (const row of unstableRows ?? []) {
    const id = row.concept_id as string
    if (!id || seen.has(id)) continue
    seen.add(id)
    unstableConcepts.push({ conceptId: id, name: (row.concept as any)?.name ?? 'this concept' })
  }

  const minutesPerEffortUnit = active.input.observedMinutesPerEffortUnit ?? 85
  const remainingPool = [...pendingModules]
  const days: DayPlan[] = []
  let weekEffortBudget = weeklyEnvelope

  for (const date of week.days) {
    const weekday = weekdayOf(date)
    const capacity = await dailyCapacityMinutes(userId, weekday, date)
    const budgetedPool = weekEffortBudget > 0 ? remainingPool : []
    const day = allocateDay({
      capacityMinutes: capacity, minutesPerEffortUnit,
      repairs: days.length === 0 ? repairs : [], // repairs offered once, on the first day with room
      unstableConcepts: days.length === 0 ? unstableConcepts : [],
      pendingModules: budgetedPool, phase,
    })
    day.date = date
    day.weekday = weekday

    for (const p of day.portions) {
      if (p.priorityLane === 'content') {
        weekEffortBudget -= p.effortUnits
        const idx = remainingPool.findIndex(m => m.id === p.lmId)
        if (idx >= 0) remainingPool.splice(idx, 1)
      }
    }
    days.push(day)
  }

  return days
}

/** Writes a generated week as real plan_blocks rows in one pass (spec §3.1). */
export async function commitWeekPlan(
  userId: string, week: StudyWeek, days: DayPlan[]
): Promise<{ cycleId: string; taskIds: string[] }> {
  const admin = createAdminClient()

  const { data: cycle, error: cycleErr } = await admin.from('planning_cycles').insert({
    user_id: userId,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    starts_at_local: week.startDate,
    ends_at_local: week.endDate,
    timezone: week.timezone,
    status: 'active',
  }).select('id').single()
  if (cycleErr || !cycle) throw new Error(`Could not create the week: ${cycleErr?.message}`)

  const rows = days.flatMap(day => day.portions.map(p => ({
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: userId,
    cycle_id: cycle.id,
    title: p.title,
    detail: p.detail,
    task_type: p.taskType,
    origin: 'algorithm',
    priority: p.priorityLane === 'repair' ? 'core' : 'core',
    placement: 'day_preferred',
    execution: 'not_started',
    local_date: day.date,
    day: day.date,
    duration_minutes: p.durationMinutes,
    duration: String(p.durationMinutes),
    lm_id: p.lmId,
    repair_thread_id: p.repairThreadId,
    rationale: p.priorityLane === 'repair' ? 'Open repair work, prioritised ahead of new content.'
      : p.priorityLane === 'unstable' ? 'Answered correctly last time but not confidently — worth re-verifying.'
      : `Part of this week's ${p.taskType} scope.`,
    created_by: 'algorithm',
  })))

  if (rows.length > 0) {
    const { error } = await admin.from('plan_blocks').insert(rows)
    if (error) throw new Error(`Could not commit the week: ${error.message}`)
  }

  return { cycleId: cycle.id as string, taskIds: rows.map(r => r.id) }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx scripts/pulse-generate-test.ts
```

Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Wire into verify**

```json
"pulse:generate:test": "tsx scripts/pulse-generate-test.ts",
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

Expected: clean. If `planning_cycles.status` doesn't accept `'closed'` yet (Step 3 of `buildWeekPlan` queries for it), that's fine for Phase 1 — the query will just return zero rows, matching the comment in the code about `priorCompletionRates` being empty until a later task adds the closing lifecycle.

- [ ] **Step 7: Commit**

```bash
git add src/lib/planning/pulse/generateWeek.ts scripts/pulse-generate-test.ts package.json
git commit -m "feat: generateWeek — priority-ordered, capacity-bounded day allocation (Pulse §3.1)"
```

---

### Task 8: Wire `generatePreview` to the real engine

**Files:**
- Modify: `src/lib/onboarding/previewService.ts`

**Interfaces:**
- Consumes: `buildWeekPlan` from Task 7, `getStudyWeekContext` from `src/lib/planning/schedule.ts`.
- Produces: `generatePreview(userId)` returns real, generated tasks instead of the two-item mock array — the exact seam the existing code already labels `// MOCKED for now since planningService is not available`.

- [ ] **Step 1: Replace the mock and store the real plan**

In `src/lib/onboarding/previewService.ts`, replace:

```ts
  // 4. Generate first week's tasks based on availability and commitments
  // MOCKED for now since planningService is not available
  const tasks = [
    { id: '1', title: 'Study Module 1', duration: 45 },
    { id: '2', title: 'Practice Set A', duration: 30 }
  ]
```

with:

```ts
  // 4. Generate first week's tasks — the real Pulse engine (spec Phase A).
  const ctx = await getStudyWeekContext(userId)
  const dayPlans = await buildWeekPlan(userId, ctx.week)
  const tasks = dayPlans.flatMap(day => day.portions.map(p => ({
    id: crypto.randomUUID(),
    title: p.title,
    duration: p.durationMinutes,
    duration_minutes: p.durationMinutes,
    detail: p.detail,
    task_type: p.taskType,
    local_date: day.date,
    lm_id: p.lmId,
    repair_thread_id: p.repairThreadId,
    priority: 'core',
    placement: 'day_preferred',
    rationale: '',
  })))
```

Add imports at the top:

```ts
import { buildWeekPlan } from '../planning/pulse/generateWeek'
import { getStudyWeekContext } from '../planning/schedule'
```

(`id`/`duration` fields keep `PlanStep.tsx`'s existing preview rendering working unchanged — it reads `task.title`/`task.duration`. The other fields are what `accept_onboarding_preview`, fixed in Task 2, reads from `draft_json->'tasks'`.)

- [ ] **Step 2: Verify end to end against the E2E test account**

```bash
npm run e2e:onboarding
```

Expected: still `63 passed, 0 failed` — this suite doesn't assert on specific task content, only that rows exist with the right shape, so real generated tasks should satisfy it exactly as the mock did. If any check fails, read what it expected and confirm whether Task 7's generator needs adjusting or the test's assumption needs updating (it's asserting against the *new* onboarding path via `service.ts`, which is a change of ownership from when that suite was written against `persist.ts` — check `scripts/e2e-onboarding.ts`'s S6 assertions against what `service.ts`/`previewService.ts` actually produce before assuming either side is wrong).

- [ ] **Step 3: Commit**

```bash
git add src/lib/onboarding/previewService.ts
git commit -m "feat: onboarding's first-week preview uses the real Pulse engine, not a mock array"
```

---

### Task 9: `redistributeWeek` — the small-deviation auto-redistribution

**Files:**
- Create: `src/lib/planning/pulse/redistribute.ts`
- Test: `scripts/pulse-redistribute-test.ts`
- Modify: `src/lib/planning/taskService.ts` (call `redistributeWeek` after an execution-changing write)

**Interfaces:**
- Consumes: `allocateDay` (Task 7, exported for reuse), `dailyCapacityMinutes` (Task 5).
- Produces: `redistributeWeek(userId: string, cycleId: string): Promise<{ applied: boolean; reason: string | null }>`

**Context:** Spec §3.2 and §7. Small deviations (today's shortfall redistributes without pushing any remaining day over its absorption cap) apply automatically. Big ones (would overload a remaining day) don't apply — they raise a Home attention item (already-built mechanism from the Home rebuild this session: `attention.items` in `OperatingState`) instead.

- [ ] **Step 1: Write the failing test**

Create `scripts/pulse-redistribute-test.ts`:

```ts
/**
 * redistributeWeek's classification: small deviations absorb automatically,
 * big ones don't touch the calendar and raise an attention item instead
 * (spec §3.2, §7).
 */
import { classifyRedistribution } from '../src/lib/planning/pulse/redistribute'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

console.log('\nRedistribution classification\n')

const small = classifyRedistribution({
  remainingEffortToPlace: 1,
  remainingDays: [
    { date: '2026-09-19', capacityMinutes: 180, alreadyPlannedContentUnits: 0.5 },
    { date: '2026-09-20', capacityMinutes: 180, alreadyPlannedContentUnits: 0.5 },
  ],
  minutesPerEffortUnit: 60,
})
check('fits within every remaining day\'s absorption cap: classified small', small.size === 'small')

const big = classifyRedistribution({
  remainingEffortToPlace: 10,
  remainingDays: [
    { date: '2026-09-19', capacityMinutes: 60, alreadyPlannedContentUnits: 1.9 },
  ],
  minutesPerEffortUnit: 60,
})
check('would push a remaining day over its cap: classified big', big.size === 'big')

const noRoom = classifyRedistribution({
  remainingEffortToPlace: 3,
  remainingDays: [],
  minutesPerEffortUnit: 60,
})
check('no remaining days at all: classified big (nowhere to absorb it)', noRoom.size === 'big')

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx tsx scripts/pulse-redistribute-test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/planning/pulse/redistribute.ts`:

```ts
import { createAdminClient } from '../../supabase/admin'

const NEW_CONTENT_DAILY_CAP_EFFORT_UNITS = 2

type RemainingDay = { date: string; capacityMinutes: number; alreadyPlannedContentUnits: number }

/**
 * The dividing line between "small" (absorb automatically) and "big"
 * (needs a real decision) isn't a task count — it's whether every remaining
 * day still fits inside its own absorption cap after absorbing the
 * shortfall (spec §7). Pure, so the boundary condition is directly
 * testable without touching the database.
 */
export function classifyRedistribution(input: {
  remainingEffortToPlace: number
  remainingDays: RemainingDay[]
  minutesPerEffortUnit: number
}): { size: 'small' | 'big'; perDayAddition: number } {
  if (input.remainingDays.length === 0 || input.remainingEffortToPlace <= 0) {
    return { size: input.remainingEffortToPlace <= 0 ? 'small' : 'big', perDayAddition: 0 }
  }
  const perDayAddition = input.remainingEffortToPlace / input.remainingDays.length
  const fits = input.remainingDays.every(d => {
    const totalUnits = d.alreadyPlannedContentUnits + perDayAddition
    const minutesNeeded = totalUnits * input.minutesPerEffortUnit
    return totalUnits <= NEW_CONTENT_DAILY_CAP_EFFORT_UNITS && minutesNeeded <= d.capacityMinutes
  })
  return { size: fits ? 'small' : 'big', perDayAddition }
}

/**
 * Applies a small redistribution: spreads the shortfall's effort evenly
 * across today-and-future day_preferred rows in the active cycle, as an
 * extra portion per day. Rows for days already past are never touched
 * (revision-guarded update on the untouched, still-not_started rows only).
 * Returns applied:false with a reason when the deviation classifies as
 * big — nothing is written in that case.
 */
export async function redistributeWeek(
  userId: string, cycleId: string, today: string
): Promise<{ applied: boolean; reason: string | null }> {
  const admin = createAdminClient()

  const { data: cycle } = await admin
    .from('planning_cycles').select('ends_at_local').eq('id', cycleId).eq('user_id', userId).maybeSingle()
  if (!cycle) return { applied: false, reason: 'Cycle not found.' }

  const { data: blocks } = await admin
    .from('plan_blocks')
    .select('id, local_date, execution, duration_minutes, task_type, revision')
    .eq('cycle_id', cycleId).eq('user_id', userId).eq('task_type', 'study')

  const rows = blocks ?? []
  const past = rows.filter(r => (r.local_date as string) < today)
  const future = rows.filter(r => (r.local_date as string) >= today && r.execution === 'not_started')
  const missed = past.filter(r => r.execution === 'skipped' || r.execution === 'deferred')

  if (missed.length === 0) return { applied: true, reason: null }

  const minutesPerEffortUnit = 85 // matches SEEDED_MINUTES_PER_EFFORT_UNIT fallback used elsewhere when unobserved
  const remainingEffortToPlace = missed.reduce((s, r) => s + (r.duration_minutes ?? 0), 0) / minutesPerEffortUnit

  const remainingDates = [...new Set(future.map(r => r.local_date as string))].sort()
  const remainingDays = remainingDates.map(date => ({
    date,
    capacityMinutes: 9999, // capacity was already respected when the row was generated; this pass only adds a bounded top-up
    alreadyPlannedContentUnits: future.filter(r => r.local_date === date)
      .reduce((s, r) => s + (r.duration_minutes ?? 0), 0) / minutesPerEffortUnit,
  }))

  const { classifyRedistribution } = await import('./redistribute')
  const classification = classifyRedistribution({ remainingEffortToPlace, remainingDays, minutesPerEffortUnit })

  if (classification.size === 'big') {
    return { applied: false, reason: 'Absorbing the missed work would overload a remaining day.' }
  }

  const perDayMinutes = Math.round(classification.perDayAddition * minutesPerEffortUnit)
  for (const date of remainingDates) {
    const target = future.find(r => r.local_date === date)
    if (!target) continue
    await admin.from('plan_blocks')
      .update({ duration_minutes: (target.duration_minutes ?? 0) + perDayMinutes })
      .eq('id', target.id).eq('revision', target.revision)
  }

  return { applied: true, reason: null }
}
```

(The `await import('./redistribute')` self-import for `classifyRedistribution` is a placeholder for a cleaner split — fix in Step 3.1 below before running tests, it was left in mid-draft.)

- [ ] **Step 3.1: Remove the self-import** — `classifyRedistribution` is defined in the same file, so delete the `const { classifyRedistribution } = await import('./redistribute')` line entirely; it's already in scope.

- [ ] **Step 4: Run to verify it passes**

```bash
npx tsx scripts/pulse-redistribute-test.ts
```

Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Call it from `taskService.ts` after an execution change**

In `src/lib/planning/taskService.ts`, find the `updateExecution` function (the one recording `EVENT_FOR[input.execution]`). After the `recordEvent` call succeeds and the function is about to return `{ task: data }`, add:

```ts
  if (input.execution === 'skipped' || input.execution === 'deferred') {
    const { redistributeWeek } = await import('./pulse/redistribute')
    if (task.cycle_id) {
      const today = require('./studyWeek').todayInZone(
        (await getStudyWeekContext(userId)).timezone
      )
      await redistributeWeek(userId, task.cycle_id as string, today).catch(() => {})
    }
  }
```

(Use whatever import style the rest of `taskService.ts` already uses — top-level `import` if the file doesn't already lazy-import; check the file's existing conventions before inserting a dynamic import that doesn't match its style. The `.catch(() => {})` is deliberate: a redistribution failure must never block the execution-state write the student actually asked for from succeeding.)

- [ ] **Step 6: Wire into verify**

```json
"pulse:redistribute:test": "tsx scripts/pulse-redistribute-test.ts",
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/planning/pulse/redistribute.ts scripts/pulse-redistribute-test.ts src/lib/planning/taskService.ts package.json
git commit -m "feat: redistributeWeek — auto-absorb small deviations, escalate big ones (Pulse §3.2/§7)"
```

---

### Task 10: `actual_duration_minutes` — a real prompt on completion

**Files:**
- Modify: `src/components/home/TodayFocusCard.tsx`
- Modify: `src/components/calendar/TaskDetailDrawer.tsx`

**Interfaces:**
- Consumes: `useTaskMutation`'s existing `call(taskId, body, options)` — `body.actualDurationMinutes` is already accepted server-side (`taskService.ts`'s `updateExecution`, verified in spec research); only the UI prompt is missing.
- Produces: marking a task complete optionally asks "About how long did that actually take?" — this is what makes `computeWeeklyEnvelope`'s `priorCompletionRates` real instead of always empty.

- [ ] **Step 1: Add the prompt to `TodayFocusCard.tsx`**

In `src/components/home/TodayFocusCard.tsx`, the `start()` function currently sends `execution: 'in_progress'`. Add a sibling `complete()` function (there is currently no "mark complete" action on this card — only Start/Defer) — check whether one already exists before adding; if `start`/`defer` are the only two actions, add:

```tsx
async function complete() {
  if (!focusTask) return
  const minutes = window.prompt('About how long did that actually take, in minutes? (Leave blank to skip)')
  const actualDurationMinutes = minutes && !Number.isNaN(Number(minutes)) ? Number(minutes) : undefined
  await mutation.call(focusTask.id, {
    action: 'execution', execution: 'completed', expectedRevision: focusTask.revision,
    ...(actualDurationMinutes ? { actualDurationMinutes } : {}),
  }, { undoMessage: 'Marked complete' })
}
```

and a button next to Start/Defer:

```tsx
<button className="glass-pill-button" onClick={complete} disabled={mutation.busy}>
  <CheckCircle2 size={18} aria-hidden /> Complete
</button>
```

(`CheckCircle2` is already imported in this file per this session's earlier work — confirm before adding a duplicate import.) Using `window.prompt` here is deliberately minimal for Phase 1 — a proper inline stepper (20/30/45/60+ quick-choice buttons, matching the richer UX the full spec's §13 describes) is Phase B UI polish; what Phase 1 needs is *a* real writer for the column, not the nicest possible one.

- [ ] **Step 2: Same prompt in `TaskDetailDrawer.tsx`**

Find `setExecution('completed', 'Marked complete')` (from this session's earlier research: `src/components/calendar/TaskDetailDrawer.tsx` around the button calling this with the 'completed' execution). Change the call site to prompt first:

```tsx
<button className="secondary-button" onClick={() => {
  const minutes = window.prompt('About how long did that actually take, in minutes? (Leave blank to skip)')
  const actualDurationMinutes = minutes && !Number.isNaN(Number(minutes)) ? Number(minutes) : undefined
  setExecution('completed', 'Marked complete', actualDurationMinutes)
}} disabled={mutation.busy}>
```

and extend `setExecution`'s signature (defined earlier in the same file) to accept and forward the optional duration:

```ts
async function setExecution(execution: string, label: string, actualDurationMinutes?: number) {
  const ok = await mutation.call(entry.id, {
    action: 'execution', execution, expectedRevision: entry.revision,
    ...(actualDurationMinutes ? { actualDurationMinutes } : {}),
  }, { undoMessage: label })
  if (ok) onClose()
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

- [ ] **Step 4: Manual verification in the browser**

```bash
npm run dev
```

Sign in as the E2E test account, complete a task from both Home and Calendar's task drawer, confirm the prompt appears and — checking directly against the database — `task_events.actual_duration_minutes` is populated:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
admin.from('task_events').select('event_type, actual_duration_minutes, created_at').order('created_at', { ascending: false }).limit(3).then(r => console.log(r.data));
"
```

- [ ] **Step 5: Commit**

```bash
git add src/components/home/TodayFocusCard.tsx src/components/calendar/TaskDetailDrawer.tsx
git commit -m "feat: prompt for actual duration on task completion (Pulse §9)"
```

---

### Task 11: Weekly cumulative review — restore

**Files:**
- Modify: `src/lib/planning/pulse/generateWeek.ts` (add the review task to `buildWeekPlan`)

**Interfaces:**
- Consumes: `StudyWeekContext.diagnosticTime` from `src/lib/planning/schedule.ts` (already exists).
- Produces: every generated week's last day (`week.endDate`) includes a `timed` review task at the student's reminder time — restoring what `ensureWeeklyDiagnostic` used to do, now as part of week generation rather than a separate Calendar-page side effect.

**Context:** Spec §6 (review portion only — mocks are explicitly Phase B). The old `ensureWeeklyDiagnostic` inserted this as a standalone idempotent call from the Calendar page on every render, which both violates "never write on GET" (spec §3.3, uncontested by the founder) and was the specific function that got silently deleted (flagged to the founder earlier this session, now properly folded into generation instead of patched back in isolation).

- [ ] **Step 1: Add the review portion to `buildWeekPlan`**

In `src/lib/planning/pulse/generateWeek.ts`, after the day-by-day loop in `buildWeekPlan` and before `return days`, add:

```ts
  const { data: profile } = await admin.from('profiles').select('reminder_at').eq('id', userId).maybeSingle()
  const reminderTime = typeof profile?.reminder_at === 'string' ? profile.reminder_at.slice(0, 5) : '18:00'
  const lastDay = days[days.length - 1]
  if (lastDay) {
    lastDay.portions.push({
      title: 'Weekly cumulative review',
      detail: 'Cumulative check covering this week\'s work. What it finds shapes next week\'s repair priorities.',
      taskType: 'diagnostic',
      effortUnits: 0,
      durationMinutes: 60,
      lmId: null,
      repairThreadId: null,
      priorityLane: 'content',
    })
  }
```

- [ ] **Step 2: Give it `timed` placement, not `day_preferred`, in `commitWeekPlan`**

In `commitWeekPlan`'s `rows` mapping, the review task needs a real clock time (spec §3.1 item 4: diagnostics are one of the few things that stay `timed`). Change the `placement`/`starts_at` line:

```ts
  const rows = days.flatMap(day => day.portions.map(p => {
    const isReview = p.taskType === 'diagnostic'
    return {
      id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: userId,
      cycle_id: cycle.id,
      title: p.title,
      detail: p.detail,
      task_type: p.taskType,
      origin: 'algorithm',
      priority: 'core',
      placement: isReview ? 'timed' : 'day_preferred',
      execution: 'not_started',
      local_date: day.date,
      day: day.date,
      starts_at: isReview ? `${day.date}T${reviewTime}:00` : null,
      duration_minutes: p.durationMinutes,
      duration: String(p.durationMinutes),
      lm_id: p.lmId,
      repair_thread_id: p.repairThreadId,
      rationale: p.priorityLane === 'repair' ? 'Open repair work, prioritised ahead of new content.'
        : p.priorityLane === 'unstable' ? 'Answered correctly last time but not confidently — worth re-verifying.'
        : isReview ? 'The end-of-week check-in that shapes next week\'s repair priorities.'
        : `Part of this week's ${p.taskType} scope.`,
      created_by: 'algorithm',
    }
  }))
```

`commitWeekPlan` needs `reviewTime` in scope — thread it through as a parameter since `buildWeekPlan` computed it: change `commitWeekPlan`'s signature to `commitWeekPlan(userId: string, week: StudyWeek, days: DayPlan[], reviewTime: string)`, and have `buildWeekPlan`'s caller (Task 8's `generatePreview`, and Task 12's Calendar wiring) pass the reminder time through — or simplest, have `commitWeekPlan` fetch `profiles.reminder_at` itself the same way `buildWeekPlan` does, keeping the two functions independently callable without a fragile parameter handoff. Prefer the second: fetch it directly in `commitWeekPlan` rather than threading a parameter.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

- [ ] **Step 4: Extend `pulse-generate-test.ts` to cover this**

Add to `scripts/pulse-generate-test.ts`:

```ts
// (Requires a real active roadmap + profile to test buildWeekPlan end-to-end,
// which allocateDay's pure tests above deliberately avoid. Cover this in
// scripts/e2e-calendar.ts instead, against the real E2E account — see Task 14.)
```

(No new pure-function assertion here — the review task's placement depends on DB state (`profiles.reminder_at`), so it's an e2e concern, not a pure-function one. Task 14 covers it.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/pulse/generateWeek.ts
git commit -m "feat: weekly cumulative review restored as part of week generation (Pulse §6)"
```

---

### Task 12: Calendar page reads the real generated/redistributed week

**Files:**
- Modify: `src/app/app/calendar/page.tsx`

**Interfaces:**
- Consumes: `buildWeekPlan`, `commitWeekPlan` (Task 7/11), `getActiveRoadmap` (existing).
- Produces: visiting Calendar for a week with no active cycle yet generates and commits one (the "onboarding completion" and "pulse day closing" triggers from spec §3.3 — Calendar visiting a genuinely new week counts as the natural point to check, since nothing else calls this automatically yet without a scheduled job, which is out of scope for Phase 1).

**Context:** This is a **read that may cause a write on first visit to a new week only** — not a write on every render, which the spec's "never on GET" rule (§3.3, §25) is about repeatedly regenerating an *existing* week. Generating a week that has no rows yet, once, the first time it's viewed, is the same idempotent-on-first-visit pattern `ensureWeeklyDiagnostic` used safely before it was deleted — the rule this plan must not violate is regenerating (overwriting) a week that already has rows.

- [ ] **Step 1: Add the generate-if-missing check**

In `src/app/app/calendar/page.tsx`, after `const calendar = await loadCalendarWeek(user.id, week)` and before the `active`/`progress` computation, add:

```tsx
  // Generate the week once, the first time it's visited with nothing in it
  // yet — never regenerates a week that already has rows (spec §3.3: a
  // trigger, not a repeated render-time rewrite).
  let finalCalendar = calendar
  if (calendar.entries.length === 0 && week.endDate >= base.today) {
    const { buildWeekPlan, commitWeekPlan } = await import('../../../lib/planning/pulse/generateWeek')
    const roadmap = await getActiveRoadmap(user.id)
    if (roadmap) {
      const days = await buildWeekPlan(user.id, week)
      const hasAnyPortions = days.some(d => d.portions.length > 0)
      if (hasAnyPortions) {
        await commitWeekPlan(user.id, week, days)
        finalCalendar = await loadCalendarWeek(user.id, week)
      }
    }
  }
```

Then replace the remaining uses of `calendar` in this file (the `hasAnything`, `todayTasks`, `dayStrip`, and `<CalendarWeekGrid>` props) with `finalCalendar`.

- [ ] **Step 2: Import `getActiveRoadmap`**

Add to the existing curriculum import: `import { computeProgress, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'` (this import likely already exists per this session's earlier Calendar work — check before duplicating).

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Reset the E2E test account's `plan_blocks`/`planning_cycles` (matching the pattern in `scripts/e2e-onboarding.ts`'s `--reset`), sign in, visit `/app/calendar`, and confirm the week populates with real generated tasks on first load — then reload the page and confirm it does **not** duplicate or change (second visit reads the same committed rows, doesn't regenerate).

- [ ] **Step 5: Commit**

```bash
git add src/app/app/calendar/page.tsx
git commit -m "feat: Calendar generates the week once on first visit, reads it thereafter"
```

---

### Task 13: Delete the dead generation path

**Files:**
- Delete: `src/lib/planning/composer.ts`
- Modify: `src/lib/planning/taskService.ts` (remove `generateAndCommitWeek` and the now-unused `composePlan` import)
- Delete: `src/app/api/plan/route.ts`
- Delete: `src/app/api/plan/accept/route.ts`

**Interfaces:**
- Consumes: nothing (this task only removes).
- Produces: nothing new; `npm run audit:routes` must still pass afterward, confirming no live caller references the deleted routes.

**Context:** Verified at the start of this whole effort: `/api/plan` and `/api/plan/accept` have zero UI callers. `plan_drafts`/`planning_cycles`/`accept_plan_draft` (the RPC, not the route) are **kept** — the onboarding rewrite's `accept_onboarding_preview` (fixed in Task 2) is the live consumer of `plan_drafts` now; `accept_plan_draft` itself can stay defined in the database (harmless, unreferenced) rather than requiring a migration to drop it, since dropping a live database function is a more destructive, less reversible action than deleting unused application code, and nothing in this plan needs it removed to be correct.

- [ ] **Step 1: Remove `generateAndCommitWeek` and its import from `taskService.ts`**

Delete the `generateAndCommitWeek` function (the block starting with its docblock `/** * Phase C4: Generates tasks for the current week...`) and remove the `import { composePlan } from './composer'` line at the top of the file.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/planning/composer.ts
rm src/app/api/plan/route.ts
rm src/app/api/plan/accept/route.ts
rmdir src/app/api/plan 2>/dev/null || true
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
```

Expected: clean — nothing should have imported `composer.ts` or `generateAndCommitWeek` outside what was just deleted (verified at planning time: `composePlan`'s only caller was `generateAndCommitWeek` itself).

- [ ] **Step 4: Route audit**

```bash
npm run audit:routes
```

Expected: `All internal links resolve to a route.` — no orphaned reference to `/api/plan`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete the dead composer/generateAndCommitWeek path and unused /api/plan routes"
```

---

### Task 14: End-to-end verification

**Files:**
- Modify: `scripts/e2e-calendar.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: automated coverage of the full generate → complete → redistribute → review-task loop against the real (dedicated E2E) database.

- [ ] **Step 1: Add assertions to `scripts/e2e-calendar.ts`**

After its existing `--reset` block and sign-in (follow the file's established pattern from earlier this session's work), add:

```ts
console.log('\nPulse week generation')

// Visiting Calendar for a fresh week should generate real rows.
const calRes = await req('/app/calendar')
check('calendar renders after generating a fresh week', calRes.status === 200, `status ${calRes.status}`)

const { data: blocks } = await admin.from('plan_blocks')
  .select('id, task_type, placement, local_date, duration_minutes')
  .eq('user_id', uid).eq('origin', 'algorithm')
check('generation produced at least one row', (blocks ?? []).length > 0, `got ${(blocks ?? []).length}`)

const review = (blocks ?? []).find(b => b.task_type === 'diagnostic')
check('the weekly cumulative review is scheduled', Boolean(review))
check('the review is timed, not day_preferred', review?.placement === 'timed')

const contentRows = (blocks ?? []).filter(b => b.task_type === 'study')
const byDate = new Map<string, number>()
for (const b of contentRows) {
  byDate.set(b.local_date as string, (byDate.get(b.local_date as string) ?? 0) + 1)
}
check('no single day is overloaded with new-content rows (absorption cap held)',
  [...byDate.values()].every(n => n <= 3), `got day counts ${JSON.stringify([...byDate.entries()])}`)

// Reloading must not duplicate the already-generated week.
const beforeCount = (blocks ?? []).length
await req('/app/calendar')
const { data: blocksAfter } = await admin.from('plan_blocks').select('id').eq('user_id', uid).eq('origin', 'algorithm')
check('revisiting the same week does not regenerate/duplicate rows', (blocksAfter ?? []).length === beforeCount,
  `before ${beforeCount}, after ${(blocksAfter ?? []).length}`)
```

- [ ] **Step 2: Run it**

```bash
npm run e2e:calendar
```

Expected: all new checks pass alongside the existing suite.

- [ ] **Step 3: Run the full verification chain**

```bash
npx tsc --noEmit 2>&1 | grep -v seed_audit_user
npm run verify
npm run e2e:routes
npm run e2e:onboarding
npm run e2e:roadmap
npm run e2e:calendar
npm run e2e:editing
npm run e2e
npm run build
```

Expected: everything green, clean production build.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-calendar.ts
git commit -m "test: e2e coverage for Pulse week generation, review scheduling, and idempotent revisits"
```

---

## Self-review notes (fixed inline above, recorded here for the record)

- **Spec coverage:** §1 (Task 4), §2 (Task 6), §3.1 (Task 7), §3.2 (Task 9), §3.3 (Task 12), §6 review-only (Task 11), §9 duration prompt (Task 10), §10 What gets deleted (Task 13). §4 (full phase variety beyond first_pass/final's cutoff), §5 (class consolidation content), §6 mocks, §7/§8 (Coach intents) are explicitly Phase B per the spec's own §11 — not gaps, deferred by design.
- **Type consistency:** `DayPlan`/`GeneratedPortion` (Task 7) are the same shape consumed by Task 8 (onboarding preview), Task 9 (redistribution reads the committed rows, not these in-memory types, by design — redistribution works off what's actually in the database), and Task 11 (extends the same `portions` array). `Weekday` is imported from `studyWeek.ts` everywhere rather than redefined.
- **Placeholder scan:** the one intentional loose end is Task 9 Step 2/3.1's self-import, which is called out explicitly as something to fix before running tests — not left implicit.
