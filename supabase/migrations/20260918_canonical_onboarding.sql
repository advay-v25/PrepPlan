-- Canonical Onboarding schema extensions

-- 1. Profiles updates --------------------------------------------------------

-- Add new columns
alter table public.profiles add column if not exists class_pattern text;
alter table public.profiles add column if not exists onboarding_context_version integer not null default 1;
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists onboarding_preview_id uuid;

-- Backfill existing data
update public.profiles set class_pattern = 'none' where class_pattern is null;

-- Add check constraint on class_pattern
alter table public.profiles drop constraint if exists profiles_class_pattern_check;
alter table public.profiles add constraint profiles_class_pattern_check
  check (class_pattern in ('none', 'fixed', 'variable', 'mixed'));

-- Update onboarding_status constraint
alter table public.profiles drop constraint if exists profiles_onboarding_status_check;
alter table public.profiles add constraint profiles_onboarding_status_check
  check (onboarding_status in ('not_started', 'in_progress', 'review_ready', 'complete'));

-- Update max_session_minutes constraint
alter table public.profiles drop constraint if exists profiles_max_session_minutes_check;
alter table public.profiles add constraint profiles_max_session_minutes_check
  check (max_session_minutes is null or max_session_minutes in (20, 30, 45, 60, 90));

-- Add constraint for exact exam date when registered and complete
alter table public.profiles drop constraint if exists profiles_registered_exam_date_check;
alter table public.profiles add constraint profiles_registered_exam_date_check
  check (not (registered = true and onboarding_status = 'complete' and exam_date is null));

-- 2. Calendar Commitments ----------------------------------------------------

alter table public.calendar_commitments add column if not exists recurrence text;
alter table public.calendar_commitments add column if not exists timezone text;
alter table public.calendar_commitments add column if not exists start_time time;
alter table public.calendar_commitments add column if not exists end_time time;
alter table public.calendar_commitments add column if not exists starts_on date;
alter table public.calendar_commitments add column if not exists ends_on date;
alter table public.calendar_commitments add column if not exists is_protected boolean default true;
alter table public.calendar_commitments add column if not exists source text;
alter table public.calendar_commitments add column if not exists status text default 'active';

alter table public.calendar_commitments drop constraint if exists calendar_commitments_kind_check;
alter table public.calendar_commitments add constraint calendar_commitments_kind_check
  check (kind in ('class', 'work', 'college', 'personal', 'commute', 'exercise', 'family', 'appointment', 'travel', 'other'));

-- Ensure end_time > start_time when both are present
alter table public.calendar_commitments drop constraint if exists calendar_commitments_time_check;
alter table public.calendar_commitments add constraint calendar_commitments_time_check
  check (start_time is null or end_time is null or end_time > start_time);

create index if not exists calendar_commitments_status_kind_idx
  on public.calendar_commitments(user_id, status, kind);

-- 3. Availability Windows ----------------------------------------------------

create table if not exists public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  source text not null default 'onboarding',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists availability_windows_user_weekday_idx
  on public.availability_windows(user_id, status, weekday);

alter table public.availability_windows enable row level security;

drop policy if exists "Users can manage their own availability windows" on public.availability_windows;
create policy "Users can manage their own availability windows"
  on public.availability_windows for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. User Topic Exposure -----------------------------------------------------

