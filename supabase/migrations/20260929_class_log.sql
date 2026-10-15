-- Class log: what the student covered in class, and the consolidation plan it produces.
--
-- class_sessions / class_session_items record exposure only (never evidence).
-- accept via apply_class_log(): one transaction saves the log and inserts its
-- consolidation tasks into the ACTIVE cycle, idempotently per (user, key).
-- Additive: plan_blocks gains two nullable link columns; nothing is removed.

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  cycle_id uuid references public.planning_cycles(id) on delete set null,
  class_date date not null,
  kind text not null check (kind in ('covered', 'revision', 'missed', 'cancelled', 'none')),
  note text,
  idempotency_key text not null,
  logged_at timestamptz not null default now(),
  constraint class_sessions_idem unique (user_id, idempotency_key)
);
create index if not exists class_sessions_user_date_idx on public.class_sessions (user_id, class_date desc);

create table if not exists public.class_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  outcome_id text not null references public.reading_los(id),
  extent text not null check (extent in ('part', 'full', 'continued')),
  portion_note text,
  studied_in_class boolean not null default false,
  constraint class_session_items_unique unique (session_id, outcome_id)
);
create index if not exists class_session_items_session_idx on public.class_session_items (session_id);

alter table public.plan_blocks add column if not exists class_session_id uuid references public.class_sessions(id) on delete set null;
alter table public.plan_blocks add column if not exists outcome_id text references public.reading_los(id) on delete set null;
create unique index if not exists plan_blocks_class_outcome_day_idx
  on public.plan_blocks (class_session_id, outcome_id, local_date) where class_session_id is not null and outcome_id is not null;

alter table public.class_sessions enable row level security;
alter table public.class_session_items enable row level security;
drop policy if exists class_sessions_select_own on public.class_sessions;
create policy class_sessions_select_own on public.class_sessions for select using (auth.uid() = user_id);
drop policy if exists class_session_items_select_own on public.class_session_items;
create policy class_session_items_select_own on public.class_session_items for select
  using (exists (select 1 from public.class_sessions s where s.id = session_id and s.user_id = auth.uid()));
-- No insert/update/delete policies: written only by apply_class_log().

create or replace function public.apply_class_log(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_class_date date,
  p_kind text,
  p_note text,
  p_items jsonb,
  p_tasks jsonb
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cycle public.planning_cycles%rowtype;
  v_session public.class_sessions%rowtype;
  v_task_count integer := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_kind not in ('covered', 'revision', 'missed', 'cancelled', 'none') then
    raise exception 'Invalid kind';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'Missing idempotency key';
  end if;

  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user or v_cycle.status <> 'active' then
    raise exception 'Unauthorized';
  end if;

  -- Idempotent replay.
  select * into v_session from public.class_sessions where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return json_build_object('session_id', v_session.id, 'already_applied', true,
      'tasks', (select count(*) from public.plan_blocks where class_session_id = v_session.id));
  end if;

  insert into public.class_sessions (user_id, cycle_id, class_date, kind, note, idempotency_key)
  values (v_user, p_cycle_id, p_class_date, p_kind, nullif(btrim(p_note), ''), p_idempotency_key)
  returning * into v_session;

  insert into public.class_session_items (session_id, outcome_id, extent, portion_note, studied_in_class)
  select v_session.id, i->>'outcome_id', i->>'extent', nullif(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  -- Tasks may belong to this session or to an earlier session of this user
  -- (carryover that finally found a day); each must be the user's own.
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p_tasks) t
      where coalesce(nullif(t->>'session_id', '')::uuid, v_session.id) <> v_session.id
        and not exists (select 1 from public.class_sessions s where s.id = (t->>'session_id')::uuid and s.user_id = v_user)
    ) then
      raise exception 'Unauthorized';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_tasks) t
      where (t->>'local_date')::date <= p_class_date
         or (t->>'local_date')::date < v_cycle.starts_at_local
         or (t->>'local_date')::date >= v_cycle.ends_at_local
    ) then
      raise exception 'A task falls outside the open days of this cycle';
    end if;

    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, duration_minutes, duration,
      lm_id, repair_thread_id, rationale, created_by, class_session_id, outcome_id
    )
    select
      t->>'id', v_user, p_cycle_id, t->>'title', t->>'detail', t->>'task_type', t->>'origin', 'core',
      'day_preferred', 'not_started', (t->>'local_date')::date, (t->>'local_date')::date,
      (t->>'duration_minutes')::smallint, t->>'duration_minutes',
      null, nullif(t->>'repair_thread_id', '')::uuid, t->>'rationale', 'algorithm',
      coalesce(nullif(t->>'session_id', '')::uuid, v_session.id), nullif(t->>'outcome_id', '')
    from jsonb_array_elements(p_tasks) t;
    get diagnostics v_task_count = row_count;
  end if;

  return json_build_object('session_id', v_session.id, 'already_applied', false, 'tasks', v_task_count);
end;
$$;

revoke all on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb) to authenticated;
