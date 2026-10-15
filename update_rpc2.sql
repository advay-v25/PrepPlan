create or replace function public.accept_onboarding_preview(p_draft_id uuid, p_expected_revision integer)
returns json
language plpgsql
as $$
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

  -- Lock the draft row
  select * into v_draft
  from public.plan_drafts
  where id = p_draft_id for update;

  if not found then
    raise exception 'Draft not found';
  end if;

  if v_draft.user_id != v_user_id then
    raise exception 'Unauthorized';
  end if;

  if v_draft.purpose != 'onboarding_preview' and v_draft.purpose != 'onboarding_initial_week' then
    raise exception 'Draft is not an onboarding preview';
  end if;

  if v_draft.status = 'accepted' then
    -- Idempotent retry: return existing cycle
    return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_draft.accepted_cycle_id);
  end if;

  if v_draft.status != 'ready' then
    raise exception 'Draft is not ready';
  end if;

  if v_draft.revision != p_expected_revision then
    raise exception 'Stale revision. Expected %, got %', p_expected_revision, v_draft.revision;
  end if;

  -- Activate the linked roadmap and supersede previous
  update public.study_roadmaps
  set status = 'superseded'
  where user_id = v_user_id and status = 'active';

  update public.study_roadmaps
  set status = 'active', accepted_at = now()
  where id = v_draft.roadmap_id;

  -- Create one planning cycle
  v_new_cycle_id := gen_random_uuid();
  insert into public.planning_cycles (
    id, user_id, starts_at_local, ends_at_local, timezone, status, starts_at, ends_at
  ) values (
    v_new_cycle_id, v_user_id, v_draft.cycle_start_date, v_draft.cycle_end_date, v_draft.timezone, 'active',
    (v_draft.cycle_start_date::text || ' 00:00:00 ' || v_draft.timezone)::timestamptz,
    (v_draft.cycle_end_date::text || ' 23:59:59 ' || v_draft.timezone)::timestamptz
  );

  -- Insert tasks strictly from server-owned draft_json
  v_tasks_array := v_draft.draft_json->'tasks';
  if jsonb_typeof(v_tasks_array) = 'array' then
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, state, local_date, duration_minutes, task_type, placement, priority, execution, origin, duration, day
    )
    select
      t->>'id',
      v_user_id,
      v_new_cycle_id,
      t->>'title',
      COALESCE(t->'metadata'->>'detail', ''),
      'planned',
      (t->>'scheduled_date')::date,
      (t->>'duration_minutes')::integer,
      t->'metadata'->>'task_type',
      COALESCE(t->'metadata'->>'placement', 'day_preferred'),
      COALESCE(t->'metadata'->>'priority', 'core'),
      'not_started',
      'planner',
      COALESCE(t->>'duration_minutes', '0') || 'm',
      COALESCE(t->>'scheduled_date', '')
    from jsonb_array_elements(v_tasks_array) as t;
  end if;

  -- Mark draft accepted
  update public.plan_drafts
  set status = 'accepted', accepted_cycle_id = v_new_cycle_id, updated_at = now()
  where id = p_draft_id;

  -- Final onboarding snapshot on profile
  update public.profiles
  set
    onboarding_status = 'complete',
    onboarding_completed_at = now(),
    onboarding_preview_id = p_draft_id,
    updated_at = now()
  where id = v_user_id;

  return json_build_object('roadmap_id', v_draft.roadmap_id, 'cycle_id', v_new_cycle_id);

end;
$$;
