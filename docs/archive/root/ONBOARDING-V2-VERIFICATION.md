# ONBOARDING_V2_DESIGN — verification and change list

Checked against the build as of 2026-09-04: `supabase/schema.sql`, `src/lib/study-context.ts`,
`src/components/onboarding/OnboardingFlow.tsx`, `src/lib/planning/scheduler.ts`,
`src/app/api/{plan,onboarding,materials/analyze,diagnostics/generate}/route.ts`.

**Verdict.** The product thinking is right and is a genuine improvement on what shipped: the
priority-first draft, the explicit accept step, the separation of self-reported exposure from
diagnostic evidence, and the floating-task bucket are all things the current build lacks and
needs. Three things block it as written.

1. **The design was written against the v1 onboarding, not the one that is live.** The build was
   rewritten to a context-only v4 envelope with a 21-cell availability grid; §2 does not know
   this and silently drops seven fields that already exist and work.
2. **Rule 1 and Rule 3 cannot be computed from the inputs §2 collects.** No step asks what time
   the student *has*. The design asks only what time is *taken*.
3. **The design ends at week one.** There is no second draft, no trigger, and no path from what
   actually got done back into the next week's sizing — which is the product.

Everything below is either a verified contradiction with evidence, or a change to make.

---

## Part A — Verified contradictions with the current build

### A1. §2 is a regression against the shipped v4 context

`studyContextSchema` in `src/lib/study-context.ts` already collects, and `OnboardingFlow.tsx`
already renders, fields that §2 does not mention. Adopting §2 literally deletes working code.

| Field in v4, absent from the design | Why it should survive |
| :--- | :--- |
| `availability[]` — 21 keys of the form `"6-Morning"` (ISO weekday × day-part) | The only source of *available* time. Rules 1 and 3 depend on it. See A2. |
| `timezone` | Every `starts_at` is a `timestamptz`. Without it the draft is placed in server time. |
| `checkInDay` | The natural trigger for the week-2 draft. See B1. |
| `barriers[]`, `testComfort`, `practiceStyle` | Feed Step 5's default and the fear-reduction goal. |
| `routine`, `lifeSituation` | Free-text context for the composer's rationale strings. |
| `sources[]`, `imports[]` | §2 Step 3 re-asks for provider; v4 already stores it plus per-file topic mapping. |
| `stage`, `background`, `currentFocus` | §2 Steps 1–2 ask the same things under different names. |

**Change:** treat §2 as a re-ordering and re-wording of the v4 context, not a replacement schema.
Map each §2 field onto its existing `studyContextSchema` key rather than introducing parallel
names (`prep_mode` vs `learningMode`, `sitting_length_mins` vs `sessionMinutes`,
`weekly_priority` vs a new `weekGoal`).

### A2. Rules 1 and 3 are uncomputable — the design never collects availability

Rule 1 caps core tasks at "65% of the user's available time." Rule 3 compares free fragments
against `sitting_length_mins`. Step 4 collects **fixed commitments** and **sitting length** only.
Commitments are negative space; subtracting them from an unknown total yields nothing.

This is not hypothetical: Journey B lists "Weekends only" as an input, and no step in §2 can
capture it. Journey C says "No fixed schedule" and the draft correctly goes fully floating —
but the system has no way to tell Journey B from Journey C, because both answered the same
questions.

**Change:** the availability grid stays, in Step 4, before commitments. Denominator for Rule 1 is
`availability.length × sessionMinutes`. Rule 3's fragments are day-parts not covered by a
commitment.

### A3. Rule 1's 65% is the capacity factor under a new name

The retired scheduler used `capacity_factor = 0.85` and it was removed because a magic constant
deciding how much a student should do is the thing you rejected. 65% is the same constant, lower
and still unsourced. It is defensible as a *ceiling* (§1: "time is a boundary, not a target") but
not as a fixed one.

**Change:** state 65% as the **seed** value of a per-user `draft_fill_ratio`, stored, shown, and
adjusted from completion evidence — down when a week is missed, up when it is cleared early, with
"Make it lighter" writing to it directly. A number the student can move is a boundary. A number
they cannot is a prescription.

### A4. Schema blockers — every one of these fails at runtime today

