-- A ready retake draft belongs to its own command. The original onboarding command
-- historically accepted any owned draft, so bind it to its actual purpose first.
do $$
declare
  definition text := pg_get_functiondef('public.accept_onboarding_preview(uuid,integer)'::regprocedure);
  anchor text := 'if v_draft.user_id != v_user_id then';
begin
  if strpos(definition, anchor) = 0 then raise exception 'Check the current onboarding accept definition'; end if;
  execute replace(definition, anchor, 'if v_draft.user_id != v_user_id or v_draft.purpose is distinct from ''onboarding_initial_week'' then');
end $$;

create function public.review_exam_retake(p_user uuid, p_draft uuid, p_revision integer, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.plan_drafts%rowtype;
  p public.profiles%rowtype;
  c public.planning_cycles%rowtype;
  v_today date; v_now timestamptz; v_keeps boolean; v_plan jsonb;
  v_cycle uuid; v_roadmap uuid; v_outcome jsonb; v_receipt jsonb;
  v_groups jsonb := '{}'; v_group uuid; r record; v_added integer := 0;
begin
  perform public.scope_lock(p_user);
  select * into d from public.plan_drafts where id = p_draft and user_id = p_user and purpose = 'exam_retake' for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'DRAFT_UNAVAILABLE'); end if;
  if d.status = 'accepted' and p_action = 'accept' and d.revision = p_revision + 1 then
    return (d.draft_json->'receipt') || jsonb_build_object('already_active', true);
  end if;
  if d.status = 'discarded' and p_action = 'cancel' and d.revision = p_revision + 1 then
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  if d.status <> 'ready' or d.revision is distinct from p_revision then
    return jsonb_build_object('ok', false, 'code', 'STALE_RETAKE');
  end if;
  if p_action = 'cancel' then
    update public.plan_drafts set status = 'discarded', revision = revision + 1, updated_at = now() where id = d.id;
    return jsonb_build_object('ok', true, 'cancelled', true);
  end if;
  if p_action is distinct from 'accept' then return jsonb_build_object('ok', false, 'code', 'DRAFT_UNAVAILABLE'); end if;

  select * into p from public.profiles where id = p_user for update;
  select * into c from public.planning_cycles where user_id = p_user and status = 'active' for update;
  v_now := clock_timestamp();
  v_today := (v_now at time zone coalesce(p.timezone, 'UTC'))::date;
  v_keeps := coalesce((d.draft_json->>'keepsWeek')::boolean, false);
  if p.onboarding_context_version is distinct from d.onboarding_context_version
    or p.exam_date is distinct from (d.draft_json->>'examDate')::date
    or v_today is distinct from (d.draft_json->>'today')::date
    or c.id is distinct from d.cycle_id
    or public.current_week_source_hash(p_user, c.id) is distinct from d.context_fingerprint
    or not exists (
      select 1 from public.exam_completion e where e.user_id = p_user and e.sat_on = (d.draft_json->>'satOn')::date
        and e.retake_requested_at is not null and p.exam_date > e.sat_on and p.exam_date >= v_today
    ) then return jsonb_build_object('ok', false, 'code', 'STALE_RETAKE'); end if;

  if not v_keeps then
    if exists (select 1 from public.planning_cycles old where old.user_id = p_user and old.ends_at_local >= d.cycle_start_date
      and old.starts_at_local <= d.cycle_end_date)
      or exists (select 1 from jsonb_array_elements(d.draft_json->'rows') t
        where (t->>'local_date')::date < greatest(v_today, d.cycle_start_date)
          or (t->>'local_date')::date > d.cycle_end_date or (t->>'local_date')::date >= p.exam_date
          or nullif(t->>'starts_at', '')::timestamptz < v_now)
      then return jsonb_build_object('ok', false, 'code', 'STALE_RETAKE'); end if;
    for r in
      select (t->>'local_date')::date as day, sum((t->>'duration_minutes')::int) as minutes
      from jsonb_array_elements(d.draft_json->'rows') t
      where t->>'task_type' not in ('diagnostic', 'mock', 'admin')
      group by 1
    loop
      if r.minutes > public.current_week_available_minutes(p_user, r.day, d.timezone, v_now) then
        return jsonb_build_object('ok', false, 'code', 'STALE_RETAKE');
      end if;
    end loop;
  end if;

  -- Reuse the archive command under the same student lock. The archive, accepted
  -- roadmap, plan and receipt all commit together.
  v_outcome := public.record_exam_status(p_user, 'activate_retake', null, v_today);
  if not coalesce((v_outcome->>'ok')::boolean, false) then return v_outcome; end if;
  v_plan := d.draft_json->'roadmap';
  update public.study_roadmaps set status = 'superseded' where user_id = p_user and status in ('active', 'draft');
  insert into public.study_roadmaps (user_id, exam_window_id, target_date, route, status, phases, inputs, feasibility)
    values (p_user, p.exam_window_id, p.exam_date, v_plan->>'route', 'active', v_plan->'phases', v_plan->'inputs', coalesce(v_plan->'feasibility', '{}'))
    returning id into v_roadmap;

  v_cycle := c.id;
  if not v_keeps then
    update public.planning_cycles set status = 'closed', revision = revision + 1 where id = c.id;
    insert into public.planning_cycles (user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status, anchor_day)
      values (p_user, d.cycle_start_date::timestamp at time zone d.timezone, (d.cycle_end_date + 1)::timestamp at time zone d.timezone,
        d.cycle_start_date, d.cycle_end_date, d.timezone, 'active', (d.draft_json->>'anchorDay')::smallint)
      returning id into v_cycle;
    for r in
      select x->>'group_key' as key, min(x->>'id') as first_id, min(x->>'lm_id') as lm, count(*)::integer as parts
      from jsonb_array_elements(d.draft_json->'rows') x where coalesce(x->>'group_key', '') <> '' group by 1
    loop
      insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
        values (p_user, r.first_id, r.parts, jsonb_build_object('lm_id', r.lm, 'source', 'weekly_split')) returning id into v_group;
      v_groups := v_groups || jsonb_build_object(r.key, v_group);
    end loop;
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
      duration_minutes, duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by, concept_id,
      learning_objective, suggested_approach, completion_meaning, dependencies, scope_group_id
    )
    select x->>'id', p_user, v_cycle, x->>'title', x->>'detail', x->>'task_type', x->>'origin', x->>'priority', x->>'placement',
      'not_started', (x->>'local_date')::date, (x->>'local_date')::date, nullif(x->>'starts_at','')::timestamptz,
      (x->>'duration_minutes')::smallint, x->>'duration', nullif(x->>'lm_id',''), nullif(x->>'repair_thread_id','')::uuid,
      x->>'rationale', x->'assessment_scope', 'algorithm', nullif(x->>'concept_id','')::uuid, x->>'learning_objective',
      x->>'suggested_approach', x->>'completion_meaning', coalesce(x->'dependencies','[]'), (v_groups->>(x->>'group_key'))::uuid
    from jsonb_array_elements(d.draft_json->'rows') x;
    get diagnostics v_added = row_count;
  end if;

  v_receipt := jsonb_build_object('ok', true, 'action', 'activate_retake', 'cycle_id', v_cycle, 'draft_id', d.id,
    'previous_sitting', d.draft_json->>'satOn', 'exam_date', p.exam_date, 'tasks_added', v_added);
  update public.plan_drafts set status = 'accepted', roadmap_id = v_roadmap, accepted_cycle_id = v_cycle,
    revision = revision + 1, updated_at = now(), draft_json = d.draft_json || jsonb_build_object('receipt', v_receipt) where id = d.id;
  return v_receipt;
end $$;
revoke all on function public.review_exam_retake(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.review_exam_retake(uuid, uuid, integer, text) to service_role;

create function public.record_exam_status_checked(p_user uuid, p_version integer, p_action text,
  p_sat_on date default null, p_today date default null, p_result text default null, p_psm text default null, p_retake_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  perform public.scope_lock(p_user);
  select onboarding_context_version into v_version from public.profiles where id = p_user for update;
  if coalesce(v_version, 1) is distinct from p_version then return jsonb_build_object('ok', false, 'code', 'STALE_EXAM'); end if;
  if p_action is null or p_action not in ('sat', 'undo', 'follow_up') then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;
  return public.record_exam_status(p_user, p_action, p_sat_on, p_today, p_result, p_psm, p_retake_note);
end $$;
revoke all on function public.record_exam_status_checked(uuid, integer, text, date, date, text, text, text) from public, anon, authenticated;
grant execute on function public.record_exam_status_checked(uuid, integer, text, date, date, text, text, text) to service_role;
