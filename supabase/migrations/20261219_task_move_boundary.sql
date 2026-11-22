-- One scheduling mutation boundary for moving a single study task.
--
-- Before: Calendar's moveTask read the task, checked protected time in TypeScript, then updated (unlocked read-then-write), and the Coach's
-- confirm_coach_move had its own copy of the rules that never looked at protected commitments or classes. A class added between preview and
-- confirmation could be overlapped.
--
-- Now: apply_task_move takes the per-student scope lock FIRST (the same lock every writer of commitments, exceptions, availability windows, mocks and
-- tasks takes in a trigger), reads under it, validates, writes the task, its history event and returns. Calendar calls it through the service
-- role; confirm_coach_move calls it inside its own transaction together with the proposal outcome and receipt. A soft overlap with another task
-- stays a Calendar warning (preflight in the app); p_strict makes it a refusal, which is what the Coach's "free slot" promise needs.
--
-- Lock order: scope lock, then row locks. A writer that already holds a task row and then reaches its trigger's scope lock can deadlock with this;
-- Postgres aborts one transaction (40P01) and the caller may retry. Same exposure as the reservation protocol, no new failure mode.

create or replace function public.apply_task_move(
  p_user uuid, p_task text, p_revision int, p_date date, p_starts timestamptz, p_minutes int, p_strict boolean, p_source text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t public.plan_blocks%rowtype; v_new public.plan_blocks%rowtype; v_tz text; v_today date; v_cs date; v_ce date;
  v_range tstzrange; v_title text; v_reopen boolean; v_placement text; v_ev uuid; v_type text; v_moved boolean; v_detail text;
begin
  perform public.scope_lock(p_user);
  select * into v_t from public.plan_blocks where id = p_task and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_t.revision <> p_revision then return jsonb_build_object('ok', false, 'code', 'REVISION', 'revision', v_t.revision); end if;
  if v_t.cancelled_at is not null or v_t.execution = 'cancelled' then return jsonb_build_object('ok', false, 'code', 'CANCELLED'); end if;
  if v_t.learning_activity_id is not null then return jsonb_build_object('ok', false, 'code', 'RECORDED'); end if;
  if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_t.id and s.user_id = p_user) then return jsonb_build_object('ok', false, 'code', 'CONTINUED'); end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then return jsonb_build_object('ok', false, 'code', 'BAD_DURATION'); end if;

  v_tz := public.booking_tz(p_user);
  v_today := (now() at time zone v_tz)::date;
  if p_date is distinct from v_t.local_date and v_t.cycle_id is not null then
    select starts_at_local::date, ends_at_local::date into v_cs, v_ce from public.planning_cycles where id = v_t.cycle_id and user_id = p_user;
    if v_cs is not null and (p_date < v_cs or p_date > v_ce) then return jsonb_build_object('ok', false, 'code', 'OUTSIDE_CYCLE', 'start', v_cs, 'end', v_ce); end if;
  end if;
  if v_t.execution <> 'completed' and p_date < v_today and p_date is distinct from v_t.local_date then return jsonb_build_object('ok', false, 'code', 'PAST'); end if;
  if p_starts is not null and (p_starts at time zone v_tz)::date <> p_date then return jsonb_build_object('ok', false, 'code', 'BAD_SLOT'); end if;

  if p_starts is not null then
    v_range := tstzrange(p_starts, p_starts + make_interval(mins => p_minutes), '[)');
    select p.title into v_title from public.protected_occurrences(p_user, v_range) p limit 1;
    if v_title is null then
      select o.title into v_title from public.plan_blocks o
       where o.user_id = p_user and o.id <> v_t.id and o.is_protected_commitment and o.cancelled_at is null and o.placement = 'timed' and o.starts_at is not null
         and tstzrange(o.starts_at, o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)), '[)') && v_range limit 1;
    end if;
    if v_title is not null then return jsonb_build_object('ok', false, 'code', 'PROTECTED', 'title', v_title); end if;
    if p_strict then
      select o.title into v_title from public.plan_blocks o
       where o.user_id = p_user and o.id <> v_t.id and o.cancelled_at is null and o.placement = 'timed' and o.starts_at is not null
         and o.execution not in ('skipped', 'deferred', 'cancelled')
         and tstzrange(o.starts_at, o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)), '[)') && v_range limit 1;
      if v_title is not null then return jsonb_build_object('ok', false, 'code', 'SLOT_TAKEN', 'title', v_title); end if;
    end if;
  end if;

  v_reopen := v_t.execution = 'deferred';
  v_placement := case when p_starts is null then 'day_preferred' else 'timed' end;
  begin
    update public.plan_blocks set local_date = p_date, day = p_date::text, starts_at = p_starts, placement = v_placement,
      duration_minutes = p_minutes, duration = p_minutes::text, execution = case when v_reopen then 'not_started' else execution end
     where id = v_t.id and user_id = p_user returning * into v_new;
  exception when sqlstate 'BK409' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', 'MOCK', 'title', coalesce(v_detail, 'Your mock'));
  end;

  v_moved := v_t.local_date is distinct from p_date or v_t.starts_at is distinct from p_starts;
  v_type := case when v_reopen then 'placed' when v_t.duration_minutes is distinct from p_minutes and not v_moved then 'duration_changed' else 'moved' end;
  insert into public.task_events (user_id, task_id, event_type, payload, previous, notes)
    values (p_user, v_t.id, v_type,
      jsonb_build_object('local_date', p_date, 'starts_at', p_starts, 'duration_minutes', p_minutes, 'placement', v_placement) || case when v_reopen then '{"reopened":true}'::jsonb else '{}'::jsonb end,
      jsonb_build_object('local_date', v_t.local_date, 'starts_at', v_t.starts_at, 'duration_minutes', v_t.duration_minutes, 'placement', v_t.placement, 'execution', v_t.execution, 'revision', v_t.revision),
      case when p_source = 'coach' then 'Moved on your confirmation from the Coach' end)
    returning id into v_ev;
  return jsonb_build_object('ok', true, 'eventId', v_ev, 'reopened', v_reopen, 'placement', v_placement, 'task', to_jsonb(v_new));
