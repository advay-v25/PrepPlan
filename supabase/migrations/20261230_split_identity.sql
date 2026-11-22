-- Sibling identity for weekly splits: sittings split from one portion share a scope group and declare their order, from generation through
-- the saved draft and the accepting command (accept_current_week_plan, accept_onboarding_preview, accept_weekly_transition). Legacy tasks stay unlinked.
CREATE OR REPLACE FUNCTION public.accept_current_week_plan(p_draft_id uuid, p_expected_revision integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid(); v_draft public.plan_drafts%rowtype; v_cycle public.planning_cycles%rowtype;
  v_today date; v_added integer; v_version integer; v_problem text; v_now timestamptz;
  r2 record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where id=v_user and onboarding_status='complete')
    or not public.is_beta_admitted(v_user) then raise exception 'Application access required' using errcode='42501'; end if;
  perform public.scope_lock(v_user);
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
  v_now := clock_timestamp();
  v_today := (v_now at time zone coalesce(v_cycle.timezone, 'UTC'))::date;
  if v_cycle.ends_at_local < v_today then raise exception 'CYCLE_ENDED: this cycle has ended; plan the next week in the weekly review'; end if;
  if (v_draft.draft_json->>'planning_date')::date <> v_today then raise exception 'STALE_PROPOSAL: the day changed since this was prepared'; end if;
  if v_draft.onboarding_context_version is distinct from v_version then raise exception 'STALE_PROPOSAL: your setup changed'; end if;
  v_problem := public.current_week_proposal_problem(v_user,p_draft_id,clock_timestamp());
  if v_problem is not null then raise exception '%',v_problem; end if;


  -- Sittings split from one portion share a scope group and declare their order (explicit identity from the planner, never inferred from titles).
  for r2 in select t->'metadata'->>'split_group' as k, min(t->>'id') as first_id, min(t->'metadata'->>'lm_id') as lm
              from jsonb_array_elements(coalesce(v_draft.draft_json->'tasks', '[]'::jsonb)) t where coalesce(t->'metadata'->>'split_group', '') <> '' group by 1 loop
    insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
      values (v_user, r2.first_id, 2, jsonb_build_object('lm_id', r2.lm, 'source', 'weekly_split')) returning id into v_gid;
    v_groups := v_groups || jsonb_build_object(r2.k, v_gid);
  end loop;

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at, duration_minutes,
    duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by, learning_objective, suggested_approach, completion_meaning, dependencies, scope_group_id)
  select coalesce(t->>'id', 'task-' || gen_random_uuid()::text), v_user, v_cycle.id, t->>'title',
    coalesce(t->'metadata'->>'detail', ''), coalesce(t->'metadata'->>'task_type', 'study'), coalesce(t->'metadata'->>'origin', 'planner'),
    coalesce(t->'metadata'->>'priority', 'core'), coalesce(t->'metadata'->>'placement', 'day_preferred'), 'not_started',
    (t->>'scheduled_date')::date, (t->>'scheduled_date')::date, nullif(t->'metadata'->>'starts_at', '')::timestamptz,
    (t->>'duration_minutes')::smallint, coalesce(t->>'duration_minutes', '0'), nullif(t->'metadata'->>'lm_id', ''),
    nullif(t->'metadata'->>'repair_thread_id', '')::uuid, coalesce(t->'metadata'->>'rationale', ''),
    case when jsonb_typeof(t->'metadata'->'assessment_scope') = 'object' then t->'metadata'->'assessment_scope' end, 'algorithm',
    nullif(t->'metadata'->>'learning_objective', ''), nullif(t->'metadata'->>'suggested_approach', ''), nullif(t->'metadata'->>'completion_meaning', ''),
    case when coalesce(t->'metadata'->>'split_after', '') <> '' then jsonb_build_array(t->'metadata'->>'split_after') else '[]'::jsonb end,
    (v_groups->>(t->'metadata'->>'split_group'))::uuid
  from jsonb_array_elements(coalesce(v_draft.draft_json->'tasks', '[]'::jsonb)) t
