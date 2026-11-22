-- 1. Setup saves and their version increment are ONE transaction.
--    Until now the application saved planning inputs and then bumped profiles.onboarding_context_version in a second statement, so a preview
--    or an acceptance could land between them and see new inputs under the old version (or the reverse). onboarding_commit_step does the
--    whole change, locks the profile row first (the same row acceptance locks, so the two serialise in either order), and bumps last.
--    Any failure rolls back both the setup and its version.
create or replace function public.onboarding_commit_step(p_user uuid, p_step text, p_args jsonb)
returns integer language plpgsql set search_path = public, pg_temp as $$
declare v_version integer; v_next jsonb;
begin
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'Profile not found'; end if;

  if p_step = 'exam' then
    update public.profiles set
      timezone = p_args->>'timezone', registered = (p_args->>'registered')::boolean, exam_window_id = (p_args->>'exam_window_id')::uuid,
      exam_sitting = p_args->>'exam_sitting', exam_year = (p_args->>'exam_year')::int, exam_date = nullif(p_args->>'exam_date', '')::date
    where id = p_user;
  elsif p_step = 'route' then
    v_next := case when jsonb_typeof(p_args->'next_class') = 'object' then p_args->'next_class' else null end;
    perform public.onboarding_replace_route(p_user, p_args->>'prep_mode', p_args->>'class_pattern', p_args->'classes', v_next);
  elsif p_step = 'position' then
    perform public.onboarding_replace_position(
      p_user, p_args->>'stage', p_args->'exposure',
      case when jsonb_typeof(p_args->'readings') = 'array' then p_args->'readings' end,
      case when jsonb_typeof(p_args->'uncertainty') = 'array' then p_args->'uncertainty' end,
      coalesce((p_args->>'mock_set')::boolean, false),
      case when jsonb_typeof(p_args->'mock') = 'object' then p_args->'mock' end);
    if jsonb_typeof(p_args->'mock_timing') = 'object' then
      update public.profiles set
        mock_label = case when p_args->'mock_timing' ? 'mock_label' then nullif(p_args->'mock_timing'->>'mock_label', '') else mock_label end,
        mock_start_time = case when p_args->'mock_timing' ? 'mock_start_time' then nullif(p_args->'mock_timing'->>'mock_start_time', '')::time else mock_start_time end,
        mock_duration_minutes = case when p_args->'mock_timing' ? 'mock_duration_minutes' then nullif(p_args->'mock_timing'->>'mock_duration_minutes', '')::int else mock_duration_minutes end
      where id = p_user;
    end if;
  elsif p_step = 'week' then
    perform public.onboarding_replace_week(p_user, (p_args->>'max_session')::int, p_args->>'mode', p_args->'windows', p_args->'commitments');
  else
    raise exception 'Unknown setup step %', p_step;
  end if;

  update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user
    returning onboarding_context_version into v_version;
  return v_version;
end $$;
revoke all on function public.onboarding_commit_step(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.onboarding_commit_step(uuid, text, jsonb) to service_role;

-- 2. What a current-week proposal was built from. Anything that matters to the plan moves this value: the cycle's tasks (including
--    recorded learning and manually added work), commitments, availability, classes, reported coverage, and the setup version.
create or replace function public.current_week_source_hash(p_user uuid, p_cycle uuid) returns text language sql stable set search_path = public, pg_temp as $$
  select md5(concat_ws('|',
    coalesce((select string_agg(concat_ws(':', id, revision, execution, local_date, cancelled_at is not null, duration_minutes), ',' order by id) from public.plan_blocks where user_id = p_user and cycle_id = p_cycle), ''),
    coalesce((select string_agg(concat_ws(':', id, status, starts_at, weekdays::text, start_time, end_time), ',' order by id) from public.calendar_commitments where user_id = p_user), ''),
    coalesce((select string_agg(concat_ws(':', weekday, start_time, end_time), ',' order by weekday, start_time, end_time) from public.availability_windows where user_id = p_user and status = 'active'), ''),
    coalesce((select string_agg(id::text, ',' order by id) from public.class_sessions where user_id = p_user), ''),
    coalesce((select string_agg(concat_ws(':', lm_id, coverage_state, source), ',' order by lm_id, source) from public.user_module_state where user_id = p_user), ''),
    (select concat_ws(':', onboarding_context_version, max_session_minutes) from public.profiles where id = p_user)));
$$;
revoke all on function public.current_week_source_hash(uuid, uuid) from public, anon, authenticated;
grant execute on function public.current_week_source_hash(uuid, uuid) to service_role;

