-- Dependency fixture for the weekly-continuity command, NOT a baseline for installing the app.
-- Applied after task-execution.sql and the two 20261028 migrations. Columns mirror the real tables.
alter table public.profiles add column exam_window_id uuid, add column exam_date date, add column prep_mode text,
  add column class_pattern text, add column max_session_minutes smallint, add column timezone text;

alter table public.planning_cycles add column starts_at timestamptz, add column ends_at timestamptz, add column starts_at_local date,
  add column ends_at_local date, add column timezone text, add column anchor_day smallint, add column revision integer not null default 1;

-- Mirrors the real development schema (inspected read-only): `day` is text NOT NULL, `attempt_id` is a uuid, and
-- evidence/class links are real foreign keys, so a whole-row copy would carry them if the command did not reset them.
alter table public.plan_blocks add column priority text not null default 'core', add column day text not null,
  add column repair_thread_id uuid, add column rationale text not null default '', add column assessment_scope jsonb,
  add column attempt_id uuid, add column completion_meaning text, add column concept_id uuid, add column class_session_id uuid,
  add column cancellation_reason text, add column cancellation_source_id text, add column focus_distinction text,
  add column verification_intent text, add column curriculum_reference text, add column subject_id text, add column block_type text,
  add column dependencies jsonb not null default '[]'::jsonb, add column policy_version text, add column source_pointer jsonb;
alter table public.plan_blocks
  add constraint plan_blocks_created_by_check check (created_by in ('algorithm', 'student', 'coach')),
  add constraint plan_blocks_origin_check check (origin in ('planner', 'roadmap', 'class', 'diagnostic', 'student', 'coach')),
  add constraint plan_blocks_placement_check check (placement in ('timed', 'day_preferred', 'floating')),
  add constraint plan_blocks_priority_check check (priority in ('core', 'optional'));
-- The real project allows ONE active cycle per learner; a command that opens the next week before closing the old one fails there.
create unique index planning_cycles_active_user_idx on public.planning_cycles(user_id) where status = 'active';
alter table public.plan_blocks add constraint plan_blocks_cycle_fk foreign key (cycle_id) references public.planning_cycles(id) on delete cascade;
grant select, insert, update, delete on public.plan_blocks to authenticated;

alter table public.evidence_events add column user_id uuid, add column validity text not null default 'valid',
  add column validity_reason text, add column superseded_by_event_id uuid;
alter table public.plan_blocks add column evidence_event_id uuid references public.evidence_events(id) on delete set null;

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  cycle_id uuid not null references public.planning_cycles(id) on delete cascade,
  next_cycle_id uuid references public.planning_cycles(id) on delete set null,
  status text not null default 'closed' check (status in ('closed')),
  closure_kind text not null check (closure_kind in ('paper_scored', 'no_paper')),
  no_paper_reason text,
  unknown_task_ids text[] not null default '{}',
  recap jsonb not null default '{}'::jsonb,
  closed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  resolutions jsonb not null default '{}'::jsonb,
  constraint weekly_reviews_one_per_cycle unique (cycle_id)
);
create table public.assessment_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null, cycle_id uuid, attempt_kind text, status text);
create table public.calendar_commitments (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null default 'active', label text);
create table public.availability_windows (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null default 'active');
create table public.repair_threads (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null);
create table public.user_module_state (user_id uuid not null, lm_id text not null, coverage_state text not null);
