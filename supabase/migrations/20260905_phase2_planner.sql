-- Phase 2 Planner Migration
-- Deconstructs state, introduces strict cycle coupling, and adds life constraints.

-- 1. Connect tasks to cycles
alter table public.plan_blocks add column if not exists cycle_id uuid references public.planning_cycles(id) on delete cascade;
create index if not exists plan_blocks_cycle_idx on public.plan_blocks(cycle_id);

-- Ensure task and cycle belong to the same student (if both exist)
-- This can be handled by app logic, but let's add a check constraint for safety if needed, 
-- though Postgres doesn't easily allow cross-table check constraints without a function. 
-- We'll rely on RLS and application logic to enforce (plan_blocks.user_id = planning_cycles.user_id).

-- 2. Separate task dimensions
-- Task type: study, review, verification, diagnostic, class_consolidation, etc.
-- We already have `block_type`, let's rename or use it as `task_type`, but to be safe we'll create `task_type` 
-- and migrate `block_type` to it.
alter table public.plan_blocks add column if not exists task_type text check (task_type in ('study', 'review', 'verification', 'diagnostic', 'class_consolidation', 'other'));

-- Priority: core, optional
alter table public.plan_blocks add column if not exists priority text not null default 'core' check (priority in ('core', 'optional'));

-- Placement: timed, day_preferred, floating
alter table public.plan_blocks add column if not exists placement text check (placement in ('timed', 'day_preferred', 'floating'));

-- Execution: not_started, in_progress, partial, completed, skipped, deferred
alter table public.plan_blocks add column if not exists execution text not null default 'not_started' check (execution in ('not_started', 'in_progress', 'partial', 'completed', 'skipped', 'deferred'));

-- Migrate legacy state if possible
update public.plan_blocks
set execution = 'completed'
where state = 'done' and execution = 'not_started';

update public.plan_blocks
set placement = 'floating', execution = 'not_started'
where state = 'floating' and placement is null;

update public.plan_blocks
set placement = 'timed', execution = 'not_started'
where state = 'timed' and placement is null;

update public.plan_blocks
set execution = 'deferred'
where state = 'deferred' and execution = 'not_started';

-- We'll leave `state` around for compatibility for now, but nullable
alter table public.plan_blocks alter column state drop not null;


-- 3. Task Semantics (Some already added in Phase 0, adding the rest)
alter table public.plan_blocks add column if not exists curriculum_reference text;
alter table public.plan_blocks add column if not exists source_pointer jsonb;
alter table public.plan_blocks add column if not exists completion_meaning text;
alter table public.plan_blocks add column if not exists dependencies jsonb not null default '[]'::jsonb;
alter table public.plan_blocks add column if not exists policy_version text;


-- 4. Calendar Commitments
create table if not exists public.calendar_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('class', 'work', 'personal', 'travel', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence_rule text,
  is_protected boolean not null default true,
  source text not null default 'student' check (source in ('student', 'onboarding', 'imported')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.calendar_commitments enable row level security;
drop policy if exists "calendar_commitments_all_own" on public.calendar_commitments;
create policy "calendar_commitments_all_own" on public.calendar_commitments for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists calendar_commitments_user_idx on public.calendar_commitments(user_id);


-- 5. Draft and cycle revisions
-- Planning cycle extensions
alter table public.planning_cycles add column if not exists starts_at_local date;
alter table public.planning_cycles add column if not exists ends_at_local date;
alter table public.planning_cycles add column if not exists timezone text;
alter table public.planning_cycles add column if not exists revision integer not null default 1;
alter table public.planning_cycles add column if not exists accepted_draft_id uuid; -- references plan_drafts(id), but avoid circular reference issues in creation

-- Plan draft extensions
alter table public.plan_drafts add column if not exists proposed_cycle_starts_at_local date;
alter table public.plan_drafts add column if not exists proposed_cycle_ends_at_local date;
alter table public.plan_drafts add column if not exists context_version integer;
alter table public.plan_drafts add column if not exists policy_version text;
alter table public.plan_drafts add column if not exists revision integer not null default 1;
-- Add status 'discarded' and 'failed' to check constraint.
-- Safe way to alter check constraint:
alter table public.plan_drafts drop constraint if exists plan_drafts_status_check;
alter table public.plan_drafts add constraint plan_drafts_status_check check (status in ('preparing','ready','accepted','superseded','discarded','failed'));


-- 6. Activity history (Task Events)
create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null references public.plan_blocks(id) on delete cascade,
  event_type text not null check (event_type in ('started', 'partial_progress', 'completed', 'skipped', 'deferred', 'placement_changed', 'scope_split')),
  actual_duration_minutes smallint,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.task_events enable row level security;
drop policy if exists "task_events_all_own" on public.task_events;
create policy "task_events_all_own" on public.task_events for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists task_events_user_idx on public.task_events(user_id);
create index if not exists task_events_task_idx on public.task_events(task_id);

-- 7. Atomic Plan Acceptance RPC
create or replace function public.accept_plan_draft(
  p_draft_id uuid,
  p_expected_revision integer,
  p_cycle_starts_at_local date,
  p_cycle_ends_at_local date,
  p_timezone text,
  p_tasks jsonb
) returns uuid
language plpgsql security definer
as $$
declare
  v_user_id uuid;
  v_draft_status text;
  v_draft_revision integer;
  v_cycle_id uuid;
  v_task jsonb;
begin
  -- Get user
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  -- Lock the draft for update
  select status, revision into v_draft_status, v_draft_revision
  from public.plan_drafts
  where id = p_draft_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Draft not found.';
  end if;

  if v_draft_status != 'ready' then
    raise exception 'Draft is not ready for acceptance.';
  end if;

  if v_draft_revision != p_expected_revision then
    raise exception 'Stale draft revision.';
  end if;

  -- Create Cycle
  insert into public.planning_cycles (
    user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status
  ) values (
    v_user_id, now(), now() + interval '7 days', p_cycle_starts_at_local, p_cycle_ends_at_local, p_timezone, 'active'
  ) returning id into v_cycle_id;

  -- Insert Tasks
  for v_task in select * from jsonb_array_elements(p_tasks)
  loop
    insert into public.plan_blocks (
      user_id, cycle_id, title, detail, duration_minutes, task_type, priority, placement, execution,
      starts_at, rationale, learning_objective, suggested_approach, focus_distinction, verification_intent,
      curriculum_reference, completion_meaning, created_by
    ) values (
      v_user_id, v_cycle_id, v_task->>'title', v_task->>'detail', (v_task->>'duration_minutes')::smallint,
      v_task->>'task_type', v_task->>'priority', v_task->>'placement', v_task->>'execution',
      (v_task->>'starts_at')::timestamptz, coalesce(v_task->>'rationale', ''), v_task->>'learning_objective',
      v_task->>'suggested_approach', v_task->>'focus_distinction', v_task->>'verification_intent',
      v_task->>'curriculum_reference', v_task->>'completion_meaning', 'algorithm'
    );
  end loop;

  -- Mark Draft Accepted
  update public.plan_drafts
  set status = 'accepted', revision = revision + 1, updated_at = now()
  where id = p_draft_id;

  return v_cycle_id;
end;
$$;