-- 3. Only one ready proposal per student, cycle and source state; concurrent previews collapse onto it.
create unique index if not exists plan_drafts_ready_current_week_idx on public.plan_drafts(user_id, cycle_id, context_fingerprint)
  where status = 'ready' and purpose = 'current_week_plan';

-- 4. Accepting a reviewed proposal INTO THE EXISTING CYCLE. The cycle row is never replaced or moved; the first acceptance receipt
--    (the onboarding draft) is untouched; this draft row is the record of the later planning action. Repeats return the stored receipt.
create or replace function public.accept_current_week_plan(p_draft_id uuid, p_expected_revision integer)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_draft public.plan_drafts%rowtype; v_cycle public.planning_cycles%rowtype;
  v_today date; v_added integer; v_version integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_draft from public.plan_drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if v_draft.user_id <> v_user or v_draft.purpose <> 'current_week_plan' then raise exception 'Unauthorized'; end if;

  if v_draft.status = 'accepted' then
    return (v_draft.draft_json->'receipt')::json;
  end if;
  if v_draft.status <> 'ready' then raise exception 'STALE_PROPOSAL: this proposal is no longer open'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'STALE_PROPOSAL: stale revision'; end if;

  -- Same lock order as a setup edit (profile first), so an edit and this acceptance serialise one way or the other.
  select onboarding_context_version into v_version from public.profiles where id = v_user for update;
  select * into v_cycle from public.planning_cycles where id = v_draft.cycle_id and user_id = v_user for update;
  if not found or v_cycle.status <> 'active' then raise exception 'CYCLE_CHANGED: the cycle this proposal was for is no longer the active one'; end if;
  v_today := (now() at time zone coalesce(v_cycle.timezone, 'UTC'))::date;
  if v_cycle.ends_at_local < v_today then raise exception 'CYCLE_ENDED: this cycle has ended; plan the next week in the weekly review'; end if;
  if (v_draft.draft_json->>'planning_date')::date <> v_today then raise exception 'STALE_PROPOSAL: the day changed since this was prepared'; end if;
  if v_draft.onboarding_context_version is distinct from v_version then raise exception 'STALE_PROPOSAL: your setup changed'; end if;
  if v_draft.context_fingerprint is distinct from public.current_week_source_hash(v_user, v_cycle.id) then
    raise exception 'STALE_PROPOSAL: the week changed after this was prepared';
  end if;

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at, duration_minutes,
    duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by, learning_objective, suggested_approach, completion_meaning)
  select coalesce(t->>'id', 'task-' || gen_random_uuid()::text), v_user, v_cycle.id, t->>'title',
    coalesce(t->'metadata'->>'detail', ''), coalesce(t->'metadata'->>'task_type', 'study'), coalesce(t->'metadata'->>'origin', 'planner'),
    coalesce(t->'metadata'->>'priority', 'core'), coalesce(t->'metadata'->>'placement', 'day_preferred'), 'not_started',
    (t->>'scheduled_date')::date, (t->>'scheduled_date')::date, nullif(t->'metadata'->>'starts_at', '')::timestamptz,
    (t->>'duration_minutes')::smallint, coalesce(t->>'duration_minutes', '0'), nullif(t->'metadata'->>'lm_id', ''),
    nullif(t->'metadata'->>'repair_thread_id', '')::uuid, coalesce(t->'metadata'->>'rationale', ''),
    case when jsonb_typeof(t->'metadata'->'assessment_scope') = 'object' then t->'metadata'->'assessment_scope' end, 'algorithm',
    nullif(t->'metadata'->>'learning_objective', ''), nullif(t->'metadata'->>'suggested_approach', ''), nullif(t->'metadata'->>'completion_meaning', '')
  from jsonb_array_elements(coalesce(v_draft.draft_json->'tasks', '[]'::jsonb)) t
  where t->>'scheduled_date' is not null
    and (t->>'scheduled_date')::date between v_cycle.starts_at_local and v_cycle.ends_at_local and (t->>'scheduled_date')::date >= v_today;
  get diagnostics v_added = row_count;

  update public.plan_drafts set status = 'accepted', accepted_cycle_id = v_cycle.id, revision = revision + 1, updated_at = now(),
    draft_json = jsonb_set(draft_json, '{receipt}', jsonb_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', true))
  where id = p_draft_id;
  return json_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', false);
end $$;
revoke all on function public.accept_current_week_plan(uuid, integer) from public, anon;
grant execute on function public.accept_current_week_plan(uuid, integer) to authenticated;
