-- Coach slice 2. Additive except two function signatures that replace the unreleased 20261217 turn functions.
--  1. A turn key is bound to the original message (request_hash): reuse with a different payload is a conflict, never a reinterpretation.
--  2. One worker owns an in-flight turn through a lease token; late workers are fenced at finish and at every model reservation.
--  3. Outbound model calls are reserved in their own table BEFORE dispatch. Clearing visible history does not reset that budget.
--  4. Clear is one transaction under the same per-student lock as begin/finish.
--  5. confirm_coach_move: a reviewed single-task placement applied atomically with Calendar's move rules, its event and the receipt.
-- confirm_coach_proposal (deferral) is left exactly as it is.

alter table public.coach_messages add column if not exists request_hash text;
alter table public.coach_messages add column if not exists lease_token uuid;
alter table public.coach_messages add column if not exists lease_until timestamptz;
alter table public.coach_messages add column if not exists turn_meta jsonb;

create table if not exists public.coach_model_calls (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  turn_key text,
  token uuid,
  state text not null default 'reserved' check (state in ('reserved', 'succeeded', 'failed', 'indeterminate')),
  created_at timestamptz not null default now()
);
create index if not exists coach_model_calls_user_time_idx on public.coach_model_calls (user_id, created_at desc);
alter table public.coach_model_calls enable row level security;
revoke all on public.coach_model_calls from public, anon, authenticated;
revoke all on sequence public.coach_model_calls_id_seq from public, anon, authenticated;

drop function if exists public.coach_turn_begin(uuid, text, text, text, int);
drop function if exists public.coach_turn_finish(uuid, text, text, text, jsonb, uuid, jsonb);

create or replace function public.coach_turn_begin(p_user uuid, p_key text, p_body text, p_intent text, p_limit int, p_hash text, p_lease_secs int default 45)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.coach_messages%rowtype; v_c public.coach_messages%rowtype; v_n int; v_tok uuid := gen_random_uuid();
begin
  if p_key is null or char_length(p_key) not between 8 and 80 then raise exception 'bad turn key'; end if;
  if p_hash is null or char_length(p_hash) not between 8 and 128 then raise exception 'bad request hash'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  select * into v_s from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'student';
  if found then
    if v_s.request_hash is distinct from p_hash then return jsonb_build_object('state', 'conflict'); end if;
    select * into v_c from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'coach';
    if found then return jsonb_build_object('state', 'replay', 'studentId', v_s.id, 'coachId', v_c.id); end if;
    if v_s.lease_until is not null and v_s.lease_until > now() then return jsonb_build_object('state', 'busy', 'studentId', v_s.id); end if;
    -- The previous worker's lease ran out: whatever it had in flight is unknowable, so it is recorded as indeterminate and fenced out.
    update public.coach_model_calls set state = 'indeterminate' where user_id = p_user and turn_key = p_key and state = 'reserved';
    update public.coach_messages set lease_token = v_tok, lease_until = now() + make_interval(secs => p_lease_secs) where id = v_s.id;
    return jsonb_build_object('state', 'resume', 'studentId', v_s.id, 'token', v_tok);
  end if;
  select count(*) into v_n from public.coach_messages where user_id = p_user and role = 'student' and created_at >= now() - interval '1 hour';
  if v_n >= p_limit then return jsonb_build_object('state', 'limited'); end if;
  insert into public.coach_messages (user_id, role, body, intent, turn_key, request_hash, lease_token, lease_until)
    values (p_user, 'student', left(p_body, 4000), p_intent, p_key, p_hash, v_tok, now() + make_interval(secs => p_lease_secs)) returning * into v_s;
  return jsonb_build_object('state', 'new', 'studentId', v_s.id, 'token', v_tok);
end $$;

