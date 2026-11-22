-- Manual task creation keeps a durable receipt of the ORIGINAL request and result.
--
-- 20270116 replayed by comparing the key with the live plan_blocks row, so a replay after the student edited, moved, completed or cancelled the task
-- either failed as "different request" or could not know what was originally asked, and detail/priority were never compared. Now the key is bound to the
-- complete canonical request (title, detail, type, priority, date, start instant, minutes) in task_create_receipts, written in the same transaction as
-- the task and its history. A replay returns the stored creation result (plus the task's current state separately), whatever happened to the task since.
-- A different request under the key refuses without writing. Receipts have no foreign key to the task, so cancelling or deleting it never lets the key
-- create it again. A key whose task exists but has no receipt (created by 20270116 before receipts) gets an honest NO_RECEIPT answer, not a guessed match.
-- New tasks must now belong to the active accepted cycle (NO_CYCLE otherwise, never cycle_id NULL) and not be in the past in the student's time zone.
create table if not exists public.task_create_receipts (
  key text primary key check (key ~ '^task-[0-9a-f-]{36}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.task_create_receipts enable row level security;
revoke all on public.task_create_receipts from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant all on public.task_create_receipts to service_role; end if; end $$;

create or replace function public.apply_task_create(
  p_user uuid, p_id text, p_title text, p_detail text, p_type text, p_priority text, p_date date, p_starts timestamptz, p_minutes int
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.plan_blocks%rowtype; v_new public.plan_blocks%rowtype; v_cycle uuid; v_cs date; v_ce date; v_tz text;
  v_range tstzrange; v_title text; v_placement text; v_detail text; v_req jsonb; v_rec public.task_create_receipts%rowtype; v_cur public.plan_blocks%rowtype;
begin
  perform public.scope_lock(p_user);
  -- Immutable checks run on every call, replay included.
  if p_id is null or p_id !~ '^task-[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'code', 'BAD_KEY'); end if;
  if p_type not in ('study', 'review', 'admin', 'other') then return jsonb_build_object('ok', false, 'code', 'BAD_TYPE'); end if;
  if p_title is null or length(btrim(p_title)) < 2 then return jsonb_build_object('ok', false, 'code', 'BAD_TITLE'); end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 180 then return jsonb_build_object('ok', false, 'code', 'BAD_DURATION'); end if;
  if p_date is null then return jsonb_build_object('ok', false, 'code', 'BAD_DATE'); end if;

  v_req := jsonb_build_object('title', btrim(p_title), 'detail', coalesce(btrim(p_detail), ''), 'type', p_type,
    'priority', case when p_priority = 'optional' then 'optional' else 'core' end, 'date', p_date,
    'starts', case when p_starts is null then null else to_char(p_starts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end, 'minutes', p_minutes);

  -- An existing receipt is resolved before any mutable scheduling check.
  select * into v_rec from public.task_create_receipts where key = p_id;
  if found then
    if v_rec.user_id <> p_user or v_rec.request <> v_req then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    select * into v_cur from public.plan_blocks where id = p_id and user_id = p_user;
    return jsonb_build_object('ok', true, 'replayed', true, 'task', v_rec.result, 'current', case when v_cur.id is null then null else to_jsonb(v_cur) end);
  end if;
  select * into v_old from public.plan_blocks where id = p_id;
  if found then
    if v_old.user_id <> p_user then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    return jsonb_build_object('ok', false, 'code', 'NO_RECEIPT', 'current', to_jsonb(v_old));
  end if;

  v_tz := public.booking_tz(p_user);
  if p_date < (now() at time zone v_tz)::date then return jsonb_build_object('ok', false, 'code', 'PAST'); end if;
  select id, starts_at_local::date, ends_at_local::date into v_cycle, v_cs, v_ce from public.planning_cycles where user_id = p_user and status = 'active';
  if v_cycle is null then return jsonb_build_object('ok', false, 'code', 'NO_CYCLE'); end if;
  if p_date < v_cs or p_date > v_ce then return jsonb_build_object('ok', false, 'code', 'OUTSIDE_CYCLE', 'start', v_cs, 'end', v_ce); end if;
  if p_starts is not null and (p_starts at time zone v_tz)::date <> p_date then return jsonb_build_object('ok', false, 'code', 'BAD_SLOT'); end if;

  if p_starts is not null then
    v_range := tstzrange(p_starts, p_starts + make_interval(mins => p_minutes), '[)');
    select p.title into v_title from public.protected_occurrences(p_user, v_range) p limit 1;
    if v_title is null then
      select o.title into v_title from public.plan_blocks o
       where o.user_id = p_user and o.is_protected_commitment and o.cancelled_at is null and o.placement = 'timed' and o.starts_at is not null
         and tstzrange(o.starts_at, o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)), '[)') && v_range limit 1;
    end if;
    if v_title is not null then return jsonb_build_object('ok', false, 'code', 'PROTECTED', 'title', v_title); end if;
  end if;

  v_placement := case when p_starts is null then 'day_preferred' else 'timed' end;
  begin
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
      duration_minutes, duration, rationale, is_protected_commitment, created_by)
    values (p_id, p_user, v_cycle, btrim(p_title), coalesce(nullif(btrim(p_detail), ''), 'Added by you.'), p_type, 'student',
      v_req->>'priority', v_placement, 'not_started', p_date, p_date::text, p_starts,
      p_minutes, p_minutes::text, 'You added this yourself.', false, 'student')
    returning * into v_new;
  exception when sqlstate 'BK409' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', 'MOCK', 'title', coalesce(v_detail, 'Your mock'));
  end;

  insert into public.task_events (user_id, task_id, event_type, payload, previous)
    values (p_user, p_id, 'created', jsonb_build_object('title', v_new.title, 'date', p_date, 'startsAt', p_starts, 'durationMinutes', p_minutes), '{}'::jsonb);
  insert into public.task_create_receipts (key, user_id, request, result) values (p_id, p_user, v_req, to_jsonb(v_new));
  return jsonb_build_object('ok', true, 'replayed', false, 'task', to_jsonb(v_new));
end $$;
revoke all on function public.apply_task_create(uuid, text, text, text, text, text, date, timestamptz, int) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.apply_task_create(uuid, text, text, text, text, text, date, timestamptz, int) to service_role;
end if; end $$;
