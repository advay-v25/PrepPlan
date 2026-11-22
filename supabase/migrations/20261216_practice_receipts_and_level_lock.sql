-- T3 closeout. (1) Durable per-operation receipts for adaptive practice, so a lost response can be retried at ANY later time and returns the
-- ORIGINAL set; a lone mutable last_request_key could not. (2) The paper and practice reservations take FOR KEY SHARE on the selected question
-- rows BEFORE comparing confirmed levels, and confirm_item_difficulty already takes FOR UPDATE on the same row, so a reclassification can no longer
-- commit between the accepted-level comparison and the form's difficulty freeze: the reservation either pins the levels it accepted or refuses.
-- Evidence writers (finalize / challenge raise+resolve) and scope writers already serialise on scope_lock(user) through the scope_write_lock
-- triggers on evidence_events, assessment_attempts and the planning tables; that protocol is unchanged and proven by scripts/difficulty-race-db-test.cjs.

create table if not exists public.practice_run_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  op text not null check (op in ('start', 'next')),
  run_id uuid not null references public.practice_runs(id) on delete cascade,
  block_no int not null,
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  scope_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
alter table public.practice_run_receipts enable row level security;
revoke all on public.practice_run_receipts from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant all on public.practice_run_receipts to service_role; end if; end $$;

create or replace function public._practice_scope_hash(p_reading text, p_outcomes text[], p_cap int) returns text language sql immutable set search_path = '' as $$
  select md5(coalesce(p_reading, '') || '|' || coalesce((select string_agg(x, ',' order by x) from unnest(coalesce(p_outcomes, '{}'::text[])) x), '') || '|' || coalesce(p_cap, 0))
$$;
create or replace function public._practice_def_hash(p_def jsonb) returns text language sql immutable set search_path = '' as $$
  select public._practice_scope_hash(p_def->>'readingId', array(select jsonb_array_elements_text(coalesce(p_def->'outcomeIds', '[]'::jsonb))), (p_def->>'cap')::int)
$$;

insert into public.practice_run_receipts(user_id, request_key, op, run_id, block_no, attempt_id, scope_hash)
  select r.user_id, r.request_key, 'start', r.id, 1, s.attempt_id, public._practice_scope_hash(r.reading_id, r.outcome_ids, r.cap)
    from public.practice_runs r join public.practice_run_sets s on s.run_id = r.id and s.block_no = 1
  on conflict do nothing;
insert into public.practice_run_receipts(user_id, request_key, op, run_id, block_no, attempt_id, scope_hash)
  select r.user_id, r.last_request_key, 'next', r.id, s.block_no, s.attempt_id, public._practice_scope_hash(r.reading_id, r.outcome_ids, r.cap)
    from public.practice_runs r join lateral (select * from public.practice_run_sets x where x.run_id = r.id order by x.block_no desc limit 1) s on true
   where r.last_request_key is not null and r.last_request_key <> r.request_key and s.block_no > 1
  on conflict do nothing;