| Design requirement | Actual schema | Result |
| :--- | :--- | :--- |
| Rule 2: every task carries a `rationale` | `plan_blocks` has no `rationale` column | Insert fails |
| Phase 4: accepting sets `state = 'active'` | `state` check is `('done','planned','class','risk','empty')` | Constraint violation |
| Core scheduled / core floating / optional deferred | No bucket, priority, or `block_type` column | Cannot represent the three-bucket draft |
| §9 resume from `onboarding_drafts` | Table does not exist | Resume is localStorage + `onboarding_sessions.answers` only |
| §5 `calendar_status` / `material_status` / `diagnostic_baseline` | `profiles` has `onboarding_status` + `onboarding_step` | Decoupled states unstorable |
| Six steps | `onboarding_step` check is `between 0 and 4` | Step 5 and 6 rejected |
| Step 1 exam window "Undecided" | `exam_attempts.target_exam_date` is `not null` | Undecided unstorable |
| §1 "time is a boundary, not a target" | `exam_attempts.provisional_weekly_minutes not null check between 120 and 1260` | A prescribed weekly hours target is still **enforced at the database level** |

Two further mismatches that break the retired scheduler and would break any successor that reuses
its queries:

- `scheduler.ts` selects `availability_rules.slot` and `.available`. The table has neither — only
  `weekday` and `max_session_minutes`.
- `scheduler.ts` selects `class_schedules.start_time` and `.end_time`. The table has neither —
  only `weekday`, `source`, `is_active`. There is nowhere to store "Mon/Wed evenings" from
  Journey A.
- `availability_rules.weekday` and `class_schedules.weekday` are checked `between 0 and 6`, while
  the v4 context and the scheduler both use ISO 1–7. Silent off-by-one on Sunday.

### A5. §3 Step 3 describes async material processing that does not exist

`api/materials/analyze` is fully synchronous: it parses the first 25 PDF pages in-request,
classifies with one LLM call, returns JSON, and **writes nothing** — no Storage upload, no
`user_materials` row. There is no job table, no status polling, no "Processing…" state to resume
into.

