-- Phase 3: independent past mock reports (no booking required), an owner-checked idempotent command, and one atomic recovery acceptance.
-- Additive. Nothing historical is rewritten: mock_outcomes and mock_appointments keep their rows, the in-app rehearsal ledger is untouched, and an
-- external report never creates evidence, coverage or repair closure (nothing here writes those tables).

create table if not exists public.mock_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  taken_on date not null check (taken_on >= date '2020-01-01'),
  provider text check (provider is null or char_length(provider) between 1 and 80),
  scope text not null check (scope in ('full', 'partial')),
  scale text not null check (scale in ('percent', 'marks', 'percentile', 'unknown')),
  score numeric check (score is null or score >= 0),
  score_max numeric check (score_max is null or score_max > 0),
  topics jsonb not null default '[]'::jsonb,
  difficulties text[] not null default '{}',
  notes text check (notes is null or char_length(notes) <= 500),
  -- an old free-text mock outcome this report was structured FROM; the original text there is never rewritten
  legacy_outcome_id uuid references public.mock_outcomes(id) on delete set null,
  -- what the student chose to work on after the debrief (kept so unplaced work is not lost between weeks)
  plan_selection jsonb,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (scale <> 'marks' or ((score is null) = (score_max is null))),
  check (scale = 'marks' or score_max is null),
  check (scale <> 'percent' or score is null or score <= 100),
  check (scale <> 'percentile' or score is null or score <= 100),
  check (scale <> 'marks' or score is null or score <= score_max)
);
create index if not exists mock_reports_user_taken on public.mock_reports (user_id, taken_on desc);

