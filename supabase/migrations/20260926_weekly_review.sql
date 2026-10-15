-- Weekly closure + week-two loop.
--
-- weekly_reviews records that a cycle was closed by an explicit student
-- confirmation, how (paper scored / no-paper), and how each undone due task
-- was resolved. accept_weekly_review() closes the active cycle, opens the next
-- one and inserts its tasks in ONE transaction, idempotently.
--
-- Additive only: no existing table, constraint or function is altered, and no
-- rows are deleted. Task resolutions of "unknown" live in weekly_reviews (the
-- plan_blocks.execution check is deliberately left untouched).

create table if not exists public.weekly_reviews (
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
  constraint weekly_reviews_one_per_cycle unique (cycle_id)
);

create index if not exists weekly_reviews_user_idx on public.weekly_reviews (user_id, closed_at desc);

alter table public.weekly_reviews enable row level security;

drop policy if exists weekly_reviews_select_own on public.weekly_reviews;
create policy weekly_reviews_select_own on public.weekly_reviews
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: rows are written only by accept_weekly_review().

create or replace function public.accept_weekly_review(
  p_cycle_id uuid,
  p_closure_kind text,
  p_no_paper_reason text,
  p_unknown_task_ids text[],
  p_recap jsonb,
  p_next jsonb
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_cycle public.planning_cycles%rowtype;
  v_review public.weekly_reviews%rowtype;
  v_paper_id text;
  v_paper_attempt text;
  v_unresolved integer;
  v_unknown text[] := coalesce(p_unknown_task_ids, '{}');
  v_next uuid;
  v_next_start date;
  v_next_end date;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_closure_kind not in ('paper_scored', 'no_paper') then
    raise exception 'Invalid closure kind';
  end if;

  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user then
    raise exception 'Unauthorized';
  end if;

  -- Idempotent: a repeated or concurrent confirmation returns the first result.
  select * into v_review from public.weekly_reviews where cycle_id = p_cycle_id;
  if found then
    return json_build_object('closed_cycle_id', p_cycle_id, 'next_cycle_id', v_review.next_cycle_id, 'already_closed', true);
  end if;

  if v_cycle.status <> 'active' then
    raise exception 'Cycle is not active';
  end if;

  -- The cycle's weekly paper, if it has one.
  select id, attempt_id into v_paper_id, v_paper_attempt
  from public.plan_blocks
  where cycle_id = p_cycle_id and user_id = v_user
    and task_type = 'diagnostic' and assessment_scope->>'kind' = 'weekly_paper'
  order by local_date desc nulls last limit 1;

  if p_closure_kind = 'paper_scored' then
    if v_paper_id is null or v_paper_attempt is null or not exists (
      select 1 from public.assessment_attempts
      where id::text = v_paper_attempt and user_id = v_user and status = 'scored'
    ) then
      raise exception 'The weekly paper has not been scored';
    end if;
  else
    if coalesce(btrim(p_no_paper_reason), '') = '' then
      raise exception 'A no-paper closure needs a reason';
    end if;
    if v_paper_attempt is not null and exists (
      select 1 from public.assessment_attempts
      where id::text = v_paper_attempt and user_id = v_user and status = 'scored'
    ) then
      raise exception 'The paper was scored; close with the paper';
    end if;
  end if;

  -- Every due task must be finished, skipped, deferred, or explicitly unknown.
  select count(*) into v_unresolved
  from public.plan_blocks
  where cycle_id = p_cycle_id and user_id = v_user
    and local_date <= v_cycle.ends_at_local
    and execution in ('not_started', 'in_progress', 'partial')
    and id is distinct from v_paper_id
    and not (id = any (v_unknown));
  if v_unresolved > 0 then
    raise exception 'Unresolved tasks: %', v_unresolved;
  end if;

  v_next_start := (p_next->>'starts_at_local')::date;
  v_next_end := (p_next->>'ends_at_local')::date;
  if v_next_start is null or v_next_end is null or v_next_start <= v_cycle.ends_at_local then
    raise exception 'The next cycle must start after this one ends';
  end if;
  if jsonb_typeof(p_next->'rows') <> 'array' or jsonb_array_length(p_next->'rows') = 0 then
    raise exception 'The next week has no tasks';
  end if;

  update public.planning_cycles set status = 'closed', revision = revision + 1 where id = p_cycle_id;

  v_next := gen_random_uuid();
  insert into public.planning_cycles (
    id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status, anchor_day
  ) values (
    v_next, v_user, now(), now() + interval '7 days', v_next_start, v_next_end,
    coalesce(p_next->>'timezone', v_cycle.timezone, 'UTC'), 'active',
    nullif(p_next->>'anchor_day', '')::smallint
  );

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority,
    placement, execution, local_date, day, starts_at, duration_minutes, duration,
    lm_id, repair_thread_id, rationale, assessment_scope, created_by
  )
  select
    r->>'id', v_user, v_next, r->>'title', r->>'detail', r->>'task_type', r->>'origin',
    r->>'priority', r->>'placement', r->>'execution', (r->>'local_date')::date, (r->>'day')::date,
    nullif(r->>'starts_at', '')::timestamptz, (r->>'duration_minutes')::smallint, r->>'duration',
    nullif(r->>'lm_id', ''), nullif(r->>'repair_thread_id', '')::uuid, r->>'rationale',
    case when jsonb_typeof(r->'assessment_scope') = 'object' then r->'assessment_scope' end, r->>'created_by'
  from jsonb_array_elements(p_next->'rows') as r;

  insert into public.weekly_reviews (
    user_id, cycle_id, next_cycle_id, closure_kind, no_paper_reason, unknown_task_ids, recap
  ) values (
    v_user, p_cycle_id, v_next, p_closure_kind, nullif(btrim(p_no_paper_reason), ''), v_unknown,
    coalesce(p_recap, '{}'::jsonb)
  );

  return json_build_object('closed_cycle_id', p_cycle_id, 'next_cycle_id', v_next, 'already_closed', false);
end;
$$;

revoke all on function public.accept_weekly_review(uuid, text, text, text[], jsonb, jsonb) from public, anon;
grant execute on function public.accept_weekly_review(uuid, text, text, text[], jsonb, jsonb) to authenticated;