Phase 2's criterion, "uploaded PDFs resolve to CFA topics," is only half-true: it resolves to one
of ten hard-coded topic *name strings*, not to curriculum node IDs. §8's edge `C -- Mapped
Pointers --> B` cannot be satisfied by topic names — the composer cannot anchor a study block to
"Fixed Income" as a page range or reading.

**Change:** either (a) descope Step 3 to provider selection plus a stored file with topic tags,
and drop "Mapped Pointers" from the graph until a curriculum node table exists; or (b) add the
job table and the curriculum node mapping, which is its own phase. (a) is the January answer.

### A6. §2 Step 5 assumes a diagnostic engine broader than the one built

`api/diagnostics/generate` accepts exactly five `subjectId` values: `fixed-income`, `quant`,
`fsa`, `equity`, `ethics`. The other five Level I topics — Economics, Corporate Issuers,
Derivatives, Alternative Investments, Portfolio Management — cannot be diagnosed. A student whose
current topic is Derivatives reaches Step 5 and has nothing to offer them. The endpoint also
returns 503 without `NVIDIA_API_KEY`, and §9 has no recovery flow for that.

**Change:** Step 5 must degrade to "Decide later" when the current topic has no bank, and say so
plainly rather than offering a check that 400s.

### A7. Current entry-path state, for reference

`/api/feasibility` returns 410 (screening retired). `/api/plan` returns 409
(`WEEKLY_PLANNER_PENDING`) deliberately. `/check/result`, `/onboarding/plan` and
`/onboarding/blocked` are redirect stubs. `scheduler.ts` is unreferenced dead code. None of this
contradicts the design — it means Phase 3 starts from a blank file, not a refactor.

---

## Part B — Design-level gaps, independent of the code

### B1. There is no week two

This is the largest omission. Every screen, rule and acceptance criterion in the document is
scoped to onboarding. §8's graph terminates at `Application State`; nothing loops back to the
Draft Composer. But the product is "plan things week by week" — the accept-draft cycle *is* the
product, and onboarding is only its first instance.

Concretely undefined: what triggers draft *n+1* (`checkInDay` is the obvious answer and already
collected); what happens to unfinished blocks from week *n*; whether the student can be mid-week
and request a re-draft; what the dashboard shows on day 4 of an accepted week.

**Change:** rewrite §6 and §8 so the draft loop is week-generic and onboarding is its cold-start
path. Every rule should read "the draft," not "the first-week draft."

### B2. Nothing consumes what actually happened

The brief says the system must "account for deviations, actual capacity of the person studying."
The design has no feedback edge. `draft_fill_ratio` never moves, completed blocks go nowhere, and
"Make it lighter" is a one-shot UI action rather than a signal.

**Change:** add a fourth context category to §5 — **Observed Behaviour**: completion rate per
day-part, average actual vs. planned block length, streak of accepted-but-unstarted drafts. This
is the accountability mechanism, and it is what makes week 10 better than week 1.

### B3. Step 5 puts a test in front of the highest-abandon point in the funnel

A baseline check at minute eight of signup, before the app has done anything for the student,
runs against the stated goal of reducing fear of tests. It is also meaningless for "Starting from
zero" — §3 branch 2 asks a beginner to baseline a topic they have not read.

**Change:** make "Add to my first study session" the default for every branch, and "Try a short
check now" the opt-in. The first diagnostic should sit inside an accepted week the student chose,
not gate entry to it.

### B4. Smaller open items

- §2 Entry offers "Explore first" with no defined return path or resume prompt.
- §5's three decoupled states have no transition table; `Pending Draft → Confirmed` is the only
  edge the document implies.
- §4's eight-row mapping table and §5's five context categories do not reconcile — there is no
  field-level ownership list.
- §9's fallback is "a deterministic template based on `prep_mode`." If a deterministic template is
  acceptable when the model is down, it is worth asking whether week one needs the model at all.
  Shipping deterministic-first and adding the composer in Phase 5 removes the entire 503 branch,
  the timeout budget and the prompt-injection surface from the January path.

---

## Part C — Change list

### C1. Migration (`supabase/migrations/0002_draft_model.sql`)

```sql
-- plan_blocks: buckets, rationale, week scoping
alter table public.plan_blocks add column if not exists rationale text;
alter table public.plan_blocks add column if not exists block_type text not null default 'study'
  check (block_type in ('study','review','diagnostic','commitment'));
alter table public.plan_blocks add column if not exists bucket text not null default 'core_scheduled'
  check (bucket in ('core_scheduled','core_floating','optional_deferred'));
alter table public.plan_blocks add column if not exists week_of date;
alter table public.plan_blocks alter column starts_at drop not null;   -- floating tasks have no time
alter table public.plan_blocks drop constraint if exists plan_blocks_state_check;
alter table public.plan_blocks add constraint plan_blocks_state_check
  check (state in ('draft','active','done','skipped','class'));

-- decoupled feature states
alter table public.profiles add column if not exists calendar_status text not null default 'empty'
  check (calendar_status in ('empty','pending_draft','confirmed'));
alter table public.profiles add column if not exists material_status text not null default 'none'
  check (material_status in ('none','processing','mapped'));
alter table public.profiles add column if not exists diagnostic_baseline text not null default 'none'
  check (diagnostic_baseline in ('none','scheduled','completed'));
alter table public.profiles add column if not exists draft_fill_ratio numeric(3,2) not null default 0.65;
alter table public.profiles drop constraint if exists profiles_onboarding_step_check;

-- exam window may be undecided; no prescribed weekly target
alter table public.exam_attempts alter column target_exam_date drop not null;
alter table public.exam_attempts alter column provisional_weekly_minutes drop not null;

-- commitments need times; availability is not one row per weekday
alter table public.class_schedules add column if not exists start_time time;
alter table public.class_schedules add column if not exists end_time time;
alter table public.class_schedules drop constraint if exists class_schedules_user_id_weekday_key;
alter table public.class_schedules drop constraint if exists class_schedules_weekday_check;
alter table public.class_schedules add constraint class_schedules_weekday_check
  check (weekday between 1 and 7);

