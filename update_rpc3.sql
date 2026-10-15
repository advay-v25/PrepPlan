CREATE OR REPLACE FUNCTION public.accept_onboarding_preview(p_draft_id uuid, p_expected_revision integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;
  v_draft plan_drafts%rowtype;
  v_new_cycle_id uuid;
  v_task jsonb;
  v_tasks_array jsonb;
begin
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

  v_new_cycle_id := gen_random_uuid();
  insert into public.planning_cycles (
    id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status
  ) values (
    v_new_cycle_id, v_user_id, now(), now() + interval '7 days',
    coalesce(v_draft.cycle_start_date, v_draft.proposed_cycle_starts_at_local),
    coalesce(v_draft.cycle_end_date, v_draft.proposed_cycle_ends_at_local),
    coalesce(v_draft.timezone, 'UTC'), 'active'
  );

  v_tasks_array := v_draft.draft_json->'tasks';
  if jsonb_typeof(v_tasks_array) = 'array' then
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, duration_minutes,
      duration, lm_id, repair_thread_id, rationale, created_by
    )
    select
      coalesce((t->>'id')::text, 'task-' || gen_random_uuid()::text),
      v_user_id,
      v_new_cycle_id,
      t->>'title',
      coalesce(t->'metadata'->>'detail', ''),
      coalesce(t->'metadata'->>'task_type', 'study'),
      'algorithm',
      coalesce(t->'metadata'->>'priority', 'core'),
      coalesce(t->'metadata'->>'placement', 'day_preferred'),
      'not_started',
      (t->>'scheduled_date')::date,
      (t->>'scheduled_date')::text,
      (t->>'duration_minutes')::smallint,
      coalesce(t->>'duration_minutes', '0'),
      nullif(t->'metadata'->>'lm_id', ''),
      nullif(t->'metadata'->>'repair_thread_id', '')::uuid,
      coalesce(t->'metadata'->>'rationale', ''),
      'algorithm'
    from jsonb_array_elements(v_tasks_array) as t
    where t->>'scheduled_date' is not null;
  end if;

  update public.plan_drafts
  set status = 'accepted', accepted_cycle_id = v_new_cycle_id, revision = revision + 1, updated_at = now()
  where id = p_draft_id;

  update public.profiles
  set onboarding_status = 'complete', onboarding_completed_at = now(),
      onboarding_preview_id = p_draft_id, updated_at = now()
  where id = v_user_id;

  return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_new_cycle_id);
end;
$function$