create table if not exists public.user_topic_exposure (
  user_id uuid not null references auth.users on delete cascade,
  topic_id text not null, -- using text to match topics.id if it's text, adjust if uuid
  recency text not null check (recency in ('current', 'recent', 'stale')),
  source text not null check (source in ('self_report')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

alter table public.user_topic_exposure enable row level security;

drop policy if exists "Users can manage their own topic exposure" on public.user_topic_exposure;
create policy "Users can manage their own topic exposure"
  on public.user_topic_exposure for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. Versioned Previews on plan_drafts ---------------------------------------

alter table public.plan_drafts add column if not exists roadmap_id uuid; -- optionally references study_roadmaps(id) on delete cascade
alter table public.plan_drafts add column if not exists onboarding_context_version integer;
alter table public.plan_drafts add column if not exists context_fingerprint text;
alter table public.plan_drafts add column if not exists cycle_start_date date;
alter table public.plan_drafts add column if not exists cycle_end_date date;
alter table public.plan_drafts add column if not exists timezone text;
alter table public.plan_drafts add column if not exists accepted_cycle_id uuid;
alter table public.plan_drafts add column if not exists purpose text;

-- Remove duplicates for active uniqueness if any
-- (Skipped automatic deletion to prevent data loss in migration, assuming clean state for these specific partials)

drop index if exists study_roadmaps_active_user_idx;
create unique index if not exists study_roadmaps_active_user_idx
  on public.study_roadmaps(user_id) where status = 'active';

drop index if exists planning_cycles_active_user_idx;
create unique index if not exists planning_cycles_active_user_idx
  on public.planning_cycles(user_id) where status = 'active';

drop index if exists plan_drafts_ready_onboarding_idx;
create unique index if not exists plan_drafts_ready_onboarding_idx
  on public.plan_drafts(user_id, onboarding_context_version) where status = 'ready' and purpose = 'onboarding_initial_week';

-- Notify postgrest
notify pgrst, 'reload schema';

-- 6. Atomic Acceptance RPC ---------------------------------------------------

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

  -- Lock the draft row
  select * into v_draft
  from public.plan_drafts
  where id = p_draft_id for update;

  if not found then
    raise exception 'Draft not found';
  end if;

  if v_draft.user_id != v_user_id then
    raise exception 'Unauthorized';
  end if;

  if v_draft.purpose != 'onboarding_initial_week' then
    raise exception 'Draft is not an onboarding preview';
  end if;

  if v_draft.status = 'accepted' then
    -- Idempotent retry: return existing cycle
    return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_draft.accepted_cycle_id);
  end if;

  if v_draft.status != 'ready' then
    raise exception 'Draft is not ready';
  end if;

  if v_draft.revision != p_expected_revision then
    raise exception 'Stale revision. Expected %, got %', p_expected_revision, v_draft.revision;
  end if;

  -- Activate the linked roadmap and supersede previous
  update public.study_roadmaps
  set status = 'superseded', updated_at = now()
  where user_id = v_user_id and status = 'active';

  update public.study_roadmaps
  set status = 'active', updated_at = now()
  where id = v_draft.roadmap_id;

  -- Create one planning cycle
  v_new_cycle_id := gen_random_uuid();
  insert into public.planning_cycles (
    id, user_id, roadmap_id, starts_on, ends_on, timezone, status
  ) values (
    v_new_cycle_id, v_user_id, v_draft.roadmap_id, v_draft.cycle_start_date, v_draft.cycle_end_date, v_draft.timezone, 'active'
  );

  -- Insert tasks strictly from server-owned draft_json
  v_tasks_array := v_draft.draft_json->'tasks';
  if jsonb_typeof(v_tasks_array) = 'array' then
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, purpose, status, scheduled_date, start_time, duration_minutes, is_floating, metadata
    )
    select 
      (t->>'id')::uuid,
      v_user_id,
      v_new_cycle_id,
      t->>'title',
      t->>'purpose',
      'planned',
      (t->>'scheduled_date')::date,
      (t->>'start_time')::time,
      (t->>'duration_minutes')::integer,
      COALESCE((t->>'is_floating')::boolean, false),
      t->'metadata'
    from jsonb_array_elements(v_tasks_array) as t;
  end if;

  -- Mark draft accepted
  update public.plan_drafts
  set status = 'accepted', accepted_cycle_id = v_new_cycle_id, updated_at = now()
  where id = p_draft_id;

  -- Final onboarding snapshot on profile
  update public.profiles
  set 
    onboarding_status = 'complete',
    onboarding_completed_at = now(),
    onboarding_preview_id = p_draft_id,
    updated_at = now()
  where id = v_user_id;

  return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_new_cycle_id);

end;
$$;

-- Revoke execute from public and grant to authenticated
revoke execute on function public.accept_onboarding_preview(uuid, integer) from public;
grant execute on function public.accept_onboarding_preview(uuid, integer) to authenticated;