;
  get diagnostics v_added = row_count;

  update public.plan_drafts set status = 'accepted', accepted_cycle_id = v_cycle.id, revision = revision + 1, updated_at = now(),
    draft_json = jsonb_set(draft_json, '{receipt}', jsonb_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', true))
  where id = p_draft_id;
  return json_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', false);
end $function$
;

CREATE OR REPLACE FUNCTION public.accept_onboarding_preview(p_draft_id uuid, p_expected_revision integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  v_draft plan_drafts%rowtype;
  v_cycle_id uuid;
  v_task jsonb;
  v_tasks_array jsonb;
  r2 record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
begin
  -- current-week serialization
  perform public.scope_lock(auth.uid());
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_draft
  from public.plan_drafts
  where id = p_draft_id for update;

  if not found then
    raise exception 'Draft not found';
  end if;

  if v_draft.user_id != v_user_id then
    raise exception 'Unauthorized';
  end if;

  if v_draft.status = 'accepted' then
    return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_draft.accepted_cycle_id);
  end if;

  if v_draft.status != 'ready' then
    raise exception 'Draft is not ready';
  end if;

  if v_draft.onboarding_context_version is distinct from
     (select onboarding_context_version from public.profiles where id = v_user_id for update) then
    raise exception 'STALE_PREVIEW: your setup changed after this preview was prepared';
  end if;

  if v_draft.revision != p_expected_revision then
    raise exception 'Stale revision. Expected %, got %', p_expected_revision, v_draft.revision;
  end if;

  if v_draft.roadmap_id is not null then
    update public.study_roadmaps
    set status = 'superseded'
    where user_id = v_user_id and status = 'active';

    update public.study_roadmaps
    set status = 'active'
    where id = v_draft.roadmap_id;
  end if;

  select id into v_cycle_id
  from public.planning_cycles
  where user_id = v_user_id and status = 'active'
  for update;

  if v_cycle_id is null then
    v_cycle_id := gen_random_uuid();
    insert into public.planning_cycles (
      id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status
    ) values (
      v_cycle_id, v_user_id, now(), now() + interval '7 days',
      coalesce(v_draft.cycle_start_date, v_draft.proposed_cycle_starts_at_local),
      coalesce(v_draft.cycle_end_date, v_draft.proposed_cycle_ends_at_local),
      coalesce(v_draft.timezone, 'UTC'), 'active'
    );
  else
    update public.planning_cycles
    set starts_at_local = coalesce(v_draft.cycle_start_date, v_draft.proposed_cycle_starts_at_local),
        ends_at_local = coalesce(v_draft.cycle_end_date, v_draft.proposed_cycle_ends_at_local),
        timezone = coalesce(v_draft.timezone, 'UTC')
    where id = v_cycle_id;
  end if;

  v_tasks_array := v_draft.draft_json->'tasks';
  if jsonb_typeof(v_tasks_array) = 'array' then

  -- Sittings split from one portion share a scope group and declare their order (explicit identity from the planner, never inferred from titles).
  for r2 in select t->'metadata'->>'split_group' as k, min(t->>'id') as first_id, min(t->'metadata'->>'lm_id') as lm
              from jsonb_array_elements(v_tasks_array) t where coalesce(t->'metadata'->>'split_group', '') <> '' group by 1 loop
    insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
      values (v_user_id, r2.first_id, 2, jsonb_build_object('lm_id', r2.lm, 'source', 'weekly_split')) returning id into v_gid;
    v_groups := v_groups || jsonb_build_object(r2.k, v_gid);
  end loop;

    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, starts_at, duration_minutes,
      duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by,
      learning_objective, suggested_approach, completion_meaning, dependencies, scope_group_id
    )
    select
      coalesce((t->>'id')::text, 'task-' || gen_random_uuid()::text),
      v_user_id,
      v_cycle_id,
      t->>'title',
      coalesce(t->'metadata'->>'detail', ''),
      coalesce(t->'metadata'->>'task_type', 'study'),
      coalesce(t->'metadata'->>'origin', 'planner'),
      coalesce(t->'metadata'->>'priority', 'core'),
      coalesce(t->'metadata'->>'placement', 'day_preferred'),
      'not_started',
      (t->>'scheduled_date')::date,
      (t->>'scheduled_date')::date,
      nullif(t->'metadata'->>'starts_at', '')::timestamptz,
      (t->>'duration_minutes')::smallint,
      coalesce(t->>'duration_minutes', '0'),
      nullif(t->'metadata'->>'lm_id', ''),
      nullif(t->'metadata'->>'repair_thread_id', '')::uuid,
      coalesce(t->'metadata'->>'rationale', ''),
      case when jsonb_typeof(t->'metadata'->'assessment_scope') = 'object' then t->'metadata'->'assessment_scope' end,
      'algorithm',
      nullif(t->'metadata'->>'learning_objective', ''), nullif(t->'metadata'->>'suggested_approach', ''), nullif(t->'metadata'->>'completion_meaning', ''),
      case when coalesce(t->'metadata'->>'split_after', '') <> '' then jsonb_build_array(t->'metadata'->>'split_after') else '[]'::jsonb end,
      (v_groups->>(t->'metadata'->>'split_group'))::uuid
    from jsonb_array_elements(v_tasks_array) as t
    where t->>'scheduled_date' is not null;
  end if;

  update public.plan_drafts
  set status = 'accepted', accepted_cycle_id = v_cycle_id, revision = revision + 1, updated_at = now()
  where id = p_draft_id;

  update public.profiles
  set onboarding_status = 'complete', onboarding_completed_at = now(),
      onboarding_preview_id = p_draft_id, updated_at = now()
  where id = v_user_id;

  return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_cycle_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_weekly_transition(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cycle_id uuid;
  v_cycle public.planning_cycles%rowtype;
  v_draft public.weekly_transition_drafts%rowtype;
  v_review public.weekly_reviews%rowtype;
  v_actions jsonb;
  v_next jsonb;
  v_action jsonb;
  v_task public.plan_blocks%rowtype;
  v_pred public.plan_blocks%rowtype;
  v_succ public.plan_blocks%rowtype;
  v_new_exec text;
  v_next_cycle uuid;
  v_next_start date;
  v_unknown text[] := '{}';
  v_continued jsonb := '[]'::jsonb;
  v_place date;
  v_minutes integer;
  v_paper_attempt text;
  v_succ_id text;
  r2 record; v_gid uuid; v_groups jsonb := '{}'::jsonb; v_planned integer;
begin
  -- current-week serialization
  perform public.scope_lock(auth.uid());
  if v_user is null then raise exception 'Sign in to close your week.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verify your email before using your plan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete') then
    raise exception 'Complete setup before closing your week.' using errcode = '42501';
  end if;

  -- Lock order: cycle, then draft, then tasks (by id).
  select cycle_id into v_cycle_id from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user;
  if v_cycle_id is null then raise exception 'That review could not be found.' using errcode = 'P0002'; end if;
  select * into v_cycle from public.planning_cycles where id = v_cycle_id and user_id = v_user for update;
  if not found then raise exception 'That week could not be found.' using errcode = 'P0002'; end if;
  select * into v_draft from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user for update;

  select * into v_review from public.weekly_reviews where cycle_id = v_cycle_id;
  if found then
    if v_review.draft_id = p_draft_id then
      return jsonb_build_object('ok', true, 'alreadyClosed', true, 'closedCycleId', v_cycle_id, 'nextCycleId', v_review.next_cycle_id,
        'continued', coalesce(jsonb_array_length(v_review.continuations), 0));
    end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  if v_draft.status <> 'ready' or v_draft.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'DRAFT_UNAVAILABLE');
  end if;
  if v_cycle.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  -- Lock first, THEN compare: once the closing week's tasks are locked nothing can change them between the
  -- check and the writes. Availability and commitments are locked against edits too (an insert of a new row
  -- is not blocked; the next review sees it). Order is fixed: cycle, draft, tasks, then these.
  perform 1 from public.plan_blocks where cycle_id = v_cycle_id and user_id = v_user order by id for update;
  perform 1 from public.availability_windows where user_id = v_user and status = 'active' order by id for share;
  perform 1 from public.calendar_commitments where user_id = v_user and status = 'active' order by id for share;
  if public.weekly_source_version(v_user, v_cycle_id) is distinct from v_draft.source_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;

  -- The paper gate is re-checked here, not trusted from the preview.
  select attempt_id into v_paper_attempt from public.plan_blocks
    where cycle_id = v_cycle_id and user_id = v_user and task_type = 'diagnostic' and assessment_scope->>'kind' = 'weekly_paper'
    order by local_date desc nulls last limit 1;
  if v_draft.closure_kind = 'paper_scored' then
    if not exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored'
        and (id::text = v_paper_attempt or (cycle_id = v_cycle_id and attempt_kind = 'weekly'))) then
      raise exception 'The weekly paper has not been scored.' using errcode = '22023';
    end if;
  else
    if coalesce(btrim(v_draft.no_paper_reason), '') = '' then
      raise exception 'A no-paper closure needs a reason.' using errcode = '22023';
    end if;
    if exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored' and cycle_id = v_cycle_id and attempt_kind = 'weekly') then
      raise exception 'The paper was scored; close with the paper.' using errcode = '22023';
    end if;
  end if;

  v_actions := coalesce(v_draft.proposal->'actions', '[]'::jsonb);
  v_next := v_draft.proposal->'next';
  v_next_start := (v_next->>'starts_at_local')::date;
  if v_next_start is null or (v_next->>'ends_at_local') is null or v_next_start <= v_cycle.ends_at_local then
    raise exception 'The next week must start after this one ends.' using errcode = '22023';
  end if;

  -- Pass 1: what happened. Every change is recorded in the task's own history.
  for v_action in select * from jsonb_array_elements(v_actions) loop
    select * into v_task from public.plan_blocks where id = v_action->>'taskId' and cycle_id = v_cycle_id and user_id = v_user;
    if not found then raise exception 'A task in this review is no longer part of the week.' using errcode = '22023'; end if;
    v_new_exec := nullif(v_action->>'setExecution', '');
    if v_new_exec is not null and v_new_exec is distinct from v_task.execution then
      update public.plan_blocks set execution = v_new_exec, revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, v_new_exec, jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'cancel')::boolean, false) then
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, 'cancelled', jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'unknown')::boolean, false) then v_unknown := v_unknown || v_task.id; end if;
  end loop;

  -- The next week. A learner may have only one active cycle, so the old one is closed first.
  update public.planning_cycles set status = 'closed', revision = revision + 1 where id = v_cycle_id;
  v_next_cycle := gen_random_uuid();
  insert into public.planning_cycles (id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status, anchor_day)
    values (v_next_cycle, v_user, now(), now() + interval '7 days', v_next_start, (v_next->>'ends_at_local')::date,
            coalesce(v_next->>'timezone', v_cycle.timezone, 'UTC'), 'active', nullif(v_next->>'anchor_day', '')::smallint);

  -- Follow-up work for class items that never received a task (a durable obligation): the saved proposal may place it in the next week, but never
  -- more than is still owed, and only for this student's own item.
  for r2 in select r->>'class_session_id' as s, r->>'outcome_id' as o, sum((r->>'duration_minutes')::int)::int as m
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'class_session_id', '') <> '' group by 1, 2 loop
    select planned_minutes into v_planned from public.class_session_items i join public.class_sessions s on s.id = i.session_id
      where i.session_id = r2.s::uuid and s.user_id = v_user and i.outcome_id = r2.o and i.studied_in_class = false for update of i;
    if not found or v_planned is null or r2.m + public.class_item_allocated(r2.s::uuid, r2.o) > v_planned then
      raise exception 'STALE_PROPOSAL: more follow-up work was proposed than is still owed';
    end if;
  end loop;
  for r2 in select r->>'group_key' as k, min(r->>'id') as first_id, min(r->>'outcome_id') as o, min(r->>'class_session_id') as s
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'group_key', '') <> '' group by 1 loop
    insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
      values (v_user, r2.first_id, 2, jsonb_build_object('outcome_id', r2.o, 'session_id', r2.s, 'source', 'class_log')) returning id into v_gid;
    v_groups := v_groups || jsonb_build_object(r2.k, v_gid);
  end loop;

  -- An empty week is valid: a planned break or no availability must not trap the student.
  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
    duration_minutes, duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by,
    concept_id, learning_objective, suggested_approach, completion_meaning,
    class_session_id, outcome_id, sitting_ordinal, dependencies, verification_intent, curriculum_reference, scope_group_id
  )
  select r->>'id', v_user, v_next_cycle, r->>'title', r->>'detail', r->>'task_type', r->>'origin', r->>'priority', r->>'placement',
         r->>'execution', (r->>'local_date')::date, (r->>'day')::date, nullif(r->>'starts_at', '')::timestamptz,
         (r->>'duration_minutes')::smallint, r->>'duration', nullif(r->>'lm_id', ''), nullif(r->>'repair_thread_id', '')::uuid,
         r->>'rationale', case when jsonb_typeof(r->'assessment_scope') = 'object' then r->'assessment_scope' end, r->>'created_by',
         nullif(r->>'concept_id', '')::uuid, nullif(r->>'learning_objective', ''), nullif(r->>'suggested_approach', ''), nullif(r->>'completion_meaning', ''),
         nullif(r->>'class_session_id', '')::uuid, nullif(r->>'outcome_id', ''), nullif(r->>'sitting_ordinal', '')::smallint,
         case when jsonb_typeof(r->'dependencies') = 'array' then r->'dependencies' else '[]'::jsonb end,
         nullif(r->>'verification_intent', ''), nullif(r->>'curriculum_reference', ''),
         coalesce((v_groups->>(r->>'group_key'))::uuid, nullif(r->>'group_id', '')::uuid)
  from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) as r;

  update public.task_scope_groups g set expected_parts = greatest(2, (
      select count(*) from public.plan_blocks p where p.scope_group_id = g.id and not exists (select 1 from public.plan_blocks c where c.continued_from_task_id = p.id)))
    where g.user_id = v_user and (g.id in (select value::uuid from jsonb_each_text(v_groups))
      or g.id in (select (r->>'group_id')::uuid from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'group_id', '') <> ''));

  -- Pass 2: what happens next. A continuation copies PLANNING context (mapping, objective, method, guidance,
  -- split group, repair link). Everything specific to the occurrence is reset and stays with the week it
  -- belongs to: minutes and history (separate tables, never copied), confirmations, the attempt, the linked
  -- evidence event, the class session, any cancellation, and the date. Placement is exactly what the saved
  -- preview showed; nothing is scheduled again here.
  perform set_config('roadmap.continuation_command', 'on', true);
  for v_action in select * from jsonb_array_elements(v_actions) loop
    if v_action->'continuation' is null or jsonb_typeof(v_action->'continuation') <> 'object' then continue; end if;
    select * into v_pred from public.plan_blocks where id = v_action->>'taskId' and user_id = v_user;
    v_minutes := (v_action->'continuation'->>'minutes')::integer;
    v_place := nullif(v_action->'continuation'->'placement'->>'date', '')::date;
    if v_place is not null and (v_place < v_next_start or v_place > (v_next->>'ends_at_local')::date) then
      raise exception 'A placement must be inside the next week.' using errcode = '22023';
    end if;
    v_succ_id := 'task-' || gen_random_uuid()::text;
    v_succ := jsonb_populate_record(null::public.plan_blocks, to_jsonb(v_pred) || jsonb_build_object(
      'id', v_succ_id, 'cycle_id', v_next_cycle, 'execution', 'not_started', 'revision', 1, 'updated_at', now(),
      'local_date', v_place, 'starts_at', null,
      'day', coalesce(v_place, v_next_start)::text,                              -- plan_blocks.day is text NOT NULL
      'placement', case when v_place is null then 'floating' else 'day_preferred' end,
      'state', case when v_place is null then 'floating' else 'planned' end,
      'duration_minutes', v_minutes, 'duration', v_minutes::text,
      'cancelled_at', null, 'cancellation_reason', null, 'cancellation_source_id', null,
      'attempt_id', null, 'evidence_event_id', null, 'class_session_id', null, 'sitting_ordinal', null, 'sitting_ordinal', null, 'assessment_scope', null,
      'created_by', 'student', 'continued_from_task_id', v_pred.id,
      'carry_intent', v_action->'continuation'->>'intent',
      'estimate_provisional', coalesce((v_action->'continuation'->>'provisional')::boolean, false),
      'rationale', 'Continuing from last week. Your earlier progress and time stay with that week.'
    ));
    insert into public.plan_blocks select (v_succ).*;
    insert into public.task_events(user_id, task_id, event_type, payload, previous)
      values (v_user, v_pred.id, 'details_changed', jsonb_build_object('kind', 'continued', 'continuedAs', v_succ_id, 'draftId', p_draft_id), '{}'::jsonb),
             (v_user, v_succ_id, 'created', jsonb_build_object('continuedFrom', v_pred.id, 'draftId', p_draft_id, 'placedOn', v_place), '{}'::jsonb);
    v_continued := v_continued || jsonb_build_array(jsonb_build_object('from', v_pred.id, 'to', v_succ_id, 'date', v_place));
  end loop;

  insert into public.weekly_reviews (user_id, cycle_id, next_cycle_id, closure_kind, no_paper_reason, unknown_task_ids, recap, resolutions, draft_id, continuations)
    values (v_user, v_cycle_id, v_next_cycle, v_draft.closure_kind, nullif(btrim(v_draft.no_paper_reason), ''), v_unknown,
            coalesce(v_draft.proposal->'recap', '{}'::jsonb), v_draft.choices, p_draft_id, v_continued);
  update public.weekly_transition_drafts set status = 'accepted' where id = p_draft_id;

  return jsonb_build_object('ok', true, 'alreadyClosed', false, 'closedCycleId', v_cycle_id, 'nextCycleId', v_next_cycle,
    'continued', jsonb_array_length(v_continued));
end; $function$
;

notify pgrst, 'reload schema';
