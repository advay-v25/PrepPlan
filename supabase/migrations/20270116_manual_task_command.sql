-- One command for a task the student adds themselves.
--
-- Before: POST /api/tasks inserted the plan_blocks row and, separately, its 'created' history event, with protected-time checked in TypeScript
-- before an unlocked write and no way to tell a lost response from a second task. A failure between the two writes left a task with no history.
--
-- Now: apply_task_create takes the per-student scope lock, validates the type, the cycle boundary and protected time under it, inserts the task and
-- its event in ONE transaction, and is idempotent per task id (the caller's key): the same request replays the stored task, a different request under
-- the same id is refused. System work (repair, re-check, mock, diagnostic) is created only by its own commands.
create or replace function public.apply_task_create(
  p_user uuid, p_id text, p_title text, p_detail text, p_type text, p_priority text, p_date date, p_starts timestamptz, p_minutes int
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.plan_blocks%rowtype; v_new public.plan_blocks%rowtype; v_cycle uuid; v_cs date; v_ce date; v_tz text;
  v_range tstzrange; v_title text; v_placement text; v_detail text;
begin
  perform public.scope_lock(p_user);
  if p_id is null or p_id !~ '^task-[0-9a-f-]{36}$' then return jsonb_build_object('ok', false, 'code', 'BAD_KEY'); end if;
  if p_type not in ('study', 'review', 'admin', 'other') then return jsonb_build_object('ok', false, 'code', 'BAD_TYPE'); end if;
  if p_title is null or length(btrim(p_title)) < 2 then return jsonb_build_object('ok', false, 'code', 'BAD_TITLE'); end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 180 then return jsonb_build_object('ok', false, 'code', 'BAD_DURATION'); end if;

  select * into v_old from public.plan_blocks where id = p_id;
  if found then
    if v_old.user_id = p_user and v_old.title = btrim(p_title) and v_old.local_date = p_date and v_old.starts_at is not distinct from p_starts
       and v_old.duration_minutes = p_minutes and v_old.task_type = p_type and v_old.origin = 'student' then
      return jsonb_build_object('ok', true, 'replayed', true, 'task', to_jsonb(v_old));
    end if;
    return jsonb_build_object('ok', false, 'code', 'KEY_REUSED');
  end if;

  v_tz := public.booking_tz(p_user);
  select id, starts_at_local::date, ends_at_local::date into v_cycle, v_cs, v_ce from public.planning_cycles where user_id = p_user and status = 'active';
  if v_cycle is not null and (p_date < v_cs or p_date > v_ce) then return jsonb_build_object('ok', false, 'code', 'OUTSIDE_CYCLE', 'start', v_cs, 'end', v_ce); end if;
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
      case when p_priority = 'optional' then 'optional' else 'core' end, v_placement, 'not_started', p_date, p_date::text, p_starts,
      p_minutes, p_minutes::text, 'You added this yourself.', false, 'student')
    returning * into v_new;
  exception when sqlstate 'BK409' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', 'MOCK', 'title', coalesce(v_detail, 'Your mock'));
  end;

  insert into public.task_events (user_id, task_id, event_type, payload, previous)
    values (p_user, p_id, 'created', jsonb_build_object('title', v_new.title, 'date', p_date, 'startsAt', p_starts, 'durationMinutes', p_minutes), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'replayed', false, 'task', to_jsonb(v_new));
end $$;
revoke all on function public.apply_task_create(uuid, text, text, text, text, text, date, timestamptz, int) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.apply_task_create(uuid, text, text, text, text, text, date, timestamptz, int) to service_role;
end if; end $$;