create table if not exists public.mock_report_commands (
  user_id uuid not null references auth.users on delete cascade,
  key text not null check (char_length(key) between 8 and 80),
  command text not null,
  report_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.mock_reports enable row level security;
alter table public.mock_report_commands enable row level security;
drop policy if exists "Users read their own mock reports" on public.mock_reports;
create policy "Users read their own mock reports" on public.mock_reports for select using (auth.uid() = user_id);
revoke all on public.mock_reports, public.mock_report_commands from public, anon, authenticated;
grant select on public.mock_reports to authenticated;

-- Provenance and identity of recovery work. A source key names ONE sitting of ONE finding, so a repeated acceptance can never duplicate it.
alter table public.plan_blocks add column if not exists source_report_id uuid references public.mock_reports(id) on delete set null;
alter table public.plan_blocks add column if not exists source_key text;
alter table public.plan_blocks add column if not exists source_report_version integer;
create unique index if not exists plan_blocks_report_source_idx on public.plan_blocks (source_report_id, source_key)
  where source_report_id is not null and source_key is not null and cancelled_at is null;

create or replace function public.mock_report_updated() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists mock_reports_updated on public.mock_reports;
create trigger mock_reports_updated before update on public.mock_reports for each row execute function public.mock_report_updated();
-- A report change takes the per-student scheduling lock like every other writer of scope-relevant rows.
drop trigger if exists scope_write_lock on public.mock_reports;
create trigger scope_write_lock before insert or update or delete on public.mock_reports for each row execute function public.scope_write_lock();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- save_mock_report: create / edit / withdraw, one transaction, one idempotency key per command, expected-version on edits.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.save_mock_report(p_user uuid, p_key text, p_action text, p_report_id uuid, p_expected_version integer, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cmd public.mock_report_commands%rowtype; v_r public.mock_reports%rowtype; v_tz text; v_today date; v_taken date; v_scale text; v_score numeric; v_max numeric;
  v_topics jsonb := coalesce(p_payload->'topics', '[]'::jsonb); v_diff text[]; t jsonb; v_res jsonb; v_prov text; v_notes text; v_scope text;
begin
  if p_user is null or coalesce(btrim(p_key), '') = '' or char_length(p_key) not between 8 and 80 then raise exception 'Invalid key'; end if;
  if p_action not in ('create', 'edit', 'withdraw') then raise exception 'Invalid action'; end if;
  perform public.scope_lock(p_user);
  select * into v_cmd from public.mock_report_commands where user_id = p_user and key = p_key;
  if found then
    if v_cmd.command <> p_action or (p_report_id is not null and v_cmd.report_id is distinct from p_report_id) then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    return v_cmd.result || jsonb_build_object('replayed', true);
  end if;

  if p_action = 'withdraw' or p_action = 'edit' then
    select * into v_r from public.mock_reports where id = p_report_id and user_id = p_user for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    if v_r.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'WITHDRAWN'); end if;
    if p_expected_version is distinct from v_r.version then return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'currentVersion', v_r.version); end if;
    if p_action = 'withdraw' then
      update public.mock_reports set status = 'withdrawn', version = version + 1 where id = v_r.id returning * into v_r;
      v_res := jsonb_build_object('ok', true, 'report', to_jsonb(v_r));
      insert into public.mock_report_commands (user_id, key, command, report_id, result) values (p_user, p_key, p_action, v_r.id, v_res);
      return v_res;
    end if;
  end if;

  v_tz := public.booking_tz(p_user);
  v_today := (clock_timestamp() at time zone v_tz)::date;
  begin v_taken := (p_payload->>'taken_on')::date; exception when others then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Enter the date the mock was taken.'); end;
  if v_taken is null or v_taken > v_today or v_taken < date '2020-01-01' then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'The date taken must be a real past date.'); end if;
  v_scope := p_payload->>'scope';
  if v_scope not in ('full', 'partial') then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Say whether it was a full or a partial exam.'); end if;
  v_scale := coalesce(nullif(p_payload->>'scale', ''), 'unknown');
  if v_scale not in ('percent', 'marks', 'percentile', 'unknown') then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Unknown score type.'); end if;
  begin v_score := nullif(p_payload->>'score', '')::numeric; v_max := nullif(p_payload->>'score_max', '')::numeric; exception when others then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Scores must be numbers.'); end;
  if v_score is not null and v_score < 0 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A score cannot be negative.'); end if;
  if v_scale in ('percent', 'percentile') and (v_score > 100 or v_max is not null) then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A percentage or percentile is between 0 and 100.'); end if;
  if v_scale = 'marks' and ((v_score is null) <> (v_max is null) or v_max <= 0 or v_score > v_max) then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Marks need both the marks you scored and the total, and cannot exceed it.'); end if;
  if v_scale = 'unknown' and v_max is not null then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A score of unknown type has no total.'); end if;
  if jsonb_typeof(v_topics) <> 'array' or jsonb_array_length(v_topics) > 12 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Too many topic results.'); end if;
  for t in select * from jsonb_array_elements(v_topics) loop
    if not exists (select 1 from public.topics tp where tp.id = t->>'topicId') then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Unknown subject in a topic result.'); end if;
    if coalesce(t->>'scale', '') not in ('percent', 'marks', 'percentile', 'unknown') or coalesce(t->>'value', '') !~ '^[0-9]+(\.[0-9]+)?$' then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A topic result needs a number and its type.'); end if;
    if (t->>'scale') in ('percent', 'percentile') and (t->>'value')::numeric > 100 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A topic percentage is between 0 and 100.'); end if;
    if (t->>'scale') = 'marks' and (coalesce(t->>'max', '') !~ '^[0-9]+(\.[0-9]+)?$' or (t->>'max')::numeric <= 0 or (t->>'value')::numeric > (t->>'max')::numeric) then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Topic marks need a total and cannot exceed it.'); end if;
  end loop;
  if (select count(distinct x->>'topicId') from jsonb_array_elements(v_topics) x) <> jsonb_array_length(v_topics) then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A subject appears twice.'); end if;
  select coalesce(array_agg(distinct d), '{}') into v_diff from jsonb_array_elements_text(coalesce(p_payload->'difficulties', '[]'::jsonb)) d;
  if exists (select 1 from unnest(v_diff) d where d not in ('ran_out_of_time', 'rushed_omissions', 'changed_right_to_wrong', 'calculation_errors', 'misread_questions', 'knowledge_gaps', 'nerves')) then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Unknown difficulty.'); end if;
  v_prov := nullif(btrim(p_payload->>'provider'), ''); v_notes := nullif(btrim(p_payload->>'notes'), '');
  if char_length(coalesce(v_prov, '')) > 80 or char_length(coalesce(v_notes, '')) > 500 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Provider or notes are too long.'); end if;
  if v_score is null and jsonb_array_length(v_topics) = 0 and coalesce(array_length(v_diff, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Add a result, a topic result or something that went wrong, so there is something to work from.'); end if;
  if nullif(p_payload->>'legacy_outcome_id', '') is not null and not exists (select 1 from public.mock_outcomes o where o.id = (p_payload->>'legacy_outcome_id')::uuid and o.user_id = p_user) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  if p_action = 'create' then
    insert into public.mock_reports (user_id, idempotency_key, taken_on, provider, scope, scale, score, score_max, topics, difficulties, notes, legacy_outcome_id)
      values (p_user, p_key, v_taken, v_prov, v_scope, v_scale, v_score, v_max, v_topics, v_diff, v_notes, nullif(p_payload->>'legacy_outcome_id', '')::uuid) returning * into v_r;
  else
    update public.mock_reports set taken_on = v_taken, provider = v_prov, scope = v_scope, scale = v_scale, score = v_score, score_max = v_max, topics = v_topics, difficulties = v_diff, notes = v_notes,
      version = version + 1 where id = v_r.id returning * into v_r;
  end if;
  v_res := jsonb_build_object('ok', true, 'report', to_jsonb(v_r));
  insert into public.mock_report_commands (user_id, key, command, report_id, result) values (p_user, p_key, p_action, v_r.id, v_res);
  return v_res;
end $$;
revoke all on function public.save_mock_report(uuid, text, text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_mock_report(uuid, text, text, uuid, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- accept_mock_recovery: the ONE command that turns a reviewed proposal into Calendar sittings. Same authority as apply_class_log: scheduling lock first,
-- then the cycle, the sitting limit, the current contiguous room (class_day_packs) and source identity, all inside one transaction.
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.accept_mock_recovery(p_user uuid, p_key text, p_report_id uuid, p_report_version integer, p_cycle_id uuid, p_selection jsonb, p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cmd public.mock_report_commands%rowtype; v_r public.mock_reports%rowtype; v_cycle public.planning_cycles%rowtype; v_tz text; v_today date; v_limit integer; r record;
  v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb); v_n integer := 0; v_res jsonb;
begin
  if p_user is null or coalesce(btrim(p_key), '') = '' or char_length(p_key) not between 8 and 80 then raise exception 'Invalid key'; end if;
  if jsonb_typeof(v_tasks) <> 'array' or jsonb_array_length(v_tasks) > 60 then raise exception 'Invalid payload'; end if;
  perform public.scope_lock(p_user);
  select * into v_cmd from public.mock_report_commands where user_id = p_user and key = p_key;
  if found then
    if v_cmd.command <> 'accept_recovery' or v_cmd.report_id is distinct from p_report_id then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    return v_cmd.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_r from public.mock_reports where id = p_report_id and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_r.status <> 'active' or v_r.version <> p_report_version then return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'The mock report changed since you reviewed the plan.'); end if;
  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> p_user or v_cycle.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Your open week changed since you reviewed the plan.'); end if;
  v_tz := coalesce(nullif(v_cycle.timezone, ''), public.booking_tz(p_user));
  v_today := (clock_timestamp() at time zone v_tz)::date;
  select least(90, coalesce(max_session_minutes, 90)) into v_limit from public.profiles where id = p_user for share;
  v_limit := coalesce(v_limit, 90);

  if jsonb_array_length(v_tasks) > 0 then
    if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'id', '') = '' or coalesce(t->>'source_key', '') = '' or coalesce(t->>'task_type', '') not in ('study', 'review')
                  or coalesce(t->>'local_date', '') = '' or coalesce(t->>'duration_minutes', '') !~ '^[0-9]+$' or coalesce(t->>'title', '') = '') then raise exception 'Invalid task'; end if;
    if (select count(distinct t->>'id') from jsonb_array_elements(v_tasks) t) <> jsonb_array_length(v_tasks)
       or (select count(distinct t->>'source_key') from jsonb_array_elements(v_tasks) t) <> jsonb_array_length(v_tasks) then raise exception 'Invalid task'; end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'local_date')::date < v_cycle.starts_at_local or (t->>'local_date')::date >= v_cycle.ends_at_local) then
      return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'A reviewed day is outside your open week.'); end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'local_date')::date < v_today) then
      return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'A reviewed day has already passed.'); end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'duration_minutes')::int > v_limit or (t->>'duration_minutes')::int < 5) then
      return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'A sitting is longer than your sitting limit.'); end if;
    -- a reading, when named, must be the outcome's own
    if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'outcome_id', '') <> ''
                 and not exists (select 1 from public.reading_los l where l.id = t->>'outcome_id' and l.reading_id::text = coalesce(nullif(t->>'lm_id', ''), l.reading_id::text))) then raise exception 'Invalid task'; end if;
    -- identity: the same finding sitting can exist once (open), whatever its title
    if exists (select 1 from jsonb_array_elements(v_tasks) t join public.plan_blocks p on p.source_report_id = p_report_id and p.source_key = t->>'source_key' and p.cancelled_at is null) then
      return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Some of this work was already planned.'); end if;
    for r in select (t->>'local_date')::date as d, array_agg((t->>'duration_minutes')::int order by ord) as ms from jsonb_array_elements(v_tasks) with ordinality as x(t, ord) group by 1 loop
      if not public.class_day_packs(p_user, r.d, v_tz, clock_timestamp(), r.ms) then
        return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Not enough study time is left on ' || r.d::text || '.'); end if;
    end loop;
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, duration_minutes, duration, lm_id, rationale, created_by,
        outcome_id, learning_objective, suggested_approach, completion_meaning, verification_intent, curriculum_reference, dependencies, source_report_id, source_key, source_report_version)
      select t->>'id', p_user, p_cycle_id, t->>'title', nullif(t->>'detail', ''), t->>'task_type', 'planner', 'core', 'day_preferred', 'not_started', (t->>'local_date')::date, (t->>'local_date')::date,
        (t->>'duration_minutes')::smallint, t->>'duration_minutes', nullif(t->>'lm_id', ''), t->>'rationale', 'algorithm', nullif(t->>'outcome_id', ''),
        nullif(t->>'learning_objective', ''), nullif(t->>'suggested_approach', ''), nullif(t->>'completion_meaning', ''), nullif(t->>'verification_intent', ''), nullif(t->>'curriculum_reference', ''),
        '[]'::jsonb, p_report_id, t->>'source_key', v_r.version
      from jsonb_array_elements(v_tasks) t;
    get diagnostics v_n = row_count;
  end if;
  update public.mock_reports set plan_selection = coalesce(p_selection, plan_selection) where id = p_report_id;
  v_res := jsonb_build_object('ok', true, 'tasks', v_n, 'taskIds', coalesce((select jsonb_agg(t->>'id') from jsonb_array_elements(v_tasks) t), '[]'::jsonb));
  insert into public.mock_report_commands (user_id, key, command, report_id, result) values (p_user, p_key, 'accept_recovery', p_report_id, v_res);
  return v_res;
end $$;
revoke all on function public.accept_mock_recovery(uuid, text, uuid, integer, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.accept_mock_recovery(uuid, text, uuid, integer, uuid, jsonb, jsonb) to service_role;
