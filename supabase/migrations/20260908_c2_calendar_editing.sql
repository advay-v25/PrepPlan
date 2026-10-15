-- C2: calendar editing.
--
-- Three things editing needs that the schema did not have:
--   1. A way to detect that a task changed elsewhere between read and write.
--   2. Recurring commitments that can be expanded into a week, and single
--      occurrences that can be skipped or moved without breaking the series.
--   3. Event types for the operations editing actually performs.

-- 1. Optimistic concurrency -------------------------------------------------
-- Matches the revision pattern already used by planning_cycles, plan_drafts,
-- and coach_proposals.expected_revision. A write carries the revision it read;
-- a mismatch means someone else got there first and the write is refused rather
-- than silently overwriting them.
alter table public.plan_blocks add column if not exists revision integer not null default 1;
alter table public.plan_blocks add column if not exists updated_at timestamptz not null default now();

create or replace function public.bump_plan_block_revision()
returns trigger language plpgsql as $$
begin
  -- Only a real content change advances the revision; re-writing identical
  -- values should not invalidate another session's read.
  if row(new.*) is distinct from row(old.*) then
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists plan_blocks_revision on public.plan_blocks;
create trigger plan_blocks_revision
  before update on public.plan_blocks
  for each row execute function public.bump_plan_block_revision();

-- 2. Recurrence -------------------------------------------------------------
-- Deliberately not RFC 5545. A student's recurring commitments are classes,
-- work, and college: weekly, on named days, between two times. Full RRULE
-- would add a parser and a dependency to express something none of them need.
alter table public.calendar_commitments add column if not exists recurrence text not null default 'none'
  check (recurrence in ('none', 'weekly'));
-- Which weekdays a weekly commitment falls on: 0 = Sunday .. 6 = Saturday.
alter table public.calendar_commitments add column if not exists weekdays smallint[] not null default '{}';
-- Local wall-clock times, so a recurring class stays at 6pm across a DST change
-- rather than drifting to 5pm.
alter table public.calendar_commitments add column if not exists start_time time;
alter table public.calendar_commitments add column if not exists end_time time;
alter table public.calendar_commitments add column if not exists starts_on date;
alter table public.calendar_commitments add column if not exists ends_on date;
alter table public.calendar_commitments add column if not exists timezone text;

-- starts_at/ends_at stay NOT NULL for one-off commitments and for compatibility;
-- a weekly commitment sets them to its first occurrence.
create index if not exists calendar_commitments_recurrence_idx
  on public.calendar_commitments(user_id, recurrence, status);

-- 3. Exceptions to a series -------------------------------------------------
-- "My Wednesday class is cancelled this week" and "it moved to Sunday" must not
-- require deleting the series.
create table if not exists public.commitment_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  commitment_id uuid not null references public.calendar_commitments(id) on delete cascade,
  -- The local date of the occurrence being changed.
  occurrence_date date not null,
  kind text not null check (kind in ('skipped', 'moved')),
  -- Populated only for 'moved'.
  new_date date,
  new_start_time time,
  new_end_time time,
  note text,
  created_at timestamptz not null default now(),
  unique (commitment_id, occurrence_date)
);
alter table public.commitment_exceptions enable row level security;
drop policy if exists "commitment_exceptions_all_own" on public.commitment_exceptions;
create policy "commitment_exceptions_all_own" on public.commitment_exceptions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists commitment_exceptions_lookup_idx
  on public.commitment_exceptions(commitment_id, occurrence_date);

-- 4. Event types editing produces -------------------------------------------
alter table public.task_events drop constraint if exists task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check
  check (event_type in (
    'created', 'started', 'partial_progress', 'completed', 'skipped', 'deferred',
    'placement_changed', 'duration_changed', 'scope_split', 'restored', 'deleted', 'undone'
  ));
-- What the value was before the change, so history reads as a difference and an
-- undo has something to restore to.
alter table public.task_events add column if not exists previous jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
