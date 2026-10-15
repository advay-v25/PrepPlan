-- Linking the calendar to diagnostics.
--
-- Three gaps this closes:
--   1. plan_blocks.task_type had no 'repair', 'recheck', or 'mock' value, so the
--      repair endpoint proposed a task type the table would have rejected on
--      insert. Nothing caught it because no proposal was ever applied.
--   2. A task had no way to reference the evidence that caused it, so the
--      calendar could not answer "why is this here?" for diagnostic follow-ups.
--   3. Nothing recorded which study week a cycle belongs to, or which weekday
--      closes it, so the end-of-cycle rule had nowhere to read from.

-- 1. The task types the planner actually needs -------------------------------
alter table public.plan_blocks drop constraint if exists plan_blocks_task_type_check;
alter table public.plan_blocks add constraint plan_blocks_task_type_check
  check (task_type in (
    'study', 'review', 'verification', 'diagnostic', 'class_consolidation',
    'repair', 'recheck', 'mock', 'admin', 'other'
  ));

-- 2. Provenance: what put this task in the week ------------------------------
alter table public.plan_blocks add column if not exists origin text not null default 'planner'
  check (origin in ('planner', 'roadmap', 'class', 'diagnostic', 'student', 'coach'));
alter table public.plan_blocks add column if not exists concept_id uuid references public.curriculum_concepts(id) on delete set null;
alter table public.plan_blocks add column if not exists attempt_id uuid references public.assessment_attempts(id) on delete set null;
alter table public.plan_blocks add column if not exists evidence_event_id uuid references public.evidence_events(id) on delete set null;
-- Scope for a scheduled diagnostic: purpose, modules, concepts.
alter table public.plan_blocks add column if not exists assessment_scope jsonb;
-- The local calendar date a task belongs to. Timed tasks also carry starts_at;
-- day-preferred tasks have only this. Storing it avoids re-deriving a local date
-- from a timestamp on every render, which is where timezone bugs breed.
alter table public.plan_blocks add column if not exists local_date date;

create index if not exists plan_blocks_local_date_idx on public.plan_blocks(user_id, local_date);
create index if not exists plan_blocks_attempt_idx on public.plan_blocks(attempt_id);

-- 3. The study week a cycle represents ---------------------------------------
alter table public.planning_cycles add column if not exists anchor_day smallint
  check (anchor_day between 0 and 6);

-- 4. Where a student reviews and is tested -----------------------------------
-- 0 = Sunday .. 6 = Saturday, matching Date#getDay.
alter table public.profiles drop constraint if exists profiles_diagnostic_day_check;
alter table public.profiles add constraint profiles_diagnostic_day_check
  check (diagnostic_day is null or diagnostic_day between 0 and 6);

-- 5. The four CFA Level I sittings -------------------------------------------
-- Onboarding accepted any month. The exam runs in February, May, August, and
-- November; a window catalogue lets exact dates be corrected without a code
-- change, and lets a student choose a sitting before dates are published.
create table if not exists public.exam_windows (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'CFA Level I',
  year smallint not null,
  sitting text not null check (sitting in ('february', 'may', 'august', 'november')),
  window_opens date,
  window_closes date,
  registration_closes date,
  is_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (level, year, sitting)
);
alter table public.exam_windows enable row level security;
drop policy if exists "exam_windows_read_all" on public.exam_windows;
create policy "exam_windows_read_all" on public.exam_windows for select using (true);

alter table public.profiles drop constraint if exists profiles_exam_sitting_check;
alter table public.profiles add constraint profiles_exam_sitting_check
  check (exam_sitting is null or exam_sitting in ('february', 'may', 'august', 'november'));
alter table public.profiles add column if not exists exam_year smallint;
alter table public.profiles add column if not exists exam_window_id uuid references public.exam_windows(id);

-- Indicative windows from 2027. Dates are unconfirmed until CFA Institute
-- publishes them; is_confirmed says which are real.
insert into public.exam_windows (level, year, sitting, window_opens, window_closes, is_confirmed) values
  ('CFA Level I', 2027, 'february', '2027-02-16', '2027-02-22', false),
  ('CFA Level I', 2027, 'may',      '2027-05-12', '2027-05-18', false),
  ('CFA Level I', 2027, 'august',   '2027-08-17', '2027-08-23', false),
  ('CFA Level I', 2027, 'november', '2027-11-10', '2027-11-16', false),
  ('CFA Level I', 2028, 'february', '2028-02-15', '2028-02-21', false),
  ('CFA Level I', 2028, 'may',      '2028-05-10', '2028-05-16', false),
  ('CFA Level I', 2028, 'august',   '2028-08-15', '2028-08-21', false),
  ('CFA Level I', 2028, 'november', '2028-11-08', '2028-11-14', false)
on conflict (level, year, sitting) do nothing;

notify pgrst, 'reload schema';