-- Reserve one outbound model request for the turn this worker owns. Counts every dispatch (including retries and fallbacks).
create or replace function public.coach_model_reserve(p_user uuid, p_key text, p_token uuid, p_limit int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_n int; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  if not exists (select 1 from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'student' and lease_token = p_token and lease_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'fenced');
  end if;
  select count(*) into v_n from public.coach_model_calls where user_id = p_user and created_at >= now() - interval '1 hour';
  if v_n >= p_limit then return jsonb_build_object('ok', false, 'reason', 'budget'); end if;
  insert into public.coach_model_calls (user_id, turn_key, token) values (p_user, p_key, p_token) returning id into v_id;
  return jsonb_build_object('ok', true, 'callId', v_id);
end $$;

create or replace function public.coach_model_settle(p_user uuid, p_call bigint, p_state text)
returns void language sql security definer set search_path = '' as $$
  update public.coach_model_calls set state = p_state where id = p_call and user_id = p_user and state = 'reserved' and p_state in ('succeeded', 'failed', 'indeterminate');
$$;

create or replace function public.coach_turn_finish(p_user uuid, p_key text, p_token uuid, p_body text, p_intent text, p_links jsonb, p_cycle uuid, p_proposals jsonb, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.coach_messages%rowtype; v_c public.coach_messages%rowtype; v_ids uuid[]; v_p jsonb; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  select * into v_c from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'coach';
  if found then return jsonb_build_object('coachId', v_c.id, 'replayed', true); end if;
  select * into v_s from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'student';
  if not found then return jsonb_build_object('error', 'NO_TURN'); end if;   -- cleared mid-turn: nothing is added
  if v_s.lease_token is distinct from p_token then return jsonb_build_object('error', 'FENCED'); end if;
  insert into public.coach_messages (user_id, role, body, intent, links, turn_key, turn_meta)
    values (p_user, 'coach', left(p_body, 4000), p_intent, coalesce(p_links, '[]'::jsonb), p_key, p_meta) returning * into v_c;
  v_ids := '{}';
  for v_p in select value from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) loop
    insert into public.coach_proposals (user_id, message_id, intent, kind, title, reasoning, proposed_changes, origin, status, target_cycle_id)
      values (p_user, v_c.id, v_p->>'kind', v_p->>'kind', v_p->>'title', v_p->>'reasoning', v_p->'changes', 'coach', 'pending', p_cycle) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  update public.coach_messages set proposal_ids = v_ids where id = v_c.id;
  update public.coach_messages set lease_until = null where id = v_s.id;
  return jsonb_build_object('coachId', v_c.id, 'replayed', false);
end $$;

-- Clear: pending proposals are rejected and the conversation is deleted in ONE transaction, serialised with begin/finish.
-- A proposal confirmed first is already 'executed' (the row lock orders them) and is retained as the record of what changed.
create or replace function public.coach_clear_history(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r int; v_m int;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  update public.coach_proposals set status = 'rejected', decided_at = now() where user_id = p_user and origin = 'coach' and status = 'pending';
  get diagnostics v_r = row_count;
  delete from public.coach_messages where user_id = p_user;
  get diagnostics v_m = row_count;
  return jsonb_build_object('rejected', v_r, 'deleted', v_m);
end $$;

-- A reviewed placement of ONE study task. Same rules as Calendar's move (revision, not continued, not recorded learning, today-or-later,
-- inside the cycle, protected bookings refused) plus: the slot must be free of every other timed task, so no overlap acknowledgement is needed.
create or replace function public.confirm_coach_move(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_p public.coach_proposals%rowtype; v_m jsonb; v_t public.plan_blocks%rowtype;
  v_tz text; v_today date; v_to date; v_starts timestamptz; v_cs date; v_ce date; v_ev uuid; v_placement text; v_stale text;
begin
  if v_uid is null then raise exception 'Sign in to confirm a suggestion.' using errcode = '42501'; end if;
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
  select * into v_t from public.plan_blocks where id = v_m->>'id' and user_id = v_uid for update;
  select coalesce(nullif(timezone, ''), 'UTC') into v_tz from public.profiles where id = v_uid;
  v_today := (now() at time zone v_tz)::date;
  v_stale := case
    when not found or v_t.revision <> (v_m->>'revision')::int then 'task_changed'
    when v_t.execution <> 'not_started' or v_t.is_protected_commitment or v_t.cancelled_at is not null or v_t.learning_activity_id is not null
      or v_t.task_type in ('diagnostic', 'recheck') then 'task_not_movable'
    when v_t.local_date is distinct from (v_m->>'fromDate')::date then 'task_changed'
    when exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_t.id) then 'continued'
    when v_to < v_today then 'past_day'
    when v_starts is not null and (v_starts at time zone v_tz)::date <> v_to then 'bad_slot'
  end;
  if v_stale is null and v_t.cycle_id is not null then
    select starts_at_local::date, ends_at_local::date into v_cs, v_ce from public.planning_cycles where id = v_t.cycle_id and user_id = v_uid;
    if v_cs is not null and (v_to < v_cs or v_to > v_ce) then v_stale := 'outside_cycle'; end if;
  end if;
  if v_stale is null and v_starts is not null and exists (
    select 1 from public.plan_blocks o where o.user_id = v_uid and o.id <> v_t.id and o.cancelled_at is null and o.starts_at is not null
      and o.execution not in ('skipped', 'deferred')
      and o.starts_at < v_starts + make_interval(mins => coalesce(v_t.duration_minutes, 30)) and o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > v_starts) then
    v_stale := 'slot_taken';
  end if;
  if v_stale is not null then
    update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', v_stale);
  end if;

  v_placement := case when v_starts is null then 'day_preferred' else 'timed' end;
  begin
    update public.plan_blocks set local_date = v_to, day = v_to, starts_at = v_starts, placement = v_placement where id = v_t.id and user_id = v_uid;
  exception when sqlstate 'BK409' then
    -- the protected-booking guard: the whole move is refused, nothing else was written yet
    update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'protected_booking');
  end;
  insert into public.task_events (user_id, task_id, event_type, payload, previous, notes)
    values (v_uid, v_t.id, 'moved',
      jsonb_build_object('local_date', v_to, 'starts_at', v_starts, 'duration_minutes', v_t.duration_minutes, 'placement', v_placement),
      jsonb_build_object('local_date', v_t.local_date, 'starts_at', v_t.starts_at, 'duration_minutes', v_t.duration_minutes, 'placement', v_t.placement, 'execution', v_t.execution, 'revision', v_t.revision),
      'Moved on your confirmation from the Coach')
    returning id into v_ev;
  update public.coach_proposals set status = 'executed', executed_at = now(), decided_at = now(),
    proposed_changes = proposed_changes || jsonb_build_object('applied', 1, 'receipt', jsonb_build_object('kind', 'placement', 'taskId', v_t.id, 'eventId', v_ev,
      'toDate', v_to, 'startsAt', v_starts, 'placement', v_placement, 'at', now()))
   where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'replayed', false, 'applied', 1,
    'receipt', jsonb_build_object('kind', 'placement', 'taskId', v_t.id, 'eventId', v_ev, 'toDate', v_to, 'startsAt', v_starts, 'placement', v_placement));
end $$;

revoke all on function public.coach_turn_begin(uuid, text, text, text, int, text, int) from public, anon, authenticated;
revoke all on function public.coach_model_reserve(uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.coach_model_settle(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.coach_turn_finish(uuid, text, uuid, text, text, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.coach_clear_history(uuid) from public, anon, authenticated;
revoke all on function public.confirm_coach_move(uuid) from public, anon;
grant execute on function public.confirm_coach_move(uuid) to authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.coach_turn_begin(uuid, text, text, text, int, text, int) to service_role;
  grant execute on function public.coach_model_reserve(uuid, text, uuid, int) to service_role;
  grant execute on function public.coach_model_settle(uuid, bigint, text) to service_role;
  grant execute on function public.coach_turn_finish(uuid, text, uuid, text, text, jsonb, uuid, jsonb, jsonb) to service_role;
  grant execute on function public.coach_clear_history(uuid) to service_role;
  grant all on public.coach_model_calls to service_role;
  grant usage, select on sequence public.coach_model_calls_id_seq to service_role;
end if; end $$;