end $$;
revoke all on function public.apply_task_move(uuid, text, int, date, timestamptz, int, boolean, text) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.apply_task_move(uuid, text, int, date, timestamptz, int, boolean, text) to service_role;
end if; end $$;

-- The Coach's confirmation: the Coach-only restrictions (open, not started, not a paper or re-check, saved study window when the preview used one),
-- then the shared boundary, then the proposal outcome and receipt, all in one transaction.
create or replace function public.confirm_coach_move(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_p public.coach_proposals%rowtype; v_m jsonb; v_t public.plan_blocks%rowtype; v_tz text; v_starts timestamptz;
  v_to date; v_min int; v_res jsonb; v_stale text; v_lo time; v_hi time;
begin
  if v_uid is null then raise exception 'Sign in to confirm a suggestion.' using errcode = '42501'; end if;
  perform public.scope_lock(v_uid);
  select * into v_p from public.coach_proposals where id = p_proposal_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_p.status = 'executed' then return jsonb_build_object('ok', true, 'replayed', true, 'applied', 1, 'receipt', v_p.proposed_changes->'receipt'); end if;
  if v_p.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'not_pending'); end if;
  if v_p.kind <> 'move_task' or coalesce((v_p.proposed_changes->>'version')::int, 0) <> 3 then
    update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'unreviewed_format');
  end if;
  v_m := v_p.proposed_changes->'move';
  v_to := (v_m->>'toDate')::date;
  v_starts := nullif(v_m->>'startsAt', '')::timestamptz;
  v_min := coalesce((v_m->>'minutes')::int, 30);
  select * into v_t from public.plan_blocks where id = v_m->>'id' and user_id = v_uid;
  v_tz := public.booking_tz(v_uid);
  v_stale := case
    when not found or v_t.revision <> (v_m->>'revision')::int then 'task_changed'
    when v_t.execution <> 'not_started' or v_t.is_protected_commitment or v_t.cancelled_at is not null or v_t.learning_activity_id is not null
      or v_t.task_type in ('diagnostic', 'recheck') then 'task_not_movable'
    when v_t.local_date is distinct from (v_m->>'fromDate')::date then 'task_changed'
  end;
  -- A preview that placed the task inside the student's saved study windows is only valid while some window still holds it.
  if v_stale is null and v_starts is not null and coalesce((v_m->>'windowed')::boolean, false) then
    if not exists (select 1 from public.availability_windows w where w.user_id = v_uid and w.status = 'active'
        and w.weekday = extract(dow from v_to)::int
        and w.start_time <= (v_starts at time zone v_tz)::time and w.end_time >= ((v_starts + make_interval(mins => v_min)) at time zone v_tz)::time) then
      v_stale := 'outside_availability';
    end if;
  end if;
  if v_stale is null then
    v_res := public.apply_task_move(v_uid, v_t.id, v_t.revision, v_to, v_starts, v_min, true, 'coach');
    if not (v_res->>'ok')::boolean then
      v_stale := case v_res->>'code' when 'REVISION' then 'task_changed' when 'CONTINUED' then 'continued' when 'PAST' then 'past_day'
        when 'OUTSIDE_CYCLE' then 'outside_cycle' when 'PROTECTED' then 'protected_booking' when 'MOCK' then 'protected_booking'
        when 'SLOT_TAKEN' then 'slot_taken' when 'BAD_SLOT' then 'bad_slot' else 'task_not_movable' end;
    end if;
  end if;
  if v_stale is not null then
    update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', v_stale);
  end if;
  update public.coach_proposals set status = 'executed', executed_at = now(), decided_at = now(),
    proposed_changes = proposed_changes || jsonb_build_object('applied', 1, 'receipt', jsonb_build_object('kind', 'placement', 'taskId', v_t.id, 'eventId', v_res->'eventId',
      'toDate', v_to, 'startsAt', v_starts, 'placement', v_res->>'placement', 'at', now()))
   where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'replayed', false, 'applied', 1,
    'receipt', jsonb_build_object('kind', 'placement', 'taskId', v_t.id, 'eventId', v_res->'eventId', 'toDate', v_to, 'startsAt', v_starts, 'placement', v_res->>'placement'));
end $$;
revoke all on function public.confirm_coach_move(uuid) from public, anon;
grant execute on function public.confirm_coach_move(uuid) to authenticated;