-- A successful operation owned by this student, or null. The key is bound to its user, operation, run and scope; reuse for anything else is a conflict.
create or replace function public.practice_run_receipt(p_user uuid, p_request_key text, p_run uuid, p_def jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_r public.practice_run_receipts%rowtype; v_run public.practice_runs%rowtype;
begin
  if p_request_key is null then return null; end if;
  select * into v_r from public.practice_run_receipts where user_id = p_user and request_key = p_request_key;
  if not found then return null; end if;
  if v_r.scope_hash is distinct from public._practice_def_hash(p_def) or (p_run is null) is distinct from (v_r.op = 'start') or (p_run is not null and v_r.run_id <> p_run) then
    return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT');
  end if;
  select * into v_run from public.practice_runs where id = v_r.run_id;
  return jsonb_build_object('ok', true, 'resumed', true, 'replay', true, 'runId', v_r.run_id, 'attemptId', v_r.attempt_id, 'block', v_r.block_no, 'revision', v_run.revision, 'runStatus', v_run.status);
end $$;
revoke all on function public.practice_run_receipt(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.practice_run_receipt(uuid, text, uuid, jsonb) to service_role;

-- Lock the selected question rows (shared, in id order) and compare their confirmed levels with the ones the student accepted.
create or replace function public._lock_check_levels(p_item_ids jsonb, p_levels jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_now jsonb;
begin
  perform 1 from public.assessment_items where id in (select jsonb_array_elements_text(p_item_ids)) order by id for key share;
  if p_levels is null then return true; end if;
  select coalesce(jsonb_object_agg(x.id, coalesce(c.level, '')), '{}'::jsonb) into v_now
    from (select jsonb_array_elements_text(p_item_ids) id) x
    left join public.assessment_items i on i.id = x.id
    left join public.item_confirmed_difficulty c on c.item_id = x.id and c.item_version = i.item_version;
  return v_now is not distinct from p_levels;
end $$;
revoke all on function public._lock_check_levels(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public._lock_check_levels(jsonb, jsonb) to service_role;

create or replace function public.start_paper_checked(p_user uuid, p_evidence text, p_levels jsonb, p_paper jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.scope_lock(p_user);
  if p_evidence is not null and public.difficulty_evidence_version(p_user) is distinct from p_evidence then
    return jsonb_build_object('ok', false, 'code', 'DECISION_CHANGED');
  end if;
  if not public._lock_check_levels(p_paper->'itemIds', p_levels) then return jsonb_build_object('ok', false, 'code', 'DECISION_CHANGED'); end if;
  return public._reserve_paper_json(p_user, p_paper);
end $$;

create or replace function public.practice_run_reserve(p_user uuid, p_run uuid, p_request_key text, p_expected_revision int, p_def jsonb, p_decision jsonb, p_paper jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.practice_runs%rowtype; v_block int; v_last record; v_total int; v_res jsonb; v_rc jsonb; v_size int := jsonb_array_length(p_paper->'itemIds');
begin
  perform pg_advisory_xact_lock(hashtextextended('practice-runs:' || p_user::text, 0));
  -- A successful operation is resolved FIRST: it never re-checks cap, stopped state, revision or inventory.
  v_rc := public.practice_run_receipt(p_user, p_request_key, p_run, p_def);
  if v_rc is not null then return v_rc; end if;
  if v_size <> 5 then return jsonb_build_object('ok', false, 'code', 'BAD_SET'); end if;
  if p_run is null then
    v_block := 1;
  else
    select * into v_run from public.practice_runs where id = p_run and user_id = p_user for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    select s.attempt_id, s.block_no, a.status into v_last from public.practice_run_sets s join public.assessment_attempts a on a.id = s.attempt_id where s.run_id = v_run.id order by s.block_no desc limit 1;
    if v_run.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'RUN_CLOSED'); end if;
    if v_run.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'STALE_RUN', 'revision', v_run.revision); end if;
    if v_last.status not in ('submitted', 'scored', 'rescored', 'partially_voided', 'expired') then return jsonb_build_object('ok', false, 'code', 'SET_OPEN', 'attemptId', v_last.attempt_id); end if;
    select coalesce(sum(size), 0) into v_total from public.practice_run_sets where run_id = v_run.id;
    if v_total + v_size > v_run.cap then return jsonb_build_object('ok', false, 'code', 'CAP_REACHED'); end if;
    v_block := v_last.block_no + 1;
  end if;
  if not public._lock_check_levels(p_paper->'itemIds', p_paper->'levels') then return jsonb_build_object('ok', false, 'code', 'DECISION_CHANGED'); end if;
  if p_run is null then
    insert into public.practice_runs(user_id, request_key, last_request_key, reading_id, outcome_ids, cap, policy_version)
      values (p_user, p_request_key, p_request_key, p_def->>'readingId', array(select jsonb_array_elements_text(coalesce(p_def->'outcomeIds', '[]'::jsonb)) order by 1), (p_def->>'cap')::int, p_def->>'policy')
      returning * into v_run;
  end if;
  v_res := public._reserve_paper_json(p_user, p_paper || jsonb_build_object('openKey', 'practice-run:' || v_run.id || ':' || v_block));
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    if p_run is null then delete from public.practice_runs where id = v_run.id; end if;
    return v_res;
  end if;
  insert into public.practice_run_sets(run_id, block_no, attempt_id, size, decision) values (v_run.id, v_block, (v_res->>'attemptId')::uuid, v_size, p_decision);
  insert into public.practice_run_receipts(user_id, request_key, op, run_id, block_no, attempt_id, scope_hash)
    values (p_user, p_request_key, case when p_run is null then 'start' else 'next' end, v_run.id, v_block, (v_res->>'attemptId')::uuid, public._practice_def_hash(p_def));
  update public.practice_runs set revision = revision + 1, last_request_key = p_request_key, updated_at = now() where id = v_run.id returning * into v_run;
  return jsonb_build_object('ok', true, 'resumed', false, 'runId', v_run.id, 'attemptId', v_res->>'attemptId', 'revision', v_run.revision, 'block', v_block);
end $$;

notify pgrst, 'reload schema';