drop table if exists public.availability_rules;
create table public.availability_rules (
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  day_part text not null check (day_part in ('Morning','Afternoon','Evening')),
  primary key (user_id, weekday, day_part)
);
alter table public.availability_rules enable row level security;
-- (owner-only select/insert/update/delete policies, matching the existing pattern)
```

`draft_fill_ratio` lives on `profiles` rather than in the JSON envelope because the composer reads
it every week and it is written by evidence, not by the student's answers.

### C2. Files

| File | Change |
| :--- | :--- |
| `src/lib/study-context.ts` | Add `weekGoal` (§4 "First Week Goal") and `diagnosticChoice` (§2 Step 5). Bump envelope to `version: 5`, `step: 1..6`. Keep every existing field. |
| `src/components/onboarding/OnboardingFlow.tsx` | Re-order to the §2 six-step sequence; add the §3 branch logic (`learningMode` gates Step 2's variant); keep the availability grid, move it to Step 4; add Step 6 as the draft review. |
| `src/lib/planning/composer.ts` | **New.** Replaces `scheduler.ts`. Pure function: `(context, fillRatio, weekStart) => Draft`. No Supabase reads — takes context in, returns the three buckets out. Testable without a database. |
| `src/lib/planning/scheduler.ts` | **Delete.** Every query in it targets columns that do not exist; nothing imports it. |
| `src/app/api/plan/route.ts` | Replace the 409. `POST` returns a draft `{ core_scheduled, core_floating, optional_deferred, fill_ratio, week_of }` without writing. `PUT /accept` writes `plan_blocks` at `state='active'` and sets `calendar_status='confirmed'`. `PUT /lighter` re-composes at a reduced ratio and persists the new `draft_fill_ratio`. |
| `src/app/api/onboarding/route.ts` | On complete, fan `availability` / `commitments` out to `availability_rules` and `class_schedules` so the composer has indexed reads, and keep the JSON envelope as the record of what was answered. |
| `src/app/app/page.tsx` | Add the §9 pending-draft banner; show the accepted week's next action instead of the context echo. |
| `src/app/api/profile/route.ts` | Drop the `provisional_weekly_minutes` read and the `availability_rules.max_session_minutes` write — both reference the retired hours-target model. |
| `src/app/api/diagnostics/generate/route.ts` | Return a typed "no bank for this topic" response instead of a 400 for the five unsupported subjects, so Step 5 can degrade. |
| `src/app/onboarding/{blocked,plan}/`, `src/app/check/result/` | Delete the redirect stubs once no external link points at them. |
| `PHASE-1-FINAL.md`, `ONBOARDING-SPEC.md` | Add a supersession note; both still document the retired hard gate and D6. |

### C3. Revised phasing

Phase 1 and 2 as written are mostly done — the adaptive form exists and the analyze endpoint is
wired. The critical path to a usable January product is:

1. **Migration + composer, deterministic.** C1, plus `composer.ts` implementing Rules 1–4 with no
   model call. Acceptance: a student who finishes onboarding sees a real week built from their own
   availability, and the three buckets are distinguishable.
2. **Review screen and accept.** Step 6 plus the accept / lighter / keep-unscheduled mutations.
   Acceptance: nothing reaches the calendar without an explicit click; "Make it lighter" moves
   `draft_fill_ratio` and the change survives a reload.
3. **The weekly loop.** `checkInDay` triggers draft *n+1*; unfinished blocks carry or drop by the
   student's choice; completion writes back to `draft_fill_ratio`. This is B1 and B2 and it is
   what makes the thing a planner rather than a wizard.
4. **AI composer.** Only after 1–3 hold. The deterministic composer becomes the §9 fallback rather
   than a thing written twice.

Step 3 material mapping and Step 5's timed/untimed variants can slip past January without
damaging the core loop. The weekly loop cannot.

---

## Open questions for you

1. **Rule 1's denominator.** Confirm availability returns to the flow. If you would rather not ask
   for a 21-cell grid, the alternative is to infer availability from accepted-and-completed blocks
   over the first fortnight — but then week one has to be fully floating, and Rule 1 does not
   apply until week three.
2. **Deterministic-first or model-first for the week-one composer**, given January.
3. **Exam window "Undecided"** — does an undecided student get a draft with no horizon at all, or
   do we assume the next sitting and label it as an assumption they can change?
