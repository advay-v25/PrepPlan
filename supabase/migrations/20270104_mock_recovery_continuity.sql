-- Phase 3 closeout: recovery identity across weeks and splits, the real exam horizon, and idempotency keys bound to their requests.
-- Additive. Applied migrations are untouched: the two Phase 3 commands are patched in place from their EFFECTIVE definitions with checked anchors,
-- so every later patch to them (20270103's detail fix) is preserved.

-- 1. Request binding ----------------------------------------------------------------------------------------------------------------
-- Receipts written before this migration have no request_hash and keep replaying as they always did (no payload is invented for them).
alter table public.mock_report_commands add column if not exists request_hash text;

create or replace function public.mock_num(p text) returns text language sql immutable set search_path = '' as $$
  select case when nullif(p, '') ~ '^-?[0-9]+(\.[0-9]+)?$' then trim_scale(p::numeric)::text else nullif(p, '') end $$;

-- The semantic request of a report command: normalised so deliberate equivalence (topic order, blank vs absent fields, 48 vs 48.0, duplicate
-- difficulties) hashes the same and any material change does not. The expected version is part of the request, so an exact retry of a committed save
-- is never compared with the version it produced.
create or replace function public.mock_report_hash(p_action text, p_report uuid, p_expected integer, p_payload jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare v jsonb; p jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  v := jsonb_build_object('a', p_action, 'r', p_report, 'v', p_expected);
  if p_action <> 'withdraw' then
    v := v || jsonb_build_object('taken', p->>'taken_on', 'prov', nullif(btrim(coalesce(p->>'provider', '')), ''), 'scope', p->>'scope',
      'scale', coalesce(nullif(p->>'scale', ''), 'unknown'), 'score', public.mock_num(p->>'score'), 'max', public.mock_num(p->>'score_max'),
      'topics', coalesce((select jsonb_agg(jsonb_build_object('t', x->>'topicId', 's', x->>'scale', 'v', public.mock_num(x->>'value'), 'm', public.mock_num(x->>'max')) order by x->>'topicId')
                           from jsonb_array_elements(case when jsonb_typeof(p->'topics') = 'array' then p->'topics' else '[]'::jsonb end) x), '[]'::jsonb),
      'diff', coalesce((select jsonb_agg(d order by d) from (select distinct d from jsonb_array_elements_text(case when jsonb_typeof(p->'difficulties') = 'array' then p->'difficulties' else '[]'::jsonb end) d) q), '[]'::jsonb),
      'notes', nullif(btrim(coalesce(p->>'notes', '')), ''), 'legacy', nullif(p->>'legacy_outcome_id', ''));
  end if;
  return md5(v::text);
end $$;

-- The semantic request of a recovery acceptance: the report version the student reviewed, the selection (order-insensitive) and the removals they confirmed.
create or replace function public.mock_recovery_hash(p_version integer, p_selection jsonb) returns text language sql immutable set search_path = '' as $$
  select md5(jsonb_build_object('v', p_version,
    'items', coalesce((select jsonb_agg(jsonb_build_object('k', i->>'key', 'kind', i->>'kind', 'o', coalesce(i->>'outcomeId', ''), 'r', coalesce(i->>'readingId', ''), 'm', public.mock_num(i->>'minutes')) order by i->>'key')
                        from jsonb_array_elements(case when jsonb_typeof(p_selection->'items') = 'array' then p_selection->'items' else '[]'::jsonb end) i), '[]'::jsonb),
    'rm', coalesce((select jsonb_agg(d order by d) from (select distinct d from jsonb_array_elements_text(case when jsonb_typeof(p_selection->'remove') = 'array' then p_selection->'remove' else '[]'::jsonb end) d) q), '[]'::jsonb))::text) $$;

-- One authority for "has this key been used, and for what": null = unused; otherwise the answer to return.
create or replace function public.mock_command_replay(p_user uuid, p_key text, p_command text, p_report uuid, p_hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.mock_report_commands%rowtype;
begin
  select * into v from public.mock_report_commands where user_id = p_user and key = p_key;
  if not found then return null; end if;
  if v.command <> p_command or (p_report is not null and v.report_id is distinct from p_report) or (v.request_hash is not null and v.request_hash is distinct from p_hash) then
    return jsonb_build_object('ok', false, 'code', 'KEY_REUSED');
  end if;
  return v.result || jsonb_build_object('replayed', true);
end $$;
revoke all on function public.mock_command_replay(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.mock_command_replay(uuid, text, text, uuid, text) to service_role;

-- 2. The real exam horizon ------------------------------------------------------------------------------------------------------------
-- The same target the exam editor writes: a booked date (the last study day is the day before it) or the target sitting's opening day (study may run to it).
-- A student who has marked the exam as sat gets no new study allocation; their history stays readable.
create or replace function public.mock_recovery_horizon(p_user uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_exam date; v_win uuid; v_open date; v_sat date;
begin
  select exam_date, exam_window_id into v_exam, v_win from public.profiles where id = p_user;
  select sat_on into v_sat from public.exam_completion where user_id = p_user;
  if v_sat is not null then return jsonb_build_object('state', 'sat', 'last', null, 'kind', null, 'target', null); end if;
  if v_exam is not null then return jsonb_build_object('state', 'open', 'last', (v_exam - 1)::text, 'kind', 'booked', 'target', v_exam::text); end if;
  if v_win is not null then select window_opens into v_open from public.exam_windows where id = v_win; end if;
  if v_open is not null then return jsonb_build_object('state', 'open', 'last', v_open::text, 'kind', 'sitting', 'target', v_open::text); end if;
  return jsonb_build_object('state', 'none', 'last', null, 'kind', null, 'target', null);
end $$;
revoke all on function public.mock_recovery_horizon(uuid) from public, anon, authenticated;
grant execute on function public.mock_recovery_horizon(uuid) to service_role;

-- 3. Logical recovery identity ---------------------------------------------------------------------------------------------------------
-- One finding sitting has ONE logical identity (report + key). Its calendar occurrences are not duplicates: a weekly continuation is the next occurrence of
-- the same work, and a manual split is a sibling in the same scope group. A row is refused only when a live holder of the key is unrelated to it.
drop index if exists public.plan_blocks_report_source_idx;
create unique index if not exists plan_blocks_report_source_root_idx on public.plan_blocks (source_report_id, source_key)
  where source_report_id is not null and source_key is not null and cancelled_at is null and continued_from_task_id is null and scope_group_id is null;

create or replace function public.guard_source_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_report_id is null or new.source_key is null or new.cancelled_at is not null then return new; end if;
  perform public.scope_lock(new.user_id);
  if exists (
    with recursive seed(id) as (
      select new.continued_from_task_id where new.continued_from_task_id is not null
      union select m.id from public.plan_blocks m where new.scope_group_id is not null and m.user_id = new.user_id and m.scope_group_id = new.scope_group_id
    ), rel(id) as (
      select id from seed union select p.continued_from_task_id from public.plan_blocks p join rel on p.id = rel.id where p.continued_from_task_id is not null
    )
    select 1 from public.plan_blocks h
    where h.source_report_id = new.source_report_id and h.source_key = new.source_key and h.cancelled_at is null and h.id <> new.id
      and h.id not in (select id from rel)
  ) then
    raise exception 'duplicate recovery work for this report and finding' using errcode = '23505', constraint = 'plan_blocks_report_source_idx';
  end if;
  return new;
end $$;
-- Named after the lineage guard so it runs after it (lineage is validated or cleared first).
drop trigger if exists plan_blocks_source_identity on public.plan_blocks;
create trigger plan_blocks_source_identity before insert on public.plan_blocks for each row execute function public.guard_source_identity();

-- 4. save_mock_report: bind the key to the request (in-place patch of the effective definition) -------------------------------------------------
do $patch$
declare definition text; fn text := 'public.save_mock_report(uuid,text,text,uuid,integer,jsonb)';
  a1 text := $a$if v_cmd.command <> p_action or (p_report_id is not null and v_cmd.report_id is distinct from p_report_id) then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;$a$;
  b1 text := $b$if v_cmd.command <> p_action or (p_report_id is not null and v_cmd.report_id is distinct from p_report_id)
       or (v_cmd.request_hash is not null and v_cmd.request_hash is distinct from public.mock_report_hash(p_action, p_report_id, p_expected_version, p_payload)) then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;$b$;
  a2 text := 'insert into public.mock_report_commands (user_id, key, command, report_id, result) values (p_user, p_key, p_action, v_r.id, v_res);';
  b2 text := 'insert into public.mock_report_commands (user_id, key, command, report_id, result, request_hash) values (p_user, p_key, p_action, v_r.id, v_res, public.mock_report_hash(p_action, p_report_id, p_expected_version, p_payload));';
begin
  definition := pg_get_functiondef(fn::regprocedure);
  if position(a1 in definition) = 0 or position(a2 in definition) = 0 then raise exception 'Unexpected save_mock_report definition'; end if;
  execute replace(replace(definition, a1, b1), a2, b2);
end
$patch$;

-- 5. accept_mock_recovery: bind the key, enforce the exam horizon, and keep recorded choices from being silently erased ------------------------
do $patch$
declare definition text; fn text := 'public.accept_mock_recovery(uuid,text,uuid,integer,uuid,jsonb,jsonb)';
  a1 text := $a$if v_cmd.command <> 'accept_recovery' or v_cmd.report_id is distinct from p_report_id then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;$a$;
  b1 text := $b$if v_cmd.command <> 'accept_recovery' or v_cmd.report_id is distinct from p_report_id
       or (v_cmd.request_hash is not null and v_cmd.request_hash is distinct from public.mock_recovery_hash(p_report_version, p_selection)) then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;$b$;
  -- the horizon is read under the profile share-lock this function already holds, so an exam edit and this acceptance serialise one way or the other
  a2 text := 'v_limit := coalesce(v_limit, 90);';
  b2 text := $b$v_limit := coalesce(v_limit, 90);
  v_h := public.mock_recovery_horizon(p_user);
  if jsonb_array_length(v_tasks) > 0 and v_h->>'state' = 'sat' then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'You have marked your exam as sat, so no new study is planned.'); end if;
  if jsonb_array_length(v_tasks) > 0 and v_h->>'last' is not null and exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'local_date')::date > (v_h->>'last')::date) then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Your exam date changed since you reviewed the plan, and a sitting now falls after your last study day.'); end if;
  -- a recorded choice that is dropped must be dropped on purpose
  if exists (select 1 from jsonb_array_elements(coalesce(v_r.plan_selection->'items', '[]'::jsonb)) o
              where not exists (select 1 from jsonb_array_elements(coalesce(p_selection->'items', '[]'::jsonb)) n where n->>'key' = o->>'key')
                and not exists (select 1 from jsonb_array_elements_text(coalesce(p_selection->'remove', '[]'::jsonb)) x where x = o->>'key')) then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'This would drop work you had chosen earlier. Confirm the removal first; nothing was changed.'); end if;$b$;
  a3 text := $a$update public.mock_reports set plan_selection = coalesce(p_selection, plan_selection) where id = p_report_id;$a$;
  b3 text := $b$update public.mock_reports set plan_selection = coalesce(jsonb_build_object('items', p_selection->'items'), plan_selection) where id = p_report_id;$b$;
  a4 text := $a$insert into public.mock_report_commands (user_id, key, command, report_id, result) values (p_user, p_key, 'accept_recovery', p_report_id, v_res);$a$;
  b4 text := $b$insert into public.mock_report_commands (user_id, key, command, report_id, result, request_hash) values (p_user, p_key, 'accept_recovery', p_report_id, v_res, public.mock_recovery_hash(p_report_version, p_selection));$b$;
  -- logical identity: work for a finding that already has a live, finished or partly-done sitting in ANY week is not planned again
  a5 text := '    -- identity: the same finding sitting can exist once (open), whatever its title';
  b5 text := $b$    if exists (select 1 from jsonb_array_elements(v_tasks) t join public.plan_blocks p on p.user_id = p_user and p.source_report_id = p_report_id
                 and regexp_replace(p.source_key, ':[0-9]+$', '') = regexp_replace(t->>'source_key', ':[0-9]+$', '') and p.cancelled_at is null and p.execution <> 'cancelled'
                 and (p.execution = 'completed' or (p.execution <> 'skipped' and (p.cycle_id = p_cycle_id or exists (select 1 from public.plan_blocks s where s.continued_from_task_id = p.id))))) then
      return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Some of this work is already planned or done.'); end if;
    -- identity: the same finding sitting can exist once (open), whatever its title$b$;
begin
  definition := pg_get_functiondef(fn::regprocedure);
  if position(a1 in definition) = 0 or position(a2 in definition) = 0 or position(a3 in definition) = 0 or position(a4 in definition) = 0 or position(a5 in definition) = 0
     or position('v_tasks jsonb := coalesce(p_tasks' in definition) = 0 then raise exception 'Unexpected accept_mock_recovery definition'; end if;
  definition := replace(definition, 'v_tasks jsonb := coalesce(p_tasks', 'v_h jsonb; v_tasks jsonb := coalesce(p_tasks');
  execute replace(replace(replace(replace(replace(definition, a1, b1), a2, b2), a3, b3), a4, b4), a5, b5);
end
$patch$;
notify pgrst, 'reload schema';
